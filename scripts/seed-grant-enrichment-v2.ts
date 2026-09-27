/**
 * Safe grant enrichment seed — production-grade.
 *
 * Usage:
 *   npx tsx scripts/seed-grant-enrichment-v2.ts --dry-run     # report what would change
 *   npx tsx scripts/seed-grant-enrichment-v2.ts                # apply
 *   npx tsx scripts/seed-grant-enrichment-v2.ts --verbose      # show per-record details
 *
 * Matching (priority order):
 *   1. airtable_id → canonical record (from grants.source_record_id or name map)
 *   2. canonical_name → exact match only (no normalization, no substring)
 *   3. Exact case-insensitive name → single match only
 *   — Anything else → AMBIGUOUS (rejected)
 *
 * Safety:
 *   - Single DB transaction per org
 *   - Idempotent deadline upserts (deterministic id = sha256(org_id + grant_id + deadline_date))
 *   - Dry-run computes exact field diffs + planned deadline inserts
 *   - Input validation: URLs, ISO dates, amount ranges, deadline sequencing
 *   - Duplicate names in DB detected and reported (never silently overwritten)
 *   - Non-zero exit on any ambiguity, not-found, or validation failure
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { grants, grant_deadlines } from "../src/db/schema";
import { db } from "../src/lib/db";

// ═══════════════════════════════════════════════════════════
// Input schema — strict validation
// ═══════════════════════════════════════════════════════════

const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;
const strictIsoDate = z.string()
  .regex(isoDateRe, "date must be ISO date YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, "date must be a real calendar date");

const httpsUrl = z.string().url().refine((value) => value.startsWith("https://"), "URL must use https://");

const deadlineRoundSchema = z.object({
  deadline_date: strictIsoDate,
  deadline_time: z.string().optional(),
  timezone: z.string().default("Europe/Copenhagen"),
  label: z.string().optional(),
  opens_on: strictIsoDate.optional(),
  expected_response_date: strictIsoDate.optional(),
  classification: z.enum(["confirmed", "estimated"]),
  source_url: httpsUrl.optional(),
});

const playbookSchema = z.object({
  preparation_timeline: z.string(),
  required_assets: z.array(z.string()),
  common_traps: z.array(z.string()),
  tips: z.string(),
  owner: z.string(),
});

const enrichmentSchema = z.object({
  // Primary key for matching
  airtable_id: z.string().min(3, "airtable_id is required for auditability"),
  canonical_name: z.string().min(1, "canonical_name is required for reviewed matching"),

  // Identity
  name: z.string().min(1),
  funder: z.string().min(1),

  // Operational fields
  applicant_type: z.string(),
  eligible_uses: z.string(),
  applicant_requirements: z.string().optional(),
  co_financing_required: z.boolean(),
  self_financing_required: z.boolean(),
  in_kind_accepted: z.boolean(),
  payment_schedule: z.string(),
  payment_timing: z.string(),
  min_amount: z.number().min(0).nullable().optional(),
  max_amount: z.number().min(0).nullable(),
  currency: z.string(),
  total_pool: z.number().min(0).nullable().optional(),
  recurrence_type: z.string(),
  recurrence_notes: z.string(),
  decision_timing: z.string(),
  assessment_criteria: z.string(),
  restrictions: z.string(),
  official_url: httpsUrl.optional(),
  guidelines_url: httpsUrl.nullable().optional(),
  contact_info: z.string().optional(),

  // Research metadata
  verified: z.boolean(),
  last_verified_at: strictIsoDate,
  research_source: z.string().min(1),

  // Entity eligibility
  aps_eligible: z.boolean(),
  forening_eligible: z.boolean(),
  individual_eligible: z.boolean(),
  commercial_allowed: z.boolean(),
  revenue_generating_allowed: z.boolean(),
  genre_restrictions: z.string(),
  career_stage: z.string(),
  geography: z.string(),

  // Structured deadline rounds
  deadline_rounds: z.array(deadlineRoundSchema).optional(),

  // Playbook
  playbook: playbookSchema.optional(),
}).strict();

type EnrichmentInput = z.infer<typeof enrichmentSchema>;

// ═══════════════════════════════════════════════════════════
// Result types
// ═══════════════════════════════════════════════════════════

interface FieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

interface PlannedUpdate {
  grantId: string;
  grantName: string;
  airtableId: string;
  fields: FieldDiff[];
}

interface PlannedDeadline {
  deterministicId: string;
  grantId: string;
  deadlineDate: string;
  label: string | null;
  classification: "confirmed" | "estimated";
  sourceUrl: string | null;
  deadlineTime: string | null;
  timezone: string;
  opensOn: string | null;
  expectedResponseDate: string | null;
  existingId: string | null;
  action: "insert" | "update" | "unchanged";
}

interface EnrichmentReport {
  mode: "dry-run" | "apply";
  updated: PlannedUpdate[];
  skipped: string[];
  ambiguous: Array<{ airtableId: string; inputName: string; candidates: string[] }>;
  notFound: Array<{ airtableId: string; inputName: string }>;
  duplicateNames: Array<{ name: string; ids: string[] }>;
  deadlinesPlanned: PlannedDeadline[];
  deadlinesCreated: number;
  deadlinesUpdated: number;
  deadlinesRemoved: string[];
  validationErrors: string[];
  errors: string[];
}

// ═══════════════════════════════════════════════════════════
// Matching
// ═══════════════════════════════════════════════════════════

async function buildGrantIndex(orgId: string): Promise<{
  byId: Map<string, string>;        // airtable source_record_id → grant.id
  byName: Map<string, string>;      // exact lowercased name → grant.id
  duplicateNames: Array<{ name: string; ids: string[] }>;
}> {
  const rows = await db
    .select({ id: grants.id, name: grants.name })
    .from(grants)
    .where(eq(grants.org_id, orgId));

  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  const nameCollisions = new Map<string, string[]>();

  // The grants table does not currently carry Airtable's source_record_id. Every
  // enrichment row therefore requires a reviewed canonical_name mapping; the
  // Airtable ID remains audit metadata until that source column exists.

  for (const row of rows) {
    const norm = row.name.toLowerCase().trim();
    if (byName.has(norm)) {
      const existing = nameCollisions.get(norm) ?? [byName.get(norm)!];
      existing.push(row.id);
      nameCollisions.set(norm, existing);
    } else {
      byName.set(norm, row.id);
    }
  }

  const duplicateNames = [...nameCollisions.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => ({ name, ids: [...new Set(ids)] }));

  // Remove colliding entries from byName (they are ambiguous)
  for (const [name] of nameCollisions) {
    byName.delete(name);
  }

  return { byId, byName, duplicateNames };
}

function matchGrant(
  input: EnrichmentInput,
  index: { byId: Map<string, string>; byName: Map<string, string> },
): { status: "exact_id" | "exact_name" | "ambiguous" | "not_found"; grantId?: string; candidates?: string[] } {
  // 1. Airtable ID match (when source_record_id is populated)
  const idMatch = index.byId.get(input.airtable_id);
  if (idMatch) return { status: "exact_id", grantId: idMatch };

  // 2. Reviewed canonical name match only. Never fall back to a fuzzy/input
  // name because that can silently enrich the wrong imported record.
  const canonical = input.canonical_name.toLowerCase().trim();
  const match = index.byName.get(canonical);
  if (match) return { status: "exact_name", grantId: match };

  return { status: "not_found" };
}

// ═══════════════════════════════════════════════════════════
// Deterministic deadline ID
// ═══════════════════════════════════════════════════════════

function deadlineId(orgId: string, grantId: string, deadlineDate: string): string {
  return createHash("sha256")
    .update(`${orgId}:${grantId}:${deadlineDate}`)
    .digest("hex")
    .slice(0, 32); // 128-bit hex → fits in text column
}

type DeadlineRoundInput = Pick<NonNullable<EnrichmentInput["deadline_rounds"]>[number],
  "deadline_date" | "deadline_time" | "timezone" | "label" | "opens_on" | "expected_response_date" | "classification" | "source_url">;

type ExistingDeadline = {
  id: string;
  deadline_date: string;
  label: string | null;
  classification: string | null;
  source_url: string | null;
  deadline_time: string | null;
  timezone: string | null;
  opens_on: string | null;
  expected_response_date: string | null;
};

export function planDeadlineRounds(
  orgId: string,
  grantId: string,
  rounds: DeadlineRoundInput[],
  existing: ExistingDeadline[],
): PlannedDeadline[] {
  return rounds.map((round) => {
    const current = existing.find((row) => row.deadline_date === round.deadline_date) ?? null;
    const planned = {
      deterministicId: current?.id ?? deadlineId(orgId, grantId, round.deadline_date),
      grantId,
      deadlineDate: round.deadline_date,
      label: round.label ?? null,
      classification: round.classification,
      sourceUrl: round.source_url ?? null,
      deadlineTime: round.deadline_time ?? null,
      timezone: round.timezone,
      opensOn: round.opens_on ?? null,
      expectedResponseDate: round.expected_response_date ?? null,
      existingId: current?.id ?? null,
      action: "insert" as const,
    };

    if (!current) return planned;
    const unchanged = current.label === planned.label
      && (current.classification ?? "confirmed") === planned.classification
      && current.source_url === planned.sourceUrl
      && current.deadline_time === planned.deadlineTime
      && (current.timezone ?? "Europe/Copenhagen") === planned.timezone
      && current.opens_on === planned.opensOn
      && current.expected_response_date === planned.expectedResponseDate;
    return { ...planned, action: unchanged ? "unchanged" as const : "update" as const };
  });
}

export function canApplyEnrichmentReport(report: Pick<EnrichmentReport, "ambiguous" | "notFound" | "validationErrors" | "errors">): boolean {
  return report.ambiguous.length === 0
    && report.notFound.length === 0
    && report.validationErrors.length === 0
    && report.errors.length === 0;
}

// ═══════════════════════════════════════════════════════════
// Field diff computation
// ═══════════════════════════════════════════════════════════

function computeFieldDiffs(
  current: Record<string, unknown>,
  updates: Record<string, unknown>,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const skipFields = new Set(["updated_at", "created_at"]);
  for (const [key, after] of Object.entries(updates)) {
    if (skipFields.has(key)) continue;
    const before = current[key] ?? null;
    const afterVal = after ?? null;
    const beforeStr = JSON.stringify(before);
    const afterStr = JSON.stringify(afterVal);
    if (beforeStr !== afterStr) {
      diffs.push({ field: key, before, after: afterVal });
    }
  }
  return diffs;
}

export function buildRequirements(
  existing: string | null | undefined,
  restrictions: string,
  applicantRequirements: string | null | undefined,
): string {
  const enriched = [applicantRequirements, restrictions].filter(Boolean).join("\n\n");
  if (!existing) return enriched;
  // Airtable imports often contain the full application instructions. Keep that
  // richer source instead of replacing it with the shorter enrichment summary.
  return existing.length >= enriched.length ? existing : enriched;
}

function grantsUpdateFromEnrichment(input: EnrichmentInput, existingRequirements?: string | null): Record<string, unknown> {
  return {
    funder: input.funder,
    applicant_type: input.applicant_type,
    eligible_uses: input.eligible_uses,
    assessment_body: input.assessment_criteria,
    response_timing: input.decision_timing,
    url: input.official_url ?? null,
    research_url: input.guidelines_url ?? null,
    research_status: input.verified ? "verified" : "research",
    research_summary: buildSummary(input),
    research_source: input.research_source,
    last_verified_at: input.last_verified_at,
    max_amount: input.max_amount,
    currency: input.currency,
    requirements: buildRequirements(existingRequirements, input.restrictions, input.applicant_requirements),
    rules: JSON.stringify(buildRules(input)),
    updated_at: new Date(),
  };
}

function buildSummary(input: EnrichmentInput): string {
  const parts: string[] = [];
  parts.push(`Source: ${input.research_source}`);
  parts.push(`Max: ${input.max_amount?.toLocaleString("da-DK") ?? "unspecified"} ${input.currency}`);
  parts.push(`Deadline: ${input.recurrence_notes}`);
  parts.push(`Eligible: ${[
    input.aps_eligible ? "ApS" : "",
    input.forening_eligible ? "forening" : "",
    input.individual_eligible ? "individual" : "",
  ].filter(Boolean).join(", ") || "see requirements"}`);

  if (input.applicant_requirements) {
    parts.push(`Requirements: ${input.applicant_requirements}`);
  }
  return parts.join(" | ");
}

function buildRules(input: EnrichmentInput): Record<string, unknown> {
  return {
    aps_eligible: input.aps_eligible,
    forening_eligible: input.forening_eligible,
    individual_eligible: input.individual_eligible,
    commercial_allowed: input.commercial_allowed,
    revenue_generating_allowed: input.revenue_generating_allowed,
    genre_restrictions: input.genre_restrictions,
    career_stage: input.career_stage,
    geography: input.geography,
    co_financing_required: input.co_financing_required,
    self_financing_required: input.self_financing_required,
    in_kind_accepted: input.in_kind_accepted,
    payment_schedule: input.payment_schedule,
    payment_timing: input.payment_timing,
    min_amount: input.min_amount ?? null,
    total_pool: input.total_pool ?? null,
    contact_info: input.contact_info ?? null,
    recurrence_type: input.recurrence_type,
    recurrence_notes: input.recurrence_notes,
    applicant_requirements: input.applicant_requirements ?? null,
    playbook: input.playbook ?? null,
  };
}

// ═══════════════════════════════════════════════════════════
// Core enrichment
// ═══════════════════════════════════════════════════════════

export async function enrichGrants(
  orgId: string,
  enrichments: EnrichmentInput[],
  options: { dryRun?: boolean; verbose?: boolean } = {},
): Promise<EnrichmentReport> {
  const { dryRun = false, verbose = false } = options;

  const report: EnrichmentReport = {
    mode: dryRun ? "dry-run" : "apply",
    updated: [],
    skipped: [],
    ambiguous: [],
    notFound: [],
    duplicateNames: [],
    deadlinesPlanned: [],
    deadlinesCreated: 0,
    deadlinesUpdated: 0,
    deadlinesRemoved: [],
    validationErrors: [],
    errors: [],
  };

  // ── Validate inputs ──────────────────────────────────
  const valid: EnrichmentInput[] = [];
  for (let i = 0; i < enrichments.length; i++) {
    const result = enrichmentSchema.safeParse(enrichments[i]);
    if (result.success) {
      // Cross-field validation
      const errs = validateCrossFields(result.data);
      if (errs.length) {
        report.validationErrors.push(`[${result.data.airtable_id}] ${errs.join("; ")}`);
        continue;
      }
      valid.push(result.data);
    } else {
      report.validationErrors.push(
        `[${(enrichments[i] as any).airtable_id ?? `index ${i}`}] ${result.error.message}`,
      );
    }
  }

  if (report.validationErrors.length) {
    report.errors.push(`${report.validationErrors.length} validation failures`);
    return report;
  }

  // ── Build index ──────────────────────────────────────
  const { byId, byName, duplicateNames } = await buildGrantIndex(orgId);
  report.duplicateNames = duplicateNames;

  if (duplicateNames.length && verbose) {
    console.log(`⚠️  ${duplicateNames.length} duplicate DB names detected (ambiguous):`);
    for (const dup of duplicateNames) {
      console.log(`  "${dup.name}" → ${dup.ids.length} records`);
    }
  }

  // ── Match and plan ───────────────────────────────────
  const planned: Array<{ input: EnrichmentInput; grantId: string; grantName: string }> = [];

  for (const input of valid) {
    const match = matchGrant(input, { byId, byName });

    if (match.status === "not_found") {
      report.notFound.push({ airtableId: input.airtable_id, inputName: input.name });
      if (verbose) console.log(`  ❓ NOT FOUND: [${input.airtable_id}] ${input.name}`);
      continue;
    }

    if (match.status === "ambiguous") {
      report.ambiguous.push({
        airtableId: input.airtable_id,
        inputName: input.name,
        candidates: match.candidates ?? [],
      });
      if (verbose) console.log(`  ⚠️  AMBIGUOUS: [${input.airtable_id}] ${input.name}`);
      continue;
    }

    planned.push({ input, grantId: match.grantId!, grantName: input.name });
  }

  // ── Compute diffs and reconcile deadlines ─────────────
  const grantIds = planned.map((item) => item.grantId);
  const existingDeadlineRows = grantIds.length
    ? await db.select().from(grant_deadlines).where(and(
      eq(grant_deadlines.org_id, orgId),
      inArray(grant_deadlines.grant_id, grantIds),
    ))
    : [];
  const deadlinesByGrant = new Map<string, ExistingDeadline[]>();
  for (const row of existingDeadlineRows) {
    const rows = deadlinesByGrant.get(row.grant_id) ?? [];
    rows.push(row as ExistingDeadline);
    deadlinesByGrant.set(row.grant_id, rows);
  }

  const grantWrites = new Map<string, Record<string, unknown>>();
  for (const { input, grantId } of planned) {
    // Fetch current state
    const current = await db
      .select()
      .from(grants)
      .where(and(eq(grants.id, grantId), eq(grants.org_id, orgId)))
      .limit(1);

    if (!current.length) {
      report.errors.push(`Grant ${grantId} disappeared during enrichment`);
      continue;
    }

    const updates = grantsUpdateFromEnrichment(input, current[0].requirements);
    const diffs = computeFieldDiffs(current[0] as Record<string, unknown>, updates);

    if (!diffs.length) {
      report.skipped.push(`${input.airtable_id}: ${input.name} (unchanged)`);
      if (verbose) console.log(`  ⏭️  SKIP: [${input.airtable_id}] ${input.name} (no changes)`);
    } else {
      const plannedUpdate: PlannedUpdate = {
        grantId,
        grantName: input.name,
        airtableId: input.airtable_id,
        fields: diffs,
      };
      report.updated.push(plannedUpdate);
      grantWrites.set(grantId, updates);
    }

    // Deadline reconciliation is independent of scalar grant-field changes.
    const existing = deadlinesByGrant.get(grantId) ?? [];
    const rounds = input.deadline_rounds ?? [];
    const deadlinePlan = planDeadlineRounds(orgId, grantId, rounds, existing);
    report.deadlinesPlanned.push(...deadlinePlan.filter((item) => item.action !== "unchanged"));

    // Rolling deadlines from older seed versions were stored as dated rows.
    // Remove only those clearly marked seed-generated placeholders.
    const incomingDates = new Set(rounds.map((round) => round.deadline_date));
    for (const row of existing) {
      if (row.label?.startsWith("Rolling —") && !incomingDates.has(row.deadline_date)) {
        report.deadlinesRemoved.push(row.id);
      }
    }
  }

  if (report.ambiguous.length || report.notFound.length) {
    report.errors.push(
      `${report.ambiguous.length} ambiguous + ${report.notFound.length} not found — cannot proceed`,
    );
  }

  // Never write a partial batch. Validation and match blockers are checked
  // before opening the transaction.
  if (!dryRun && !canApplyEnrichmentReport(report)) return report;

  // ── Apply (or not) ───────────────────────────────────
  if (!dryRun) {
    await db.transaction(async (tx) => {
      for (const update of report.updated) {
        const data = grantWrites.get(update.grantId)!;
        data.updated_at = new Date();

        await tx
          .update(grants)
          .set(data as any)
          .where(and(eq(grants.id, update.grantId), eq(grants.org_id, orgId)));
      }

      for (const dl of report.deadlinesPlanned) {
        await tx
          .insert(grant_deadlines)
          .values({
            id: dl.deterministicId,
            org_id: orgId,
            grant_id: dl.grantId,
            deadline_date: dl.deadlineDate,
            label: dl.label,
            opens_on: dl.opensOn,
            expected_response_date: dl.expectedResponseDate,
            classification: dl.classification,
            source_url: dl.sourceUrl,
            deadline_time: dl.deadlineTime,
            timezone: dl.timezone,
            status: "planned",
          })
          .onConflictDoUpdate({
            target: [grant_deadlines.org_id, grant_deadlines.grant_id, grant_deadlines.deadline_date],
            set: {
              label: dl.label,
              opens_on: dl.opensOn,
              expected_response_date: dl.expectedResponseDate,
              classification: dl.classification,
              source_url: dl.sourceUrl,
              deadline_time: dl.deadlineTime,
              timezone: dl.timezone,
              updated_at: new Date(),
            },
          });
      }
      if (report.deadlinesRemoved.length) {
        await tx.delete(grant_deadlines).where(inArray(grant_deadlines.id, report.deadlinesRemoved));
      }
      report.deadlinesCreated = report.deadlinesPlanned.filter((item) => item.action === "insert").length;
      report.deadlinesUpdated = report.deadlinesPlanned.filter((item) => item.action === "update").length;
    });
  }

  return report;
}

// ═══════════════════════════════════════════════════════════
// Cross-field validation
// ═══════════════════════════════════════════════════════════

function validateCrossFields(input: EnrichmentInput): string[] {
  const errs: string[] = [];

  // Amount range
  if (input.min_amount != null && input.max_amount != null && input.min_amount > input.max_amount) {
    errs.push(`min_amount (${input.min_amount}) > max_amount (${input.max_amount})`);
  }

  // Deadline sequencing
  if (input.deadline_rounds) {
    for (let i = 0; i < input.deadline_rounds.length; i++) {
      const round = input.deadline_rounds[i];
      if (round.opens_on && round.deadline_date < round.opens_on) {
        errs.push(`deadline_round[${i}]: deadline_date (${round.deadline_date}) before opens_on (${round.opens_on})`);
      }
      if (round.expected_response_date && round.expected_response_date < round.deadline_date) {
        errs.push(`deadline_round[${i}]: expected_response_date (${round.expected_response_date}) before deadline_date (${round.deadline_date})`);
      }
      if (round.classification === "confirmed" && !round.source_url) {
        errs.push(`deadline_round[${i}]: confirmed deadline requires source_url`);
      }
    }
  }

  // Entity eligibility sanity
  if (!input.aps_eligible && !input.forening_eligible && !input.individual_eligible) {
    errs.push("at least one entity type must be eligible");
  }

  return errs;
}

// ═══════════════════════════════════════════════════════════
// CLI entrypoint
// ═══════════════════════════════════════════════════════════

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const verbose = process.argv.includes("--verbose");

  // Load enrichment data
  const dataPath = process.env.GRANT_ENRICHMENT_DATA;
  if (!dataPath) throw new Error("GRANT_ENRICHMENT_DATA must point to a private enrichment JSON file");
  const raw = JSON.parse(await readFile(dataPath, "utf8"));
  const enrichments = raw.grants as EnrichmentInput[];

  const label = dryRun ? "[DRY-RUN]" : "[APPLY]";
  console.log(`${label} Processing ${enrichments.length} enrichments for org 'true-nature'...\n`);

  const orgId = "true-nature";
  const report = await enrichGrants(orgId, enrichments, { dryRun, verbose });

  // Print per-record diffs
  if (verbose && report.updated.length) {
    console.log("\n─ Field changes ─");
    for (const u of report.updated) {
      console.log(`\n[${u.airtableId}] ${u.grantName}`);
      for (const d of u.fields) {
        console.log(`  ${d.field}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`);
      }
    }
  }

  // Summary
  console.log(`\n═══════════════════════════════════════`);
  console.log(`  Mode:        ${report.mode}`);
  console.log(`  Updated:     ${report.updated.length}`);
  console.log(`  Skipped:     ${report.skipped.length}`);
  console.log(`  Ambiguous:   ${report.ambiguous.length}`);
  console.log(`  Not found:   ${report.notFound.length}`);
  console.log(`  Deadlines:   ${report.deadlinesPlanned.length} changed (${report.deadlinesPlanned.filter((item) => item.action === "insert").length} inserts, ${report.deadlinesPlanned.filter((item) => item.action === "update").length} updates)`);
  console.log(`  Removed:     ${report.deadlinesRemoved.length}`);
  console.log(`  Duplicates:  ${report.duplicateNames.length} name collisions`);
  console.log(`  Validation:  ${report.validationErrors.length} errors`);
  console.log(`═══════════════════════════════════════`);

  // Errors detail
  if (report.validationErrors.length) {
    console.log(`\n❌ Validation errors:`);
    for (const e of report.validationErrors) console.log(`  ${e}`);
  }

  if (report.ambiguous.length) {
    console.log(`\n⚠️  Ambiguous matches (manual review required):`);
    for (const a of report.ambiguous) {
      console.log(`  [${a.airtableId}] "${a.inputName}" — candidates: ${a.candidates.join(", ")}`);
    }
  }

  if (report.notFound.length) {
    console.log(`\n❓ Not found in database:`);
    for (const n of report.notFound) {
      console.log(`  [${n.airtableId}] ${n.inputName}`);
    }
  }

  if (report.duplicateNames.length) {
    console.log(`\n🔀 Duplicate name collisions in DB (preserved as ambiguous):`);
    for (const d of report.duplicateNames) {
      console.log(`  "${d.name}" → ${d.ids.length} records`);
    }
  }

  if (report.errors.length) {
    console.log(`\n🚫 Blockers:`);
    for (const e of report.errors) console.log(`  ${e}`);
    process.exit(1);
  }
}

// Only run CLI when executed directly, not when imported
const isMain = process.argv[1]?.includes("seed-grant-enrichment-v2");

if (isMain) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(2);
  });
}
