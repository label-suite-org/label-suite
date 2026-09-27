import { z } from "zod";
import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import {
  artists,
  budget_categories,
  budget_line_items,
  funding_sources,
  budget_projects,
  funding_source_events,
  budget_line_variance_requests,
  releases,
} from "../db/schema";
import { db } from "../lib/db";
import { recordAuditEvent } from "./integrations";
import { ConflictError, NotFoundError } from "./errors";
import { hasOwn, idSchema, nullableNumber, nullableText } from "./validation";

export type BudgetMutationLinkKind = "project" | "budgetLine" | "artist" | "release" | "category" | "fundingSource";
export type BudgetMutationLinkLookup = (orgId: string, kind: BudgetMutationLinkKind, id: string) => Promise<boolean>;

const budgetLinkLabels: Record<BudgetMutationLinkKind, string> = {
  project: "Project",
  budgetLine: "Budget line",
  artist: "Artist",
  release: "Release",
  category: "Budget category",
  fundingSource: "Funding source",
};

export async function assertBudgetMutationLinks(
  orgId: string,
  links: Partial<Record<BudgetMutationLinkKind, string | null | undefined>>,
  lookup: BudgetMutationLinkLookup = lookupBudgetMutationLink,
): Promise<void> {
  for (const [kind, id] of Object.entries(links) as Array<[BudgetMutationLinkKind, string | null | undefined]>) {
    if (!id) continue;
    if (!await lookup(orgId, kind, id)) {
      throw new NotFoundError(`${budgetLinkLabels[kind]} not found in active workspace`);
    }
  }
}

export function assertSameBudgetProject(
  expectedProjectId: string | null | undefined,
  actualProjectId: string | null | undefined,
  label: string,
): void {
  if (!expectedProjectId || !actualProjectId || expectedProjectId !== actualProjectId) {
    throw new NotFoundError(`${label} must belong to the same project`);
  }
}

// ─── Budget line items ──────────────────────────────────
export const updateBudgetLineSchema = z.object({
  id: idSchema,
  planned_amount: nullableNumber().optional(),
  forecast_amount: nullableNumber().optional(),
  committed_amount: nullableNumber().optional(),
  paid_amount: nullableNumber().optional(),
  status: nullableText.optional(),
  lock_status: nullableText.optional(),
  eligibility_tag: nullableText.optional(),
  variance_reason: nullableText.optional(),
  spend_month: nullableText.optional(),
});

export type UpdateBudgetLineInput = z.infer<typeof updateBudgetLineSchema>;

export function canEditBudgetCosts(lockStatus: string | null | undefined, hasApprovedVariance: boolean): boolean {
  return lockStatus !== "locked" && lockStatus !== "approval_required" || hasApprovedVariance;
}

type NativeBudgetWriteContext = { expectedRevision: string; expectedCurrency: string; actorUserId: string };
async function lockBudgetLine(tx: Pick<typeof db, "select">, orgId: string, id: string, native?: NativeBudgetWriteContext) {
  const [current] = await tx.select({ ...getTableColumns(budget_line_items), revision: sql<string>`coalesce(${budget_line_items.updated_at}::text, 'unversioned')` })
    .from(budget_line_items).where(and(eq(budget_line_items.id, id), eq(budget_line_items.org_id, orgId))).limit(1).for("update");
  if (!current) throw new NotFoundError("Budget line not found");
  if (native) {
    if (current.revision !== native.expectedRevision) throw new ConflictError("Budget line changed; refresh and retry");
    const [project] = current.project_id ? await tx.select({ currency: budget_projects.currency }).from(budget_projects)
      .where(and(eq(budget_projects.id, current.project_id), eq(budget_projects.org_id, orgId))).limit(1).for("share") : [];
    if (!project || project.currency !== native.expectedCurrency) throw new ConflictError("Budget currency changed or unavailable; refresh and retry");
  }
  return current;
}

