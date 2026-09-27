import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { budget_line_items, budget_projects, calls, contacts, documents, funding_need_budget_lines, funding_needs, grant_application_calls, grant_application_documents, grant_application_events, grant_application_funding_needs, grant_application_requirements, grant_applications, grant_deadlines, grant_requirements, grants, project_funding_profiles } from "../db/schema";
import { db } from "../lib/db";
import { ConflictError, NotFoundError } from "./errors";
import { idSchema, nullableNumber, nullableText } from "./validation";
import { allocateAwardProportionally } from "./grant-award-core";
import { grantDocumentRoleSchema } from "./grant-document-roles";

const dateValue = z.string().trim().min(1).nullable().optional();
const priority = z.enum(["low", "medium", "high", "urgent"]);
const needCategory = z.enum(["production", "video", "pr", "ads", "travel", "export", "live", "content", "development", "other"]);
const readiness = z.enum(["ready", "missing", "stale", "not_required"]);

export const createProjectFundingProfileSchema = z.object({
  id: idSchema.optional(),
  project_id: idSchema,
  owner_contact_id: nullableText,
  priority: priority.optional(),
  target_date: dateValue,
  goal: nullableText,
  funding_narrative: nullableText,
  deliverables: z.array(z.string()).optional(),
  success_metrics: z.array(z.string()).optional(),
  export_markets: z.array(z.string()).optional(),
  source_table: nullableText,
  source_record_id: nullableText,
});

export const createFundingNeedSchema = z.object({
  id: idSchema.optional(),
  project_id: idSchema,
  title: z.string().trim().min(1),
  category: needCategory.optional(),
  use_of_funds: nullableText,
  target_amount: nullableNumber({ min: 0 }),
  priority: priority.optional(),
  status: z.enum(["planned", "active", "funded", "cancelled"]).optional(),
  needed_by: dateValue,
  eligibility: z.enum(["grant_eligible", "mixed", "not_eligible", "unknown"]).optional(),
  success_measure: nullableText,
});
export const updateFundingNeedSchema = createFundingNeedSchema.partial().required({ id: true });

export const createFundingNeedBudgetLineSchema = z.object({
  id: idSchema.optional(),
  funding_need_id: idSchema,
  budget_line_id: idSchema,
  allocated_amount: nullableNumber({ min: 0 }),
});

export const createGrantDeadlineSchema = z.object({
  id: idSchema.optional(),
  grant_id: idSchema,
  deadline_date: z.string().trim().min(1),
  label: nullableText,
  opens_on: dateValue,
  expected_response_date: dateValue,
  status: z.enum(["planned", "open", "closed", "cancelled"]).optional(),
});

export const createApplicationFundingNeedSchema = z.object({
  id: idSchema.optional(),
  application_id: idSchema,
  funding_need_id: idSchema,
  amount_requested: nullableNumber({ min: 0 }),
  amount_awarded: nullableNumber({ min: 0 }),
});
export const replaceApplicationFundingNeedsSchema = z.object({
  application_id: idSchema,
  allocations: z.array(createApplicationFundingNeedSchema.omit({ id: true, application_id: true }).extend({ id: idSchema.optional() })),
});

export const createGrantRequirementSchema = z.object({
  id: idSchema.optional(),
  grant_id: idSchema,
  name: z.string().trim().min(1),
  description: nullableText,
  asset_role: nullableText,
  required: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(2_147_483_647).optional(),
});

export const createGrantApplicationRequirementSchema = z.object({
  id: idSchema.optional(),
  application_id: idSchema,
  requirement_id: nullableText,
  document_id: nullableText,
  required: z.boolean().optional(),
  readiness_status: readiness.optional(),
  notes: nullableText,
});
export const replaceGrantApplicationRequirementsSchema = z.object({
  application_id: idSchema,
  requirements: z.array(createGrantApplicationRequirementSchema.omit({ id: true, application_id: true }).extend({ id: idSchema.optional() })),
});

export const createGrantApplicationDocumentSchema = z.object({
  id: idSchema.optional(),
  application_id: idSchema,
  document_id: idSchema,
  link_type: z.string().trim().min(1).optional(),
  asset_role: grantDocumentRoleSchema.optional(),
  required: z.boolean().optional(),
  readiness_status: readiness.optional(),
});
export const replaceGrantApplicationDocumentsSchema = z.object({
  application_id: idSchema,
  documents: z.array(createGrantApplicationDocumentSchema.omit({ id: true, application_id: true }).extend({ id: idSchema.optional() })),
});

