import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  artists,
  budget_categories,
  budget_line_items,
  budget_projects,
  funding_sources,
  grant_applications,
  grants,
  releases,
} from "../db/schema";
import { db } from "../lib/db";
import { computeLineEfc, classifyBudgetBucket, rollupBudgetCosts } from "./budget-efc-core";
import { getProjectFundingCoverage } from "./funding-coverage";
import { observeOperation } from "./observability";

export async function listBudgetGrantGuidance(orgId: string) {
  return db.select({
    id: grant_applications.id,
    project_id: grant_applications.project_id,
    workflow_stage: grant_applications.workflow_stage,
    name: grants.name,
    currency: grants.currency,
    amount_awarded: grant_applications.amount_awarded,
    reference: grant_applications.external_reference,
    purpose: grant_applications.response_notes,
    source_url: grant_applications.source_folder,
    notes: grant_applications.notes,
    next_action: grant_applications.next_action,
    reporting_due: grant_applications.reporting_due,
    project_name: budget_projects.name,
  }).from(grant_applications)
    .innerJoin(grants, and(eq(grants.id, grant_applications.grant_id), eq(grants.org_id, orgId)))
    .leftJoin(budget_projects, and(eq(budget_projects.id, grant_applications.project_id), eq(budget_projects.org_id, orgId)))
    .where(and(eq(grant_applications.org_id, orgId), inArray(grant_applications.outcome, ["approved", "partially_approved"])))
    .orderBy(asc(grant_applications.reporting_due), asc(grants.name));
}

// ─── Project listing ─────────────────────────────────────
export async function listBudgetProjects(orgId: string, releaseId?: string) {
  return db
    .select({
      id: budget_projects.id,
      name: budget_projects.name,
      project_type: budget_projects.project_type,
      status: budget_projects.status,
      currency: budget_projects.currency,
      total_planned: budget_projects.total_planned,
      baseline_funding: budget_projects.baseline_funding,
      track_count: budget_projects.track_count,
      singles_count: budget_projects.singles_count,
      artist_name: artists.name,
      release_title: releases.title,
      release_format: releases.format,
      cover_art_url: releases.cover_art_url,
    })
    .from(budget_projects)
    .leftJoin(artists, and(eq(budget_projects.artist_id, artists.id), eq(artists.org_id, orgId)))
    .leftJoin(releases, and(eq(budget_projects.release_id, releases.id), eq(releases.org_id, orgId)))
    .where(and(eq(budget_projects.org_id, orgId), releaseId ? sql`(${budget_projects.release_id} = ${releaseId} or exists (
      select 1 from label_suite.budget_line_items line
      where line.org_id = ${orgId} and line.project_id = ${budget_projects.id} and line.release_id = ${releaseId}
    ))` : undefined))
    .orderBy(asc(budget_projects.name));
}

// ─── Project header ──────────────────────────────────────
async function loadBudgetProject(orgId: string, projectId: string) {
  const rows = await db
    .select({
      id: budget_projects.id,
      name: budget_projects.name,
      status: budget_projects.status,
      currency: budget_projects.currency,
      total_planned: budget_projects.total_planned,
      baseline_funding: budget_projects.baseline_funding,
      track_count: budget_projects.track_count,
      singles_count: budget_projects.singles_count,
      notes: budget_projects.notes,
      artist_name: artists.name,
      release_title: releases.title,
      release_format: releases.format,
      cover_art_url: releases.cover_art_url,
    })
    .from(budget_projects)
    .leftJoin(artists, and(eq(budget_projects.artist_id, artists.id), eq(artists.org_id, orgId)))
    .leftJoin(releases, and(eq(budget_projects.release_id, releases.id), eq(releases.org_id, orgId)))
    .where(and(eq(budget_projects.id, projectId), eq(budget_projects.org_id, orgId)));
  return rows[0] ?? null;
}

export function getBudgetProject(orgId: string, projectId: string) {
  return observeOperation("budget.dashboard", orgId, () => loadBudgetProject(orgId, projectId));
}

