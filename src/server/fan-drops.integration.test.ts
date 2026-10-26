import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const adminUrl = process.env.FAN_TEST_DATABASE_URL;
// Explicit opt-in: never run database fixtures against the application's configured DB.
const suite = adminUrl ? describe : describe.skip;
suite("fan Drop lifecycle against disposable PostgreSQL", () => {
  let admin: Pool;
  let database: typeof import("../lib/db");
  let service: typeof import("./fan-drops");
  let messages: typeof import("./fan-messages");
  let feedback: typeof import("./fan-feedback");
  let core: typeof import("./fan-drops-core");
  const suffix = crypto.randomUUID().slice(0, 8);
  const org = `fan-fixture-${suffix}`, otherOrg = `fan-other-${suffix}`;
  const artist = `artist-${suffix}`, otherArtist = `artist-other-${suffix}`;
  const context = <T>(operation: () => Promise<T>, orgId = org) => database.runWithDatabaseContext({ userId: "fixture", orgId }, operation);
  const content = { title: "New music", description: "Hear it first", artwork_url: null, privacy_url: "https://artist.example/privacy", success_url: "https://artist.example/music", success_label: "Listen", shows: [] };
  async function drop(name: string, artistId = artist) {
    const draft = await context(() => service.saveFanDrop(org, { artist_id: artistId, release_id: null, slug: `${name}-${suffix}`, content }));
    return context(() => service.publishFanDrop(org, { id: draft.id, expected_revision: draft.revision, publish: true }));
  }
  async function signup(page: Awaited<ReturnType<typeof drop>>, email: string) {
    vi.stubEnv("FAN_ALLOWED_EMAIL", email);
    return context(() => service.signupToFanDrop(org, page.slug, { email, consent: true, published_revision: page.published_revision, city: "Denver", name: "Fan" }, "127.0.0.1"));
  }
  async function latest(email: string) {
    const result = await admin.query(`select s.*, f.email from label_suite.fan_signups s join label_suite.fan_subscriptions sub on sub.id=s.subscription_id join label_suite.fans f on f.id=sub.fan_id where s.org_id=$1 and f.email=$2 order by s.created_at desc limit 1`, [org, email]);
    return result.rows[0];
  }
  beforeAll(async () => {
    const parsed = new URL(adminUrl!);
    if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/fan_drops_test") throw new Error("FAN_TEST_DATABASE_URL must be the loopback fan_drops_test fixture DB");
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fan_test') THEN CREATE ROLE fan_test LOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;
      GRANT USAGE ON SCHEMA label_suite,public TO fan_test; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA label_suite,public TO fan_test; GRANT USAGE ON ALL SEQUENCES IN SCHEMA label_suite,public TO fan_test;`);
    const runtimePassword = crypto.randomUUID();
    await admin.query(`ALTER ROLE fan_test PASSWORD '${runtimePassword}'`);
    parsed.username = "fan_test"; parsed.password = runtimePassword;
    vi.stubEnv("DATABASE_URL", parsed.toString());
    vi.stubEnv("FAN_TOKEN_SECRET", "fixture-only-key-not-used-in-production-1234");
    vi.stubEnv("FAN_EMAIL_ENABLED", "true"); vi.stubEnv("BREVO_API_KEY", "fixture"); vi.stubEnv("BREVO_SENDER_EMAIL", "sender@example.test"); vi.stubEnv("PUBLIC_SITE_URL", "https://artist.example");
    database = await import("../lib/db"); service = await import("./fan-drops"); core = await import("./fan-drops-core");
    messages = await import("./fan-messages"); feedback = await import("./fan-feedback");
    vi.stubEnv("FAN_BROADCAST_ENABLED", "true"); vi.stubEnv("FAN_BREVO_ORG_ID", org); vi.stubEnv("FAN_BREVO_FOLDER_ID", "15"); vi.stubEnv("FAN_BREVO_WEBHOOK_SECRET", "fixture-webhook-secret-minimum-32-characters");
    await admin.query(`insert into label_suite.orgs(id,name,slug) values ($1,'Fan fixture',$1),($2,'Other fixture',$2)`, [org, otherOrg]);
    await admin.query(`insert into label_suite.artists(id,org_id,name) values($1,$2,'Fixture Artist'),($3,$2,'Second Artist')`, [artist, org, otherArtist]);
  });
  afterEach(() => { vi.unstubAllGlobals(); for (const key of ["FAN_ALLOWED_EMAIL", "FAN_PUBLIC_SIGNUP_ENABLED", "FAN_PUBLIC_ARTIST_ID", "FAN_POSTAL_ADDRESS", "FAN_DAILY_EMAIL_LIMIT"]) delete process.env[key]; });
  afterAll(async () => { await database?.pool.end(); await admin?.end(); vi.unstubAllEnvs(); });

  it("retries a new message concurrently without duplicates and rejects changed or cross-state retries", async () => {
    const creation_id = crypto.randomUUID();
    const input = { creation_id, audience: { artist_id: artist }, content: { subject: "Stable draft", body: "Private draft only", link_url: null, link_label: "More" } };
    const send = vi.fn(); vi.stubGlobal("fetch", send);
    const result = await Promise.all([context(() => messages.saveFanMessage(org, input)), context(() => messages.saveFanMessage(org, input))]);
    expect(result.map(row => row.id)).toEqual([creation_id, creation_id]);
    expect((await admin.query("select count(*)::int as count from label_suite.fan_messages where id=$1", [creation_id])).rows[0].count).toBe(1);
    expect((await context(() => messages.getFanMessage(org, creation_id))).content).toEqual(input.content);
    expect(await context(() => messages.getFanMessage(org, creation_id))).not.toHaveProperty("recipient_ids");
    await expect(context(() => messages.saveFanMessage(org, { ...input, content: { ...input.content, body: "Different" } }))).rejects.toMatchObject({ status: 409 });
    await context(() => messages.saveFanMessage(org, { id: creation_id, expected_revision: 1, audience: input.audience, content: input.content }));
    await expect(context(() => messages.saveFanMessage(org, input))).rejects.toMatchObject({ status: 409 });
    await admin.query("update label_suite.fan_messages set revision=1,status='scheduled' where id=$1", [creation_id]);
    await expect(context(() => messages.saveFanMessage(org, input))).rejects.toMatchObject({ status: 409 });
    expect((await admin.query("select count(*)::int as count from label_suite.job_runs where payload->>'messageId'=$1", [creation_id])).rows[0].count).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not adopt a foreign message identity or disclose it through exact lookup", async () => {
    const foreignArtist = `foreign-message-artist-${suffix}`, creation_id = crypto.randomUUID();
    await admin.query("insert into label_suite.artists(id,org_id,name) values($1,$2,'Foreign message artist')", [foreignArtist, otherOrg]);
    const input = { creation_id, audience: { artist_id: foreignArtist }, content: { subject: "Foreign draft", body: "Private", link_url: null } };
    await context(() => messages.saveFanMessage(otherOrg, input), otherOrg);
    await expect(context(() => messages.saveFanMessage(org, { ...input, audience: { artist_id: artist } }))).rejects.toMatchObject({ status: 409 });
    await expect(context(() => messages.getFanMessage(org, creation_id))).rejects.toMatchObject({ status: 404 });
  });

  it("retries a new Drop concurrently with normalized input, then rejects changed or published identities", async () => {
    const creation_id = crypto.randomUUID();
    const input = { creation_id, artist_id: artist, release_id: null, slug: `stable-drop-${suffix}`,
      content: { ...content, title: " Stable new Drop " } };
    const send = vi.fn(); vi.stubGlobal("fetch", send);
    const result = await Promise.all([context(() => service.saveFanDrop(org, input)), context(() => service.saveFanDrop(org, input))]);
    expect(result.map(row => row.id)).toEqual([creation_id, creation_id]);
    expect((await admin.query("select count(*)::int as count from label_suite.fan_drops where id=$1", [creation_id])).rows[0].count).toBe(1);
    expect(await context(() => service.getFanDrop(org, creation_id))).toMatchObject({ content: { title: "Stable new Drop" }, revision: 1, published: null, published_revision: null });
    await expect(context(() => service.saveFanDrop(org, { ...input, slug: `changed-slug-${suffix}` }))).rejects.toMatchObject({ status: 409 });
    await expect(context(() => service.saveFanDrop(org, { ...input, artist_id: otherArtist }))).rejects.toMatchObject({ status: 409 });
    await expect(context(() => service.saveFanDrop(org, { ...input, content: { ...content, title: "Changed" } }))).rejects.toMatchObject({ status: 409 });
    const changed = await context(() => service.saveFanDrop(org, { id: creation_id, expected_revision: 1, artist_id: artist, release_id: null, slug: input.slug, content }));
    await expect(context(() => service.saveFanDrop(org, input))).rejects.toMatchObject({ status: 409 });
    await context(() => service.publishFanDrop(org, { id: creation_id, expected_revision: changed.revision, publish: true }));
    await admin.query("update label_suite.fan_drops set revision=1 where id=$1", [creation_id]);
    await expect(context(() => service.saveFanDrop(org, input))).rejects.toMatchObject({ status: 409 });
    expect((await admin.query("select count(*)::int as count from label_suite.fan_drops where id=$1", [creation_id])).rows[0].count).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an occupied slug without creating the requested identity, which can be corrected explicitly", async () => {
    const occupied = { creation_id: crypto.randomUUID(), artist_id: artist, release_id: null, slug: `occupied-${suffix}`, content };
    await context(() => service.saveFanDrop(org, occupied));
    const pending = { ...occupied, creation_id: crypto.randomUUID() };
    await expect(context(() => service.saveFanDrop(org, pending))).rejects.toMatchObject({ status: 409 });
    expect((await admin.query("select count(*)::int as count from label_suite.fan_drops where id=$1", [pending.creation_id])).rows[0].count).toBe(0);
    expect((await context(() => service.saveFanDrop(org, { ...pending, slug: `corrected-${suffix}` }))).id).toBe(pending.creation_id);
  });

  it("does not adopt a foreign Drop identity or disclose it through exact lookup", async () => {
    const creation_id = crypto.randomUUID(), foreignArtist = `foreign-drop-artist-${suffix}`;
    await admin.query("insert into label_suite.artists(id,org_id,name) values($1,$2,'Foreign Drop artist')", [foreignArtist, otherOrg]);
    const input = { creation_id, artist_id: foreignArtist, release_id: null, slug: `foreign-drop-${suffix}`, content };
    await context(() => service.saveFanDrop(otherOrg, input), otherOrg);
    await expect(context(() => service.saveFanDrop(org, { ...input, artist_id: artist }))).rejects.toMatchObject({ status: 409 });
    await expect(context(() => service.getFanDrop(org, creation_id))).rejects.toMatchObject({ status: 404 });
  });

  it("publishes only the approved projection and keeps subsequent draft edits private", async () => {
    const page = await drop("publication");
    const changed = await context(() => service.saveFanDrop(org, { id: page.id, expected_revision: page.revision, artist_id: artist, release_id: null, slug: page.slug, content: { ...content, title: "Private next announcement" } }));
    expect(changed.content.title).toBe("Private next announcement");
    expect((await context(() => service.getPublicFanDrop(org, page.slug)))?.published?.title).toBe("New music");
    await expect(context(() => service.publishFanDrop(org, { id: page.id, expected_revision: page.revision, publish: true }))).rejects.toThrow("changed");
    expect(await context(() => service.getPublicFanDrop(otherOrg, page.slug), otherOrg)).toBeNull();
    await context(() => service.publishFanDrop(org, { id: page.id, expected_revision: changed.revision, publish: false }));
    expect(await context(() => service.getPublicFanDrop(org, page.slug))).toBeNull();
  });

  it("publishes selected public show dates without internal event notes or contacts", async () => {
    const eventId = `fan-show-${suffix}`;
    await admin.query("insert into label_suite.project_events(id,org_id,artist_id,title,event_type,start_date,timezone,city,venue_name,notes,address) values($1,$2,$3,'Fixture show','show','2026-11-01','America/Denver','Denver','Fixture venue','Private advance notes','Private hotel address')", [eventId, org, artist]);
    const draft = await context(() => service.saveFanDrop(org, { artist_id: artist, release_id: null, slug: `shows-${suffix}`, content: { ...content, shows: [{ event_id: eventId, ticket_url: "https://artist.example/tickets" }] } }));
    const published = await context(() => service.publishFanDrop(org, { id: draft.id, expected_revision: draft.revision, publish: true }));
    expect(published.published?.shows[0]).toMatchObject({ start_date: "2026-11-01", city: "Denver", venue: "Fixture venue" });
    expect(JSON.stringify(published.published)).not.toMatch(/Private|contact_id|address|notes/);
  });
  it("confirms once, scopes each artist independently, and refuses stale consent after unsubscribe", async () => {
    const page = await drop("signup"); const email = `fan-${suffix}@example.test`;
    await signup(page, email);
    expect(await context(() => service.fanAudience(org, { artist_id: artist }))).toHaveLength(0);
    const pending = await latest(email);
    const token = core.fanToken("confirm", org, pending.id, pending.expires_at.getTime());
    await service.confirmFanSignup(token); await service.confirmFanSignup(token);
    expect(await context(() => service.fanAudience(org, { artist_id: artist, city: "denver", drop_id: page.id }))).toHaveLength(1);
    const second = await drop("other-artist", otherArtist); await signup(second, email);
    expect(await context(() => service.fanAudience(org, { artist_id: otherArtist }))).toHaveLength(0);
    await service.unsubscribeFan(core.fanToken("unsubscribe", org, pending.subscription_id, Date.now() + 86400_000));
    expect(await context(() => service.fanAudience(org, { artist_id: artist }))).toHaveLength(0);
    await expect(service.confirmFanSignup(token)).rejects.toThrow("unsubscribed");
    expect((await admin.query('select count(*) from label_suite.fans where org_id=$1 and email=$2', [org, email])).rows[0].count).toBe("1");
  });
  it("commits one confirmation job with each signup and never blindly resends an unknown outcome", async () => {
    const page = await drop("worker"); const email = `worker-${suffix}@example.test`; await signup(page, email);
    const pending = await latest(email);
    expect((await admin.query("select count(*) from label_suite.job_runs where org_id=$1 and job_type='fan_confirmation' and payload->>'signupId'=$2", [org, pending.id])).rows[0].count).toBe("1");
    const send = vi.fn().mockRejectedValue(new Error("fixture lost response")); vi.stubGlobal("fetch", send);
    expect(await service.dispatchFanConfirmation(org, pending.id)).toEqual({ status: "unknown" });
    expect(await service.dispatchFanConfirmation(org, pending.id)).toEqual({ skipped: true });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not deliver confirmations or include provider-suppressed fans in audiences", async () => {
    const page = await drop("suppression"); const email = `suppressed-${suffix}@example.test`; await signup(page, email);
    const pending = await latest(email);
    await admin.query("update label_suite.fans set provider_suppressed=true where org_id=$1 and email=$2", [org, email]);
    const send = vi.fn(); vi.stubGlobal("fetch", send);
    expect(await service.dispatchFanConfirmation(org, pending.id)).toEqual({ skipped: true });
    await expect(service.confirmFanSignup(core.fanToken("confirm", org, pending.id, pending.expires_at.getTime()))).rejects.toThrow("cannot receive");
    expect(send).not.toHaveBeenCalled();
  });
  it("enforces tenant isolation in PostgreSQL even without application filters", async () => {
    const result = await context(() => database.pool.query("select id from label_suite.fans"));
    expect(result.rows).toEqual([]); // Separate unscoped connection has no org context.
    await context(async () => {
      const { fans } = await import("../db/schema");
      expect(await database.db.select().from(fans)).toEqual([]);
    }, otherOrg);
  });

  it("keeps the promised offer and prevents an older confirmation from overwriting newer preferences", async () => {
    const page = await drop("offer"), email = `offer-${suffix}@example.test`;
    await signup(page, email); const older = await latest(email);
    await context(() => service.signupToFanDrop(org, page.slug, { email, consent: true, published_revision: page.published_revision, city: "Boston", name: "Updated" }, "127.0.0.2"));
    const newer = await latest(email);
    const updated = await context(() => service.saveFanDrop(org, { id: page.id, expected_revision: page.revision, artist_id: artist, release_id: null, slug: page.slug, content: { ...content, success_url: "https://artist.example/new-offer" } }));
    await context(() => service.publishFanDrop(org, { id: page.id, expected_revision: updated.revision, publish: true }));
    await service.confirmFanSignup(core.fanToken("confirm", org, newer.id, newer.expires_at.getTime()));
    const result = await service.confirmFanSignup(core.fanToken("confirm", org, older.id, older.expires_at.getTime()));
    expect(result.success_url).toBe(content.success_url); expect(result.unsubscribe_url).toContain("/fans/unsubscribe?token=");
    const [profile] = await context(() => service.fanAudience(org, { artist_id: artist, drop_id: page.id }));
    expect(profile.city).toBe("Boston"); expect(profile.name).toBe("Updated");
    await context(() => feedback.tagFan(org, { id: profile.id, expected_tags: [], tags: ["tour"] }));
    await expect(context(() => feedback.tagFan(org, { id: profile.id, expected_tags: [], tags: ["old"] }))).rejects.toThrow("changed");
  });
  async function messageFixture(name: string) {
    const page = await drop(name), email = `${name}-${suffix}@example.test`; await signup(page, email);
    const registration = await latest(email);
    await service.confirmFanSignup(core.fanToken("confirm", org, registration.id, registration.expires_at.getTime()));
    const draft = await context(() => messages.saveFanMessage(org, { audience: { artist_id: artist, drop_id: page.id }, content: { subject: "A new song", body: "Hello <script>bad</script>", link_url: "https://artist.example/music", link_label: "Listen" } }));
    const preview = await context(() => messages.previewFanMessage(org, { id: draft.id, expected_revision: draft.revision }));
    expect(preview.count).toBe(1); expect(preview.html).not.toContain("<script>"); expect(preview.html).toContain("{{ unsubscribe }}");
    return { draft, preview, registration, email };
  }
  async function schedule(fixture: Awaited<ReturnType<typeof messageFixture>>) {
    return context(() => messages.scheduleFanMessage(org, { id: fixture.draft.id, expected_revision: fixture.draft.revision, preview_hash: fixture.preview.preview_hash, scheduled_at: new Date(Date.now() + 60000).toISOString() }));
  }
  it("requires a current audience review, atomically schedules once, and cancels before dispatch", async () => {
    const fixture = await messageFixture("cancel");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const scheduled = await schedule(fixture);
    await expect(schedule(fixture)).rejects.toThrow("changed");
    expect((await admin.query("select count(*) from label_suite.job_runs where org_id=$1 and job_type='fan_message' and payload->>'messageId'=$2", [org, scheduled.id])).rows[0].count).toBe("1");
    await context(() => messages.cancelFanMessage(org, { id: scheduled.id, expected_revision: scheduled.revision }));
    expect(await messages.dispatchFanMessage(org, scheduled.id)).toEqual({ skipped: true });
    expect(fetch).not.toHaveBeenCalled();
    const stale = await messageFixture("stale");
    await service.unsubscribeFan(core.fanToken("unsubscribe", org, stale.registration.subscription_id, Date.now() + 86400_000));
    await expect(schedule(stale)).rejects.toThrow("1–200");
  });
  it("rechecks consent at handoff and never retries a send with a lost provider response", async () => {
    const fixture = await messageFixture("unknown"); const scheduled = await schedule(fixture);
    await admin.query("update label_suite.fan_messages set scheduled_at=now()-interval '1 minute' where id=$1", [scheduled.id]);
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      const path = new URL(url).pathname; requests.push(path);
      if (path.endsWith("/contacts/lists")) return Response.json({ id: 101 });
      if (options.method === "GET" && path.includes("/contacts/")) return Response.json({ emailBlacklisted: false });
      if (path.endsWith("/contacts")) { expect(JSON.parse(options.body as string)).not.toHaveProperty("emailBlacklisted"); return new Response(null, { status: 204 }); }
      if (path.endsWith("/emailCampaigns")) return Response.json({ id: 201 });
      if (path.endsWith("/sendNow")) throw new Error("accepted, response lost");
      if (path.endsWith("/emailCampaigns/201")) return Response.json({ id: 201, name: `Label Suite ${scheduled.id}`, status: "sent", statistics: { globalStats: { sent: 1, delivered: 1, uniqueClicks: 1 } } });
      throw new Error("Unexpected provider request");
    }));
    expect(await messages.dispatchFanMessage(org, scheduled.id)).toEqual({ review_required: true, stage: "submit_campaign" });
    expect(await messages.dispatchFanMessage(org, scheduled.id)).toEqual({ skipped: true });
    expect(requests.filter(path => path.endsWith("/sendNow"))).toHaveLength(1);
    const reconciled = await context(() => messages.reconcileFanMessage(org, { id: scheduled.id, expected_revision: scheduled.revision }));
    expect(reconciled.status).toBe("sent"); expect(reconciled.report?.delivered).toBe(1);
    const event = { event: "click", email: fixture.email, camp_id: 201, ts_event: Math.floor(Date.now()/1000), URL: "https://artist.example/music" };
    await context(() => feedback.recordFanWebhook(org, event)); await context(() => feedback.recordFanWebhook(org, event));
    expect((await context(() => feedback.fanHistory(org, fixture.registration.subscription_id))).activity).toHaveLength(1);
    await context(() => feedback.recordFanWebhook(org, { ...event, event: "unsubscribed" }));
    expect(await context(() => service.fanAudience(org, { artist_id: artist, drop_id: fixture.draft.audience.drop_id }))).toHaveLength(0);
    expect(() => feedback.authenticateFanWebhook(new Request("https://artist.example"), org)).toThrow("Unauthorized");
  });
  it("removes a fan who unsubscribes during preparation before calling sendNow", async () => {
    const fixture = await messageFixture("recheck"), scheduled = await schedule(fixture);
    await admin.query("update label_suite.fan_messages set scheduled_at=now()-interval '1 minute' where id=$1", [scheduled.id]);
    const fetch = vi.fn(async (url: string, options: RequestInit) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/contacts/lists")) return Response.json({ id: 102 });
      if (options.method === "GET") return Response.json({ emailBlacklisted: false });
      if (path.endsWith("/contacts")) return new Response(null, { status: 204 });
      if (path.endsWith("/emailCampaigns")) {
        await service.unsubscribeFan(core.fanToken("unsubscribe", org, fixture.registration.subscription_id, Date.now() + 86400_000));
        return Response.json({ id: 202 });
      }
      if (path.endsWith("/contacts/remove")) { expect(JSON.parse(options.body as string).emails).toEqual([fixture.email]); return Response.json({ contacts: { success: [fixture.email] } }); }
      throw new Error("Must not send");
    }); vi.stubGlobal("fetch", fetch);
    await messages.dispatchFanMessage(org, scheduled.id);
    const [row] = (await admin.query("select status,recipient_count from label_suite.fan_messages where id=$1", [scheduled.id])).rows;
    expect(row).toEqual({ status: "cancelled", recipient_count: 0 });
    expect(fetch.mock.calls.some(([url]) => url.endsWith("/sendNow"))).toBe(false);
  });

  it("queues one immutable owner test per revision, sends only to that owner, and does not resend unknown outcomes", async () => {
    const email = `owner-${suffix}@example.test`, userId = `owner-${suffix}`;
    await admin.query(`insert into label_suite."user"(id,name,email) values($1,'Owner',$2)`, [userId, email]);
    vi.stubEnv("FAN_ALLOWED_EMAIL", email);
    const draft = await context(() => messages.saveFanMessage(org, { audience: { artist_id: artist }, content: { subject: "Owner preview", body: "Only the owner", link_url: null, link_label: "More" } }));
    const input = { id: draft.id, expected_revision: draft.revision };
    await expect(context(() => messages.testFanMessage(org, input, "somebody-else"))).rejects.toThrow("configured pilot owner");
    await expect(context(() => messages.testFanMessage(org, { ...input, emailTo: ["other@example.test"] }, userId))).rejects.toThrow();
    const [first, retry] = await Promise.all([context(() => messages.testFanMessage(org, input, userId)), context(() => messages.testFanMessage(org, input, userId))]);
    expect(first.id).toBe(retry.id); expect(first.test_recipient).toBe(email);
    expect((await admin.query("select count(*) from label_suite.job_runs where org_id=$1 and idempotency_key=$2", [org, first.id])).rows[0].count).toBe("1");
    expect((await context(() => messages.listFanMessages(org))).find(row => row.id === draft.id)?.status).toBe("draft");
    const provider = vi.fn(async (url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      if (url.endsWith("/emailCampaigns")) { expect(body).not.toHaveProperty("recipients"); expect(body).not.toHaveProperty("scheduledAt"); return Response.json({ id: 9021 }); }
      expect(url).toContain("/9021/sendTest"); expect(body).toEqual({ emailTo: [email] }); return new Response(null, { status: 204 });
    }); vi.stubGlobal("fetch", provider);
    expect(await messages.dispatchFanMessage(org, first.id)).toEqual({ submitted: true });
    expect(await messages.dispatchFanMessage(org, first.id)).toEqual({ skipped: true }); expect(provider).toHaveBeenCalledTimes(2);
    const next = await context(() => messages.saveFanMessage(org, { ...input, audience: draft.audience, content: { ...draft.content, body: "Another revision" } }));
    const test = await context(() => messages.testFanMessage(org, { id: next.id, expected_revision: next.revision }, userId));
    provider.mockImplementation(async (url: string) => { if (url.endsWith("/emailCampaigns")) return Response.json({ id: 9022 }); throw new Error("Provider accepted but response lost"); });
    expect(await messages.dispatchFanMessage(org, test.id)).toEqual({ review_required: true, stage: "submit_test" });
    expect(await messages.dispatchFanMessage(org, test.id)).toEqual({ skipped: true });
    expect(provider).toHaveBeenCalledTimes(4);
  });
  it("restricts signup, pending confirmations and confirmed campaign audiences to the pilot address", async () => {
    const page = await drop("owner-restriction"), owner = `allowed-${suffix}@example.test`, other = `excluded-${suffix}@example.test`;
    await signup(page, owner); await signup(page, other);
    const ownerSignup = await latest(owner), otherSignup = await latest(other);
    await service.confirmFanSignup(core.fanToken("confirm", org, ownerSignup.id, ownerSignup.expires_at.getTime()));
    await service.confirmFanSignup(core.fanToken("confirm", org, otherSignup.id, otherSignup.expires_at.getTime()));
    const pendingPage = await drop("pending-owner-restriction"); await signup(pendingPage, `pending-${suffix}@example.test`);
    const pending = await latest(`pending-${suffix}@example.test`);
    vi.stubEnv("FAN_ALLOWED_EMAIL", owner);
    await expect(context(() => service.signupToFanDrop(org, page.slug, { email: `new-${suffix}@example.test`, consent: true, published_revision: page.published_revision }, "127.0.0.1"))).rejects.toThrow("only");
    expect((await context(() => service.fanAudience(org, { artist_id: artist }))).map(row => row.email)).toEqual([owner]);
    const provider = vi.fn(); vi.stubGlobal("fetch", provider);
    await service.dispatchFanConfirmation(org, pending.id); expect(provider).not.toHaveBeenCalled();
    const draft = await context(() => messages.saveFanMessage(org, { audience: { artist_id: artist }, content: { subject: "Pilot schedule", body: "Owner only", link_url: null, link_label: "More" } }));
    const preview = await context(() => messages.previewFanMessage(org, { id: draft.id, expected_revision: draft.revision }));
    const scheduled = await context(() => messages.scheduleFanMessage(org, { id: draft.id, expected_revision: draft.revision, preview_hash: preview.preview_hash, scheduled_at: new Date(Date.now()+60000).toISOString() }));
    expect(scheduled.recipient_count).toBe(1);
    await admin.query("update label_suite.fan_messages set scheduled_at=now()-interval '1 minute' where id=$1", [scheduled.id]);
    provider.mockImplementation(async (url: string, options: RequestInit) => {
      if(url.endsWith("/contacts/lists")) return Response.json({ id: 9023 });
      if(url.includes("/contacts/")) { expect(decodeURIComponent(url)).toContain(owner); return new Response(null, { status: 404 }); }
      if(url.endsWith("/contacts")) { expect(JSON.parse(options.body as string).email).toBe(owner); return Response.json({ id: 9024 }); }
      if(url.endsWith("/emailCampaigns")) return Response.json({ id: 9025 });
      expect(url).toContain("/9025/sendNow"); return new Response(null, { status: 204 });
    });
    expect(await messages.dispatchFanMessage(org, scheduled.id)).toEqual({ submitted: true });
  });

  it("admits confirmed public fans for one artist, rejects other artists, and closes again without exposing their audience", async () => {
    const page = await drop("public-launch"), other = await drop("public-other", otherArtist);
    vi.stubEnv("FAN_ALLOWED_EMAIL", `owner-launch-${suffix}@example.test`);
    vi.stubEnv("FAN_PUBLIC_ARTIST_ID", artist); vi.stubEnv("FAN_POSTAL_ADDRESS", "Fixture street 1, Fixture city");
    const input = { email: `public-${suffix}@example.test`, consent: true, published_revision: page.published_revision };
    await expect(context(() => service.signupToFanDrop(org, page.slug, input, "127.0.1.1"))).rejects.toMatchObject({ status: 403 });
    vi.stubEnv("FAN_PUBLIC_SIGNUP_ENABLED", "true");
    await expect(context(() => service.signupToFanDrop(org, other.slug, { ...input, published_revision: other.published_revision }, "127.0.1.1"))).rejects.toMatchObject({ status: 403 });
    await context(() => service.signupToFanDrop(org, page.slug, input, "127.0.1.1"));
    const pending = await latest(input.email);
    expect(await context(() => service.fanAudience(org, { artist_id: artist, drop_id: page.id }))).toHaveLength(0);
    await service.confirmFanSignup(core.fanToken("confirm", org, pending.id, pending.expires_at.getTime()));
    expect((await context(() => service.fanAudience(org, { artist_id: artist, drop_id: page.id }))).map(row => row.email)).toEqual([input.email]);
    const draft = await context(() => messages.saveFanMessage(org, { audience: { artist_id: artist, drop_id: page.id }, content: { subject: "Public launch", body: "Confirmed only", link_url: null } }));
    const review = await context(() => messages.previewFanMessage(org, { id: draft.id, expected_revision: draft.revision }));
    const queued = await context(() => messages.scheduleFanMessage(org, { id: draft.id, expected_revision: draft.revision, preview_hash: review.preview_hash, scheduled_at: new Date(Date.now()+60000).toISOString() }));
    vi.stubEnv("FAN_PUBLIC_SIGNUP_ENABLED", "false");
    expect(await context(() => service.fanAudience(org, { artist_id: artist, drop_id: page.id }))).toHaveLength(0);
    await admin.query("update label_suite.fan_messages set scheduled_at=now()-interval '1 minute' where id=$1", [queued.id]);
    const provider = vi.fn(async (url: string) => {
      throw new Error("A closed launch must not contact fans");
    }); vi.stubGlobal("fetch", provider);
    await messages.dispatchFanMessage(org, queued.id);
    expect((await context(() => messages.getFanMessage(org, queued.id))).status).toBe("cancelled");
    expect(provider).not.toHaveBeenCalled();
  });

  it("does not erase verified delivery or count duplicate callbacks when provider aggregates are zero", async () => {
    const fixture = await messageFixture("event-report");
    await admin.query("update label_suite.fan_messages set provider_campaign_id=9041,recipient_ids=$2::jsonb where id=$1", [fixture.draft.id, JSON.stringify([fixture.registration.subscription_id])]);
    const event = { event: "delivered", email: fixture.email, camp_id: 9041, ts_event: Math.floor(Date.now()/1000) };
    await context(() => feedback.recordFanWebhook(org, event));
    await context(() => feedback.recordFanWebhook(org, event));
    await context(() => feedback.recordFanWebhook(org, { ...event, ts_event: event.ts_event+1 }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: 9041, name: `Label Suite ${fixture.draft.id}`, status: "sent", statistics: { globalStats: { sent: 0, delivered: 0 } } })));
    const result = await context(() => messages.reconcileFanMessage(org, { id: fixture.draft.id, expected_revision: fixture.draft.revision }));
    expect(result.report).toMatchObject({ sent: 1, delivered: 1, uniqueClicks: 0 });
    expect((await context(() => feedback.fanActivityReport(otherOrg, fixture.draft.id), otherOrg)).delivered).toBe(0);
  });

  it("shares an atomic daily budget across confirmation and campaigns and never contacts the provider after exhaustion", async () => {
    const fixture = await messageFixture("budget"); const queued = await schedule(fixture);
    const page = await drop("budget-confirmation"), email = `budget-confirmation-${suffix}@example.test`;
    await signup(page, email); const pending = await latest(email);
    await admin.query("delete from label_suite.fan_rate_limits where org_id=$1 and key=$2", [org, core.fanRateKey("fan-send-budget")]);
    vi.stubEnv("FAN_DAILY_EMAIL_LIMIT", "1");
    const reservations = await Promise.all([context(() => service.reserveFanEmailBudget(org, 1)), context(() => service.reserveFanEmailBudget(org, 1))]);
    expect(reservations.filter(Boolean)).toHaveLength(1);
    await admin.query("update label_suite.fan_messages set scheduled_at=now()-interval '1 minute' where id=$1", [queued.id]);
    const provider = vi.fn(); vi.stubGlobal("fetch", provider);
    await messages.dispatchFanMessage(org, queued.id); await service.dispatchFanConfirmation(org, pending.id);
    expect(provider).not.toHaveBeenCalled();
    expect(await context(() => messages.getFanMessage(org, queued.id))).toMatchObject({ status: "review", failure_code: "daily_email_budget" });
    expect((await latest(email)).email_status).toBe("failed");
    await admin.query("update label_suite.fan_rate_limits set window_start=now()-interval '2 days' where org_id=$1 and key=$2", [org, core.fanRateKey("fan-send-budget")]);
    expect(await context(() => service.reserveFanEmailBudget(org, 1))).toBe(true);
  });

});
