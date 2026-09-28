import { z } from "zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { artists, budget_projects, campaign_leads, campaigns, contacts, ops_tasks, org_memberships, project_events, release_milestones, releases } from "../db/schema";
import { users } from "../db/auth-schema";
import { db } from "../lib/db";
import { HttpError, NotFoundError } from "./errors";
import { RELEASE_TIMELINE_PHASES, type ReleaseTimelinePhaseKey } from "./release-timeline-core";
import { workspaceToday } from "./task-deadlines";
import { dateAtOffset } from "./release-workback-core";
import { hasOwn, idSchema, nullableText } from "./validation";

const timelinePhaseSchema = z.preprocess(
  (value) => value === "" ? null : typeof value === "string" ? value.trim() : value,
  z.enum(RELEASE_TIMELINE_PHASES.map((phase) => phase.key) as [ReleaseTimelinePhaseKey, ...ReleaseTimelinePhaseKey[]]).nullable().optional(),
);

const idList = z.array(idSchema).max(50).transform((values) => [...new Set(values)]).optional();
const planningSchema = {
  assignee_ids: idList,
  dependency_ids: idList,
  labels: z.array(z.string().trim().min(1).max(40)).max(20).transform((values) => [...new Set(values)]).optional(),
};

const opsTaskBaseSchema = {
  ...planningSchema,
  task_name: z.string().trim().min(1, "Task name is required"),
  status: nullableText,
  priority: nullableText,
  owner: nullableText,
  due_date: z.iso.date().nullable().optional(),
  release_offset_days: z.number().int().min(-3650).max(3650).nullable().optional(),
  linked_artist_id: nullableText,
  linked_release_id: nullableText,
  release_milestone_id: nullableText,
  timeline_phase: timelinePhaseSchema,
  linked_campaign_id: nullableText,
  linked_campaign_lead_id: nullableText,
  linked_contact_id: nullableText,
  owner_contact_id: nullableText,
  project_id: nullableText,
  event_id: nullableText,
  notes: nullableText,
  next_action: nullableText,
};

const opsTaskUpdateSchema = {
  ...planningSchema,
  task_name: opsTaskBaseSchema.task_name.optional(),
  status: opsTaskBaseSchema.status.optional(),
  priority: opsTaskBaseSchema.priority.optional(),
  owner: opsTaskBaseSchema.owner.optional(),
  due_date: opsTaskBaseSchema.due_date.optional(),
  release_offset_days: opsTaskBaseSchema.release_offset_days,
  linked_artist_id: opsTaskBaseSchema.linked_artist_id.optional(),
  linked_release_id: opsTaskBaseSchema.linked_release_id.optional(),
  release_milestone_id: opsTaskBaseSchema.release_milestone_id.optional(),
  timeline_phase: opsTaskBaseSchema.timeline_phase.optional(),
  linked_campaign_id: opsTaskBaseSchema.linked_campaign_id.optional(),
  linked_campaign_lead_id: opsTaskBaseSchema.linked_campaign_lead_id.optional(),
  linked_contact_id: opsTaskBaseSchema.linked_contact_id.optional(),
  owner_contact_id: opsTaskBaseSchema.owner_contact_id.optional(),
  project_id: opsTaskBaseSchema.project_id.optional(),
  event_id: opsTaskBaseSchema.event_id.optional(),
  notes: opsTaskBaseSchema.notes.optional(),
  next_action: opsTaskBaseSchema.next_action.optional(),
};

export const createOpsTaskSchema = z.object({
  id: idSchema.optional(),
  ...opsTaskBaseSchema,
});

export const updateOpsTaskSchema = z.object({
  id: idSchema,
  ...opsTaskUpdateSchema,
});

export const deleteOpsTaskSchema = z.object({
  id: idSchema,
});

export type CreateOpsTaskInput = z.infer<typeof createOpsTaskSchema>;
export type UpdateOpsTaskInput = z.infer<typeof updateOpsTaskSchema>;
export type DeleteOpsTaskInput = z.infer<typeof deleteOpsTaskSchema>;

export type TaskTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type OpsTaskMutation = {
  taskId: string;
  expectedRevision?: number;
  changes: Record<string, unknown>;
  skipNoop?: boolean;
  validate?: (tx: TaskTransaction) => Promise<void>;
};

/**
 * Canonical task-row mutation authority. Native adapters supply CAS and no-op
 * semantics; ordinary web updates reuse the same final task write.
 */
