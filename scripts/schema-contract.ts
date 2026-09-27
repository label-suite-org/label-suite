import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

export interface MigrationManifest {
  journalTags: string[];
  sqlFiles: string[];
  duplicatePrefixes: string[];
  orphanSqlFiles: string[];
  missingSqlFiles: string[];
}

export interface MigrationIdentity {
  name: string;
  hash: string;
}

export interface AppliedMigration {
  id: number | string;
  hash: string;
}

export interface SchemaContract {
  version: 1;
  migrations: string[];
  tables: Array<{
    schema: string;
    name: string;
    columns: Array<{ name: string; dataType: string; nullable: boolean; defaultExpression: string | null }>;
    primaryKey: string[];
    foreignKeys: Array<{ columns: string[]; targetSchema: string; targetTable: string; targetColumns: string[] }>;
    uniqueConstraints: string[][];
    indexes: Array<{ name: string; unique: boolean; definition: string }>;
  }>;
}

export type DriftKind = "missing_migration" | "unexpected_migration" | "missing_table" | "unexpected_table" | "missing_column" | "unexpected_column" | "column_mismatch" | "primary_key_mismatch" | "foreign_key_mismatch" | "unique_constraint_mismatch" | "index_mismatch";
export interface Drift { kind: DriftKind; object: string; }

const driftKinds = new Set<DriftKind>([
  "missing_migration", "unexpected_migration", "missing_table", "unexpected_table", "missing_column", "unexpected_column", "column_mismatch", "primary_key_mismatch", "foreign_key_mismatch", "unique_constraint_mismatch", "index_mismatch",
]);
const driftDispositions = new Set<DriftDisposition>(["adopt", "retain", "remove_later"]);
const policyKeys = new Set(["version", "entries"]);
const policyEntryKeys = new Set(["kind", "object", "disposition", "owner", "source", "rationale", "followUpIssue"]);
const migrationSourcePattern = /^drizzle\/\d+_[A-Za-z0-9._-]+\.sql$/;
const migrationObjectPattern = /^(?:\d+_[a-z0-9_]+|ledger-row-\d+)@[a-f0-9]{64}$/;
const identifierPattern = /^[a-z_][a-z0-9_]*$/;

export type DriftDisposition = "adopt" | "retain" | "remove_later";
export interface DriftPolicyEntry extends Drift {
  disposition: DriftDisposition;
  owner: string;
  source: string;
  rationale: string;
  followUpIssue: string;
}
export interface DriftPolicy {
  version: 1;
  entries: DriftPolicyEntry[];
}
export interface DriftPolicyResolution {
  resolvedAdoptions: DriftPolicyEntry[];
  acceptedCurrentDrift: DriftPolicyEntry[];
  unresolvedDrift: Drift[];
  stalePolicy: DriftPolicyEntry[];
  isConsistent: boolean;
}

const policyIdentity = (entry: Pick<Drift, "kind" | "object">) => `${entry.kind}\u0000${entry.object}`;
const compareDrift = (left: Pick<Drift, "kind" | "object">, right: Pick<Drift, "kind" | "object">) => left.kind.localeCompare(right.kind) || left.object.localeCompare(right.object);
const sortedDrift = <T extends Drift>(entries: T[]) => [...entries].sort(compareDrift);

function isReportRevision(value: string): boolean {
  return /^[a-f0-9]{7,64}$/i.test(value);
}

function isNonEmptyMetadata(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && value.length > 0 && value.length <= 1_000;
}

interface GitCommitProvenance {
  host: string;
  owner: string;
  repository: string;
  commit: string;
}

type GitRepositoryIdentity = Pick<GitCommitProvenance, "host" | "owner" | "repository">;

const labelSuiteRepositoryLineage = new Set([
  "git.truenature.online/malthe/label-suite_neon_r2",
  "github.com/label-suite-org/label-suite_neon_r2",
  "github.com/malthelm/label-suite_neon_r2",
]);

function repositoryIdentity(repository: GitRepositoryIdentity): string {
  return `${repository.host}/${repository.owner}/${repository.repository}`.toLowerCase();
}

