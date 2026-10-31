import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SamplyApiError, type SamplyPlayerSummary } from "./samply";

const provider = vi.hoisted(() => ({ createSamplyPlayer: vi.fn(), getSamplyPlayer: vi.fn(), listSamplyPlayers: vi.fn(), listSamplyProjectFiles: vi.fn(), updateSamplyPlayer: vi.fn() }));
vi.mock("./samply", async importOriginal => ({ ...await importOriginal<typeof import("./samply")>(), ...provider, getSamplyAvailability: () => ({ configured: true }) }));
const original = process.env.DATABASE_URL ?? "";
const enabled = process.env.PITCH_INTEGRATION === "1" || (process.env.CI === "true" && process.env.RELEASE_GATE_FIXTURE_DISPOSABLE === "1");
if (enabled) {
  const url = new URL(original);
  const local = process.env.PITCH_INTEGRATION === "1" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/label_suite_pitch_test";
  const ci = process.env.CI === "true" && process.env.RELEASE_GATE_FIXTURE_DISPOSABLE === "1" && original === "postgres://label_suite:label_suite@127.0.0.1:5432/label_suite";
  if (!local && !ci) throw new Error("Pitch tests require the disposable local pitch database or exact CI fixture");
}
const suffix = randomUUID().replaceAll("-", "");
const org = `pitch-${suffix}`, other = `pitch-other-${suffix}`, role = `pitch_test_${suffix}`;
let admin: Pool, database: typeof import("../lib/db"), service: typeof import("./pitches");
const players = new Map<string, SamplyPlayerSummary>();
const asOrg = <T>(id: string, fn: () => Promise<T>) => database.runWithDatabaseContext({ orgId: id, userId: "" }, fn);
const draft = () => ({ id: randomUUID(), expected_version: 0, campaign_id: org, sync_deal_id: null, release_id: org, contact_id: org, title: "Fixture pitch", message: "Please listen to these recordings.", credits: "Fixture writer", rights_note: "Clearance pending", reply_email: "reply@example.test", file_ids: [org], downloads: false });

