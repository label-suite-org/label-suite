import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.DASHBOARD_PREFERENCES_RLS_TEST === "1";
const describeRls = enabled ? describe : describe.skip;
const databaseUrl = enabled ? assertLocalCiDatabase(process.env.DATABASE_URL) : undefined;
const role = `dashboard_preferences_rls_${process.pid}`;
const orgA = `dashboard-preferences-org-a-${process.pid}`;
const orgB = `dashboard-preferences-org-b-${process.pid}`;
const userA = `dashboard-preferences-user-a-${process.pid}`;
const userB = `dashboard-preferences-user-b-${process.pid}`;
let sql: Sql | undefined;

describeRls("dashboard preferences personal RLS", () => {
  beforeAll(async () => {
    sql = postgres(databaseUrl!, { max: 1 });
    await sql`begin`;
    await sql.unsafe(`create role ${quoteIdentifier(role)} nologin nosuperuser nobypassrls`);
    await sql.unsafe(`grant usage on schema "label_suite" to ${quoteIdentifier(role)}`);
    await sql.unsafe(`grant select, insert, update, delete on "label_suite"."dashboard_preferences" to ${quoteIdentifier(role)}`);
    await seedFixture(sql);
    await sql.unsafe(`set role ${quoteIdentifier(role)}`);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`rollback`;
    await sql.end();
  });

  it("blocks cross-user reads, updates, deletes, and inserts", async () => {
    await setContext(sql!, orgA, userA);

    const visible = await sql!<{ id: string }[]>`
      select id from "label_suite"."dashboard_preferences" order by id
    `;
    expect(visible.map((row) => row.id)).toEqual([`${orgA}:${userA}`]);

    const updated = await sql!`
      update "label_suite"."dashboard_preferences"
      set "schema_version" = 2
      where "id" = ${`${orgA}:${userB}`}
      returning "id"
    `;
    expect(updated.count).toBe(0);

    const deleted = await sql!`
      delete from "label_suite"."dashboard_preferences"
      where "id" = ${`${orgA}:${userB}`}
      returning "id"
    `;
    expect(deleted.count).toBe(0);

    await sql!`savepoint rejected_cross_user_insert`;
    let insertError: unknown;
    try {
      await sql!`
        insert into "label_suite"."dashboard_preferences" (
          "id", "org_id", "user_id", "pinned_indicator_ids", "section_order", "hidden_section_ids"
        ) values (
          ${`${orgA}:${userB}:forged`}, ${orgA}, ${userB}, '[]'::jsonb,
          '["releases","tasks","catalog","analytics","royalties","funding"]'::jsonb, '[]'::jsonb
        )
      `;
    } catch (error) {
      insertError = error;
      await sql!`rollback to savepoint rejected_cross_user_insert`;
    }
    await sql!`release savepoint rejected_cross_user_insert`;
    expect(insertError).toEqual(expect.objectContaining({ message: expect.stringMatching(/row-level security policy/i) }));
  });

  it("blocks cross-organization access for the same user", async () => {
    await setContext(sql!, orgA, userA);
    const hidden = await sql!<{ id: string }[]>`
      select id from "label_suite"."dashboard_preferences"
      where "id" = ${`${orgB}:${userA}`}
    `;
    expect(hidden).toEqual([]);

    const updated = await sql!`
      update "label_suite"."dashboard_preferences"
      set "schema_version" = 2
      where "id" = ${`${orgB}:${userA}`}
      returning "id"
    `;
    expect(updated.count).toBe(0);

    const deleted = await sql!`
      delete from "label_suite"."dashboard_preferences"
      where "id" = ${`${orgB}:${userA}`}
      returning "id"
    `;
    expect(deleted.count).toBe(0);

    await sql!`savepoint rejected_cross_organization_insert`;
    let insertError: unknown;
    try {
      await sql!`
        insert into "label_suite"."dashboard_preferences" (
          "id", "org_id", "user_id", "pinned_indicator_ids", "section_order", "hidden_section_ids"
        ) values (
          ${`${orgB}:${userA}:forged`}, ${orgB}, ${userA}, '[]'::jsonb,
          '["releases","tasks","catalog","analytics","royalties","funding"]'::jsonb, '[]'::jsonb
        )
      `;
    } catch (error) {
      insertError = error;
      await sql!`rollback to savepoint rejected_cross_organization_insert`;
    }
    await sql!`release savepoint rejected_cross_organization_insert`;
    expect(insertError).toEqual(expect.objectContaining({ message: expect.stringMatching(/row-level security policy/i) }));

    await setContext(sql!, orgB, userA);
    const visible = await sql!<{ id: string }[]>`
      select id from "label_suite"."dashboard_preferences"
    `;
    expect(visible.map((row) => row.id)).toEqual([`${orgB}:${userA}`]);
  });
});

async function seedFixture(client: Sql): Promise<void> {
  await client`
    insert into "label_suite"."orgs" ("id", "name", "slug") values
      (${orgA}, 'Dashboard RLS org A', ${orgA}),
      (${orgB}, 'Dashboard RLS org B', ${orgB})
  `;
  await client`
    insert into "label_suite"."user" ("id", "name", "email", "emailVerified") values
      (${userA}, 'Dashboard RLS user A', ${`${userA}@example.test`}, true),
      (${userB}, 'Dashboard RLS user B', ${`${userB}@example.test`}, true)
  `;
  await client`
    insert into "label_suite"."dashboard_preferences" (
      "id", "org_id", "user_id", "pinned_indicator_ids", "section_order", "hidden_section_ids"
    ) values
      (${`${orgA}:${userA}`}, ${orgA}, ${userA}, '[]'::jsonb, '["releases","tasks","catalog","analytics","royalties","funding"]'::jsonb, '[]'::jsonb),
      (${`${orgA}:${userB}`}, ${orgA}, ${userB}, '[]'::jsonb, '["releases","tasks","catalog","analytics","royalties","funding"]'::jsonb, '[]'::jsonb),
      (${`${orgB}:${userA}`}, ${orgB}, ${userA}, '[]'::jsonb, '["releases","tasks","catalog","analytics","royalties","funding"]'::jsonb, '[]'::jsonb)
  `;
}

async function setContext(client: Sql, orgId: string, userId: string): Promise<void> {
  await client`select set_config('app.current_org_id', ${orgId}, true)`;
  await client`select set_config('app.current_user_id', ${userId}, true)`;
}

function assertLocalCiDatabase(value: string | undefined): string {
  let target: URL;
  try {
    target = new URL(value ?? "");
  } catch {
    throw new Error("Refusing dashboard RLS test target: DATABASE_URL must be a valid local PostgreSQL URL.");
  }
  const database = decodeURIComponent(target.pathname).replace(/^\/+/, "");
  if (
    !["postgres:", "postgresql:"].includes(target.protocol)
    || !["127.0.0.1", "localhost", "database"].includes(target.hostname)
    || database !== "label_suite"
    || target.search
    || target.hash
  ) {
    throw new Error("Refusing dashboard RLS test target: require the exact local label_suite CI database.");
  }
  return target.toString();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
