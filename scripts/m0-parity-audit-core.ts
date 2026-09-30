import { createHash } from "node:crypto";

export const M0_DISPOSITIONS = [
  "Fix in Label Suite",
  "Correct source data",
  "Accepted intentional difference",
  "Human review required",
] as const;

export function assertM0AuditTargetHealth(
  health: {
    revision?: unknown;
    web?: unknown;
    database?: unknown;
    worker?: unknown;
    application?: { status?: unknown };
    analytics?: unknown;
  },
  expectedRevision: string,
): string {
  if (!/^[a-f0-9]{40}$/.test(expectedRevision)) throw new Error("M0 audit target must be an exact 40-character Git revision");
  if (health.revision !== expectedRevision) throw new Error(`M0 audit target revision mismatch: expected ${expectedRevision}`);
  if (health.web !== "ok" || health.database !== "ok" || health.worker !== "ok" || health.application?.status !== "ok") {
    throw new Error("M0 audit target is not healthy across web, database, worker, and application");
  }
  return expectedRevision;
}

export type M0Disposition = (typeof M0_DISPOSITIONS)[number];

export function scopedParityTable(schema: string, table: string, orgId: string): string {
  const ident = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return `(select * from ${ident(schema)}.${ident(table)} where org_id = '${orgId.replace(/'/g, "''")}')`;
}

export interface ParityTableResult {
  spec: { airtable: string; postgres?: string; status: string };
  airtableCount: number | null;
  postgresCount: number | null;
  sourceRecordIds?: string[];
  canonicalRecordIds?: string[];
  truncated?: boolean;
  error?: string;
}

export interface ParityKeyCheck {
  table: string;
  canonicalTable?: string;
  label: string;
  airtableField: string | null;
  airtableKeyCount: number;
  postgresKeyCount: number;
  missingInPostgres: string[];
  extraInPostgres: string[];
  missingInPostgresRecords?: ParityKeyRecord[];
  extraInPostgresRecords?: ParityKeyRecord[];
}

export interface ParityKeyRecord {
  identity: string;
  recordIds: string[];
  value: string;
}

export interface ParityKeyRow {
  recordId: string;
  normalizedValue: string;
  value: string;
}

export function buildKeyRecordEvidence(sourceRows: ParityKeyRow[], canonicalRows: ParityKeyRow[]) {
  const source = rowsByValue(sourceRows);
  const canonical = rowsByValue(canonicalRows);
  const missingValues = [...source.keys()].filter((value) => !canonical.has(value)).sort();
  const extraValues = [...canonical.keys()].filter((value) => !source.has(value)).sort();
  const records = (values: string[], rows: Map<string, ParityKeyRow[]>): ParityKeyRecord[] => values.map((value) => {
    const matches = rows.get(value) ?? [];
    const recordIds = matches.map((row) => row.recordId).sort();
    return {
      identity: recordIds.length <= 1
        ? recordIds[0] ?? value
        : `records-${createHash("sha256").update(recordIds.join("\n")).digest("hex").slice(0, 16)}`,
      recordIds,
      value: matches[0]?.value ?? value,
    };
  });
  return {
    missingInPostgres: missingValues.map((value) => source.get(value)?.[0]?.value ?? value),
    extraInPostgres: extraValues.map((value) => canonical.get(value)?.[0]?.value ?? value),
    missingInPostgresRecords: records(missingValues, source),
    extraInPostgresRecords: records(extraValues, canonical),
  };
}

function rowsByValue(rows: ParityKeyRow[]): Map<string, ParityKeyRow[]> {
  const grouped = new Map<string, ParityKeyRow[]>();
  for (const row of [...rows].sort((a, b) => a.recordId.localeCompare(b.recordId))) {
    grouped.set(row.normalizedValue, [...(grouped.get(row.normalizedValue) ?? []), row]);
  }
  return grouped;
}

export interface ParitySourceIdCheck {
  airtable: string;
  postgres: string;
  preservedIds: number;
  importedRecords: number;
  airtableRecords: number;
  sourceRecordIds?: string[];
  canonicalRecordIds?: string[];
}

export interface ParitySqlCheck {
  label: string;
  count: number;
  samples: string[];
}

export interface ParityRecordCheck {
  table: string;
  canonicalTable: string;
  field: string;
  sourceRecordId: string | null;
  canonicalRecordIds: string[];
  sourceValue: string | null;
  sourceField?: string | null;
  sourceRawValue?: string | null;
  canonicalValues: Array<string | null>;
  status: "matched" | "different" | "unmapped" | "ambiguous" | "unavailable" | "canonical-only";
}

