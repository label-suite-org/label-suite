import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.NATIVE_CATALOG_INTEGRATION === "1";
const target = process.env.DATABASE_URL ?? "";
const org = `catalog-${randomUUID()}`,
  foreignOrg = `catalog-${randomUUID()}`,
  actor = randomUUID();
const release = randomUUID(),
  foreignRelease = randomUUID(),
  work = randomUUID(),
  foreignWork = randomUUID();
let sql: Sql;
let create: typeof import("./native-tracks").createNativeTrack;
let patch: typeof import("./native-tracks").updateNativeTrack;
let read: typeof import("./native-tracks").getNativeTrack;
let patchWork: typeof import("./native-works").updateNativeWork;
const newInput = () => ({
  id: randomUUID(),
  title: "New recording",
  audio_url: "track-override",
  work: {
    kind: "new",
    id: randomUUID(),
    title: "Canonical Work",
    auto_isrc: true,
  },
});
const revision = async (table: "works" | "tracks", id: string) =>
  (
    await sql`select updated_at::text as revision from ${sql(`label_suite.${table}`)} where id = ${id}`
  )[0].revision as string;

describe.skipIf(!enabled)(
  "native catalog creation and identity changes on disposable PostgreSQL",
  () => {
    beforeAll(async () => {
      const url = new URL(target);
      if (
        url.hostname !== "127.0.0.1" ||
        url.pathname !== "/native_catalog_fixture"
      )
        throw new Error("Disposable native catalog fixture only");
      sql = postgres(target, { max: 4 });
      ({
        createNativeTrack: create,
        updateNativeTrack: patch,
        getNativeTrack: read,
      } = await import("./native-tracks"));
      ({ updateNativeWork: patchWork } = await import("./native-works"));
      await sql`insert into label_suite.orgs (id,name,slug,isrc_country_code,isrc_registrant_code) values (${org},'Catalog fixture',${org},'US','ZZZ'),(${foreignOrg},'Other',${foreignOrg},null,null)`;
      await sql`insert into label_suite.user (id,name,email,"emailVerified") values (${actor},'Fixture',${`${actor}@example.test`},true)`;
      await sql`insert into label_suite.releases (id,org_id,title,cover_art_url,upc_ean,release_date) values (${release},${org},'Release','cover','123456789012','2027-01-01'),(${foreignRelease},${foreignOrg},'Foreign',null,null,null)`;
      await sql`insert into label_suite.works (id,org_id,title,isrc,audio_url,alt_isrcs) values (${work},${org},'Existing','USAAA2600011','work-original','preserve opaque legacy metadata'),(${foreignWork},${foreignOrg},'Other',null,null,null)`;
      await sql`insert into label_suite.roles (id,org_id,work_id,role,ownership_type,scope,percent_share,clearance_status) values (${randomUUID()},${org},${work},'Owner','Rights','Master',100,'Signed'),(${randomUUID()},${org},${work},'Writer','Rights','Publishing',100,'Signed')`;
    });
    afterAll(async () => {
      if (!sql) return;
      for (const table of [
        "audit_events",
        "bugs",
        "roles",
        "tracks",
        "works",
        "releases",
        "isrc_sequences",
        "audit_logs",
      ])
        await sql`delete from ${sql(`label_suite.${table}`)} where org_id in (${org},${foreignOrg})`;
      await sql`delete from label_suite.user where id = ${actor}`;
      await sql`delete from label_suite.orgs where id in (${org},${foreignOrg})`;
      await sql.end();
    });
    it("creates a Work and Track once across concurrent exact retry, with immutable actor proof", async () => {
      const input = newInput();
      const results = await Promise.all([
        create(org, release, input, actor),
        create(org, release, input, actor),
      ]);
      expect(results).toEqual(
        Array(2).fill({
          ok: true,
          id: input.id,
          release_id: release,
          work_id: input.work.id,
        }),
      );
      expect(
        await sql`select id from label_suite.works where id=${input.work.id}`,
      ).toHaveLength(1);
      const [audit] =
        await sql`select actor_user_id,metadata from label_suite.audit_events where object_id=${input.id}`;
      expect(audit.actor_user_id).toBe(actor);
      expect(audit.metadata.request.work.id).toBe(input.work.id);
      expect((await read(org, release, input.id)).track).toMatchObject({
        id: input.id,
        work_id: input.work.id,
        audio_url: "track-override",
      });
      await expect(
        create(org, release, { ...input, title: "Different" }, actor),
      ).rejects.toMatchObject({ status: 409 });
      await patch(
        org,
        release,
        input.id,
        {
          expected_revision: await revision("tracks", input.id),
          title: "Changed",
        },
        actor,
      );
      await expect(create(org, release, input, actor)).rejects.toMatchObject({
        status: 409,
      });
    });
    it("rejects foreign identities/associations and rolls back Work, Track, allocator on audit failure", async () => {
      const input = newInput();
      await sql`insert into label_suite.tracks (id,org_id,title,release_id,work_id) values (${input.id},${foreignOrg},'Foreign',${foreignRelease},${foreignWork})`;
      await expect(create(org, release, input, actor)).rejects.toMatchObject({
        status: 409,
      });
      expect(
        await sql`select id from label_suite.works where id=${input.work.id}`,
      ).toHaveLength(0);
      await expect(
        create(
          org,
          release,
          { ...newInput(), work: { kind: "existing", id: foreignWork } },
          actor,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        create(org, foreignRelease, newInput(), actor),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        patchWork(
          org,
          foreignWork,
          {
            expected_revision: await revision("works", foreignWork),
            title: "Forbidden",
          },
          actor,
        ),
      ).rejects.toMatchObject({ status: 404 });
      const rollback = newInput();
      const before =
        await sql`select last_production_number from label_suite.isrc_sequences where org_id=${org}`;
      await expect(
        create(org, release, rollback, "missing-audit-actor"),
      ).rejects.toThrow();
      expect(
        await sql`select id from label_suite.tracks where id=${rollback.id}`,
      ).toHaveLength(0);
      expect(
        await sql`select id from label_suite.works where id=${rollback.work.id}`,
      ).toHaveLength(0);
      expect(
        await sql`select last_production_number from label_suite.isrc_sequences where org_id=${org}`,
      ).toEqual(before);
    });
    it("relinks canonical identity and all clearance fields while preserving track overrides", async () => {
      const input = { ...newInput(), work: { kind: "existing", id: work } };
      await create(org, release, input, actor);
      expect((await read(org, release, input.id)).track).toMatchObject({
        isrc: "USAAA2600011",
        clearance_pub: 1,
        clearance_master: 1,
        clearance_progress: 1,
        track_ready: true,
      });
      const empty = randomUUID();
      await sql`insert into label_suite.works(id,org_id,title) values(${empty},${org},'Uncleared')`;
      await sql`insert into label_suite.roles(id,org_id,work_id,role,ownership_type,scope,percent_share,clearance_status) values(${randomUUID()},${org},${empty},'Pending','Rights','Master',100,'Pending'),(${randomUUID()},${org},${empty},'Pending','Rights','Publishing',100,'Pending')`;
      const rev = await revision("tracks", input.id);
      await patch(
        org,
        release,
        input.id,
        { expected_revision: rev, work_id: empty },
        actor,
      );
      expect((await read(org, release, input.id)).track).toMatchObject({
        work_id: empty,
        isrc: null,
        clearance_pub: 0.25,
        clearance_master: 0.25,
        clearance_progress: 0.25,
        track_ready: false,
        audio_url: "track-override",
      });
      await expect(
        patch(
          org,
          release,
          input.id,
          { expected_revision: rev, title: "Stale" },
          actor,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        patch(
          org,
          release,
          input.id,
          {
            expected_revision: await revision("tracks", input.id),
            work_id: foreignWork,
          },
          actor,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await patch(
        org,
        release,
        input.id,
        {
          expected_revision: await revision("tracks", input.id),
          work_id: work,
        },
        actor,
      );
      expect((await read(org, release, input.id)).track).toMatchObject({
        isrc: "USAAA2600011",
        clearance_progress: 1,
        track_ready: true,
        audio_url: "track-override",
      });
    });
    it("changes only requested Work fields and propagates canonical ISRC without copying audio", async () => {
      const id = randomUUID(),
        linkedRelease = randomUUID();
      await sql`insert into label_suite.releases(id,org_id,title,cover_art_url,upc_ean,release_date) values(${linkedRelease},${org},'Linked release','cover','987654321012','2027-01-01')`;
      await create(
        org,
        linkedRelease,
        {
          id,
          title: "Second appearance",
          audio_url: "distinct-override",
          work: { kind: "existing", id: work },
        },
        actor,
      );
      expect(
        (
          await sql`select release_ready from label_suite.releases where id=${linkedRelease}`
        )[0].release_ready,
      ).toBe(true);
      const before = await revision("works", work);
      await patchWork(
        org,
        work,
        {
          expected_revision: before,
          isrc: "us-aaa-26-00012",
          audio_url: "new-work-audio",
          duration: 0,
        },
        actor,
      );
      const rows =
        await sql`select isrc,audio_url from label_suite.tracks where org_id=${org} and work_id=${work}`;
      expect(rows.length).toBeGreaterThan(1);
      expect(rows.every((row) => row.isrc === "USAAA2600012")).toBe(true);
      expect(
        rows.find((row) => row.audio_url === "distinct-override"),
      ).toBeDefined();
      expect(rows.some((row) => row.audio_url === "new-work-audio")).toBe(
        false,
      );
      const [saved] =
        await sql`select genre,iswc,alt_isrcs,duration from label_suite.works where id=${work}`;
      expect(saved).toEqual({
        genre: null,
        iswc: null,
        alt_isrcs: "preserve opaque legacy metadata",
        duration: 0,
      });
      await expect(
        patchWork(
          org,
          work,
          { expected_revision: before, title: "Stale" },
          actor,
        ),
      ).rejects.toMatchObject({ status: 409 });
      const beforeFailure =
        await sql`select isrc from label_suite.tracks where work_id=${work}`;
      await expect(
        patchWork(
          org,
          work,
          {
            expected_revision: await revision("works", work),
            isrc: "USAAA2600013",
          },
          "missing-audit-actor",
        ),
      ).rejects.toThrow();
      expect(
        await sql`select isrc from label_suite.tracks where work_id=${work}`,
      ).toEqual(beforeFailure);
      await patchWork(
        org,
        work,
        { expected_revision: await revision("works", work), isrc: null },
        actor,
      );
      expect((await read(org, linkedRelease, id)).track).toMatchObject({
        isrc: null,
        track_ready: false,
      });
      expect(
        (
          await sql`select release_ready from label_suite.releases where id=${linkedRelease}`
        )[0].release_ready,
      ).toBe(false);
    });
    it("serializes overlapping role, Work and allocator writes, and rejects duplicate normalized ISRC", async () => {
      const { createRole } = await import("./roles");
      const { assignISRCsToRelease } = await import("../lib/isrc");
      const other = randomUUID();
      await sql`insert into label_suite.works(id,org_id,title) values(${other},${org},'Other canonical Work')`;
      const outcomes = await Promise.allSettled([
        patchWork(
          org,
          work,
          {
            expected_revision: await revision("works", work),
            isrc: "USAAA2600014",
          },
          actor,
        ),
        createRole(org, {
          work_id: work,
          role: "Credit",
          ownership_type: "Credit",
          clearance_status: "Unknown",
        }),
        assignISRCsToRelease(org, release),
      ]);
      for (const result of outcomes)
        if (result.status === "rejected")
          expect(result.reason).toMatchObject({ status: 409 });
      const desired = "USAAA2699999";
      const results = await Promise.allSettled([
        patchWork(
          org,
          work,
          { expected_revision: await revision("works", work), isrc: desired },
          actor,
        ),
        patchWork(
          org,
          other,
          {
            expected_revision: await revision("works", other),
            isrc: "us-aaa-26-99999",
          },
          actor,
        ),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { status: 409 },
      });
      expect(
        await sql`select id from label_suite.works where org_id=${org} and isrc=${desired}`,
      ).toHaveLength(1);
    });
  },
);
