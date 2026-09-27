import { createHash } from "node:crypto";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import { budget_projects, grants, grant_applications, grant_application_requirements, grant_application_documents, grant_requirements, grant_deadlines } from "../db/schema";
import { db, runWithDatabaseContext } from "../lib/db";
import { ConflictError, NotFoundError } from "./errors";
import { createGrantApplication, createGrantApplicationSchema, updateGrantApplication } from "./grants";
import { isAwardedOutcome } from "./grants-money-model-core";
import { replaceGrantApplicationRequirements, replaceGrantApplicationRequirementsSchema, createGrantRequirement, createGrantRequirementSchema, createGrantDeadline, createGrantDeadlineSchema } from "./grants-workspace-mutations";
import { linkGrantSupportingDocument, unlinkGrantSupportingDocument } from "./grant-supporting-documents";
import { grantDocumentRoleSchema } from "./grant-document-roles";
import { recordAuditEvent } from "./integrations";

export const nativeGrantApplicationRevision = sql<string>`coalesce(${grant_applications.updated_at}::text, 'unversioned')`;
const applicationFields = createGrantApplicationSchema.omit({ id: true }).extend({
  status: z.string().trim().min(1).optional(),
  amount_requested: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER / 100).multipleOf(0.01).nullable().optional(),
  amount_awarded: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER / 100).multipleOf(0.01).nullable().optional(),
  submission_deadline: z.iso.date().nullable().optional(),
  submitted_at: z.iso.datetime({ offset: true }).nullable().optional(),
  decision_date: z.iso.date().nullable().optional(),
  reporting_due: z.iso.date().nullable().optional(),
  next_action_due: z.iso.date().nullable().optional(),
});
const expectedCurrency = z.string().regex(/^[A-Z]{3}$/).optional();
export const nativeCreateGrantApplicationSchema = applicationFields.extend({ expected_currency: expectedCurrency }).strict();
export const nativeUpdateGrantApplicationSchema = applicationFields.partial().extend({
  id: z.string().trim().min(1), expected_revision: z.string().trim().min(1), expected_currency: expectedCurrency,
}).strict().refine((input) => Object.keys(input).some((key) => !["id", "expected_revision", "expected_currency"].includes(key)), "At least one application field is required");

async function validateApplicationMoney(orgId: string, expected: string | undefined, application: {
  grant_id?: string | null; project_id?: string | null; amount_requested?: number | null; amount_awarded?: number | null; outcome?: string | null;
}) {
  if (application.amount_requested == null && application.amount_awarded == null && !["approved", "partially_approved"].includes(application.outcome ?? "")) return;
  const [grant] = application.grant_id ? await db.select({ currency: grants.currency }).from(grants)
    .where(and(eq(grants.org_id, orgId), eq(grants.id, application.grant_id))).for("share") : [];
  const [project] = application.project_id ? await db.select({ currency: budget_projects.currency }).from(budget_projects)
    .where(and(eq(budget_projects.org_id, orgId), eq(budget_projects.id, application.project_id))).for("share") : [];
  const currency = grant?.currency ?? project?.currency;
  if (!expected || currency !== expected) throw new ConflictError("Grant currency changed or unavailable; refresh before saving amounts");
  if (["approved", "partially_approved"].includes(application.outcome ?? "") && application.project_id && project?.currency !== currency)
    throw new ConflictError("Grant award and project currencies differ; resolve the funding relationship before recording the award");
}

export async function createNativeGrantApplication(orgId: string, actorId: string, raw: unknown) {
  const { expected_currency, ...input } = nativeCreateGrantApplicationSchema.parse(raw);
  return runWithDatabaseContext({ orgId, userId: actorId }, async () => {
    await validateApplicationMoney(orgId, expected_currency, input);
    const result = await createGrantApplication(orgId, input);
    if (isAwardedOutcome(input.outcome)) await updateGrantApplication(orgId, { ...input, id: result.id, amount_awarded: input.amount_awarded ?? null });
    const [after] = await db.select().from(grant_applications).where(and(eq(grant_applications.org_id, orgId), eq(grant_applications.id, result.id)));
    await recordAuditEvent(orgId, { actor_user_id: actorId, event_type: "grant_application.created", object_type: "grant_application", object_id: result.id, before: null, after });
    return result;
  });
}

