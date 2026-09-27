import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDisposableRoyaltyLifecycleTarget } from "./royalty-lifecycle-integration-target";
import { shouldDropOwnedDisposableRole } from "./royalty-lifecycle-test-role-ownership";

const integrationEnvironment = {
  databaseUrl: process.env.ROYALTY_LIFECYCLE_TEST_DATABASE_URL,
  testDatabase: process.env.ROYALTY_LIFECYCLE_TEST_DATABASE,
  disposable: process.env.ROYALTY_LIFECYCLE_TEST_DISPOSABLE,
};
const hasExplicitDisposableTarget = integrationEnvironment.testDatabase === "1" && integrationEnvironment.disposable === "1";
const describeDisposable = hasExplicitDisposableTarget ? describe : describe.skip;

const orgA = "royalty-lifecycle-test-org-a";
const orgB = "royalty-lifecycle-test-org-b";
const userA = "royalty-lifecycle-test-user-a";
const userB = "royalty-lifecycle-test-user-b";
const userMember = "royalty-lifecycle-test-user-member";
const contactA = "royalty-lifecycle-test-contact-a";
const contactB = "royalty-lifecycle-test-contact-b";
const legacyOrg = "royalty-lifecycle-test-legacy-org";
const legacyImport = "royalty_import_0123456789abcdef01234567";
const malformedLegacyImport = "royaltyXimportY0123456789abcdef01234567";
const rlsRole = "royalty_lifecycle_test_reader";
const ordinaryMutationRole = "royalty_lifecycle_test_mutator";
const runtimeRole = "royalty_lifecycle_test_runtime";
const runtimePassword = "royalty-lifecycle-test-runtime-password";

let client: Sql | undefined;
let adminClient: Sql | undefined;
let ownsRlsRole = false;
let ownsOrdinaryMutationRole = false;
let ownsRuntimeRole = false;
let grantedRlsSchemaUsage = false;
let grantedRlsStatementSelect = false;
let grantedOrdinarySchemaUsage = false;
let grantedOrdinaryStatementUpdate = false;
let grantedOrdinaryStatementSelect = false;
let lifecycleDatabaseUrl: string | undefined;
let disposableDatabaseName: string | undefined;
let originalDatabaseOwner: string | undefined;
let migrationCompleted = false;

async function inTransaction<T>(operation: (sql: Sql) => Promise<T>): Promise<T> {
  if (!client) throw new Error("Royalty lifecycle integration database was not initialized.");
  await client`BEGIN`;
  try {
    return await operation(client);
  } finally {
    await client`ROLLBACK`;
  }
}

async function setTenantContext(sql: Sql, orgId: string, actorUserId?: string): Promise<void> {
  await sql`select set_config('app.current_org_id', ${orgId}, true)`;
  if (actorUserId) await sql`select set_config('app.current_user_id', ${actorUserId}, true)`;
}

async function establishLifecycleContext(sql: Sql, orgId: string, actorUserId: string): Promise<void> {
  await sql`select "label_suite"."establish_royalty_lifecycle_context"(${orgId}, ${actorUserId})`;
}

async function commitTransaction<T>(sql: Sql, operation: (transaction: Sql) => Promise<T>): Promise<T> {
  await sql`BEGIN`;
  try {
    const result = await operation(sql);
    await sql`COMMIT`;
    return result;
  } catch (error) {
    await sql`ROLLBACK`;
    throw error;
  }
}