// Compare only explicit source-ID matches; names are never identity evidence.
export function compareRecordEvidence(check: Omit<ParityRecordCheck, "status">, available = true): ParityRecordCheck {
  const status = check.sourceRecordId === null ? "canonical-only" : !available ? "unavailable" : check.canonicalRecordIds.length === 0 ? "unmapped"
    : check.canonicalRecordIds.length !== 1 ? "ambiguous"
    : check.sourceValue === check.canonicalValues[0] ? "matched" : "different";
  return { ...check, status };
}

export interface ParityReport {
  generatedAt: string;
  sourceRevision?: string;
  baseId: string;
  schema: string;
  targetRevision?: string;
  metadataAvailable: boolean;
  tableResults: ParityTableResult[];
  keyChecks: ParityKeyCheck[];
  sourceIdChecks: ParitySourceIdCheck[];
  integrityChecks: ParitySqlCheck[];
  readinessChecks: ParitySqlCheck[];
  auditCommands?: string[];
  groupExceptions?: Record<string, string[]>;
  recordChecks?: ParityRecordCheck[];
  orgId?: string;
  directoryCounts?: ParityTableResult[];
}

export interface M0Mismatch {
  id: string;
  domain: "release-ops" | "artist-relationships" | "release-rights" | "directory-boundary";
  kind: "count_delta" | "key_missing" | "key_extra" | "source_id" | "integrity" | "readiness" | "record_value";
  sourceTable: string;
  canonicalTable: string | null;
  sourceValue: string | null;
  canonicalValue: string | null;
  sourceRecordIds: string[];
  canonicalRecordIds: string[];
  comparisonField: string;
  evidence: string;
  proposedDisposition: M0Disposition;
  owner: string;
  nextAction: string;
}

export interface M0MismatchGroup {
  id: string;
  sharedRule: string;
  memberMismatchIds: string[];
  exceptionMismatchIds: string[];
  proposedDisposition: "Human review required";
}

export interface M0Section {
  issue: 25 | 84 | 85 | 86;
  title: string;
  tables: string[];
  mismatchIds: string[];
  status: "evidence-collected" | "review-required";
}

export interface M0AuditReport {
  reportVersion: "m0-parity-audit.v2";
  generatedAt: string;
  source: {
    airtableBaseId: string;
    postgresSchema: string;
    metadataAvailable: boolean;
    readMode: "Airtable GET + Postgres SELECT";
    sourceRevision: string;
    targetRevision: string;
    orgId?: string;
  };
  safety: {
    noMutation: true;
    immutableArtifact: true;
    dispositionVocabulary: readonly M0Disposition[];
    commands: string[];
  };
  scope: {
    tablesChecked: number;
    mappedTables: number;
    countDeltas: number;
    keyChecks: number;
    sourceIdChecks: number;
    deepChecks: number;
  };
  sections: M0Section[];
  mismatches: M0Mismatch[];
  proposedGroups: M0MismatchGroup[];
  individualReviewMismatchIds: string[];
  checks: {
    tableCounts: Array<{
      table: string;
      canonicalTable: string | null;
      sourceCount: number | null;
      canonicalCount: number | null;
      delta: number | null;
      status: string;
    }>;
    integrity: ParitySqlCheck[];
    readiness: ParitySqlCheck[];
    records: ParityRecordCheck[];
  };
}

const DOMAIN_TABLES: Record<M0Section["issue"], string[]> = {
  25: [],
  84: ["Artists", "Contacts"],
  85: ["Releases (And Artist Events)", "Release Tracks", "Recordings (Masters)", "Rights Lines (Roles)"],
  86: ["Contacts", "Rights Lines (Roles)"],
};

const DOMAIN_BY_TABLE: Array<{ domain: M0Mismatch["domain"]; tables: string[] }> = [
  { domain: "directory-boundary", tables: DOMAIN_TABLES[86] },
  { domain: "artist-relationships", tables: ["Artists"] },
  { domain: "release-rights", tables: DOMAIN_TABLES[85] },
];

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function redactValue(value: string): string {
  const digest = createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 12);
  if (value.includes("@")) return `[email:${digest}]`;
  if (/https?:\/\//i.test(value) || /(?:token|secret|api[-_ ]?key|pat)[-_:= ]/i.test(value) || /[a-z0-9_-]{40,}/i.test(value)) {
    return `[redacted:${digest}]`;
  }
  return value;
}