export const createGrantApplicationCallSchema = z.object({
  id: idSchema.optional(),
  application_id: idSchema,
  call_id: idSchema,
});

export const createGrantApplicationEventSchema = z.object({
  id: idSchema.optional(),
  application_id: idSchema,
  event_type: z.enum(["workflow_stage", "outcome", "owner", "submission", "award", "reporting", "note"]),
  actor_contact_id: nullableText,
  from_value: nullableText,
  to_value: nullableText,
  note: nullableText,
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  occurred_at: nullableText,
});

export type WorkspaceLinkKind = "project" | "contact" | "budgetLine" | "grant" | "application" | "fundingNeed" | "requirement" | "document" | "call";
export type WorkspaceLinkLookup = (orgId: string, kind: WorkspaceLinkKind, id: string) => Promise<boolean>;

const linkLabels: Record<WorkspaceLinkKind, string> = {
  project: "Project",
  contact: "Contact",
  budgetLine: "Budget line",
  grant: "Grant",
  application: "Grant application",
  fundingNeed: "Funding need",
  requirement: "Grant requirement",
  document: "Document",
  call: "Call",
};

export async function assertWorkspaceLinks(
  orgId: string,
  links: Partial<Record<WorkspaceLinkKind, string | null | undefined>>,
  lookup: WorkspaceLinkLookup = workspaceLinkExists,
) {
  for (const [kind, id] of Object.entries(links) as Array<[WorkspaceLinkKind, string | null | undefined]>) {
    if (!id) continue;
    if (!await lookup(orgId, kind, id)) {
      throw new NotFoundError(`${linkLabels[kind]} not found in active workspace`);
    }
  }
}

export function assertSameFundingProject(
  firstProjectId: string | null | undefined,
  secondProjectId: string | null | undefined,
  label: string,
) {
  if (!firstProjectId || !secondProjectId || firstProjectId !== secondProjectId) {
    throw new ConflictError(`${label} must belong to the same project`);
  }
}

export function assertSameGrant(
  applicationGrantId: string | null | undefined,
  requirementGrantId: string | null | undefined,
) {
  if (!applicationGrantId || !requirementGrantId || applicationGrantId !== requirementGrantId) {
    throw new ConflictError("Requirement must belong to the application's selected grant");
  }
}

async function workspaceLinkExists(orgId: string, kind: WorkspaceLinkKind, id: string): Promise<boolean> {
  switch (kind) {
    case "project": return hasOrgRow(budget_projects, budget_projects.id, orgId, id);
    case "contact": return hasOrgRow(contacts, contacts.id, orgId, id);
    case "budgetLine": return hasOrgRow(budget_line_items, budget_line_items.id, orgId, id);
    case "grant": return hasOrgRow(grants, grants.id, orgId, id);
    case "application": return hasOrgRow(grant_applications, grant_applications.id, orgId, id);
    case "fundingNeed": return hasOrgRow(funding_needs, funding_needs.id, orgId, id);
    case "requirement": return hasOrgRow(grant_requirements, grant_requirements.id, orgId, id);
    case "document": return hasOrgRow(documents, documents.id, orgId, id);
    case "call": return hasOrgRow(calls, calls.id, orgId, id);
  }
}

async function hasOrgRow(table: any, idColumn: any, orgId: string, id: string) {
  const rows = await db.select({ id: idColumn }).from(table).where(and(eq(idColumn, id), eq(table.org_id, orgId))).limit(1);
  return rows.length > 0;
}

export async function listProjectFundingProfiles(orgId: string) {
  return db.select().from(project_funding_profiles).where(eq(project_funding_profiles.org_id, orgId));
}

