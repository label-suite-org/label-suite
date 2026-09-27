import { createHash } from "node:crypto";

export const GRANTS_V2_BASE_ID = "app26JltxTyf40Fcp";
export const GRANTS_V2_TABLES = ["Grants", "Applications", "Projects", "Assets"] as const;

export type GrantsV2Table = (typeof GRANTS_V2_TABLES)[number];

export interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime?: string;
}

export interface AirtableSnapshot {
  baseId: string;
  tables: Record<GrantsV2Table, AirtableRecord[]>;
}

export function normalizeAirtableCliRecords(
  fields: Array<{ id: string; name: string }>,
  records: Array<{ id: string; createdTime?: string; cellValuesByFieldId?: Record<string, unknown> }>,
): AirtableRecord[] {
  const namesById = new Map(fields.map((field) => [field.id, field.name]));
  return records.map((record) => ({
    id: record.id,
    createdTime: record.createdTime,
    fields: Object.fromEntries(
      Object.entries(record.cellValuesByFieldId ?? {}).map(([fieldId, value]) => [namesById.get(fieldId) ?? fieldId, value]),
    ),
  }));
}

export interface ImportException {
  code: string;
  sourceTable: GrantsV2Table;
  sourceRecordId: string;
  field?: string;
  message: string;
  value?: unknown;
}

export interface CompletenessCell {
  present: number;
  total: number;
}

export interface GrantsV2Characterization {
  baseId: string;
  counts: { grants: number; applications: number; projects: number; assets: number };
  normalizedDeadlineCount: number;
  completeness: {
    grants: Record<string, CompletenessCell>;
    applications: Record<string, CompletenessCell>;
    projects: Record<string, CompletenessCell>;
    assets: Record<string, CompletenessCell>;
  };
  exceptions: ImportException[];
}

export type ImportAction = "create" | "update" | "unchanged";

export interface ImportOperation {
  action: ImportAction;
  targetTable: string;
  targetId: string;
  idempotencyKey: string;
  fingerprint: string;
  sourceTable: GrantsV2Table;
  sourceRecordId: string;
  sourceVariant?: string;
  row: Record<string, unknown>;
}

export interface GrantsV2ImportPlan {
  baseId: string;
  mode: "dry-run";
  operations: ImportOperation[];
  operationsByTarget: Record<string, ImportOperation[]>;
  exceptions: ImportException[];
  summary: {
    operations: number;
    create: number;
    update: number;
    unchanged: number;
    exceptions: number;
  };
}

export interface GrantsV2PlanOptions {
  /** Airtable project record ID to an already-reviewed Label Suite Budget project ID. */
  projectReconciliation?: Record<string, string>;
}

const WORKFLOW_STAGES: Record<string, string> = {
  idea: "idea",
  research: "research",
  writing: "writing",
  "ready to submit": "ready_to_submit",
  submitted: "submitted",
  "decision pending": "decision_pending",
  reporting: "reporting",
  closed: "closed",
};

const OUTCOMES: Record<string, string> = {
  unknown: "unknown",
  approved: "approved",
  "partially approved": "partially_approved",
  rejected: "rejected",
  withdrawn: "withdrawn",
  "not qualified": "not_qualified",
  "to do": "unknown",
  pending: "unknown",
  "in progress": "unknown",
  submitted: "unknown",
  draft: "unknown",
  idea: "unknown",
};

const PURPOSES: Record<string, string> = {
  production: "production",
  recording: "production",
  video: "video",
  pr: "pr",
  publicity: "pr",
  ads: "ads",
  marketing: "ads",
  travel: "travel",
  export: "export",
  live: "live",
  content: "content",
  development: "development",
  "etc.": "other",
  other: "other",
};

