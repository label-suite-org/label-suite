import { createHash } from "node:crypto";
import { z } from "zod";

export type CampaignActivityCategory = "research" | "outreach" | "task" | "reply" | "outcome";

export type CampaignActivityItem = {
  key: string;
  category: CampaignActivityCategory;
  kind: string;
  occurredAt: Date | null;
  title: string;
  summary: string | null;
  actor: { kind: "user" | "system"; id: string | null; label: string | null };
  refs: { campaignId: string; leadId: string | null; contactId: string | null; taskId: string | null; draftId: string | null; suggestionId?: string | null };
  evidence: Array<{ label: string; href: string }>;
  source: { kind: string; recordId: string };
  task?: { status: string | null; dueDate: string | null; nextAction: string | null };
};

export type ActivitySource = "outreach_events" | "tasks" | "email_logs" | "lead_milestones" | "review_state";

export type ActivitySourceState = {
  source: ActivitySource;
  state: "complete" | "partial" | "unavailable";
  message: string | null;
};

export type ActivityLeadState = {
  id: string;
  campaignId?: string;
  contactId: string | null;
  followUpAt: Date | null;
  lastContactedAt: Date | null;
  outcome: string | null;
  publishedAt: Date | null;
  pipelineStage: string | null;
};

export type ActivityTaskRow = {
  id: string;
  campaignId: string;
  leadId: string | null;
  contactId: string | null;
  taskName: string;
  status: string | null;
  dueDate?: string | null;
  nextAction?: string | null;
  updatedAt: Date | null;
};

export type ActivityReviewStateRow = {
  id: string;
  campaignId: string;
  leadId: string | null;
  state: string;
  occurredAt: Date | null;
};

export type ActivityDecisionRow = {
  proposalKey: string;
  decision: "dismissed" | "resolved";
  reason: string | null;
  decidedAt: Date | null;
};

export type CampaignActivityInputs = {
  campaignId?: string;
  sourceStates?: ActivitySourceState[];
  outreachEvents: Array<{
    id: string;
    campaignId: string;
    leadId: string | null;
    draftId: string | null;
    eventType: string;
    actorUserId: string | null;
    occurredAt: Date | null;
    details?: Record<string, unknown>;
  }>;
  tasks: ActivityTaskRow[];
  emailLogs: Array<{
    id: string;
    campaignId: string;
    leadId?: string | null;
    contactId?: string | null;
    subject: string | null;
    stationLabel?: string | null;
    status: string | null;
    provider?: string | null;
    operatorLabel?: string | null;
    sentAt: Date | null;
  } & Record<string, unknown>>;
  reviewStates: ActivityReviewStateRow[];
  leads: ActivityLeadState[];
};

export type CampaignActivityProposal = {
  key: string;
  ruleKey: "research-next" | "draft-next" | "follow-up-review" | "task-review";
  ruleVersion: 1;
  actionType: "start_research" | "prepare_draft" | "review_follow_up" | "review_task";
  leadId: string | null;
  taskId: string | null;
  state: "pending" | "dismissed" | "resolved";
  title: string;
  summary: string | null;
  href: string;
  evidenceKeys: string[];
};

export type CampaignActivityDecisionInput = {
  campaignId: string;
  now: Date;
  items: CampaignActivityItem[];
  leads: ActivityLeadState[];
  tasks: ActivityTaskRow[];
  decisions: ActivityDecisionRow[];
  sourceStates?: ActivitySourceState[];
};

export type CampaignActivitySnapshot = {
  items: CampaignActivityItem[];
  proposals: CampaignActivityProposal[];
  sourceStates: ActivitySourceState[];
};

export const campaignActivityDecisionSchema = z.object({
  proposal_key: z.string().min(1).max(500),
  decision: z.enum(["dismissed", "resolved"]),
  reason: z.string().trim().min(3).max(1000).nullable().optional().default(null),
}).strict();

export function stableActivityKey(sourceKind: string, recordId: string, semanticKind: string) {
  return `${sourceKind}:${recordId}:${semanticKind}`;
}