function isSameRepositoryLineage(left: GitRepositoryIdentity, right: GitRepositoryIdentity): boolean {
  const leftIdentity = repositoryIdentity(left);
  const rightIdentity = repositoryIdentity(right);
  return leftIdentity === rightIdentity
    || (labelSuiteRepositoryLineage.has(leftIdentity) && labelSuiteRepositoryLineage.has(rightIdentity));
}

function gitCommitProvenance(value: string): GitCommitProvenance | undefined {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    if (url.protocol !== "https:" || !["github.com", "git.truenature.online"].includes(url.hostname) || url.search || url.hash) return undefined;
    if (segments.length !== 4 || segments[2] !== "commit" || !/^[A-Za-z0-9_.-]+$/.test(segments[0])
      || !/^[A-Za-z0-9_.-]+$/.test(segments[1]) || !/^[a-f0-9]{7,64}$/i.test(segments[3])) return undefined;
    return { host: url.hostname, owner: segments[0], repository: segments[1], commit: segments[3] };
  } catch {
    return undefined;
  }
}

function isPolicySource(value: string): boolean {
  return migrationSourcePattern.test(value) || gitCommitProvenance(value) !== undefined;
}

function isDriftObject(kind: DriftKind, value: string): boolean {
  if (!isNonEmptyMetadata(value)) return false;
  if (kind === "missing_migration" || kind === "unexpected_migration") return migrationObjectPattern.test(value);
  const identifiers = value.split(".");
  const expectedCount = kind === "missing_column" || kind === "unexpected_column" || kind === "column_mismatch" ? 3 : 2;
  return identifiers.length === expectedCount && identifiers.every((identifier) => identifierPattern.test(identifier));
}

function isValidDrift(value: unknown): value is Drift {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Drift>;
  return driftKinds.has(candidate.kind as DriftKind) && typeof candidate.object === "string" && isDriftObject(candidate.kind as DriftKind, candidate.object);
}

function isGitHubIssueUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.search && !url.hash
      && segments.length === 4 && /^[A-Za-z0-9_.-]+$/.test(segments[0]) && /^[A-Za-z0-9_.-]+$/.test(segments[1])
      && segments[2] === "issues" && /^[1-9]\d*$/.test(segments[3]);
  } catch {
    return false;
  }
}

export function validateDriftPolicy(value: unknown): asserts value is DriftPolicy {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) throw new Error("Unsupported drift policy version");
  if (Object.keys(value).some((name) => !policyKeys.has(name))) throw new Error("Invalid drift policy");
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) throw new Error("Invalid drift policy entries");
  const identities = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some((name) => !policyEntryKeys.has(name))) throw new Error("Invalid drift policy entry");
    const candidate = entry as Partial<DriftPolicyEntry>;
    if (!driftKinds.has(candidate.kind as DriftKind) || !driftDispositions.has(candidate.disposition as DriftDisposition)
      || !isNonEmptyMetadata(candidate.object) || !isNonEmptyMetadata(candidate.owner) || !isNonEmptyMetadata(candidate.source)
      || !isNonEmptyMetadata(candidate.rationale) || !isNonEmptyMetadata(candidate.followUpIssue)
      || !isPolicySource(candidate.source) || !isGitHubIssueUrl(candidate.followUpIssue)) throw new Error("Invalid drift policy entry");
    if (!isDriftObject(candidate.kind as DriftKind, candidate.object)) throw new Error("Invalid drift policy entry");
    const identity = policyIdentity(candidate as Drift);
    if (identities.has(identity)) throw new Error("Duplicate drift policy entry");
    identities.add(identity);
  }
}