export function characterizeGrantsV2Snapshot(
  snapshot: AirtableSnapshot,
  expectedCounts?: Partial<Record<"grants" | "applications" | "projects" | "assets", number>>,
): GrantsV2Characterization {
  const grants = snapshot.tables.Grants;
  const applications = snapshot.tables.Applications;
  const projects = snapshot.tables.Projects;
  const assets = snapshot.tables.Assets;
  const exceptions: ImportException[] = [];
  const grantIds = new Set(grants.map((record) => record.id));
  const projectIds = new Set(projects.map((record) => record.id));
  const assetIds = new Set(assets.map((record) => record.id));
  const applicationIds = new Set(applications.map((record) => record.id));

  for (const grant of grants) {
    for (let index = 1; index <= 6; index++) {
      const field = `Deadline ${index}`;
      const value = grant.fields[field];
      if (isPresent(value) && !dateText(value)) {
        exceptions.push(exception("invalid_deadline", "Grants", grant, field, "Deadline is not an ISO date", value));
      }
    }
  }

  for (const application of applications) {
    validateSingleLink(application, "Link to Projects", "Projects", projectIds, "project", exceptions);
    validateSingleLink(application, "Link to Grants", "Grants", grantIds, "grant", exceptions);
    validateKnownValue(application, "Workflow Stage", WORKFLOW_STAGES, "unknown_workflow_stage", exceptions);
    validateKnownValue(application, "Status", OUTCOMES, "unknown_outcome", exceptions);
    validateManyLinks(application, "Assets", "Assets", assetIds, "asset", exceptions);
  }

  for (const asset of assets) {
    validateManyLinks(asset, "Applications", "Applications", applicationIds, "application", exceptions);
    if (!isPresent(asset.fields.Content) && attachments(asset.fields.File).length === 0) {
      exceptions.push(exception("asset_without_content", "Assets", asset, undefined, "Asset has neither reusable text nor a file"));
    }
  }

  const counts = {
    grants: grants.length,
    applications: applications.length,
    projects: projects.length,
    assets: assets.length,
  };
  if (expectedCounts) {
    for (const [name, expected] of Object.entries(expectedCounts)) {
      const actual = counts[name as keyof typeof counts];
      if (expected !== undefined && actual !== expected) {
        exceptions.push({
          code: "source_count_mismatch",
          sourceTable: countTable(name as keyof typeof counts),
          sourceRecordId: "__table__",
          message: `Expected ${expected} ${name} records but read ${actual}`,
          value: { expected, actual },
        });
      }
    }
  }

  return {
    baseId: snapshot.baseId,
    counts,
    normalizedDeadlineCount: grants.reduce((total, grant) => total + deadlineValues(grant).length, 0),
    completeness: {
      grants: completeness(grants, {
        name: ["Name"],
        funder: ["Who"],
        categories: ["Categories (multi)", "Category"],
        eligibility: ["Hvem Kan Søge"],
        requirements: ["Hvad Skal Ansøgningen Indeholde", "Requirements"],
        officialSource: ["Website"],
      }),
      applications: completeness(applications, {
        project: ["Link to Projects"],
        grant: ["Link to Grants"],
        workflowStage: ["Workflow Stage"],
        outcome: ["Status"],
        owner: ["Owner"],
        nextAction: ["Next Action"],
        deadline: ["Deadline"],
      }),
      projects: completeness(projects, {
        name: ["Project Name"],
        targetDate: ["Target Date"],
        goal: ["Goal (Summary)"],
        totalBudget: ["Total Budget Needed"],
        budgetBreakdown: ["Budget Breakdown"],
        deliverables: ["Deliverables"],
        successMetrics: ["Evaluation / Success Metrics"],
      }),
      assets: completeness(assets, {
        name: ["Asset Name"],
        type: ["Type"],
        contentOrFile: ["Content", "File"],
        lastUpdated: ["Last Updated"],
        applications: ["Applications"],
      }),
    },
    exceptions: sortExceptions(exceptions),
  };
}