function domainForTable(table: string): M0Mismatch["domain"] {
  const entry = DOMAIN_BY_TABLE.find(({ tables }) => tables.includes(table));
  if (entry) return entry.domain;
  if (/contact|organization|credit|role/i.test(table)) return "directory-boundary";
  if (/artist|relationship/i.test(table)) return "artist-relationships";
  if (/release|track|work|right|readiness|clearance/i.test(table)) return "release-rights";
  return "release-ops";
}

function canonicalTableFor(table: string, tableResults: ParityTableResult[]): string | null {
  return tableResults.find((result) => result.spec.airtable === table)?.spec.postgres ?? null;
}

function mismatchBase(values: Omit<M0Mismatch, "proposedDisposition" | "owner" | "nextAction">): M0Mismatch {
  return {
    ...values,
    proposedDisposition: "Human review required",
    owner: "release-ops",
    nextAction: "Review source and canonical evidence, then record an explicit disposition before release sign-off.",
  };
}

function addCountMismatches(input: ParityReport, mismatches: M0Mismatch[]) {
  for (const result of input.tableResults) {
    const sourceCount = result.airtableCount;
    const canonicalCount = result.postgresCount;
    if (result.spec.status !== "mapped" || sourceCount === null || canonicalCount === null || sourceCount === canonicalCount) continue;
    const table = result.spec.airtable;
    mismatches.push(mismatchBase({
      id: `count:${slug(table)}${table === "Contacts" ? `:${slug(result.spec.postgres ?? "directory")}` : ""}`,
      domain: domainForTable(table),
      kind: "count_delta",
      sourceTable: table,
      canonicalTable: result.spec.postgres ?? null,
      sourceValue: String(sourceCount),
      canonicalValue: String(canonicalCount),
      sourceRecordIds: [...(result.sourceRecordIds ?? [])].sort(),
      canonicalRecordIds: [...(result.canonicalRecordIds ?? [])].sort(),
      comparisonField: "record-count",
      evidence: `Source count ${sourceCount}; canonical count ${canonicalCount}; delta ${canonicalCount - sourceCount}.`,
    }));
  }
}

function addKeyMismatches(input: ParityReport, mismatches: M0Mismatch[]) {
  for (const check of input.keyChecks) {
    const canonicalTable = check.canonicalTable ?? canonicalTableFor(check.table, input.tableResults);
    const missingRecords = check.missingInPostgresRecords ?? check.missingInPostgres.map((value) => ({
      identity: redactValue(value), recordIds: [], value,
    }));
    for (const record of [...missingRecords].sort((a, b) => a.identity.localeCompare(b.identity))) {
      const value = record.value;
      const safe = redactValue(value);
      mismatches.push(mismatchBase({
        id: `key:${slug(check.table)}:${slug(check.label)}:missing:${slug(record.identity)}${check.table === "Contacts" && canonicalTable === "organizations" ? ":organizations" : ""}`,
        domain: domainForTable(check.table),
        kind: "key_missing",
        sourceTable: check.table,
        canonicalTable,
        sourceValue: safe,
        canonicalValue: null,
        sourceRecordIds: [...record.recordIds].sort(),
        canonicalRecordIds: [],
        comparisonField: check.label,
        evidence: `Source ${check.label} key is absent from the canonical ${canonicalTable ?? "table"}.`,
      }));
    }
    const extraRecords = check.extraInPostgresRecords ?? check.extraInPostgres.map((value) => ({
      identity: redactValue(value), recordIds: [], value,
    }));
    for (const record of [...extraRecords].sort((a, b) => a.identity.localeCompare(b.identity))) {
      const value = record.value;
      const safe = redactValue(value);
      mismatches.push(mismatchBase({
        id: `key:${slug(check.table)}:${slug(check.label)}:extra:${slug(record.identity)}${check.table === "Contacts" && canonicalTable === "organizations" ? ":organizations" : ""}`,
        domain: domainForTable(check.table),
        kind: "key_extra",
        sourceTable: check.table,
        canonicalTable,
        sourceValue: null,
        canonicalValue: safe,
        sourceRecordIds: [],
        canonicalRecordIds: [...record.recordIds].sort(),
        comparisonField: check.label,
        evidence: `Canonical ${check.label} key is absent from the Airtable source result.`,
      }));
    }
  }
}

