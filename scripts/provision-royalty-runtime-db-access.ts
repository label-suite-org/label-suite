import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { assertRoyaltyRuntimePrincipalPosture } from "./royalty-runtime-db-posture";

export function quoteDatabaseIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function provisionRoyaltyRuntimeDatabaseAccess(
  runtimeDatabaseUrl: string,
  migrationDatabaseUrl: string,
): Promise<void> {
  const runtimeClient = new Client({ connectionString: runtimeDatabaseUrl });
  const migrationClient = new Client({ connectionString: migrationDatabaseUrl });
  let migrationConnected = false;
  let transactionStarted = false;

  try {
    await runtimeClient.connect();
    const runtimeResult = await runtimeClient.query<{
      principal: string;
      can_login: boolean;
      superuser: boolean;
      bypass_rls: boolean;
    }>(`
      select current_user as principal, rolcanlogin as can_login,
        rolsuper as superuser, rolbypassrls as bypass_rls
      from pg_roles
      where rolname = current_user
    `);
    const runtime = runtimeResult.rows[0];
    if (!runtime?.can_login) throw new Error("Could not resolve a login-capable royalty runtime principal.");
    assertRoyaltyRuntimePrincipalPosture({
      principal: runtime.principal,
      superuser: runtime.superuser,
      bypassRls: runtime.bypass_rls,
    });

    await migrationClient.connect();
    migrationConnected = true;
    const migrationResult = await migrationClient.query<{ principal: string }>(
      "select current_user as principal",
    );
    if (migrationResult.rows[0]?.principal === runtime.principal) {
      throw new Error("DATABASE_URL and MIGRATION_DATABASE_URL must use different database principals.");
    }

    const runtimeRole = quoteDatabaseIdentifier(runtime.principal);
    await migrationClient.query("begin");
    transactionStarted = true;
    await migrationClient.query(`grant usage on schema label_suite to ${runtimeRole}`);
    await migrationClient.query(
      `grant select, insert, update, delete on all tables in schema label_suite to ${runtimeRole}`,
    );
    await migrationClient.query(
      `grant usage, select, update on all sequences in schema label_suite to ${runtimeRole}`,
    );
    await migrationClient.query(
      `grant execute on function label_suite.establish_royalty_lifecycle_context(text, text) to ${runtimeRole}`,
    );
    await migrationClient.query(
      `revoke all on table label_suite.royalty_lifecycle_contexts from ${runtimeRole}`,
    );
    const notifications = await migrationClient.query<{ routine: string | null }>(
      "select to_regprocedure('label_suite.register_notification_device(text,text,text,text,uuid)')::text as routine",
    );
    if (notifications.rows[0]?.routine) {
      const ownerAccess = await migrationClient.query<{ inherited: boolean }>(
        "select pg_has_role($1, proowner, 'USAGE') as inherited from pg_proc where oid = to_regprocedure('label_suite.register_notification_device(text,text,text,text,uuid)')",
        [runtime.principal],
      );
      if (ownerAccess.rows[0]?.inherited) throw new Error("Notification runtime must not own or inherit the privileged registration routine.");
      await migrationClient.query(
        `grant execute on function label_suite.register_notification_device(text,text,text,text,uuid) to ${runtimeRole}`,
      );
    }
    await migrationClient.query(
      `alter default privileges in schema label_suite grant select, insert, update, delete on tables to ${runtimeRole}`,
    );
    await migrationClient.query(
      `alter default privileges in schema label_suite grant usage, select, update on sequences to ${runtimeRole}`,
    );
    await migrationClient.query("commit");
    transactionStarted = false;
  } catch (error) {
    if (migrationConnected && transactionStarted) {
      await migrationClient.query("rollback").catch(() => undefined);
    }
    throw error;
  } finally {
    await Promise.allSettled([runtimeClient.end(), migrationClient.end()]);
  }
}

const isEntrypoint = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  const runtimeDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (!runtimeDatabaseUrl) throw new Error("DATABASE_URL is required for royalty runtime access provisioning.");
  const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();
  if (!migrationDatabaseUrl) {
    throw new Error("MIGRATION_DATABASE_URL is required for royalty runtime access provisioning.");
  }
  await provisionRoyaltyRuntimeDatabaseAccess(runtimeDatabaseUrl, migrationDatabaseUrl);
  console.log("Royalty runtime database access verified.");
}