export function buildGrantsV2Plan(
  snapshot: AirtableSnapshot,
  existingFingerprints: Record<string, string> = {},
  options: GrantsV2PlanOptions = {},
): GrantsV2ImportPlan {
  const operations: ImportOperation[] = [];
  const characterization = characterizeGrantsV2Snapshot(snapshot);
  const exceptions = [...characterization.exceptions];
  const targetIds = buildTargetIds(snapshot, options.projectReconciliation ?? {});
  const projectsBySourceId = new Map(snapshot.tables.Projects.map((record) => [record.id, record]));

  const add = (
    sourceTable: GrantsV2Table,
    sourceRecord: AirtableRecord,
    targetTable: string,
    row: Record<string, unknown>,
    variant = "primary",
  ) => {
    const idempotencyKey = [snapshot.baseId, sourceTable, sourceRecord.id, targetTable, variant].join(":");
    const targetId = stableTargetId(idempotencyKey);
    const completeRow = { id: targetId, ...row };
    const fingerprint = fingerprintOf(completeRow);
    const prior = existingFingerprints[idempotencyKey];
    operations.push({
      action: prior === undefined ? "create" : prior === fingerprint ? "unchanged" : "update",
      targetTable,
      targetId,
      idempotencyKey,
      fingerprint,
      sourceTable,
      sourceRecordId: sourceRecord.id,
      sourceVariant: variant === "primary" ? undefined : variant,
      row: completeRow,
    });
    return targetId;
  };

  for (const grant of snapshot.tables.Grants) {
    const grantId = add("Grants", grant, "grants", mapGrant(grant));
    for (const deadline of deadlineValues(grant)) {
      add("Grants", grant, "grant_deadlines", {
        grant_id: grantId,
        deadline_date: deadline.value,
        label: `Airtable ${deadline.field}`,
        status: "planned",
      }, deadline.field.toLowerCase().replaceAll(" ", "_"));
    }
    const requirement = text(grant.fields["Hvad Skal Ansøgningen Indeholde"] ?? grant.fields.Requirements);
    if (requirement) {
      add("Grants", grant, "grant_requirements", {
        grant_id: grantId,
        name: "Application contents",
        description: requirement,
        required: true,
      }, "application_contents");
    }
  }

  for (const project of snapshot.tables.Projects) {
    const projectId = targetIds.Projects.get(project.id);
    if (!projectId) {
      exceptions.push(exception(
        "unmapped_project_reconciliation",
        "Projects",
        project,
        "Project Name",
        "Airtable project must be explicitly reconciled to an existing Budget project before import",
        { sourceName: text(project.fields["Project Name"]) },
      ));
      continue;
    }
    add("Projects", project, "project_funding_profiles", {
      project_id: projectId,
      target_date: dateText(project.fields["Target Date"]),
      goal: text(project.fields["Goal (Summary)"]),
      funding_narrative: text(project.fields["Budget Breakdown"]),
      export_markets: strings(project.fields["Export Markets"]),
      deliverables: textLines(project.fields.Deliverables),
      success_metrics: textLines(project.fields["Evaluation / Success Metrics"]),
      source_table: "Projects",
      source_record_id: project.id,
    });
  }

  for (const asset of snapshot.tables.Assets) {
    add("Assets", asset, "documents", mapAsset(asset));
  }

  const needDemand = new Map<string, { projectSourceId: string; purpose: string; targetAmount: number; sourceApplication: AirtableRecord }>();
  for (const application of snapshot.tables.Applications) {
    const projectLinks = linkedIds(application.fields["Link to Projects"]);
    const projectSourceId = projectLinks.length === 1 ? projectLinks[0] : null;
    if (!projectSourceId || !targetIds.Projects.has(projectSourceId)) continue;
    const applicationPurposes = normalizedPurposes(application.fields["What this grant pays for"]);
    if (!applicationPurposes.length) continue;
    const requestedShare = Math.max(0, numberValue(application.fields["Amount Applied For"]) ?? 0) / applicationPurposes.length;
    for (const purpose of applicationPurposes) {
      const key = `${projectSourceId}:${purpose}`;
      const current = needDemand.get(key);
      if (current) current.targetAmount += requestedShare;
      else needDemand.set(key, { projectSourceId, purpose, targetAmount: requestedShare, sourceApplication: application });
    }
  }

  const needIds = new Map<string, string>();
  for (const [key, demand] of needDemand) {
    const projectSource = projectsBySourceId.get(demand.projectSourceId);
    const projectId = targetIds.Projects.get(demand.projectSourceId);
    if (!projectSource || !projectId) continue;
    const needId = add("Projects", projectSource, "funding_needs", {
      project_id: projectId,
      title: titleCase(demand.purpose),
      category: demand.purpose,
      use_of_funds: "Imported from Airtable application purposes",
      target_amount: demand.targetAmount,
      eligibility: "unknown",
      status: "planned",
    }, `funding_need_${demand.purpose}`);
    needIds.set(key, needId);
    exceptions.push(exception(
      "unreconciled_funding_need",
      "Applications",
      demand.sourceApplication,
      "What this grant pays for",
      `Funding need '${demand.purpose}' requires manual reconciliation to Budget lines`,
    ));
  }

  for (const application of snapshot.tables.Applications) {
    const projectLinks = linkedIds(application.fields["Link to Projects"]);
    const grantLinks = linkedIds(application.fields["Link to Grants"]);
    const projectSourceId = projectLinks.length === 1 ? projectLinks[0] : null;
    const grantSourceId = grantLinks.length === 1 ? grantLinks[0] : null;
    const projectId = projectSourceId ? targetIds.Projects.get(projectSourceId) ?? null : null;
    const grantId = grantSourceId ? targetIds.Grants.get(grantSourceId) ?? null : null;

    const applicationId = add("Applications", application, "grant_applications", {
      project_id: projectId,
      grant_id: grantId,
      owner_contact_id: null,
      priority: normalizePriority(application.fields.Priority),
      workflow_stage: normalizeKnown(application.fields["Workflow Stage"], WORKFLOW_STAGES, "idea"),
      outcome: normalizeKnown(application.fields.Status, OUTCOMES, "unknown"),
      amount_requested: numberValue(application.fields["Amount Applied For"]),
      submission_deadline: dateText(application.fields.Deadline),
      submitted_at: dateText(application.fields["Date Submitted"]),
      decision_date: dateText(application.fields["Date Response"]),
      next_action: text(application.fields["Next Action"]),
      next_action_due: dateText(application.fields["Next Action Due"]),
      angle_narrative: text(application.fields["Angle / Narrative"]),
      response_notes: text(application.fields.Response),
      evaluation: text(application.fields.Evaluation),
      next_step_recommendation: text(application.fields["Next Step Recommendation"]),
      external_reference: text(application.fields.ID) ?? application.id,
      source_folder: text(application.fields["Drive Folder"]),
      notes: joinText(application.fields.Notes, labeledText("Airtable owner", application.fields.Owner)),
    });

    const applicationPurposes = normalizedPurposes(application.fields["What this grant pays for"]);
    const requestedShare = Math.max(0, numberValue(application.fields["Amount Applied For"]) ?? 0) / Math.max(1, applicationPurposes.length);
    for (const purpose of applicationPurposes) {
      if (!projectSourceId || !projectId) continue;
      const key = `${projectSourceId}:${purpose}`;
      const needId = needIds.get(key);
      if (!needId) continue;
      add("Applications", application, "grant_application_funding_needs", {
        application_id: applicationId,
        funding_need_id: needId,
        amount_requested: requestedShare,
        amount_awarded: 0,
      }, `funding_need_link_${purpose}`);
    }

    for (const assetSourceId of linkedIds(application.fields.Assets)) {
      const documentId = targetIds.Assets.get(assetSourceId);
      if (!documentId) continue;
      add("Applications", application, "grant_application_documents", {
        application_id: applicationId,
        document_id: documentId,
        asset_role: "other",
        required: false,
        readiness_status: "ready",
      }, `asset_${assetSourceId}`);
    }
  }

  const operationsByTarget: Record<string, ImportOperation[]> = {};
  for (const operation of operations) {
    (operationsByTarget[operation.targetTable] ??= []).push(operation);
  }
  for (const expected of [
    "grants", "grant_deadlines", "grant_requirements", "budget_projects",
    "project_funding_profiles", "funding_needs", "grant_applications",
    "grant_application_funding_needs", "documents", "grant_application_documents",
  ]) {
    operationsByTarget[expected] ??= [];
  }

  return {
    baseId: snapshot.baseId,
    mode: "dry-run",
    operations,
    operationsByTarget,
    exceptions: sortExceptions(exceptions),
    summary: {
      operations: operations.length,
      create: operations.filter((operation) => operation.action === "create").length,
      update: operations.filter((operation) => operation.action === "update").length,
      unchanged: operations.filter((operation) => operation.action === "unchanged").length,
      exceptions: exceptions.length,
    },
  };
}