async function writeBudgetLine(orgId: string, input: UpdateBudgetLineInput, native?: NativeBudgetWriteContext) {
  return db.transaction(async (tx) => {
    const current = await lockBudgetLine(tx, orgId, input.id, native);
    const changesCost = ["planned_amount", "forecast_amount", "committed_amount", "paid_amount"].some((field) => hasOwn(input, field));
    if (changesCost && !canEditBudgetCosts(current.lock_status, Boolean((await tx.select({ id: budget_line_variance_requests.id })
      .from(budget_line_variance_requests)
      .where(and(eq(budget_line_variance_requests.org_id, orgId), eq(budget_line_variance_requests.line_id, input.id), eq(budget_line_variance_requests.status, "approved"))).limit(1))[0]))) {
      throw new ConflictError("Locked budget lines require an approved variance request before cost edits");
    }
    const { id, ...fields } = input;
    const [updated] = await tx.update(budget_line_items).set({ ...fields,
      updated_at: sql`greatest(clock_timestamp(), ${budget_line_items.updated_at} + interval '1 microsecond')`,
    }).where(and(eq(budget_line_items.id, id), eq(budget_line_items.org_id, orgId))).returning();
    const { revision: _revision, ...before } = current;
    if (native) await recordAuditEvent(orgId, {
      actor_user_id: native.actorUserId, event_type: "budget_line.updated", object_type: "budget_line", object_id: id,
      before: { ...before, currency: native.expectedCurrency }, after: { ...updated, currency: native.expectedCurrency },
    }, tx);
    return { ok: true, id };
  });
}

export async function updateBudgetLine(orgId: string, input: UpdateBudgetLineInput) {
  return writeBudgetLine(orgId, updateBudgetLineSchema.parse(input));
}

export const nativeUpdateBudgetLineSchema = updateBudgetLineSchema.omit({ lock_status: true }).extend({
  expected_revision: z.string().trim().min(1),
  expected_currency: z.string().trim().min(1),
}).strict().refine((input) => Object.keys(input).some((key) => !["id", "expected_revision", "expected_currency"].includes(key)), "At least one budget field is required");

export async function updateBudgetLineForNative(orgId: string, raw: unknown, actorUserId: string) {
  const { expected_revision, expected_currency, ...input } = nativeUpdateBudgetLineSchema.parse(raw);
  return writeBudgetLine(orgId, input, { expectedRevision: expected_revision, expectedCurrency: expected_currency, actorUserId });
}

export const createBudgetLineSchema = z.object({
  id: idSchema.optional(),
  project_id: idSchema,
  release_id: idSchema.optional(),
  category_id: nullableText.optional(),
  funding_source_id: nullableText.optional(),
  name: z.string().trim().min(1, "name is required"),
  amount: z.number(),
  planned_amount: z.number().optional(),
  forecast_amount: z.number().optional(),
  phase: nullableText.optional(),
  spend_month: nullableText.optional(),
  status: nullableText.optional(),
  lock_status: nullableText.optional(),
  eligibility_tag: nullableText.optional(),
});

export type CreateBudgetLineInput = z.infer<typeof createBudgetLineSchema>;

export async function createBudgetLine(orgId: string, input: CreateBudgetLineInput) {
  await assertBudgetMutationLinks(orgId, {
    project: input.project_id,
    release: input.release_id,
    category: input.category_id,
    fundingSource: input.funding_source_id,
  });
  if (input.funding_source_id) {
    const [source] = await db.select({ project_id: funding_sources.project_id }).from(funding_sources).where(and(
      eq(funding_sources.org_id, orgId),
      eq(funding_sources.id, input.funding_source_id),
    )).limit(1);
    assertSameBudgetProject(input.project_id, source?.project_id, "Funding source and budget line");
  }
  const id = input.id ?? crypto.randomUUID();
  await db.insert(budget_line_items).values({
    id,
    org_id: orgId,
    project_id: input.project_id,
    release_id: input.release_id ?? null,
    category_id: input.category_id ?? null,
    funding_source_id: input.funding_source_id ?? null,
    name: input.name,
    amount: input.amount,
    planned_amount: input.planned_amount ?? input.amount,
    forecast_amount: input.forecast_amount ?? input.amount,
    committed_amount: 0,
    paid_amount: 0,
    phase: input.phase ?? null,
    spend_month: input.spend_month ?? null,
    status: input.status ?? "pending",
    lock_status: input.lock_status ?? "open",
    eligibility_tag: input.eligibility_tag ?? null,
  }).onConflictDoNothing({ target: budget_line_items.id });
  return { ok: true, id };
}

