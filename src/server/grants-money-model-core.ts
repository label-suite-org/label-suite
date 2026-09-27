export type LegacyFundingSource = {
  id: string;
  type?: string | null;
  project_id?: string | null;
  name?: string | null;
  funder?: string | null;
  status?: string | null;
  amount_planned?: number | string | null;
  grant_amount_received?: number | string | null;
  application_date?: string | null;
  decision_date?: string | null;
  grant_reporting_due?: string | null;
};

export type MigratedGrantApplication = {
  id: string;
  project_id: string | null;
  grant_id: null;
  funding_source_id: string;
  status: string;
  priority: "medium";
  workflow_stage: "idea" | "research" | "submitted" | "reporting" | "closed";
  outcome: "unknown" | "approved" | "rejected";
  amount_requested: number | null;
  amount_awarded: number | null;
  submission_deadline: null;
  submitted_at: string | null;
  decision_date: string | null;
  reporting_due: string | null;
  next_action: string | null;
  next_action_due: string | null;
  notes: string;
};

export type AwardedApplication = {
  project_currency?: string | null;
  project_id: string;
  amount_awarded?: number | string | null;
  reporting_due?: string | null;
};

export type AwardGrant = {
  currency?: string | null; name?: string | null; funder?: string | null };
export type ExistingFundingSource = { name?: string | null; funder?: string | null };

export function isAwardedOutcome(outcome: unknown): boolean {
  return outcome === "approved" || outcome === "partially_approved";
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isGrantLifecycleSource(source: LegacyFundingSource): boolean {
  if (String(source.type ?? "").toLowerCase() !== "grant") return false;
  return Boolean(source.application_date || source.decision_date || source.grant_reporting_due || source.grant_amount_received);
}

export function inferMigratedGrantApplication(source: LegacyFundingSource): MigratedGrantApplication | null {
  if (!isGrantLifecycleSource(source)) return null;

  const status = String(source.status ?? "").toLowerCase();
  const awarded = numberOrNull(source.grant_amount_received);
  const requested = numberOrNull(source.amount_planned);
  const outcome = ["granted", "awarded", "confirmed"].includes(status)
    ? "approved"
    : status === "rejected" ? "rejected" : "unknown";
  const workflow_stage = outcome === "rejected"
    ? "closed"
    : outcome === "approved"
      ? source.grant_reporting_due ? "reporting" : "closed"
      : status === "research" ? "research" : source.application_date ? "submitted" : "idea";

  return {
    id: `legacy-grant-application-${source.id}`,
    project_id: source.project_id ?? null,
    grant_id: null,
    funding_source_id: source.id,
    status: source.application_date ? "submitted" : status || "draft",
    priority: "medium",
    workflow_stage,
    outcome,
    amount_requested: requested,
    amount_awarded: outcome === "approved" ? awarded : null,
    submission_deadline: null,
    submitted_at: source.application_date ?? null,
    decision_date: source.decision_date ?? null,
    reporting_due: source.grant_reporting_due ?? null,
    next_action: outcome === "approved" && source.grant_reporting_due ? "Submit funder report" : null,
    next_action_due: null,
    notes: `Migrated from legacy funding source ${source.id}.`,
  };
}

export function buildAwardedFundingSourceValues(
  application: AwardedApplication,
  grant: AwardGrant,
  existing: ExistingFundingSource | null,
) {
  if ((application.project_currency ?? "DKK").toUpperCase() !== (grant.currency ?? "DKK").toUpperCase()) return null;
  const amount = numberOrNull(application.amount_awarded) ?? 0;
  return {
    project_id: application.project_id,
    name: existing?.name ?? grant.name ?? "Grant award",
    type: "grant" as const,
    status: "confirmed" as const,
    amount_planned: amount,
    amount_confirmed: amount,
    funder: existing?.funder ?? grant.funder ?? null,
    reporting_required: application.reporting_due ? 1 : 0,
  };
}