export async function createProjectFundingProfile(orgId: string, raw: z.input<typeof createProjectFundingProfileSchema>) {
  const input = createProjectFundingProfileSchema.parse(raw);
  await assertWorkspaceLinks(orgId, { project: input.project_id, contact: input.owner_contact_id });
  const id = input.id ?? crypto.randomUUID();
  const rows = await db.insert(project_funding_profiles).values({
    id, org_id: orgId, project_id: input.project_id, owner_contact_id: input.owner_contact_id ?? null,
    priority: input.priority ?? "medium", target_date: input.target_date ?? null, goal: input.goal ?? null,
    funding_narrative: input.funding_narrative ?? null, deliverables: input.deliverables ?? [],
    success_metrics: input.success_metrics ?? [], export_markets: input.export_markets ?? [],
    source_table: input.source_table ?? null, source_record_id: input.source_record_id ?? null,
  }).onConflictDoUpdate({
    target: [project_funding_profiles.org_id, project_funding_profiles.project_id],
    set: {
      owner_contact_id: input.owner_contact_id ?? null, priority: input.priority ?? "medium", target_date: input.target_date ?? null,
      goal: input.goal ?? null, funding_narrative: input.funding_narrative ?? null, deliverables: input.deliverables ?? [],
      success_metrics: input.success_metrics ?? [], export_markets: input.export_markets ?? [], updated_at: new Date(),
    },
  }).returning({ id: project_funding_profiles.id });
  return { id: rows[0]?.id ?? id, ok: true };
}

export async function listFundingNeeds(orgId: string, projectId?: string) {
  return db.select().from(funding_needs).where(projectId
    ? and(eq(funding_needs.org_id, orgId), eq(funding_needs.project_id, projectId))
    : eq(funding_needs.org_id, orgId)).orderBy(asc(funding_needs.needed_by));
}

export async function createFundingNeed(orgId: string, raw: z.input<typeof createFundingNeedSchema>) {
  const input = createFundingNeedSchema.parse(raw);
  await assertWorkspaceLinks(orgId, { project: input.project_id });
  const id = input.id ?? crypto.randomUUID();
  await db.insert(funding_needs).values({
    id, org_id: orgId, project_id: input.project_id, title: input.title, category: input.category ?? "other",
    use_of_funds: input.use_of_funds ?? null, target_amount: input.target_amount ?? 0,
    priority: input.priority ?? "medium", status: input.status ?? "planned", needed_by: input.needed_by ?? null,
    eligibility: input.eligibility ?? "unknown", success_measure: input.success_measure ?? null,
  });
  return { id, ok: true };
}

export async function updateFundingNeed(orgId: string, raw: z.input<typeof updateFundingNeedSchema>) {
  const input = updateFundingNeedSchema.parse(raw);
  if (input.project_id) await assertWorkspaceLinks(orgId, { project: input.project_id });
  const { id, ...values } = input;
  const updates = { ...values, updated_at: new Date() } as Partial<typeof funding_needs.$inferInsert>;
  const rows = await db.update(funding_needs).set(updates)
    .where(and(eq(funding_needs.org_id, orgId), eq(funding_needs.id, id))).returning({ id: funding_needs.id });
  if (!rows.length) throw new NotFoundError("Funding need not found");
  return { id, ok: true };
}

export async function linkFundingNeedBudgetLine(orgId: string, raw: z.input<typeof createFundingNeedBudgetLineSchema>) {
  const input = createFundingNeedBudgetLineSchema.parse(raw);
  await assertWorkspaceLinks(orgId, { fundingNeed: input.funding_need_id, budgetLine: input.budget_line_id });
  const [need] = await db.select({ project_id: funding_needs.project_id }).from(funding_needs).where(and(
    eq(funding_needs.org_id, orgId), eq(funding_needs.id, input.funding_need_id),
  )).limit(1);
  const [line] = await db.select({ project_id: budget_line_items.project_id }).from(budget_line_items).where(and(
    eq(budget_line_items.org_id, orgId), eq(budget_line_items.id, input.budget_line_id),
  )).limit(1);
  assertSameFundingProject(need?.project_id, line?.project_id, "Funding need and budget line");
  const id = input.id ?? crypto.randomUUID();
  await db.insert(funding_need_budget_lines).values({
    id, org_id: orgId, funding_need_id: input.funding_need_id, budget_line_id: input.budget_line_id,
    allocated_amount: input.allocated_amount ?? 0,
  });
  return { id, ok: true };
}

export async function listGrantDeadlines(orgId: string) {
  return db.select().from(grant_deadlines).where(eq(grant_deadlines.org_id, orgId)).orderBy(asc(grant_deadlines.deadline_date));
}