export function renderGrantsV2ParityMarkdown(report: GrantsV2Characterization): string {
  const lines = [
    "# Grants V2 Airtable Parity Report",
    "",
    `Airtable base: \`${report.baseId}\``,
    "",
    "## Source Counts",
    "",
    "| Table | Actual | Expected | Result |",
    "|---|---:|---:|---|",
  ];
  for (const [key, label] of [
    ["grants", "Grants"],
    ["applications", "Applications"],
    ["projects", "Projects"],
    ["assets", "Assets"],
  ] as const) {
    const mismatch = report.exceptions.find(
      (item) => item.code === "source_count_mismatch" && item.sourceTable === countTable(key),
    );
    const expected = mismatch && mismatch.value && typeof mismatch.value === "object" && "expected" in mismatch.value
      ? String(mismatch.value.expected)
      : String(report.counts[key]);
    lines.push(`| ${label} | ${report.counts[key]} | ${expected} | ${mismatch ? "mismatch" : "match"} |`);
  }
  lines.push("", `Normalized recurring deadlines: ${report.normalizedDeadlineCount}`, "");

  lines.push("## Key-field Completeness", "", "| Domain | Field | Present | Total |", "|---|---|---:|---:|");
  for (const [domain, cells] of Object.entries(report.completeness)) {
    for (const [field, cell] of Object.entries(cells)) {
      lines.push(`| ${titleCase(domain)} | ${field} | ${cell.present} | ${cell.total} |`);
    }
  }
  lines.push("", "## Explicit Exceptions", "");
  lines.push("No source record is silently dropped; every missing, ambiguous, invalid, or unresolved value appears here.", "");
  if (report.exceptions.length === 0) {
    lines.push("No exceptions.", "");
  } else {
    lines.push("| Code | Source | Field | Message |", "|---|---|---|---|");
    for (const item of report.exceptions) {
      lines.push(`| ${escapeMarkdown(item.code)} | ${item.sourceTable}/${item.sourceRecordId} | ${escapeMarkdown(item.field ?? "")} | ${escapeMarkdown(item.message)} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function summarizeGrantsV2Plan(plan: GrantsV2ImportPlan) {
  const exceptionCodes: Record<string, number> = {};
  for (const item of plan.exceptions) exceptionCodes[item.code] = (exceptionCodes[item.code] ?? 0) + 1;
  return {
    baseId: plan.baseId,
    mode: plan.mode,
    summary: plan.summary,
    targets: Object.fromEntries(
      Object.entries(plan.operationsByTarget).map(([table, operations]) => [table, operations.length]),
    ),
    exceptionCodes,
  };
}

function mapGrant(record: AirtableRecord): Record<string, unknown> {
  return {
    name: text(record.fields.Name) ?? `Airtable Grant ${record.id}`,
    funder: selectText(record.fields.Who),
    category: strings(record.fields["Categories (multi)"] ?? record.fields.Category).join(", ") || null,
    url: text(record.fields.Website),
    description: joinText(record.fields.purpose_statement, record.fields.About),
    requirements: joinText(
      record.fields.Requirements,
      labeledText("Who can apply", record.fields["Hvem Kan Søge"]),
      labeledText("What can be funded", record.fields["Hvad Kan Man Søge Til"]),
      labeledText("Application contents", record.fields["Hvad Skal Ansøgningen Indeholde"]),
    ),
    applicant_type: text(record.fields["Hvem Kan Søge"]),
    eligible_uses: text(record.fields["Hvad Kan Man Søge Til"]),
    assessment_body: text(record.fields["Hvem vurderer din ansøgning"]),
    response_timing: text(record.fields["Hvornår får man svar"]),
    rules: text(record.fields.Rules),
    research_status: normalizeSlug(record.fields["Research Status"]) ?? "imported",
    research_summary: text(record.fields["Notes (AI Summary/Key Points)"]),
    research_source: text(record.fields["Research Source"] ?? record.fields.Website),
    last_verified_at: dateText(record.fields["Last Verified"] ?? record.fields["Last Updated"]),
    max_amount: numberValue(record.fields["Max Amount"]),
    currency: "DKK",
    priority: normalizePriority(record.fields.Priority),
    notes: joinText(
      record.fields.Notes,
      record.fields["Notes (AI Summary/Key Points)"],
      record.fields.Rules,
      labeledText("Assessment body", record.fields["Hvem vurderer din ansøgning"]),
      labeledText("Expected response", record.fields["Hvornår får man svar"]),
      labeledText("Airtable source", record.id),
    ),
  };
}

function mapAsset(record: AirtableRecord): Record<string, unknown> {
  const files = attachments(record.fields.File);
  return {
    name: text(record.fields["Asset Name"]) ?? `Airtable Asset ${record.id}`,
    doc_type: normalizeSlug(record.fields.Type) ?? "grant_asset",
    status: files.length > 0 || isPresent(record.fields.Content) ? "ready" : "draft",
    file_link: null,
    notes: joinText(
      record.fields.Content,
      files[0]?.filename ? labeledText("Airtable attachment", files[0].filename) : null,
      labeledText("Last updated", record.fields["Last Updated"]),
      labeledText("Airtable source", record.id),
    ),
  };
}

function buildTargetIds(snapshot: AirtableSnapshot, projectReconciliation: Record<string, string>) {
  const result = {
    Grants: new Map<string, string>(),
    Projects: new Map<string, string>(),
    Assets: new Map<string, string>(),
  };
  for (const [table, target] of [["Grants", "grants"], ["Assets", "documents"]] as const) {
    for (const record of snapshot.tables[table]) {
      result[table].set(record.id, stableTargetId([snapshot.baseId, table, record.id, target, "primary"].join(":")));
    }
  }
  for (const record of snapshot.tables.Projects) {
    const projectId = projectReconciliation[record.id]?.trim();
    if (projectId) result.Projects.set(record.id, projectId);
  }
  return result;
}

function normalizedPurposes(value: unknown): string[] {
  return [...new Set(strings(value).map((raw) => PURPOSES[raw.trim().toLowerCase()] ?? "other"))];
}

function deadlineValues(record: AirtableRecord): Array<{ field: string; value: string }> {
  const result: Array<{ field: string; value: string }> = [];
  for (let index = 1; index <= 6; index++) {
    const field = `Deadline ${index}`;
    const value = dateText(record.fields[field]);
    if (value) result.push({ field, value });
  }
  return result;
}

function completeness(records: AirtableRecord[], fields: Record<string, string[]>): Record<string, CompletenessCell> {
  return Object.fromEntries(Object.entries(fields).map(([label, names]) => [label, {
    present: records.filter((record) => names.some((name) => isPresent(record.fields[name]))).length,
    total: records.length,
  }]));
}

function validateSingleLink(
  record: AirtableRecord,
  field: string,
  targetTable: GrantsV2Table,
  knownIds: Set<string>,
  label: string,
  exceptions: ImportException[],
) {
  const ids = linkedIds(record.fields[field]);
  if (ids.length === 0) {
    exceptions.push(exception(`missing_${label}_link`, "Applications", record, field, `Application has no linked ${label}`));
  } else if (ids.length > 1) {
    exceptions.push(exception(`ambiguous_${label}_link`, "Applications", record, field, `Application links to ${ids.length} ${label} records`, ids));
  }
  for (const id of ids.filter((candidate) => !knownIds.has(candidate))) {
    exceptions.push(exception(`unresolved_${label}_link`, "Applications", record, field, `Linked ${targetTable} record was not found in the snapshot`, id));
  }
}

function validateManyLinks(
  record: AirtableRecord,
  field: string,
  targetTable: GrantsV2Table,
  knownIds: Set<string>,
  label: string,
  exceptions: ImportException[],
) {
  const sourceTable = targetTable === "Applications" ? "Assets" : "Applications";
  for (const id of linkedIds(record.fields[field]).filter((candidate) => !knownIds.has(candidate))) {
    exceptions.push(exception(`unresolved_${label}_link`, sourceTable, record, field, `Linked ${targetTable} record was not found in the snapshot`, id));
  }
}

function validateKnownValue(
  record: AirtableRecord,
  field: string,
  known: Record<string, string>,
  code: string,
  exceptions: ImportException[],
) {
  const value = selectText(record.fields[field]);
  if (value && known[value.trim().toLowerCase()] === undefined) {
    exceptions.push(exception(code, "Applications", record, field, `Unrecognized value '${value}'`, value));
  }
}

function exception(
  code: string,
  sourceTable: GrantsV2Table,
  record: AirtableRecord,
  field: string | undefined,
  message: string,
  value?: unknown,
): ImportException {
  return { code, sourceTable, sourceRecordId: record.id, field, message, value };
}

function sortExceptions(exceptions: ImportException[]): ImportException[] {
  return exceptions.sort((a, b) =>
    a.sourceTable.localeCompare(b.sourceTable) ||
    a.sourceRecordId.localeCompare(b.sourceRecordId) ||
    a.code.localeCompare(b.code),
  );
}

function countTable(name: "grants" | "applications" | "projects" | "assets"): GrantsV2Table {
  return ({ grants: "Grants", applications: "Applications", projects: "Projects", assets: "Assets" })[name] as GrantsV2Table;
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  return selectText(value);
}

function selectText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object" && "name" in value && typeof value.name === "string") {
    return value.name.trim() || null;
  }
  return null;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return selectText(value) ? [selectText(value)!] : [];
  return value.map(selectText).filter((item): item is string => Boolean(item));
}

function linkedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.startsWith("rec")) return [item];
    if (item && typeof item === "object" && "id" in item && typeof item.id === "string") return [item.id];
    return [];
  });
}

function attachments(value: unknown): Array<{ id?: string; url: string; filename?: string; type?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || !("url" in item) || typeof item.url !== "string") return [];
    return [{
      id: "id" in item && typeof item.id === "string" ? item.id : undefined,
      url: item.url,
      filename: "filename" in item && typeof item.filename === "string" ? item.filename : undefined,
      type: "type" in item && typeof item.type === "string" ? item.type : undefined,
    }];
  });
}

function dateText(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value.trim())) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : value.trim().slice(0, 10);
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replaceAll(/[.,](?=\d{3}(?:\D|$))/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeKnown(value: unknown, values: Record<string, string>, fallback: string): string {
  const label = selectText(value)?.toLowerCase();
  return label ? values[label] ?? fallback : fallback;
}

function normalizeSlug(value: unknown): string | null {
  const label = selectText(value);
  return label ? label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_|_$/g, "") : null;
}

function normalizePriority(value: unknown): string {
  const label = selectText(value)?.toLowerCase() ?? "medium";
  if (label.includes("high") || label.includes("høj") || label.includes("hoj")) return "high";
  if (label.includes("low") || label.includes("lav")) return "low";
  return "medium";
}

function joinText(...values: unknown[]): string | null {
  const result = values.map(text).filter(Boolean).join("\n\n");
  return result || null;
}

function labeledText(label: string, value: unknown): string | null {
  const content = text(value);
  return content ? `${label}: ${content}` : null;
}

function textLines(value: unknown): string[] {
  return (text(value) ?? "")
    .split(/\r?\n|;|•/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stableTargetId(key: string): string {
  return `air_${createHash("sha256").update(key).digest("hex").slice(0, 28)}`;
}

function fingerprintOf(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