export async function mutateOpsTaskInTransaction(tx: TaskTransaction, orgId: string, mutation: OpsTaskMutation) {
  const current = (await tx.select().from(ops_tasks)
    .where(and(eq(ops_tasks.id, mutation.taskId), eq(ops_tasks.org_id, orgId))))[0];
  if (!current) throw new NotFoundError("Task not found");
  if (mutation.expectedRevision !== undefined && current.revision !== mutation.expectedRevision) {
    throw new HttpError("Task changed before this action could be saved", 409);
  }
  await mutation.validate?.(tx);

  const changed = Object.entries(mutation.changes).some(([key, value]) => !taskValueEqual(current[key as keyof typeof current], value));
  const predicates = [eq(ops_tasks.id, mutation.taskId), eq(ops_tasks.org_id, orgId)];
  if (mutation.expectedRevision !== undefined) predicates.push(eq(ops_tasks.revision, mutation.expectedRevision));
  if (mutation.skipNoop && !changed) {
    const [unchanged] = await tx.select().from(ops_tasks).where(and(...predicates));
    if (!unchanged) throw new HttpError("Task changed before this action could be saved", 409);
    return { current, updated: unchanged, changed: false };
  }
  const [updated] = await tx.update(ops_tasks).set({ ...mutation.changes, updated_at: new Date() })
    .where(and(...predicates)).returning();
  if (!updated) throw new HttpError("Task changed before this action could be saved", 409);
  return { current, updated, changed };
}

function taskValueEqual(left: unknown, right: unknown) {
  return Array.isArray(left) || Array.isArray(right) ? JSON.stringify(left) === JSON.stringify(right) : left === right;
}

const linkedContact = alias(contacts, "ops_task_linked_contact");
const ownerContact = alias(contacts, "ops_task_owner_contact");