export async function updateNativeGrantApplication(orgId: string, actorId: string, raw: unknown) {
  const { expected_revision, expected_currency, ...input } = nativeUpdateGrantApplicationSchema.parse(raw);
  return runWithDatabaseContext({ orgId, userId: actorId }, async () => {
    const [before] = await db.select({ ...getTableColumns(grant_applications), revision: nativeGrantApplicationRevision })
      .from(grant_applications).where(and(eq(grant_applications.org_id, orgId), eq(grant_applications.id, input.id))).for("update");
    if (!before) throw new NotFoundError("Grant application not found");
    if (before.revision !== expected_revision) throw new ConflictError("Grant application changed; refresh before saving");
    const moneyFields = ["amount_requested", "amount_awarded", "outcome", "grant_id", "project_id", "funding_source_id", "reporting_due"];
    if (moneyFields.some((key) => Object.hasOwn(input, key))) {
      // Validate both contexts so clearing values or moving an application cannot silently reinterpret money.
      await validateApplicationMoney(orgId, expected_currency, before);
      await validateApplicationMoney(orgId, expected_currency, { ...before, ...input });
    }
    await updateGrantApplication(orgId, input);
    // Keep an exact, monotonic token even for legacy timestamps or rapid sequential edits.
    const [after] = await db.update(grant_applications).set({ updated_at: sql`greatest(clock_timestamp(), nullif(${expected_revision}, 'unversioned')::timestamp + interval '1 microsecond')` })
      .where(and(eq(grant_applications.org_id, orgId), eq(grant_applications.id, input.id))).returning();
    const { revision: _revision, ...previous } = before;
    await recordAuditEvent(orgId, { actor_user_id: actorId, event_type: "grant_application.updated", object_type: "grant_application", object_id: input.id, before: previous, after });
    return { ok: true, id: input.id };
  });
}

export async function getNativeGrantAttachments(orgId: string, applicationId: string) {
  const requirements = await db.select().from(grant_application_requirements)
    .where(and(eq(grant_application_requirements.org_id, orgId), eq(grant_application_requirements.application_id, applicationId))).orderBy(grant_application_requirements.id);
  const evidence = await db.select().from(grant_application_documents)
    .where(and(eq(grant_application_documents.org_id, orgId), eq(grant_application_documents.application_id, applicationId))).orderBy(grant_application_documents.id);
  return { requirements, evidence, revision: createHash("sha256").update(JSON.stringify({ requirements, evidence })).digest("hex") };
}

const attachmentGuard = { application_id: z.string().trim().min(1), expected_revision: z.string().trim().min(1), expected_context_revision: z.string().regex(/^[a-f0-9]{64}$/) };
export const nativeGrantAttachmentsSchema = z.discriminatedUnion("action", [
  z.object({ ...attachmentGuard, action: z.literal("replace_requirements"), requirements: replaceGrantApplicationRequirementsSchema.shape.requirements }).strict(),
  z.object({ ...attachmentGuard, action: z.literal("link_evidence"), document_id: z.string().trim().min(1), asset_role: grantDocumentRoleSchema, required: z.boolean(), readiness_status: z.enum(["missing", "draft", "ready", "stale", "not_required"]) }).strict(),
  z.object({ ...attachmentGuard, action: z.literal("unlink_evidence"), link_id: z.string().trim().min(1) }).strict(),
]);

export async function mutateNativeGrantAttachments(orgId: string, actorId: string, raw: unknown) {
  const input = nativeGrantAttachmentsSchema.parse(raw);
  return runWithDatabaseContext({ orgId, userId: actorId }, async () => {
    const [application] = await db.select({ revision: nativeGrantApplicationRevision }).from(grant_applications)
      .where(and(eq(grant_applications.org_id, orgId), eq(grant_applications.id, input.application_id))).for("update");
    if (!application) throw new NotFoundError("Grant application not found");
    if (application.revision !== input.expected_revision) throw new ConflictError("Grant application changed; refresh before saving");
    await db.select({ id: grant_application_requirements.id }).from(grant_application_requirements)
      .where(and(eq(grant_application_requirements.org_id, orgId), eq(grant_application_requirements.application_id, input.application_id))).for("update");
    await db.select({ id: grant_application_documents.id }).from(grant_application_documents)
      .where(and(eq(grant_application_documents.org_id, orgId), eq(grant_application_documents.application_id, input.application_id))).for("update");
    const before = await getNativeGrantAttachments(orgId, input.application_id);
    if (before.revision !== input.expected_context_revision) throw new ConflictError("Grant requirements or evidence changed; refresh before saving");
    if (input.action === "replace_requirements") await replaceGrantApplicationRequirements(orgId, { application_id: input.application_id, requirements: input.requirements });
    else if (input.action === "link_evidence") await linkGrantSupportingDocument(orgId, input.application_id, { document_id: input.document_id, asset_role: input.asset_role, required: input.required, readiness_status: input.readiness_status });
    else await unlinkGrantSupportingDocument(orgId, input.application_id, input.link_id);
    const after = await getNativeGrantAttachments(orgId, input.application_id);
    await recordAuditEvent(orgId, { actor_user_id: actorId, event_type: `grant_application.${input.action}`, object_type: "grant_application", object_id: input.application_id, before, after });
    return { ok: true, id: input.application_id, context_revision: after.revision };
  });
}