const eventDefinitions: Record<string, { category: CampaignActivityCategory; title: string }> = {
  research_started: { category: "research", title: "Research started" },
  research_completed: { category: "research", title: "Research completed" },
  suggestion_accepted: { category: "research", title: "Research suggestion accepted" },
  suggestion_rejected: { category: "research", title: "Research suggestion rejected" },
  draft_created: { category: "outreach", title: "Draft prepared" },
  draft_approved: { category: "outreach", title: "Draft approved" },
  external_send_recorded: { category: "outreach", title: "External send recorded" },
  reply_recorded: { category: "reply", title: "Reply recorded" },
  outcome_recorded: { category: "outcome", title: "Outcome recorded" },
  publication_recorded: { category: "outcome", title: "Publication recorded" },
};

export function normalizeCampaignActivity(input: CampaignActivityInputs): CampaignActivityItem[] {
  const campaignId = input.campaignId ?? input.outreachEvents[0]?.campaignId ?? input.tasks[0]?.campaignId ?? input.emailLogs[0]?.campaignId ?? input.reviewStates[0]?.campaignId ?? input.leads[0]?.campaignId ?? "";
  const events = input.outreachEvents.map((event) => normalizeEvent(event));
  const eventKindsByLead = new Set(events.filter((item) => item.refs.leadId).map((item) => `${item.refs.leadId}:${item.kind}`));
  const snapshots = input.leads.flatMap((lead) => normalizeLeadSnapshots(lead, campaignId, eventKindsByLead));
  const reviewItems = input.reviewStates.map(normalizeReview).filter((review) => (
    !events.some((event) => reviewEventSupersedesSnapshot(event, review))
  ));
  const items = [
    ...events,
    ...input.tasks.map(normalizeTask),
    ...input.emailLogs.map(normalizeEmail),
    ...reviewItems,
    ...snapshots,
  ];
  const distinct = new Map<string, CampaignActivityItem>();
  for (const item of items) if (!distinct.has(item.key)) distinct.set(item.key, item);
  return [...distinct.values()].sort(compareActivities);
}

function normalizeEvent(event: CampaignActivityInputs["outreachEvents"][number]): CampaignActivityItem {
  const definition = eventDefinitions[event.eventType] ?? inferredEventDefinition(event.eventType);
  const suggestionId = normalizedId(event.details?.suggestion_id);
  return item({
    key: stableActivityKey("event", event.id, event.eventType), category: definition.category, kind: event.eventType,
    occurredAt: event.occurredAt, title: definition.title,
    actor: { kind: event.actorUserId ? "user" : "system", id: event.actorUserId, label: null },
    refs: { campaignId: event.campaignId, leadId: event.leadId, contactId: null, taskId: null, draftId: event.draftId, suggestionId },
    source: { kind: "event", recordId: event.id },
  });
}

function inferredEventDefinition(eventType: string): { category: CampaignActivityCategory; title: string } {
  if (eventType.startsWith("research_") || /^suggestion_(accepted|rejected)$/.test(eventType)) {
    return { category: "research", title: "Research activity recorded" };
  }
  if (eventType.startsWith("reply_")) return { category: "reply", title: "Reply recorded" };
  if (eventType.includes("publication") || eventType.includes("outcome")) return { category: "outcome", title: "Outcome recorded" };
  if (eventType.includes("draft") || eventType.includes("preparation") || eventType.includes("send")) {
    return { category: "outreach", title: "Outreach activity recorded" };
  }
  return { category: "outreach", title: "Outreach activity recorded" };
}

function normalizeTask(task: ActivityTaskRow): CampaignActivityItem {
  return item({
    key: stableActivityKey("task", task.id, "task_state"), category: "task", kind: "task_state", occurredAt: task.updatedAt,
    title: task.taskName, summary: taskSummary(task),
    refs: { campaignId: task.campaignId, leadId: task.leadId, contactId: task.contactId, taskId: task.id, draftId: null },
    source: { kind: "task", recordId: task.id },
    task: { status: task.status, dueDate: task.dueDate ?? null, nextAction: normalizedText(task.nextAction) },
  });
}

function normalizeEmail(email: CampaignActivityInputs["emailLogs"][number]): CampaignActivityItem {
  const metadata = [email.subject, email.stationLabel, email.status, email.provider, email.operatorLabel].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return item({
    key: stableActivityKey("email", email.id, "email_status"), category: "outreach", kind: "email_status", occurredAt: email.sentAt,
    title: "Email activity recorded", summary: metadata.length ? metadata.join(" · ") : null,
    refs: { campaignId: email.campaignId, leadId: email.leadId ?? null, contactId: email.contactId ?? null, taskId: null, draftId: null },
    source: { kind: "email", recordId: email.id },
  });
}

