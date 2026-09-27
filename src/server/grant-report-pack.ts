import { and, eq } from "drizzle-orm";
import {
  budget_categories,
  budget_line_documents,
  budget_line_items,
  budget_projects,
  documents,
  funding_sources,
  funding_need_budget_lines,
  funding_needs,
  grant_application_funding_needs,
  grant_applications,
} from "../db/schema";
import { db } from "../lib/db";
import { NotFoundError } from "./errors";
import { createDownloadUrl } from "./storage";
import { buildGrantReportPack, type GrantReportPack } from "./grant-report-pack-core";

export async function getGrantReportPack(orgId: string, applicationId: string, options: { includeDownloadUrls?: boolean } = {}): Promise<GrantReportPack & { projectName: string | null; restrictedTo: string | null; reportingDue: string | null }> {
  const [application] = await db.select({
    id: grant_applications.id,
    amount_awarded: grant_applications.amount_awarded,
    reporting_due: grant_applications.reporting_due,
    project_name: budget_projects.name,
    restricted_to: funding_sources.restricted_to,
  }).from(grant_applications)
    .leftJoin(budget_projects, and(eq(grant_applications.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
    .leftJoin(funding_sources, and(eq(grant_applications.funding_source_id, funding_sources.id), eq(funding_sources.org_id, orgId)))
    .where(and(eq(grant_applications.org_id, orgId), eq(grant_applications.id, applicationId))).limit(1);
  if (!application) throw new NotFoundError("Grant application not found");

  const rows = await db.select({
    line_id: budget_line_items.id,
    line_name: budget_line_items.name,
    category_type: budget_categories.type,
    category_name: budget_categories.name,
    planned_amount: budget_line_items.planned_amount,
    amount: budget_line_items.amount,
    committed_amount: budget_line_items.committed_amount,
    paid_amount: budget_line_items.paid_amount,
    document_id: documents.id,
    document_name: documents.name,
    document_file_link: documents.file_link,
    document_link_type: budget_line_documents.link_type,
  }).from(grant_application_funding_needs)
    .innerJoin(funding_needs, and(
      eq(grant_application_funding_needs.funding_need_id, funding_needs.id),
      eq(funding_needs.org_id, orgId),
    ))
    .innerJoin(funding_need_budget_lines, and(
      eq(funding_need_budget_lines.funding_need_id, funding_needs.id),
      eq(funding_need_budget_lines.org_id, orgId),
    ))
    .innerJoin(budget_line_items, and(
      eq(funding_need_budget_lines.budget_line_id, budget_line_items.id),
      eq(budget_line_items.org_id, orgId),
    ))
    .leftJoin(budget_categories, and(
      eq(budget_line_items.category_id, budget_categories.id),
      eq(budget_categories.org_id, orgId),
    ))
    .leftJoin(budget_line_documents, and(
      eq(budget_line_documents.budget_line_item_id, budget_line_items.id),
      eq(budget_line_documents.org_id, orgId),
    ))
    .leftJoin(documents, and(
      eq(budget_line_documents.document_id, documents.id),
      eq(documents.org_id, orgId),
    ))
    .where(and(
      eq(grant_application_funding_needs.application_id, applicationId),
      eq(grant_application_funding_needs.org_id, orgId),
    ));

  const byLine = new Map<string, {
    id: string; name: string; category: string | null; planned: number; committed: number; paid: number;
    documents: Array<{ id: string; name: string; linkType: string; downloadUrl: string | null }>;
  }>();
  for (const row of rows) {
    const line = byLine.get(row.line_id) ?? {
      id: row.line_id,
      name: row.line_name,
      category: row.category_type ?? row.category_name ?? null,
      planned: Number(row.planned_amount ?? row.amount ?? 0),
      committed: Number(row.committed_amount ?? 0),
      paid: Number(row.paid_amount ?? 0),
      documents: [],
    };
    if (row.document_id && row.document_name && !line.documents.some((document) => document.id === row.document_id)) {
      line.documents.push({
        id: row.document_id,
        name: row.document_name,
        linkType: row.document_link_type ?? "document",
        downloadUrl: options.includeDownloadUrls === false ? null : await resolveReportDocumentUrl(orgId, row.document_file_link),
      });
    }
    byLine.set(row.line_id, line);
  }

  const pack = buildGrantReportPack({
    applicationId,
    awardAmount: Number(application.amount_awarded ?? 0),
    restrictedTo: application.restricted_to,
    lines: [...byLine.values()],
  });
  return { ...pack, projectName: application.project_name ?? null, restrictedTo: application.restricted_to ?? null, reportingDue: application.reporting_due ?? null };
}

async function resolveReportDocumentUrl(orgId: string, fileLink: string | null): Promise<string | null> {
  if (!fileLink) return null;
  if (/^https?:\/\//i.test(fileLink)) return fileLink;
  try {
    return await createDownloadUrl(fileLink, orgId);
  } catch {
    return null;
  }
}

export function reportPackCsv(pack: Awaited<ReturnType<typeof getGrantReportPack>>): string {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    ["Line", "Category", "Planned", "Committed", "Actual paid", "Variance", "Documents"].map(escape).join(","),
    ...pack.lines.map((line) => [line.name, line.category, line.planned, line.committed, line.actual, line.variance, line.documents.length].map(escape).join(",")),
  ].join("\n");
}