export async function listOpsTasks(orgId: string) {
  return db
    .select({
      id: ops_tasks.id,
      today: sql<string>`${workspaceToday(orgId)}::text`,
      task_name: ops_tasks.task_name,
      status: sql<string>`lower(coalesce(${ops_tasks.status}, 'todo'))`,
      priority: ops_tasks.priority,
      owner: ops_tasks.owner,
      assignee_ids: ops_tasks.assignee_ids,
      labels: ops_tasks.labels,
      dependency_ids: ops_tasks.dependency_ids,
      due_date: ops_tasks.due_date,
      release_offset_days: ops_tasks.release_offset_days,
      linked_artist_id: ops_tasks.linked_artist_id,
      linked_release_id: ops_tasks.linked_release_id,
      release_milestone_id: ops_tasks.release_milestone_id,
      timeline_phase: ops_tasks.timeline_phase,
      linked_campaign_id: ops_tasks.linked_campaign_id,
      linked_campaign_lead_id: ops_tasks.linked_campaign_lead_id,
      linked_contact_id: ops_tasks.linked_contact_id,
      owner_contact_id: ops_tasks.owner_contact_id,
      project_id: ops_tasks.project_id,
      event_id: ops_tasks.event_id,
      notes: ops_tasks.notes,
      next_action: ops_tasks.next_action,
      artist_name: artists.name,
      release_title: releases.title,
      campaign_name: campaigns.campaign_name,
      contact_name: linkedContact.name,
      owner_contact_name: ownerContact.name,
      project_name: budget_projects.name,
      event_title: project_events.title,
      event_start_date: project_events.start_date,
    })
    .from(ops_tasks)
    .leftJoin(artists, and(eq(ops_tasks.linked_artist_id, artists.id), eq(artists.org_id, orgId)))
    .leftJoin(releases, and(eq(ops_tasks.linked_release_id, releases.id), eq(releases.org_id, orgId)))
    .leftJoin(campaigns, and(eq(ops_tasks.linked_campaign_id, campaigns.id), eq(campaigns.org_id, orgId)))
    .leftJoin(linkedContact, and(eq(ops_tasks.linked_contact_id, linkedContact.id), eq(linkedContact.org_id, orgId)))
    .leftJoin(ownerContact, and(eq(ops_tasks.owner_contact_id, ownerContact.id), eq(ownerContact.org_id, orgId)))
    .leftJoin(budget_projects, and(eq(ops_tasks.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
    .leftJoin(project_events, and(eq(ops_tasks.event_id, project_events.id), eq(project_events.org_id, orgId)))
    .where(eq(ops_tasks.org_id, orgId))
    .orderBy(asc(ops_tasks.priority));
}

export async function listOpsTasksForProject(orgId: string, projectId: string) {
  return (await listOpsTasks(orgId)).filter((task) => task.project_id === projectId);
}

export async function createOpsTask(orgId: string, input: CreateOpsTaskInput) {
  return db.transaction(async (tx) => {
    // ponytail: serialize task graph edits per workspace; narrow locks if write volume grows.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${orgId}, 91))`);
    return createOpsTaskInTransaction(tx, orgId, input);
  });
}

async function createOpsTaskInTransaction(db: TaskTransaction, orgId: string, input: CreateOpsTaskInput) {
  const id = input.id ?? crypto.randomUUID();
  await validateTaskPlanning(db, orgId, id, input);
  const status = input.status ?? "todo";
  const dueDate = input.release_offset_days != null
    ? await relativeDueDate(db, orgId, input.linked_release_id, input.release_offset_days)
    : input.due_date ?? null;

  await assertReleaseMilestoneLink(db, orgId, input.linked_release_id, input.release_milestone_id);
  await assertEventInOrg(db, orgId, input.event_id);
  await assertCampaignLeadLink(db, orgId, input.linked_campaign_id, input.linked_campaign_lead_id);
  await assertTaskLinksInOrg(db, orgId, input);

  await db.insert(ops_tasks).values({
    id,
    org_id: orgId,
    task_name: input.task_name,
    status,
    priority: input.priority ?? "P2",
    owner: input.owner ?? null,
    assignee_ids: input.assignee_ids ?? [],
    labels: input.labels ?? [],
    dependency_ids: input.dependency_ids ?? [],
    due_date: dueDate,
    release_offset_days: input.release_offset_days ?? null,
    linked_artist_id: input.linked_artist_id ?? null,
    linked_release_id: input.linked_release_id ?? null,
    release_milestone_id: input.release_milestone_id ?? null,
    timeline_phase: input.timeline_phase ?? null,
    linked_campaign_id: input.linked_campaign_id ?? null,
    linked_campaign_lead_id: input.linked_campaign_lead_id ?? null,
    linked_contact_id: input.linked_contact_id ?? null,
    owner_contact_id: input.owner_contact_id ?? null,
    project_id: input.project_id ?? null,
    event_id: input.event_id ?? null,
    notes: input.notes ?? null,
    next_action: input.next_action ?? null,
    is_overdue: computeIsOverdue(status, dueDate),
  }).onConflictDoNothing({ target: ops_tasks.id });

  return { id, ok: true };
}

export async function updateOpsTask(orgId: string, input: UpdateOpsTaskInput) {
  return db.transaction(async (tx) => {
    // ponytail: serialize task graph edits per workspace; narrow locks if write volume grows.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${orgId}, 91))`);
    return updateOpsTaskInTransaction(tx, orgId, input);
  });
}

async function updateOpsTaskInTransaction(db: TaskTransaction, orgId: string, input: UpdateOpsTaskInput) {
  const existing = (
    await db.select().from(ops_tasks).where(and(eq(ops_tasks.id, input.id), eq(ops_tasks.org_id, orgId)))
  )[0];

  if (!existing) {
    throw new NotFoundError("Task not found");
  }

  await validateTaskPlanning(db, orgId, input.id, input);
  const effectiveReleaseId = hasOwn(input, "linked_release_id") ? input.linked_release_id as string | null | undefined : existing.linked_release_id;
  const effectiveMilestoneId = hasOwn(input, "release_milestone_id") ? input.release_milestone_id as string | null | undefined : existing.release_milestone_id;
  await assertReleaseMilestoneLink(db, orgId, effectiveReleaseId, effectiveMilestoneId);
  if (hasOwn(input, "event_id")) await assertEventInOrg(db, orgId, input.event_id as string | null | undefined);
  const effectiveCampaignId = hasOwn(input, "linked_campaign_id") ? input.linked_campaign_id as string | null | undefined : existing.linked_campaign_id;
  const effectiveCampaignLeadId = hasOwn(input, "linked_campaign_lead_id") ? input.linked_campaign_lead_id as string | null | undefined : existing.linked_campaign_lead_id;
  await assertCampaignLeadLink(db, orgId, effectiveCampaignId, effectiveCampaignLeadId);
  await assertTaskLinksInOrg(db, orgId, input);

  const updates: Record<string, unknown> = { updated_at: new Date() };
  for (const key of ["assignee_ids", "labels", "dependency_ids"] as const) if (hasOwn(input, key)) updates[key] = input[key];
  if (hasOwn(input, "task_name")) updates.task_name = input.task_name;
  if (hasOwn(input, "status")) updates.status = input.status;
  if (hasOwn(input, "priority")) updates.priority = input.priority;
  if (hasOwn(input, "owner")) updates.owner = input.owner;
  if (hasOwn(input, "due_date")) {
    updates.due_date = input.due_date;
    if (input.due_date !== existing.due_date) updates.release_offset_days = null;
  }
  if (hasOwn(input, "linked_release_id") && input.linked_release_id !== existing.linked_release_id) {
    updates.release_offset_days = null;
    updates.workback_key = null;
  }
  if (hasOwn(input, "release_offset_days")) {
    updates.release_offset_days = input.release_offset_days;
    if (input.release_offset_days != null) updates.due_date = await relativeDueDate(db, orgId, effectiveReleaseId, input.release_offset_days);
  }
  if (hasOwn(input, "linked_artist_id")) updates.linked_artist_id = input.linked_artist_id;
  if (hasOwn(input, "linked_release_id")) updates.linked_release_id = input.linked_release_id;
  if (hasOwn(input, "release_milestone_id")) updates.release_milestone_id = input.release_milestone_id;
  if (hasOwn(input, "timeline_phase")) updates.timeline_phase = input.timeline_phase;
  if (hasOwn(input, "linked_campaign_id")) updates.linked_campaign_id = input.linked_campaign_id;
  if (hasOwn(input, "linked_campaign_lead_id")) updates.linked_campaign_lead_id = input.linked_campaign_lead_id;
  if (hasOwn(input, "linked_contact_id")) updates.linked_contact_id = input.linked_contact_id;
  if (hasOwn(input, "owner_contact_id")) updates.owner_contact_id = input.owner_contact_id;
  if (hasOwn(input, "project_id")) updates.project_id = input.project_id;
  if (hasOwn(input, "event_id")) updates.event_id = input.event_id;
  if (hasOwn(input, "notes")) updates.notes = input.notes;
  if (hasOwn(input, "next_action")) updates.next_action = input.next_action;

  const effectiveStatus = (hasOwn(input, "status") ? input.status : existing.status) as string | null | undefined;
  const effectiveDueDate = (hasOwn(updates, "due_date") ? updates.due_date : existing.due_date) as string | Date | null | undefined;
  updates.is_overdue = computeIsOverdue(effectiveStatus, effectiveDueDate);

  await mutateOpsTaskInTransaction(db, orgId, { taskId: input.id, changes: updates });

  return { ok: true };
}

export async function deleteOpsTask(orgId: string, input: DeleteOpsTaskInput) {
  return db.transaction(async (tx) => {
    // ponytail: serialize task graph edits per workspace; narrow locks if write volume grows.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${orgId}, 91))`);
    return deleteOpsTaskInTransaction(tx, orgId, input);
  });
}

async function deleteOpsTaskInTransaction(db: TaskTransaction, orgId: string, input: DeleteOpsTaskInput) {
  const dependents = await db.select({ id: ops_tasks.id }).from(ops_tasks).where(and(eq(ops_tasks.org_id, orgId), sql`${input.id} = any(${ops_tasks.dependency_ids})`));
  if (dependents.length) throw new HttpError("Other tasks depend on this task. Remove those dependencies before deleting it.");
  const deleted = await db
    .delete(ops_tasks)
    .where(and(eq(ops_tasks.id, input.id), eq(ops_tasks.org_id, orgId)))
    .returning({ id: ops_tasks.id });

  if (!deleted.length) {
    throw new NotFoundError("Task not found");
  }

  return { ok: true };
}

function computeIsOverdue(
  status: string | null | undefined,
  dueDate: string | Date | null | undefined,
): boolean {
  if (!dueDate || status === "done") return false;

  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(due.getTime())) return false;

  return due < new Date();
}

async function assertReleaseMilestoneLink(
  db: TaskTransaction,
  orgId: string,
  releaseId: string | null | undefined,
  milestoneId: string | null | undefined,
) {
  if (!milestoneId) return;
  if (!releaseId) throw new NotFoundError("A milestone must be attached to a release");

  const milestone = (
    await db
      .select({ id: release_milestones.id, release_id: release_milestones.release_id })
      .from(release_milestones)
      .where(and(eq(release_milestones.id, milestoneId), eq(release_milestones.org_id, orgId), eq(release_milestones.release_id, releaseId)))
  )[0];

  if (!milestone || milestone.release_id !== releaseId) throw new NotFoundError("Release milestone not found");
}

async function assertTaskLinksInOrg(tx: TaskTransaction, orgId: string, input: Partial<CreateOpsTaskInput>) {
  for (const [id, table, label] of [
    [input.linked_artist_id, artists, "Artist"],
    [input.linked_release_id, releases, "Release"],
    [input.linked_campaign_id, campaigns, "Campaign"],
    [input.linked_contact_id, contacts, "Contact"],
    [input.owner_contact_id, contacts, "Owner contact"],
    [input.project_id, budget_projects, "Project"],
  ] as const) {
    if (!id) continue;
    const [record] = await tx.select({ id: table.id }).from(table)
      .where(and(eq(table.id, id), eq(table.org_id, orgId)));
    if (!record) throw new NotFoundError(`${label} not found in active workspace`);
  }
}

async function assertEventInOrg(db: TaskTransaction, orgId: string, eventId: string | null | undefined) {
  if (!eventId) return;

  const event = (
    await db
      .select({ id: project_events.id })
      .from(project_events)
      .where(and(eq(project_events.id, eventId), eq(project_events.org_id, orgId)))
  )[0];

  if (!event) throw new NotFoundError("Event not found");
}

async function assertCampaignLeadLink(
  db: TaskTransaction,
  orgId: string,
  campaignId: string | null | undefined,
  campaignLeadId: string | null | undefined,
) {
  if (!campaignLeadId) return;
  if (!campaignId) throw new NotFoundError("A campaign lead must be attached to its campaign");

  const lead = (await db
    .select({ id: campaign_leads.id })
    .from(campaign_leads)
    .where(and(
      eq(campaign_leads.id, campaignLeadId),
      eq(campaign_leads.org_id, orgId),
      eq(campaign_leads.campaign_id, campaignId),
    )))[0];

  if (!lead) throw new NotFoundError("Campaign lead not found");
}

async function relativeDueDate(db: TaskTransaction, orgId: string, releaseId: string | null | undefined, days: number) {
  if (!releaseId) throw new HttpError("Relative deadlines require a linked release");
  const release = (await db.select({ date: releases.release_date }).from(releases)
    .where(and(eq(releases.id, releaseId), eq(releases.org_id, orgId))))[0];
  if (!release) throw new NotFoundError("Release not found");
  if (!release.date) throw new HttpError("Set a release date before using relative deadlines");
  return dateAtOffset(release.date, days);
}

export async function assertTaskAssigneesEligible(tx: TaskTransaction, orgId: string, assigneeIds: string[]) {
  if (!assigneeIds.length) return;
  const members = await tx.select({ id: org_memberships.user_id, role: org_memberships.role }).from(org_memberships)
    .where(and(eq(org_memberships.org_id, orgId), inArray(org_memberships.user_id, assigneeIds)));
  // Assignment eligibility is workspace membership, not the actor mutation capability.
  if (members.length !== assigneeIds.length) {
    throw new HttpError("Assignees must be eligible workspace members");
  }
}

async function validateTaskPlanning(tx: TaskTransaction, orgId: string, id: string, input: Pick<UpdateOpsTaskInput, "assignee_ids" | "dependency_ids">) {
  if (input.assignee_ids?.length) await assertTaskAssigneesEligible(tx, orgId, input.assignee_ids);
  if (input.dependency_ids?.length) {
    const rows = await tx.select({ id: ops_tasks.id, dependencies: ops_tasks.dependency_ids }).from(ops_tasks).where(eq(ops_tasks.org_id, orgId));
    const graph = new Map(rows.map((row) => [row.id, row.dependencies]));
    if (input.dependency_ids.some((dependency) => !graph.has(dependency))) throw new HttpError("Dependencies must be tasks in this workspace");
    const seen = new Set<string>();
    const queue = [...input.dependency_ids];
    while (queue.length) {
      const next = queue.pop()!;
      if (next === id) throw new HttpError("A task cannot depend on itself, directly or through other tasks");
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...(graph.get(next) ?? []));
    }
  }
}

export async function listTaskPlanningOptions(orgId: string) {
  const [members, tasks] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(org_memberships).innerJoin(users, eq(users.id, org_memberships.user_id)).where(eq(org_memberships.org_id, orgId)),
    db.select({ id: ops_tasks.id, title: ops_tasks.task_name, status: ops_tasks.status, dueDate: ops_tasks.due_date, dependencyIds: ops_tasks.dependency_ids, labels: ops_tasks.labels }).from(ops_tasks).where(eq(ops_tasks.org_id, orgId)),
  ]);
  return { members: members.map((member) => ({ ...member, name: member.name || "Workspace member" })), tasks: tasks.map((task) => ({ ...task, status: task.status ?? "todo" })) };
}
