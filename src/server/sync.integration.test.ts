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
    const approved = await asOrg(org, () =>
      server.saveSyncDeal(org, "fixture", {
        ...accepted,
        expected_version: 2,
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
});