describe.skipIf(!enabled)("pitch lifecycle with tenant RLS and a mocked Samply provider", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: original });
    await admin.query(`create role "${role}" login password '${suffix}' nosuperuser nobypassrls`);
    await admin.query(`grant usage on schema label_suite to "${role}"`);
    await admin.query(`grant select,insert,update,delete on all tables in schema label_suite to "${role}"`);
    for (const id of [org, other]) {
      await admin.query("insert into label_suite.orgs(id,name,slug) values($1,'Pitch fixture',$1)", [id]);
      await admin.query("insert into label_suite.artists(id,org_id,name) values($1,$1,'Fixture Artist')", [id]);
      await admin.query("insert into label_suite.releases(id,org_id,title,artist_id) values($1,$1,'Fixture release',$1)", [id]);
      await admin.query("insert into label_suite.tracks(id,org_id,title,release_id) values($1,$1,'Fixture song',$1)", [id]);
      await admin.query("insert into label_suite.contacts(id,org_id,name,email) values($1,$1,'Private recipient','private@example.test')", [id]);
      await admin.query("insert into label_suite.campaigns(id,org_id,campaign_name,linked_release_id) values($1,$1,'Fixture campaign',$1)", [id]);
      await admin.query("insert into label_suite.sync_deals(id,org_id,production,release_id,details) values($1,$1,'Fixture film',$1,'{}')", [id]);
      await admin.query("insert into label_suite.samply_projects(id,org_id,release_id,remote_project_id) values($1,$1,$1,$1)", [id]);
      await admin.query("insert into label_suite.samply_files(id,org_id,samply_project_id,track_id,remote_box_id,file_name) values($1,$1,$1,$1,$1,'Instrumental v2.wav')", [id]);
    }
    const url = new URL(original); url.username = role; url.password = suffix; process.env.DATABASE_URL = url.href;
    database = await import("../lib/db"); service = await import("./pitches");
    provider.listSamplyProjectFiles.mockImplementation(async (_org: string, project: string) => [{ id: project, object: "file", name: "Instrumental v2.wav" }]);
    provider.listSamplyPlayers.mockImplementation(async () => [...players.values()]);
    provider.createSamplyPlayer.mockImplementation(async (_org: string, input: object) => {
      const id = randomUUID();
      const player = { ...input, id, playerUrl: `https://samply.app/p/${id}?token=share-${id}`, object: "player" } as SamplyPlayerSummary; players.set(player.id, player); return player;
    });
    provider.getSamplyPlayer.mockImplementation(async (_org: string, id: string) => players.get(id));
    provider.updateSamplyPlayer.mockImplementation(async (_org: string, id: string, patch: object) => { const next = { ...players.get(id)!, ...patch }; players.set(id, next); return next; });
  });
  afterAll(async () => {
    process.env.DATABASE_URL = original;
    if (database) await database.pool.end();
    if (!admin) return;
    for (const table of ["pitches", "ops_tasks", "samply_files", "samply_projects", "sync_deals", "campaigns", "contacts", "tracks", "releases", "artists", "audit_logs"]) await admin.query(`delete from label_suite.${table} where org_id=any($1)`, [[org, other]]);
    await admin.query("delete from label_suite.orgs where id=any($1)", [[org, other]]);
    await admin.query(`drop owned by "${role}"`); await admin.query(`drop role "${role}"`); await admin.end();
  });

  it("saves a private draft, publishes only exact files, tracks follow-up and revokes both links", async () => {
    const input = draft();
    const saved = await asOrg(org, () => service.savePitch(org, input));
    expect(saved.recordings[0].file_name).toBe("Instrumental v2.wav");
    expect(provider.createSamplyPlayer).not.toHaveBeenCalled();
    expect(await asOrg(org, () => service.getPublicPitch(org, saved.token))).toBeNull();
    await expect(asOrg(org, () => service.savePitch(org, input))).rejects.toMatchObject({ status: 409 });
    const ready = await service.changePitchLink(org, "", saved.id, "create", saved.version);
    expect(ready.link_state).toBe("ready");
    expect(provider.createSamplyPlayer).toHaveBeenLastCalledWith(org, expect.objectContaining({ public: false, boxids: [org], options: expect.objectContaining({ stacks: false, downloads: false, comments: false }) }));
    const publicPage = await asOrg(org, () => service.getPublicPitch(org, saved.token));
    expect(publicPage?.message).toBe(input.message);
    expect(publicPage?.embed_url).toBe(`https://samply.app/embed/share-${ready.player_id}`);
    expect(publicPage?.download_url).toBeNull();
    expect(JSON.stringify(publicPage)).not.toMatch(/private@example|recipient|response_note|remote_project_id/);
    await expect(asOrg(org, () => service.savePitch(org, { ...input, expected_version: ready.version }))).rejects.toMatchObject({ status: 409 });
    const sent = await asOrg(org, () => service.savePitchFollowup(org, { id: saved.id, expected_version: ready.version, status: "sent", sent_date: "2026-10-30", response_note: "Private response", next_action: "Follow up with supervisor", due_date: "2026-11-03" }));
    expect(sent.task_id).toBeTruthy(); expect(sent.due_date).toBe("2026-11-03");
    const task = await admin.query("select linked_contact_id,linked_campaign_id from label_suite.ops_tasks where id=$1", [sent.task_id]);
    expect(task.rows[0]).toEqual({ linked_contact_id: org, linked_campaign_id: org });
    const revoked = await service.changePitchLink(org, "", saved.id, "revoke", sent.version);
    expect(revoked.link_state).toBe("revoked"); expect(players.get(revoked.player_id!)?.public).toBe(false);
    expect(provider.updateSamplyPlayer).toHaveBeenLastCalledWith(org, ready.player_id, { public: false });
    expect(await asOrg(org, () => service.getPublicPitch(org, saved.token))).toBeNull();
  });

  it("offers the provider download page only when downloads are enabled", async () => {
    const saved = await asOrg(org, () => service.savePitch(org, { ...draft(), downloads: true }));
    const ready = await service.changePitchLink(org, "", saved.id, "create", saved.version);
    expect(players.get(ready.player_id!)?.options?.downloads).toBe(true);
    const page = await asOrg(org, () => service.getPublicPitch(org, saved.token));
    expect(page?.download_url).toBe(`https://samply.app/p/share-${ready.player_id}`);
    await service.changePitchLink(org, "", saved.id, "revoke", ready.version);
  });

  it("pitches an imported file without a catalogue mapping while excluding missing files", async () => {
    const fileId = `${org}-unmapped`, missingId = `${org}-missing`;
    await admin.query("insert into label_suite.samply_files(id,org_id,samply_project_id,remote_box_id,file_name,sync_status) values($1,$2,$2,$1,'Demo v1.wav','unmatched'),($3,$2,$2,$3,'Missing.wav','missing_remote')", [fileId, org, missingId]);
    const options = await asOrg(org, () => service.pitchOptions(org, org, null));
    expect(options.files.map(file => file.id)).toContain(fileId);
    expect(options.files.map(file => file.id)).not.toContain(missingId);
    await expect(asOrg(org, () => service.savePitch(org, { ...draft(), file_ids: [missingId] }))).rejects.toMatchObject({ status: 400 });
    const saved = await asOrg(org, () => service.savePitch(org, { ...draft(), file_ids: [fileId] }));
    expect(saved.recordings).toEqual([expect.objectContaining({ track_id: null, title: "Demo v1.wav", box_id: fileId, isrc: null })]);
    provider.listSamplyProjectFiles.mockResolvedValueOnce([{ id: fileId, object: "file", name: "Demo v1.wav" }]);
    const ready = await service.changePitchLink(org, "", saved.id, "create", saved.version);
    expect(players.get(ready.player_id!)?.boxids).toEqual([fileId]);
    expect((await asOrg(org, () => service.getPublicPitch(org, saved.token)))?.recordings[0].title).toBe("Demo v1.wav");
    expect((await admin.query("select count(*)::int as count from label_suite.tracks where org_id=$1", [org])).rows[0].count).toBe(1);
    await service.changePitchLink(org, "", saved.id, "revoke", ready.version);
  });

  it("isolates recipient, context, files, edits and public tokens by workspace", async () => {
    const input = draft(); const saved = await asOrg(org, () => service.savePitch(org, input));
    for (const patch of [{ contact_id: other }, { campaign_id: other }, { file_ids: [other] }, { release_id: other }]) await expect(asOrg(org, () => service.savePitch(org, { ...draft(), ...patch }))).rejects.toBeTruthy();
    await expect(asOrg(other, () => service.getPitch(other, saved.id))).rejects.toMatchObject({ status: 404 });
    await expect(asOrg(other, () => service.getPitch(org, saved.id))).rejects.toMatchObject({ status: 404 });
    expect(await asOrg(other, () => service.getPublicPitch(org, saved.token))).toBeNull();
    expect(await asOrg(org, () => service.getPublicPitch(org, "0".repeat(64)))).toBeNull();
    const syncPitch = await asOrg(org, () => service.savePitch(org, { ...draft(), campaign_id: null, sync_deal_id: org }));
    expect(syncPitch.sync_deal_id).toBe(org);
  });

  it("recovers a lost creation response without creating another player", async () => {
    const input = draft(); const saved = await asOrg(org, () => service.savePitch(org, input));
    const before = provider.createSamplyPlayer.mock.calls.length;
    provider.createSamplyPlayer.mockImplementationOnce(async (_org: string, payload: object) => {
      const player = { ...payload, id: randomUUID(), object: "player" } as SamplyPlayerSummary;
      players.set(player.id, player); throw new Error("Simulated lost response");
    });
    await expect(service.changePitchLink(org, "", saved.id, "create", saved.version)).rejects.toThrow("lost response");
    const pending = await asOrg(org, () => service.getPitch(org, saved.id));
    expect(pending.link_state).toBe("preparing");
    const recovered = await service.changePitchLink(org, "", saved.id, "create", pending.version);
    expect(recovered.link_state).toBe("ready");
    expect(provider.createSamplyPlayer.mock.calls.length).toBe(before + 1);
  });

  it("keeps a draft editable after read failures or an explicit create permission rejection", async () => {
    const saved = await asOrg(org, () => service.savePitch(org, draft()));
    provider.listSamplyPlayers.mockRejectedValueOnce(new Error("Read unavailable"));
    await expect(service.changePitchLink(org, "", saved.id, "create", saved.version)).rejects.toThrow("Read unavailable");
    expect((await asOrg(org, () => service.getPitch(org, saved.id))).link_state).toBe("draft");
    const count = players.size;
    provider.createSamplyPlayer.mockRejectedValueOnce(new SamplyApiError("Insufficient permissions", 403));
    await expect(service.changePitchLink(org, "", saved.id, "create", saved.version)).rejects.toMatchObject({ status: 403 });
    const rejected = await asOrg(org, () => service.getPitch(org, saved.id));
    expect(rejected.link_state).toBe("draft");
    expect(rejected.player_id).toBeNull();
    expect(players.size).toBe(count);
    const ready = await service.changePitchLink(org, "", saved.id, "create", rejected.version);
    expect(ready.link_state).toBe("ready");
    expect(players.size).toBe(count + 1);
  });

  it("keeps missing files editable and refuses widened provider scopes", async () => {
    const saved = await asOrg(org, () => service.savePitch(org, draft()));
    provider.listSamplyProjectFiles.mockResolvedValueOnce([{ id: org, object: "stack" }]);
    await expect(service.changePitchLink(org, "", saved.id, "create", saved.version)).rejects.toMatchObject({ status: 409 });
    expect((await asOrg(org, () => service.getPitch(org, saved.id))).link_state).toBe("draft");
    provider.createSamplyPlayer.mockImplementationOnce(async (_org: string, payload: object) => {
      const player = { ...payload, id: randomUUID(), object: "player", boxids: [org, "unselected-file"] } as SamplyPlayerSummary;
      players.set(player.id, player); return player;
    });
    await expect(service.changePitchLink(org, "", saved.id, "create", saved.version)).rejects.toMatchObject({ status: 409 });
    const pending = await asOrg(org, () => service.getPitch(org, saved.id));
    expect(players.get(pending.player_id!)?.public).toBe(false);
    expect(await asOrg(org, () => service.getPublicPitch(org, saved.token))).toBeNull();
  });

  it("hides the public page even if provider revocation needs a retry", async () => {
    const saved = await asOrg(org, () => service.savePitch(org, draft()));
    const ready = await service.changePitchLink(org, "", saved.id, "create", saved.version);
    provider.updateSamplyPlayer.mockRejectedValueOnce(new Error("Temporary provider outage"));
    await expect(service.changePitchLink(org, "", saved.id, "revoke", ready.version)).rejects.toThrow("outage");
    const pending = await asOrg(org, () => service.getPitch(org, saved.id));
    expect(pending.link_state).toBe("revoking");
    expect(await asOrg(org, () => service.getPublicPitch(org, saved.token))).toBeNull();
    expect((await service.changePitchLink(org, "", saved.id, "revoke", pending.version)).link_state).toBe("revoked");
  });

  it("can revoke an unfinished link after an uncertain public-access update", async () => {
    const saved = await asOrg(org, () => service.savePitch(org, draft()));
    provider.updateSamplyPlayer.mockImplementationOnce(async (_org: string, id: string, patch: object) => {
      players.set(id, { ...players.get(id)!, ...patch });
      throw new Error("Lost access-update response");
    });
    await expect(service.changePitchLink(org, "", saved.id, "create", saved.version)).rejects.toThrow("Lost access-update");
    const pending = await asOrg(org, () => service.getPitch(org, saved.id));
    expect(pending.link_state).toBe("preparing");
    expect(players.get(pending.player_id!)?.public).toBe(true);
    const revoked = await service.changePitchLink(org, "", saved.id, "revoke", pending.version);
    expect(revoked.link_state).toBe("revoked");
    expect(players.get(pending.player_id!)?.public).toBe(false);
  });

  it("serializes provider changes across independently committed steps", async () => {
    const saved = await asOrg(org, () => service.savePitch(org, draft()));
    const held = await database.pool.connect();
    try {
      await held.query("select pg_advisory_lock(hashtext($1),hashtext($2))", [org, `pitch:${saved.id}`]);
      const calls = provider.createSamplyPlayer.mock.calls.length;
      await expect(service.changePitchLink(org, "", saved.id, "create", saved.version)).rejects.toMatchObject({ status: 409 });
      expect(provider.createSamplyPlayer.mock.calls.length).toBe(calls);
      expect((await asOrg(org, () => service.getPitch(org, saved.id))).link_state).toBe("draft");
    } finally {
      await held.query("select pg_advisory_unlock(hashtext($1),hashtext($2))", [org, `pitch:${saved.id}`]); held.release();
    }
  });
});