export function resolveDriftPolicy(policy: DriftPolicy, rawDrift: Drift[]): DriftPolicyResolution {
  validateDriftPolicy(policy);
  const entries = sortedDrift(policy.entries);
  const policyByIdentity = new Map(entries.map((entry) => [policyIdentity(entry), entry]));
  const currentIdentities = new Set<string>();
  const acceptedCurrentDrift: DriftPolicyEntry[] = [];
  const unresolvedDrift: Drift[] = [];
  const stalePolicy: DriftPolicyEntry[] = [];

  for (const drift of sortedDrift(rawDrift)) {
    if (!isValidDrift(drift)) throw new Error("Invalid raw schema drift");
    const identity = policyIdentity(drift);
    currentIdentities.add(identity);
    const entry = policyByIdentity.get(identity);
    if (!entry) unresolvedDrift.push({ kind: drift.kind, object: drift.object });
    else if (entry.disposition === "adopt") stalePolicy.push(entry);
    else acceptedCurrentDrift.push(entry);
  }

  const resolvedAdoptions = entries.filter((entry) => entry.disposition === "adopt" && !currentIdentities.has(policyIdentity(entry)));
  for (const entry of entries) {
    if (entry.disposition !== "adopt" && !currentIdentities.has(policyIdentity(entry))) stalePolicy.push(entry);
  }
  const orderedStalePolicy = sortedDrift(stalePolicy);
  return {
    resolvedAdoptions,
    acceptedCurrentDrift: sortedDrift(acceptedCurrentDrift),
    unresolvedDrift: sortedDrift(unresolvedDrift),
    stalePolicy: orderedStalePolicy,
    isConsistent: unresolvedDrift.length === 0 && orderedStalePolicy.length === 0,
  };
}

type SanitizedPolicyEntry = Pick<DriftPolicyEntry, "kind" | "object" | "disposition">;
export interface SchemaDriftReport {
  contractVersion: 1;
  policyVersion: 1;
  revision?: string;
  resolvedAdoptions: SanitizedPolicyEntry[];
  acceptedCurrentDrift: SanitizedPolicyEntry[];
  unresolvedDrift: Drift[];
  stalePolicy: SanitizedPolicyEntry[];
  summary: { resolvedAdoptions: number; acceptedCurrentDrift: number; unresolvedDrift: number; stalePolicy: number; };
}

function sanitizedPolicyEntry(entry: DriftPolicyEntry): SanitizedPolicyEntry {
  return {
    kind: entry.kind,
    object: entry.object,
    disposition: entry.disposition,
  };
}

export function buildSchemaDriftReport(policy: DriftPolicy, rawDrift: Drift[], revision?: string): SchemaDriftReport {
  validateDriftPolicy(policy);
  if (revision !== undefined && !isReportRevision(revision)) throw new Error("Invalid report revision");
  const resolution = resolveDriftPolicy(policy, rawDrift);
  return {
    contractVersion: 1,
    policyVersion: policy.version,
    ...(revision === undefined ? {} : { revision }),
    resolvedAdoptions: resolution.resolvedAdoptions.map(sanitizedPolicyEntry),
    acceptedCurrentDrift: resolution.acceptedCurrentDrift.map(sanitizedPolicyEntry),
    unresolvedDrift: resolution.unresolvedDrift.map((drift) => ({ kind: drift.kind, object: drift.object })),
    stalePolicy: resolution.stalePolicy.map(sanitizedPolicyEntry),
    summary: {
      resolvedAdoptions: resolution.resolvedAdoptions.length,
      acceptedCurrentDrift: resolution.acceptedCurrentDrift.length,
      unresolvedDrift: resolution.unresolvedDrift.length,
      stalePolicy: resolution.stalePolicy.length,
    },
  };
}

export function validateContractVersion(value: unknown): asserts value is SchemaContract {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) throw new Error("Unsupported schema contract version");
}

export function normalizeDefault(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value.replace(/\s+/g, " ").trim().replace(/^\((.*)\)$/s, "$1").trim();
}

export function migrationManifest(journal: { entries?: Array<{ tag?: string }> }, sqlFiles: string[]): MigrationManifest {
  const journalTags = (journal.entries ?? []).map((entry) => entry.tag ?? "").filter(Boolean).sort();
  const files = sqlFiles.map((file) => basename(file, ".sql")).filter(Boolean).sort();
  const prefixGroups = new Map<string, string[]>();
  for (const file of files) { const prefix = file.match(/^(\d+)_/)?.[1]; if (prefix) prefixGroups.set(prefix, [...(prefixGroups.get(prefix) ?? []), file]); }
  const duplicatePrefixes = [...prefixGroups.entries()].filter(([, values]) => values.length > 1).map(([prefix]) => prefix).sort();
  return { journalTags, sqlFiles: files, duplicatePrefixes, orphanSqlFiles: files.filter((file) => !journalTags.includes(file)), missingSqlFiles: journalTags.filter((tag) => !files.includes(tag)) };
}