function normalizeReview(review: ActivityReviewStateRow): CampaignActivityItem {
  const definition = reviewDefinition(review);
  const suggestionId = reviewSuggestionId(review);
  return item({
    key: stableActivityKey("review", review.id, definition.kind), category: definition.category, kind: definition.kind, occurredAt: review.occurredAt,
    title: definition.title, summary: definition.summary,
    refs: { campaignId: review.campaignId, leadId: review.leadId, contactId: null, taskId: null, draftId: definition.draftId, suggestionId },
    source: { kind: "review", recordId: review.id },
  });
}

function reviewDefinition(review: ActivityReviewStateRow): {
  kind: string;
  category: CampaignActivityCategory;
  title: string;
  summary: string | null;
  draftId: string | null;
} {
  if (review.id.startsWith("suggestion:")) {
    if (review.state === "accepted") return { kind: "suggestion_accepted", category: "research", title: "Research suggestion accepted", summary: null, draftId: null };
    if (review.state === "rejected") return { kind: "suggestion_rejected", category: "research", title: "Research suggestion rejected", summary: null, draftId: null };
    return { kind: "suggestion_review_state", category: "research", title: "Research suggestion review state", summary: reviewStateLabel(review.state), draftId: null };
  }
  if (review.id.startsWith("draft:")) {
    const draftId = review.id.slice("draft:".length) || null;
    if (review.state === "approved") return { kind: "draft_approved", category: "outreach", title: "Draft approved", summary: null, draftId };
    if (review.state === "draft") return { kind: "draft_current", category: "outreach", title: "Current draft", summary: null, draftId };
    return { kind: "draft_review_state", category: "outreach", title: "Draft review state", summary: reviewStateLabel(review.state), draftId };
  }
  return { kind: "review_state", category: "research", title: "Review state updated", summary: reviewStateLabel(review.state), draftId: null };
}

function reviewEventSupersedesSnapshot(event: CampaignActivityItem, review: CampaignActivityItem) {
  if (event.kind !== review.kind || event.refs.leadId !== review.refs.leadId) return false;
  if (review.kind === "suggestion_accepted" || review.kind === "suggestion_rejected") {
    return event.refs.suggestionId !== null
      && event.refs.suggestionId !== undefined
      && review.refs.suggestionId !== null
      && review.refs.suggestionId !== undefined
      && event.refs.suggestionId === review.refs.suggestionId;
  }
  if (review.kind !== "draft_approved") return false;
  return event.refs.draftId !== null
    && review.refs.draftId !== null
    && event.refs.draftId === review.refs.draftId;
}

function reviewSuggestionId(review: ActivityReviewStateRow) {
  if (!review.id.startsWith("suggestion:")) return null;
  return normalizedId(review.id.slice("suggestion:".length));
}

function normalizedId(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value;
}

function normalizeLeadSnapshots(lead: ActivityLeadState, campaignId: string, eventKindsByLead: Set<string>): CampaignActivityItem[] {
  const items: CampaignActivityItem[] = [];
  if (lead.lastContactedAt && lead.pipelineStage === "sent" && !eventKindsByLead.has(`${lead.id}:external_send_recorded`)) {
    items.push(item({
      key: stableActivityKey("lead", lead.id, "external_send_recorded"), category: "outreach", kind: "external_send_recorded", occurredAt: lead.lastContactedAt,
      title: "External send recorded", refs: refs(campaignId, lead), source: { kind: "lead", recordId: lead.id },
    }));
  }
  if (lead.outcome && !eventKindsByLead.has(`${lead.id}:outcome_recorded`)) {
    items.push(item({
      key: stableActivityKey("lead", lead.id, "outcome"), category: "outcome", kind: "outcome", occurredAt: lead.publishedAt,
      title: "Outcome recorded", summary: lead.outcome, refs: refs(campaignId, lead), source: { kind: "lead", recordId: lead.id },
    }));
  }
  if (lead.publishedAt && !eventKindsByLead.has(`${lead.id}:publication_recorded`)) {
    items.push(item({
      key: stableActivityKey("lead", lead.id, "publication_recorded"), category: "outcome", kind: "publication_recorded", occurredAt: lead.publishedAt,
      title: "Publication recorded", refs: refs(campaignId, lead), source: { kind: "lead", recordId: lead.id },
    }));
  }
  return items;
}

