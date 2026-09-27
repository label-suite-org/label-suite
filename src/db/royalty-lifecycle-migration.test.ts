import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REQUIRED_FORCE_RLS_TABLES } from "../../scripts/royalty-runtime-db-posture";

const migration = readFileSync(new URL("../../drizzle/0075_royalty_lifecycle_integrity.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

describe("royalty lifecycle SQL integrity migration", () => {
  it("journals one additive lifecycle migration after the Phase 1 decimal foundation", () => {
    expect(journal.entries.find((entry) => entry.tag === "0075_royalty_lifecycle_integrity"))
      .toMatchObject({ idx: 67, tag: "0075_royalty_lifecycle_integrity" });
  });

  it("mirrors every canonical one-way transition in the database trigger contract", () => {
    // Break caught: TypeScript-only lifecycle checks can be bypassed by direct
    // SQL, leaving financial history in an impossible state.
    for (const transition of [
      "received->parsing", "parsing->parsed", "parsing->failed", "parsed->superseded",
      "draft->approved", "approved->reversed",
      "draft->calculated", "calculated->reviewed", "reviewed->issued", "issued->closed",
      "draft->approved", "approved->recorded", "draft->failed", "approved->failed", "recorded->reversed",
    ]) {
      const [from, to] = transition.split("->");
      expect(migration).toContain(`OLD.status = '${from}' AND NEW.status = '${to}'`);
    }
    expect(migration).toContain("OLD.posting_status = 'draft' AND NEW.posting_status = 'posted'");
    expect(migration).toContain("OLD.posting_status = 'posted' AND NEW.posting_status = 'reversed'");
    expect(migration).toContain("Invalid royalty lifecycle transition");
  });

  it("makes privileged issuance, posting, reversal, and immutable snapshots database-enforced", () => {
    for (const token of [
      "assert_royalty_lifecycle_authorized",
      "establish_royalty_lifecycle_context",
      "royalty_lifecycle_contexts",
      "assert_royalty_ledger_transition",
      "assert_royalty_reversal_header",
      "assert_royalty_reversal_entry_groups",
      "assert_royalty_statement_immutability",
      "assert_royalty_ledger_entry_immutability",
      "royalty_statement_lifecycle",
      "royalty_statement_immutability",
      "royalty_ledger_transaction_lifecycle",
      "royalty_ledger_transaction_immutability",
      "royalty_ledger_entry_immutability",
    ]) {
      expect(migration).toContain(token);
    }
    expect(migration).not.toContain("app.royalty_lifecycle_authorized");
    expect(migration).not.toMatch(/CREATE ROLE|ALTER (?:TABLE|FUNCTION).* OWNER TO/);
    expect(migration).toContain("REVOKE ALL ON FUNCTION \"label_suite\".\"establish_royalty_lifecycle_context\"");
    expect(migration).toContain("Linked posted reversal transaction is required");
    expect(migration).toContain("Only one reversal ledger transaction is allowed");
    expect(migration).toContain("must exactly negate the original entry groups");
    expect(migration).toContain("actor_user_id and evidence_reference are required");
  });

  it("consumes lifecycle authority once and serializes header and entry financial mutations", () => {
    // Break caught: authorization replay or an unlocked parent read lets two
    // sessions mutate a financial lifecycle independently.
    expect(migration).toContain('UPDATE "label_suite"."royalty_lifecycle_contexts" context');
    expect(migration).toContain("context.consumed_at IS NULL");
    expect(migration).toContain("RETURNING context.org_id, context.actor_user_id");
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain("ORDER BY transaction.id");
  });

  it("keeps RLS, same-org references, and audit triggers complete for financial records", () => {
    for (const table of REQUIRED_FORCE_RLS_TABLES) {
      expect(migration).toContain(`ALTER TABLE "label_suite"."${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`ALTER TABLE "label_suite"."${table}" FORCE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."${table}";`);
    }
    expect(migration).toContain("'statement_id', 'royalty_statements'");
    expect(migration).toContain("'payout_id', 'royalty_payouts'");
    expect(migration).toContain("'transaction_id', 'royalty_ledger_transactions'");
    expect(migration).toContain("'reversal_of_transaction_id', 'royalty_ledger_transactions'");
  });

  it("rejects advanced inserts while retaining only deterministic Airtable legacy normalization", () => {
    expect(migration).toContain("must start in its initial lifecycle state");
    expect(migration).toContain("OLD.status = 'completed'");
    expect(migration).toContain("NEW.status = 'parsed'");
    expect(migration).toContain("OLD.source = 'airtable_sheet'");
    expect(migration).toContain("OLD.id ~ '^royalty_import_[0-9a-f]{24}$'");
    expect(migration).not.toContain("OLD.id LIKE 'royalty_import_%'");
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF "status"');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF "posting_status"');
  });
});
