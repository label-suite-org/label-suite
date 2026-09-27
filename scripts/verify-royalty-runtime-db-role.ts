import "dotenv/config";
import { Pool } from "pg";
import {
  REQUIRED_FORCE_RLS_TABLES,
  assertRoyaltyRuntimePrincipalPosture,
  assertRoyaltyRuntimeAccessPosture,
  assertRoyaltyRuntimeTablePosture,
} from "./royalty-runtime-db-posture";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const modes = process.argv.slice(2);
if (modes.length !== 1 || !["--preflight", "--postflight"].includes(modes[0]!)) {
  throw new Error("Royalty runtime database verifier requires exactly one mode: --preflight or --postflight.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  if (modes[0] === "--preflight") {
    const principalResult = await pool.query<{
      principal: string;
      superuser: boolean;
      bypass_rls: boolean;
    }>(`
      select current_user as principal, rolsuper as superuser, rolbypassrls as bypass_rls
      from pg_roles
      where rolname = current_user
    `);
    const principal = principalResult.rows[0];
    if (!principal) throw new Error("Could not resolve the DATABASE_URL principal.");

    assertRoyaltyRuntimePrincipalPosture({
      principal: principal.principal,
      superuser: principal.superuser,
      bypassRls: principal.bypass_rls,
    });
    console.log(`Royalty runtime database principal verified for ${principal.principal}.`);
  } else {
    const forceRlsResult = await pool.query<{ table_name: string }>(`
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'label_suite'
        and c.relname = any($1::text[])
        and c.relrowsecurity
        and c.relforcerowsecurity
    `, [[...REQUIRED_FORCE_RLS_TABLES]]);
    assertRoyaltyRuntimeTablePosture({
      forceRlsTables: forceRlsResult.rows.map((row) => row.table_name),
    });
    const accessResult = await pool.query<{
      schema_usage: boolean;
      establish_lifecycle_context: boolean;
      lifecycle_context_table: boolean;
    }>(`
      select
        has_schema_privilege(current_user, 'label_suite', 'USAGE') as schema_usage,
        has_function_privilege(
          current_user,
          'label_suite.establish_royalty_lifecycle_context(text,text)',
          'EXECUTE'
        ) as establish_lifecycle_context,
        (
          has_table_privilege(current_user, 'label_suite.royalty_lifecycle_contexts', 'SELECT')
          or has_table_privilege(current_user, 'label_suite.royalty_lifecycle_contexts', 'INSERT')
          or has_table_privilege(current_user, 'label_suite.royalty_lifecycle_contexts', 'UPDATE')
          or has_table_privilege(current_user, 'label_suite.royalty_lifecycle_contexts', 'DELETE')
        ) as lifecycle_context_table
    `);
    const access = accessResult.rows[0];
    if (!access) throw new Error("Could not resolve royalty runtime database access.");
    assertRoyaltyRuntimeAccessPosture({
      schemaUsage: access.schema_usage,
      establishLifecycleContext: access.establish_lifecycle_context,
      lifecycleContextTable: access.lifecycle_context_table,
    });
    console.log("Royalty runtime FORCE-RLS table posture verified.");
  }
} finally {
  await pool.end();
}