function addSourceIdMismatches(input: ParityReport, mismatches: M0Mismatch[]) {
  for (const check of input.sourceIdChecks) {
    if (check.preservedIds === check.importedRecords) continue;
    mismatches.push(mismatchBase({
      id: `source-id:${slug(check.airtable)}${check.airtable === "Contacts" && check.postgres === "organizations" ? ":organizations" : ""}`,
      domain: domainForTable(check.airtable),
      kind: "source_id",
      sourceTable: check.airtable,
      canonicalTable: check.postgres,
      sourceValue: `${check.importedRecords} evidenced imports (${check.airtableRecords} source records)`,
      canonicalValue: `${check.preservedIds} preserved source IDs`,
      sourceRecordIds: [...(check.sourceRecordIds ?? [])].sort(),
      canonicalRecordIds: [...(check.canonicalRecordIds ?? [])].sort(),
      comparisonField: "source-id",
      evidence: `Source-ID preservation is ${check.preservedIds}/${check.importedRecords} evidenced imports; the source contains ${check.airtableRecords} records.`,
    }));
  }
}

function addSqlMismatches(input: ParityReport, mismatches: M0Mismatch[], kind: "integrity" | "readiness") {
  const checks = kind === "integrity" ? input.integrityChecks : input.readinessChecks;
  for (const check of checks) {
    if (check.count <= 0) continue;
    const samples = [...new Set(check.samples)].sort();
    if (check.count !== samples.length) {
      throw new Error(`${check.label} must retain complete record identities (${samples.length}/${check.count})`);
    }
    for (const sample of samples) {
      mismatches.push(mismatchBase({
        id: `${kind}:${slug(check.label)}:${slug(sample)}`,
        domain: domainForTable(check.label),
        kind,
        sourceTable: "Label Suite integrity checks",
        canonicalTable: null,
        sourceValue: null,
        canonicalValue: sample,
        sourceRecordIds: [],
        canonicalRecordIds: [sample],
        comparisonField: check.label,
        evidence: `${check.label}: ${check.count} row(s) reported; sample ${sample}.`,
      }));
    }
  }
}

function sectionFor(issue: M0Section["issue"], mismatches: M0Mismatch[]): M0Section {
  const tables = issue === 25 ? [] : DOMAIN_TABLES[issue];
  const mismatchIds = mismatches
    .filter((mismatch) => issue === 25 || tables.includes(mismatch.sourceTable) || (mismatch.canonicalTable ? tables.includes(mismatch.canonicalTable) : false))
    .map((mismatch) => mismatch.id)
    .sort();
  return {
    issue,
    title: issue === 25
      ? "Airtable M0 parity and readiness sign-off"
      : issue === 84
        ? "Artist relationship cleanup/control consistency"
        : issue === 85
          ? "Release, rights, and Airtable sign-off"
          : "Contacts, credits, and organization boundary",
    tables,
    mismatchIds,
    status: mismatchIds.length ? "review-required" : "evidence-collected",
  };
}

