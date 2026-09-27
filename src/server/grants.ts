import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  budget_projects,
  contacts,
  funding_sources,
  grant_application_requirements,
  grant_application_events,
  grant_applications,
  grants,
  funding_source_events,
  org_memberships,
} from "../db/schema";
import { users } from "../db/auth-schema";
import { db } from "../lib/db";
import { ConflictError, NotFoundError } from "./errors";
import { workspaceToday } from "./task-deadlines";
import { hasOwn, idSchema, nullableNumber, nullableText } from "./validation";
import { buildAwardedFundingSourceValues, isAwardedOutcome } from "./grants-money-model-core";
import { reportingTaskForAward } from "./grant-award-core";

const grantBaseSchema = {
  name: z.string().trim().min(1, "Grant name is required"),
  funder: nullableText,
  program: nullableText,
  category: nullableText,
  url: nullableText,
  research_url: nullableText,
  description: nullableText,
  requirements: nullableText,
  applicant_type: nullableText,
  eligible_uses: nullableText,
  assessment_body: nullableText,
  response_timing: nullableText,
  rules: nullableText,
  research_status: nullableText,
  research_summary: nullableText,
  research_source: nullableText,
  last_verified_at: nullableText,
  opens_on: nullableText,
  deadline: nullableText,
  max_amount: nullableNumber({ min: 0 }),
  currency: nullableText,
  priority: nullableText,
  status: nullableText,
  notes: nullableText,
};

export const createGrantSchema = z.object({ id: idSchema.optional(), ...grantBaseSchema });
export const updateGrantSchema = z.object({
  id: idSchema,
  ...Object.fromEntries(Object.entries(grantBaseSchema).map(([key, schema]) => [key, schema.optional()])),
});
export const deleteGrantSchema = z.object({ id: idSchema });

const applicationBaseSchema = {
  project_id: nullableText,
  grant_id: nullableText,
  funding_source_id: nullableText,
  owner_contact_id: nullableText,
  owner_user_id: nullableText,
  status: nullableText,
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  workflow_stage: z.enum(["idea", "research", "writing", "ready_to_submit", "submitted", "decision_pending", "reporting", "closed"]).optional(),
  outcome: z.enum(["unknown", "approved", "partially_approved", "rejected", "withdrawn", "not_qualified"]).optional(),
  amount_requested: nullableNumber({ min: 0 }),
  amount_awarded: nullableNumber({ min: 0 }),
  submission_deadline: nullableText,
  submitted_at: nullableText,
  decision_date: nullableText,
  reporting_due: nullableText,
  next_action: nullableText,
  next_action_due: nullableText,
  angle_narrative: nullableText,
  response_notes: nullableText,
  evaluation: nullableText,
  next_step_recommendation: nullableText,
  source_folder: nullableText,
  external_reference: nullableText,
  notes: nullableText,
};

export const createGrantApplicationSchema = z.object({ id: idSchema.optional(), ...applicationBaseSchema });
export const updateGrantApplicationSchema = createGrantApplicationSchema.partial().required({ id: true });
export const deleteGrantApplicationSchema = z.object({ id: idSchema });

export type CreateGrantInput = z.infer<typeof createGrantSchema>;
export type UpdateGrantInput = z.infer<typeof updateGrantSchema>;
export type CreateGrantApplicationInput = z.infer<typeof createGrantApplicationSchema>;
export type UpdateGrantApplicationInput = z.infer<typeof updateGrantApplicationSchema>;
export type FundingSourceProjectLookup = (orgId: string, fundingSourceId: string) => Promise<string | null>;
export type ApplicationMemberLookup = (orgId: string, userId: string) => Promise<boolean>;

export async function assertApplicationOwner(
  orgId: string,
  ownerUserId: string | null | undefined,
  lookup: ApplicationMemberLookup = lookupApplicationMember,
): Promise<void> {
  if (!ownerUserId) return;
  if (!(await lookup(orgId, ownerUserId))) {
    throw new NotFoundError("Application owner must be an active workspace member");
  }
}

