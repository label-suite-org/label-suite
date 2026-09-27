export type ApplicationWritingGuideBlock = { title: string; source: string; content: string; status: "ready" | "pending" | "failed" | "empty" };

export type ApplicationChecklistGuidanceItem = {
  requirementName?: string | null;
  documentName?: string | null;
  assetRole?: string | null;
  required?: boolean;
  readinessStatus?: string | null;
};

export function buildApplicationWritingGuide(
  application: Record<string, unknown> | null | undefined,
  grant: Record<string, unknown> | null | undefined,
  documentRows: Array<{ name: string; asset_role: string; readiness_status: string; extraction_status: string | null; extracted_text_preview: string | null; extraction_error: string | null }>,
  checklist: ApplicationChecklistGuidanceItem[] = [],
): ApplicationWritingGuideBlock[] {
  const value = (source: Record<string, unknown> | null | undefined, snake: string, camel = snake) => String(source?.[snake] ?? source?.[camel] ?? "").trim();
  const block = (title: string, source: string, content: string): ApplicationWritingGuideBlock => ({ title, source, content: content || "Not recorded", status: content ? "ready" : "empty" });
  const blocks: ApplicationWritingGuideBlock[] = [
    block("Grant requirements", "Grant record: requirements", value(grant, "requirements")),
    block("Eligible uses", "Grant record: eligible uses", value(grant, "eligible_uses", "eligibleUses")),
    block("Application angle", "Application record: angle narrative", value(application, "angle_narrative", "angleNarrative")),
    block("Response notes", "Application record: response notes", value(application, "response_notes", "responseNotes")),
    block("Evaluation", "Application record: evaluation", value(application, "evaluation")),
  ];
  const submitted = documentRows.filter((document) => document.asset_role === "submitted_application");
  const extracted = submitted.filter((document) => document.extraction_status === "ready" && document.extracted_text_preview);
  const failed = documentRows.filter((document) => document.extraction_status === "failed");
  const pending = documentRows.filter((document) => !document.extraction_status || document.extraction_status === "pending");
  const evidenceLines = extracted.map((document) => `${document.name}: ${document.extracted_text_preview}`).join("\n\n");
  blocks.push({ title: "Submitted application evidence", source: extracted.length ? extracted.map((document) => document.name).join(", ") : "Linked application documents", content: evidenceLines || "No extracted submitted-application text yet.", status: extracted.length ? "ready" : failed.length || pending.length ? (failed.length ? "failed" : "pending") : "empty" });
  const missingChecklist = checklist
    .filter((item) => item.required !== false && (item.readinessStatus === "missing" || item.readinessStatus === "stale"))
    .map((item) => `${item.requirementName || item.documentName || item.assetRole || "Application material"}: ${item.readinessStatus}`);
  const missing = [
    ...missingChecklist,
    ...documentRows.filter((document) => document.readiness_status === "missing" || document.readiness_status === "stale").map((document) => `${document.name}: ${document.readiness_status}`),
    ...failed.map((document) => `${document.name}: extraction failed${document.extraction_error ? ` (${document.extraction_error})` : ""}`),
    ...pending.map((document) => `${document.name}: extraction pending`),
  ];
  blocks.push({ title: "Missing evidence", source: missingChecklist.length ? "Application checklist and linked application documents" : "Linked application documents", content: missing.length ? missing.join("\n") : "No missing evidence recorded.", status: missing.length ? (failed.length ? "failed" : "pending") : "ready" });
  return blocks;
}