export function validateMigrationManifest(manifest: MigrationManifest): string[] {
  return [
    ...manifest.duplicatePrefixes.map((prefix) => `migration-prefix:${prefix}`),
    ...manifest.orphanSqlFiles.map((file) => `orphan-migration:${file}`),
    ...manifest.missingSqlFiles.map((file) => `missing-migration-sql:${file}`),
  ].sort();
}

export function identifyAppliedMigrations(
  ledgerRows: AppliedMigration[],
  canonicalMigrations: MigrationIdentity[],
): string[] {
  const canonicalNamesByHash = new Map<string, string[]>();
  const ledgerCountByHash = new Map<string, number>();
  for (const migration of canonicalMigrations) {
    canonicalNamesByHash.set(migration.hash, [...(canonicalNamesByHash.get(migration.hash) ?? []), migration.name]);
  }
  for (const row of ledgerRows) {
    ledgerCountByHash.set(row.hash, (ledgerCountByHash.get(row.hash) ?? 0) + 1);
  }
  return ledgerRows.map((row) => {
    const names = canonicalNamesByHash.get(row.hash) ?? [];
    const canonicalName = names.length === 1 && ledgerCountByHash.get(row.hash) === 1 ? names[0] : undefined;
    return `${canonicalName ?? `ledger-row-${row.id}`}@${row.hash}`;
  });
}

const key = (values: unknown) => JSON.stringify(values);
const sorted = (values: string[][]) => values.map((v) => [...v]).sort((a, b) => key(a).localeCompare(key(b)));

export function compareContracts(expected: SchemaContract, actual: SchemaContract): Drift[] {
  const drift: Drift[] = [];
  const expectedMigrations = new Set(expected.migrations), actualMigrations = new Set(actual.migrations);
  for (const value of [...expectedMigrations].filter((v) => !actualMigrations.has(v)).sort()) drift.push({ kind: "missing_migration", object: value });
  for (const value of [...actualMigrations].filter((v) => !expectedMigrations.has(v)).sort()) drift.push({ kind: "unexpected_migration", object: value });
  const tableKey = (t: { schema: string; name: string }) => `${t.schema}.${t.name}`;
  const et = new Map(expected.tables.map((t) => [tableKey(t), t])), at = new Map(actual.tables.map((t) => [tableKey(t), t]));
  for (const name of [...et.keys()].filter((v) => !at.has(v)).sort()) drift.push({ kind: "missing_table", object: name });
  for (const name of [...at.keys()].filter((v) => !et.has(v)).sort()) drift.push({ kind: "unexpected_table", object: name });
  for (const name of [...et.keys()].filter((v) => at.has(v)).sort()) {
    const e = et.get(name)!; const a = at.get(name)!;
    const ec = new Map(e.columns.map((c) => [c.name, c])), ac = new Map(a.columns.map((c) => [c.name, c]));
    for (const c of [...ec.keys()].filter((v) => !ac.has(v)).sort()) drift.push({ kind: "missing_column", object: `${name}.${c}` });
    for (const c of [...ac.keys()].filter((v) => !ec.has(v)).sort()) drift.push({ kind: "unexpected_column", object: `${name}.${c}` });
    for (const c of [...ec.keys()].filter((v) => ac.has(v)).sort()) if (JSON.stringify(ec.get(c)) !== JSON.stringify(ac.get(c))) drift.push({ kind: "column_mismatch", object: `${name}.${c}` });
    if (key(e.primaryKey) !== key(a.primaryKey)) drift.push({ kind: "primary_key_mismatch", object: name });
    if (key(sorted(e.foreignKeys.map((f) => [...f.columns, f.targetSchema, f.targetTable, ...f.targetColumns]))) !== key(sorted(a.foreignKeys.map((f) => [...f.columns, f.targetSchema, f.targetTable, ...f.targetColumns])))) drift.push({ kind: "foreign_key_mismatch", object: name });
    if (key(sorted(e.uniqueConstraints)) !== key(sorted(a.uniqueConstraints))) drift.push({ kind: "unique_constraint_mismatch", object: name });
    const ei = new Map(e.indexes.map((i) => [i.name, i])), ai = new Map(a.indexes.map((i) => [i.name, i]));
    if (JSON.stringify([...ei.entries()].sort()) !== JSON.stringify([...ai.entries()].sort())) drift.push({ kind: "index_mismatch", object: name });
  }
  return drift;
}