export async function assertApplicationFundingSourceProject(
  orgId: string,
  projectId: string | null | undefined,
  fundingSourceId: string | null | undefined,
  lookup: FundingSourceProjectLookup = lookupFundingSourceProject,
): Promise<void> {
  if (!projectId || !fundingSourceId) return;
  const fundingProjectId = await lookup(orgId, fundingSourceId);
  if (!fundingProjectId || fundingProjectId !== projectId) {
    throw new NotFoundError("Funding source and grant application must belong to the same project");
  }
}

export function effectiveApplicationFundingLinks(
  before: { project_id: string | null; grant_id?: string | null; funding_source_id: string | null },
  input: Record<string, unknown> & { project_id?: string | null; funding_source_id?: string | null },
) {
  return {
    projectId: hasOwn(input, "project_id") ? input.project_id : before.project_id,
    grantId: hasOwn(input, "grant_id") ? input.grant_id as string | null | undefined : before.grant_id,
    fundingSourceId: hasOwn(input, "funding_source_id") ? input.funding_source_id : before.funding_source_id,
  };
}

type EventfulApplication = Pick<typeof grant_applications.$inferSelect,
  "workflow_stage" | "outcome" | "owner_contact_id" | "owner_user_id" | "amount_awarded" | "submitted_at" | "reporting_due" | "next_action">;

export function grantApplicationEventsForUpdate(before: Partial<EventfulApplication>, input: Record<string, unknown>) {
  const tracked = [
    ["workflow_stage", "workflow_stage"], ["outcome", "outcome"],
    ["amount_awarded", "award"], ["submitted_at", "submission"], ["reporting_due", "reporting"], ["next_action", "note"],
  ] as const;
  const ownerField = hasOwn(input, "owner_user_id") ? "owner_user_id" : hasOwn(input, "owner_contact_id") ? "owner_contact_id" : null;
  const ownerEvent = ownerField && String(before[ownerField] ?? "") !== String(input[ownerField] ?? "")
    ? [{ event_type: "owner", from_value: before[ownerField] == null ? null : String(before[ownerField]), to_value: input[ownerField] == null ? null : String(input[ownerField]) }]
    : [];
  const materialEvents = tracked.flatMap(([field, event_type]) => {
    if (!hasOwn(input, field)) return [];
    const normalize = (value: unknown) => value == null ? null : value instanceof Date ? value.toISOString() : String(value);
    const from_value = normalize(before[field]);
    const to_value = normalize(input[field]);
    return from_value === to_value ? [] : [{
      event_type,
      from_value,
      to_value,
      ...(field === "next_action" && input[field] == null ? { note: "Completed next action" } : {}),
    }];
  });
  return [...materialEvents.slice(0, 2), ...ownerEvent, ...materialEvents.slice(2)];
}

export async function listGrants(orgId: string) {
  return db.select().from(grants).where(eq(grants.org_id, orgId)).orderBy(asc(grants.deadline), asc(grants.name));
}