export async function deleteBudgetLine(orgId: string, id: string) {
  const row = await db
    .select({ committed: budget_line_items.committed_amount, paid: budget_line_items.paid_amount })
    .from(budget_line_items)
    .where(and(eq(budget_line_items.id, id), eq(budget_line_items.org_id, orgId)));
  if (!row.length) throw new Error(`Budget line not found: ${id}`);
  if ((row[0].committed ?? 0) > 0 || (row[0].paid ?? 0) > 0) {
    throw new Error("Cannot delete line with committed or paid amounts");
  }
  await db.delete(budget_line_items).where(and(eq(budget_line_items.id, id), eq(budget_line_items.org_id, orgId)));
  return { ok: true };
}

// ─── Funding sources ────────────────────────────────────
export const createFundingSourceSchema = z.object({
  id: idSchema.optional(),
  project_id: idSchema,
  name: z.string().trim().min(1, "name is required"),
  type: z.string().trim().min(1, "type is required"),
  status: z.string().default("pending"),
  amount_planned: z.number().default(0),
  amount_confirmed: z.number().default(0),
  restricted_to: nullableText.optional(),
  funder: nullableText.optional(),
  deadline: nullableText.optional(),
  reporting_required: z.number().min(0).max(1).default(0),
  notes: nullableText.optional(),
});

export type CreateFundingSourceInput = z.infer<typeof createFundingSourceSchema>;

export const updateFundingSourceSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).optional(),
  status: z.string().optional(),
  amount_planned: z.number().optional(),
  amount_confirmed: z.number().optional(),
  restricted_to: nullableText.optional(),
  funder: nullableText.optional(),
  deadline: nullableText.optional(),
  reporting_required: z.number().min(0).max(1).optional(),
  notes: nullableText.optional(),
});

export type UpdateFundingSourceInput = z.infer<typeof updateFundingSourceSchema>;

export async function createFundingSource(orgId: string, input: CreateFundingSourceInput) {
  await assertBudgetMutationLinks(orgId, { project: input.project_id });
  const id = input.id ?? crypto.randomUUID();
  await db.insert(funding_sources).values({
    id,
    org_id: orgId,
    project_id: input.project_id,
    name: input.name,
    type: input.type,
    status: input.status,
    amount_planned: input.amount_planned,
    amount_confirmed: input.amount_confirmed,
    restricted_to: input.restricted_to ?? null,
    funder: input.funder ?? null,
    deadline: input.deadline ?? null,
    reporting_required: input.reporting_required,
    notes: input.notes ?? null,
  }).onConflictDoNothing({ target: funding_sources.id });
  return { ok: true, id };
}

export async function updateFundingSource(orgId: string, input: UpdateFundingSourceInput) {
  const updates: Partial<typeof funding_sources.$inferInsert> = {};
  if (hasOwn(input, "name")) updates.name = input.name as string;
  if (hasOwn(input, "type")) updates.type = input.type as string;
  if (hasOwn(input, "status")) updates.status = input.status as string;
  if (hasOwn(input, "amount_planned")) updates.amount_planned = input.amount_planned as number;
  if (hasOwn(input, "amount_confirmed")) updates.amount_confirmed = input.amount_confirmed as number;
  if (hasOwn(input, "restricted_to")) updates.restricted_to = input.restricted_to as string | null;
  if (hasOwn(input, "funder")) updates.funder = input.funder as string | null;
  if (hasOwn(input, "deadline")) updates.deadline = input.deadline as string | null;
  if (hasOwn(input, "reporting_required")) updates.reporting_required = input.reporting_required as number;
  if (hasOwn(input, "notes")) updates.notes = input.notes as string | null;
  updates.updated_at = new Date();

  const updated = await db
    .update(funding_sources)
    .set(updates)
    .where(and(eq(funding_sources.id, input.id), eq(funding_sources.org_id, orgId)))
    .returning({ id: funding_sources.id });
  if (!updated.length) throw new Error(`Funding source not found: ${input.id}`);
  return { ok: true };
}

export async function deleteFundingSource(orgId: string, id: string) {
  const result = await db
    .delete(funding_sources)
    .where(and(eq(funding_sources.id, id), eq(funding_sources.org_id, orgId)))
    .returning({ id: funding_sources.id });
  if (!result.length) throw new Error(`Funding source not found: ${id}`);
  return { ok: true };
}