const catalogGuard = { grant_id: z.string().trim().min(1), expected_grant_revision: z.string().trim().min(1) };
const requirementFields = createGrantRequirementSchema.omit({ id: true, grant_id: true });
const deadlineFields = createGrantDeadlineSchema.omit({ id: true, grant_id: true }).extend({
  deadline_date: z.iso.date(), opens_on: z.iso.date().nullable().optional(), expected_response_date: z.iso.date().nullable().optional(),
});
export const nativeGrantCatalogSchema = z.discriminatedUnion("action", [
  z.object({ ...catalogGuard, action: z.literal("create_requirement"), fields: requirementFields.strict() }).strict(),
  z.object({ ...catalogGuard, action: z.literal("create_deadline"), fields: deadlineFields.strict() }).strict(),
  z.object({ ...catalogGuard, action: z.literal("update_requirement"), id: z.string().trim().min(1), expected_revision: z.string().trim().min(1), fields: requirementFields.partial().strict().refine(value => Object.keys(value).length > 0) }).strict(),
  z.object({ ...catalogGuard, action: z.literal("update_deadline"), id: z.string().trim().min(1), expected_revision: z.string().trim().min(1), fields: deadlineFields.partial().strict().refine(value => Object.keys(value).length > 0) }).strict(),
]);
export async function mutateNativeGrantCatalog(orgId: string, actorId: string, raw: unknown) {
  const input = nativeGrantCatalogSchema.parse(raw);
  return runWithDatabaseContext({ orgId, userId: actorId }, async () => {
    const [grant] = await db.select({ revision: sql<string>`coalesce(${grants.updated_at}::text, 'unversioned')` }).from(grants)
      .where(and(eq(grants.org_id, orgId), eq(grants.id, input.grant_id))).for("update");
    if (!grant) throw new NotFoundError("Grant not found");
    if (grant.revision !== input.expected_grant_revision) throw new ConflictError("Grant changed; refresh before saving its requirements or deadlines");
    const table = input.action.endsWith("requirement") ? grant_requirements : grant_deadlines;
    let before: Record<string, unknown> | null = null;
    let id: string;
    if (input.action === "create_requirement") id = (await createGrantRequirement(orgId, { ...input.fields, grant_id: input.grant_id })).id;
    else if (input.action === "create_deadline") id = (await createGrantDeadline(orgId, { ...input.fields, grant_id: input.grant_id })).id;
    else {
      id = input.id;
      const [row] = await db.select({ ...getTableColumns(table), revision: sql<string>`coalesce(${table.updated_at}::text, 'unversioned')` }).from(table)
        .where(and(eq(table.org_id, orgId), eq(table.grant_id, input.grant_id), eq(table.id, id))).for("update");
      if (!row) throw new NotFoundError("Grant requirement or deadline not found");
      if (row.revision !== input.expected_revision) throw new ConflictError("Grant requirement or deadline changed; refresh before saving");
      const { revision: _revision, ...previous } = row;
      before = previous;
      await db.update(table).set({ ...input.fields, updated_at: sql`greatest(clock_timestamp(), nullif(${input.expected_revision}, 'unversioned')::timestamp + interval '1 microsecond')` })
        .where(and(eq(table.org_id, orgId), eq(table.grant_id, input.grant_id), eq(table.id, id)));
    }
    const [after] = await db.select().from(table).where(and(eq(table.org_id, orgId), eq(table.id, id)));
    // Advance the parent token so retrying an additive creation cannot silently create a second row.
    await db.update(grants).set({ updated_at: sql`greatest(clock_timestamp(), nullif(${grant.revision}, 'unversioned')::timestamp + interval '1 microsecond')` })
      .where(and(eq(grants.org_id, orgId), eq(grants.id, input.grant_id)));
    await recordAuditEvent(orgId, { actor_user_id: actorId, event_type: `grant.${input.action}`, object_type: input.action.endsWith("requirement") ? "grant_requirement" : "grant_deadline", object_id: id, before, after });
    return { id, ok: true };
  });
}
