import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { budget_line_items, budget_projects, contacts, ops_tasks, release_milestones, releases } from "../db/schema";
import { db } from "../lib/db";
import { NotFoundError } from "./errors";
import { buildReleaseTimeline, RELEASE_TIMELINE_PHASES, type ReleaseTimelinePhaseKey } from "./release-timeline-core";
import { listTaskPlanningOptions } from "./ops-tasks";
import { workspaceToday } from "./task-deadlines";
import { hasOwn, idSchema, nullableText } from "./validation";

const phaseSchema = z.enum(RELEASE_TIMELINE_PHASES.map((phase) => phase.key) as [ReleaseTimelinePhaseKey, ...ReleaseTimelinePhaseKey[]]);
const statusSchema = z.enum(["todo", "in_progress", "done"]);

const milestoneBaseSchema = {
  release_id: idSchema,
  title: z.string().trim().min(1, "Title is required").max(160),
  phase: phaseSchema,
  due_date: z.iso.date().nullable().optional(),
  status: statusSchema.optional(),
  owner: nullableText,
  notes: nullableText,
  is_blocking: z.boolean().optional(),
};

export const createReleaseMilestoneSchema = z.object({ id: idSchema.optional(), ...milestoneBaseSchema });
const { release_id: _releaseId, ...mutableMilestoneSchema } = milestoneBaseSchema;
export const updateReleaseMilestoneSchema = z.object({
  id: idSchema,
  ...Object.fromEntries(Object.entries(mutableMilestoneSchema).map(([key, schema]) => [key, schema.optional()])),
}).strict().refine((input) => Object.keys(input).some((key) => key !== "id"), {
  message: "At least one milestone field must be provided",
});
export type CreateReleaseMilestoneInput = z.infer<typeof createReleaseMilestoneSchema>;
export type UpdateReleaseMilestoneInput = z.infer<typeof updateReleaseMilestoneSchema>;

const dateText = (value: Date | string | null) => value instanceof Date ? value.toISOString().slice(0, 10) : value;