// ─── Budget projects ────────────────────────────────────
export const createBudgetProjectSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1, "name is required"),
  artist_id: nullableText.optional(),
  release_id: nullableText.optional(),
  status: z.string().default("planning"),
  currency: z.string().default("DKK"),
  total_planned: z.number().default(0),
  baseline_funding: z.number().default(0),
  track_count: nullableNumber().optional(),
  singles_count: nullableNumber().optional(),
  notes: nullableText.optional(),
});

export type CreateBudgetProjectInput = z.infer<typeof createBudgetProjectSchema>;

export const updateBudgetProjectSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).optional(),
  artist_id: nullableText.optional(),
  release_id: nullableText.optional(),
  status: z.string().optional(),
  currency: z.string().optional(),
  total_planned: z.number().optional(),
  baseline_funding: z.number().optional(),
  track_count: nullableNumber().optional(),
  singles_count: nullableNumber().optional(),
  notes: nullableText.optional(),
});

export type UpdateBudgetProjectInput = z.infer<typeof updateBudgetProjectSchema>;

export async function createBudgetProject(orgId: string, input: CreateBudgetProjectInput) {
  await assertBudgetMutationLinks(orgId, { artist: input.artist_id, release: input.release_id });
  const id = input.id ?? crypto.randomUUID();
  await db.insert(budget_projects).values({
    id,
    org_id: orgId,
    name: input.name,
    artist_id: input.artist_id ?? null,
    release_id: input.release_id ?? null,
    status: input.status,
    currency: input.currency,
    total_planned: input.total_planned,
    baseline_funding: input.baseline_funding,
    track_count: input.track_count ?? null,
    singles_count: input.singles_count ?? null,
    notes: input.notes ?? null,
  }).onConflictDoNothing({ target: budget_projects.id });
  return { ok: true, id };
}

export async function updateBudgetProject(orgId: string, input: UpdateBudgetProjectInput) {
  await assertBudgetMutationLinks(orgId, { artist: input.artist_id, release: input.release_id });
  const updates: Partial<typeof budget_projects.$inferInsert> = {};
  if (hasOwn(input, "name")) updates.name = input.name as string;
  if (hasOwn(input, "artist_id")) updates.artist_id = input.artist_id as string | null;
  if (hasOwn(input, "release_id")) updates.release_id = input.release_id as string | null;
  if (hasOwn(input, "status")) updates.status = input.status as string;
  if (hasOwn(input, "currency")) updates.currency = input.currency as string;
  if (hasOwn(input, "total_planned")) updates.total_planned = input.total_planned as number;
  if (hasOwn(input, "baseline_funding")) updates.baseline_funding = input.baseline_funding as number;
  if (hasOwn(input, "track_count")) updates.track_count = input.track_count as number | null;
  if (hasOwn(input, "singles_count")) updates.singles_count = input.singles_count as number | null;
  if (hasOwn(input, "notes")) updates.notes = input.notes as string | null;
  updates.updated_at = new Date();

  const updated = await db
    .update(budget_projects)
    .set(updates)
    .where(and(eq(budget_projects.id, input.id), eq(budget_projects.org_id, orgId)))
    .returning({ id: budget_projects.id });
  if (!updated.length) throw new Error(`Budget project not found: ${input.id}`);
  return { ok: true };
}

async function lookupBudgetMutationLink(
  orgId: string,
  kind: BudgetMutationLinkKind,
  id: string,
): Promise<boolean> {
  const [table, idColumn] = {
    project: [budget_projects, budget_projects.id],
    budgetLine: [budget_line_items, budget_line_items.id],
    artist: [artists, artists.id],
    release: [releases, releases.id],
    category: [budget_categories, budget_categories.id],
    fundingSource: [funding_sources, funding_sources.id],
  }[kind] as [typeof budget_projects, typeof budget_projects.id];
  const rows = await db.select({ id: idColumn }).from(table).where(and(
    eq(table.org_id, orgId),
    eq(idColumn, id),
  )).limit(1);
  return rows.length > 0;
}

// ─── Funding source status transitions ─────────────────
export const updateFundingSourceStatusSchema = z.object({
  id: idSchema,
  status: z.string().trim().min(1, "status is required"),
  notes: nullableText.optional(),
});

