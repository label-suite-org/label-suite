type PresentedBlocker = {
  label: string;
  detail: string | null;
};

type CatalogIssueInput = {
  title: string;
  description: string | null;
  sourceTable: string | null;
};

type PresentedCatalogIssue = {
  label: string;
  subject: string | null;
  kind: string;
};

function missingLabel(value: string): string {
  const normalized = value.trim();
  if (/^publishing clearance/i.test(normalized)) return "Publishing clearance incomplete";
  if (/^master clearance/i.test(normalized)) return "Master clearance incomplete";
  if (/^clearance required/i.test(normalized)) return "Rights information missing";
  if (/missing|incomplete|pending/i.test(normalized)) return normalized;
  return `${normalized} missing`;
}

export function summarizeReleaseBlockers(value: string | null | undefined): PresentedBlocker {
  if (!value?.trim()) return { label: "Readiness check pending", detail: null };

  const blockerPattern = /(?:^|, )(?:Track "([^"]+)": ([^,]+)|([^,]+))/g;
  const blockers = [...value.matchAll(blockerPattern)].map((match) => ({
    subject: match[1] ?? null,
    reason: (match[2] ?? match[3]).trim(),
  }));
  const first = blockers[0];
  if (!first) return { label: "Readiness check pending", detail: null };
  const remaining = blockers.length - 1;
  return {
    label: missingLabel(first.reason),
    detail: first.subject
      ? `${first.subject}${remaining > 0 ? ` · ${remaining} more ${remaining === 1 ? "blocker" : "blockers"}` : ""}`
      : remaining > 0 ? `${remaining} more ${remaining === 1 ? "blocker" : "blockers"}` : null,
  };
}

const CATALOG_ISSUE_LABELS: Record<string, string> = {
  "Track missing audio": "Audio file missing",
  "Track missing ISRC": "ISRC missing",
  "Track missing work assignment": "Work assignment missing",
};

function humanizeSourceTable(sourceTable: string | null): string {
  const singular = sourceTable?.replace(/_+/g, " ").replace(/s$/, "").trim();
  if (!singular) return "Catalog item";
  return singular.charAt(0).toUpperCase() + singular.slice(1);
}

export function presentCatalogIssue(input: CatalogIssueInput): PresentedCatalogIssue {
  const quotedSubject = input.description?.match(/"([^"]+)"/)?.[1] ?? null;
  return {
    label: CATALOG_ISSUE_LABELS[input.title] ?? input.title,
    subject: quotedSubject,
    kind: humanizeSourceTable(input.sourceTable),
  };
}