export function buildM0Audit(input: ParityReport): M0AuditReport {
  if (!input.orgId?.trim()) throw new Error("M0 audit requires an explicit organization scope");
  if (input.directoryCounts?.length) input = { ...input, tableResults: [...input.tableResults.filter(result => result.spec.airtable !== "Contacts"), ...input.directoryCounts] };
  if (input.tableResults.some(result => result.truncated || result.error)) {
    throw new Error("M0 audit requires complete source evidence; truncated or failed tables cannot certify coverage.");
  }
  const mismatches: M0Mismatch[] = [];
  addCountMismatches(input, mismatches);
  addKeyMismatches(input, mismatches);
  addSourceIdMismatches(input, mismatches);
  addSqlMismatches(input, mismatches, "integrity");
  addSqlMismatches(input, mismatches, "readiness");
  const recordChecks = (input.recordChecks ?? []).map(check => ({
    ...check,
    sourceValue: check.sourceValue === null ? null : redactValue(check.sourceValue),
    sourceRawValue: check.sourceRawValue == null ? check.sourceRawValue : redactValue(check.sourceRawValue),
    canonicalValues: check.canonicalValues.map(value => value === null ? null : redactValue(value)),
  })).sort((a, b) =>
    `${a.table}/${a.sourceRecordId ?? a.canonicalRecordIds.join(",")}/${a.field}`.localeCompare(`${b.table}/${b.sourceRecordId ?? b.canonicalRecordIds.join(",")}/${b.field}`));
  for (const check of recordChecks) {
    if (check.status === "matched") continue;
    mismatches.push(mismatchBase({
      id: `record:${slug(check.table)}:${check.sourceRecordId ?? `canonical:${check.canonicalTable}:${check.canonicalRecordIds.join(",")}`}:${slug(check.field)}`,
      domain: domainForTable(check.table), kind: "record_value",
      sourceTable: check.table, canonicalTable: check.canonicalTable,
      sourceValue: check.sourceValue, canonicalValue: JSON.stringify(check.canonicalValues),
      sourceRecordIds: check.sourceRecordId === null ? [] : [check.sourceRecordId], canonicalRecordIds: check.canonicalRecordIds,
      comparisonField: check.field, evidence: `Source-ID record comparison: ${check.status}. No business-data correction is inferred.`,
    }));
  }

  const orderedMismatches = mismatches.sort((a, b) => a.id.localeCompare(b.id));
  const tableCounts = input.tableResults.map((result) => ({
    table: result.spec.airtable,
    canonicalTable: result.spec.postgres ?? null,
    sourceCount: result.airtableCount,
    canonicalCount: result.postgresCount,
    delta: result.airtableCount === null || result.postgresCount === null ? null : result.postgresCount - result.airtableCount,
    status: result.error ? `error: ${result.error}` : result.spec.status,
  }));
  const { proposedGroups, individualReviewMismatchIds } = groupMismatches(orderedMismatches, input.groupExceptions ?? {});

  return {
    reportVersion: "m0-parity-audit.v2",
    generatedAt: input.generatedAt,
    source: {
      airtableBaseId: input.baseId,
      postgresSchema: input.schema,
      metadataAvailable: input.metadataAvailable,
      readMode: "Airtable GET + Postgres SELECT",
      sourceRevision: input.sourceRevision ?? `airtable:${input.baseId}@${input.generatedAt}`,
      targetRevision: input.targetRevision ?? "not-supplied",
      orgId: input.orgId ?? "not-supplied",
    },
    safety: {
      noMutation: true,
      immutableArtifact: true,
      dispositionVocabulary: M0_DISPOSITIONS,
      commands: input.auditCommands ?? [
        "npm run airtable:parity -- --json --output <read-only-parity-artifact>",
        "git rev-parse HEAD",
      ],
    },
    scope: {
      tablesChecked: input.tableResults.length,
      mappedTables: input.tableResults.filter((result) => result.spec.status === "mapped").length,
      countDeltas: input.tableResults.filter((result) => result.spec.status === "mapped" && result.airtableCount !== null && result.postgresCount !== null && result.airtableCount !== result.postgresCount).length,
      keyChecks: input.keyChecks.length,
      sourceIdChecks: input.sourceIdChecks.length,
      deepChecks: input.integrityChecks.length + input.readinessChecks.length + recordChecks.length,
    },
    sections: [25, 84, 85, 86].map((issue) => sectionFor(issue as M0Section["issue"], orderedMismatches)),
    mismatches: orderedMismatches,
    proposedGroups,
    individualReviewMismatchIds,
    checks: {
      tableCounts,
      integrity: input.integrityChecks,
      readiness: input.readinessChecks,
      records: recordChecks,
    },
  };
}

function groupMismatches(
  mismatches: M0Mismatch[],
  configuredExceptions: Record<string, string[]>,
): { proposedGroups: M0MismatchGroup[]; individualReviewMismatchIds: string[] } {
  const candidates = new Map<string, string[]>();
  for (const mismatch of mismatches) {
    if (mismatch.kind === "count_delta" || mismatch.kind === "source_id") continue;
    const sharedRule = [
      mismatch.domain,
      mismatch.kind,
      mismatch.sourceTable,
      mismatch.canonicalTable ?? "none",
      mismatch.comparisonField,
    ].join("/");
    candidates.set(sharedRule, [...(candidates.get(sharedRule) ?? []), mismatch.id]);
  }

  const groupedMembers = new Set<string>();
  const proposedGroups = [...candidates.entries()].flatMap(([sharedRule, ids]) => {
    const allIds = [...ids].sort();
    const allowed = new Set(allIds);
    const exceptionMismatchIds = [...new Set(configuredExceptions[sharedRule] ?? [])]
      .filter((id) => allowed.has(id))
      .sort();
    const exceptions = new Set(exceptionMismatchIds);
    const memberMismatchIds = allIds.filter((id) => !exceptions.has(id));
    if (memberMismatchIds.length < 2) return [];
    memberMismatchIds.forEach((id) => groupedMembers.add(id));
    return [{
      id: `group:${createHash("sha256").update(sharedRule).digest("hex").slice(0, 16)}`,
      sharedRule,
      memberMismatchIds,
      exceptionMismatchIds,
      proposedDisposition: "Human review required" as const,
    }];
  }).sort((a, b) => a.id.localeCompare(b.id));

  return {
    proposedGroups,
    individualReviewMismatchIds: mismatches.map((row) => row.id).filter((id) => !groupedMembers.has(id)).sort(),
  };
}

