import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { syncDraft } from "../lib/sync";
const original = process.env.DATABASE_URL ?? "";
const enabled =
  process.env.SYNC_INTEGRATION === "1" ||
  (process.env.CI === "true" &&
    process.env.RELEASE_GATE_FIXTURE_DISPOSABLE === "1");
if (enabled) {
  const target = new URL(original);
  const local =
    process.env.SYNC_INTEGRATION === "1" &&
    ["localhost", "127.0.0.1"].includes(target.hostname) &&
    target.pathname === "/label_suite_sync_test";
  const ci =
    process.env.CI === "true" &&
    process.env.RELEASE_GATE_FIXTURE_DISPOSABLE === "1" &&
    original ===
      "postgres://label_suite:label_suite@127.0.0.1:5432/label_suite";
  if (!local && !ci)
    throw new Error(
      "Sync integration requires a disposable local label_suite_sync_test database or the exact CI database",
    );
}
const suffix = randomUUID().replaceAll("-", "");
const org = `sync-${suffix}`,
  other = `sync-other-${suffix}`,
  role = `sync_test_${suffix}`;
let admin: Pool,
  database: typeof import("../lib/db"),
  server: typeof import("./sync");
describe.skipIf(!enabled)("sync persistence on disposable PostgreSQL", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: original });
    await admin.query(
      `create role "${role}" login password '${suffix}' nosuperuser nobypassrls`,
    );
    await admin.query(`grant usage on schema label_suite to "${role}"`);
    await admin.query(
      `grant select,insert,update,delete on all tables in schema label_suite to "${role}"`,
    );
    await admin.query(
      "insert into label_suite.orgs(id,name,slug) values($1,'Sync fixture',$1),($2,'Other fixture',$2)",
      [org, other],
    );
    await admin.query(
      "insert into label_suite.artists(id,org_id,name) values($1,$2,'Fixture Artist'),($3,$4,'Other Artist')",
      [org, org, other, other],
    );
    await admin.query(
      "insert into label_suite.documents(id,org_id,name) values($1,$2,'Fixture agreement'),($3,$4,'Foreign agreement')",
      [org, org, other, other],
    );
    const url = new URL(original);
    url.username = role;
    url.password = suffix;
    process.env.DATABASE_URL = url.href;
    database = await import("../lib/db");
    server = await import("./sync");
  });
  afterAll(async () => {
    process.env.DATABASE_URL = original;
    if (database) await database.pool.end();
    if (!admin) return;
    for (const table of [
      "sync_receipts",
      "sync_revisions",
      "sync_deals",
      "ops_tasks",
      "documents",
      "releases",
      "artists",
      "audit_logs",
    ]) {
      await admin.query(
        `delete from label_suite.${table} where org_id=any($1)`,
        [[org, other]],
      );
    }
    await admin.query("delete from label_suite.orgs where id=any($1)", [
      [org, other],
    ]);
    await admin.query(`drop owned by "${role}"`);
    await admin.query(`drop role "${role}"`);
    await admin.end();
  });
  it("persists versioned deals, isolates all linked evidence, rejects stale saves and records receipts once", async () => {
    const asOrg = <T>(id: string, fn: () => Promise<T>) =>
      database.runWithDatabaseContext({ orgId: id, userId: "" }, fn);
    const input = {
      id: randomUUID(),
      expected_version: 0,
      production: "Fixture placement",
      artist_id: org,
      details: {
        ...syncDraft(),
        recording_title: "Fixture cover",
        version_name: "Instrumental",
        provenance: "Synthetic",
        fee_amount: "25000",
      },
      next_action: "Confirm terms",
      owner: "Fixture operator",
    };
    const created = await asOrg(org, () =>
      server.saveSyncDeal(org, "fixture", input),
    );
    expect(created.deal.details.currency).toBe("");
    expect(created.next_action).toBe("Confirm terms");
    expect(created.revisions).toHaveLength(1);
    await expect(
      asOrg(other, () => server.getSyncDeal(other, input.id)),
    ).rejects.toMatchObject({ status: 404 });
    // Explicit organization filters cannot override RLS.
    expect(await asOrg(other, () => server.listSyncDeals(org))).toEqual([]);
    await expect(
      asOrg(org, () =>
        server.saveSyncDeal(org, "fixture", {
          ...input,
          id: randomUUID(),
          artist_id: other,
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      asOrg(org, () =>
        server.saveSyncDeal(org, "fixture", {
          ...input,
          expected_version: 1,
          details: { ...input.details, contract_document_id: other },
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      asOrg(org, () => server.saveSyncDeal(org, "fixture", input)),
    ).rejects.toMatchObject({ status: 409 });
    const accepted = {
      ...input,
      expected_version: 1,
      details: {
        ...input.details,
        currency: "USD",
        fee_basis: "master_only",
        commercial_status: "accepted_in_principle",
        authority: "Fixture agreement",
      },
    };
    const review = await asOrg(org, () =>
      server.saveSyncDeal(org, "fixture", accepted),
    );
    expect(review.deal.details.contract_status).toBe("needs_review");
    const taskBefore = await admin.query(
      "select revision from label_suite.ops_tasks where id=$1",
      [created.deal.task_id],
    );
    const approved = await asOrg(org, () =>
      server.saveSyncDeal(org, "fixture", {
        ...accepted,
        expected_version: 2,
        next_action: "Review signed agreement",
        details: {
          ...review.deal.details,
          commercial_status: "accepted_in_principle",
          master_status: "approved",
          authority: "Fixture agreement",
          master_evidence: "Fixture approval",
          contract_status: "signed",
          signed_date: "2026-10-25",
          contract_document_id: org,
        },
      }),
    );
    expect(approved.deal.details.publishing_status).toBe("pending");
    const taskAfter = await admin.query(
      "select revision,task_name from label_suite.ops_tasks where id=$1",
      [created.deal.task_id],
    );
    expect(taskAfter.rows[0].revision).toBe(taskBefore.rows[0].revision + 1);
    expect(taskAfter.rows[0].task_name).toBe("Review signed agreement");
    const persisted = await asOrg(org, () =>
      server.getNativeSyncDeal(org, input.id),
    );
    expect(persisted.deal.details.signed_date).toBe("2026-10-25");
    expect(persisted.deal.details.contract_status).toBe("signed");
    expect(persisted.references.contract_document).toEqual({
      id: org,
      label: "Fixture agreement",
    });
    const receipt = {
      id: randomUUID(),
      deal_id: input.id,
      amount: "10000.10",
      currency: "USD",
      received_date: "2026-10-25",
      reference: "fixture-bank-reference",
      document_id: org,
    };
    await asOrg(org, () => server.recordSyncReceipt(org, "fixture", receipt));
    const retry = await asOrg(org, () =>
      server.recordSyncReceipt(org, "fixture", receipt),
    );
    expect(retry.receipts).toHaveLength(1);
    expect(retry.money.balance).toBe("14999.9");
    expect(retry.money.status).toBe("part_received");
    await expect(
      asOrg(org, () =>
        server.recordSyncReceipt(org, "fixture", { ...receipt, amount: "1" }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      asOrg(other, () =>
        server.recordSyncReceipt(other, "fixture", {
          ...receipt,
          id: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      asOrg(org, () =>
        server.recordSyncReceipt(org, "fixture", {
          ...receipt,
          id: randomUUID(),
          document_id: other,
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    const changed = await asOrg(org, () =>
      server.saveSyncDeal(org, "fixture", {
        ...accepted,
        expected_version: 3,
        details: {
          ...approved.deal.details,
          promotion: "New standalone trailer",
        },
      }),
    );
    expect(changed.deal.details.master_status).toBe("pending");
    expect(changed.revisions[1].snapshot.details.contract_status).toBe(
      "signed",
    );
    const result = await admin.query(
      "select count(*)::int as count from label_suite.royalty_earnings where org_id=$1",
      [org],
    );
    expect(result.rows[0].count).toBe(0);
  });
  it("pages precise timestamp ties and applies artist/release filters before limiting with RLS isolation", async () => {
    const asOrg = <T>(id: string, fn: () => Promise<T>) =>
      database.runWithDatabaseContext({ orgId: id, userId: "" }, fn);
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const details = {
      ...syncDraft(),
      recording_title: "Paging fixture",
      version_name: "Exact version",
      provenance: "Synthetic",
    };
    await admin.query(
      "insert into label_suite.releases(id,org_id,title) values($1,$2,'Paging release')",
      [org, org],
    );
    for (let i = 0; i < ids.length; i++) {
      await admin.query(
        "insert into label_suite.sync_deals(id,org_id,production,artist_id,release_id,details,updated_at) values($1,$2,$3,$4,$5,$6,$7)",
        [
          ids[i],
          org,
          `Page ${i}`,
          i === 3 ? null : org,
          i === 3 ? null : org,
          details,
          i === 2 ? "2026-10-31 12:00:00.123455" : "2026-10-31 12:00:00.123456",
        ],
      );
    }
    const expected = [ids[0], ids[1]].sort().reverse().concat(ids[2]);
    const actual: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await asOrg(org, () =>
        server.listSyncDealsPage(org, {
          limit: 1,
          artist: org,
          release: org,
          cursor,
        }),
      );
      actual.push(...page.items.map((row) => row.deal.id));
      expect(page.has_more).toBe(page.next_cursor !== null);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    expect(actual).toEqual(expected);
    expect(
      (await asOrg(other, () => server.listSyncDealsPage(org))).items,
    ).toEqual([]);
    expect(
      (await asOrg(org, () => server.listSyncDealsPage(org, { artist: other })))
        .items,
    ).toEqual([]);
    await expect(
      asOrg(org, () => server.listSyncDealsPage(org, { cursor: "garbage" })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      asOrg(org, () =>
        server.listSyncDealsPage(org, {
          cursor: Buffer.from(
            JSON.stringify({ updated_at: "invalid", id: ids[0] }),
          ).toString("base64url"),
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    for (const limit of [NaN, 0, 51, 1.5]) {
      await expect(
        asOrg(org, () => server.listSyncDealsPage(org, { limit })),
      ).rejects.toThrow();
    }
  });
  it("bounds receipt and revision history while aggregating all exact currency amounts and resolving only tenant evidence", async () => {
    const asOrg = <T>(id: string, fn: () => Promise<T>) =>
      database.runWithDatabaseContext({ orgId: id, userId: "" }, fn);
    const id = randomUUID();
    const details = {
      ...syncDraft(),
      recording_title: "History fixture",
      version_name: "Instrumental",
      provenance: "Synthetic",
      fee_amount: "100",
      currency: "USD",
      fee_basis: "master_only",
      commercial_status: "accepted_in_principle",
      contract_document_id: org,
      invoice_document_id: other,
    };
    await admin.query(
      "insert into label_suite.sync_deals(id,org_id,production,artist_id,details) values($1,$2,'History fixture',$2,$3)",
      [id, org, details],
    );
    await admin.query(
      "insert into label_suite.sync_receipts(id,org_id,deal_id,amount,currency,received_date,reference,document_id,actor_id) select gen_random_uuid()::text,$1,$2,case when n<=51 then 0.10000001 else 999999999999.99999999 end,case when n<=51 then 'USD' else 'EUR' end,'2026-10-31','Receipt '||n,case when n=53 then null else $1 end,'fixture' from generate_series(1,53) n",
      [org, id],
    );
    await admin.query(
      "insert into label_suite.sync_revisions(id,org_id,deal_id,version,snapshot,actor_id) select gen_random_uuid()::text,$1,$2,n,$3,'fixture' from generate_series(1,53) n",
      [org, id, { details }],
    );
    const first = await asOrg(org, () => server.getNativeSyncDeal(org, id));
    expect(first.receipts).toHaveLength(25);
    expect(first.revisions).toHaveLength(25);
    expect(first.revisions[0]).not.toHaveProperty("snapshot");
    expect(first.money).toEqual({
      totals: { USD: "5.10000051", EUR: "1999999999999.99999998" },
      balance: "94.89999949",
      status: "part_received",
    });
    expect(first.references.artist).toEqual({
      id: org,
      label: "Fixture Artist",
    });
    expect(first.references.contract_document).toEqual({
      id: org,
      label: "Fixture agreement",
    });
    expect(first.references.invoice_document).toBeNull();
    const receipts = [...first.receipts];
    const revisions = [...first.revisions];
    let page = first;
    while (page.receipts_page.has_more || page.revisions_page.has_more) {
      page = await asOrg(org, () =>
        server.getNativeSyncDeal(org, id, {
          receipts_cursor: page.receipts_page.next_cursor!,
          revisions_cursor: page.revisions_page.next_cursor!,
        }),
      );
      expect(page.money).toEqual(first.money);
      receipts.push(...page.receipts);
      revisions.push(...page.revisions);
    }
    expect(new Set(receipts.map((r) => r.id)).size).toBe(53);
    expect(revisions.map((r) => r.version)).toEqual(
      Array.from({ length: 53 }, (_, i) => 53 - i),
    );
    expect(
      receipts.find((r) => r.document_id === null)?.document_label,
    ).toBeNull();
    expect(receipts.find((r) => r.document_id === org)?.document_label).toBe(
      "Fixture agreement",
    );
    await expect(
      asOrg(other, () => server.getNativeSyncDeal(org, id)),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      asOrg(org, () =>
        server.getNativeSyncDeal(org, id, { receipts_cursor: "bad" }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      asOrg(org, () =>
        server.getNativeSyncDeal(org, id, { revisions_cursor: "bad" }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
