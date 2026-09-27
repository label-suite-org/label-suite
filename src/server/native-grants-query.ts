import { createHash } from "node:crypto";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import { budget_projects, grant_applications, grants, grant_deadlines, grant_requirements, grant_application_requirements, documents, contacts, ops_tasks, org_memberships, funding_sources } from "../db/schema";
import { users } from "../db/auth-schema";
import { db, runWithDatabaseContext } from "../lib/db";
import { NotFoundError } from "./errors";
import { getNativeGrantAttachments, nativeGrantApplicationRevision } from "./native-grants";
import { listGrantSupportingDocuments } from "./grant-supporting-documents";
import { listGrantApplicationEvents } from "./grants-workspace-mutations";
import { getNativeProjectDetail } from "./native-events-projects";
import { getGrantReportPack } from "./grant-report-pack";
import { applicationChecklistFor } from "./grants-workspace-core";
import { buildGrantsWorklist } from "./grants-worklist-core";
import { workspaceToday } from "./task-deadlines";

const scopeSchema = z.object({ grant_id: z.string().trim().min(1).optional(), application_id: z.string().trim().min(1).optional(), offset: z.coerce.number().int().nonnegative().default(0), worklist_offset: z.coerce.number().int().nonnegative().default(0) }).strict();
export async function getNativeGrants(orgId: string, actorId: string, raw: unknown) {
  const scope = scopeSchema.parse(raw);
  return runWithDatabaseContext({ orgId, userId: actorId }, async () => {
    const [{ today, fetched_at }] = (await db.execute<{ today: string; fetched_at: string }>(sql`select ${workspaceToday(orgId)}::text as today, transaction_timestamp()::text as fetched_at`)).rows;
    // ponytail: ranking uses the existing tenant-wide worklist builder; move ranking into SQL if tenant volume makes this expensive.
    const [applications, opportunities, projects, requirementRows, applicationRequirements, documentChoices, contactNames, memberNames, fundingNames] = await Promise.all([
      db.select({ ...getTableColumns(grant_applications), revision: nativeGrantApplicationRevision }).from(grant_applications).where(eq(grant_applications.org_id, orgId)),
      db.select({ ...getTableColumns(grants), revision: sql<string>`coalesce(${grants.updated_at}::text, 'unversioned')` }).from(grants).where(eq(grants.org_id, orgId)).orderBy(sql`${grants.deadline} asc nulls last`, grants.id),
      db.select({ id: budget_projects.id, name: budget_projects.name, currency: budget_projects.currency }).from(budget_projects).where(eq(budget_projects.org_id, orgId)),
      db.select().from(grant_requirements).where(eq(grant_requirements.org_id, orgId)),
      db.select().from(grant_application_requirements).where(eq(grant_application_requirements.org_id, orgId)),
      db.select({ id: documents.id, name: documents.name }).from(documents).where(eq(documents.org_id, orgId)),
      db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(eq(contacts.org_id, orgId)),
      db.select({ id: users.id, name: users.name }).from(users).innerJoin(org_memberships, eq(org_memberships.user_id, users.id)).where(eq(org_memberships.org_id, orgId)),
      db.select({ id: funding_sources.id, name: funding_sources.name }).from(funding_sources).where(eq(funding_sources.org_id, orgId)),
    ]);
    const selectedGrant = scope.grant_id ? opportunities.find(grant => grant.id === scope.grant_id) : undefined;
    if (scope.grant_id && !selectedGrant) throw new NotFoundError("Grant opportunity not found");
    const opportunityPage = selectedGrant ? [selectedGrant] : opportunities.slice(scope.offset, scope.offset + 50);
    const rows = applications.filter(application => !scope.grant_id || application.grant_id === scope.grant_id).map((application) => {
      const grant = opportunities.find((item) => item.id === application.grant_id), project = projects.find((item) => item.id === application.project_id);
      return { ...application, grant_id: grant?.id ?? null, project_id: project?.id ?? null,
        name: grant?.name ?? project?.name ?? "Grant application", grant_name: grant?.name ?? null, project_name: project?.name ?? null,
        grant_currency: grant?.currency ?? null, project_currency: project?.currency ?? null,
        owner_contact_name: contactNames.find(row => row.id === application.owner_contact_id)?.name ?? null,
        owner_user_name: memberNames.find(row => row.id === application.owner_user_id)?.name ?? null,
        funding_source_name: fundingNames.find(row => row.id === application.funding_source_id)?.name ?? null,
        currency: grant?.currency ?? project?.currency ?? null, opportunity_deadline: grant?.deadline ?? null,
        checklist: applicationChecklistFor(application, { requirements: requirementRows, applicationRequirements, documents: documentChoices }) };
    });
    const worklist = buildGrantsWorklist({ today, horizonDays: 36500, applications: rows.map((row) => ({
      id: row.id, name: row.name, projectId: row.project_id, projectName: row.project_name, ownerName: null,
      workflowStage: row.workflow_stage, outcome: row.outcome, priority: row.priority, amountRequested: row.amount_requested ?? 0,
      amountAwarded: row.amount_awarded ?? 0, applicationDeadline: row.submission_deadline ?? row.opportunity_deadline, checklist: row.checklist, nextAction: row.next_action,
      nextActionDue: row.next_action_due, reportingDue: row.reporting_due, currency: row.currency ?? undefined,
    })) }).map((item) => ({ ...item, currency: rows.find((row) => row.id === item.applicationId)?.currency ?? null }));
    const order = new Map<string | null, number>();
    worklist.forEach((item, index) => { if (!order.has(item.applicationId)) order.set(item.applicationId, index); });
    rows.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || (a.submission_deadline ?? "9999").localeCompare(b.submission_deadline ?? "9999") || a.id.localeCompare(b.id));
    const page = {
      selected_grant_id: selectedGrant?.id ?? null,
      applications: rows.slice(scope.offset, scope.offset + 50), next_offset: rows.length > scope.offset + 50 ? scope.offset + 50 : null,
      worklist: worklist.slice(scope.worklist_offset, scope.worklist_offset + 100), next_worklist_offset: worklist.length > scope.worklist_offset + 100 ? scope.worklist_offset + 100 : null, fetched_at,
      opportunities: opportunityPage.map((grant) => ({ ...grant,
        verification_age_days: grant.last_verified_at ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(grant.last_verified_at)) / 86400000)) : null,
        // A recorded verification date has no expiry policy; do not infer current freshness from its age.
        freshness: grant.research_status === "stale" ? "stale" : grant.research_status === "needs_review" ? "needs_review" : !grant.last_verified_at ? "unverified" : "unknown",
      })), next_opportunity_offset: !selectedGrant && opportunities.length > scope.offset + 50 ? scope.offset + 50 : null,
    };
    if (!scope.application_id) return { ...page, detail: null };
    const application = rows.find((item) => item.id === scope.application_id);
    if (!application) throw new NotFoundError("Grant application not found");
    const [attachments, evidence, history, requirements, deadlines, context, tasks, report] = await Promise.all([
      getNativeGrantAttachments(orgId, application.id), listGrantSupportingDocuments(orgId, application.id), listGrantApplicationEvents(orgId, application.id),
      application.grant_id ? db.select({ ...getTableColumns(grant_requirements), revision: sql<string>`coalesce(${grant_requirements.updated_at}::text, 'unversioned')` }).from(grant_requirements).where(and(eq(grant_requirements.org_id, orgId), eq(grant_requirements.grant_id, application.grant_id))).orderBy(grant_requirements.sort_order, grant_requirements.id) : [],
      application.grant_id ? db.select({ ...getTableColumns(grant_deadlines), revision: sql<string>`coalesce(${grant_deadlines.updated_at}::text, 'unversioned')` }).from(grant_deadlines).where(and(eq(grant_deadlines.org_id, orgId), eq(grant_deadlines.grant_id, application.grant_id))).orderBy(grant_deadlines.deadline_date, grant_deadlines.id) : [],
      application.project_id ? getNativeProjectDetail(orgId, application.project_id) : null,
      application.grant_id ? db.select({ id: ops_tasks.id, name: ops_tasks.task_name, status: ops_tasks.status, due_date: ops_tasks.due_date }).from(ops_tasks).where(and(eq(ops_tasks.org_id, orgId), eq(ops_tasks.linked_grant_id, application.grant_id))).orderBy(sql`${ops_tasks.due_date} asc nulls last`, ops_tasks.id).limit(51) : [],
      getGrantReportPack(orgId, application.id, { includeDownloadUrls: false }),
    ]);
    return { ...page, detail: {
      application, grant_revision: opportunities.find(grant => grant.id === application.grant_id)?.revision ?? null, requirements, deadlines, history: history.map((event) => ({ ...event, actor_name: contactNames.find((contact) => contact.id === event.actor_contact_id)?.name ?? null })), context_revision: attachments.revision, application_requirements: attachments.requirements.map(row => ({ ...row, document_name: documentChoices.find(document => document.id === row.document_id)?.name ?? null })),
      evidence: evidence.map(({ file_link: _file, extraction_error: error, extracted_text_preview: _text, ...document }) => ({ ...document, extraction_failed: Boolean(error) })),
      report: { ...report, state: "evidence_snapshot", fetched_at, revision: createHash("sha256").update(JSON.stringify({ report, application_revision: application.revision })).digest("hex"), awardAmount: application.amount_awarded, currency: context?.currency ?? null, award_currency: application.currency,
        remainingAward: context?.currency && context.currency === application.currency && application.amount_awarded != null ? report.remainingAward : null },
      relationships: { grant: application.grant_id ? { id: application.grant_id, name: application.grant_name } : null,
        project: application.project_id ? { id: application.project_id, name: application.project_name } : null,
        events: context?.relationships.events ?? [], tasks: tasks.slice(0, 50), assets: context?.relationships.assets ?? [],
        documents: context?.relationships.documents ?? [], budget: context?.relationships.budget ?? [] },
      relationship_scope: { grant: "application", project: "application", events: "project", tasks: "grant", assets: "project", documents: "project", budget: "project" },
      relationship_windows: { ...context?.relationship_windows, tasks: { partial: tasks.length > 50 } },
      payment_execution: false,
    } };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