export function renderM0Markdown(report: M0AuditReport): string {
  const cell = (value: string | null | undefined) => (value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
  const lines = [
    "# Immutable M0 Parity Audit",
    "",
    `Generated: ${report.generatedAt}`,
    `Report version: \`${report.reportVersion}\``,
    `Organization scope: \`${cell(report.source.orgId)}\``,
    `Airtable base: \`${report.source.airtableBaseId}\``,
    `Source revision: \`${report.source.sourceRevision}\``,
    `Postgres schema: \`${report.source.postgresSchema}\``,
    `Target revision: \`${report.source.targetRevision}\``,
    `Read mode: ${report.source.readMode}`,
    "",
    "## Safety",
    "",
    "- No Airtable or Postgres mutation is performed by this audit.",
    "- This artifact is immutable; write it to a new dated path rather than overwriting a prior report.",
    `- Every mismatch starts as \`${report.safety.dispositionVocabulary[3]}\` until an owner records a disposition.`,
    "- Sanitized read-only commands:",
    ...report.safety.commands.map((command) => `  - \`${cell(command)}\``),
    "",
    "## Scope",
    "",
    `- ${report.scope.tablesChecked} tables checked; ${report.scope.mappedTables} mapped tables.`,
    `- ${report.scope.countDeltas} mapped count deltas; ${report.scope.keyChecks} key checks; ${report.scope.sourceIdChecks} source-ID checks.`,
    `- ${report.mismatches.length} deterministic mismatch records; ${report.scope.deepChecks} integrity, readiness and record-field checks.`,
    "",
    "## M0 sections",
    "",
    "| Issue | Section | Status | Mismatches |",
    "|---:|---|---|---:|",
    ...report.sections.map((section) => `| #${section.issue} | ${section.title} | ${section.status} | ${section.mismatchIds.length} |`),
    "",
    "## Proposed grouped dispositions",
    "",
    "Each proposal is review-only. Its shared rule, complete immutable member list, and explicit exceptions are fixed in this packet; no correction is applied.",
    "",
    ...report.proposedGroups.flatMap((group) => [
      `### ${group.id}`,
      "",
      `- Shared rule: \`${cell(group.sharedRule)}\``,
      `- Proposed disposition: \`${group.proposedDisposition}\``,
      `- Complete immutable member list: ${group.memberMismatchIds.map((id) => `\`${cell(id)}\``).join(", ")}`,
      `- Exceptions: ${group.exceptionMismatchIds.length ? group.exceptionMismatchIds.map((id) => `\`${cell(id)}\``).join(", ") : "none"}`,
      "",
    ]),
    "## Individual review required",
    "",
    ...(report.individualReviewMismatchIds.length
      ? report.individualReviewMismatchIds.map((id) => `- \`${cell(id)}\``)
      : ["- None"]),
    "",
    "## Mismatch ledger",
    "",
    "| ID | Domain | Kind | Comparison field | Evidence | Source record IDs | Canonical record IDs | Source value | Canonical value | Proposed disposition | Owner | Next action |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...report.mismatches.map((mismatch) => `| ${cell(mismatch.id)} | ${cell(mismatch.domain)} | ${cell(mismatch.kind)} | ${cell(mismatch.comparisonField)} | ${cell(mismatch.evidence)} | ${cell(mismatch.sourceRecordIds.join(", "))} | ${cell(mismatch.canonicalRecordIds.join(", "))} | ${cell(mismatch.sourceValue)} | ${cell(mismatch.canonicalValue)} | ${cell(mismatch.proposedDisposition)} | ${cell(mismatch.owner)} | ${cell(mismatch.nextAction)} |`),
    "",
  ];
  return lines.join("\n");
}
