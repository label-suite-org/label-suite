import { describe, expect, it } from "vitest";
import { approveM0Dispositions, summarizeApprovedM0Ledger } from "./m0-approved-dispositions-core";
import type { M0AuditReport, M0Mismatch } from "./m0-parity-audit-core";

function mismatch(id: string, kind: M0Mismatch["kind"]): M0Mismatch {
  return {
    id,
    kind,
    domain: kind === "integrity" ? "release-rights" : "release-ops",
    sourceTable: "Source",
    canonicalTable: "canonical",
    sourceValue: kind === "key_missing" ? "legacy" : null,
    canonicalValue: kind === "key_extra" ? "native" : null,
    sourceRecordIds: kind === "key_missing" ? ["rec-source"] : [],
    canonicalRecordIds: kind === "key_extra" ? ["canonical-id"] : [],
    comparisonField: "name",
    evidence: "test evidence",
    proposedDisposition: "Human review required",
    owner: "release-ops",
    nextAction: "review",
  };
}

function audit(): M0AuditReport {
  return {
    reportVersion: "m0-parity-audit.v2",
    generatedAt: "2026-08-26T00:00:00.000Z",
    source: {
      airtableBaseId: "base",
      postgresSchema: "label_suite",
      metadataAvailable: true,
      readMode: "Airtable GET + Postgres SELECT",
      sourceRevision: "airtable-evidence-sha256:test",
      targetRevision: "e22b2497ae3eea47fa4ee8b215a27b6d2f827b8b",
    },
    safety: { noMutation: true, immutableArtifact: true, dispositionVocabulary: [], commands: [] },
    scope: { tablesChecked: 1, mappedTables: 1, countDeltas: 1, keyChecks: 1, sourceIdChecks: 1, deepChecks: 1 },
    sections: [],
    mismatches: [mismatch("count", "count_delta"), mismatch("extra", "key_extra"), mismatch("missing", "key_missing"), mismatch("source", "source_id"), mismatch("integrity", "integrity")],
    proposedGroups: [],
    individualReviewMismatchIds: [],
    checks: { tableCounts: [], integrity: [], readiness: [] },
  };
}

describe("approved M0 dispositions", () => {
  it("locks every mismatch under the approved conservative policy", () => {
    const ledger = approveM0Dispositions(audit(), "2026-08-26T17:00:00.000Z");
    expect(ledger.dispositions).toHaveLength(5);
    expect(summarizeApprovedM0Ledger(ledger)).toEqual({
      "Accepted intentional difference": 2,
      "Correct source data": 1,
      "Fix in Label Suite": 2,
    });
    expect(ledger.dispositions.every((row) => row.owner && row.reviewer && row.rationale && row.nextAction)).toBe(true);
    expect(ledger.dispositions.some((row) => row.disposition === "Human review required")).toBe(false);
    expect(ledger.dispositions.find((row) => row.mismatchId === "source")?.followUp).toBe("source-id:release-ops");
    expect(ledger.dispositions.find((row) => row.mismatchId === "integrity")?.followUp).toBe("integrity:tracks-missing-work");
  });

  it("requires source evidence instead of turning legacy-only rows into a bulk import", () => {
    const row = approveM0Dispositions(audit(), "2026-08-26T17:00:00.000Z").dispositions.find(({ mismatchId }) => mismatchId === "missing");
    expect(row?.disposition).toBe("Correct source data");
    expect(row?.evidenceRequired).toContain("Source status");
    expect(row?.nextAction).toContain("No bulk import");
  });
});
