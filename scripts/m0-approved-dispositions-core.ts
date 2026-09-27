import type { M0AuditReport, M0Disposition, M0Mismatch } from "./m0-parity-audit-core";

export interface ApprovedM0Disposition {
  mismatchId: string;
  disposition: M0Disposition;
  owner: string;
  reviewer: string;
  rationale: string;
  authoritativeBoundary: string;
  evidenceRequired: string;
  nextAction: string;
  followUp: string | null;
}

export interface ApprovedM0Ledger {
  reportVersion: "m0-approved-dispositions.v1";
  approvedAt: string;
  approvedBy: string;
  sourceAudit: M0AuditReport["source"] & { mismatchCount: number };
  policy: string[];
  dispositions: ApprovedM0Disposition[];
}

const REVIEWER = "Malthe Lund Madsen";
type ApprovedM0Decision = Omit<ApprovedM0Disposition, "mismatchId" | "owner" | "reviewer">;

function acceptedDifference(mismatch: M0Mismatch): ApprovedM0Decision {
  if (mismatch.kind === "count_delta") {
    return {
      disposition: "Accepted intentional difference",
      rationale: "The count delta is a derived comparison, not an independent record correction. Row-level decisions govern any follow-up.",
      authoritativeBoundary: "Airtable rows remain authoritative evidence for the legacy source; Label Suite rows remain authoritative for the canonical product. The aggregate count comparison is non-authoritative.",
      evidenceRequired: "The immutable source and canonical record-ID lists already captured by the audit.",
      nextAction: "Resolve the row-level dispositions for this table and verify the count again in the next immutable parity run.",
      followUp: null,
    };
  }
  return {
    disposition: "Accepted intentional difference",
    rationale: "The record is canonical-native Label Suite data. The retired Airtable source is not required to mirror records created or normalized in Label Suite.",
    authoritativeBoundary: "The identified Label Suite row is authoritative. Its absence from Airtable is non-authoritative and must not cause a reverse import or deletion.",
    evidenceRequired: "The canonical record ID and value captured by the immutable audit, plus the next parity run.",
    nextAction: "Retain the canonical row and verify it remains tenant-scoped and source-safe; do not create a matching Airtable row.",
    followUp: null,
  };
}

function sourceCorrection(mismatch: M0Mismatch): ApprovedM0Decision {
  return {
    disposition: "Correct source data",
    rationale: "A legacy-only row is not automatically imported. The source owner must classify it as active canonical business data or explicitly retired legacy data before any write.",
    authoritativeBoundary: "Airtable is authoritative only for the legacy row and its historical context. Label Suite remains authoritative for active operational data after a verified import decision.",
    evidenceRequired: "Source status, linked-record context, and business-use evidence. Active rows require a narrow Label Suite import issue; retired rows require an explicit non-destructive source disposition.",
    nextAction: "Review the captured source evidence, then either archive/retire the legacy row or reclassify it into a narrow Label Suite import issue. No bulk import is permitted.",
    followUp: `source-review:${mismatch.sourceTable}`,
  };
}

function labelSuiteFix(mismatch: M0Mismatch): ApprovedM0Decision {
  let followUp: string;
  if (mismatch.kind === "source_id") {
    const table = mismatch.canonicalTable ?? mismatch.sourceTable;
    if (["artists", "contacts"].includes(table)) followUp = "source-id:directory";
    else if (["releases", "tracks", "roles", "isrc_sequences"].includes(table)) followUp = "source-id:release-rights";
    else if (table === "royalty_earnings") followUp = "source-id:royalty-evidence";
    else followUp = "source-id:release-ops";
  } else {
    followUp = /missing release/i.test(mismatch.evidence)
      ? "integrity:tracks-missing-release"
      : "integrity:tracks-missing-work";
  }
  return {
    disposition: "Fix in Label Suite",
    rationale: mismatch.kind === "source_id"
      ? "Canonical records must preserve a durable legacy crosswalk so parity and provenance do not depend on names or counts."
      : "The canonical integrity check identifies an observable release blocker that belongs in Label Suite rather than in the retired source.",
    authoritativeBoundary: "Label Suite is authoritative for the canonical relationship, integrity rule, and resulting correction. Airtable remains read-only evidence.",
    evidenceRequired: mismatch.evidence,
    nextAction: "Track this as a narrow domain-specific issue and reviewed pull request, then rerun immutable parity after the correction merges and deploys.",
    followUp,
  };
}

export function approveM0Dispositions(
  audit: M0AuditReport,
  approvedAt: string,
  approvedBy = REVIEWER,
): ApprovedM0Ledger {
  const dispositions = audit.mismatches.map((mismatch): ApprovedM0Disposition => {
    const decision = mismatch.kind === "count_delta" || mismatch.kind === "key_extra"
      ? acceptedDifference(mismatch)
      : mismatch.kind === "key_missing"
        ? sourceCorrection(mismatch)
        : labelSuiteFix(mismatch);
    return { mismatchId: mismatch.id, owner: REVIEWER, reviewer: REVIEWER, ...decision };
  });
  return {
    reportVersion: "m0-approved-dispositions.v1",
    approvedAt,
    approvedBy,
    sourceAudit: { ...audit.source, mismatchCount: audit.mismatches.length },
    policy: [
      "No broad Airtable re-import or destructive source action.",
      "Keep verified canonical-native Label Suite data.",
      "Import legacy-only data only after active business-use evidence is recorded.",
      "Retain source IDs or an explicit crosswalk for every imported legacy row.",
      "Rights, financial, contact, and identity facts remain evidence-gated.",
    ],
    dispositions,
  };
}

export function summarizeApprovedM0Ledger(ledger: ApprovedM0Ledger) {
  const counts = new Map<string, number>();
  for (const row of ledger.dispositions) counts.set(row.disposition, (counts.get(row.disposition) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
