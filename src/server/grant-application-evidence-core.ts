export const MXD_FUNDER = "mxd";
export const MXD_GRANT_NAME = "støtte til markedsudvikling";
export const MXD_AWARDED_AMOUNT = 7500;
export const MXD_NEXT_ACTION = "Document expenses";

export type MxdApplicationCandidate = {
  id: string;
  grantId?: string | null;
  grantName: string | null;
  funder: string | null;
  currency?: string | null;
  outcome: string | null;
  amountAwarded: number | null;
  amountRequested?: number | null;
  submittedAt?: string | Date | null;
  decisionDate?: string | Date | null;
  nextActionDue?: string | Date | null;
  reportingDue?: string | Date | null;
  nextAction: string | null;
};

export type MxdExpenseFollowUpPlan =
  | { status: "not_found"; candidates: MxdApplicationCandidate[] }
  | { status: "ambiguous"; candidates: MxdApplicationCandidate[] }
  | { status: "already_set"; application: MxdApplicationCandidate }
  | { status: "update"; application: MxdApplicationCandidate; nextAction: typeof MXD_NEXT_ACTION };

const normalize = (value: string | null | undefined) => value?.trim().toLocaleLowerCase("da-DK") ?? "";

export function buildMxdExpenseFollowUpPlan(rows: MxdApplicationCandidate[]): MxdExpenseFollowUpPlan {
  const candidates = rows.filter((row) =>
    normalize(row.funder) === MXD_FUNDER
    && normalize(row.grantName) === MXD_GRANT_NAME
    && normalize(row.outcome) === "approved"
    && row.amountAwarded === MXD_AWARDED_AMOUNT,
  );
  if (!candidates.length) return { status: "not_found", candidates: [] };
  if (candidates.length !== 1) return { status: "ambiguous", candidates };
  const application = candidates[0];
  if (normalize(application.nextAction) === normalize(MXD_NEXT_ACTION)) return { status: "already_set", application };
  return { status: "update", application, nextAction: MXD_NEXT_ACTION };
}

export function canApplyMxdExpenseFollowUp(before: MxdExpenseFollowUpPlan, current: MxdApplicationCandidate): boolean {
  if (before.status !== "update" || before.application.id !== current.id) return false;
  if (before.application.grantId !== current.grantId) return false;
  return buildMxdExpenseFollowUpPlan([current]).status === "update";
}

export function buildMxdExpenseFollowUpUpdate(current: MxdApplicationCandidate): { next_action: typeof MXD_NEXT_ACTION } | null {
  return buildMxdExpenseFollowUpPlan([current]).status === "update" ? { next_action: MXD_NEXT_ACTION } : null;
}
