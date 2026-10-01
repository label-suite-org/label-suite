import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const enabled = process.env.RELEASE_GATE_FIXTURE_DISPOSABLE === "1";
const org = `spotify-audit-${randomUUID()}`;
let sql: Sql;
let service: typeof import("./spotify-identity");

describe.skipIf(!enabled)("Spotify confirmation audit rollback", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || !(url.pathname === "/label_suite" || url.pathname.endsWith("_fixture"))) {
      throw new Error("Explicit disposable local database required");
    }
    sql = postgres(url.toString());
    service = await import("./spotify-identity");
    vi.stubEnv("SPOTIFY_IDENTITY_ENRICHMENT_ENABLED", "true");
    await sql`insert into label_suite.orgs(id,name,slug) values (${org},'Spotify fixture',${org})`;
    await sql`insert into label_suite.integration_providers(id,org_id,key,name,category) values (${org},${org},'spotify','Spotify fixture','test')`;
    await sql`insert into label_suite.integration_connections(id,org_id,provider_id,label,status) values (${org},${org},${org},'Fixture','connected')`;
    await sql`insert into label_suite.artists(id,org_id,name) values (${org},${org},'Fixture artist'), (${org+'-replacement'},${org},'Replacement artist')`;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!sql) return;
    for (const table of ['audit_events','external_object_links','integration_connections','integration_providers','artists','audit_logs']) {
      await sql`delete from ${sql(`label_suite.${table}`)} where org_id=${org}`;
    }
    await sql`delete from label_suite.orgs where id=${org}`;
    await sql.end();
  });

  it("commits the match and audit together, rolling back both new and replacement links when audit fails", async () => {
    const input = {
      connection_id: org, object_type: 'artist' as const, external_id: 'fixture-artist',
      label_suite_object_type: 'artist' as const, label_suite_object_id: org,
      match_method: 'title_artist' as const, match_confidence: 55,
    };
    const saved = await service.confirmSpotifyIdentity(org, input);
    const [audit] = await sql`select count(*)::int as count from label_suite.audit_events where org_id=${org} and event_type='spotify_identity_confirmed'`;
    expect(audit.count).toBe(1);
    const fn = `spotify_audit_${randomUUID().replaceAll('-','')}`;
    await sql.unsafe(`create function label_suite.${fn}() returns trigger language plpgsql as $$ begin raise exception 'fixture audit unavailable'; end $$`);
    await sql.unsafe(`create trigger ${fn} before insert on label_suite.audit_events for each row when (new.org_id = '${org}') execute function label_suite.${fn}()`);
    try {
      await expect(service.confirmSpotifyIdentity(org, {...input, external_id:'fixture-new'})).rejects.toThrow();
      await expect(service.confirmSpotifyIdentity(org, {...input, label_suite_object_id:org+'-replacement'})).rejects.toThrow();
      const links = await sql`select id,external_object_id,label_suite_object_id from label_suite.external_object_links where org_id=${org}`;
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({id:saved.id, external_object_id:input.external_id, label_suite_object_id:org});
      const [remaining] = await sql`select count(*)::int as count from label_suite.audit_events where org_id=${org}`;
      expect(remaining.count).toBe(1);
    } finally {
      await sql.unsafe(`drop trigger ${fn} on label_suite.audit_events`);
      await sql.unsafe(`drop function label_suite.${fn}()`);
    }
  });
});
