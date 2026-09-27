import type { CampaignActivitySnapshot } from "../../server/campaign-activity-core";

export type CampaignActivityDecision = {
  proposal_key: string;
  decision: "dismissed" | "resolved";
  reason: string | null;
};

export type CampaignActivityWorkflowAction =
  | "activity-decision"
  | "approve"
  | "dogfood"
  | "draft"
  | "generate"
  | "notice"
  | "preparation"
  | "prompt"
  | "record"
  | "stage"
  | "suggestion";

export type CampaignActivityInteractionState = {
  snapshot: CampaignActivitySnapshot;
  busyAction: CampaignActivityWorkflowAction | null;
  pending: boolean;
  notice: string | null;
  feedback: string | null;
};

type CampaignActivityDecisionResult = "stale" | void;
type CampaignActivityRefreshResult = "updated" | "failed" | "stale";

type CampaignActivityAdapter = {
  decide(input: CampaignActivityDecision): Promise<CampaignActivitySnapshot>;
  refresh(): Promise<CampaignActivitySnapshot>;
};

type CampaignActivityFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function createCampaignActivityInteraction({
  initialSnapshot,
  adapter,
}: {
  initialSnapshot: CampaignActivitySnapshot;
  adapter: CampaignActivityAdapter;
}) {
  let activityGeneration = 0;
  let workflowGeneration = 0;
  let state: CampaignActivityInteractionState = {
    snapshot: initialSnapshot,
    busyAction: null,
    pending: false,
    notice: null,
    feedback: null,
  };
  const listeners = new Set<() => void>();
  const setState = (nextState: CampaignActivityInteractionState) => {
    state = nextState;
    for (const listener of listeners) listener();
  };
  const startWorkflow = (action: CampaignActivityWorkflowAction, feedback = state.feedback) => {
    const owner = ++workflowGeneration;
    setState({ ...state, busyAction: action, pending: true, notice: null, feedback });
    const isCurrent = () => owner === workflowGeneration;
    return {
      isCurrent,
      setNotice(message: string) {
        if (isCurrent()) setState({ ...state, notice: message });
      },
      finish() {
        if (isCurrent() && (state.busyAction !== null || state.pending)) {
          setState({ ...state, busyAction: null, pending: false });
        }
      },
      async refreshAfterMutation({
        successNotice,
        refreshContext,
      }: {
        successNotice: string;
        refreshContext?: () => Promise<void>;
      }): Promise<CampaignActivityRefreshResult> {
        let contextRefreshFailed = false;
        if (refreshContext) {
          try {
            await refreshContext();
          } catch {
            contextRefreshFailed = true;
          }
        }
        if (!isCurrent()) return "stale";
        const requestGeneration = ++activityGeneration;
        try {
          const snapshot = await adapter.refresh();
          if (requestGeneration !== activityGeneration || !isCurrent()) return "stale";
          setState({
            snapshot,
            busyAction: null,
            pending: false,
            notice: contextRefreshFailed ? "Lead context could not be refreshed" : successNotice,
            feedback: null,
          });
          return "updated";
        } catch {
          if (requestGeneration !== activityGeneration || !isCurrent()) return "stale";
          setState({
            ...state,
            busyAction: null,
            pending: false,
            notice: `${successNotice}. Activity could not be refreshed`,
            feedback: null,
          });
          return "failed";
        }
      },
    };
  };

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    beginWorkflow: (action: CampaignActivityWorkflowAction) => startWorkflow(action),
    async decide(input: CampaignActivityDecision): Promise<CampaignActivityDecisionResult> {
      const workflow = startWorkflow("activity-decision", "Recording decision...");
      const requestGeneration = ++activityGeneration;
      try {
        const snapshot = await adapter.decide(input);
        if (requestGeneration !== activityGeneration || !workflow.isCurrent()) return "stale";
        setState({
          snapshot,
          busyAction: null,
          pending: false,
          notice: null,
          feedback: `Recommendation ${input.decision === "dismissed" ? "dismissed" : "marked handled"}.`,
        });
      } catch (error) {
        if (requestGeneration !== activityGeneration || !workflow.isCurrent()) return "stale";
        setState({
          ...state,
          busyAction: null,
          pending: false,
          notice: error instanceof Error ? error.message : "Could not record the recommendation decision",
          feedback: "Could not record the recommendation decision.",
        });
        throw error;
      }
    },
  };
}

