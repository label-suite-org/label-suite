import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";
import { ops_tasks, org_memberships, releases } from "../db/schema";
import { ConflictError, NotFoundError } from "./errors";
import { getReleaseTimeline } from "./release-timeline";
import { dateAtOffset, normalizedTitle, reschedulePreview, WORKBACK_CHECKLIST } from "./release-workback-core";
import { RELEASE_TIMELINE_PHASES } from "./release-timeline-core";

const itemSchema = z.object({
  key: z.enum(WORKBACK_CHECKLIST.map((item) => item.key) as [string, ...string[]]),
  title: z.string().trim().min(1).max(160),
  phase: z.enum(RELEASE_TIMELINE_PHASES.map((phase) => phase.key)),
  assigneeIds: z.array(z.string().min(1)).max(50).optional(),
  owner: z.string().trim().max(160).nullable(),
  dueDate: z.iso.date(),
  offsetDays: z.number().int().min(-3650).max(3650).nullable(),
});
export const workbackSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("apply"), releaseId: z.string().min(1), releaseDate: z.iso.date(), items: z.array(itemSchema).min(1).max(10) }),
  z.object({ action: z.literal("reschedule"), releaseId: z.string().min(1), releaseDate: z.iso.date(), preview: z.array(z.object({
    id: z.string(), title: z.string(), dueDate: z.iso.date().nullable(), offsetDays: z.number().int(), updatedAt: z.string().nullable(), newDate: z.iso.date(),
  })).min(1) }),
]);

export async function applyReleaseWorkback(orgId: string, input: z.infer<typeof workbackSchema>) {
  const result = await db.transaction(async (tx) => {
    const release = (await tx.select({ date: releases.release_date }).from(releases)
      .where(and(eq(releases.id, input.releaseId), eq(releases.org_id, orgId))).for("update"))[0];
    if (!release) throw new NotFoundError("Release not found");
    if (release.date !== input.releaseDate) throw new ConflictError("Release date changed. Refresh and review the dates again.");
    const tasks = await tx.select().from(ops_tasks)
      .where(and(eq(ops_tasks.org_id, orgId), eq(ops_tasks.linked_release_id, input.releaseId))).for("update");
    if (input.action === "reschedule") {
      const expected = reschedulePreview(tasks.map((task) => ({ id: task.id, title: task.task_name, phase: null, status: task.status ?? "todo", dueDate: task.due_date, owner: task.owner, priority: task.priority, milestoneId: task.release_milestone_id, offsetDays: task.release_offset_days, updatedAt: task.updated_at?.toISOString() ?? null })), release.date);
      if (JSON.stringify(expected) !== JSON.stringify(input.preview)) throw new ConflictError("Tasks changed. Refresh and review the dates again.");
      for (const item of expected) await tx.update(ops_tasks).set({ due_date: item.newDate, updated_at: new Date() })
        .where(and(eq(ops_tasks.id, item.id), eq(ops_tasks.org_id, orgId), eq(ops_tasks.linked_release_id, input.releaseId)));
      return { created: 0, reused: 0, rescheduled: expected.length };
    }
    const members = input.items.some((item) => item.assigneeIds?.length) ? await tx.select({ id: org_memberships.user_id }).from(org_memberships).where(eq(org_memberships.org_id, orgId)) : [];
    if (input.items.some((item) => item.assigneeIds?.some((id) => !members.some((member) => member.id === id)))) throw new ConflictError("Assignees must be members of this workspace");
    let created = 0, reused = 0;
    const keys = new Set(tasks.map((task) => task.workback_key));
    const titles = new Set(tasks.map((task) => normalizedTitle(task.task_name)));
    for (const item of input.items) {
      const template = WORKBACK_CHECKLIST.find((entry) => entry.key === item.key)!;
      if (keys.has(item.key) || titles.has(normalizedTitle(item.title)) || titles.has(normalizedTitle(template.title))) { reused++; continue; }
      await tx.insert(ops_tasks).values({ id: crypto.randomUUID(), org_id: orgId, linked_release_id: input.releaseId, task_name: item.title, timeline_phase: item.phase, owner: item.owner, assignee_ids: [...new Set(item.assigneeIds ?? [])], due_date: item.offsetDays == null ? item.dueDate : dateAtOffset(input.releaseDate, item.offsetDays), release_offset_days: item.offsetDays, workback_key: item.key, status: "todo", priority: "P2" });
      keys.add(item.key); titles.add(normalizedTitle(item.title)); created++;
    }
    return { created, reused, rescheduled: 0 };
  });
  return { ...result, timeline: await getReleaseTimeline(orgId, input.releaseId) };
}
