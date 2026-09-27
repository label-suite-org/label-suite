import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Pool, type PoolClient } from "pg";

import {
  buildGrantsV2Plan,
  characterizeGrantsV2Snapshot,
  GRANTS_V2_BASE_ID,
  GRANTS_V2_TABLES,
  normalizeAirtableCliRecords,
  renderGrantsV2ParityMarkdown,
  summarizeGrantsV2Plan,
  type AirtableRecord,
  type AirtableSnapshot,
} from "./airtable-grants-core";

const EXPECTED_COUNTS = { grants: 85, applications: 46, projects: 8, assets: 34 } as const;
const PAGE_SIZE = 100;
const execFileAsync = promisify(execFile);

export async function runGrantsV2ParityCli(argv = process.argv.slice(2)): Promise<void> {
  if (showHelp(argv, "parity")) return;
  const options = parseOptions(argv);
  const snapshot = await loadSnapshot(options);
  const report = characterizeGrantsV2Snapshot(snapshot, EXPECTED_COUNTS);
  const output = options.json ? `${JSON.stringify(report, null, 2)}\n` : renderGrantsV2ParityMarkdown(report);
  await emit(output, options.output);
}

export async function runGrantsV2ImportCli(argv = process.argv.slice(2)): Promise<void> {
  if (showHelp(argv, "import")) return;
  const options = parseOptions(argv);
  const snapshot = await loadSnapshot(options);
  const existing = options.existingPlan ? await readExistingFingerprints(options.existingPlan) : {};
  const projectReconciliation = options.projectMap ? await readProjectMap(options.projectMap) : {};
  const plan = buildGrantsV2Plan(snapshot, existing, { projectReconciliation });
  if (argv.includes("--apply")) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required for --apply.");
    const result = await applyGrantsV2Plan(plan, snapshot, projectReconciliation, {
      databaseUrl,
      orgId: process.env.AIRTABLE_IMPORT_ORG_ID ?? "true-nature",
    });
    await emit(`${JSON.stringify(result, null, 2)}\n`, options.output);
    return;
  }
  const output = formatGrantsV2ImportOutput(plan, argv.includes("--full"));
  await emit(output, options.output);
}

export function formatGrantsV2ImportOutput(
  plan: ReturnType<typeof buildGrantsV2Plan>,
  full: boolean,
): string {
  return `${JSON.stringify(full ? plan : summarizeGrantsV2Plan(plan), null, 2)}\n`;
}

interface Options {
  json: boolean;
  output?: string;
  snapshot?: string;
  existingPlan?: string;
  projectMap?: string;
  baseId: string;
  maxRecords?: number;
}

function parseOptions(argv: string[]): Options {
  return {
    json: argv.includes("--json"),
    output: option(argv, "--output"),
    snapshot: option(argv, "--snapshot"),
    existingPlan: option(argv, "--existing-plan"),
    projectMap: option(argv, "--project-map"),
    baseId: process.env.AIRTABLE_BASE_ID ?? GRANTS_V2_BASE_ID,
    maxRecords: numericOption(argv, "--max-records"),
  };
}

async function readProjectMap(path: string): Promise<Record<string, string>> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("--project-map must contain a JSON object of Airtable Project record IDs to Budget project IDs.");
  }
  const result: Record<string, string> = {};
  for (const [sourceId, projectId] of Object.entries(parsed)) {
    if (!sourceId.startsWith("rec") || typeof projectId !== "string" || !projectId.trim()) {
      throw new Error(`Invalid --project-map entry for '${sourceId}'.`);
    }
    result[sourceId] = projectId.trim();
  }
  return result;
}

async function loadSnapshot(options: Options): Promise<AirtableSnapshot> {
  if (options.snapshot) {
    const parsed = JSON.parse(await readFile(options.snapshot, "utf8")) as AirtableSnapshot;
    assertSnapshot(parsed);
    return parsed;
  }
  const token = process.env.AIRTABLE_API_KEY ?? process.env.AIRTABLE_PAT ?? process.env.AIRTABLE_TOKEN;
  if (!token) {
    return readSnapshotViaConfiguredCli(options);
  }
  try {
    const tables = {} as AirtableSnapshot["tables"];
    for (const table of GRANTS_V2_TABLES) {
      tables[table] = await readAirtableTable(options.baseId, table, token, options.maxRecords);
    }
    return { baseId: options.baseId, tables };
  } catch (error) {
    if (shouldFallbackToConfiguredCli(error)) return readSnapshotViaConfiguredCli(options);
    throw error;
  }
}

