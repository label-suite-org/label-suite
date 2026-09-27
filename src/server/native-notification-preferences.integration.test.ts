import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const enabled = process.env.NATIVE_NOTIFICATIONS_INTEGRATION === "1";
const org = `notifications-${randomUUID()}`, otherOrg = `${org}-other`, user = `${org}-user`, otherUser = `${org}-other-user`;
const primaryToken = randomUUID().replaceAll("-", ""), secondaryToken = randomUUID().replaceAll("-", ""), cancellationToken = randomUUID().replaceAll("-", "");
let sql: Sql;
let preferences: typeof import("./native-notification-preferences").nativeNotificationPreferences;
let devices: typeof import("./native-notification-devices");

describe.skipIf(!enabled)("native notification consent persistence", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("_fixture")) throw new Error("Disposable local fixture database required");
    sql = postgres(url.toString(), { max: 2 });
    if (!(await sql`select to_regclass('label_suite.notification_preferences') as name`)[0].name) {
      await sql.unsafe(await readFile(new URL("../../drizzle/0096_notification_preferences.sql", import.meta.url), "utf8"));
    }
    if (!(await sql`select to_regclass('label_suite.notification_devices') as name`)[0].name) {
      await sql.unsafe(await readFile(new URL("../../drizzle/0097_notification_devices.sql", import.meta.url), "utf8"));
    }
    if (!(await sql`select to_regclass('label_suite.notification_device_attempts') as name`)[0].name) {
      await sql.unsafe(await readFile(new URL("../../drizzle/0100_notification_device_attempts.sql", import.meta.url), "utf8"));
    }
    preferences = (await import("./native-notification-preferences")).nativeNotificationPreferences;
    devices = await import("./native-notification-devices");
    vi.stubEnv("APNS_ENVIRONMENT", "sandbox");
    vi.stubEnv("APNS_ENABLED", "true"); vi.stubEnv("APNS_KEY_ID", "ABCDEFGHIJ"); vi.stubEnv("APNS_TEAM_ID", "0123456789");
    vi.stubEnv("APNS_PRIVATE_KEY", generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    for (const id of [user, otherUser]) await sql`insert into label_suite.user (id,name,email,"emailVerified") values (${id},'Notification test',${`${id}@example.test`},true)`;
    for (const id of [org, otherOrg]) {
      await sql`insert into label_suite.orgs (id,name,slug) values (${id},'Notification fixture',${id})`;
      for (const actor of [user, otherUser]) await sql`insert into label_suite.org_memberships (id,org_id,user_id,role) values (${`${id}-${actor}`},${id},${actor},'owner')`;
    }
    for (const actor of [user, otherUser]) await sql`insert into label_suite.session (id,"userId",token,"expiresAt") values (${`${actor}-session`},${actor},${randomUUID()},now()+interval '1 day')`;
  }, 20_000);
  afterAll(async () => {
    if (!sql) return;
    vi.unstubAllEnvs();
    await sql`delete from label_suite.notification_devices where user_id in (${user},${otherUser})`;
    await sql`delete from label_suite.session where "userId" in (${user},${otherUser})`;
    await sql`delete from label_suite.org_memberships where org_id in (${org},${otherOrg})`;
    await sql`delete from label_suite.job_runs where org_id in (${org},${otherOrg})`;
    await sql`delete from label_suite.audit_logs where org_id in (${org},${otherOrg})`;
    await sql`delete from label_suite.orgs where id in (${org},${otherOrg})`;
    await sql`delete from label_suite.user where id in (${user},${otherUser})`;
    await sql.end();
  });

  it("reports disabled delivery and refuses device registration before touching stored tokens", async () => {
    vi.stubEnv("APNS_ENABLED", "false");
    try {
      expect((await preferences(org, user)).deliveryConfigured).toBe(false);
      await expect(devices.registerNotificationDevice(org, user, `${user}-session`, { attemptId: randomUUID(), token: primaryToken, permission: "authorized" })).rejects.toMatchObject({ status: 503, code: "notifications_unavailable" });
      expect(await sql`select id from label_suite.notification_devices where user_id=${user}`).toHaveLength(0);
    } finally { vi.stubEnv("APNS_ENABLED", "true"); }
  });

  it("defaults off and scopes writes to the authenticated user/workspace/category", async () => {
    expect((await preferences(org, user)).deliveryConfigured).toBe(true);
    expect((await preferences(org, user)).categories).toHaveLength(5);
    expect((await preferences(org, user)).categories.every((item) => !item.enabled && item.generation === 0)).toBe(true);
    await sql`insert into label_suite.job_runs(id,org_id,job_type,trigger,status,idempotency_key)
      select ${`${org}-completed-`} || step,${org},'notification_sync','scheduled','succeeded',
        'notifications:' || (floor(extract(epoch from clock_timestamp()) / 60)::bigint + step)::text
      from generate_series(0,1) step`;
    const result = await preferences(org, user, { category: "assignments", enabled: true, expectedGeneration: 0 });
    expect(await sql`select id from label_suite.job_runs where org_id=${org} and job_type='notification_sync' and status='queued' and available_at <= clock_timestamp()`).toHaveLength(1);
    expect(result.categories.filter((item) => item.enabled)).toEqual([{ category: "assignments", enabled: true, generation: 1 }]);
    expect((await preferences(org, otherUser)).categories.every((item) => !item.enabled)).toBe(true);
    expect((await preferences(otherOrg, user)).categories.every((item) => !item.enabled)).toBe(true);
    await expect(preferences(org, user, { category: "assignments", enabled: true, expectedGeneration: 1, userId: otherUser })).rejects.toThrow();
  });

  it("preserves opt-in time on retry and rejects stale concurrent edits", async () => {
    const before = await sql`select enabled_at::text from label_suite.notification_preferences where org_id=${org} and user_id=${user} and category='assignments'`;
    await preferences(org, user, { category: "assignments", enabled: true, expectedGeneration: 1 });
    expect(await sql`select enabled_at::text from label_suite.notification_preferences where org_id=${org} and user_id=${user} and category='assignments'`).toEqual(before);
    const results = await Promise.allSettled([
      preferences(org, user, { category: "assignments", enabled: false, expectedGeneration: 1 }),
      preferences(org, user, { category: "assignments", enabled: false, expectedGeneration: 1 }),
    ]);
    expect(results.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((value) => value.status === "rejected")).toHaveLength(1);
    await preferences(org, user, { category: "assignments", enabled: true, expectedGeneration: 2 });
    const after = (await sql`select enabled_at, generation from label_suite.notification_preferences where org_id=${org} and user_id=${user} and category='assignments'`)[0];
    expect(after.generation).toBe(3);
    expect(after.enabled_at).not.toBeNull();
  });

  it("invalidates consent through downgrade and restoration even without a worker run", async () => {
    await preferences(org, user, { category: "requested_reviews", enabled: true, expectedGeneration: 0 });
    await sql`update label_suite.org_memberships set role='member' where org_id=${org} and user_id=${user}`;
    const member = await preferences(org, user);
    expect(member.categories.some((item) => item.category === "requested_reviews")).toBe(false);
    expect(member.categories.every((item) => !item.enabled)).toBe(true);
    await expect(preferences(org, user, { category: "requested_reviews", enabled: true, expectedGeneration: 2 })).rejects.toThrow("Insufficient permissions");
    await sql`update label_suite.org_memberships set role='owner' where org_id=${org} and user_id=${user}`;
    const restored = await preferences(org, user);
    expect(restored.categories.every((item) => !item.enabled)).toBe(true);
    expect(restored.categories.find((item) => item.category === "requested_reviews")?.generation).toBe(3);
  });

  it("removes stored consent with membership and rejects revoked access", async () => {
    await preferences(otherOrg, otherUser, { category: "deadlines", enabled: true, expectedGeneration: 0 });
    await sql`delete from label_suite.org_memberships where org_id=${otherOrg} and user_id=${otherUser}`;
    expect(await sql`select category from label_suite.notification_preferences where org_id=${otherOrg} and user_id=${otherUser}`).toHaveLength(0);
    await expect(preferences(otherOrg, otherUser)).rejects.toThrow("Workspace access removed");
  });

  it("enforces recipient and tenant isolation for a database role without RLS bypass", async () => {
    await preferences(org, otherUser, { category: "record_changes", enabled: true, expectedGeneration: 0 });
    await preferences(otherOrg, user, { category: "record_changes", enabled: true, expectedGeneration: 0 });
    const role = `notification_test_${randomUUID().replaceAll("-", "")}`;
    const rollback = new Error("Rollback fixture role");
    await expect(sql.begin(async (tx) => {
      await tx.unsafe(`create role ${role} nologin`);
      await tx.unsafe(`grant usage on schema label_suite to ${role}`);
      await tx.unsafe(`grant select, insert, update on label_suite.notification_preferences to ${role}`);
      await tx.unsafe(`grant execute on function label_suite.current_org_id(), label_suite.current_user_id() to ${role}`);
      await tx`select set_config('app.current_org_id',${org},true), set_config('app.current_user_id',${user},true)`;
      await tx.unsafe(`set local role ${role}`);
      const rows = await tx`select org_id,user_id from label_suite.notification_preferences`;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.org_id === org && row.user_id === user)).toBe(true);
      expect(await tx`update label_suite.notification_preferences set enabled_at=null where user_id=${otherUser} returning category`).toHaveLength(0);
      await expect(tx.savepoint(async (sp) => {
        await sp`insert into label_suite.notification_preferences (org_id,user_id,category,enabled_role) values (${org},${otherUser},'deadlines','owner')`;
      })).rejects.toThrow(/row-level security/);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("cannot leave consent enabled when opt-in races a role downgrade", async () => {
    const generation = (await preferences(org, user)).categories.find((item) => item.category === "requested_reviews")!.generation;
    const results = await Promise.allSettled([
      preferences(org, user, { category: "requested_reviews", enabled: true, expectedGeneration: generation }),
      sql`update label_suite.org_memberships set role='member' where org_id=${org} and user_id=${user}`,
    ]);
    expect(results[1].status).toBe("fulfilled");
    expect((await sql`select enabled_at from label_suite.notification_preferences where org_id=${org} and user_id=${user} and category='requested_reviews'`)[0].enabled_at).toBeNull();
  });

  it("forces preference privacy for the table owner while allowing narrow role-change invalidation", async () => {
    const role = `notification_owner_${randomUUID().replaceAll("-", "")}`;
    const rollback = new Error("Rollback owner fixture");
    await expect(sql.begin(async (tx) => {
      await tx.unsafe(`create role ${role} nologin`);
      await tx.unsafe(`grant usage,create on schema label_suite to ${role}`);
      await tx.unsafe(`grant select,update on label_suite.org_memberships to ${role}`);
      await tx.unsafe(`alter table label_suite.notification_preferences owner to ${role}`);
      await tx.unsafe(`alter function label_suite.invalidate_notification_consent() owner to ${role}`);
      await tx`select set_config('app.current_org_id',${org},true), set_config('app.current_user_id',${user},true)`;
      await tx.unsafe(`set local role ${role}`);
      const rows = await tx`select user_id,org_id from label_suite.notification_preferences`;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.user_id === user && row.org_id === org)).toBe(true);
      await tx`update label_suite.org_memberships set role='member' where org_id=${org} and user_id=${otherUser}`;
      expect((await tx`select current_setting('app.current_user_id') as actor`)[0].actor).toBe(user);
      await tx`select set_config('app.current_user_id',${otherUser},true)`;
      expect((await tx`select enabled_at,generation from label_suite.notification_preferences where category='record_changes'`)[0]).toEqual({ enabled_at: null, generation: 2 });
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("requires explicit consent and a live session owned by the registering account", async () => {
    const input = { attemptId: randomUUID(), token: primaryToken, permission: "authorized" };
    await expect(devices.registerNotificationDevice(org, user, `${user}-session`, input)).rejects.toThrow("consent");
    await preferences(org, user, { category: "deadlines", enabled: true, expectedGeneration: 0 });
    await expect(devices.registerNotificationDevice(org, user, `${otherUser}-session`, input)).rejects.toThrow("consent");
    await expect(devices.registerNotificationDevice("removed-workspace", user, `${user}-session`, input)).rejects.toThrow("consent");
    await expect(devices.registerNotificationDevice(org, user, `${user}-session`, { ...input, permission: "provisional" })).rejects.toThrow();
    const registration = await devices.registerNotificationDevice(org, user, `${user}-session`, input);
    expect(Object.keys(registration).sort()).toEqual(["generation", "id"]);
    expect(registration.generation).toBe(1);
    expect(await devices.registerNotificationDevice(org, user, `${user}-session`, input)).toEqual(registration);
  });

  it("atomically rebinds token ownership and rejects delayed old-account removal", async () => {
    const input = { attemptId: randomUUID(), token: primaryToken.toUpperCase(), permission: "authorized" };
    const original = await devices.registerNotificationDevice(org, user, `${user}-session`, input);
    const rebound = await devices.registerNotificationDevice(org, otherUser, `${otherUser}-session`, input);
    expect(rebound.id).toBe(original.id);
    expect(rebound.generation).toBe(original.generation + 1);
    await devices.removeNotificationDevice(user, `${user}-session`, { attemptId: input.attemptId });
    const [stored] = await sql`select user_id,session_id,generation from label_suite.notification_devices where id=${rebound.id}`;
    expect(stored).toEqual({ user_id: otherUser, session_id: `${otherUser}-session`, generation: rebound.generation });
    await devices.removeNotificationDevice(otherUser, `${otherUser}-session`, { attemptId: input.attemptId });
    expect((await sql`select session_id,generation from label_suite.notification_devices where id=${rebound.id}`)[0]).toEqual({ session_id: null, generation: rebound.generation + 1 });
  });

  it("cancels uncertain registrations before or after POST and isolates later attempts", async () => {
    const input = { attemptId: randomUUID(), token: cancellationToken, permission: "authorized" };
    await devices.removeNotificationDevice(user, `${user}-session`, { attemptId: input.attemptId });
    await expect(devices.registerNotificationDevice(org, user, `${user}-session`, input)).rejects.toThrow("consent");
    const first = { ...input, attemptId: randomUUID() };
    const committed = await devices.registerNotificationDevice(org, user, `${user}-session`, first);
    // A lost response is recoverable without advancing delivery generation.
    expect(await devices.registerNotificationDevice(org, user, `${user}-session`, first)).toEqual(committed);
    await devices.removeNotificationDevice(user, `${user}-session`, { attemptId: first.attemptId });
    const next = { ...input, attemptId: randomUUID() };
    const fresh = await devices.registerNotificationDevice(org, user, `${user}-session`, next);
    await devices.removeNotificationDevice(user, `${user}-session`, { attemptId: first.attemptId });
    await expect(devices.registerNotificationDevice(org, user, `${user}-session`, first)).rejects.toThrow("consent");
    expect(await devices.registerNotificationDevice(org, user, `${user}-session`, next)).toEqual(fresh);
    expect((await sql`select session_id,attempt_id,generation from label_suite.notification_devices where id=${fresh.id}`)[0])
      .toEqual({ session_id: `${user}-session`, attempt_id: next.attemptId, generation: fresh.generation });
    // Account B starts only after A's uncertain attempt has been cancelled with A's credential.
    const delayed = { ...input, token: randomUUID().replaceAll("-", ""), attemptId: randomUUID() };
    await devices.removeNotificationDevice(user, `${user}-session`, { attemptId: delayed.attemptId });
    const accountB = await devices.registerNotificationDevice(org, otherUser, `${otherUser}-session`, { ...delayed, attemptId: randomUUID() });
    await expect(devices.registerNotificationDevice(org, user, `${user}-session`, delayed)).rejects.toThrow("consent");
    expect((await sql`select user_id from label_suite.notification_devices where id=${accountB.id}`)[0].user_id).toBe(otherUser);
    const rebound = await devices.registerNotificationDevice(org, otherUser, `${otherUser}-session`, { ...next, attemptId: randomUUID() });
    await expect(devices.registerNotificationDevice(org, user, `${user}-session`, next)).rejects.toThrow("consent");
    expect((await sql`select user_id,generation from label_suite.notification_devices where id=${fresh.id}`)[0])
      .toEqual({ user_id: otherUser, generation: rebound.generation });
  });

  it("invalidates registration with session deletion and rejects expired sessions", async () => {
    const input = { attemptId: randomUUID(), token: secondaryToken, permission: "authorized" };
    const registration = await devices.registerNotificationDevice(org, user, `${user}-session`, input);
    await sql`update label_suite.session set "expiresAt"=now()-interval '1 minute' where id=${`${user}-session`}`;
    await expect(devices.registerNotificationDevice(org, user, `${user}-session`, input)).rejects.toThrow("consent");
    await sql`delete from label_suite.session where id=${`${user}-session`}`;
    expect((await sql`select session_id from label_suite.notification_devices where id=${registration.id}`)[0].session_id).toBeNull();
  });

  it("allows scoped registration through the definer routine without granting token-table access", async () => {
    const role = `notification_register_${randomUUID().replaceAll("-", "")}`;
    const rollback = new Error("Rollback registration fixture");
    await expect(sql.begin(async (tx) => {
      await tx.unsafe(`create role ${role} nologin`);
      await tx.unsafe(`grant usage on schema label_suite to ${role}`);
      await tx`select set_config('app.current_org_id',${org},true), set_config('app.current_user_id',${otherUser},true)`;
      await tx.unsafe(`set local role ${role}`);
      await expect(tx.savepoint(async (sp) => {
        await sp`select * from label_suite.register_notification_device(${`${otherUser}-session`},${secondaryToken},'online.truenature.labelsuite','sandbox',${randomUUID()}::uuid)`;
      })).rejects.toThrow(/permission denied/);
      await tx.unsafe('reset role');
      await tx.unsafe(`grant execute on function label_suite.register_notification_device(text,text,text,text,uuid) to ${role}`);
      await tx.unsafe(`set local role ${role}`);
      const rows = await tx`select * from label_suite.register_notification_device(${`${otherUser}-session`},${secondaryToken},'online.truenature.labelsuite','sandbox',${randomUUID()}::uuid)`;
      expect(rows).toHaveLength(1);
      expect(rows[0].device_generation).toBe(2);
      expect(await tx`select * from label_suite.register_notification_device('missing-session',${secondaryToken},'online.truenature.labelsuite','sandbox',${randomUUID()}::uuid)`).toHaveLength(0);
      await expect(tx.savepoint(async (sp) => { await sp`select token from label_suite.notification_devices`; })).rejects.toThrow(/permission denied/);
      await tx.unsafe('reset role');
      await tx.unsafe(`grant create on schema label_suite to ${role}`);
      await tx.unsafe(`alter table label_suite.notification_devices owner to ${role}`);
      await tx.unsafe(`set local role ${role}`);
      const visible = await tx`select user_id from label_suite.notification_devices`;
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.every((row) => row.user_id === otherUser)).toBe(true);
      await tx`select set_config('app.current_user_id', 'unrelated-user', true)`;
      expect(await tx`select token from label_suite.notification_devices`).toHaveLength(0);
      throw rollback;
    })).rejects.toBe(rollback);
  });
});
