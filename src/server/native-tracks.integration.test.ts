import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.NATIVE_TRACKS_INTEGRATION === "1";
const org = `native-tracks-${randomUUID()}`;
const actor = `native-track-user-${randomUUID()}`;
let sql: Sql;
let service: typeof import("./native-tracks");

describe.skipIf(!enabled)("native Tracks PostgreSQL contract", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/native_tracks_fixture" || url.search || url.hash) throw new Error("Require the disposable native_tracks_fixture database");
    sql = postgres(url.toString(), { max: 1 });
    service = await import("./native-tracks");
    await sql`insert into label_suite.user (id,name,email,"emailVerified") values (${actor},'Track fixture user',${`${actor}@example.test`},true)`;
    await sql`insert into label_suite.orgs (id,name,slug) values (${org},'Tracks fixture',${org})`;
    await sql`insert into label_suite.releases (id,org_id,title) values ('native-track-release',${org},'Release'),('native-track-other-release',${org},'Other Release')`;
    await sql`insert into label_suite.works (id,org_id,title) values ('native-track-work',${org},'Distinct Work title')`;
    await sql`insert into label_suite.tracks (id,org_id,release_id,work_id,title,position,updated_at) values ('native-track-b',${org},'native-track-release','native-track-work','Track B',2,'2026-09-26 10:00:00.123456'),('native-track-a',${org},'native-track-release','native-track-work','Track A',1,'2026-09-26 10:00:00.123456'),('native-track-c',${org},'native-track-release',null,'Track C',2,'2026-09-26 10:00:00.123456'),('native-track-other',${org},'native-track-other-release',null,'Other Track',1,'2026-09-26 10:00:00.123456')`;
  });
  afterAll(async () => {
    if (!sql) return;
    await sql`delete from label_suite.audit_events where org_id=${org}`;
    await sql`delete from label_suite.user where id=${actor}`;
    await sql`delete from label_suite.tracks where org_id=${org}`;
    await sql`delete from label_suite.works where org_id=${org}`;
    await sql`delete from label_suite.releases where org_id=${org}`;
    await sql`delete from label_suite.audit_logs where org_id=${org}`;
    await sql`delete from label_suite.orgs where id=${org}`;
    await sql.end();
  });
  it("orders canonical tracks deterministically and preserves Work identity", async () => {
    const sequence = await service.listNativeTracks(org, "native-track-release");
    expect(sequence.tracks.map((track) => track.id)).toEqual(["native-track-a", "native-track-b", "native-track-c"]);
    expect(sequence.tracks[0]).toMatchObject({ record_type: "track", title: "Track A", work: { id: "native-track-work", title: "Distinct Work title" } });
    expect(sequence.tracks[0].revision).toContain(".123456");
  });
  it("bounds previous and next to the selected Release and workspace", async () => {
    expect(await service.getNativeTrack(org, "native-track-release", "native-track-a")).toMatchObject({ previous_track_id: null, next_track_id: "native-track-b" });
    expect(await service.getNativeTrack(org, "native-track-release", "native-track-c")).toMatchObject({ previous_track_id: "native-track-b", next_track_id: null });
    await expect(service.getNativeTrack(org, "native-track-release", "native-track-other")).rejects.toMatchObject({ status: 404 });
    await expect(service.listNativeTracks("unrelated-workspace", "native-track-release")).rejects.toMatchObject({ status: 404 });
  });
  it("saves Track fields atomically, preserves Work fields and rejects stale native edits after a web edit", async () => {
    const before = await service.getNativeTrack(org, "native-track-release", "native-track-a");
    const saved = await service.updateNativeTrack(org, "native-track-release", "native-track-a", { title: "Edited Track", version: "Live", expected_revision: before.track.revision }, actor);
    expect(saved.track).toMatchObject({ title: "Edited Track", version: "Live", work: { title: "Distinct Work title", isrc: null } });
    expect(saved.track.revision).not.toBe(before.track.revision);
    const [audit] = await sql`select "before", "after" from label_suite.audit_events where org_id=${org} and object_id='native-track-a'`;
    expect(audit.before).toMatchObject({ title: "Track A", version: null });
    expect(audit.after).toMatchObject({ title: "Edited Track", version: "Live" });
    const { updateTrack } = await import("./tracks");
    await updateTrack(org, { id: "native-track-a", version: "Web edit" });
    await expect(service.updateNativeTrack(org, "native-track-release", "native-track-a", { title: "Stale", expected_revision: saved.track.revision }, actor)).rejects.toMatchObject({ status: 409 });
    const latest = await service.getNativeTrack(org, "native-track-release", "native-track-a");
    expect(latest.track.version).toBe("Web edit");
    await expect(service.updateNativeTrack(org, "native-track-release", "native-track-a", { isrc: "DKABC2600001", expected_revision: latest.track.revision }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(service.updateNativeTrack(org, "native-track-other-release", "native-track-a", { title: "Wrong Release", expected_revision: latest.track.revision }, actor)).rejects.toMatchObject({ status: 404 });
    const [work] = await sql`select title,isrc from label_suite.works where id='native-track-work'`;
    expect(work).toEqual({ title: "Distinct Work title", isrc: null });
  });
  it("opens Work identity independently with tenant-scoped linked Tracks", async () => {
    const { getNativeWork } = await import("./native-works");
    const detail = await getNativeWork(org, "native-track-work");
    expect(detail).toMatchObject({ record_type: "work", work: { id: "native-track-work", title: "Distinct Work title" }, has_more_tracks: false });
    expect(detail.tracks.map((track) => track.id)).toEqual(["native-track-a", "native-track-b"]);
    expect(detail.tracks[0]).toMatchObject({ release_id: "native-track-release", release_title: "Release" });
    await expect(getNativeWork("unrelated-workspace", "native-track-work")).rejects.toMatchObject({ status: 404 });
    await expect(getNativeWork(org, "missing-work")).rejects.toMatchObject({ status: 404 });
  });
  it("reads and edits standalone Tracks with tenant, release and revision boundaries", async () => {
    const id = `${org}-standalone`;
    await sql`insert into label_suite.tracks(id,org_id,title) values (${id},${org},'Standalone')`;
    const before = await service.getNativeTrack(org, null, id);
    expect(before).toMatchObject({ release: null, track: { id, release_id: null, work_id: null }, previous_track_id: null, next_track_id: null });
    await expect(service.getNativeTrack("foreign-org", null, id)).rejects.toMatchObject({ status: 404 });
    await expect(service.getNativeTrack(org, null, "native-track-a")).rejects.toMatchObject({ status: 404 });
    const saved = await service.updateNativeTrack(org, null, id, { title: "Edited standalone", expected_revision: before.track.revision }, actor);
    expect(saved.track.title).toBe("Edited standalone");
    await expect(service.updateNativeTrack(org, null, id, { title: "Stale", expected_revision: before.track.revision }, actor)).rejects.toMatchObject({ status: 409 });
    await sql`update label_suite.tracks set release_id='native-track-release' where id=${id}`;
    await expect(service.updateNativeTrack(org, null, id, { title: "Wrong context", expected_revision: saved.track.revision }, actor)).rejects.toMatchObject({ status: 404 });
  });
  it("rolls back Track changes when audit persistence fails", async () => {
    const before = await service.getNativeTrack(org, "native-track-release", "native-track-b");
    await sql.unsafe("CREATE FUNCTION label_suite.fixture_track_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit unavailable'; END $$");
    await sql.unsafe("CREATE TRIGGER fixture_track_audit_failure BEFORE INSERT ON label_suite.audit_events FOR EACH ROW EXECUTE FUNCTION label_suite.fixture_track_audit_failure()");
    try {
      await expect(service.updateNativeTrack(org, "native-track-release", "native-track-b", { title: "Must roll back", expected_revision: before.track.revision }, actor)).rejects.toThrow();
      const after = await service.getNativeTrack(org, "native-track-release", "native-track-b");
      expect(after.track.title).toBe(before.track.title);
      expect(after.track.revision).toBe(before.track.revision);
    } finally {
      await sql.unsafe("DROP TRIGGER fixture_track_audit_failure ON label_suite.audit_events");
      await sql.unsafe("DROP FUNCTION label_suite.fixture_track_audit_failure()");
    }
  });

});
