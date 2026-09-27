/**
 * Make every non-verified grant operationally usable without inventing facts.
 *
 * This is intentionally separate from the source-backed enrichment seed. It
 * fills the catalog gaps that came from Airtable/imported records while keeping
 * official verification explicit. Unknown eligibility, financing, payment, and
 * recurrence values are represented as null; no deadline or entity type is
 * inferred from a grant name or category.
 *
 * Usage:
 *   npx tsx scripts/seed-grant-operational-enrichment.ts --dry-run
 *   npx tsx scripts/seed-grant-operational-enrichment.ts --apply
 */
import { and, eq } from "drizzle-orm";
import { grants } from "../src/db/schema";
import { db } from "../src/lib/db";

export const OPERATIONAL_SCHEMA_VERSION = 1;
const ORG_ID = "true-nature";
const AIRTABLE_BASE_URL = "https://airtable.com/app26JltxTyf40Fcp/tblVsYYOlobq4Ih7p";
const VERIFICATION_NOTICE = "Official entity eligibility, commercial-use, financing, payment, and current-deadline rules still require verification.";
const REQUIREMENTS_NOTICE = "Verify current requirements on the official source before applying.";
const EMPTY_REQUIREMENTS_NOTICE = "Application requirements have not been captured yet; verify them on the official source before applying.";

type GrantRow = typeof grants.$inferSelect;

export interface OperationalGrantUpdate {
  research_source: string | null;
  research_summary: string;
  requirements: string;
  rules: string;
}

export interface OperationalPlanItem {
  id: string;
  name: string;
  fields: Array<{ field: keyof OperationalGrantUpdate; before: unknown; after: unknown }>;
}