async function readSnapshotViaConfiguredCli(options: Options): Promise<AirtableSnapshot> {
  const metadata = await runCliJson("list-tables-for-base", ["--baseId", options.baseId]);
  const tablesByName = new Map(
    ((metadata as { tables?: Array<{ id: string; name: string; fields: Array<{ id: string; name: string }> }> }).tables ?? [])
      .map((table) => [table.name, table]),
  );
  const tables = {} as AirtableSnapshot["tables"];
  for (const tableName of GRANTS_V2_TABLES) {
    const table = tablesByName.get(tableName);
    if (!table) throw new Error(`Configured Airtable base is missing table '${tableName}'.`);
    const records: Array<{ id: string; createdTime?: string; cellValuesByFieldId?: Record<string, unknown> }> = [];
    let cursor: string | undefined;
    do {
      const args = ["--baseId", options.baseId, "--tableId", table.id, "--pageSize", String(PAGE_SIZE)];
      if (cursor) args.push("--cursor", cursor);
      const page = await runCliJson("list-records-for-table", args) as {
        records?: typeof records;
        nextCursor?: string;
      };
      records.push(...(page.records ?? []));
      cursor = page.nextCursor;
      if (options.maxRecords && records.length >= options.maxRecords) break;
    } while (cursor);
    if (options.maxRecords && records.length > options.maxRecords) records.length = options.maxRecords;
    tables[tableName] = normalizeAirtableCliRecords(table.fields, records);
  }
  return { baseId: options.baseId, tables };
}

