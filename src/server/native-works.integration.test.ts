import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.NATIVE_WORKS_INTEGRATION === "1";
const org = `native-works-${randomUUID()}`;
const actor = `native-work-user-${randomUUID()}`;
const foreignOrg = `native-works-foreign-${randomUUID()}`;
let sql: Sql;
let getNativeWork: typeof import("./native-works").getNativeWork;

describe.skipIf(!enabled)("native Work clearance PostgreSQL contract", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/native_works_fixture" || url.search || url.hash) throw new Error("Require disposable native_works_fixture");
    sql = postgres(url.toString(), { max: 1 });
    ({ getNativeWork } = await import("./native-works"));
    await sql`insert into label_suite.user (id,name,email,"emailVerified") values (${actor},'Work fixture actor',${`${actor}@example.test`},true)`;
    await sql`insert into label_suite.orgs (id,name,slug) values (${org},'Works fixture',${org})`;
    await sql`insert into label_suite.orgs (id,name,slug) values (${foreignOrg},'Foreign fixture',${foreignOrg})`;
    await sql`insert into label_suite.contacts (id,org_id,name) values ('native-work-foreign-person',${foreignOrg},'Private foreign person')`;
    await sql`insert into label_suite.works (id,org_id,title) values ('native-work-clearance',${org},'Work title')`;
    await sql`insert into label_suite.releases (id,org_id,title) values ('native-work-release',${org},'Release')`;
    await sql`insert into label_suite.tracks (id,org_id,title,release_id,work_id) values ('native-work-track',${org},'Track','native-work-release','native-work-clearance')`;
    await sql`insert into label_suite.contacts (id,org_id,name) values ('native-work-person',${org},'Person')`;
    await sql`insert into label_suite.organizations (id,org_id,name) values ('native-work-company',${org},'Publisher')`;
    await sql`insert into label_suite.contact_organizations (id,org_id,contact_id,organization_id,title) values ('native-work-affiliation',${org},'native-work-person','native-work-company','Representative')`;
    await sql`insert into label_suite.roles (id,org_id,work_id,contact_id,role,ownership_type,scope,percent_share,clearance_status) values
      ('native-work-pub',${org},'native-work-clearance','native-work-person','Songwriter','Rights','Publishing',100,'Signed'),
      ('native-work-master',${org},'native-work-clearance','native-work-foreign-person','Owner','Rights','Master',100,'Pending'),
      ('native-work-credit',${org},'native-work-clearance','native-work-person','Performer','Credit','Master',100,'Signed')`;
    await sql`insert into label_suite.media_asset_files (id,org_id,source_postgres_table,source_postgres_record_id,file_name,storage_bucket,storage_key) values
      ('native-work-evidence',${org},'roles','native-work-pub','agreement.pdf','fixture','native-work-evidence'),
      ('native-work-unrelated',${org},'works','other-work','unrelated.pdf','fixture','native-work-unrelated')`;
    await sql`insert into label_suite.media_asset_files (id,org_id,source_postgres_table,source_postgres_record_id,file_name,storage_bucket,storage_key) values ('native-work-foreign-file',${foreignOrg},'works','native-work-clearance','private-foreign.pdf','fixture','native-work-foreign-file')`;
  });
  afterAll(async () => {
    if (!sql) return;
    for (const table of ["bugs", "audit_events", "media_asset_files", "roles", "contact_organizations", "organizations", "contacts", "tracks", "releases", "works", "audit_logs"]) await sql.unsafe(`delete from label_suite.${table} where org_id=$1`, [org]);
    await sql`delete from label_suite.orgs where id=${org}`;
    await sql`delete from label_suite.media_asset_files where org_id=${foreignOrg}`;
    await sql`delete from label_suite.contacts where org_id=${foreignOrg}`;
    await sql`delete from label_suite.audit_logs where org_id=${foreignOrg}`;
    await sql`delete from label_suite.orgs where id=${foreignOrg}`;
    await sql`delete from label_suite.user where id=${actor}`;
    await sql.end();
  });
  it("lists only workspace Works with literal search, identifier filtering and bounded pagination", async () => {
    const { listNativeWorks } = await import("./native-works");
    const prefix = `${org}-list-`;
    try {
      for (let i = 0; i < 51; i++) await sql`insert into label_suite.works(id,org_id,title,isrc) values (${prefix + String(i).padStart(2, '0')},${org},'List fixture %',${i % 2 ? `DKAAA26${String(i).padStart(5, '0')}` : null})`;
      await sql`insert into label_suite.works(id,org_id,title) values (${prefix + 'foreign'},${foreignOrg},'List fixture %')`;
      const scope = { q: 'List fixture %', cursor: null, missing_isrc: null };
      const first = await listNativeWorks(org, scope);
      expect(first.items).toHaveLength(50);
      expect(first.next_cursor).toBe(prefix + '49');
      const last = await listNativeWorks(org, { ...scope, cursor: first.next_cursor });
      expect(last.items.map(item => item.id)).toEqual([prefix + '50']);
      expect(last.next_cursor).toBeNull();
      const missing = await listNativeWorks(org, { ...scope, missing_isrc: 'true' });
      expect(missing.items).toHaveLength(26);
      expect(missing.items.every(item => item.isrc === null)).toBe(true);
      expect((await listNativeWorks(org, { ...scope, q: 'List fixture _' })).items).toEqual([]);
      await expect(listNativeWorks(org, { ...scope, missing_isrc: 'unexpected' })).rejects.toThrow();
    } finally {
      await sql`delete from label_suite.works where id like ${prefix + '%'} and org_id in (${org},${foreignOrg})`;
    }
  });
  it("keeps credit-only lines out of clearance and exposes full identity, revision and scoped evidence", async () => {
    const detail = await getNativeWork(org, "native-work-clearance");
    if (process.env.NATIVE_WORK_WIRE_FIXTURE === "1") await writeFile("/tmp/labelsuite-native-work-wire.json", JSON.stringify(detail));
    expect(detail.clearance).toMatchObject({ pub: { enteredTotal: 100, progress: 1 }, master: { enteredTotal: 100, progress: 0.25 }, overall: 0.25, cleared: false });
    expect(detail.roles.find((role) => role.id === "native-work-pub")).toMatchObject({ person: { id: "native-work-person", name: "Person" }, organizations: [{ organization_id: "native-work-company", name: "Publisher", title: "Representative" }], revision: expect.any(String) });
    expect(detail.roles.find((role) => role.id === "native-work-master")).toMatchObject({ person: null, contact_id: null });
    expect(detail.evidence.items.map((item) => item.name)).toEqual(["agreement.pdf"]);
    expect(detail.evidence.items[0]).not.toHaveProperty("storage_key");
    expect(JSON.stringify(detail)).not.toContain("Private foreign person");
    expect(JSON.stringify(detail)).not.toContain("private-foreign.pdf");
    await expect(getNativeWork("unrelated-workspace", "native-work-clearance")).rejects.toMatchObject({ status: 404 });
  });
  it("offers only eligible workspace people, with affiliation context and scoped search", async () => {
    const { listNativeRolePeople } = await import("./native-works");
    await sql`insert into label_suite.contacts (id,org_id,name) values ('native-work-company',${org},'Legacy company contact')`;
    const page = await listNativeRolePeople(org, "native-work-clearance", null, null);
    expect(page.items).toEqual([{ id: "native-work-person", name: "Person", organizations: [{ id: "native-work-company", name: "Publisher" }] }]);
    expect((await listNativeRolePeople(org, "native-work-clearance", "not present", null)).items).toEqual([]);
    expect((await listNativeRolePeople(org, "native-work-clearance", "PERSON", null)).items).toHaveLength(1);
    await expect(listNativeRolePeople(foreignOrg, "native-work-clearance", null, null)).rejects.toMatchObject({ status: 404 });
  });
  it("updates canonical roles, readiness and audit atomically and rejects stale revisions", async () => {
    const { updateNativeWorkRole } = await import("./native-works");
    const before = await getNativeWork(org, "native-work-clearance");
    const revision = before.roles.find((role) => role.id === "native-work-master")!.revision;
    const saved = await updateNativeWorkRole(org, "native-work-clearance", "native-work-master", { contact_id: "native-work-person", clearance_status: "Signed", expected_revision: revision }, actor);
    expect(saved.clearance).toMatchObject({ overall: 1, cleared: true });
    const updated = saved.roles.find((role) => role.id === "native-work-master")!;
    expect(updated.revision).not.toBe(revision);
    expect(saved.work.revision).not.toBe(before.work.revision);
    const [track] = await sql`select clearance_pub,clearance_master,clearance_progress from label_suite.tracks where id='native-work-track'`;
    expect(track).toEqual({ clearance_pub: 1, clearance_master: 1, clearance_progress: 1 });
    const [audit] = await sql`select "before","after" from label_suite.audit_events where org_id=${org} and object_id='native-work-master'`;
    expect(audit.before.clearance_status).toBe("Pending");
    expect(audit.after.clearance_status).toBe("Signed");
    expect(audit.before.revision).toBe(revision);
    expect(audit.after.revision).toBe(updated.revision);
    const { updateRole } = await import("./roles");
    await updateRole(org, { id: "native-work-master", clearance_status: "Confirmed" });
    await expect(updateNativeWorkRole(org, "native-work-clearance", "native-work-master", { clearance_status: "Signed", expected_revision: updated.revision }, actor)).rejects.toMatchObject({ status: 409 });
  });
  it("rejects invalid enums, unassigned Rights and organization identity without changing the role", async () => {
    const { updateNativeWorkRole, createNativeWorkRole } = await import("./native-works");
    const before = await getNativeWork(org, "native-work-clearance");
    const revision = before.roles.find((role) => role.id === "native-work-pub")!.revision;
    await expect(updateNativeWorkRole(org, "native-work-clearance", "native-work-pub", { ownership_type: "invented", expected_revision: revision }, actor)).rejects.toThrow();
    await expect(updateNativeWorkRole(org, "native-work-clearance", "native-work-pub", { contact_id: null, expected_revision: revision }, actor)).rejects.toMatchObject({ status: 400 });
    await expect(updateNativeWorkRole(org, "native-work-clearance", "native-work-pub", { contact_id: "native-work-company", expected_revision: revision }, actor)).rejects.toMatchObject({ status: 404 });
    await expect(updateNativeWorkRole(org, "other-work", "native-work-pub", { role: "Wrong Work", expected_revision: revision }, actor)).rejects.toMatchObject({ status: 404 });
    const input = { contact_id: "native-work-person", role: "Credit performer", ownership_type: "Credit", scope: null, percent_share: null, clearance_status: "Unknown", expected_work_revision: before.work.revision };
    const created = await createNativeWorkRole(org, "native-work-clearance", input, actor);
    expect(created.roles).toHaveLength(before.roles.length + 1);
    expect(created.clearance).toEqual(before.clearance);
    await expect(createNativeWorkRole(org, "native-work-clearance", input, actor)).rejects.toMatchObject({ status: 409 });
  });
  it("serializes concurrent edits to different roles before recomputing shared clearance", async () => {
    const { updateNativeWorkRole } = await import("./native-works");
    await sql`update label_suite.roles set percent_share=0 where id='native-work-master'`;
    await sql`insert into label_suite.roles (id,org_id,work_id,contact_id,role,ownership_type,scope,percent_share,clearance_status) values
      ('native-work-concurrent-a',${org},'native-work-clearance','native-work-person','Owner A','Rights','Master',50,'Unknown'),
      ('native-work-concurrent-b',${org},'native-work-clearance','native-work-person','Owner B','Rights','Master',50,'Unknown')`;
    const before = await getNativeWork(org, "native-work-clearance");
    await Promise.all(["a", "b"].map((suffix) => {
      const id = `native-work-concurrent-${suffix}`;
      return updateNativeWorkRole(org, "native-work-clearance", id, { clearance_status: "Signed", expected_revision: before.roles.find((role) => role.id === id)!.revision }, actor);
    }));
    const after = await getNativeWork(org, "native-work-clearance");
    const [track] = await sql`select clearance_master,clearance_progress from label_suite.tracks where id='native-work-track'`;
    expect(after.clearance.master.progress).toBe(1);
    expect(track).toEqual({ clearance_master: 1, clearance_progress: 1 });
  });
  it("waits for role transactions before a validation sweep reads clearance", async () => {
    const { runValidationSweep } = await import("../lib/readiness");
    const observer = postgres(process.env.DATABASE_URL!, { max: 1 });
    let release!: () => void;
    let ready!: () => void;
    const held = new Promise<void>((resolve) => { ready = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writer = sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["work-roles", org, "native-work-clearance"])},0))`;
      await tx`update label_suite.roles set clearance_status='Pending' where id='native-work-concurrent-a'`;
      ready();
      await gate;
    });
    let sweep: ReturnType<typeof runValidationSweep> | undefined;
    try {
      await held;
      sweep = runValidationSweep(org);
      // Observe the database wait, rather than assuming a scheduler delay proves serialization.
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [row] = await observer`select exists(select 1 from pg_stat_activity
          where datname=current_database() and wait_event='advisory'
          and query like '%pg_advisory_xact_lock%') as waiting`;
        waiting = row.waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
    } finally {
      release();
      await writer;
      await sweep;
      await observer.end();
    }
    const detail = await getNativeWork(org, "native-work-clearance");
    const [track] = await sql`select clearance_master from label_suite.tracks where id='native-work-track'`;
    expect(detail.clearance.master.progress).toBe(0.625);
    expect(track.clearance_master).toBe(detail.clearance.master.progress);
  });
  it("recomputes shared Release readiness after concurrent edits to different Works", async () => {
    const { updateRole } = await import("./roles");
    await sql`update label_suite.releases set upc_ean='fixture-upc',cover_art_url='https://example.test/cover.jpg',release_date='2026-12-04' where id='native-work-release'`;
    await sql`update label_suite.tracks set isrc='DKAAA2600001',audio_url='https://example.test/audio.wav' where id='native-work-track'`;
    await sql`insert into label_suite.works (id,org_id,title) values ('native-work-second',${org},'Second Work')`;
    await sql`insert into label_suite.tracks (id,org_id,title,release_id,work_id,isrc,audio_url) values
      ('native-work-second-track',${org},'Second Track','native-work-release','native-work-second','DKAAA2600002','https://example.test/second.wav')`;
    await sql`insert into label_suite.roles (id,org_id,work_id,contact_id,role,ownership_type,scope,percent_share,clearance_status) values
      ('native-work-second-role',${org},'native-work-second','native-work-person','Owner','Rights','Master',100,'Unknown')`;
    const observer = postgres(process.env.DATABASE_URL!, { max: 1 });
    let release!: () => void;
    let ready!: () => void;
    const held = new Promise<void>((resolve) => { ready = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const blocker = sql.begin(async (tx) => {
      await tx`select id from label_suite.releases where id='native-work-release' for no key update`;
      ready(); await gate;
    });
    let writes: Promise<unknown>[] = [];
    try {
      await held;
      writes = ["native-work-concurrent-a", "native-work-second-role"].map((id) => updateRole(org, { id, clearance_status: "Signed" }));
      let waiting = 0;
      for (let attempt = 0; attempt < 100 && waiting < 2; attempt++) {
        const [row] = await observer`select count(*)::int as waiting from pg_stat_activity
          where datname=current_database() and wait_event_type='Lock' and query like '%releases%'`;
        waiting = row.waiting;
        if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(2);
    } finally {
      release(); await blocker;
      const results = await Promise.allSettled(writes);
      await observer.end();
      for (const result of results) if (result.status === "rejected") throw result.reason;
    }
    const [saved] = await sql`select release_ready,release_missing from label_suite.releases where id='native-work-release'`;
    expect(saved).toEqual({ release_ready: true, release_missing: null });
  });
  it("rolls back role and readiness changes if native audit fails", async () => {
    const { updateNativeWorkRole } = await import("./native-works");
    const before = await getNativeWork(org, "native-work-clearance");
    const revision = before.roles.find((role) => role.id === "native-work-concurrent-a")!.revision;
    await sql.unsafe("CREATE FUNCTION label_suite.fixture_work_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit unavailable'; END $$");
    await sql.unsafe("CREATE TRIGGER fixture_work_audit_failure BEFORE INSERT ON label_suite.audit_events FOR EACH ROW EXECUTE FUNCTION label_suite.fixture_work_audit_failure()");
    try {
      await expect(updateNativeWorkRole(org, "native-work-clearance", "native-work-concurrent-a", { clearance_status: "Pending", expected_revision: revision }, actor)).rejects.toThrow();
      const after = await getNativeWork(org, "native-work-clearance");
      expect(after.work.revision).toBe(before.work.revision);
      expect(after.roles).toEqual(before.roles);
      expect(after.clearance).toEqual(before.clearance);
      const [track] = await sql`select clearance_master from label_suite.tracks where id='native-work-track'`;
      expect(track.clearance_master).toBe(before.clearance.master.progress);
    } finally {
      await sql.unsafe("DROP TRIGGER fixture_work_audit_failure ON label_suite.audit_events");
      await sql.unsafe("DROP FUNCTION label_suite.fixture_work_audit_failure()");
    }
  });

});
