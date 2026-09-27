import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../drizzle/0071_campaign_rich_text_ai.sql", import.meta.url), "utf8");
const revisionMigration = readFileSync(new URL("../../drizzle/0072_campaign_revision.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; when: number; tag: string }>;
};

describe("campaign rich text and editor AI migration", () => {
  it("adds documents without rewriting existing content", () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "goal_document" jsonb');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "notes_document" jsonb');
    expect(revisionMigration).toContain('ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "body_document" jsonb');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "body_html" text');
    expect(migration).toContain('"campaign_editor_ai_runs"');
    expect(migration).not.toMatch(/^\s*(?:UPDATE|DELETE|TRUNCATE|DROP TABLE)\b/im);
  });

  it("protects AI runs with tenant, same-org and audit controls", () => {
    expect(migration).toContain('ALTER TABLE "label_suite"."campaign_editor_ai_runs" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY "tenant_isolation"');
    expect(migration).toContain('enforce_same_org_references');
    expect(migration).toContain('write_audit_log');
  });

  it("covers every governed AI-run field, constraint, reference, and index", () => {
    for (const column of [
      "id",
      "org_id",
      "campaign_id",
      "surface",
      "lead_id",
      "draft_id",
      "page_revision_id",
      "operation",
      "scope",
      "selection_from",
      "selection_to",
      "input_document_hash",
      "context_manifest",
      "proposed_document",
      "provider",
      "model",
      "rationale",
      "citation_ids",
      "status",
      "failure_category",
      "decided_by",
      "decided_at",
      "created_at",
      "updated_at",
    ]) {
      expect(migration).toContain(`"${column}"`);
    }

    for (const constraint of ["surface_check", "operation_check", "scope_check", "status_check"]) {
      expect(migration).toContain(`campaign_editor_ai_runs_${constraint}`);
    }
    expect(migration).toContain("CHECK (\"surface\" IN ('campaign_goal', 'campaign_notes', 'public_release_note', 'focused_outreach_body', 'radio_update_body'))");
    expect(migration).toContain("CHECK (\"operation\" IN ('draft', 'enrich', 'improve', 'shorten', 'tone', 'custom'))");
    expect(migration).toContain("CHECK (\"scope\" IN ('selection', 'document'))");
    expect(migration).toContain("CHECK (\"status\" IN ('running', 'ready', 'accepted', 'rejected', 'failed', 'stale'))");
    expect(revisionMigration).toContain("campaign_editor_ai_runs_failure_category_check");
    expect(revisionMigration).toContain("CHECK (\"failure_category\" IS NULL OR \"failure_category\" IN ('disabled', 'refused', 'timeout', 'network', 'provider', 'malformed_output', 'invalid_proposal', 'unknown_citation'))");

    for (const index of [
      "campaign_editor_ai_runs_org_campaign_status_idx",
      "campaign_editor_ai_runs_lead_id_idx",
      "campaign_editor_ai_runs_draft_id_idx",
      "campaign_editor_ai_runs_page_revision_id_idx",
    ]) {
      expect(migration).toContain(index);
    }

    expect(migration).toContain("'campaign_id', 'campaigns'");
    expect(migration).toContain("'lead_id', 'campaign_leads'");
    expect(migration).toContain("'draft_id', 'campaign_outreach_drafts'");
    expect(migration).toContain("'page_revision_id', 'campaign_public_page_revisions'");
  });

  it("journals migration 0071 after the existing migration history", () => {
    const entry = journal.entries.find((candidate) => candidate.tag === "0071_campaign_rich_text_ai");
    const predecessor = journal.entries.find((candidate) => candidate.tag === "0070_campaign_public_page_pointer_delete");

    expect(entry).toEqual(expect.objectContaining({ idx: 63, tag: "0071_campaign_rich_text_ai" }));
    expect(entry!.idx).toBe(predecessor!.idx + 1);
    expect(entry!.when).toBeGreaterThan(predecessor!.when);
  });

  it("journals the additive campaign revision after 0071 for already-migrated databases", () => {
    const entry = journal.entries.find((candidate) => candidate.tag === "0072_campaign_revision");
    const predecessor = journal.entries.find((candidate) => candidate.tag === "0071_campaign_rich_text_ai");
    expect(entry).toEqual(expect.objectContaining({ idx: 64, tag: "0072_campaign_revision" }));
    expect(entry!.idx).toBe(predecessor!.idx + 1);
  });
});