async function waitForDatabaseLock(observer: Sql, backendPid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const rows = await observer<{ wait_event_type: string | null }[]>`
      select wait_event_type
      from pg_stat_activity
      where pid = ${backendPid}
    `;
    if (rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  throw new Error(`Expected PostgreSQL backend ${backendPid} to block on a transaction-header lock.`);
}

async function cleanupCommittedRaceFixtures(sql: Sql, transactionIds: string[]): Promise<void> {
  // Posted rows are intentionally append-only. This is disposable-harness-only
  // cleanup, scoped to the committed fixtures required for two-session proofs.
  await commitTransaction(sql, async (transaction) => {
    await transaction.unsafe("SET LOCAL session_replication_role = replica");
    await transaction`
      delete from "label_suite"."audit_logs"
      where "entity_id" = any(${transactionIds})
    `;
    await transaction`
      delete from "label_suite"."royalty_ledger_entries"
      where "transaction_id" = any(${transactionIds})
    `;
    await transaction`
      delete from "label_suite"."royalty_ledger_transactions"
      where "id" = any(${transactionIds})
    `;
  });
}

async function cleanupCommittedRaceTenantRows(sql: Sql): Promise<void> {
  await commitTransaction(sql, async (transaction) => {
    await transaction.unsafe("SET LOCAL session_replication_role = replica");
    await transaction`
      delete from "label_suite"."audit_logs"
      where "org_id" in (${orgA}, ${orgB})
    `;
    await transaction`
      delete from "label_suite"."royalty_ledger_entries"
      where "org_id" in (${orgA}, ${orgB})
    `;
    await transaction`
      delete from "label_suite"."royalty_ledger_transactions"
      where "org_id" in (${orgA}, ${orgB})
    `;
    await transaction`
      delete from "label_suite"."contacts"
      where "id" in (${contactA}, ${contactB})
    `;
    await transaction`
      delete from "label_suite"."org_memberships"
      where "org_id" in (${orgA}, ${orgB})
    `;
    await transaction`
      delete from "label_suite"."user"
      where "id" in (${userA}, ${userB}, ${userMember})
    `;
    await transaction`
      delete from "label_suite"."orgs"
      where "id" in (${orgA}, ${orgB})
    `;
  });
}

async function createLegacyCompletedImportFixture(sql: Sql): Promise<void> {
  await commitTransaction(sql, async (transaction) => {
    await transaction`
      insert into "label_suite"."orgs" ("id", "name", "slug")
      values (${legacyOrg}, 'Royalty lifecycle legacy test', 'royalty-lifecycle-test-legacy')
    `;
    await transaction`alter table "label_suite"."royalty_imports" drop constraint "royalty_imports_status_canonical_check"`;
    await transaction.unsafe("SET LOCAL session_replication_role = replica");
    await transaction`
      insert into "label_suite"."royalty_imports" (
        "id", "org_id", "source", "status", "sha256", "row_count", "matched_count", "unmatched_count"
      ) values
        (${legacyImport}, ${legacyOrg}, 'airtable_sheet', 'completed', 'legacy-completed-checksum', 2, 1, 1),
        (${malformedLegacyImport}, ${legacyOrg}, 'airtable_sheet', 'completed', 'malformed-legacy-checksum', 2, 1, 1)
    `;
    await transaction.unsafe("SET LOCAL session_replication_role = origin");
    await transaction`
      alter table "label_suite"."royalty_imports"
      add constraint "royalty_imports_status_canonical_check"
      check ("status" in ('received', 'parsing', 'parsed', 'failed', 'superseded')) not valid
    `;
  });
}

async function cleanupLegacyCompletedImportFixture(sql: Sql): Promise<void> {
  await commitTransaction(sql, async (transaction) => {
    await transaction.unsafe("SET LOCAL session_replication_role = replica");
    await transaction`delete from "label_suite"."audit_logs" where "entity_id" in (${legacyImport}, ${malformedLegacyImport})`;
    await transaction`delete from "label_suite"."royalty_imports" where "id" in (${legacyImport}, ${malformedLegacyImport})`;
    await transaction`delete from "label_suite"."orgs" where "id" = ${legacyOrg}`;
    await transaction.unsafe("SET LOCAL session_replication_role = origin");
    await transaction`alter table "label_suite"."royalty_imports" validate constraint "royalty_imports_status_canonical_check"`;
  });
}

async function seedCommittedRaceTenantRows(sql: Sql): Promise<void> {
  await setTenantContext(sql, orgA, userA);
  await sql`
    insert into "label_suite"."orgs" ("id", "name", "slug") values
      (${orgA}, 'Royalty lifecycle test A', 'royalty-lifecycle-test-a'),
      (${orgB}, 'Royalty lifecycle test B', 'royalty-lifecycle-test-b')
    on conflict ("id") do nothing
  `;
  await sql`
    insert into "label_suite"."user" ("id", "name", "email") values
      (${userA}, 'Royalty lifecycle tester A', 'royalty-lifecycle-test-a@example.test'),
      (${userB}, 'Royalty lifecycle tester B', 'royalty-lifecycle-test-b@example.test'),
      (${userMember}, 'Royalty lifecycle tester member', 'royalty-lifecycle-test-member@example.test')
    on conflict ("id") do nothing
  `;
  await sql`
    insert into "label_suite"."org_memberships" ("id", "org_id", "user_id", "role") values
      ('royalty-lifecycle-test-membership-a', ${orgA}, ${userA}, 'owner'),
      ('royalty-lifecycle-test-membership-b', ${orgB}, ${userB}, 'owner'),
      ('royalty-lifecycle-test-membership-member', ${orgA}, ${userMember}, 'member')
    on conflict ("id") do nothing
  `;
  await sql`
    insert into "label_suite"."contacts" ("id", "org_id", "name") values
      (${contactA}, ${orgA}, 'Lifecycle contact A'),
      (${contactB}, ${orgB}, 'Lifecycle contact B')
    on conflict ("id") do nothing
  `;
}

async function roleExists(sql: Sql, role: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    select exists(select 1 from pg_roles where rolname = ${role}) as "exists"
  `;
  return rows[0]?.exists === true;
}

async function ensureNoLoginRole(sql: Sql, role: string): Promise<boolean> {
  if (await roleExists(sql, role)) return false;
  await sql.unsafe(`CREATE ROLE ${role} NOLOGIN`);
  return true;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function createRuntimeLoginRole(sql: Sql): Promise<void> {
  if (await roleExists(sql, runtimeRole)) {
    throw new Error(`Refusing to reuse pre-existing disposable runtime role ${runtimeRole}.`);
  }
  await sql.unsafe(`CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  ownsRuntimeRole = true;
}

async function hasPrivilege(sql: Sql, role: string, privilege: string, target: string): Promise<boolean> {
  const rows = await sql<{ allowed: boolean }[]>`
    select has_table_privilege(${role}, ${target}, ${privilege}) as "allowed"
  `;
  return rows[0]?.allowed === true;
}

async function hasSchemaUsage(sql: Sql, role: string): Promise<boolean> {
  const rows = await sql<{ allowed: boolean }[]>`
    select has_schema_privilege(${role}, 'label_suite', 'USAGE') as "allowed"
  `;
  return rows[0]?.allowed === true;
}

async function expectDatabaseError(sql: Sql, operation: () => Promise<unknown>, expectedMessage: string): Promise<void> {
  await sql`SAVEPOINT expected_database_failure`;
  try {
    let databaseError: unknown;
    try {
      await operation();
    } catch (error) {
      databaseError = error;
    }
    if (!databaseError) {
      throw new Error(`Expected database error containing ${expectedMessage}`);
    }
    expect(databaseError).toHaveProperty("message");
    expect(String((databaseError as Error).message)).toContain(expectedMessage);
  } finally {
    await sql`ROLLBACK TO SAVEPOINT expected_database_failure`;
    await sql`RELEASE SAVEPOINT expected_database_failure`;
  }
}

async function seedTenantRows(sql: Sql): Promise<void> {
  await setTenantContext(sql, orgA, userA);
  await sql`
    insert into "label_suite"."orgs" ("id", "name", "slug") values
      (${orgA}, 'Royalty lifecycle test A', 'royalty-lifecycle-test-a'),
      (${orgB}, 'Royalty lifecycle test B', 'royalty-lifecycle-test-b')
  `;
  await sql`
    insert into "label_suite"."user" ("id", "name", "email") values
      (${userA}, 'Royalty lifecycle tester A', 'royalty-lifecycle-test-a@example.test'),
      (${userB}, 'Royalty lifecycle tester B', 'royalty-lifecycle-test-b@example.test'),
      (${userMember}, 'Royalty lifecycle tester member', 'royalty-lifecycle-test-member@example.test')
  `;
  await sql`
    insert into "label_suite"."org_memberships" ("id", "org_id", "user_id", "role") values
      ('royalty-lifecycle-test-membership-a', ${orgA}, ${userA}, 'owner'),
      ('royalty-lifecycle-test-membership-b', ${orgB}, ${userB}, 'owner'),
      ('royalty-lifecycle-test-membership-member', ${orgA}, ${userMember}, 'member')
  `;
  await sql`
    insert into "label_suite"."contacts" ("id", "org_id", "name") values
      (${contactA}, ${orgA}, 'Lifecycle contact A'),
      (${contactB}, ${orgB}, 'Lifecycle contact B')
  `;
}

async function insertDraftStatement(sql: Sql, id: string, contactId = contactA, orgId = orgA): Promise<void> {
  await sql`
    insert into "label_suite"."royalty_statements" (
      "id", "org_id", "contact_id", "period_start", "period_end", "currency",
      "opening_balance", "earnings_amount", "adjustments_amount", "payout_amount", "closing_balance"
    ) values (
      ${id}, ${orgId}, ${contactId}, '2026-01-01', '2026-01-31', 'USD',
      '0.00000000', '0.00000000', '0.00000000', '0.00000000', '0.00000000'
    )
  `;
}

async function insertRepresentativeFinancialRows(
  sql: Sql,
  suffix: "a" | "b",
  orgId: string,
  userId: string,
  contactId: string,
): Promise<void> {
  const prefix = `royalty-lifecycle-test-complete-rls-${suffix}`;
  await setTenantContext(sql, orgId, userId);
  await sql`insert into "label_suite"."works" ("id", "org_id", "title") values (${`${prefix}-work`}, ${orgId}, ${`RLS work ${suffix}`})`;
  await sql`
    insert into "label_suite"."royalty_imports" ("id", "org_id", "source")
    values (${`${prefix}-import`}, ${orgId}, 'rls-proof')
  `;
  await sql`
    insert into "label_suite"."royalty_import_currency_totals" (
      "id", "org_id", "import_id", "currency", "gross_total", "fees_total", "net_total"
    ) values (${`${prefix}-import-total`}, ${orgId}, ${`${prefix}-import`}, 'USD', '3.00000000', '1.00000000', '2.00000000')
  `;
  await sql`
    insert into "label_suite"."royalty_earnings" (
      "id", "org_id", "import_id", "source_row_id", "source", "net_amount", "currency"
    ) values (${`${prefix}-earning`}, ${orgId}, ${`${prefix}-import`}, ${`${prefix}-source-row`}, 'rls-proof', '2.00000000', 'USD')
  `;
  await sql`
    insert into "label_suite"."royalty_split_snapshots" (
      "id", "org_id", "work_id", "effective_from"
    ) values (${`${prefix}-split-snapshot`}, ${orgId}, ${`${prefix}-work`}, '2026-01-01')
  `;
  await sql`
    insert into "label_suite"."royalty_split_lines" (
      "id", "org_id", "snapshot_id", "contact_id", "payee_name", "share_percent"
    ) values (${`${prefix}-split-line`}, ${orgId}, ${`${prefix}-split-snapshot`}, ${contactId}, ${`RLS payee ${suffix}`}, '100.000000')
  `;
  await sql`
    insert into "label_suite"."royalty_calculation_runs" (
      "id", "org_id", "engine_version", "idempotency_key"
    ) values (${`${prefix}-calculation`}, ${orgId}, 'rls-proof', ${`${prefix}-calculation`})
  `;
  await insertDraftStatement(sql, `${prefix}-statement`, contactId, orgId);
  await sql`
    insert into "label_suite"."royalty_payouts" (
      "id", "org_id", "contact_id", "statement_id", "amount", "currency"
    ) values (${`${prefix}-payout`}, ${orgId}, ${contactId}, ${`${prefix}-statement`}, '1.00000000', 'USD')
  `;
  await sql`
    insert into "label_suite"."royalty_statement_lines" (
      "id", "org_id", "statement_id", "earning_id", "split_line_id", "amount"
    ) values (
      ${`${prefix}-statement-line`}, ${orgId}, ${`${prefix}-statement`}, ${`${prefix}-earning`},
      ${`${prefix}-split-line`}, '2.00000000'
    )
  `;
  await sql`
    insert into "label_suite"."royalty_ledger_transactions" (
      "id", "org_id", "idempotency_key", "actor_user_id", "effective_date"
    ) values (${`${prefix}-ledger-transaction`}, ${orgId}, ${`${prefix}-ledger-transaction`}, ${userId}, '2026-01-31')
  `;
  await sql`
    insert into "label_suite"."royalty_ledger_entries" (
      "id", "org_id", "contact_id", "statement_id", "payout_id", "transaction_id",
      "entry_type", "amount", "currency", "effective_date"
    ) values (
      ${`${prefix}-ledger-entry`}, ${orgId}, ${contactId}, ${`${prefix}-statement`}, ${`${prefix}-payout`},
      ${`${prefix}-ledger-transaction`}, 'allocation', '1.00000000', 'USD', '2026-01-31'
    )
  `;
}

async function advanceStatementToIssued(sql: Sql, id: string): Promise<void> {
  await sql`update "label_suite"."royalty_statements" set "status" = 'calculated' where "id" = ${id}`;
  await sql`update "label_suite"."royalty_statements" set "status" = 'reviewed' where "id" = ${id}`;
  await establishLifecycleContext(sql, orgA, userA);
  await sql`update "label_suite"."royalty_statements" set "status" = 'issued' where "id" = ${id}`;
}

describeDisposable("royalty lifecycle PostgreSQL integration", () => {
  beforeAll(async () => {
    const databaseUrl = assertDisposableRoyaltyLifecycleTarget(integrationEnvironment);
    adminClient = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
    const databaseRows = await adminClient<{ database_name: string; owner_name: string }[]>`
      select current_database() as "database_name", pg_get_userbyid(datdba) as "owner_name"
      from pg_database
      where datname = current_database()
    `;
    disposableDatabaseName = databaseRows[0]!.database_name;
    originalDatabaseOwner = databaseRows[0]!.owner_name;
    await createRuntimeLoginRole(adminClient);
    await adminClient.unsafe(`ALTER DATABASE ${quoteIdentifier(disposableDatabaseName)} OWNER TO ${quoteIdentifier(runtimeRole)}`);

    const runtimeUrl = new URL(databaseUrl);
    runtimeUrl.username = runtimeRole;
    runtimeUrl.password = runtimePassword;
    lifecycleDatabaseUrl = runtimeUrl.toString();
    client = postgres(lifecycleDatabaseUrl, { max: 1, onnotice: () => undefined });
    await migrate(drizzle(client), { migrationsFolder: resolve(process.cwd(), "drizzle") });
    migrationCompleted = true;
    const runtimeFlags = await client<{ login: boolean; superuser: boolean; bypass_rls: boolean }[]>`
      select rolcanlogin as "login", rolsuper as "superuser", rolbypassrls as "bypass_rls"
      from pg_roles
      where rolname = current_user
    `;
    expect(runtimeFlags).toEqual([{ login: true, superuser: false, bypass_rls: false }]);
    ownsRlsRole = await ensureNoLoginRole(adminClient, rlsRole);
    ownsOrdinaryMutationRole = await ensureNoLoginRole(adminClient, ordinaryMutationRole);
    grantedRlsSchemaUsage = !(await hasSchemaUsage(adminClient, rlsRole));
    if (grantedRlsSchemaUsage) await adminClient.unsafe(`GRANT USAGE ON SCHEMA label_suite TO ${rlsRole}`);
    grantedRlsStatementSelect = !(await hasPrivilege(adminClient, rlsRole, "SELECT", "label_suite.royalty_statements"));
    if (grantedRlsStatementSelect) await adminClient.unsafe(`GRANT SELECT ON label_suite.royalty_statements TO ${rlsRole}`);
    grantedOrdinarySchemaUsage = !(await hasSchemaUsage(adminClient, ordinaryMutationRole));
    if (grantedOrdinarySchemaUsage) await adminClient.unsafe(`GRANT USAGE ON SCHEMA label_suite TO ${ordinaryMutationRole}`);
    grantedOrdinaryStatementUpdate = !(await hasPrivilege(adminClient, ordinaryMutationRole, "UPDATE", "label_suite.royalty_statements"));
    if (grantedOrdinaryStatementUpdate) await adminClient.unsafe(`GRANT UPDATE ON label_suite.royalty_statements TO ${ordinaryMutationRole}`);
    grantedOrdinaryStatementSelect = !(await hasPrivilege(adminClient, ordinaryMutationRole, "SELECT", "label_suite.royalty_statements"));
    if (grantedOrdinaryStatementSelect) await adminClient.unsafe(`GRANT SELECT ON label_suite.royalty_statements TO ${ordinaryMutationRole}`);
    await adminClient.unsafe(`GRANT ${rlsRole}, ${ordinaryMutationRole} TO ${runtimeRole}`);
  });

  afterAll(async () => {
    try {
      if (adminClient && migrationCompleted) await cleanupCommittedRaceTenantRows(adminClient);
      if (adminClient && ownsRuntimeRole) await adminClient.unsafe(`REVOKE ${rlsRole}, ${ordinaryMutationRole} FROM ${runtimeRole}`);
      if (adminClient && shouldDropOwnedDisposableRole({ createdByHarness: ownsOrdinaryMutationRole })) {
        await adminClient.unsafe(`DROP OWNED BY ${ordinaryMutationRole}`);
        await adminClient.unsafe(`DROP ROLE IF EXISTS ${ordinaryMutationRole}`);
      } else if (adminClient) {
        if (grantedOrdinaryStatementSelect) await adminClient.unsafe(`REVOKE SELECT ON label_suite.royalty_statements FROM ${ordinaryMutationRole}`);
        if (grantedOrdinaryStatementUpdate) await adminClient.unsafe(`REVOKE UPDATE ON label_suite.royalty_statements FROM ${ordinaryMutationRole}`);
        if (grantedOrdinarySchemaUsage) await adminClient.unsafe(`REVOKE USAGE ON SCHEMA label_suite FROM ${ordinaryMutationRole}`);
      }
      if (adminClient && shouldDropOwnedDisposableRole({ createdByHarness: ownsRlsRole })) {
        await adminClient.unsafe(`DROP OWNED BY ${rlsRole}`);
        await adminClient.unsafe(`DROP ROLE IF EXISTS ${rlsRole}`);
      } else if (adminClient) {
        if (grantedRlsStatementSelect) await adminClient.unsafe(`REVOKE SELECT ON label_suite.royalty_statements FROM ${rlsRole}`);
        if (grantedRlsSchemaUsage) await adminClient.unsafe(`REVOKE USAGE ON SCHEMA label_suite FROM ${rlsRole}`);
      }
    } finally {
      if (client) await client.end({ timeout: 5 });
      if (adminClient && ownsRuntimeRole && disposableDatabaseName && originalDatabaseOwner) {
        await adminClient.unsafe(`ALTER DATABASE ${quoteIdentifier(disposableDatabaseName)} OWNER TO ${quoteIdentifier(originalDatabaseOwner)}`);
        await adminClient.unsafe(`REASSIGN OWNED BY ${quoteIdentifier(runtimeRole)} TO ${quoteIdentifier(originalDatabaseOwner)}`);
        await adminClient.unsafe(`DROP OWNED BY ${quoteIdentifier(runtimeRole)}`);
        await adminClient.unsafe(`DROP ROLE ${quoteIdentifier(runtimeRole)}`);
      }
      if (adminClient) await adminClient.end({ timeout: 5 });
    }
  });

  it("fails the assertion helper when an expected database error does not occur", async () => {
    // Break caught: catching the helper's own sentinel makes a successful
    // mutation look like a rejected database operation.
    await inTransaction(async (sql) => {
      await expect(expectDatabaseError(
        sql,
        () => sql`select 'successful operation'`,
        "Expected database error containing sentinel-only-message",
      )).rejects.toThrow("Expected database error containing sentinel-only-message");
    });
  });

  it.each([
    ["import", (sql: Sql) => sql`
      insert into "label_suite"."royalty_imports" ("id", "org_id", "source", "status")
      values ('royalty-lifecycle-test-advanced-import', ${orgA}, 'test', 'parsed')
    `],
    ["calculation", (sql: Sql) => sql`
      insert into "label_suite"."royalty_calculation_runs" (
        "id", "org_id", "engine_version", "idempotency_key", "status", "approved_by"
      ) values ('royalty-lifecycle-test-advanced-calculation', ${orgA}, 'test', 'advanced-calculation', 'approved', ${userA})
    `],
    ["statement", (sql: Sql) => sql`
      insert into "label_suite"."royalty_statements" (
        "id", "org_id", "contact_id", "period_start", "period_end", "currency", "status",
        "opening_balance", "earnings_amount", "adjustments_amount", "payout_amount", "closing_balance", "issued_at"
      ) values (
        'royalty-lifecycle-test-advanced-statement', ${orgA}, ${contactA}, '2026-01-01', '2026-01-31', 'USD', 'issued',
        '0.00000000', '0.00000000', '0.00000000', '0.00000000', '0.00000000', now()
      )
    `],
    ["payout", (sql: Sql) => sql`
      insert into "label_suite"."royalty_payouts" (
        "id", "org_id", "contact_id", "amount", "currency", "status", "reference", "paid_at"
      ) values ('royalty-lifecycle-test-advanced-payout', ${orgA}, ${contactA}, '1.00000000', 'USD', 'recorded', 'external-test', now())
    `],
    ["ledger transaction", (sql: Sql) => sql`
      insert into "label_suite"."royalty_ledger_transactions" (
        "id", "org_id", "idempotency_key", "posting_status", "actor_user_id", "evidence_reference", "effective_date", "posted_at"
      ) values (
        'royalty-lifecycle-test-advanced-ledger', ${orgA}, 'advanced-ledger', 'posted', ${userA}, 'evidence://advanced-ledger', '2026-01-31', now()
      )
    `],
  ])("rejects an advanced-state %s insert", async (_caseName, insertAdvancedRow) => {
    // Break caught: UPDATE-only guards allow callers to create canonical
    // financial rows directly in terminal or privileged states.
    await inTransaction(async (sql) => {
      await seedTenantRows(sql);
      await expectDatabaseError(sql, () => insertAdvancedRow(sql), "must start in its initial lifecycle state");
    });
  });

  it("permits only the retained Airtable completed-to-parsed rerun normalization", async () => {
    // Break caught: canonical validation must not strand the deterministic
    // legacy importer row that existed as completed before the status rename.
    if (!client || !adminClient) throw new Error("Royalty lifecycle integration database was not initialized.");
    await createLegacyCompletedImportFixture(adminClient);
    try {
      await commitTransaction(client, async (sql) => {
        await setTenantContext(sql, legacyOrg);
        await sql`
          update "label_suite"."royalty_imports"
          set "status" = 'parsed', "row_count" = 3, "matched_count" = 2, "unmatched_count" = 1
          where "id" = ${legacyImport}
        `;
      });
      await inTransaction(async (sql) => {
        await setTenantContext(sql, legacyOrg);
        const rows = await sql<{ status: string; row_count: number }[]>`
          select "status", "row_count" from "label_suite"."royalty_imports" where "id" = ${legacyImport}
        `;
        expect(rows).toEqual([{ status: "parsed", row_count: 3 }]);
        await expectDatabaseError(
          sql,
          () => sql`update "label_suite"."royalty_imports" set "status" = 'parsed' where "id" = ${malformedLegacyImport}`,
          "Invalid royalty lifecycle transition",
        );
        await expectDatabaseError(
          sql,
          () => sql`update "label_suite"."royalty_imports" set "status" = 'received' where "id" = ${legacyImport}`,
          "Invalid royalty lifecycle transition",
        );
      });
    } finally {
      await cleanupLegacyCompletedImportFixture(adminClient);
    }
  });

  it("rejects an issued-to-closed statement rewrite beyond explicit close metadata", async () => {
    // Break caught: a privileged lifecycle update can silently rewrite a
    // financial balance while moving an issued snapshot to closed.
    await inTransaction(async (sql) => {
      await seedTenantRows(sql);
      await insertDraftStatement(sql, "royalty-lifecycle-test-close-fields");
      await advanceStatementToIssued(sql, "royalty-lifecycle-test-close-fields");

      await establishLifecycleContext(sql, orgA, userA);
      await expectDatabaseError(
        sql,
        () => sql`
          update "label_suite"."royalty_statements"
          set "status" = 'closed', "closed_at" = now(), "closing_balance" = '1.00000000'
          where "id" = 'royalty-lifecycle-test-close-fields'
        `,
        "explicit lifecycle transition metadata",
      );

      await establishLifecycleContext(sql, orgA, userA);
      await sql`
        update "label_suite"."royalty_statements"
        set "status" = 'closed', "closed_at" = now()
        where "id" = 'royalty-lifecycle-test-close-fields'
      `;
    });
  });

  it("rejects reparenting a statement line away from an issued statement", async () => {
    // Break caught: checking only NEW.statement_id lets a child escape an
    // immutable issued statement by moving to a draft parent.
    await inTransaction(async (sql) => {
      await seedTenantRows(sql);
      await insertDraftStatement(sql, "royalty-lifecycle-test-issued-parent");
      await insertDraftStatement(sql, "royalty-lifecycle-test-draft-parent");
      await sql`
        insert into "label_suite"."royalty_statement_lines" (
          "id", "org_id", "statement_id", "line_type", "amount"
        ) values (
          'royalty-lifecycle-test-statement-line', ${orgA}, 'royalty-lifecycle-test-issued-parent', 'earning', '1.00000000'
        )
      `;
      await advanceStatementToIssued(sql, "royalty-lifecycle-test-issued-parent");

      await expectDatabaseError(
        sql,
        () => sql`
          update "label_suite"."royalty_statement_lines"
          set "statement_id" = 'royalty-lifecycle-test-draft-parent'
          where "id" = 'royalty-lifecycle-test-statement-line'
        `,
        "append-only",
      );
    });
  });

  it("rejects reparenting a ledger entry away from a posted transaction", async () => {
    // Break caught: checking only NEW.transaction_id lets a child escape a
    // posted transaction by moving to a draft header.
    await inTransaction(async (sql) => {
      await seedTenantRows(sql);
      await sql`
        insert into "label_suite"."royalty_ledger_transactions" (
          "id", "org_id", "idempotency_key", "actor_user_id", "evidence_reference", "effective_date"
        ) values
          ('royalty-lifecycle-test-posted-parent', ${orgA}, 'royalty-lifecycle-test-posted-parent', ${userA}, 'evidence://posted-parent', '2026-01-31'),
          ('royalty-lifecycle-test-draft-transaction', ${orgA}, 'royalty-lifecycle-test-draft-transaction', ${userA}, 'evidence://draft-transaction', '2026-01-31')
      `;
      await sql`
        insert into "label_suite"."royalty_ledger_entries" (
          "id", "org_id", "contact_id", "transaction_id", "entry_type", "amount", "currency", "effective_date"
        ) values (
          'royalty-lifecycle-test-posted-parent-entry', ${orgA}, ${contactA}, 'royalty-lifecycle-test-posted-parent', 'allocation', '1.00000000', 'USD', '2026-01-31'
        )
      `;
      await establishLifecycleContext(sql, orgA, userA);
      await sql`
        update "label_suite"."royalty_ledger_transactions"
        set "posting_status" = 'posted', "posted_at" = now()
        where "id" = 'royalty-lifecycle-test-posted-parent'
      `;

      await expectDatabaseError(
        sql,
        () => sql`
          update "label_suite"."royalty_ledger_entries"
          set "transaction_id" = 'royalty-lifecycle-test-draft-transaction'
          where "id" = 'royalty-lifecycle-test-posted-parent-entry'
        `,
        "append-only",
      );
    });
  });

  it("rejects a posted-to-reversed ledger rewrite beyond the status transition", async () => {
    // Break caught: a reversal transition can silently replace the original
    // effective date or evidence while it changes the posting status.
    await inTransaction(async (sql) => {
      await seedTenantRows(sql);
      await sql`
        insert into "label_suite"."royalty_ledger_transactions" (
          "id", "org_id", "idempotency_key", "actor_user_id", "evidence_reference", "effective_date"
        ) values ('royalty-lifecycle-test-transition-original', ${orgA}, 'royalty-lifecycle-test-transition-original', ${userA}, 'evidence://transition-original', '2026-01-31')
      `;
      await sql`
        insert into "label_suite"."royalty_ledger_entries" (
          "id", "org_id", "contact_id", "transaction_id", "entry_type", "amount", "currency", "effective_date"
        ) values ('royalty-lifecycle-test-transition-original-entry', ${orgA}, ${contactA}, 'royalty-lifecycle-test-transition-original', 'allocation', '2.00000000', 'USD', '2026-01-31')
      `;
      await establishLifecycleContext(sql, orgA, userA);
      await sql`
        update "label_suite"."royalty_ledger_transactions"
        set "posting_status" = 'posted', "posted_at" = now()
        where "id" = 'royalty-lifecycle-test-transition-original'
      `;
      await sql`
        insert into "label_suite"."royalty_ledger_transactions" (
          "id", "org_id", "idempotency_key", "actor_user_id", "evidence_reference", "reversal_of_transaction_id", "effective_date"
        ) values ('royalty-lifecycle-test-transition-reversal', ${orgA}, 'royalty-lifecycle-test-transition-reversal', ${userA}, 'evidence://transition-reversal', 'royalty-lifecycle-test-transition-original', '2026-02-01')
      `;
      await sql`
        insert into "label_suite"."royalty_ledger_entries" (
          "id", "org_id", "contact_id", "transaction_id", "entry_type", "amount", "currency", "effective_date"
        ) values ('royalty-lifecycle-test-transition-reversal-entry', ${orgA}, ${contactA}, 'royalty-lifecycle-test-transition-reversal', 'allocation', '-2.00000000', 'USD', '2026-02-01')
      `;
      await establishLifecycleContext(sql, orgA, userA);
      await sql`
        update "label_suite"."royalty_ledger_transactions"
        set "posting_status" = 'posted', "posted_at" = now()
        where "id" = 'royalty-lifecycle-test-transition-reversal'
      `;

      await establishLifecycleContext(sql, orgA, userA);
      await expectDatabaseError(
        sql,
        () => sql`
          update "label_suite"."royalty_ledger_transactions"
          set "posting_status" = 'reversed', "effective_date" = '2026-02-28', "evidence_reference" = 'evidence://rewritten'
          where "id" = 'royalty-lifecycle-test-transition-original'
        `,
        "explicit lifecycle transition metadata",
      );

      await establishLifecycleContext(sql, orgA, userA);
      await sql`
        update "label_suite"."royalty_ledger_transactions"
        set "posting_status" = 'reversed'
        where "id" = 'royalty-lifecycle-test-transition-original'
      `;
    });
  });

  it("denies an ordinary mutation session a lifecycle context despite spoofed GUCs", async () => {
    // Break caught: an unprivileged table writer can SET arbitrary app.*
    // variables and issue a protected financial transition.
    await inTransaction(async (sql) => {
      await seedTenantRows(sql);
      await insertDraftStatement(sql, "royalty-lifecycle-test-ordinary-session");
      await sql`update "label_suite"."royalty_statements" set "status" = 'calculated' where "id" = 'royalty-lifecycle-test-ordinary-session'`;
      await sql`update "label_suite"."royalty_statements" set "status" = 'reviewed' where "id" = 'royalty-lifecycle-test-ordinary-session'`;

      await sql.unsafe(`SET LOCAL ROLE ${ordinaryMutationRole}`);
      await setTenantContext(sql, orgA, userA);
      await sql`select set_config('app.royalty_lifecycle_authorized', '1', true)`;
      await expectDatabaseError(
        sql,
        () => establishLifecycleContext(sql, orgA, userA),
        "permission denied",
      );
      await expectDatabaseError(
        sql,
        () => sql`update "label_suite"."royalty_statements" set "status" = 'issued' where "id" = 'royalty-lifecycle-test-ordinary-session'`,
        "Restricted royalty lifecycle context",
      );
    });
  });

  it("binds lifecycle authorization to an owner or operator actor", async () => {
    // Break caught: a regular member, or an owner context used for a different
    // ledger actor, can approve a financial transition.
    await inTransaction(async (sql) => {
      await seedTenantRows(sql);
      await expectDatabaseError(
        sql,
        () => establishLifecycleContext(sql, orgA, userMember),
        "owner or operator",
      );
      await sql`
        insert into "label_suite"."royalty_ledger_transactions" (
          "id", "org_id", "idempotency_key", "actor_user_id", "evidence_reference", "effective_date"
        ) values ('royalty-lifecycle-test-actor-binding', ${orgA}, 'royalty-lifecycle-test-actor-binding', ${userMember}, 'evidence://actor-binding', '2026-01-31')
      `;
      await establishLifecycleContext(sql, orgA, userA);
      await expectDatabaseError(
        sql,
        () => sql`
          update "label_suite"."royalty_ledger_transactions"
          set "posting_status" = 'posted', "posted_at" = now()
          where "id" = 'royalty-lifecycle-test-actor-binding'
        `,
        "does not match ledger actor",
      );
    });
  });

  it("rejects a lifecycle context bound to another organization", async () => {
    // Break caught: a valid owner/operator context for one tenant can issue a
    // statement belonging to a different tenant.
    await inTransaction(async (sql) => {
      await seedTenantRows(sql);
      await setTenantContext(sql, orgB, userB);
      await sql`
        insert into "label_suite"."royalty_statements" (
          "id", "org_id", "contact_id", "period_start", "period_end", "currency",
          "opening_balance", "earnings_amount", "adjustments_amount", "payout_amount", "closing_balance"
        ) values (
          'royalty-lifecycle-test-context-org-b', ${orgB}, ${contactB}, '2026-01-01', '2026-01-31', 'USD',
          '0.00000000', '0.00000000', '0.00000000', '0.00000000', '0.00000000'
        )
      `;
      await sql`update "label_suite"."royalty_statements" set "status" = 'calculated' where "id" = 'royalty-lifecycle-test-context-org-b'`;
      await sql`update "label_suite"."royalty_statements" set "status" = 'reviewed' where "id" = 'royalty-lifecycle-test-context-org-b'`;
      await establishLifecycleContext(sql, orgA, userA);
      await expectDatabaseError(
        sql,
        () => sql`update "label_suite"."royalty_statements" set "status" = 'issued' where "id" = 'royalty-lifecycle-test-context-org-b'`,
        "does not match organization",
      );
    });
  });

  it("consumes a lifecycle context after one protected transition in the same transaction", async () => {
    // Break caught: a valid context can be replayed to approve multiple
    // lifecycle transitions before the transaction commits.
    await inTransaction(async (sql) => {
      await seedTenantRows(sql);
      await insertDraftStatement(sql, "royalty-lifecycle-test-context-replay");
      await sql`update "label_suite"."royalty_statements" set "status" = 'calculated' where "id" = 'royalty-lifecycle-test-context-replay'`;
      await sql`update "label_suite"."royalty_statements" set "status" = 'reviewed' where "id" = 'royalty-lifecycle-test-context-replay'`;

      await establishLifecycleContext(sql, orgA, userA);
      await sql`update "label_suite"."royalty_statements" set "status" = 'issued' where "id" = 'royalty-lifecycle-test-context-replay'`;
      await expectDatabaseError(
        sql,
        () => sql`
          update "label_suite"."royalty_statements"
          set "status" = 'closed', "closed_at" = now()
          where "id" = 'royalty-lifecycle-test-context-replay'
        `,
        "Restricted royalty lifecycle context is required",
      );

      await establishLifecycleContext(sql, orgA, userA);
      await sql`
        update "label_suite"."royalty_statements"
        set "status" = 'closed', "closed_at" = now()
        where "id" = 'royalty-lifecycle-test-context-replay'
      `;
    });
  });

  it("requires a single posted reversal with entry groups that exactly negate the original", async () => {
    // Break caught: a reversal header can be created before the original is
    // posted, or posted empty, duplicate, or with merely net-zero mismatched
    // entry groups.
    await inTransaction(async (sql) => {
      await seedTenantRows(sql);
      await sql`
        insert into "label_suite"."royalty_ledger_transactions" (
          "id", "org_id", "idempotency_key", "actor_user_id", "evidence_reference", "effective_date"
        ) values ('royalty-lifecycle-test-reversal-original', ${orgA}, 'royalty-lifecycle-test-reversal-original', ${userA}, 'evidence://reversal-original', '2026-01-31')
      `;
      await expectDatabaseError(
        sql,
        () => sql`
          insert into "label_suite"."royalty_ledger_transactions" (
            "id", "org_id", "idempotency_key", "actor_user_id", "evidence_reference", "reversal_of_transaction_id", "effective_date"
          ) values ('royalty-lifecycle-test-premature-reversal', ${orgA}, 'royalty-lifecycle-test-premature-reversal', ${userA}, 'evidence://premature-reversal', 'royalty-lifecycle-test-reversal-original', '2026-02-01')
        `,
        "Original ledger transaction must already be posted",
      );
      await sql`
        insert into "label_suite"."royalty_ledger_entries" (
          "id", "org_id", "contact_id", "transaction_id", "entry_type", "amount", "currency", "effective_date"
        ) values
          ('royalty-lifecycle-test-reversal-original-allocation', ${orgA}, ${contactA}, 'royalty-lifecycle-test-reversal-original', 'allocation', '100.00000000', 'USD', '2026-01-31'),
          ('royalty-lifecycle-test-reversal-original-fee', ${orgA}, ${contactA}, 'royalty-lifecycle-test-reversal-original', 'fee', '7.00000000', 'USD', '2026-01-31')
      `;
      await establishLifecycleContext(sql, orgA, userA);
      await sql`
        update "label_suite"."royalty_ledger_transactions"
        set "posting_status" = 'posted', "posted_at" = now()
        where "id" = 'royalty-lifecycle-test-reversal-original'
      `;
      await sql`
        insert into "label_suite"."royalty_ledger_transactions" (
          "id", "org_id", "idempotency_key", "actor_user_id", "evidence_reference", "reversal_of_transaction_id", "effective_date"
        ) values ('royalty-lifecycle-test-structured-reversal', ${orgA}, 'royalty-lifecycle-test-structured-reversal', ${userA}, 'evidence://structured-reversal', 'royalty-lifecycle-test-reversal-original', '2026-02-01')
      `;
      await establishLifecycleContext(sql, orgA, userA);
      await expectDatabaseError(
        sql,
        () => sql`
          update "label_suite"."royalty_ledger_transactions"
          set "posting_status" = 'posted', "posted_at" = now()
          where "id" = 'royalty-lifecycle-test-structured-reversal'
        `,
        "must exactly negate the original entry groups",
      );
      await sql`
        insert into "label_suite"."royalty_ledger_entries" (
          "id", "org_id", "contact_id", "transaction_id", "entry_type", "amount", "currency", "effective_date"
        ) values ('royalty-lifecycle-test-structured-reversal-allocation', ${orgA}, ${contactA}, 'royalty-lifecycle-test-structured-reversal', 'allocation', '-107.00000000', 'USD', '2026-02-01')
      `;
      await establishLifecycleContext(sql, orgA, userA);
      await expectDatabaseError(
        sql,
        () => sql`
          update "label_suite"."royalty_ledger_transactions"
          set "posting_status" = 'posted', "posted_at" = now()
          where "id" = 'royalty-lifecycle-test-structured-reversal'
        `,
        "must exactly negate the original entry groups",
      );
      await sql`
        update "label_suite"."royalty_ledger_entries"
        set "amount" = '-100.00000000'
        where "id" = 'royalty-lifecycle-test-structured-reversal-allocation'
      `;
      await sql`
        insert into "label_suite"."royalty_ledger_entries" (
          "id", "org_id", "contact_id", "transaction_id", "entry_type", "amount", "currency", "effective_date"
        ) values ('royalty-lifecycle-test-structured-reversal-fee', ${orgA}, ${contactA}, 'royalty-lifecycle-test-structured-reversal', 'fee', '-7.00000000', 'USD', '2026-02-01')
      `;
      await establishLifecycleContext(sql, orgA, userA);
      await sql`
        update "label_suite"."royalty_ledger_transactions"
        set "posting_status" = 'posted', "posted_at" = now()
        where "id" = 'royalty-lifecycle-test-structured-reversal'
      `;
      await expectDatabaseError(
        sql,
        () => sql`
          insert into "label_suite"."royalty_ledger_transactions" (
            "id", "org_id", "idempotency_key", "actor_user_id", "evidence_reference", "reversal_of_transaction_id", "effective_date"
          ) values ('royalty-lifecycle-test-duplicate-reversal', ${orgA}, 'royalty-lifecycle-test-duplicate-reversal', ${userA}, 'evidence://duplicate-reversal', 'royalty-lifecycle-test-reversal-original', '2026-02-01')
        `,
        "Only one reversal ledger transaction is allowed",
      );
      await establishLifecycleContext(sql, orgA, userA);
      await sql`
        update "label_suite"."royalty_ledger_transactions"
        set "posting_status" = 'reversed'
        where "id" = 'royalty-lifecycle-test-reversal-original'
      `;
    });
  });

  it("rejects invalid transitions, preserves issued and posted history, and requires a linked reversal", async () => {
    await inTransaction(async (sql) => {
      await seedTenantRows(sql);

      await sql`
        insert into "label_suite"."royalty_imports" ("id", "org_id", "source", "status")
        values ('royalty-lifecycle-test-import', ${orgA}, 'test', 'received')
      `;
      await expectDatabaseError(
        sql,
        () => sql`update "label_suite"."royalty_imports" set "status" = 'parsed' where "id" = 'royalty-lifecycle-test-import'`,
        "Invalid royalty lifecycle transition",
      );
      await sql`update "label_suite"."royalty_imports" set "status" = 'parsing' where "id" = 'royalty-lifecycle-test-import'`;
      await sql`update "label_suite"."royalty_imports" set "status" = 'parsed' where "id" = 'royalty-lifecycle-test-import'`;

      await sql`
        insert into "label_suite"."royalty_statements" (
          "id", "org_id", "contact_id", "period_start", "period_end", "currency",
          "opening_balance", "earnings_amount", "adjustments_amount", "payout_amount", "closing_balance"
        ) values (
          'royalty-lifecycle-test-statement', ${orgA}, ${contactA}, '2026-01-01', '2026-01-31', 'USD',
          '0.00000000', '0.00000000', '0.00000000', '0.00000000', '0.00000000'
        )
      `;
      await expectDatabaseError(
        sql,
        () => sql`update "label_suite"."royalty_statements" set "status" = 'issued' where "id" = 'royalty-lifecycle-test-statement'`,
        "Invalid royalty lifecycle transition",
      );
      await sql`update "label_suite"."royalty_statements" set "status" = 'calculated' where "id" = 'royalty-lifecycle-test-statement'`;
      await sql`update "label_suite"."royalty_statements" set "status" = 'reviewed' where "id" = 'royalty-lifecycle-test-statement'`;
      await setTenantContext(sql, orgA, userA);
      await sql`select set_config('app.royalty_lifecycle_authorized', '1', true)`;
      await expectDatabaseError(
        sql,
        () => sql`update "label_suite"."royalty_statements" set "status" = 'issued' where "id" = 'royalty-lifecycle-test-statement'`,
        "Restricted royalty lifecycle context",
      );
      await establishLifecycleContext(sql, orgA, userA);
      await sql`update "label_suite"."royalty_statements" set "status" = 'issued' where "id" = 'royalty-lifecycle-test-statement'`;
      await expectDatabaseError(
        sql,
        () => sql`update "label_suite"."royalty_statements" set "notes" = 'rewritten' where "id" = 'royalty-lifecycle-test-statement'`,
        "append-only",
      );
      await expectDatabaseError(
        sql,
        () => sql`delete from "label_suite"."royalty_statements" where "id" = 'royalty-lifecycle-test-statement'`,
        "append-only",
      );

      await sql`
        insert into "label_suite"."royalty_ledger_transactions" (
          "id", "org_id", "idempotency_key", "actor_user_id", "evidence_reference", "effective_date"
        ) values ('royalty-lifecycle-test-original', ${orgA}, 'royalty-lifecycle-test-original', ${userA}, 'evidence://original', '2026-01-31')
      `;
      await sql`
        insert into "label_suite"."royalty_ledger_entries" (
          "id", "org_id", "contact_id", "transaction_id", "entry_type", "amount", "currency", "effective_date"
        ) values ('royalty-lifecycle-test-entry', ${orgA}, ${contactA}, 'royalty-lifecycle-test-original', 'allocation', '999999999999.12345678', 'USD', '2026-01-31')
      `;
      await establishLifecycleContext(sql, orgA, userA);
      await sql`update "label_suite"."royalty_ledger_transactions" set "posting_status" = 'posted', "posted_at" = now() where "id" = 'royalty-lifecycle-test-original'`;
      const decimalRows = await sql<{ amount: string }[]>`
        select "amount"::text as "amount" from "label_suite"."royalty_ledger_entries" where "id" = 'royalty-lifecycle-test-entry'
      `;
      expect(decimalRows[0]?.amount).toBe("999999999999.12345678");
      await expectDatabaseError(
        sql,
        () => sql`update "label_suite"."royalty_ledger_entries" set "description" = 'rewritten' where "id" = 'royalty-lifecycle-test-entry'`,
        "append-only",
      );
      await expectDatabaseError(
        sql,
        () => sql`update "label_suite"."royalty_ledger_transactions" set "posting_status" = 'reversed' where "id" = 'royalty-lifecycle-test-original'`,
        "Linked posted reversal transaction is required",
      );

      await sql`
        insert into "label_suite"."royalty_ledger_transactions" (
          "id", "org_id", "idempotency_key", "actor_user_id", "evidence_reference", "reversal_of_transaction_id", "effective_date"
        ) values ('royalty-lifecycle-test-reversal', ${orgA}, 'royalty-lifecycle-test-reversal', ${userA}, 'evidence://reversal', 'royalty-lifecycle-test-original', '2026-02-01')
      `;
      await sql`
        insert into "label_suite"."royalty_ledger_entries" (
          "id", "org_id", "contact_id", "transaction_id", "entry_type", "amount", "currency", "effective_date"
        ) values ('royalty-lifecycle-test-reversal-entry', ${orgA}, ${contactA}, 'royalty-lifecycle-test-reversal', 'allocation', '-999999999999.12345678', 'USD', '2026-02-01')
      `;
      await establishLifecycleContext(sql, orgA, userA);
      await sql`update "label_suite"."royalty_ledger_transactions" set "posting_status" = 'posted', "posted_at" = now() where "id" = 'royalty-lifecycle-test-reversal'`;
      await establishLifecycleContext(sql, orgA, userA);
      await sql`update "label_suite"."royalty_ledger_transactions" set "posting_status" = 'reversed' where "id" = 'royalty-lifecycle-test-original'`;
      await expectDatabaseError(
        sql,
        () => sql`delete from "label_suite"."royalty_ledger_transactions" where "id" = 'royalty-lifecycle-test-reversal'`,
        "append-only",
      );

      const auditRows = await sql<{ entity_type: string }[]>`
        select "entity_type" from "label_suite"."audit_logs"
        where "org_id" = ${orgA} and "entity_type" in ('royalty_ledger_transactions', 'royalty_ledger_entries', 'royalty_statements')
      `;
      expect(new Set(auditRows.map((row) => row.entity_type))).toEqual(new Set([
        "royalty_ledger_transactions",
        "royalty_ledger_entries",
        "royalty_statements",
      ]));
    });
  });

  it("records the validated lifecycle actor for protected statement and payout audits", async () => {
    // Break caught: app.current_user_id is caller-controlled and can falsely
    // attribute a protected statement or payout transition to another user.
    await inTransaction(async (sql) => {
      await seedTenantRows(sql);
      await insertDraftStatement(sql, "royalty-lifecycle-test-actor-audit-statement");
      await sql`
        update "label_suite"."royalty_statements"
        set "status" = 'calculated'
        where "id" = 'royalty-lifecycle-test-actor-audit-statement'
      `;
      await sql`
        update "label_suite"."royalty_statements"
        set "status" = 'reviewed'
        where "id" = 'royalty-lifecycle-test-actor-audit-statement'
      `;
      await setTenantContext(sql, orgA, userB);
      await establishLifecycleContext(sql, orgA, userA);
      await sql`
        update "label_suite"."royalty_statements"
        set "status" = 'issued'
        where "id" = 'royalty-lifecycle-test-actor-audit-statement'
      `;

      await sql`
        insert into "label_suite"."royalty_payouts" (
          "id", "org_id", "contact_id", "amount", "currency"
        ) values ('royalty-lifecycle-test-actor-audit-payout', ${orgA}, ${contactA}, '2.00000000', 'USD')
      `;
      await sql`
        update "label_suite"."royalty_payouts"
        set "status" = 'approved'
        where "id" = 'royalty-lifecycle-test-actor-audit-payout'
      `;
      await setTenantContext(sql, orgA, userB);
      await establishLifecycleContext(sql, orgA, userA);
      await sql`
        update "label_suite"."royalty_payouts"
        set "status" = 'recorded', "reference" = 'actor-audit-reference', "paid_at" = now()
        where "id" = 'royalty-lifecycle-test-actor-audit-payout'
      `;

      const auditRows = await sql<{ entity_type: string; actor_user_id: string | null }[]>`
        select "entity_type", "actor_user_id"
        from "label_suite"."audit_logs"
        where "entity_id" in (
          'royalty-lifecycle-test-actor-audit-statement',
          'royalty-lifecycle-test-actor-audit-payout'
        )
          and "action" = 'update'
          and (
            ("entity_type" = 'royalty_statements' and "after_data" ->> 'status' = 'issued')
            or ("entity_type" = 'royalty_payouts' and "after_data" ->> 'status' = 'recorded')
          )
        order by "entity_type"
      `;
      expect(auditRows).toEqual([
        { entity_type: "royalty_payouts", actor_user_id: userA },
        { entity_type: "royalty_statements", actor_user_id: userA },
      ]);
    });
  });

  it("rejects cross-org financial references and proves RLS hides the other tenant", async () => {
    await inTransaction(async (sql) => {
      await seedTenantRows(sql);
      await expectDatabaseError(
        sql,
        () => sql`
          insert into "label_suite"."royalty_statements" (
            "id", "org_id", "contact_id", "period_start", "period_end", "currency",
            "opening_balance", "earnings_amount", "adjustments_amount", "payout_amount", "closing_balance"
          ) values ('royalty-lifecycle-test-cross-org', ${orgA}, ${contactB}, '2026-01-01', '2026-01-31', 'USD', '0', '0', '0', '0', '0')
        `,
        "Cross-organization reference",
      );
      await expectDatabaseError(
        sql,
        () => sql`
          insert into "label_suite"."royalty_calculation_runs" ("id", "org_id", "engine_version", "idempotency_key", "approved_by")
          values ('royalty-lifecycle-test-cross-org-approval', ${orgA}, 'test', 'royalty-lifecycle-test-cross-org-approval', ${userB})
        `,
        "approver must belong",
      );
      await sql`
        insert into "label_suite"."royalty_statements" (
          "id", "org_id", "contact_id", "period_start", "period_end", "currency",
          "opening_balance", "earnings_amount", "adjustments_amount", "payout_amount", "closing_balance"
        ) values ('royalty-lifecycle-test-rls-a', ${orgA}, ${contactA}, '2026-01-01', '2026-01-31', 'USD', '0', '0', '0', '0', '0')
      `;
      await setTenantContext(sql, orgB, userB);
      await insertDraftStatement(sql, "royalty-lifecycle-test-rls-b", contactB, orgB);
      await setTenantContext(sql, orgA);
      await sql.unsafe(`SET LOCAL ROLE ${rlsRole}`);
      const visibleRows = await sql<{ id: string }[]>`
        select "id" from "label_suite"."royalty_statements"
        where "id" in ('royalty-lifecycle-test-rls-a', 'royalty-lifecycle-test-rls-b')
        order by "id"
      `;
      expect(visibleRows).toEqual([{ id: "royalty-lifecycle-test-rls-a" }]);
    });
  });

  it("forces tenant RLS for the same principal that owns and runs the application tables", async () => {
    // Break caught: ENABLE RLS alone lets the table-owning application
    // principal bypass tenant policies and see another organization's rows.
    await inTransaction(async (sql) => {
      await seedTenantRows(sql);
      await insertDraftStatement(sql, "royalty-lifecycle-test-owner-rls-a");
      await setTenantContext(sql, orgB, userB);
      await insertDraftStatement(sql, "royalty-lifecycle-test-owner-rls-b", contactB, orgB);
      await setTenantContext(sql, orgA, userA);
      const identities = await sql<{ current_principal: string; table_owner: string }[]>`
        select current_user as "current_principal", tableowner as "table_owner"
        from pg_tables
        where schemaname = 'label_suite' and tablename = 'royalty_statements'
      `;
      expect(identities[0]?.current_principal).toBe(identities[0]?.table_owner);
      const visibleRows = await sql<{ id: string }[]>`
        select "id"
        from "label_suite"."royalty_statements"
        where "id" in ('royalty-lifecycle-test-owner-rls-a', 'royalty-lifecycle-test-owner-rls-b')
        order by "id"
      `;
      expect(visibleRows).toEqual([{ id: "royalty-lifecycle-test-owner-rls-a" }]);
    });
  });

  it("forces owner-visible tenant isolation across every Phase 1 financial table", async () => {
    // Break caught: leaving imports or split tables merely enabled/unprotected
    // lets the direct LOGIN table owner read another tenant's financial rows.
    await inTransaction(async (sql) => {
      await seedTenantRows(sql);
      await insertRepresentativeFinancialRows(sql, "a", orgA, userA, contactA);
      await insertRepresentativeFinancialRows(sql, "b", orgB, userB, contactB);
      await setTenantContext(sql, orgA, userA);

      const visible = await sql<{ table_name: string; ids: string[] }[]>`
        select 'royalty_calculation_runs' as "table_name", array_agg("id" order by "id") as "ids"
          from "label_suite"."royalty_calculation_runs" where "id" like 'royalty-lifecycle-test-complete-rls-%'
        union all select 'royalty_earnings', array_agg("id" order by "id")
          from "label_suite"."royalty_earnings" where "id" like 'royalty-lifecycle-test-complete-rls-%'
        union all select 'royalty_import_currency_totals', array_agg("id" order by "id")
          from "label_suite"."royalty_import_currency_totals" where "id" like 'royalty-lifecycle-test-complete-rls-%'
        union all select 'royalty_imports', array_agg("id" order by "id")
          from "label_suite"."royalty_imports" where "id" like 'royalty-lifecycle-test-complete-rls-%'
        union all select 'royalty_ledger_entries', array_agg("id" order by "id")
          from "label_suite"."royalty_ledger_entries" where "id" like 'royalty-lifecycle-test-complete-rls-%'
        union all select 'royalty_ledger_transactions', array_agg("id" order by "id")
          from "label_suite"."royalty_ledger_transactions" where "id" like 'royalty-lifecycle-test-complete-rls-%'
        union all select 'royalty_payouts', array_agg("id" order by "id")
          from "label_suite"."royalty_payouts" where "id" like 'royalty-lifecycle-test-complete-rls-%'
        union all select 'royalty_split_lines', array_agg("id" order by "id")
          from "label_suite"."royalty_split_lines" where "id" like 'royalty-lifecycle-test-complete-rls-%'
        union all select 'royalty_split_snapshots', array_agg("id" order by "id")
          from "label_suite"."royalty_split_snapshots" where "id" like 'royalty-lifecycle-test-complete-rls-%'
        union all select 'royalty_statement_lines', array_agg("id" order by "id")
          from "label_suite"."royalty_statement_lines" where "id" like 'royalty-lifecycle-test-complete-rls-%'
        union all select 'royalty_statements', array_agg("id" order by "id")
          from "label_suite"."royalty_statements" where "id" like 'royalty-lifecycle-test-complete-rls-%'
        order by "table_name"
      `;
      expect(visible).toEqual([
        { table_name: "royalty_calculation_runs", ids: ["royalty-lifecycle-test-complete-rls-a-calculation"] },
        { table_name: "royalty_earnings", ids: ["royalty-lifecycle-test-complete-rls-a-earning"] },
        { table_name: "royalty_import_currency_totals", ids: ["royalty-lifecycle-test-complete-rls-a-import-total"] },
        { table_name: "royalty_imports", ids: ["royalty-lifecycle-test-complete-rls-a-import"] },
        { table_name: "royalty_ledger_entries", ids: ["royalty-lifecycle-test-complete-rls-a-ledger-entry"] },
        { table_name: "royalty_ledger_transactions", ids: ["royalty-lifecycle-test-complete-rls-a-ledger-transaction"] },
        { table_name: "royalty_payouts", ids: ["royalty-lifecycle-test-complete-rls-a-payout"] },
        { table_name: "royalty_split_lines", ids: ["royalty-lifecycle-test-complete-rls-a-split-line"] },
        { table_name: "royalty_split_snapshots", ids: ["royalty-lifecycle-test-complete-rls-a-split-snapshot"] },
        { table_name: "royalty_statement_lines", ids: ["royalty-lifecycle-test-complete-rls-a-statement-line"] },
        { table_name: "royalty_statements", ids: ["royalty-lifecycle-test-complete-rls-a-statement"] },
      ]);
    });
  });

  it("serializes concurrent reversal headers for the same posted original", async () => {
    // Break caught: two sessions can both pass an unlocked duplicate check and
    // commit separate reversal headers for one original transaction.
    if (!client || !lifecycleDatabaseUrl) throw new Error("Royalty lifecycle integration database was not initialized.");
    const originalId = "royalty-lifecycle-test-race-reversal-original";
    const firstReversalId = "royalty-lifecycle-test-race-reversal-first";
    const secondReversalId = "royalty-lifecycle-test-race-reversal-second";
    const first = postgres(lifecycleDatabaseUrl, { max: 1, onnotice: () => undefined });
    const second = postgres(lifecycleDatabaseUrl, { max: 1, onnotice: () => undefined });
    let firstCommitted = false;

    try {
      await commitTransaction(client, async (sql) => {
        await seedCommittedRaceTenantRows(sql);
        await sql`
          insert into "label_suite"."royalty_ledger_transactions" (
            "id", "org_id", "idempotency_key", "actor_user_id", "evidence_reference", "effective_date"
          ) values (${originalId}, ${orgA}, ${originalId}, ${userA}, 'evidence://race-reversal-original', '2026-01-31')
        `;
        await sql`
          insert into "label_suite"."royalty_ledger_entries" (
            "id", "org_id", "contact_id", "transaction_id", "entry_type", "amount", "currency", "effective_date"
          ) values ('royalty-lifecycle-test-race-reversal-original-entry', ${orgA}, ${contactA}, ${originalId}, 'allocation', '4.00000000', 'USD', '2026-01-31')
        `;
        await establishLifecycleContext(sql, orgA, userA);
        await sql`
          update "label_suite"."royalty_ledger_transactions"
          set "posting_status" = 'posted', "posted_at" = now()
          where "id" = ${originalId}
        `;
      });

      await first`BEGIN`;
      await second`BEGIN`;
      await setTenantContext(first, orgA, userA);
      await setTenantContext(second, orgA, userA);
      await first`
        insert into "label_suite"."royalty_ledger_transactions" (
          "id", "org_id", "idempotency_key", "actor_user_id", "evidence_reference", "reversal_of_transaction_id", "effective_date"
        ) values (${firstReversalId}, ${orgA}, ${firstReversalId}, ${userA}, 'evidence://race-reversal-first', ${originalId}, '2026-02-01')
      `;
      const secondPidRows = await second<{ pid: number }[]>`select pg_backend_pid() as "pid"`;
      const secondInsert = second`
        insert into "label_suite"."royalty_ledger_transactions" (
          "id", "org_id", "idempotency_key", "actor_user_id", "evidence_reference", "reversal_of_transaction_id", "effective_date"
        ) values (${secondReversalId}, ${orgA}, ${secondReversalId}, ${userA}, 'evidence://race-reversal-second', ${originalId}, '2026-02-01')
      `.execute().then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await waitForDatabaseLock(client, secondPidRows[0]!.pid);
      await first`COMMIT`;
      firstCommitted = true;
      const secondOutcome = await secondInsert;
      expect(secondOutcome.ok).toBe(false);
      if (secondOutcome.ok) throw new Error("Second reversal insert unexpectedly succeeded.");
      expect(String((secondOutcome.error as Error).message)).toContain("Only one reversal ledger transaction is allowed");
    } finally {
      if (!firstCommitted) await first`ROLLBACK`;
      await second`ROLLBACK`;
      await first.end({ timeout: 5 });
      await second.end({ timeout: 5 });
      if (!adminClient) throw new Error("Royalty lifecycle integration admin database was not initialized.");
      await cleanupCommittedRaceFixtures(adminClient, [firstReversalId, secondReversalId, originalId]);
    }
  });

  it("serializes a child-entry update behind a concurrent posting transition", async () => {
    // Break caught: an entry mutation can read draft status while another
    // session posts its header, then commit after the financial snapshot.
    if (!client || !lifecycleDatabaseUrl) throw new Error("Royalty lifecycle integration database was not initialized.");
    const transactionId = "royalty-lifecycle-test-race-posting-header";
    const entryId = "royalty-lifecycle-test-race-posting-entry";
    const poster = postgres(lifecycleDatabaseUrl, { max: 1, onnotice: () => undefined });
    const mutator = postgres(lifecycleDatabaseUrl, { max: 1, onnotice: () => undefined });
    let posterCommitted = false;

    try {
      await commitTransaction(client, async (sql) => {
        await seedCommittedRaceTenantRows(sql);
        await sql`
          insert into "label_suite"."royalty_ledger_transactions" (
            "id", "org_id", "idempotency_key", "actor_user_id", "evidence_reference", "effective_date"
          ) values (${transactionId}, ${orgA}, ${transactionId}, ${userA}, 'evidence://race-posting-header', '2026-01-31')
        `;
        await sql`
          insert into "label_suite"."royalty_ledger_entries" (
            "id", "org_id", "contact_id", "transaction_id", "entry_type", "amount", "currency", "effective_date"
          ) values (${entryId}, ${orgA}, ${contactA}, ${transactionId}, 'allocation', '9.00000000', 'USD', '2026-01-31')
        `;
      });

      await poster`BEGIN`;
      await setTenantContext(poster, orgA, userA);
      await establishLifecycleContext(poster, orgA, userA);
      await poster`
        update "label_suite"."royalty_ledger_transactions"
        set "posting_status" = 'posted', "posted_at" = now()
        where "id" = ${transactionId}
      `;

      await mutator`BEGIN`;
      await setTenantContext(mutator, orgA, userA);
      const mutatorPidRows = await mutator<{ pid: number }[]>`select pg_backend_pid() as "pid"`;
      const entryMutation = mutator`
        update "label_suite"."royalty_ledger_entries"
        set "description" = 'must-not-race-posting'
        where "id" = ${entryId}
      `.execute().then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await waitForDatabaseLock(client, mutatorPidRows[0]!.pid);
      await poster`COMMIT`;
      posterCommitted = true;
      const mutationOutcome = await entryMutation;
      expect(mutationOutcome.ok).toBe(false);
      if (mutationOutcome.ok) throw new Error("Concurrent entry mutation unexpectedly succeeded after posting.");
      expect(String((mutationOutcome.error as Error).message)).toContain("Entries for posted or reversed royalty ledger transactions are append-only");
    } finally {
      if (!posterCommitted) await poster`ROLLBACK`;
      await mutator`ROLLBACK`;
      await poster.end({ timeout: 5 });
      await mutator.end({ timeout: 5 });
      if (!adminClient) throw new Error("Royalty lifecycle integration admin database was not initialized.");
      await cleanupCommittedRaceFixtures(adminClient, [entryId, transactionId]);
    }
  });
});