export function createInMemoryCampaignActivityAdapter({
  decisionResults = [],
  refreshResults = [],
}: {
  decisionResults?: Array<Promise<CampaignActivitySnapshot>>;
  refreshResults?: Array<Promise<CampaignActivitySnapshot>>;
} = {}) {
  const decisions: CampaignActivityDecision[] = [];
  let decisionIndex = 0;
  let refreshIndex = 0;

  return {
    decisions,
    decide(input: CampaignActivityDecision) {
      decisions.push(input);
      const result = decisionResults[decisionIndex++];
      if (!result) return Promise.reject(new Error("No in-memory Activity decision result is queued"));
      return result;
    },
    refresh() {
      const result = refreshResults[refreshIndex++];
      if (!result) return Promise.reject(new Error("No in-memory Activity refresh result is queued"));
      return result;
    },
  };
}

export function createCampaignActivityHttpAdapter({
  campaignId,
  fetcher,
}: {
  campaignId: string;
  fetcher?: CampaignActivityFetcher;
}): CampaignActivityAdapter {
  const url = `/api/campaigns/${campaignId}/activity`;
  const requestFetcher: CampaignActivityFetcher = fetcher ?? ((input, init) => fetch(input, init));

  async function request(method: "GET" | "PATCH", body?: CampaignActivityDecision) {
    const response = await requestFetcher(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const error = isRecord(payload) && typeof (payload.error ?? payload.message) === "string"
        ? String(payload.error ?? payload.message)
        : `Request failed (${response.status})`;
      throw new Error(error);
    }
    if (!isActivitySnapshot(payload)) throw new Error("Activity snapshot is invalid");
    return payload;
  }

  return {
    refresh: () => request("GET"),
    decide: (input) => request("PATCH", input),
  };
}

function isActivitySnapshot(value: unknown): value is CampaignActivitySnapshot {
  if (!isRecord(value) || !Array.isArray(value.items) || !Array.isArray(value.proposals) || !Array.isArray(value.sourceStates)) return false;
  return value.items.every(isActivityItem) && value.proposals.every(isActivityProposal) && value.sourceStates.every(isActivitySourceState);
}

function isActivityItem(value: unknown): boolean {
  if (!isRecord(value) || typeof value.key !== "string" || !value.key || !isActivityCategory(value.category) || typeof value.kind !== "string" || !isActivityDate(value.occurredAt) || typeof value.title !== "string" || !isNullableString(value.summary)) return false;
  if (!isRecord(value.actor) || !isActivityActorKind(value.actor.kind) || !isNullableString(value.actor.id) || !isNullableString(value.actor.label)) return false;
  if (!isRecord(value.refs) || typeof value.refs.campaignId !== "string" || !isNullableString(value.refs.leadId) || !isNullableString(value.refs.contactId) || !isNullableString(value.refs.taskId) || !isNullableString(value.refs.draftId)) return false;
  if (!Array.isArray(value.evidence) || !value.evidence.every((evidence) => isRecord(evidence) && typeof evidence.label === "string" && typeof evidence.href === "string")) return false;
  return isRecord(value.source) && typeof value.source.kind === "string" && typeof value.source.recordId === "string";
}

function isActivityProposal(value: unknown): boolean {
  return isRecord(value)
    && typeof value.key === "string" && Boolean(value.key)
    && isProposalRuleKey(value.ruleKey)
    && value.ruleVersion === 1
    && isProposalActionType(value.actionType)
    && isNullableString(value.leadId)
    && isNullableString(value.taskId)
    && isProposalState(value.state)
    && typeof value.title === "string"
    && isNullableString(value.summary)
    && typeof value.href === "string"
    && Array.isArray(value.evidenceKeys)
    && value.evidenceKeys.every((key) => typeof key === "string");
}

function isActivitySourceState(value: unknown): boolean {
  return isRecord(value) && isActivitySource(value.source) && isSourceState(value.state) && isNullableString(value.message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isActivityDate(value: unknown): boolean {
  if (value === null || value instanceof Date) return value === null || !Number.isNaN(value.getTime());
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function isActivityCategory(value: unknown): boolean {
  return value === "research" || value === "outreach" || value === "task" || value === "reply" || value === "outcome";
}

function isActivityActorKind(value: unknown): boolean {
  return value === "user" || value === "system";
}

function isProposalRuleKey(value: unknown): boolean {
  return value === "research-next" || value === "draft-next" || value === "follow-up-review" || value === "task-review";
}

function isProposalActionType(value: unknown): boolean {
  return value === "start_research" || value === "prepare_draft" || value === "review_follow_up" || value === "review_task";
}

function isProposalState(value: unknown): boolean {
  return value === "pending" || value === "dismissed" || value === "resolved";
}

function isActivitySource(value: unknown): boolean {
  return value === "outreach_events" || value === "tasks" || value === "email_logs" || value === "lead_milestones" || value === "review_state";
}

function isSourceState(value: unknown): boolean {
  return value === "complete" || value === "unavailable";
}