export type UpdateFundingSourceStatusInput = z.infer<typeof updateFundingSourceStatusSchema>;

export async function updateFundingSourceStatus(orgId: string, input: UpdateFundingSourceStatusInput) {
  const rows = await db
    .select({ status: funding_sources.status })
    .from(funding_sources)
    .where(and(eq(funding_sources.id, input.id), eq(funding_sources.org_id, orgId)));
  if (!rows.length) throw new Error(`Funding source not found: ${input.id}`);
  
  const fromStatus = rows[0].status;
  const toStatus = input.status;
  
  const updates: Record<string, unknown> = { status: toStatus, updated_at: new Date() };

  await db.transaction(async (tx) => {
    await tx.update(funding_sources)
      .set(updates)
      .where(and(eq(funding_sources.id, input.id), eq(funding_sources.org_id, orgId)));
    
    await tx.insert(funding_source_events).values({
      id: crypto.randomUUID(),
      org_id: orgId,
      funding_source_id: input.id,
      from_status: fromStatus,
      to_status: toStatus,
      occurred_at: new Date(),
      note: input.notes ?? null,
    });
  });

  return { ok: true, from_status: fromStatus, to_status: toStatus };
}

export async function getFundingSourceHistory(orgId: string, fundingSourceId: string) {
  return db
    .select()
    .from(funding_source_events)
    .where(and(
      eq(funding_source_events.funding_source_id, fundingSourceId),
      eq(funding_source_events.org_id, orgId),
    ))
    .orderBy(desc(funding_source_events.occurred_at));
}

// ─── Grant summary ─────────────────────────────────────
export async function getGrantSummary(orgId: string, projectId: string) {
  const sources = await db
    .select({
      status: funding_sources.status,
      amount_planned: funding_sources.amount_planned,
      amount_confirmed: funding_sources.amount_confirmed,
    })
    .from(funding_sources)
    .where(and(
      eq(funding_sources.project_id, projectId),
      eq(funding_sources.org_id, orgId),
      eq(funding_sources.type, "grant"),
    ));

  const counts: Record<string, number> = {};
  let totalApplied = 0;
  let totalGranted = 0;

  for (const s of sources) {
    const status: string = s.status ?? "unknown";
    counts[status] = (counts[status] ?? 0) + 1;
    if (status === "applied" || status === "granted") {
      totalApplied += s.amount_planned ?? 0;
    }
    if (status === "granted") {
      totalGranted += s.amount_confirmed ?? 0;
    }
  }

  return { counts, totalApplied, totalGranted };
}

// ─── Variance requests ─────────────────────────────────
export const createVarianceRequestSchema = z.object({
  line_id: idSchema,
  variance_reason: z.string().trim().min(1, "variance_reason is required"),
  requested_action: z.enum(["increase_amount", "unlock_contingency", "change_status"]),
  current_value: z.string().optional(),
  requested_value: z.string().optional(),
});

export type CreateVarianceRequestInput = z.infer<typeof createVarianceRequestSchema>;

async function writeVarianceRequest(orgId: string, input: CreateVarianceRequestInput, userId?: string, native?: NativeBudgetWriteContext) {
  return db.transaction(async (tx) => {
    const line = await lockBudgetLine(tx, orgId, input.line_id, native);
    const id = crypto.randomUUID();
    const [request] = await tx.insert(budget_line_variance_requests).values({
      id, org_id: orgId, line_id: input.line_id, requested_by_user_id: userId ?? null,
      requested_action: input.requested_action,
      current_value: native ? JSON.stringify({ amount: line.amount, planned_amount: line.planned_amount, forecast_amount: line.forecast_amount, committed_amount: line.committed_amount, paid_amount: line.paid_amount, status: line.status, lock_status: line.lock_status, currency: native.expectedCurrency }) : input.current_value ?? null,
      requested_value: input.requested_value ?? null, variance_reason: input.variance_reason, status: "pending",
    }).returning();
    await tx.update(budget_line_items).set({ variance_reason: input.variance_reason,
      updated_at: sql`greatest(clock_timestamp(), ${budget_line_items.updated_at} + interval '1 microsecond')`,
    }).where(and(eq(budget_line_items.id, input.line_id), eq(budget_line_items.org_id, orgId)));
    if (native) await recordAuditEvent(orgId, { actor_user_id: userId, event_type: "budget_variance.proposed", object_type: "budget_variance", object_id: id, before: null, after: { ...request, currency: native.expectedCurrency } }, tx);
    return { ok: true, id };
  });
}