function item(value: Omit<CampaignActivityItem, "summary" | "actor" | "evidence"> & Partial<Pick<CampaignActivityItem, "summary" | "actor" | "evidence">>): CampaignActivityItem {
  return { ...value, summary: value.summary ?? null, actor: value.actor ?? { kind: "system", id: null, label: null }, evidence: value.evidence ?? [] };
}

function refs(campaignId: string, lead: ActivityLeadState): CampaignActivityItem["refs"] {
  return { campaignId, leadId: lead.id, contactId: lead.contactId, taskId: null, draftId: null };
}

function compareActivities(left: CampaignActivityItem, right: CampaignActivityItem) {
  const leftTime = left.occurredAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightTime = right.occurredAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  return rightTime - leftTime || left.key.localeCompare(right.key);
}

export function deriveCampaignActivityProposals(input: CampaignActivityDecisionInput): CampaignActivityProposal[] {
  const proposals: CampaignActivityProposal[] = [];
  const relationshipEvidenceComplete = sourcesComplete(input, "outreach_events", "lead_milestones", "review_state");
  for (const lead of input.leads) {
    const leadItems = input.items.filter((item) => item.refs.leadId === lead.id);
    const terminal = hasTerminalEvidence(leadItems);
    const activeResearch = isActiveResearch(leadItems);
    const hasResearchConclusion = leadItems.some((item) => ["research_completed", "research_refused", "suggestion_accepted"].includes(item.kind));
    const acceptedResearch = leadItems.filter((item) => item.kind === "suggestion_accepted");
    const researchEvidence = leadItems.filter((item) => ["event", "lead", "review"].includes(item.source.kind));
    const currentDraft = hasCurrentDraft(leadItems);

    if (relationshipEvidenceComplete && ["identified", "qualified"].includes(lead.pipelineStage ?? "") && !terminal && !activeResearch && !hasResearchConclusion) {
      proposals.push(proposal(input, {
        ruleKey: "research-next", actionType: "start_research", leadId: lead.id, taskId: null,
        title: "Start lead research", summary: null, href: leadHref(input.campaignId, lead.id, "lead-research"),
        evidenceKeys: researchEvidence.map((item) => item.key),
      }));
    }

    if (relationshipEvidenceComplete && (lead.pipelineStage === "ready" || lead.pipelineStage === "qualified") && !terminal && acceptedResearch.length > 0 && !currentDraft) {
      proposals.push(proposal(input, {
        ruleKey: "draft-next", actionType: "prepare_draft", leadId: lead.id, taskId: null,
        title: "Prepare outreach draft", summary: null, href: leadHref(input.campaignId, lead.id, "lead-drafting"),
        evidenceKeys: acceptedResearch.map((item) => item.key),
      }));
    }

    const sentAt = latestTime(leadItems.filter((item) => item.kind === "external_send_recorded"));
    if (relationshipEvidenceComplete && sentAt !== null && lead.followUpAt && lead.followUpAt.getTime() <= input.now.getTime() && !hasLaterReplyOrOutcome(leadItems, sentAt)) {
      proposals.push(proposal(input, {
        ruleKey: "follow-up-review", actionType: "review_follow_up", leadId: lead.id, taskId: null,
        title: "Review follow-up", summary: null, href: leadHref(input.campaignId, lead.id, "lead-follow-up"),
        evidenceKeys: evidenceKeys(leadItems, ["external_send_recorded"]),
      }));
    }
  }

  for (const task of sourcesComplete(input, "tasks", "review_state") ? input.tasks : []) {
    if (hasUnresolvedNextAction(task) || (!isCompletedTask(task.status) && isTaskOverdue(task, input.now))) {
      proposals.push(proposal(input, {
        ruleKey: "task-review", actionType: "review_task", leadId: task.leadId, taskId: task.id,
        title: "Review task", summary: task.taskName, href: "/ops-tasks",
        evidenceKeys: [stableActivityKey("task", task.id, "task_state")],
      }));
    }
  }

  const itemKeys = new Set(input.items.map((item) => item.key));
  return proposals
    .filter((candidate) => candidate.evidenceKeys.length > 0 && candidate.evidenceKeys.every((key) => itemKeys.has(key)))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function composeCampaignActivity(input: CampaignActivityInputs & { campaignId: string; now: Date; decisions: ActivityDecisionRow[] }): CampaignActivitySnapshot {
  const items = normalizeCampaignActivity(input);
  return {
    items,
    proposals: deriveCampaignActivityProposals({ campaignId: input.campaignId, now: input.now, items, leads: input.leads, tasks: input.tasks, decisions: input.decisions, sourceStates: input.sourceStates }),
    sourceStates: input.sourceStates ?? [],
  };
}

function sourcesComplete(input: Pick<CampaignActivityDecisionInput, "sourceStates">, ...sources: ActivitySource[]) {
  return sources.every((source) => {
    const state = input.sourceStates?.find((candidate) => candidate.source === source);
    return state === undefined || state.state === "complete";
  });
}

function proposal(
  input: CampaignActivityDecisionInput,
  value: Omit<CampaignActivityProposal, "key" | "ruleVersion" | "state">,
): CampaignActivityProposal {
  const orderedEvidence = [...value.evidenceKeys].sort();
  const rawKey = [input.campaignId, value.leadId ?? "", value.ruleKey, "v1", ...orderedEvidence].map(encodeURIComponent).join(":");
  const key = rawKey.length <= 500
    ? rawKey
    : `activity-proposal:v1:${createHash("sha256").update(rawKey).digest("hex")}`;
  const decision = input.decisions.find((row) => row.proposalKey === key);
  return { ...value, key, ruleVersion: 1, state: decision?.decision ?? "pending", evidenceKeys: orderedEvidence };
}

function hasTerminalEvidence(items: CampaignActivityItem[]) {
  return items.some((item) => item.kind === "external_send_recorded" || item.category === "reply" || item.category === "outcome");
}

function isActiveResearch(items: CampaignActivityItem[]) {
  const starts = items.filter((item) => item.kind === "research_started");
  if (starts.some((item) => item.occurredAt === null)) return true;
  const started = latestTime(starts);
  const completed = latestTime(items.filter((item) => item.kind === "research_completed"));
  return started !== null && (completed === null || started > completed);
}

function hasCurrentDraft(items: CampaignActivityItem[]) {
  const drafts = items.filter((item) => item.kind === "draft_created" || item.kind === "draft_current" || item.kind === "draft_approved");
  if (drafts.some((item) => item.occurredAt === null)) return true;
  const draft = latestTime(drafts);
  const sent = latestTime(items.filter((item) => item.kind === "external_send_recorded"));
  return draft !== null && (sent === null || draft > sent);
}

function hasLaterReplyOrOutcome(items: CampaignActivityItem[], timestamp: number) {
  return items.some((item) => (item.category === "reply" || item.category === "outcome") && (item.occurredAt?.getTime() ?? Number.NEGATIVE_INFINITY) > timestamp);
}

function latestTime(items: CampaignActivityItem[]) {
  const times = items.flatMap((item) => item.occurredAt ? [item.occurredAt.getTime()] : []);
  return times.length ? Math.max(...times) : null;
}

function evidenceKeys(items: CampaignActivityItem[], kinds: string[]) {
  return items.filter((item) => kinds.includes(item.kind)).map((item) => item.key).sort();
}

function isCompletedTask(status: string | null) {
  return ["completed", "complete", "done", "cancelled", "canceled", "resolved"].includes(status?.trim().toLowerCase() ?? "");
}

function hasUnresolvedNextAction(task: ActivityTaskRow) {
  return normalizedText(task.nextAction) !== null;
}

function isTaskOverdue(task: ActivityTaskRow, now: Date) {
  const dueDate = normalizedText(task.dueDate);
  if (!dueDate) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return dueDate < now.toISOString().slice(0, 10);
  const timestamp = Date.parse(dueDate);
  return Number.isFinite(timestamp) && timestamp < now.getTime();
}

function taskSummary(task: ActivityTaskRow) {
  const nextAction = normalizedText(task.nextAction);
  const parts = [
    task.status ? `Status: ${task.status}` : null,
    task.dueDate ? `Due: ${task.dueDate}` : null,
    nextAction ? `Next action: ${nextAction}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length ? parts.join(" · ") : null;
}

function normalizedText(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length ? normalized : null;
}

function reviewStateLabel(state: string) {
  if (state === "pending") return "Pending";
  if (state === "superseded") return "Superseded";
  return null;
}

function leadHref(campaignId: string, leadId: string, anchor: string) {
  return `/campaigns/${encodeURIComponent(campaignId)}?tab=outreach&lead=${encodeURIComponent(leadId)}#${anchor}`;
}
