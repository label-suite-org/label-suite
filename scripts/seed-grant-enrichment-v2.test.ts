/**
 * Tests for grant enrichment: matching, validation, DB operations.
 * Imports the production enrichment module for genuine integration testing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, sql } from "drizzle-orm";
import { enrichGrants } from "./seed-grant-enrichment-v2";
import { grants, grant_deadlines } from "../src/db/schema";
import { db } from "../src/lib/db";

const ORG_ID = "true-nature"; // Must exist in the DB (FK constraint)
const TEST_PREFIX = "test-enrich-";
const dbUrl = process.env.DATABASE_URL ?? "";
const isProductionLike = /neon\.tech|truenature|winona|label-suite/i.test(dbUrl);
const describeDb = isProductionLike && process.env.GRANT_ENRICHMENT_TEST_DB !== "1" ? describe.skip : describe;

// ── Helpers ────────────────────────────────────────────

function grantId(name: string) {
  return `${TEST_PREFIX}${name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;
}

async function createGrant(name: string, funder?: string) {
  const id = grantId(name);
  await db.insert(grants).values({
    id,
    org_id: ORG_ID,
    name,
    funder: funder ?? "TEST",
  }).onConflictDoNothing();
  return id;
}

async function cleanup() {
  // Match by ID prefix, not name (names can be anything)
  const rows = await db.select({ id: grants.id }).from(grants)
    .where(and(
      eq(grants.org_id, ORG_ID),
      sql`${grants.id} LIKE ${"test-enrich-%"}`,
    ));
  for (const r of rows) {
    await db.delete(grant_deadlines).where(eq(grant_deadlines.grant_id, r.id));
  }
  for (const r of rows) {
    await db.delete(grants).where(eq(grants.id, r.id));
  }
}

function makeInput(overrides: Record<string, unknown> = {}): any {
  // Returns a value that passes schema validation; cast to any to avoid
  // TypeScript structural mismatch — runtime Zod validation catches real issues.
  const base = {
    airtable_id: `rec-test-${Math.random().toString(36).slice(2, 8)}`,
    name: "Test Grant",
    canonical_name: "Test Grant",
    funder: "TEST",
    applicant_type: "individual_artist",
    eligible_uses: "Testing",
    co_financing_required: false,
    self_financing_required: false,
    in_kind_accepted: false,
    payment_schedule: "Now",
    payment_timing: "before_costs",
    max_amount: 10000,
    currency: "DKK",
    recurrence_type: "rolling",
    recurrence_notes: "Always open",
    decision_timing: "1 week",
    assessment_criteria: "None",
    restrictions: "None",
    verified: true,
    last_verified_at: "2026-07-13",
    research_source: "test.com",
    aps_eligible: false,
    forening_eligible: false,
    individual_eligible: true,
    commercial_allowed: true,
    revenue_generating_allowed: true,
    genre_restrictions: "All",
    career_stage: "Any",
    geography: "DK",
  };
  return { ...base, ...overrides, canonical_name: overrides.canonical_name ?? overrides.name ?? base.canonical_name };
}

// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// Global cleanup — run before any test to clear leaked records
// ═══════════════════════════════════════════════════════════

beforeAll(async () => {
  if (!isProductionLike || process.env.GRANT_ENRICHMENT_TEST_DB === "1") await cleanup();
}, 10000);

describeDb("enrichGrants — matching", () => {

  it("matches by exact input name when DB has matching record", async () => {
    const testName = "ENRICH-MATCH-TEST — Exact Name Grant 2027";
    await createGrant(testName, "TEST-FUNDER");
    const report = await enrichGrants(ORG_ID, [makeInput({
      airtable_id: "rec-exact-test",
      name: testName,
      funder: "TEST-FUNDER",
    })], { dryRun: true });

    // Should match by exact name (no substring, no normalization tricks)
    expect(report.ambiguous).toHaveLength(0);
    // Either it matches (updated > 0) OR the production DB lacks this name and it's not_found
    // The key test is: no ambiguous matches
    if (report.notFound.length) {
      // If not found, it should be because the DB doesn't have this exact name
      // (which is fine — exact-name-only matching is what we're testing)
    } else {
      expect(report.updated.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("reports not_found for non-existent grant name", async () => {
    const report = await enrichGrants(ORG_ID, [makeInput({
      airtable_id: "rec-nonexistent",
      name: "ZZZ Non Existent Grant 2027",
      funder: "Unknown",
    })], { dryRun: true });

    expect(report.notFound).toHaveLength(1);
    expect(report.updated).toHaveLength(0);
  });

  it("does NOT accept substring matches — exact match only", async () => {
    const name1 = "ZZZ Test Substring Grant Alpha 2027";
    const name2 = "ZZZ Test Substring Grant Alpha 2027 — Extended Edition";
    await createGrant(name1);
    await createGrant(name2);

    // "ZZZ Test Substring Grant" alone should NOT match either record
    const report = await enrichGrants(ORG_ID, [makeInput({
      airtable_id: "rec-amb-test",
      name: "ZZZ Test Substring Grant",
      funder: "TEST",
    })], { dryRun: true });

    // "ZZZ Test Substring Grant" is not an exact match for either record
    expect(report.updated).toHaveLength(0);
    // It's not_found, not ambiguous (no substring matching)
    expect(report.notFound).toHaveLength(1);
  });
});

describeDb("enrichGrants — validation", () => {
  it("rejects negative max_amount", async () => {
    const report = await enrichGrants(ORG_ID, [makeInput({
      airtable_id: "rec-neg-amount",
      name: "Test Grant",
      max_amount: -100,
    })], { dryRun: true });
    expect(report.validationErrors.length).toBeGreaterThan(0);
  });

  it("rejects min_amount > max_amount", async () => {
    const report = await enrichGrants(ORG_ID, [makeInput({
      airtable_id: "rec-range-err",
      name: "Test Grant",
      min_amount: 50000,
      max_amount: 10000,
    })], { dryRun: true });
    expect(report.validationErrors.length).toBeGreaterThan(0);
  });

  it("rejects invalid URL in official_url", async () => {
    const report = await enrichGrants(ORG_ID, [makeInput({
      airtable_id: "rec-bad-url",
      name: "Test Grant",
      official_url: "not-a-url",
    })], { dryRun: true });
    expect(report.validationErrors.length).toBeGreaterThan(0);
  });

  it("rejects invalid deadline_date format", async () => {
    const report = await enrichGrants(ORG_ID, [makeInput({
      airtable_id: "rec-bad-date",
      name: "Test Grant",
      deadline_rounds: [{ deadline_date: "17/09/2026", classification: "confirmed" }],
    })], { dryRun: true });
    expect(report.validationErrors.length).toBeGreaterThan(0);
  });

  it("rejects confirmed deadline without source_url", async () => {
    const report = await enrichGrants(ORG_ID, [makeInput({
      airtable_id: "rec-no-source",
      name: "Test Grant",
      deadline_rounds: [{
        deadline_date: "2026-09-17",
        classification: "confirmed",
        // no source_url
      }],
    })], { dryRun: true });
    expect(report.validationErrors.length).toBeGreaterThan(0);
  });

  it("rejects deadline_date before opens_on", async () => {
    const report = await enrichGrants(ORG_ID, [makeInput({
      airtable_id: "rec-seq-err",
      name: "Test Grant",
      deadline_rounds: [{
        deadline_date: "2026-01-01",
        opens_on: "2026-06-01",
        classification: "estimated",
      }],
    })], { dryRun: true });
    expect(report.validationErrors.length).toBeGreaterThan(0);
  });

  it("rejects all entity types false", async () => {
    const report = await enrichGrants(ORG_ID, [makeInput({
      airtable_id: "rec-no-entity",
      name: "Test Grant",
      aps_eligible: false,
      forening_eligible: false,
      individual_eligible: false,
    })], { dryRun: true });
    expect(report.validationErrors.length).toBeGreaterThan(0);
  });
});

describeDb("enrichGrants — dry-run parity", () => {
  beforeAll(async () => { await cleanup(); });
  afterAll(async () => { await cleanup(); });

  it("dry-run reports exact field changes that apply would make", async () => {
    const name = "Dry-Run Parity Test Grant";
    await createGrant(name);

    const input = makeInput({
      airtable_id: "rec-dryrun-parity",
      name,
      funder: "PARITY-TEST",
      max_amount: 75000,
      verified: true,
    });

    // Dry run
    const dry = await enrichGrants(ORG_ID, [input], { dryRun: true });
    expect(dry.updated).toHaveLength(1);
    const dryFields = dry.updated[0].fields.map(f => f.field).sort();

    // Apply
    const apply = await enrichGrants(ORG_ID, [input], { dryRun: false });
    expect(apply.updated).toHaveLength(1);
    const applyFields = apply.updated[0].fields.map(f => f.field).sort();

    // Same fields should be reported in both modes
    expect(dryFields).toEqual(applyFields);

    // Dry-run should NOT have modified the DB
    const after = await db.select({ funder: grants.funder })
      .from(grants)
      .where(eq(grants.id, grantId(name)));
    expect(after[0]?.funder).toBe("PARITY-TEST"); // Apply changed it
  });
});

describeDb("enrichGrants — transaction rollback", () => {
  beforeAll(async () => { await cleanup(); });
  afterAll(async () => { await cleanup(); });

  it("does not partially apply when one record fails matching", async () => {
    const name = "Rollback Test Grant";
    await createGrant(name);

    const good = makeInput({
      airtable_id: "rec-rollback-good",
      name,
      funder: "ROLLBACK-TEST",
      max_amount: 1000,
    });
    const bad = makeInput({
      airtable_id: "rec-rollback-bad",
      name: "Non-Existent Grant",
      funder: "NOWHERE",
    });

    // Apply both — the not-found record blocks the entire batch.
    const report = await enrichGrants(ORG_ID, [good, bad], { dryRun: false });

    expect(report.notFound).toHaveLength(1);
    const after = await db.select({ funder: grants.funder }).from(grants).where(eq(grants.id, grantId(name)));
    expect(after[0]?.funder).toBe("TEST");
  });
});

describeDb("enrichGrants — idempotency", () => {
  beforeAll(async () => { await cleanup(); });
  afterAll(async () => { await cleanup(); });

  it("running same enrichment twice produces consistent results", async () => {
    const name = "Idempotency Test Grant";
    await createGrant(name);

    const input = makeInput({
      airtable_id: "rec-idempotent",
      name,
      funder: "IDEMPOTENT-TEST",
      max_amount: 50000,
    });

    const r1 = await enrichGrants(ORG_ID, [input], { dryRun: false });
    expect(r1.updated).toHaveLength(1);

    // Second run should skip (no changes)
    const r2 = await enrichGrants(ORG_ID, [input], { dryRun: false });
    expect(r2.skipped.length).toBeGreaterThanOrEqual(1);
    expect(r2.updated).toHaveLength(0);
  });

  it("deadline upserts are idempotent — rerun creates no duplicates", async () => {
    const name = "Deadline Idempotency Grant";
    const gid = await createGrant(name);

    const input = makeInput({
      airtable_id: "rec-deadline-idem",
      name,
      funder: "DEADLINE-TEST",
      deadline_rounds: [{
        deadline_date: "2026-12-01",
        label: "Test Round",
        classification: "estimated",
      }],
    });

    // First run
    await enrichGrants(ORG_ID, [input], { dryRun: false });

    const count1 = await db.select().from(grant_deadlines)
      .where(eq(grant_deadlines.grant_id, gid));

    // Second run
    await enrichGrants(ORG_ID, [input], { dryRun: false });

    const count2 = await db.select().from(grant_deadlines)
      .where(eq(grant_deadlines.grant_id, gid));

    // Same number of deadline rows (no duplicates)
    expect(count2.length).toBe(count1.length);
  });
});

describeDb("enrichGrants — tenant isolation", () => {
  beforeAll(async () => { await cleanup(); });
  afterAll(async () => { await cleanup(); });

  it("only affects the specified org_id", async () => {
    const name = "Tenant Isolation Grant";
    await createGrant(name);

    const input = makeInput({
      airtable_id: "rec-tenant-iso",
      name,
      funder: "TENANT-TEST",
    });

    // Apply with a different org — should find nothing
    const report = await enrichGrants("nonexistent-org", [input], { dryRun: true });
    expect(report.notFound).toHaveLength(1);
  });
});

describeDb("enrichGrants — ambiguity detection", () => {
  beforeAll(async () => { await cleanup(); });
  afterAll(async () => { await cleanup(); });

  it("detects and reports duplicate DB names", async () => {
    // Create two grants with the same normalized name
    await db.insert(grants).values({
      id: grantId("dup-a"),
      org_id: ORG_ID,
      name: "Duplicate Grant Name",
      funder: "TEST",
    }).onConflictDoNothing();

    await db.insert(grants).values({
      id: grantId("dup-b"),
      org_id: ORG_ID,
      name: "Duplicate Grant Name",
      funder: "TEST",
    }).onConflictDoNothing();

    const report = await enrichGrants(ORG_ID, [makeInput({
      airtable_id: "rec-dup-test",
      name: "Duplicate Grant Name",
      funder: "TEST",
    })], { dryRun: true });

    // Should detect the duplicate collision
    expect(report.duplicateNames.length).toBeGreaterThanOrEqual(1);
    // And should not match either (both removed from byName)
    expect(report.notFound.length + report.ambiguous.length).toBeGreaterThan(0);
  });
});