// ─── All lines for a project ─────────────────────────────
export async function listBudgetLinesForProject(orgId: string, projectId: string) {
  const rows = await db
    .select({
      id: budget_line_items.id,
      name: budget_line_items.name,
      amount: budget_line_items.amount,
      planned_amount: budget_line_items.planned_amount,
      forecast_amount: budget_line_items.forecast_amount,
      committed_amount: budget_line_items.committed_amount,
      paid_amount: budget_line_items.paid_amount,
      phase: budget_line_items.phase,
      spend_month: budget_line_items.spend_month,
      status: budget_line_items.status,
      lock_status: budget_line_items.lock_status,
      eligibility_tag: budget_line_items.eligibility_tag,
      variance_reason: budget_line_items.variance_reason,
      category_id: budget_line_items.category_id,
      category_name: budget_categories.name,
      category_type: budget_categories.type,
      funding_source_id: budget_line_items.funding_source_id,
      funding_source_name: funding_sources.name,
    })
    .from(budget_line_items)
    .leftJoin(
      budget_categories,
      and(eq(budget_line_items.category_id, budget_categories.id), eq(budget_categories.org_id, orgId)),
    )
    .leftJoin(
      funding_sources,
      and(eq(budget_line_items.funding_source_id, funding_sources.id), eq(funding_sources.org_id, orgId)),
    )
    .where(and(eq(budget_line_items.project_id, projectId), eq(budget_line_items.org_id, orgId)))
    .orderBy(asc(budget_categories.type), asc(budget_line_items.phase));
  return rows.map((row) => ({ ...row, ...computeLineEfc({
    planned_amount: row.planned_amount,
    amount: row.amount,
    forecast_amount: row.forecast_amount,
    committed_amount: row.committed_amount,
    paid_amount: row.paid_amount,
  }) }));
}

// ─── Funding sources for a project ───────────────────────
export async function listFundingSources(orgId: string, projectId: string) {
  return db
    .select({
      id: funding_sources.id,
      project_id: funding_sources.project_id,
      name: funding_sources.name,
      type: funding_sources.type,
      status: funding_sources.status,
      amount_planned: funding_sources.amount_planned,
      amount_confirmed: funding_sources.amount_confirmed,
      restricted_to: funding_sources.restricted_to,
      funder: funding_sources.funder,
      deadline: funding_sources.deadline,
      reporting_required: funding_sources.reporting_required,
      notes: funding_sources.notes,
    })
    .from(funding_sources)
    .where(and(eq(funding_sources.project_id, projectId), eq(funding_sources.org_id, orgId)))
    .orderBy(asc(funding_sources.status), asc(funding_sources.amount_planned));
}

// ─── Bucket rollup (production / marketing / contingency) ─
export type BucketRollup = {
  bucket: "production" | "marketing" | "contingency";
  label: string;
  planned: number;
  forecast: number;
  committed: number;
  paid: number;
  efc: number;
  variance: number;
  remaining: number;
  item_count: number;
};

export async function getBucketRollup(orgId: string, projectId: string): Promise<BucketRollup[]> {
  const lines = await listBudgetLinesForProject(orgId, projectId);
  const rollup = rollupBudgetCosts(lines.map((line) => ({
    categoryType: line.category_type,
    lockStatus: line.lock_status,
    planned_amount: line.planned_amount,
    amount: line.amount,
    forecast_amount: line.forecast_amount,
    committed_amount: line.committed_amount,
    paid_amount: line.paid_amount,
  })));
  return (["production", "marketing", "contingency"] as const).map((bucket) => ({
    bucket,
    label: bucket === "contingency" ? "Contingency (locked)" : bucket[0].toUpperCase() + bucket.slice(1),
    ...rollup.buckets[bucket],
    remaining: rollup.buckets[bucket].planned - rollup.buckets[bucket].committed,
    item_count: lines.filter((line) => classifyBudgetBucket({ categoryType: line.category_type, lockStatus: line.lock_status }) === bucket).length,
  }));
}

// ─── Phase cashflow ──────────────────────────────────────
export type PhaseRow = {
  phase: string;
  label: string;
  month: string;
  planned: number;
  committed: number;
  paid: number;
};

const PHASE_LABELS: Record<string, { label: string; month: string }> = {
  pre_pro: { label: "Writing / Pre-pro", month: "T-6 to T-4" },
  recording: { label: "Recording", month: "T-4 to T-3" },
  post_pro: { label: "Post-production", month: "T-3 to T-2" },
  setup: { label: "Setup", month: "T-8 to T-6 weeks" },
  singles: { label: "Singles rollout", month: "T-6 weeks to release" },
  release_week: { label: "Release week", month: "T" },
  post_release: { label: "Post-release", month: "T+1 to T+8 weeks" },
};