export async function createVarianceRequest(orgId: string, input: CreateVarianceRequestInput, userId?: string) {
  return writeVarianceRequest(orgId, createVarianceRequestSchema.parse(input), userId);
}

const nativeVarianceBase = createVarianceRequestSchema.omit({ current_value: true, requested_value: true, requested_action: true }).extend({
  expected_revision: z.string().trim().min(1), expected_currency: z.string().trim().min(1), requested_currency: z.string().trim().min(1),
});
export const nativeCreateVarianceRequestSchema = z.discriminatedUnion("requested_action", [
  nativeVarianceBase.extend({ requested_action: z.literal("increase_amount"), requested_amount: z.number().finite().nonnegative() }).strict(),
  nativeVarianceBase.extend({ requested_action: z.literal("change_status"), requested_status: z.enum(["pending", "approved", "paid"]) }).strict(),
  nativeVarianceBase.extend({ requested_action: z.literal("unlock_contingency") }).strict(),
]).refine((input) => input.requested_currency === input.expected_currency, "Proposed currency must match the displayed budget currency");
export async function createVarianceRequestForNative(orgId: string, raw: unknown, actorUserId: string) {
  const input = nativeCreateVarianceRequestSchema.parse(raw);
  const requested_value = JSON.stringify({ currency: input.requested_currency,
    ...(input.requested_action === "increase_amount" ? { amount: input.requested_amount }
      : input.requested_action === "change_status" ? { status: input.requested_status } : { lock_status: "open" }),
  });
  return writeVarianceRequest(orgId, { line_id: input.line_id, variance_reason: input.variance_reason, requested_action: input.requested_action, requested_value }, actorUserId,
    { expectedRevision: input.expected_revision, expectedCurrency: input.expected_currency, actorUserId });
}

export async function listVarianceRequests(orgId: string, scope: string | { lineId: string }) {
  return db
    .select({
      id: budget_line_variance_requests.id,
      line_id: budget_line_variance_requests.line_id,
      line_name: budget_line_items.name,
      revision: budgetVarianceRevision,
      requested_by_user_id: budget_line_variance_requests.requested_by_user_id,
      requested_action: budget_line_variance_requests.requested_action,
      current_value: budget_line_variance_requests.current_value,
      requested_value: budget_line_variance_requests.requested_value,
      variance_reason: budget_line_variance_requests.variance_reason,
      status: budget_line_variance_requests.status,
      reviewed_by_user_id: budget_line_variance_requests.reviewed_by_user_id,
      reviewed_at: budget_line_variance_requests.reviewed_at,
      review_note: budget_line_variance_requests.review_note,
      created_at: budget_line_variance_requests.created_at,
      planned_amount: budget_line_items.planned_amount,
      forecast_amount: budget_line_items.forecast_amount,
      lock_status: budget_line_items.lock_status,
    })
    .from(budget_line_variance_requests)
    .innerJoin(budget_line_items, and(
      eq(budget_line_variance_requests.line_id, budget_line_items.id),
      eq(budget_line_items.org_id, orgId),
    ))
    .where(and(
      eq(budget_line_variance_requests.org_id, orgId),
      typeof scope === "string" ? eq(budget_line_items.project_id, scope) : eq(budget_line_items.id, scope.lineId),
    ))
    .orderBy(budget_line_variance_requests.created_at);
}

const approveRejectSchema = z.object({
  id: idSchema,
  review_note: nullableText.optional(),
});