export async function createGrantDeadline(orgId: string, raw: z.input<typeof createGrantDeadlineSchema>) {
  const input = createGrantDeadlineSchema.parse(raw);
  await assertWorkspaceLinks(orgId, { grant: input.grant_id });
  const id = input.id ?? crypto.randomUUID();
  await db.transaction(async tx => {
    const updated = await tx.update(grants).set({ updated_at: sql`greatest(clock_timestamp(), ${grants.updated_at} + interval '1 microsecond')` })
      .where(and(eq(grants.org_id, orgId), eq(grants.id, input.grant_id))).returning({ id: grants.id });
    if (!updated.length) throw new NotFoundError("Grant not found in active workspace");
    await tx.insert(grant_deadlines).values({
      id, org_id: orgId, grant_id: input.grant_id, deadline_date: input.deadline_date, label: input.label ?? null,
      opens_on: input.opens_on ?? null, expected_response_date: input.expected_response_date ?? null, status: input.status ?? "planned",
    });
  });
  return { id, ok: true };
}

export async function allocateApplicationFundingNeed(orgId: string, raw: z.input<typeof createApplicationFundingNeedSchema>) {
  const input = createApplicationFundingNeedSchema.parse(raw);
  await assertWorkspaceLinks(orgId, { application: input.application_id, fundingNeed: input.funding_need_id });
  const [application] = await db.select({ project_id: grant_applications.project_id }).from(grant_applications).where(and(
    eq(grant_applications.org_id, orgId), eq(grant_applications.id, input.application_id),
  )).limit(1);
  const [need] = await db.select({ project_id: funding_needs.project_id }).from(funding_needs).where(and(
    eq(funding_needs.org_id, orgId), eq(funding_needs.id, input.funding_need_id),
  )).limit(1);
  assertSameFundingProject(need?.project_id, application?.project_id, "Funding need and application");
  const id = input.id ?? crypto.randomUUID();
  await db.insert(grant_application_funding_needs).values({
    id, org_id: orgId, application_id: input.application_id, funding_need_id: input.funding_need_id,
    amount_requested: input.amount_requested ?? 0, amount_awarded: input.amount_awarded ?? 0,
  });
  return { id, ok: true };
}

export async function replaceApplicationFundingNeeds(orgId: string, raw: z.input<typeof replaceApplicationFundingNeedsSchema>) {
  const input = replaceApplicationFundingNeedsSchema.parse(raw);
  await assertWorkspaceLinks(orgId, { application: input.application_id });
  const [application] = await db.select({
    project_id: grant_applications.project_id,
    funding_source_id: grant_applications.funding_source_id,
    outcome: grant_applications.outcome,
    amount_awarded: grant_applications.amount_awarded,
  }).from(grant_applications).where(and(eq(grant_applications.org_id, orgId), eq(grant_applications.id, input.application_id))).limit(1);
  if (!application) throw new NotFoundError("Grant application not found");
  for (const item of input.allocations) {
    await assertWorkspaceLinks(orgId, { fundingNeed: item.funding_need_id });
    const [application] = await db.select({ project_id: grant_applications.project_id }).from(grant_applications).where(and(eq(grant_applications.org_id, orgId), eq(grant_applications.id, input.application_id))).limit(1);
    const [need] = await db.select({ project_id: funding_needs.project_id }).from(funding_needs).where(and(eq(funding_needs.org_id, orgId), eq(funding_needs.id, item.funding_need_id))).limit(1);
    assertSameFundingProject(application?.project_id, need?.project_id, "Funding need and application");
  }
  const shouldPrefillAward = ["approved", "partially_approved"].includes(application.outcome ?? "")
    && Number(application.amount_awarded ?? 0) > 0
    && input.allocations.length > 0
    && input.allocations.every((item) => Number(item.amount_awarded ?? 0) === 0);
  const normalizedAllocations = shouldPrefillAward
    ? input.allocations.map((item) => ({ ...item, amount_awarded: allocateAwardProportionally(
      Number(application.amount_awarded ?? 0),
      input.allocations.map((allocation) => ({ fundingNeedId: allocation.funding_need_id, amountRequested: Number(allocation.amount_requested ?? 0) })),
    ).find((allocation) => allocation.fundingNeedId === item.funding_need_id)?.amountAwarded ?? 0 }))
    : input.allocations;
  await db.transaction(async (tx) => {
    await tx.delete(grant_application_funding_needs).where(and(eq(grant_application_funding_needs.org_id, orgId), eq(grant_application_funding_needs.application_id, input.application_id)));
    if (normalizedAllocations.length) await tx.insert(grant_application_funding_needs).values(normalizedAllocations.map((item) => ({
      id: item.id ?? crypto.randomUUID(), org_id: orgId, application_id: input.application_id,
      funding_need_id: item.funding_need_id, amount_requested: item.amount_requested ?? 0, amount_awarded: item.amount_awarded ?? 0,
    })));
    if (application.funding_source_id) {
      for (const allocation of normalizedAllocations.filter((item) => Number(item.amount_awarded ?? 0) > 0)) {
        const lines = await tx.select({ budget_line_id: funding_need_budget_lines.budget_line_id })
          .from(funding_need_budget_lines)
          .where(and(eq(funding_need_budget_lines.org_id, orgId), eq(funding_need_budget_lines.funding_need_id, allocation.funding_need_id)));
        for (const line of lines) {
          if (!application.project_id) continue;
          await tx.update(budget_line_items).set({ funding_source_id: application.funding_source_id, updated_at: new Date() })
            .where(and(eq(budget_line_items.org_id, orgId), eq(budget_line_items.id, line.budget_line_id), eq(budget_line_items.project_id, application.project_id)));
        }
      }
    }
  });
  return { ok: true, count: normalizedAllocations.length };
}