export async function getPhaseCashflow(orgId: string, projectId: string): Promise<PhaseRow[]> {
  const rows = await db.execute<{
    phase: string;
    planned: number;
    committed: number;
    paid: number;
  }>(sql`
    select
      coalesce(bli.phase, 'unscheduled') as phase,
      coalesce(sum(bli.planned_amount), 0)::numeric as planned,
      coalesce(sum(bli.committed_amount), 0)::numeric as committed,
      coalesce(sum(bli.paid_amount), 0)::numeric as paid
    from label_suite.budget_line_items bli
    where bli.org_id = ${orgId} and bli.project_id = ${projectId}
    group by 1
  `);

  const phaseOrder = ["pre_pro", "recording", "post_pro", "setup", "singles", "release_week", "post_release"];
  const result: PhaseRow[] = phaseOrder.map((phase) => {
    const match = (rows.rows ?? []).find((r) => r.phase === phase);
    return {
      phase,
      label: PHASE_LABELS[phase].label,
      month: PHASE_LABELS[phase].month,
      planned: Number(match?.planned ?? 0),
      committed: Number(match?.committed ?? 0),
      paid: Number(match?.paid ?? 0),
    };
  });

  return result;
}

// ─── Calendar-month cashflow ─────────────────────────────
export type CalendarMonth = {
  month: string;     // "2026-09"
  label: string;     // "Sep 2026"
  planned: number;
  committed: number;
  paid: number;
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function getCalendarCashflow(orgId: string, projectId: string): Promise<CalendarMonth[]> {
  const rows = await db.execute<{
    month: string;
    planned: number;
    committed: number;
    paid: number;
  }>(sql`
    select
      bli.spend_month as month,
      coalesce(sum(bli.planned_amount), 0)::numeric as planned,
      coalesce(sum(bli.committed_amount), 0)::numeric as committed,
      coalesce(sum(bli.paid_amount), 0)::numeric as paid
    from label_suite.budget_line_items bli
    where bli.org_id = ${orgId} and bli.project_id = ${projectId}
      and bli.spend_month is not null
    group by 1
    order by 1
  `);

  return (rows.rows ?? []).map((r) => {
    const parts = r.month.split("-");
    const y = parts[0];
    const m = parseInt(parts[1], 10);
    return {
      month: r.month,
      label: `${MONTH_LABELS[m - 1] ?? m} ${y}`,
      planned: Number(r.planned),
      committed: Number(r.committed),
      paid: Number(r.paid),
    };
  });
}

// ─── KPI summary ─────────────────────────────────────────
export type BudgetKpi = {
  total_planned: number;
  baseline_funding: number;
  confirmed_funding: number;
  pending_funding: number;
  buffer_vs_plan: number;
  production_planned: number;
  marketing_planned: number;
  contingency_planned: number;
  contingency_locked: boolean;
  forecast_total: number;
  efc_total: number;
  committed_total: number;
  paid_total: number;
  remaining_total: number;
  budget_health: "green" | "yellow" | "red";
};

export async function getBudgetKpi(orgId: string, projectId: string): Promise<BudgetKpi> {
  const project = await getBudgetProject(orgId, projectId);
  const buckets = await getBucketRollup(orgId, projectId);
  const coverage = await getProjectFundingCoverage(orgId, projectId);

  const confirmedFunding = coverage?.confirmed ?? 0;
  const pendingFunding = coverage?.pipelineWeighted ?? 0;

  const production = buckets.find((b) => b.bucket === "production")!;
  const marketing = buckets.find((b) => b.bucket === "marketing")!;
  const contingency = buckets.find((b) => b.bucket === "contingency")!;

  const totalPlanned = coverage?.budgetTotal ?? (project?.total_planned ?? production.planned + marketing.planned + contingency.planned);
  const forecastTotal = production.efc + marketing.efc + contingency.efc;
  const committedTotal = production.committed + marketing.committed;
  const paidTotal = production.paid + marketing.paid;
  const remainingTotal = totalPlanned - committedTotal;
  const buffer = confirmedFunding - totalPlanned;

  let health: BudgetKpi["budget_health"] = "green";
  if (forecastTotal > confirmedFunding) health = "red";
  else if (forecastTotal > totalPlanned) health = "yellow";

  return {
    total_planned: totalPlanned,
    baseline_funding: project?.baseline_funding ?? 0,
    confirmed_funding: confirmedFunding,
    pending_funding: pendingFunding,
    buffer_vs_plan: buffer,
    production_planned: production.planned,
    marketing_planned: marketing.planned,
    contingency_planned: contingency.planned,
    contingency_locked: contingency.planned > 0,
    forecast_total: forecastTotal,
    efc_total: forecastTotal,
    committed_total: committedTotal,
    paid_total: paidTotal,
    remaining_total: remainingTotal,
    budget_health: health,
  };
}
