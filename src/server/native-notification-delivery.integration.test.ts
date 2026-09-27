import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ send: vi.fn(), configured: vi.fn(() => true) }));
vi.mock("./native-notification-apns", () => ({ notificationTopic: "online.truenature.labelsuite", notificationDeliveryConfigured: provider.configured, sendNativeNotification: provider.send }));
const org = `delivery-${randomUUID()}`, user = `${org}-user`, session = `${user}-session`, artist = `${org}-artist`;
const token = randomUUID().replaceAll("-", "");
let sql: Sql;
let dispatch: typeof import("./native-notification-delivery").dispatchNativeNotifications;
let collect: typeof import("./native-notification-collection").collectNativeNotifications;
let device: string;
async function intent() {
  await sql`update label_suite.artists set name=${randomUUID()} where id=${artist}`;
  await collect(org);
  return (await sql`select id from label_suite.notification_intents where org_id=${org} order by created_at desc limit 1`)[0].id as string;
}

describe.skipIf(process.env.NATIVE_NOTIFICATIONS_INTEGRATION !== "1")("durable private notification delivery", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("_fixture")) throw new Error("Disposable local fixture database required");
    sql = postgres(url.toString(), { max: 3 });
    for (const [table, migration] of [["notification_preferences", "0096_notification_preferences"], ["notification_devices", "0097_notification_devices"], ["notification_intents", "0098_notification_intents"], ["notification_deliveries", "0099_notification_deliveries"]]) {
      if (!(await sql`select to_regclass(${`label_suite.${table}`}) as name`)[0].name) await sql.unsafe(await readFile(new URL(`../../drizzle/${migration}.sql`, import.meta.url), "utf8"));
    }
    dispatch = (await import("./native-notification-delivery")).dispatchNativeNotifications;
    collect = (await import("./native-notification-collection")).collectNativeNotifications;
    await sql`insert into label_suite.orgs(id,name,slug) values (${org},'Delivery fixture',${org})`;
    await sql`insert into label_suite.user(id,name,email,"emailVerified") values (${user},'Fixture',${`${user}@example.test`},true)`;
    await sql`insert into label_suite.session(id,"userId",token,"expiresAt") values (${session},${user},${randomUUID()},now()+interval '1 day')`;
    await sql`insert into label_suite.org_memberships(id,org_id,user_id,role) values (${user},${org},${user},'owner')`;
    const { nativeNotificationPreferences } = await import("./native-notification-preferences");
    await nativeNotificationPreferences(org, user, { category: "record_changes", enabled: true, expectedGeneration: 0 });
    await sql`insert into label_suite.artists(id,org_id,name) values (${artist},${org},'Private artist')`;
  }, 20_000);
  beforeEach(async () => {
    vi.stubEnv("APNS_ENVIRONMENT", "sandbox");
    provider.configured.mockReturnValue(true);
    provider.send.mockReset().mockResolvedValue({ status: "accepted" });
    await sql`delete from label_suite.notification_intents where org_id=${org}`;
    await sql`delete from label_suite.notification_devices where user_id=${user}`;
    await sql`update label_suite.session set "expiresAt"=now()+interval '1 day' where id=${session}`;
    device = randomUUID();
    await sql`insert into label_suite.notification_devices(id,user_id,session_id,token,topic,environment) values (${device},${user},${session},${token},'online.truenature.labelsuite','sandbox')`;
    // Consume setup audit rows before each isolated delivery case.
    await collect(org);
    await sql`delete from label_suite.notification_intents where org_id=${org}`;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!sql) return;
    await sql`delete from label_suite.notification_devices where user_id=${user}`;
    await sql`delete from label_suite.session where id=${session}`;
    await sql`delete from label_suite.org_memberships where org_id=${org}`;
    for (const table of ["job_runs", "artists", "audit_logs"]) await sql`delete from ${sql(`label_suite.${table}`)} where org_id=${org}`;
    await sql`delete from label_suite.orgs where id=${org}`;
    await sql`delete from label_suite.user where id=${user}`;
    await sql.end();
  });

  it("commits one receipt per device and prevents concurrent duplicate sends without changing records", async () => {
    const id = await intent();
    const [before] = await sql`select * from label_suite.artists where id=${artist}`;
    await Promise.all([dispatch(org), dispatch(org)]);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.send.mock.calls[0][0]).toMatchObject({ notificationId: id, environment: "sandbox" });
    expect(await dispatch(org)).toMatchObject({ accepted: 0 });
    expect((await sql`select status,attempts from label_suite.notification_deliveries where intent_id=${id}`)).toEqual([{ status: "accepted", attempts: 1 }]);
    expect((await sql`select * from label_suite.artists where id=${artist}`)[0]).toEqual(before);
    await sql`delete from label_suite.notification_intents where id=${id}`;
    expect(await sql`select * from label_suite.notification_deliveries where intent_id=${id}`).toHaveLength(0);
  });

  it("retains unavailable work and retries only after its durable deadline with the same opaque ID", async () => {
    const id = await intent();
    provider.send.mockResolvedValueOnce({ status: "unavailable" });
    expect(await dispatch(org)).toMatchObject({ unavailable: true });
    expect(await sql`select * from label_suite.notification_deliveries where intent_id=${id}`).toHaveLength(0);
    provider.send.mockResolvedValueOnce({ status: "retry", retryAfterSeconds: 900 });
    expect(await dispatch(org)).toMatchObject({ retry: 1 });
    await dispatch(org);
    expect(provider.send).toHaveBeenCalledTimes(2);
    await sql`update label_suite.notification_deliveries set next_attempt_at=now()-interval '1 second' where intent_id=${id}`;
    expect(await dispatch(org)).toMatchObject({ accepted: 1 });
    expect(provider.send.mock.calls.map(call => call[0].notificationId)).toEqual([id, id, id]);
    expect((await sql`select attempts from label_suite.notification_deliveries where intent_id=${id}`)[0].attempts).toBe(2);
  });

  it("preserves an earlier accepted receipt when a later provider call fails and sanitizes errors", async () => {
    const first = await intent(), second = await intent();
    provider.send.mockResolvedValueOnce({ status: "accepted" }).mockRejectedValueOnce(new Error("private device token"));
    await expect(dispatch(org)).rejects.toThrow(/^Notification delivery failed$/);
    expect((await sql`select intent_id from label_suite.notification_deliveries where org_id=${org}`)).toEqual([{ intent_id: first }]);
    expect(await dispatch(org)).toMatchObject({ accepted: 1 });
    expect(provider.send.mock.calls.map(call => call[0].notificationId)).toEqual([first, second, second]);
  });

  it("suppresses deleted destinations and excludes expired sessions and disconnected devices", async () => {
    const id = await intent();
    await sql`update label_suite.session set "expiresAt"=now()-interval '1 second' where id=${session}`;
    await dispatch(org);
    await sql`update label_suite.session set "expiresAt"=now()+interval '1 day' where id=${session}`;
    await sql`update label_suite.notification_devices set session_id=null where id=${device}`;
    await dispatch(org);
    expect(provider.send).not.toHaveBeenCalled();
    await sql`update label_suite.notification_devices set session_id=${session} where id=${device}`;
    await sql`update label_suite.notification_intents set record_id='deleted-record' where id=${id}`;
    expect(await dispatch(org)).toMatchObject({ suppressed: 1 });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("holds session authority through send so concurrent sign-out completes before future delivery", async () => {
    await intent();
    let entered!: () => void, release!: () => void;
    const sending = new Promise<void>(resolve => { entered = resolve; });
    const finish = new Promise<void>(resolve => { release = resolve; });
    provider.send.mockImplementationOnce(async () => { entered(); await finish; return { status: "accepted" }; });
    const delivery = dispatch(org);
    await sending;
    let signout: Promise<unknown> | undefined;
    try {
      signout = sql.begin(async tx => {
        await tx`set local application_name='notification-delivery-signout-test'`;
        await tx`update label_suite.session set "expiresAt"=now()-interval '1 second' where id=${session}`;
      });
      await expect.poll(async () => (await sql`select count(*)::int as count from pg_stat_activity where application_name='notification-delivery-signout-test' and wait_event_type='Lock'`)[0].count).toBe(1);
    } finally {
      release();
      await delivery;
      await signout;
    }
    await intent();
    await dispatch(org);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it("only invalidates the registration when Apple's timestamp covers that registration", async () => {
    await intent();
    provider.send.mockResolvedValueOnce({ status: "invalid_device", invalidatedAt: 0 });
    expect(await dispatch(org)).toMatchObject({ invalid_device: 1 });
    expect((await sql`select session_id,generation from label_suite.notification_devices where id=${device}`)[0]).toEqual({ session_id: session, generation: 1 });
    await intent();
    provider.send.mockResolvedValueOnce({ status: "invalid_device", invalidatedAt: Date.now() + 10_000 });
    await dispatch(org);
    expect((await sql`select session_id,generation from label_suite.notification_devices where id=${device}`)[0]).toEqual({ session_id: null, generation: 2 });
  });
});
