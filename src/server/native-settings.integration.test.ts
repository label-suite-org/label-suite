import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const org = `settings-${randomUUID()}`, other = `${org}-other`, user = `${org}-user`;
const secret = "settings-secret-canary";
let sql: Sql;
let settings: typeof import("./native-settings").getNativeSettings;
let handoff: typeof import("./native-settings").getNativeHandoff;

describe.skipIf(process.env.NATIVE_SETTINGS_INTEGRATION !== "1")("native Settings projection", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("_fixture")) throw new Error("Disposable local fixture database required");
    sql = postgres(url.toString(), { max: 2 });
    const { getNativeSettings } = await import("./native-settings");
    handoff = (await import("./native-settings")).getNativeHandoff;
    const { runWithDatabaseContext } = await import("../lib/db");
    settings = (orgId, userId, scope) => runWithDatabaseContext({ orgId, userId }, () => getNativeSettings(orgId, userId, scope), { isolationLevel: "repeatable read" });
    await sql`insert into label_suite.user(id,name,email,"emailVerified") values (${user},'Settings user',${`${secret}-${user}@example.test`},true)`;
    for (const id of [org, other]) {
      await sql`insert into label_suite.orgs(id,name,slug) values (${id},${id},${id})`;
      await sql`insert into label_suite.artists(id,org_id,name) values (${id},${id},'Settings artist')`;
      await sql`insert into label_suite.releases(id,org_id,artist_id,title) values (${id},${id},${id},'Settings release')`;
      await sql`insert into label_suite.integration_providers(id,org_id,key,name,category) values (${id},${id},'fixture','Fixture provider','test')`;
      await sql`insert into label_suite.integration_connections(id,org_id,provider_id,label,status,auth_ref,settings) values (${id},${id},${id},${secret},'needs_attention',${secret},${sql.json({ token: secret })})`;
    }
    await sql`insert into label_suite.org_memberships(id,org_id,user_id,role) values (${org},${org},${user},'owner')`;
    await sql`insert into label_suite.sync_jobs(id,org_id,connection_id,provider_key,job_type,status,idempotency_key,error_summary,cursor_after) values (${org},${org},${org},'fixture','pull','failed',${org},${secret},${secret})`;
    await sql`insert into label_suite.integration_errors(id,org_id,connection_id,message,metadata) values (${org},${org},${org},${secret},${sql.json({ secret })})`;
    await sql`insert into label_suite.calendar_connections(org_id,google_sub,email,refresh_token,calendar_id,origin,error) values (${org},${secret},${secret},${secret},${secret},'https://suite.test',${secret})`;
  });
  afterAll(async () => {
    if (!sql) return;
    await sql`delete from label_suite.calendar_connections where org_id=${org}`;
    await sql`delete from label_suite.integration_errors where org_id=${org}`;
    await sql`delete from label_suite.sync_jobs where org_id=${org}`;
    await sql`delete from label_suite.integration_connections where org_id in (${org},${other})`;
    await sql`delete from label_suite.integration_providers where org_id in (${org},${other})`;
    await sql`delete from label_suite.org_memberships where org_id=${org}`;
    await sql`delete from label_suite.releases where org_id in (${org},${other})`;
    await sql`delete from label_suite.artists where org_id in (${org},${other})`;
    await sql`delete from label_suite.audit_logs where org_id in (${org},${other})`;
    await sql`delete from label_suite.orgs where id in (${org},${other})`;
    await sql`delete from label_suite.user where id=${user}`;
    await sql.end();
  });

  it("returns tenant-scoped stored health without credentials or raw provider errors", async () => {
    const result = await settings(org, user);
    expect(result.account).toEqual({ name: "Settings user" });
    expect(result.workspace).toEqual({ id: org, name: org, role: "owner" });
    expect(result.members?.items).toEqual([{ id: org, name: "Settings user", role: "owner" }]);
    expect(result.integrations?.items).toEqual([expect.objectContaining({ id: org, status: "needs_attention", latestSyncStatus: "failed", hasUnresolvedErrors: true })]);
    expect(result.integrations?.calendar?.status).toBe("needs_attention");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(other);
    await expect(settings(other, user)).rejects.toMatchObject({ status: 403, code: "workspace_access_removed" });
  });

  it("bounds pages and validates offsets before querying", async () => {
    const result = await settings(org, user, { membersOffset: 1, integrationsOffset: 1 });
    expect(result.members).toEqual({ items: [], offset: 1, hasMore: false });
    expect(result.integrations?.items).toEqual([]);
    await expect(settings(org, user, { membersOffset: -1 })).rejects.toThrow();
    await expect(settings(org, user, { integrationsOffset: 10001 })).rejects.toThrow();
    await sql`insert into label_suite.integration_connections(id,org_id,provider_id,label)
      select ${org} || '-page-' || n,${org},${org},'Page ' || n from generate_series(1,50) n`;
    try {
      const first = (await settings(org, user)).integrations!;
      const next = (await settings(org, user, { integrationsOffset: 50 })).integrations!;
      expect(first.items).toHaveLength(50);
      expect(first.hasMore).toBe(true);
      expect(next.items).toHaveLength(1);
      expect(next.hasMore).toBe(false);
      expect(first.items.some(item => item.id === next.items[0].id)).toBe(false);
    } finally {
      await sql`delete from label_suite.integration_connections where org_id=${org} and id<>${org}`;
    }
  });

  it("allows only reviewed destinations in the selected workspace", async () => {
    expect(await handoff(user, { workspaceId: org, operation: "integration-credentials" })).toMatchObject({ workspaceId: org, destination: "/integrations" });
    await expect(handoff(user, { workspaceId: other, operation: "integration-credentials" })).rejects.toMatchObject({ status: 403 });
    for (const operation of ["https://attacker.test", "payment-execution", "destructive-bulk"]) {
      await expect(handoff(user, { workspaceId: org, operation })).rejects.toMatchObject({ status: 403 });
    }
    await expect(handoff(user, { workspaceId: org, operation: "analytics-import", artist: "missing" })).rejects.toMatchObject({ status: 404 });
    const scoped = await handoff(user, { workspaceId: org, operation: "analytics-import", artist: org, release: org });
    expect(new URL(scoped.destination, "https://suite.test").searchParams.get("release")).toBe(org);
    for (const scope of [{ artist: other }, { release: other }]) {
      await expect(handoff(user, { workspaceId: org, operation: "analytics-import", ...scope })).rejects.toMatchObject({ status: 404 });
    }
    await expect(handoff(user, { workspaceId: org, operation: "integration-credentials", artist: "missing" })).rejects.toMatchObject({ status: 400 });
    await expect(handoff(user, { workspaceId: org, operation: "integration-credentials", destination: "https://attacker.test" })).rejects.toThrow();
  });

  it("rechecks current role and revocation instead of trusting an earlier native workspace", async () => {
    await sql`update label_suite.org_memberships set role='member' where id=${org}`;
    const member = await settings(org, user);
    expect(member.integrations).toBeNull();
    expect(member.members?.items).toHaveLength(1);
    expect(member.webExceptions.map(item => item.id)).toEqual(["payment-execution"]);
    await expect(handoff(user, { workspaceId: org, operation: "integration-credentials" })).rejects.toMatchObject({ status: 403 });
    await sql`update label_suite.org_memberships set role='payee' where id=${org}`;
    const payee = await settings(org, user);
    expect(payee.members).toBeNull();
    expect(payee.integrations).toBeNull();
    expect(payee.webExceptions).toEqual([]);
    await sql`delete from label_suite.org_memberships where id=${org}`;
    await expect(settings(org, user)).rejects.toMatchObject({ status: 403 });
  });
});