const TABLE_QUERY = `SELECT c.table_schema AS schema, c.table_name AS name, c.column_name AS column_name,
  format_type(a.atttypid, a.atttypmod) AS data_type, c.is_nullable = 'YES' AS nullable,
  c.column_default AS default_expression, c.ordinal_position
  FROM information_schema.columns c JOIN pg_namespace n ON n.nspname=c.table_schema
  JOIN pg_class cl ON cl.relnamespace=n.oid AND cl.relname=c.table_name
  JOIN pg_attribute a ON a.attrelid=cl.oid AND a.attname=c.column_name
  WHERE c.table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
    AND NOT (c.table_schema='drizzle' AND c.table_name='__drizzle_migrations')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=cl.oid AND d.deptype='e')
  ORDER BY c.table_schema, c.table_name, c.ordinal_position`;

export async function captureSchemaContract(client: PoolClient, canonicalMigrations: MigrationIdentity[] = []): Promise<SchemaContract> {
  await client.query("SET LOCAL search_path TO label_suite, public, pg_catalog");
  const tables = new Map<string, any>();
  const cols = await client.query(TABLE_QUERY);
  for (const row of cols.rows) { const id = `${row.schema}.${row.name}`; if (!tables.has(id)) tables.set(id, { schema: row.schema, name: row.name, columns: [], primaryKey: [], foreignKeys: [], uniqueConstraints: [], indexes: [] }); tables.get(id).columns.push({ name: row.column_name, dataType: row.data_type, nullable: row.nullable, defaultExpression: normalizeDefault(row.default_expression) }); }
  const constraints = await client.query(`SELECT n.nspname AS schema, cl.relname AS name, con.contype, array_agg(att.attname ORDER BY u.ord) AS columns, fn.nspname AS target_schema, fcl.relname AS target_table, array_agg(fatt.attname ORDER BY u.ord) FILTER (WHERE con.contype='f') AS target_columns FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace LEFT JOIN LATERAL unnest(con.conkey) WITH ORDINALITY u(attnum,ord) ON true LEFT JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=u.attnum LEFT JOIN pg_class fcl ON fcl.oid=con.confrelid LEFT JOIN pg_namespace fn ON fn.oid=fcl.relnamespace LEFT JOIN pg_attribute fatt ON fatt.attrelid=con.confrelid AND fatt.attnum=con.confkey[u.ord] WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND NOT (n.nspname='drizzle' AND cl.relname='__drizzle_migrations') GROUP BY n.nspname,cl.relname,con.oid,fn.nspname,fcl.relname ORDER BY n.nspname,cl.relname,con.oid`);
  for (const row of constraints.rows) { const table = tables.get(`${row.schema}.${row.name}`); if (!table) continue; if (row.contype === "p") table.primaryKey = row.columns; else if (row.contype === "u") table.uniqueConstraints.push(row.columns); else if (row.contype === "f") table.foreignKeys.push({ columns: row.columns, targetSchema: row.target_schema, targetTable: row.target_table, targetColumns: row.target_columns }); }
  const indexes = await client.query(`SELECT i.schemaname AS schema, i.tablename AS table_name, i.indexname AS name, i.indexdef AS definition, i.indexdef LIKE 'CREATE UNIQUE INDEX%' AS unique FROM pg_indexes i JOIN pg_class cl ON cl.relname=i.indexname JOIN pg_namespace n ON n.oid=cl.relnamespace AND n.nspname=i.schemaname WHERE i.schemaname NOT IN ('pg_catalog','information_schema','pg_toast') AND NOT (i.schemaname='drizzle' AND i.tablename='__drizzle_migrations') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=cl.oid AND d.deptype='e') ORDER BY i.schemaname,i.tablename,i.indexname`);
  for (const row of indexes.rows) { const table = tables.get(`${row.schema}.${row.table_name}`); if (table) table.indexes.push({ name: row.name, unique: row.unique, definition: row.definition.replace(/\s+/g, " ").trim() }); }
  let migrations = canonicalMigrations.map((migration) => `${migration.name}@${migration.hash}`);
  try {
    const ledger = await client.query(`SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY id`);
    migrations = identifyAppliedMigrations(ledger.rows, canonicalMigrations);
  } catch (error: any) {
    if (error?.code !== "42P01") throw error;
    migrations = [];
  }
  return { version: 1, migrations, tables: [...tables.values()].sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`)) };
}

const repositoryRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

function git(repository: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", repository, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
  } catch {
    return undefined;
  }
}

function gitRepositoryFromRemote(value: string): { host: string; owner: string; repository: string } | undefined {
  try {
    const url = new URL(value);
    const segments = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    if (!["github.com", "git.truenature.online"].includes(url.hostname) || segments.length !== 2) return undefined;
    return { host: url.hostname, owner: segments[0], repository: segments[1] };
  } catch {
    const match = value.match(/^git@(github\.com|git\.truenature\.online):([^/]+)\/([^/]+?)(?:\.git)?$/);
    return match ? { host: match[1], owner: match[2], repository: match[3] } : undefined;
  }
}

export function verifyDriftPolicyProvenance(policy: DriftPolicy, repository = repositoryRoot): void {
  validateDriftPolicy(policy);
  const checkoutRoot = git(repository, ["rev-parse", "--show-toplevel"]);
  if (!checkoutRoot) throw new Error("Unverifiable drift policy provenance");
  const checkoutPrefix = `${checkoutRoot}/`;
  const origin = git(checkoutRoot, ["remote", "get-url", "origin"]);
  const originRepository = origin ? gitRepositoryFromRemote(origin) : undefined;

  for (const entry of policy.entries) {
    if (migrationSourcePattern.test(entry.source)) {
      const sourcePath = resolve(checkoutRoot, entry.source);
      if (!sourcePath.startsWith(checkoutPrefix)) throw new Error("Unverifiable drift policy provenance");
      try {
        if (!lstatSync(sourcePath).isFile()) throw new Error("Unverifiable drift policy provenance");
      } catch {
        throw new Error("Unverifiable drift policy provenance");
      }
      const indexEntry = git(checkoutRoot, ["ls-files", "--stage", "--error-unmatch", "--", entry.source]);
      const match = indexEntry?.match(/^(\d+)\s+([0-9a-f]+)\s+(\d+)\s+(.+)$/i);
      if (!match || match[3] !== "0" || match[4] !== entry.source
        || git(checkoutRoot, ["cat-file", "-t", match[2]]) !== "blob"
        || git(checkoutRoot, ["hash-object", "--no-filters", "--", entry.source]) !== match[2]) {
        throw new Error("Unverifiable drift policy provenance");
      }
      continue;
    }

    const provenance = gitCommitProvenance(entry.source);
    if (!provenance || !originRepository || !isSameRepositoryLineage(provenance, originRepository)) {
      throw new Error("Unverifiable drift policy provenance");
    }
    const commit = git(checkoutRoot, ["rev-parse", "--verify", `${provenance.commit}^{commit}`]);
    const reachableRefs = commit ? git(checkoutRoot, ["for-each-ref", "--contains", commit, "--format=%(refname)"]) : undefined;
    if (!reachableRefs) throw new Error("Unverifiable drift policy provenance");
  }
}

async function manifestFromDisk() { const journal = JSON.parse(await readFile(resolve(repositoryRoot, "drizzle/meta/_journal.json"), "utf8")); const files = (await readdir(resolve(repositoryRoot, "drizzle"))).filter((f) => /^\d+_.+\.sql$/.test(f)); return migrationManifest(journal, files); }
async function migrationIdentitiesFromDisk(migrationNames: string[]): Promise<MigrationIdentity[]> {
  return Promise.all(migrationNames.map(async (name) => {
    const sql = await readFile(resolve(repositoryRoot, "drizzle", `${name}.sql`), "utf8");
    return { name, hash: createHash("sha256").update(sql).digest("hex") };
  }));
}
function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
function requiredArg(name: string): string {
  const value = arg(name);
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}
async function driftPolicyFromDisk(path: string, verifyProvenance = false): Promise<DriftPolicy> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolve(path), "utf8"));
  } catch {
    throw new Error("Invalid drift policy JSON");
  }
  validateDriftPolicy(value);
  if (verifyProvenance) verifyDriftPolicyProvenance(value);
  return value;
}

async function main() {
  const mode = process.argv[2]; if (mode !== "capture" && mode !== "check" && mode !== "manifest-check" && mode !== "policy-check") throw new Error("Usage: schema-contract.ts capture|check|manifest-check|policy-check");
  if (mode === "policy-check") {
    await driftPolicyFromDisk(requiredArg("--policy"), true);
    return;
  }
  const manifest = await manifestFromDisk();
  const manifestDrift = validateMigrationManifest(manifest);
  if (manifestDrift.length) { for (const item of manifestDrift) console.error(item); process.exitCode = 1; return; }
  if (mode === "manifest-check") return;
  const canonicalMigrations = await migrationIdentitiesFromDisk(manifest.journalTags);
  let expected: SchemaContract | undefined;
  let policy: DriftPolicy | undefined;
  let reportPath: string | undefined;
  let revision: string | undefined;
  if (mode === "check") {
    const expectedValue: unknown = JSON.parse(await readFile(resolve(requiredArg("--contract")), "utf8"));
    validateContractVersion(expectedValue);
    expected = expectedValue;
    policy = await driftPolicyFromDisk(requiredArg("--policy"), true);
    reportPath = arg("--report");
    revision = arg("--revision");
    if (revision !== undefined && !isReportRevision(revision)) throw new Error("Invalid report revision");
    if (revision !== undefined) {
      const head = git(repositoryRoot, ["rev-parse", "HEAD"]);
      const revisionCommit = git(repositoryRoot, ["rev-parse", "--verify", `${revision}^{commit}`]);
      if (!head || revisionCommit !== head) throw new Error("Report revision must match HEAD");
    }
  }
  const envName = arg("--database-url-env"); if (!envName || !/^[A-Z][A-Z0-9_]*$/.test(envName)) throw new Error("--database-url-env must be an environment variable name");
  const databaseUrl = process.env[envName]; if (!databaseUrl) throw new Error(`Environment variable ${envName} is required`);
  const pool = new Pool({ connectionString: databaseUrl }); const client = await pool.connect();
  try { await client.query("BEGIN"); await client.query("SET TRANSACTION READ ONLY"); const contract = await captureSchemaContract(client, canonicalMigrations);
    if (mode === "capture") { const output = requiredArg("--output"); await writeFile(resolve(output), `${JSON.stringify(contract, null, 2)}\n`); }
    else {
      const rawDrift = compareContracts(expected!, contract);
      const resolution = resolveDriftPolicy(policy!, rawDrift);
      if (reportPath) await writeFile(resolve(reportPath), `${JSON.stringify(buildSchemaDriftReport(policy!, rawDrift, revision), null, 2)}\n`);
      if (!resolution.isConsistent) {
        for (const item of resolution.unresolvedDrift) console.error(`unresolved ${item.kind}: ${item.object}`);
        for (const item of resolution.stalePolicy) console.error(`stale ${item.disposition}: ${item.kind}: ${item.object}`);
        process.exitCode = 1;
      }
    }
    await client.query("ROLLBACK");
  } finally { client.release(); await pool.end(); }
}

if (process.argv[1]?.endsWith("schema-contract.ts")) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