async function runCliJson(tool: string, args: string[]): Promise<unknown> {
  const invocation = resolveAirtableCliInvocation(process.env);
  try {
    const { stdout } = await execFileAsync(
      invocation.command,
      [...invocation.prefixArgs, tool, ...args, "-q"],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No Airtable token was found and the configured Airtable CLI fallback failed: ${message}. ` +
      "Set AIRTABLE_TOKEN, run airtable-mcp configure, or pass --snapshot <path>.",
    );
  }
}

export function resolveAirtableCliInvocation(
  env: { AIRTABLE_MCP_BIN?: string },
): { command: string; prefixArgs: string[] } {
  return {
    command: env.AIRTABLE_MCP_BIN?.trim() || fileURLToPath(new URL("../node_modules/.bin/airtable-mcp", import.meta.url)),
    prefixArgs: [],
  };
}

export function shouldFallbackToConfiguredCli(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("status" in error)) return false;
  return error.status === 401 || error.status === 403;
}

async function readAirtableTable(
  baseId: string,
  table: string,
  token: string,
  maxRecords?: number,
): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const body = await response.text();
      throw new AirtableHttpError(response.status, `Airtable GET ${table} failed (${response.status}): ${body.slice(0, 300)}`);
    }
    const page = await response.json() as { records?: AirtableRecord[]; offset?: string };
    records.push(...(page.records ?? []));
    offset = page.offset;
    if (maxRecords && records.length >= maxRecords) break;
  } while (offset);
  if (maxRecords && records.length > maxRecords) records.length = maxRecords;
  return records;
}

class AirtableHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const APPLY_TABLE_ORDER = [
  "grants",
  "grant_deadlines",
  "grant_requirements",
  "project_funding_profiles",
  "documents",
  "funding_needs",
  "grant_applications",
  "grant_application_funding_needs",
  "grant_application_documents",
] as const;

type ApplyTable = (typeof APPLY_TABLE_ORDER)[number];

const APPLY_COLUMNS: Record<ApplyTable, readonly string[]> = {
  grants: ["name", "funder", "program", "category", "url", "research_url", "description", "requirements", "applicant_type", "eligible_uses", "assessment_body", "response_timing", "rules", "research_status", "research_summary", "research_source", "last_verified_at", "opens_on", "deadline", "max_amount", "currency", "priority", "status", "notes"],
  grant_deadlines: ["grant_id", "deadline_date", "label", "opens_on", "expected_response_date", "status"],
  grant_requirements: ["grant_id", "name", "description", "asset_role", "required", "sort_order"],
  project_funding_profiles: ["project_id", "owner_contact_id", "priority", "target_date", "goal", "funding_narrative", "deliverables", "success_metrics", "export_markets", "source_table", "source_record_id", "imported_at"],
  documents: ["name", "doc_type", "release_id", "artist_id", "contact_id", "status", "file_link", "notes"],
  funding_needs: ["project_id", "title", "category", "use_of_funds", "target_amount", "priority", "status", "needed_by", "eligibility", "success_measure"],
  grant_applications: ["project_id", "grant_id", "funding_source_id", "owner_contact_id", "status", "priority", "workflow_stage", "outcome", "amount_requested", "amount_awarded", "submission_deadline", "submitted_at", "decision_date", "reporting_due", "next_action", "next_action_due", "angle_narrative", "response_notes", "evaluation", "next_step_recommendation", "source_folder", "external_reference", "notes"],
  grant_application_funding_needs: ["application_id", "funding_need_id", "amount_requested", "amount_awarded"],
  grant_application_documents: ["application_id", "document_id", "link_type", "asset_role", "required", "readiness_status"],
};

const JSON_COLUMNS = new Set(["project_funding_profiles.deliverables", "project_funding_profiles.success_metrics", "project_funding_profiles.export_markets"]);

export interface ExistingGrantCandidate { id: string; name: string; funder: string | null }
export interface ExistingApplicationCandidate { id: string; external_reference: string | null }
export interface ExistingDocumentCandidate { id: string; name: string; doc_type: string | null }
export interface ExistingProjectFundingProfileCandidate { id: string; project_id: string }

export interface ExistingApplyState {
  grants: ExistingGrantCandidate[];
  applications: ExistingApplicationCandidate[];
  documents: ExistingDocumentCandidate[];
  projectFundingProfiles?: ExistingProjectFundingProfileCandidate[];
  sourceMappings?: Record<string, string>;
}

export interface PreparedApplyOperation {
  targetTable: ApplyTable;
  targetId: string;
  sourceTable: "Grants" | "Applications" | "Projects" | "Assets";
  sourceRecordId: string;
  row: Record<string, unknown>;
}

export function normalizeReconciliationValue(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKD").toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim()
    : "";
}

export function prepareGrantsV2Apply(
  plan: ReturnType<typeof buildGrantsV2Plan>,
  existing: ExistingApplyState,
): { operations: PreparedApplyOperation[]; idRemap: Record<string, string>; exceptions: Array<{ code: string; sourceTable: "Grants" | "Applications" | "Assets"; sourceRecordId: string; message: string }> } {
  const allowed = new Set<string>(APPLY_TABLE_ORDER);
  const forbidden = plan.operations.filter((operation) => !allowed.has(operation.targetTable));
  if (forbidden.length) {
    throw new Error(`Apply plan contains non-whitelisted target table(s): ${[...new Set(forbidden.map((item) => item.targetTable))].join(", ")}`);
  }

  const idRemap: Record<string, string> = {};
  const exceptions: Array<{ code: string; sourceTable: "Grants" | "Applications" | "Assets"; sourceRecordId: string; message: string }> = [];
  const mappings = existing.sourceMappings ?? {};
  const reconcile = <T>(
    sourceTable: "Grants" | "Applications" | "Assets",
    targetTable: ApplyTable,
    candidates: T[],
    candidateKey: (candidate: T) => string,
    operationKey: (row: Record<string, unknown>) => string,
    candidateId: (candidate: T) => string,
  ) => {
    const byKey = new Map<string, T[]>();
    for (const candidate of candidates) {
      const key = candidateKey(candidate);
      if (!key) continue;
      const list = byKey.get(key) ?? [];
      list.push(candidate);
      byKey.set(key, list);
    }
    for (const operation of plan.operations.filter((item) => item.targetTable === targetTable && item.sourceTable === sourceTable)) {
      const mapped = mappings[`${sourceTable}:${operation.sourceRecordId}`];
      const matches = byKey.get(operationKey(operation.row)) ?? [];
      if (!mapped && matches.length > 1) {
        throw new Error(
          `Ambiguous ${sourceTable} record ${operation.sourceRecordId} matched ${matches.length} existing ${targetTable} rows; provide an explicit source mapping.`,
        );
      }
      const chosen = mapped ?? (matches[0] ? candidateId(matches[0]) : undefined);
      if (chosen) idRemap[operation.targetId] = chosen;
    }
  };

  const pair = (left: unknown, right: unknown) => `${normalizeReconciliationValue(left)}\u0000${normalizeReconciliationValue(right)}`;
  reconcile("Grants", "grants", existing.grants, (row) => pair(row.name, row.funder), (row) => pair(row.name, row.funder), (row) => row.id);
  reconcile("Applications", "grant_applications", existing.applications, (row) => normalizeReconciliationValue(row.external_reference), (row) => normalizeReconciliationValue(row.external_reference), (row) => row.id);
  reconcile("Assets", "documents", existing.documents, (row) => pair(row.name, row.doc_type), (row) => pair(row.name, row.doc_type), (row) => row.id);

  const profilesByProject = new Map<string, ExistingProjectFundingProfileCandidate[]>();
  for (const profile of existing.projectFundingProfiles ?? []) {
    const matches = profilesByProject.get(profile.project_id) ?? [];
    matches.push(profile);
    profilesByProject.set(profile.project_id, matches);
  }
  for (const operation of plan.operations.filter((item) => item.targetTable === "project_funding_profiles")) {
    const matches = profilesByProject.get(String(operation.row.project_id)) ?? [];
    if (matches.length > 1) throw new Error(`Ambiguous project funding profile for project ${operation.row.project_id}.`);
    if (matches[0]) idRemap[operation.targetId] = matches[0].id;
  }

  const remap = (value: unknown) => typeof value === "string" ? idRemap[value] ?? value : value;
  const foreignKeys: Partial<Record<ApplyTable, readonly string[]>> = {
    grant_deadlines: ["grant_id"], grant_requirements: ["grant_id"],
    grant_applications: ["grant_id"],
    grant_application_funding_needs: ["application_id", "funding_need_id"],
    grant_application_documents: ["application_id", "document_id"],
  };
  const operations = APPLY_TABLE_ORDER.flatMap((targetTable) =>
    plan.operations.filter((operation) => operation.targetTable === targetTable).map((operation) => {
      const row = { ...operation.row };
      row.id = remap(operation.targetId);
      for (const field of foreignKeys[targetTable] ?? []) row[field] = remap(row[field]);
      return {
        targetTable,
        targetId: String(row.id),
        sourceTable: operation.sourceTable,
        sourceRecordId: operation.sourceRecordId,
        row,
      };
    }),
  );
  return { operations, idRemap, exceptions };
}

interface ApplyOptions { databaseUrl: string; orgId: string }

export async function applyGrantsV2Plan(
  plan: ReturnType<typeof buildGrantsV2Plan>,
  snapshot: AirtableSnapshot,
  projectMap: Record<string, string>,
  options: ApplyOptions,
) {
  const pool = new Pool({ connectionString: options.databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const org = await client.query("select 1 from label_suite.orgs where id = $1", [options.orgId]);
    if (!org.rowCount) throw new Error(`Import org '${options.orgId}' does not exist.`);
    const projectIds = [...new Set(Object.values(projectMap))];
    if (projectIds.length) {
      const found = await client.query<{ id: string }>("select id from label_suite.budget_projects where org_id = $1 and id = any($2::text[])", [options.orgId, projectIds]);
      const foundIds = new Set(found.rows.map((row) => row.id));
      const missing = projectIds.filter((id) => !foundIds.has(id));
      if (missing.length) throw new Error(`Project map references missing Budget project ID(s): ${missing.join(", ")}`);
    }
    const grants = await client.query<ExistingGrantCandidate>("select id, name, funder from label_suite.grants where org_id = $1", [options.orgId]);
    const applications = await client.query<ExistingApplicationCandidate>("select id, external_reference from label_suite.grant_applications where org_id = $1", [options.orgId]);
    const documents = await client.query<ExistingDocumentCandidate>("select id, name, doc_type from label_suite.documents where org_id = $1", [options.orgId]);
    const projectFundingProfiles = await client.query<ExistingProjectFundingProfileCandidate>("select id, project_id from label_suite.project_funding_profiles where org_id = $1", [options.orgId]);
    const mappingRows = await client.query<{ airtable_table_name: string; airtable_record_id: string; postgres_record_id: string }>("select airtable_table_name, airtable_record_id, postgres_record_id from label_suite.airtable_record_mappings where org_id = $1 and airtable_base_id = $2", [options.orgId, plan.baseId]);
    const sourceMappings = Object.fromEntries(mappingRows.rows.map((row) => [`${row.airtable_table_name}:${row.airtable_record_id}`, row.postgres_record_id]));
    const prepared = prepareGrantsV2Apply(plan, { grants: grants.rows, applications: applications.rows, documents: documents.rows, projectFundingProfiles: projectFundingProfiles.rows, sourceMappings });
    const counts: Record<string, { updated: number; inserted: number; skipped: number }> = {};
    const applyExceptions: Array<{ code: string; sourceTable: "Grants" | "Applications" | "Projects" | "Assets"; sourceRecordId: string; message: string }> = [];
    for (const operation of prepared.operations) {
      const result = await updateThenInsert(client, operation, options.orgId);
      const count = counts[operation.targetTable] ??= { updated: 0, inserted: 0, skipped: 0 };
      count[result]++;
      if (result === "skipped") applyExceptions.push({
        code: "apply_operation_skipped", sourceTable: operation.sourceTable,
        sourceRecordId: operation.sourceRecordId,
        message: `Skipped ${operation.targetTable} ${operation.targetId} because an insert conflict could not be reconciled.`,
      });
    }

    const primaryTargets = new Map<string, string>();
    for (const operation of prepared.operations) {
      if ((operation.sourceTable === "Grants" && operation.targetTable === "grants") ||
          (operation.sourceTable === "Applications" && operation.targetTable === "grant_applications") ||
          (operation.sourceTable === "Assets" && operation.targetTable === "documents")) {
        primaryTargets.set(`${operation.sourceTable}:${operation.sourceRecordId}`, operation.targetId);
      }
    }
    for (const [sourceId, projectId] of Object.entries(projectMap)) primaryTargets.set(`Projects:${sourceId}`, projectId);
    const snapshotRecords = new Map<string, AirtableRecord>(Object.entries(snapshot.tables).flatMap(([table, records]) => records.map((record) => [`${table}:${record.id}`, record])));
    for (const [sourceKey, postgresId] of primaryTargets) {
      const [sourceTable, sourceRecordId] = sourceKey.split(":") as ["Grants" | "Applications" | "Projects" | "Assets", string];
      const targetTable = ({ Grants: "grants", Applications: "grant_applications", Projects: "budget_projects", Assets: "documents" } as const)[sourceTable];
      await updateThenInsertMapping(client, {
        id: `${options.orgId}:${plan.baseId}:${sourceTable}:${sourceRecordId}`,
        orgId: options.orgId, baseId: plan.baseId, sourceTable, sourceRecordId,
        targetTable, postgresId,
        recordHash: fingerprintRecord(snapshotRecords.get(sourceKey)?.fields ?? {}),
      });
    }
    await client.query("commit");
    const allExceptions = [...plan.exceptions, ...prepared.exceptions, ...applyExceptions].map((item) => ({
      code: item.code,
      sourceTable: item.sourceTable,
      sourceRecordId: item.sourceRecordId,
      ...( "field" in item && item.field ? { field: item.field } : {}),
      message: item.message,
    }));
    return {
      baseId: plan.baseId,
      mode: "apply",
      orgId: options.orgId,
      summary: { tables: counts, mappings: primaryTargets.size, exceptions: allExceptions.length },
      exceptionCodes: summarizeExceptionCodes(allExceptions),
      exceptions: allExceptions,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function updateThenInsert(client: PoolClient, operation: PreparedApplyOperation, orgId: string): Promise<"updated" | "inserted" | "skipped"> {
  const columns = APPLY_COLUMNS[operation.targetTable].filter((column) => operation.row[column] !== undefined);
  const values = columns.map((column) => serializeColumn(operation.targetTable, column, operation.row[column]));
  const assignments = columns.map((column, index) => `"${column}" = $${index + 1}`);
  if (columns.length) {
    const touch = operation.targetTable === "grant_application_documents" ? "" : ", updated_at = now()";
    const updated = await client.query(`update label_suite."${operation.targetTable}" set ${assignments.join(", ")}${touch} where id = $${values.length + 1} and org_id = $${values.length + 2}`, [...values, operation.targetId, orgId]);
    if (updated.rowCount) return "updated";
  }
  const insertColumns = ["id", "org_id", ...columns];
  const inserted = await client.query(
    `insert into label_suite."${operation.targetTable}" (${insertColumns.map((column) => `"${column}"`).join(", ")}) values (${insertColumns.map((_, index) => `$${index + 1}`).join(", ")}) on conflict do nothing returning id`,
    [operation.targetId, orgId, ...values],
  );
  return inserted.rowCount ? "inserted" : "skipped";
}

function serializeColumn(table: ApplyTable, column: string, value: unknown): unknown {
  return JSON_COLUMNS.has(`${table}.${column}`) ? JSON.stringify(value ?? []) : value;
}

async function updateThenInsertMapping(client: PoolClient, row: { id: string; orgId: string; baseId: string; sourceTable: string; sourceRecordId: string; targetTable: string; postgresId: string; recordHash: string }) {
  const values = [row.targetTable, row.postgresId, row.recordHash, row.orgId, row.baseId, row.sourceTable, row.sourceRecordId];
  const updated = await client.query("update label_suite.airtable_record_mappings set postgres_table_name=$1, postgres_record_id=$2, record_hash=$3, updated_at=now() where org_id=$4 and airtable_base_id=$5 and airtable_table_name=$6 and airtable_record_id=$7", values);
  if (updated.rowCount) return;
  await client.query("insert into label_suite.airtable_record_mappings (id, org_id, airtable_base_id, airtable_table_name, airtable_record_id, postgres_table_name, postgres_record_id, record_hash, imported_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,now(),now()) on conflict do nothing", [row.id, row.orgId, row.baseId, row.sourceTable, row.sourceRecordId, row.targetTable, row.postgresId, row.recordHash]);
}

function fingerprintRecord(value: unknown): string {
  return awaitlessHash(JSON.stringify(value));
}

function awaitlessHash(value: string): string {
  // createHash is already used by the core planner; keep mapping hashes stable without exposing source content.
  return createHash("sha256").update(value).digest("hex");
}

function summarizeExceptionCodes(items: Array<{ code: string }>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) result[item.code] = (result[item.code] ?? 0) + 1;
  return result;
}

async function readExistingFingerprints(path: string): Promise<Record<string, string>> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as {
    operations?: Array<{ idempotencyKey?: string; fingerprint?: string }>;
  };
  return Object.fromEntries(
    (parsed.operations ?? [])
      .filter((item): item is { idempotencyKey: string; fingerprint: string } =>
        typeof item.idempotencyKey === "string" && typeof item.fingerprint === "string",
      )
      .map((item) => [item.idempotencyKey, item.fingerprint]),
  );
}

function assertSnapshot(value: AirtableSnapshot): void {
  if (!value || typeof value.baseId !== "string" || !value.tables) {
    throw new Error("Snapshot must contain baseId and tables.");
  }
  for (const table of GRANTS_V2_TABLES) {
    if (!Array.isArray(value.tables[table])) throw new Error(`Snapshot is missing table '${table}'.`);
  }
}

async function emit(output: string, path?: string): Promise<void> {
  if (path) await writeFile(path, output, "utf8");
  process.stdout.write(output);
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function numericOption(argv: string[], name: string): number | undefined {
  const value = option(argv, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function showHelp(argv: string[], command: "parity" | "import"): boolean {
  if (!argv.includes("--help") && !argv.includes("-h")) return false;
  const shared = `
Options:
  --snapshot <path>      Read a saved name-keyed Airtable JSON snapshot
  --output <path>        Write the full report/plan as well as stdout
  --max-records <n>      Cap records fetched per table (characterization only)

Environment:
  AIRTABLE_TOKEN         Optional PAT; otherwise uses configured airtable-mcp CLI
  AIRTABLE_BASE_ID       Defaults to ${GRANTS_V2_BASE_ID}
`;
  if (command === "parity") {
    process.stdout.write(`Usage: npm run airtable:grants:parity -- [options]\n${shared}\nExpected source counts: 85 grants, 46 applications, 8 projects, 34 assets.\n`);
  } else {
    process.stdout.write(`Usage: npm run airtable:grants:import -- [options]\n${shared}\n  --project-map <path>   JSON map: Airtable Project record ID -> existing Budget project ID\n  --existing-plan <path> Classify repeat operations as unchanged/update\n  --full                 Print every planned row (default output is summary only)\n  --apply                Apply the reconciled plan in one Postgres transaction\n\nSafety: dry-run is the default. Apply is org-scoped, never creates Budget projects, and requires DATABASE_URL.\nEnvironment:\n  AIRTABLE_IMPORT_ORG_ID Import organization (default: true-nature)\n  DATABASE_URL           Required only with --apply\n`);
  }
  return true;
}