export async function createGrantRequirement(orgId: string, raw: z.input<typeof createGrantRequirementSchema>) {
  const input = createGrantRequirementSchema.parse(raw);
  await assertWorkspaceLinks(orgId, { grant: input.grant_id });
  const id = input.id ?? crypto.randomUUID();
  await db.transaction(async tx => {
    const updated = await tx.update(grants).set({ updated_at: sql`greatest(clock_timestamp(), ${grants.updated_at} + interval '1 microsecond')` })
      .where(and(eq(grants.org_id, orgId), eq(grants.id, input.grant_id))).returning({ id: grants.id });
    if (!updated.length) throw new NotFoundError("Grant not found in active workspace");
    await tx.insert(grant_requirements).values({
      id, org_id: orgId, grant_id: input.grant_id, name: input.name, description: input.description ?? null,
      asset_role: input.asset_role ?? null, required: input.required ?? true, sort_order: input.sort_order ?? 0,
    });
  });
  return { id, ok: true };
}

export async function listGrantRequirements(orgId: string, grantId?: string) {
  return db.select().from(grant_requirements).where(grantId
    ? and(eq(grant_requirements.org_id, orgId), eq(grant_requirements.grant_id, grantId))
    : eq(grant_requirements.org_id, orgId)).orderBy(asc(grant_requirements.sort_order));
}

export async function createGrantApplicationRequirement(orgId: string, raw: z.input<typeof createGrantApplicationRequirementSchema>) {
  const input = createGrantApplicationRequirementSchema.parse(raw);
  await assertWorkspaceLinks(orgId, { application: input.application_id, requirement: input.requirement_id, document: input.document_id });
  const id = input.id ?? crypto.randomUUID();
  await db.insert(grant_application_requirements).values({
    id, org_id: orgId, application_id: input.application_id, requirement_id: input.requirement_id ?? null,
    document_id: input.document_id ?? null, required: input.required ?? true,
    readiness_status: input.readiness_status ?? "missing", notes: input.notes ?? null,
  });
  return { id, ok: true };
}