const choicesSchema = z.object({
  kind: z.enum(["grants", "projects", "contacts", "members", "funding", "documents"]),
  q: z.string().trim().max(120).optional(), cursor: z.string().trim().min(1).optional(), project_id: z.string().trim().min(1).optional(),
}).strict();
export async function getNativeGrantChoices(orgId: string, actorId: string, raw: unknown) {
  const input = choicesSchema.parse(raw);
  return runWithDatabaseContext({ orgId, userId: actorId }, async () => {
    const table = { grants, projects: budget_projects, contacts, members: users, funding: funding_sources, documents }[input.kind];
    const where = and("org_id" in table ? eq(table.org_id, orgId) : sql`exists (select 1 from ${org_memberships} where ${org_memberships.org_id} = ${orgId} and ${org_memberships.user_id} = ${users.id})`,
      input.cursor ? sql`${table.id} > ${input.cursor}` : undefined,
      input.q ? sql`position(lower(${input.q}) in lower(${table.name})) > 0` : undefined,
      input.kind === "funding" && input.project_id ? eq(funding_sources.project_id, input.project_id) : undefined);
    const rows = await db.select({ id: table.id, name: table.name,
      currency: input.kind === "grants" ? grants.currency : input.kind === "projects" ? budget_projects.currency : sql<null>`null`,
      project_id: input.kind === "funding" ? funding_sources.project_id : sql<null>`null`,
    }).from(table).where(where).orderBy(table.id).limit(26);
    return { choices: rows.slice(0, 25), next_cursor: rows.length > 25 ? rows[24].id : null };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