export async function getReleaseTimeline(orgId: string, releaseId: string) {
  const release = (await db.select({ id: releases.id, release_date: releases.release_date, today: workspaceToday(orgId) }).from(releases).where(and(eq(releases.id, releaseId), eq(releases.org_id, orgId))))[0];
  if (!release) throw new NotFoundError("Release not found");

  const [milestones, tasks, budgetItems, childReleases] = await Promise.all([
    db.select({ id: release_milestones.id, title: release_milestones.title, phase: release_milestones.phase, due_date: release_milestones.due_date, status: release_milestones.status, owner: release_milestones.owner, notes: release_milestones.notes, is_blocking: release_milestones.is_blocking })
      .from(release_milestones).where(and(eq(release_milestones.org_id, orgId), eq(release_milestones.release_id, releaseId))).orderBy(asc(release_milestones.position), asc(release_milestones.due_date)),
    db.select({ id: ops_tasks.id, title: ops_tasks.task_name, due_date: ops_tasks.due_date, status: ops_tasks.status, priority: ops_tasks.priority, owner: sql<string>`coalesce(${contacts.name}, ${ops_tasks.owner})`, assignee_ids: ops_tasks.assignee_ids, labels: ops_tasks.labels, dependency_ids: ops_tasks.dependency_ids, offset_days: ops_tasks.release_offset_days, workback_key: ops_tasks.workback_key, updated_at: ops_tasks.updated_at, milestone_id: ops_tasks.release_milestone_id, timeline_phase: ops_tasks.timeline_phase, milestone_phase: release_milestones.phase })
      .from(ops_tasks).leftJoin(contacts, and(eq(ops_tasks.owner_contact_id, contacts.id), eq(contacts.org_id, orgId))).leftJoin(release_milestones, and(eq(ops_tasks.release_milestone_id, release_milestones.id), eq(release_milestones.org_id, orgId)))
      .where(and(eq(ops_tasks.org_id, orgId), eq(ops_tasks.linked_release_id, releaseId))),
    db.select({ id: budget_line_items.id, name: budget_line_items.name, phase: budget_line_items.phase, planned: sql<number>`coalesce(${budget_line_items.planned_amount}, ${budget_line_items.amount}, 0)`, committed: sql<number>`coalesce(${budget_line_items.committed_amount}, 0)`, paid: sql<number>`coalesce(${budget_line_items.paid_amount}, 0)` })
      .from(budget_line_items).leftJoin(budget_projects, and(eq(budget_line_items.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
      .where(and(eq(budget_line_items.org_id, orgId), sql`coalesce(${budget_line_items.release_id}, ${budget_projects.release_id}) = ${releaseId}`)),
    db.select({ id: releases.id, title: releases.title, releaseDate: releases.release_date, status: releases.status, ready: releases.release_ready })
      .from(releases).where(and(eq(releases.org_id, orgId), eq(releases.parent_release_id, releaseId))),
  ]);

  const timeline = buildReleaseTimeline({
    releaseDate: release.release_date,
    today: dateText(release.today)!,
    milestones: milestones.map((milestone) => ({ id: milestone.id, title: milestone.title, phase: milestone.phase as ReleaseTimelinePhaseKey, dueDate: dateText(milestone.due_date), status: milestone.status, owner: milestone.owner, notes: milestone.notes, isBlocking: milestone.is_blocking })),
    tasks: tasks.map((task) => ({ id: task.id, title: task.title, phase: (task.milestone_phase ?? task.timeline_phase) as ReleaseTimelinePhaseKey | null, dueDate: dateText(task.due_date), status: task.status ?? "todo", priority: task.priority, owner: task.owner, milestoneId: task.milestone_id, assigneeIds: task.assignee_ids, labels: task.labels, dependencyIds: task.dependency_ids, offsetDays: task.offset_days, workbackKey: task.workback_key, updatedAt: task.updated_at?.toISOString() ?? null })),
    budgetItems: budgetItems.map((item) => ({ ...item, planned: Number(item.planned), committed: Number(item.committed), paid: Number(item.paid) })),
    childReleases,
  });
  return { ...timeline, planningOptions: await listTaskPlanningOptions(orgId) };
}

export async function listReleaseTimelinePhases(orgId: string, releaseRows: Array<{ id: string; release_date: string | null }>) {
  if (releaseRows.length === 0) return new Map<string, ReleaseTimelinePhaseKey | null>();
  const releaseIDs = releaseRows.map((release) => release.id);
  const [milestones, tasks, budgetItems] = await Promise.all([
    db.select({ release_id: release_milestones.release_id, id: release_milestones.id, title: release_milestones.title, phase: release_milestones.phase, due_date: release_milestones.due_date, status: release_milestones.status, owner: release_milestones.owner, notes: release_milestones.notes, is_blocking: release_milestones.is_blocking })
      .from(release_milestones).where(and(eq(release_milestones.org_id, orgId), inArray(release_milestones.release_id, releaseIDs))).orderBy(asc(release_milestones.position), asc(release_milestones.due_date)),
    db.select({ release_id: ops_tasks.linked_release_id, id: ops_tasks.id, title: ops_tasks.task_name, due_date: ops_tasks.due_date, status: ops_tasks.status, priority: ops_tasks.priority, owner: sql<string>`coalesce(${contacts.name}, ${ops_tasks.owner})`, assignee_ids: ops_tasks.assignee_ids, labels: ops_tasks.labels, dependency_ids: ops_tasks.dependency_ids, offset_days: ops_tasks.release_offset_days, workback_key: ops_tasks.workback_key, updated_at: ops_tasks.updated_at, milestone_id: ops_tasks.release_milestone_id, timeline_phase: ops_tasks.timeline_phase, milestone_phase: release_milestones.phase })
      .from(ops_tasks).leftJoin(contacts, and(eq(ops_tasks.owner_contact_id, contacts.id), eq(contacts.org_id, orgId))).leftJoin(release_milestones, and(eq(ops_tasks.release_milestone_id, release_milestones.id), eq(release_milestones.org_id, orgId)))
      .where(and(eq(ops_tasks.org_id, orgId), inArray(ops_tasks.linked_release_id, releaseIDs))),
    db.select({ release_id: sql<string>`coalesce(${budget_line_items.release_id}, ${budget_projects.release_id})`, id: budget_line_items.id, name: budget_line_items.name, phase: budget_line_items.phase, planned: sql<number>`coalesce(${budget_line_items.planned_amount}, ${budget_line_items.amount}, 0)`, committed: sql<number>`coalesce(${budget_line_items.committed_amount}, 0)`, paid: sql<number>`coalesce(${budget_line_items.paid_amount}, 0)` })
      .from(budget_line_items).leftJoin(budget_projects, and(eq(budget_line_items.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
      .where(and(eq(budget_line_items.org_id, orgId), inArray(sql<string>`coalesce(${budget_line_items.release_id}, ${budget_projects.release_id})`, releaseIDs))),
  ]);

  const phases = new Map<string, ReleaseTimelinePhaseKey | null>();
  for (const release of releaseRows) {
    const timeline = buildReleaseTimeline({
      releaseDate: release.release_date,
      today: new Date().toISOString().slice(0, 10),
      milestones: milestones.filter((row) => row.release_id === release.id).map((row) => ({ id: row.id, title: row.title, phase: row.phase as ReleaseTimelinePhaseKey, dueDate: dateText(row.due_date), status: row.status, owner: row.owner, notes: row.notes, isBlocking: row.is_blocking })),
      tasks: tasks.filter((row) => row.release_id === release.id).map((row) => ({ id: row.id, title: row.title, phase: (row.milestone_phase ?? row.timeline_phase) as ReleaseTimelinePhaseKey | null, dueDate: dateText(row.due_date), status: row.status ?? "todo", priority: row.priority, owner: row.owner, milestoneId: row.milestone_id, assigneeIds: row.assignee_ids, labels: row.labels, dependencyIds: row.dependency_ids, offsetDays: row.offset_days, workbackKey: row.workback_key, updatedAt: row.updated_at?.toISOString() ?? null })),
      budgetItems: budgetItems.filter((row) => row.release_id === release.id).map((row) => ({ id: row.id, name: row.name, phase: row.phase, planned: Number(row.planned), committed: Number(row.committed), paid: Number(row.paid) })),
      childReleases: [],
    });
    phases.set(release.id, timeline.currentPhaseKey);
  }
  return phases;
}

export async function createReleaseMilestone(orgId: string, input: CreateReleaseMilestoneInput) {
  const release = (await db.select({ id: releases.id }).from(releases).where(and(eq(releases.id, input.release_id), eq(releases.org_id, orgId))))[0];
  if (!release) throw new NotFoundError("Release not found");
  const id = input.id ?? crypto.randomUUID();
  await db.insert(release_milestones).values({ id, org_id: orgId, release_id: input.release_id, title: input.title, phase: input.phase, due_date: input.due_date ?? null, status: input.status ?? "todo", owner: input.owner ?? null, notes: input.notes ?? null, is_blocking: input.is_blocking ?? false });
  return { id, timeline: await getReleaseTimeline(orgId, input.release_id) };
}

export async function updateReleaseMilestone(orgId: string, input: UpdateReleaseMilestoneInput) {
  const existing = (await db.select().from(release_milestones).where(and(eq(release_milestones.id, input.id), eq(release_milestones.org_id, orgId))))[0];
  if (!existing) throw new NotFoundError("Milestone not found");
  const updates: Record<string, unknown> = { updated_at: new Date() };
  for (const key of ["title", "phase", "due_date", "status", "owner", "notes", "is_blocking"] as const) if (hasOwn(input, key)) updates[key] = input[key];
  await db.update(release_milestones).set(updates).where(and(eq(release_milestones.id, input.id), eq(release_milestones.org_id, orgId)));
  return { id: input.id, timeline: await getReleaseTimeline(orgId, existing.release_id) };
}