export interface OperationalPlan {
  total: number;
  eligible: number;
  skippedVerified: number;
  unchanged: number;
  updates: OperationalPlanItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseLegacyRules(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sourceUrl(grant: GrantRow): string | null {
  const candidate = nonBlank(grant.research_source) ?? nonBlank(grant.url);
  return candidate?.startsWith("https://") ? candidate : null;
}

function airtableSource(grant: GrantRow): string | null {
  // Imported rows retain this marker in notes. It is useful provenance, but it
  // is not treated as an official verification source.
  const match = grant.notes?.match(/Airtable source:\s*(rec[a-zA-Z0-9]+)/i);
  return match ? `${AIRTABLE_BASE_URL}/${match[1]}` : null;
}

function valueOrNull(value: unknown): unknown {
  return value === undefined ? null : value;
}

function existingOrNull(existing: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(existing, key) ? existing[key] : null;
}

function buildRules(grant: GrantRow): Record<string, unknown> {
  const parsed = parseLegacyRules(grant.rules);
  const legacyRules = parsed ? null : nonBlank(grant.rules);
  const rules: Record<string, unknown> = parsed ? { ...parsed } : {};

  // Version/evidence metadata makes the distinction between imported facts and
  // researched facts visible to future consumers of the JSON contract.
  rules.schema_version = OPERATIONAL_SCHEMA_VERSION;
  rules.evidence_status = "needs_verification";
  rules.source_url = sourceUrl(grant) ?? airtableSource(grant);
  rules.source_type = sourceUrl(grant) ? "catalog_source_url" : "airtable_record";

  // Never infer these values. Existing structured values win; missing values
  // are explicit nulls so the UI can say “not confirmed” instead of “no”.
  for (const key of [
    "aps_eligible",
    "forening_eligible",
    "individual_eligible",
    "commercial_allowed",
    "revenue_generating_allowed",
    "co_financing_required",
    "self_financing_required",
    "in_kind_accepted",
  ]) {
    rules[key] = valueOrNull(existingOrNull(rules, key));
  }
  for (const key of [
    "payment_schedule",
    "payment_timing",
    "recurrence_type",
    "genre_restrictions",
    "career_stage",
    "geography",
    "restrictions",
    "contact_info",
  ]) {
    rules[key] = valueOrNull(existingOrNull(rules, key));
  }

  rules.applicant_type = grant.applicant_type ?? existingOrNull(rules, "applicant_type");
  rules.eligible_uses = grant.eligible_uses ?? existingOrNull(rules, "eligible_uses");
  rules.applicant_requirements = existingOrNull(rules, "applicant_requirements")
    ?? (grant.requirements && !grant.requirements.includes(REQUIREMENTS_NOTICE) && !grant.requirements.includes(EMPTY_REQUIREMENTS_NOTICE) ? grant.requirements : null);
  rules.assessment_criteria = grant.assessment_body ?? existingOrNull(rules, "assessment_criteria");
  rules.decision_timing = grant.response_timing ?? existingOrNull(rules, "decision_timing");
  rules.max_amount = grant.max_amount ?? existingOrNull(rules, "max_amount");
  rules.currency = grant.currency;
  rules.recurrence_notes = existingOrNull(rules, "recurrence_notes")
    ?? (grant.deadline
      ? `Existing catalog deadline ${grant.deadline} is historical; confirm the next round from the official source.`
      : "No verified recurrence pattern or current deadline is recorded; confirm the next round from the official source.");
  rules.playbook = existingOrNull(rules, "playbook") ?? null;
  if (legacyRules) rules.legacy_rules = legacyRules;
  return rules;
}

export function buildOperationalUpdate(grant: GrantRow): OperationalGrantUpdate {
  const source = sourceUrl(grant) ?? airtableSource(grant);
  const sourceLabel = source ? `Source recorded: ${source}.` : "No source URL is recorded.";
  const existingSummary = nonBlank(grant.research_summary);
  const observed: string[] = [];
  if (grant.funder) observed.push(`Funder: ${grant.funder}`);
  if (grant.max_amount != null) observed.push(`Maximum amount: ${grant.max_amount.toLocaleString("da-DK")} ${grant.currency}`);
  if (grant.applicant_type) observed.push(`Applicant field: ${grant.applicant_type}`);
  if (grant.eligible_uses) observed.push(`Eligible-use field: ${grant.eligible_uses}`);
  if (grant.response_timing) observed.push(`Response timing: ${grant.response_timing}`);
  const summary = existingSummary?.includes(VERIFICATION_NOTICE)
    ? existingSummary
    : [
      existingSummary ?? `Operational catalog record for ${grant.name}.`,
      observed.length ? observed.join(" ") : null,
      sourceLabel,
      VERIFICATION_NOTICE,
    ].filter(Boolean).join(" ");

  const requirementBlocks = [
    nonBlank(grant.requirements),
    grant.applicant_type ? `Who can apply: ${grant.applicant_type}` : null,
    grant.eligible_uses ? `What can be funded: ${grant.eligible_uses}` : null,
    grant.assessment_body ? `Assessment body: ${grant.assessment_body}` : null,
    grant.response_timing ? `Expected response: ${grant.response_timing}` : null,
  ].filter(Boolean) as string[];
  const requirements = nonBlank(grant.requirements)?.includes(REQUIREMENTS_NOTICE)
    || nonBlank(grant.requirements)?.includes(EMPTY_REQUIREMENTS_NOTICE)
    ? nonBlank(grant.requirements)!
    : requirementBlocks.length
    ? `${requirementBlocks.join("\n\n")}\n\n${REQUIREMENTS_NOTICE}`
    : EMPTY_REQUIREMENTS_NOTICE;

  return {
    research_source: grant.research_source ?? source,
    research_summary: summary,
    requirements,
    rules: JSON.stringify(buildRules(grant)),
  };
}

function sameValue(before: unknown, after: unknown): boolean {
  return JSON.stringify(before ?? null) === JSON.stringify(after ?? null);
}

export function planOperationalEnrichment(rows: GrantRow[]): OperationalPlan {
  const eligibleRows = rows.filter((row) => row.research_status !== "verified");
  const updates: OperationalPlanItem[] = [];
  let unchanged = 0;
  for (const grant of eligibleRows) {
    const next = buildOperationalUpdate(grant);
    const fields = (Object.keys(next) as Array<keyof OperationalGrantUpdate>)
      .filter((field) => !sameValue(grant[field], next[field]))
      .map((field) => ({ field, before: grant[field], after: next[field] }));
    if (fields.length) updates.push({ id: grant.id, name: grant.name, fields });
    else unchanged += 1;
  }
  return {
    total: rows.length,
    eligible: eligibleRows.length,
    skippedVerified: rows.length - eligibleRows.length,
    unchanged,
    updates,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const verbose = process.argv.includes("--verbose");
  const rows = await db.select().from(grants).where(eq(grants.org_id, ORG_ID));
  const plan = planOperationalEnrichment(rows);
  console.log(`${apply ? "[APPLY]" : "[DRY-RUN]"} Operational grant enrichment for ${ORG_ID}`);
  console.log(`Total: ${plan.total} | eligible: ${plan.eligible} | verified preserved: ${plan.skippedVerified} | unchanged: ${plan.unchanged} | updates: ${plan.updates.length}`);
  if (verbose) {
    for (const item of plan.updates) console.log(`  ${item.name}: ${item.fields.map((field) => field.field).join(", ")}`);
  }
  if (!apply || !plan.updates.length) return;

  await db.transaction(async (tx) => {
    for (const item of plan.updates) {
      const row = rows.find((candidate) => candidate.id === item.id);
      if (!row || row.research_status === "verified") throw new Error(`Grant changed during planning: ${item.id}`);
      const next = buildOperationalUpdate(row);
      await tx.update(grants).set({ ...next, updated_at: new Date() }).where(and(eq(grants.id, row.id), eq(grants.org_id, ORG_ID)));
    }
  });
  console.log(`Applied ${plan.updates.length} grant updates in one transaction.`);
}

const isMain = process.argv[1]?.includes("seed-grant-operational-enrichment");
if (isMain) main().catch((error) => { console.error("Fatal:", error); process.exit(1); });