export function nativeVarianceDecisionBlocker(request: { requested_action: string; requested_value: string | null; current_value: string | null }, currency: string | null): string | null {
  if (!currency) return "Budget currency is not recorded. Set it in the web workspace before reviewing this proposal.";
  try {
    const current = z.object({ amount: z.number().finite(), planned_amount: z.number().nullable(), forecast_amount: z.number().nullable(), committed_amount: z.number().nullable(), paid_amount: z.number().nullable(), status: z.string().nullable(), lock_status: z.string().nullable(), currency: z.literal(currency) }).parse(JSON.parse(request.current_value ?? "null"));
    const value = JSON.parse(request.requested_value ?? "null");
    const base = z.object({ currency: z.literal(current.currency) });
    if (request.requested_action === "increase_amount") base.extend({ amount: z.number().finite().nonnegative() }).strict().parse(value);
    else if (request.requested_action === "change_status") base.extend({ status: z.enum(["pending", "approved", "paid"]) }).strict().parse(value);
    else if (request.requested_action === "unlock_contingency") base.extend({ lock_status: z.literal("open") }).strict().parse(value);
    else return "Unsupported variance action";
    return null;
  } catch { return "This proposal lacks verified amount and currency context. Review it in the web workspace."; }
}

export const budgetVarianceRevision = sql<string>`md5(jsonb_build_array(
  ${budget_line_variance_requests.id}, ${budget_line_variance_requests.line_id}, ${budget_line_variance_requests.requested_action},
  ${budget_line_variance_requests.current_value}, ${budget_line_variance_requests.requested_value}, ${budget_line_variance_requests.variance_reason},
  ${budget_line_variance_requests.status}, ${budget_line_variance_requests.created_at}, ${budget_line_variance_requests.reviewed_at},
  ${budget_line_variance_requests.review_note}, ${budget_line_variance_requests.requested_by_user_id}, ${budget_line_variance_requests.reviewed_by_user_id}
)::text)`;

async function decideVarianceRequest(orgId: string, input: z.infer<typeof approveRejectSchema>, status: "approved" | "rejected", userId?: string, native?: NativeBudgetWriteContext & { requestRevision: string }) {
  return db.transaction(async (tx) => {
    const [request] = await tx.select({ ...getTableColumns(budget_line_variance_requests), revision: budgetVarianceRevision })
      .from(budget_line_variance_requests).where(and(eq(budget_line_variance_requests.id, input.id), eq(budget_line_variance_requests.org_id, orgId))).limit(1).for("update");
    if (!request) throw new NotFoundError("Variance request not found");
    if (request.status !== "pending" || native && request.revision !== native.requestRevision) throw new ConflictError("Variance request changed; refresh and retry");
    if (native) {
      const blocker = nativeVarianceDecisionBlocker(request, native.expectedCurrency);
      if (blocker) throw new ConflictError(blocker);
      await lockBudgetLine(tx, orgId, request.line_id, native);
    }
    const [updated] = await tx.update(budget_line_variance_requests).set({ status, reviewed_by_user_id: userId ?? null, reviewed_at: new Date(), review_note: input.review_note ?? null })
      .where(and(eq(budget_line_variance_requests.id, input.id), eq(budget_line_variance_requests.org_id, orgId), eq(budget_line_variance_requests.status, "pending"))).returning();
    const { revision: _revision, ...before } = request;
    if (native) await recordAuditEvent(orgId, { actor_user_id: userId, event_type: `budget_variance.${status}`, object_type: "budget_variance", object_id: request.id,
      before: { ...before, currency: native.expectedCurrency }, after: { ...updated, currency: native.expectedCurrency },
    }, tx);
    return { ok: true };
  });
}

export async function approveVarianceRequest(orgId: string, input: z.infer<typeof approveRejectSchema>, userId?: string) {
  return decideVarianceRequest(orgId, approveRejectSchema.parse(input), "approved", userId);
}
export async function rejectVarianceRequest(orgId: string, input: z.infer<typeof approveRejectSchema>, userId?: string) {
  return decideVarianceRequest(orgId, approveRejectSchema.parse(input), "rejected", userId);
}
export const nativeDecideVarianceSchema = approveRejectSchema.extend({
  decision: z.enum(["approved", "rejected"]), expected_request_revision: z.string().trim().min(1),
  expected_revision: z.string().trim().min(1), expected_currency: z.string().trim().min(1),
}).strict();
export async function decideVarianceRequestForNative(orgId: string, raw: unknown, actorUserId: string) {
  const { decision, expected_request_revision, expected_revision, expected_currency, ...input } = nativeDecideVarianceSchema.parse(raw);
  return decideVarianceRequest(orgId, input, decision, actorUserId, { expectedRevision: expected_revision, expectedCurrency: expected_currency, actorUserId, requestRevision: expected_request_revision });
}