export async function replaceGrantApplicationRequirements(orgId: string, raw: z.input<typeof replaceGrantApplicationRequirementsSchema>) {
  const input = replaceGrantApplicationRequirementsSchema.parse(raw);
  await assertWorkspaceLinks(orgId, { application: input.application_id });
  const [application] = await db.select({ grant_id: grant_applications.grant_id }).from(grant_applications).where(and(
    eq(grant_applications.org_id, orgId), eq(grant_applications.id, input.application_id),
  )).limit(1);
  for (const item of input.requirements) {
    await assertWorkspaceLinks(orgId, { requirement: item.requirement_id, document: item.document_id });
    if (item.requirement_id) {
      const [requirement] = await db.select({ grant_id: grant_requirements.grant_id }).from(grant_requirements).where(and(
        eq(grant_requirements.org_id, orgId), eq(grant_requirements.id, item.requirement_id),
      )).limit(1);
      assertSameGrant(application?.grant_id, requirement?.grant_id);
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(grant_application_requirements).where(and(eq(grant_application_requirements.org_id, orgId), eq(grant_application_requirements.application_id, input.application_id)));
    if (input.requirements.length) await tx.insert(grant_application_requirements).values(input.requirements.map((item) => ({
      id: item.id && !item.id.startsWith("inherited:") ? item.id : crypto.randomUUID(), org_id: orgId, application_id: input.application_id,
      requirement_id: item.requirement_id ?? null, document_id: item.document_id ?? null,
      required: item.required ?? true, readiness_status: item.readiness_status ?? "missing", notes: item.notes ?? null,
    })));
  });
  return { ok: true, count: input.requirements.length };
}

export async function linkGrantApplicationDocument(orgId: string, raw: z.input<typeof createGrantApplicationDocumentSchema>) {
  const input = createGrantApplicationDocumentSchema.parse(raw);
  await assertWorkspaceLinks(orgId, { application: input.application_id, document: input.document_id });
  const id = input.id ?? crypto.randomUUID();
  await db.insert(grant_application_documents).values({
    id, org_id: orgId, application_id: input.application_id, document_id: input.document_id,
    link_type: input.link_type ?? "attachment", asset_role: input.asset_role ?? "other",
    required: input.required ?? false, readiness_status: input.readiness_status ?? "missing",
  });
  return { id, ok: true };
}

export async function replaceGrantApplicationDocuments(orgId: string, raw: z.input<typeof replaceGrantApplicationDocumentsSchema>) {
  const input = replaceGrantApplicationDocumentsSchema.parse(raw);
  await assertWorkspaceLinks(orgId, { application: input.application_id });
  for (const item of input.documents) await assertWorkspaceLinks(orgId, { document: item.document_id });
  await db.transaction(async (tx) => {
    await tx.delete(grant_application_documents).where(and(eq(grant_application_documents.org_id, orgId), eq(grant_application_documents.application_id, input.application_id)));
    if (input.documents.length) await tx.insert(grant_application_documents).values(input.documents.map((item) => ({
      id: item.id ?? crypto.randomUUID(), org_id: orgId, application_id: input.application_id,
      document_id: item.document_id, link_type: item.link_type ?? "attachment", asset_role: item.asset_role ?? "other",
      required: item.required ?? false, readiness_status: item.readiness_status ?? "missing",
    })));
  });
  return { ok: true, count: input.documents.length };
}

export async function linkGrantApplicationCall(orgId: string, raw: z.input<typeof createGrantApplicationCallSchema>) {
  const input = createGrantApplicationCallSchema.parse(raw);
  await assertWorkspaceLinks(orgId, { application: input.application_id, call: input.call_id });
  const id = input.id ?? crypto.randomUUID();
  await db.insert(grant_application_calls).values({
    id, org_id: orgId, application_id: input.application_id, call_id: input.call_id,
  });
  return { id, ok: true };
}

export async function recordGrantApplicationEvent(orgId: string, raw: z.input<typeof createGrantApplicationEventSchema>) {
  const input = createGrantApplicationEventSchema.parse(raw);
  await assertWorkspaceLinks(orgId, { application: input.application_id, contact: input.actor_contact_id });
  const id = input.id ?? crypto.randomUUID();
  await db.insert(grant_application_events).values({
    id, org_id: orgId, application_id: input.application_id, event_type: input.event_type,
    actor_contact_id: input.actor_contact_id ?? null, from_value: input.from_value ?? null,
    to_value: input.to_value ?? null, note: input.note ?? null, metadata: input.metadata ?? null,
    occurred_at: input.occurred_at ? new Date(input.occurred_at) : new Date(),
  });
  return { id, ok: true };
}

export async function listGrantApplicationEvents(orgId: string, applicationId: string) {
  await assertWorkspaceLinks(orgId, { application: applicationId });
  return db.select().from(grant_application_events).where(and(
    eq(grant_application_events.org_id, orgId), eq(grant_application_events.application_id, applicationId),
  )).orderBy(asc(grant_application_events.occurred_at));
}