export async function listGrantApplications(orgId: string) {
  return db
    .select({
      id: grant_applications.id,
      project_id: grant_applications.project_id,
      grant_id: grant_applications.grant_id,
      funding_source_id: grant_applications.funding_source_id,
      owner_contact_id: grant_applications.owner_contact_id,
      owner_user_id: grant_applications.owner_user_id,
      status: grant_applications.status,
      priority: grant_applications.priority,
      workflow_stage: grant_applications.workflow_stage,
      outcome: grant_applications.outcome,
      amount_requested: grant_applications.amount_requested,
      amount_awarded: grant_applications.amount_awarded,
      submission_deadline: grant_applications.submission_deadline,
      submitted_at: grant_applications.submitted_at,
      decision_date: grant_applications.decision_date,
      reporting_due: grant_applications.reporting_due,
      next_action: grant_applications.next_action,
      next_action_due: grant_applications.next_action_due,
      angle_narrative: grant_applications.angle_narrative,
      response_notes: grant_applications.response_notes,
      evaluation: grant_applications.evaluation,
      next_step_recommendation: grant_applications.next_step_recommendation,
      source_folder: grant_applications.source_folder,
      external_reference: grant_applications.external_reference,
      notes: grant_applications.notes,
      grant_name: grants.name,
      project_name: budget_projects.name,
      owner_name: sql<string | null>`coalesce(${users.name}, ${contacts.name})`,
    })
    .from(grant_applications)
    .leftJoin(grants, and(eq(grant_applications.grant_id, grants.id), eq(grants.org_id, orgId)))
    .leftJoin(budget_projects, and(eq(grant_applications.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
    .leftJoin(org_memberships, and(eq(grant_applications.owner_user_id, org_memberships.user_id), eq(org_memberships.org_id, orgId)))
    .leftJoin(users, eq(users.id, org_memberships.user_id))
    .leftJoin(contacts, and(eq(grant_applications.owner_contact_id, contacts.id), eq(contacts.org_id, orgId)))
    .where(eq(grant_applications.org_id, orgId))
    .orderBy(asc(grant_applications.submission_deadline));
}

export async function listUpcomingGrantDeadlines(orgId: string) {
  const today = workspaceToday(orgId);
  const horizon = sql<Date>`${today} + interval '90 days'`;

  const [applicationRows, opportunityRows] = await Promise.all([
    db
      .select({
        id: grant_applications.id,
        kind: sql<"application">`'application'`,
        title: grants.name,
        context: budget_projects.name,
        deadline: sql<string>`coalesce(${grant_applications.submission_deadline}, ${grants.deadline})`,
        status: grant_applications.status,
        amount: grant_applications.amount_requested,
        currency: grants.currency,
      })
      .from(grant_applications)
      .leftJoin(grants, and(eq(grant_applications.grant_id, grants.id), eq(grants.org_id, orgId)))
      .leftJoin(budget_projects, and(eq(grant_applications.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
      .where(and(
        eq(grant_applications.org_id, orgId),
        sql`lower(${grant_applications.status}) not in ('rejected', 'withdrawn', 'awarded', 'submitted')`,
        sql`coalesce(${grant_applications.submission_deadline}, ${grants.deadline}) between ${today} and ${horizon}`,
      )),
    db
      .select({
        id: grants.id,
        kind: sql<"opportunity">`'opportunity'`,
        title: grants.name,
        context: grants.funder,
        deadline: grants.deadline,
        status: grants.status,
        amount: grants.max_amount,
        currency: grants.currency,
      })
      .from(grants)
      .where(and(
        eq(grants.org_id, orgId),
        sql`lower(${grants.status}) in ('open', 'research', 'planned')`,
        sql`${grants.deadline} between ${today} and ${horizon}`,
        sql`not exists (select 1 from label_suite.grant_applications application where application.org_id = ${orgId} and application.grant_id = ${grants.id})`,
      )),
  ]);

  return [...applicationRows, ...opportunityRows]
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
    .slice(0, 6);
}

export async function createGrant(orgId: string, input: CreateGrantInput) {
  const id = input.id ?? crypto.randomUUID();
  await db.insert(grants).values({
    id,
    org_id: orgId,
    name: input.name,
    funder: input.funder ?? null,
    program: input.program ?? null,
    category: input.category ?? null,
    url: input.url ?? null,
    research_url: input.research_url ?? null,
    description: input.description ?? null,
    requirements: input.requirements ?? null,
    applicant_type: input.applicant_type ?? null,
    eligible_uses: input.eligible_uses ?? null,
    assessment_body: input.assessment_body ?? null,
    response_timing: input.response_timing ?? null,
    rules: input.rules ?? null,
    research_status: input.research_status ?? "research",
    research_summary: input.research_summary ?? null,
    research_source: input.research_source ?? null,
    last_verified_at: input.last_verified_at ?? null,
    opens_on: input.opens_on ?? null,
    deadline: input.deadline ?? null,
    max_amount: input.max_amount ?? null,
    currency: input.currency ?? "DKK",
    priority: input.priority ?? "medium",
    status: input.status ?? "open",
    notes: input.notes ?? null,
  });
  return { id, ok: true };
}

export async function updateGrant(orgId: string, input: UpdateGrantInput) {
  const updates: Partial<typeof grants.$inferInsert> = { updated_at: new Date() };
  for (const key of Object.keys(grantBaseSchema) as Array<keyof typeof grantBaseSchema>) {
    if (hasOwn(input, key)) (updates as Record<string, unknown>)[key] = input[key] ?? null;
  }
  const rows = await db.update(grants).set(updates).where(and(eq(grants.id, input.id), eq(grants.org_id, orgId))).returning({ id: grants.id });
  if (!rows.length) throw new NotFoundError("Grant not found");
  return { ok: true };
}

export async function deleteGrant(orgId: string, id: string) {
  const linked = await db.select({ id: grant_applications.id }).from(grant_applications).where(and(eq(grant_applications.grant_id, id), eq(grant_applications.org_id, orgId))).limit(1);
  if (linked.length) throw new ConflictError("Cannot delete a grant with applications");
  const rows = await db.delete(grants).where(and(eq(grants.id, id), eq(grants.org_id, orgId))).returning({ id: grants.id });
  if (!rows.length) throw new NotFoundError("Grant not found");
  return { ok: true };
}

export async function createGrantApplication(orgId: string, input: CreateGrantApplicationInput) {
  const id = input.id ?? crypto.randomUUID();
  await assertApplicationLinks(orgId, input);
  await assertApplicationOwner(orgId, input.owner_user_id);
  await assertApplicationFundingSourceProject(orgId, input.project_id, input.funding_source_id);
  await db.insert(grant_applications).values({
    id,
    org_id: orgId,
    project_id: input.project_id ?? null,
    grant_id: input.grant_id ?? null,
    funding_source_id: input.funding_source_id ?? null,
    owner_contact_id: input.owner_contact_id ?? null,
    owner_user_id: input.owner_user_id ?? null,
    status: input.status ?? "draft",
    priority: input.priority ?? "medium",
    workflow_stage: input.workflow_stage ?? "idea",
    outcome: input.outcome ?? "unknown",
    amount_requested: input.amount_requested ?? null,
    amount_awarded: input.amount_awarded ?? null,
    submission_deadline: input.submission_deadline ?? null,
    submitted_at: input.submitted_at ? new Date(input.submitted_at) : null,
    decision_date: input.decision_date ?? null,
    reporting_due: input.reporting_due ?? null,
    next_action: input.next_action ?? null,
    next_action_due: input.next_action_due ?? null,
    angle_narrative: input.angle_narrative ?? null,
    response_notes: input.response_notes ?? null,
    evaluation: input.evaluation ?? null,
    next_step_recommendation: input.next_step_recommendation ?? null,
    source_folder: input.source_folder ?? null,
    external_reference: input.external_reference ?? null,
    notes: input.notes ?? null,
  });
  return { id, ok: true };
}

export async function updateGrantApplication(orgId: string, input: UpdateGrantApplicationInput) {
  await assertApplicationLinks(orgId, input);
  await assertApplicationOwner(orgId, (input as Record<string, unknown>).owner_user_id as string | null | undefined);
  const [before] = await db.select({
    grant_id: grant_applications.grant_id,
    project_id: grant_applications.project_id,
    funding_source_id: grant_applications.funding_source_id,
    workflow_stage: grant_applications.workflow_stage, outcome: grant_applications.outcome,
    owner_contact_id: grant_applications.owner_contact_id, owner_user_id: grant_applications.owner_user_id,
    amount_awarded: grant_applications.amount_awarded,
    submitted_at: grant_applications.submitted_at, reporting_due: grant_applications.reporting_due,
    next_action: grant_applications.next_action,
  }).from(grant_applications).where(and(eq(grant_applications.id, input.id), eq(grant_applications.org_id, orgId))).limit(1);
  if (!before) throw new NotFoundError("Grant application not found");
  const inputRecord = input as Record<string, unknown>;
  const effectiveLinks = effectiveApplicationFundingLinks(before, input);
  await assertApplicationFundingSourceProject(orgId, effectiveLinks.projectId, effectiveLinks.fundingSourceId);
  const updates: Partial<typeof grant_applications.$inferInsert> = { updated_at: new Date() };
  for (const key of Object.keys(applicationBaseSchema) as Array<keyof typeof applicationBaseSchema>) {
    if (!hasOwn(input, key)) continue;
    (updates as Record<string, unknown>)[key] = key === "submitted_at" && input[key]
      ? new Date(String(input[key]))
      : input[key] ?? null;
  }
  const nextOutcome = hasOwn(input, "outcome") ? input.outcome : before.outcome;
  const shouldSyncAwardedSource = isAwardedOutcome(nextOutcome) && (
    !isAwardedOutcome(before.outcome)
    || hasOwn(input, "amount_awarded")
    || hasOwn(input, "reporting_due")
    || hasOwn(input, "funding_source_id")
    || hasOwn(input, "project_id")
    || hasOwn(input, "grant_id")
  );
  if (isAwardedOutcome(nextOutcome)) {
    const reportingDue = hasOwn(input, "reporting_due") ? input.reporting_due as string | null | undefined : before.reporting_due;
    const reportingTask = reportingTaskForAward(reportingDue);
    if (reportingTask && !inputRecord.next_action) {
      updates.next_action = reportingTask.nextAction;
      updates.next_action_due = reportingTask.nextActionDue;
      const workflowStage = inputRecord.workflow_stage as string | undefined;
      if (!workflowStage || ["submitted", "decision_pending"].includes(workflowStage)) updates.workflow_stage = "reporting";
    }
  }
  const events = grantApplicationEventsForUpdate(before, input as Record<string, unknown>);
  await db.transaction(async (tx) => {
    if (shouldSyncAwardedSource && effectiveLinks.projectId) {
      const [linkedSource] = effectiveLinks.fundingSourceId
        ? await tx.select({
          id: funding_sources.id, project_id: funding_sources.project_id, name: funding_sources.name,
          funder: funding_sources.funder, status: funding_sources.status, type: funding_sources.type,
          amount_planned: funding_sources.amount_planned, amount_confirmed: funding_sources.amount_confirmed,
        }).from(funding_sources).where(and(eq(funding_sources.id, effectiveLinks.fundingSourceId), eq(funding_sources.org_id, orgId))).limit(1)
        : [];
      const awardSourceId = linkedSource?.id ?? `grant-award-${input.id}`;
      const [deterministicSource] = linkedSource ? [] : await tx.select({
        id: funding_sources.id, project_id: funding_sources.project_id, name: funding_sources.name,
        funder: funding_sources.funder, status: funding_sources.status, type: funding_sources.type,
        amount_planned: funding_sources.amount_planned, amount_confirmed: funding_sources.amount_confirmed,
      }).from(funding_sources).where(and(eq(funding_sources.id, awardSourceId), eq(funding_sources.org_id, orgId))).limit(1);
      const existingSource = linkedSource ?? deterministicSource;
      const projectId = effectiveLinks.projectId ?? existingSource?.project_id ?? null;
      if (!projectId) throw new ConflictError("An awarded grant application must belong to a project or an existing funding source");
      const [grant] = effectiveLinks.grantId
        ? await tx.select({ name: grants.name, funder: grants.funder, currency: grants.currency }).from(grants).where(and(eq(grants.id, effectiveLinks.grantId), eq(grants.org_id, orgId))).limit(1)
        : [];
      const [project] = await tx.select({ currency: budget_projects.currency }).from(budget_projects)
        .where(and(eq(budget_projects.id, projectId), eq(budget_projects.org_id, orgId))).limit(1);
      const values = buildAwardedFundingSourceValues({
        project_id: projectId,
        project_currency: project?.currency ?? "USD",
        amount_awarded: hasOwn(input, "amount_awarded") ? input.amount_awarded as number | string | null | undefined : before.amount_awarded,
        reporting_due: hasOwn(inputRecord, "reporting_due") ? inputRecord.reporting_due as string | null | undefined : before.reporting_due,
      }, grant ?? { name: null, funder: null, currency: project?.currency }, existingSource ?? null);
      if (values) {
        if (existingSource) {
          await tx.update(funding_sources).set({ ...values, updated_at: new Date() }).where(and(eq(funding_sources.id, existingSource.id), eq(funding_sources.org_id, orgId)));
        } else {
          await tx.insert(funding_sources).values({ id: awardSourceId, org_id: orgId, ...values, restricted_to: null, deadline: null, notes: null });
        }
        updates.funding_source_id = existingSource?.id ?? awardSourceId;
        const sourceChanged = !existingSource
          || existingSource.status !== "confirmed"
          || existingSource.type !== "grant"
          || Number(existingSource.amount_confirmed ?? 0) !== Number(values.amount_confirmed);
        if (sourceChanged) {
          await tx.insert(funding_source_events).values({
            id: crypto.randomUUID(), org_id: orgId, funding_source_id: updates.funding_source_id,
            from_status: existingSource?.status ?? null, to_status: "confirmed", occurred_at: new Date(),
            note: "Awarded grant application synchronized to funding source",
          });
        }
      }
    }
    await tx.update(grant_applications).set(updates).where(and(eq(grant_applications.id, input.id), eq(grant_applications.org_id, orgId)));
    if (hasOwn(input, "grant_id") && input.grant_id !== before.grant_id) {
      await tx.delete(grant_application_requirements).where(and(
        eq(grant_application_requirements.application_id, input.id),
        eq(grant_application_requirements.org_id, orgId),
      ));
    }
    if (events.length) await tx.insert(grant_application_events).values(events.map((event) => ({
      id: crypto.randomUUID(), org_id: orgId, application_id: input.id, ...event,
    })));
  });
  return { ok: true };
}

export async function deleteGrantApplication(orgId: string, id: string) {
  const rows = await db.delete(grant_applications).where(and(eq(grant_applications.id, id), eq(grant_applications.org_id, orgId))).returning({ id: grant_applications.id });
  if (!rows.length) throw new NotFoundError("Grant application not found");
  return { ok: true };
}

async function assertApplicationLinks(
  orgId: string,
  input: Partial<CreateGrantApplicationInput>,
) {
  const checks = [
    [input.project_id, budget_projects, budget_projects.id, "Project"],
    [input.grant_id, grants, grants.id, "Grant"],
    [input.funding_source_id, funding_sources, funding_sources.id, "Funding source"],
    [input.owner_contact_id, contacts, contacts.id, "Owner contact"],
  ] as const;

  for (const [id, table, column, label] of checks) {
    if (!id) continue;
    const row = await db.select({ id: column }).from(table).where(and(eq(column, id), eq(table.org_id, orgId))).limit(1);
    if (!row.length) throw new NotFoundError(`${label} not found in active workspace`);
  }
}

async function lookupApplicationMember(orgId: string, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: org_memberships.id }).from(org_memberships)
    .where(and(eq(org_memberships.org_id, orgId), eq(org_memberships.user_id, userId))).limit(1);
  return Boolean(row);
}

async function lookupFundingSourceProject(orgId: string, fundingSourceId: string): Promise<string | null> {
  const [row] = await db.select({ project_id: funding_sources.project_id }).from(funding_sources).where(and(
    eq(funding_sources.org_id, orgId),
    eq(funding_sources.id, fundingSourceId),
  )).limit(1);
  return row?.project_id ?? null;
}
