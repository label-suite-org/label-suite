"use client";

import { useMemo, useState } from "react";
import type {
  CampaignActivityCategory,
  CampaignActivityItem,
  CampaignActivityProposal,
  CampaignActivitySnapshot,
} from "../../server/campaign-activity-core";
import type { CampaignActivityDecision } from "./CampaignActivityInteraction";

import { Button } from "@/components/ui/button";
type ActivityFilter = "all" | CampaignActivityCategory;

export type CampaignActivityLaneProps = {
  snapshot: CampaignActivitySnapshot;
  canMutate: boolean;
  disabled?: boolean;
  decisionPending?: boolean;
  feedback?: string | null;
  onDecision: (input: CampaignActivityDecision) => Promise<CampaignActivityDecisionResult>;
};

export type CampaignActivityDecisionResult = "stale" | void;

const FILTERS: Array<{ value: ActivityFilter; label: string; singular: string }> = [
  { value: "all", label: "All", singular: "all" },
  { value: "research", label: "Research", singular: "research" },
  { value: "outreach", label: "Outreach", singular: "outreach" },
  { value: "task", label: "Tasks", singular: "task" },
  { value: "reply", label: "Replies", singular: "reply" },
  { value: "outcome", label: "Outcomes", singular: "outcome" },
];

const SOURCE_LABELS: Record<string, string> = {
  outreach_events: "Outreach events",
  tasks: "Tasks",
  email_logs: "Email logs",
  lead_milestones: "Lead milestones",
  review_state: "Review state",
};

export function CampaignActivityLane({ snapshot, canMutate, disabled = false, decisionPending = false, feedback = null, onDecision }: CampaignActivityLaneProps) {
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const pendingProposals = useMemo(
    () => snapshot.proposals.filter((proposal) => proposal.state === "pending"),
    [snapshot.proposals],
  );

  const orderedItems = useMemo(
    () => [...snapshot.items].sort(compareActivityItems),
    [snapshot.items],
  );

  const visibleItems = useMemo(
    () => filter === "all" ? orderedItems : orderedItems.filter((item) => item.category === filter),
    [filter, orderedItems],
  );

  const unavailableSources = snapshot.sourceStates.filter((source) => source.state === "unavailable");

  async function handleDecision(proposal: CampaignActivityProposal, decision: "dismissed" | "resolved") {
    if (!canMutate || disabled) return;
    try {
      await onDecision({ proposal_key: proposal.key, decision, reason: null });
    } catch { /* ignore — refresh failures fall back to the current list */ }
  }

  return (
    <section aria-labelledby="campaign-activity-title" className="space-y-6">
      <div>
        <h2 id="campaign-activity-title" className="text-xl font-semibold tracking-tight">Activity</h2>
        <p className="mt-1 text-sm text-muted-foreground">Relationship activity and operator-reviewed next steps.</p>
      </div>

      {unavailableSources.length > 0 && (
        <div role="status" className="border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
          <p className="font-medium">Partial activity</p>
          <p className="mt-1">Unavailable sources: {unavailableSources.map((source) => sourceLabel(source.source)).join(", ")}.</p>
        </div>
      )}

      {pendingProposals.length > 0 && (
        <section aria-labelledby="campaign-activity-recommendations-title" className="space-y-3">
          <div>
            <h3 id="campaign-activity-recommendations-title" className="text-lg font-semibold">Recommendations</h3>
            <p className="mt-1 text-sm text-muted-foreground">Review these explicit next steps before changing campaign records.</p>
          </div>
          <ul aria-label="Pending recommendations" className="divide-y divide-border border-y border-border">
            {pendingProposals.map((proposal) => (
              <li key={proposal.key}>
                <ProposalCard
                  proposal={proposal}
                  items={snapshot.items}
                  canMutate={canMutate}
                  disabled={disabled}
                  decisionPending={decisionPending}
                  onDecision={handleDecision}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="campaign-activity-chronology-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="campaign-activity-chronology-title" className="text-lg font-semibold">Chronology</h3>
            <p className="mt-1 text-sm text-muted-foreground">A source-labelled record of campaign relationship activity.</p>
          </div>
          <div role="group" aria-label="Activity category filters" className="flex flex-wrap gap-2">
            {FILTERS.map((option) => (
            <Button
                key={option.value}
                variant="outline"
                type="button"
                aria-label={option.label}
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted aria-pressed:bg-muted aria-pressed:text-foreground"
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        {visibleItems.length === 0 ? (
          <p role="status" className="border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
            No activity is recorded from the available sources
          </p>
        ) : (
          <ol aria-label="Activity chronology" className="divide-y divide-border border-y border-border">
            {visibleItems.map((item) => <ActivityRow key={item.key} item={item} />)}
          </ol>
        )}
      </section>

      {feedback && <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{feedback}</p>}
    </section>
  );
}

function ProposalCard({
  proposal,
  items,
  canMutate,
  disabled,
  decisionPending,
  onDecision,
}: {
  proposal: CampaignActivityProposal;
  items: CampaignActivityItem[];
  canMutate: boolean;
  disabled: boolean;
  decisionPending: boolean;
  onDecision: (proposal: CampaignActivityProposal, decision: "dismissed" | "resolved") => Promise<CampaignActivityDecisionResult>;
}) {
  const evidenceItems = proposal.evidenceKeys
    .map((key) => items.find((item) => item.key === key))
    .filter((item): item is CampaignActivityItem => item !== undefined);
  const rationale = proposalRationale(proposal);
  const headingId = `campaign-activity-proposal-${slug(proposal.key)}`;

  return (
    <article aria-labelledby={headingId} aria-busy={decisionPending} className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 id={headingId} className="font-semibold">{proposal.title}</h4>
          <p className="mt-2 text-sm text-muted-foreground"><span className="font-medium text-foreground">Rationale:</span> {rationale}</p>
        </div>
        <a href={proposal.href} className="shrink-0 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted">Open workflow</a>
      </div>

      <div className="mt-3 text-sm">
        <p className="font-medium">Evidence</p>
        {evidenceItems.length > 0 ? (
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {evidenceItems.map((item) => (
              <li key={item.key}>
                <span>{item.title}</span>
                {item.evidence.length > 0 && (
                  <span className="ml-2 inline-flex flex-wrap gap-x-2">
                    {item.evidence.map((evidence) => <a key={`${item.key}:${evidence.href}`} href={evidence.href} className="text-foreground underline underline-offset-2">{evidence.label}</a>)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted-foreground">No linked evidence.</p>
        )}
      </div>

      {canMutate && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            aria-label="Dismiss recommendation"
            disabled={decisionPending || disabled}
            onClick={() => void onDecision(proposal, "dismissed")}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-60"
          >
            Dismiss recommendation
          </Button>
          <Button
            type="button"
            aria-label="Mark handled"
            disabled={decisionPending || disabled}
            onClick={() => void onDecision(proposal, "resolved")}
            className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            Mark handled
          </Button>
        </div>
      )}
    </article>
  );
}

function ActivityRow({ item }: { item: CampaignActivityItem }) {
  const timestamp = validDate(item.occurredAt);
  const actor = item.actor.label ?? item.actor.id ?? (item.actor.kind === "system" ? "System" : null);

  return (
    <li className="grid gap-2 px-4 py-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <div className="text-sm text-muted-foreground">
        {timestamp ? <time dateTime={timestamp.toISOString()}>{formatTime(timestamp)}</time> : "Time unknown"}
      </div>
      <div className="min-w-0">
        <p className="font-medium">{item.title}</p>
        {item.summary && <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {actor && <span>By {actor}</span>}
          <span>Source: {sourceLabel(item.source.kind)}</span>
          {item.evidence.map((evidence) => <a key={`${item.key}:${evidence.href}`} href={evidence.href} className="underline underline-offset-2">{evidence.label}</a>)}
        </div>
      </div>
    </li>
  );
}

function compareActivityItems(left: CampaignActivityItem, right: CampaignActivityItem) {
  const leftTime = validDate(left.occurredAt)?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightTime = validDate(right.occurredAt)?.getTime() ?? Number.NEGATIVE_INFINITY;
  return rightTime - leftTime || left.key.localeCompare(right.key);
}

function validDate(value: Date | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Copenhagen" }).format(value);
}

function sourceLabel(source: string) {
  return SOURCE_LABELS[source] ?? source.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function proposalRationale(proposal: CampaignActivityProposal) {
  const maybeRationale = (proposal as CampaignActivityProposal & { rationale?: unknown }).rationale;
  if (typeof maybeRationale === "string" && maybeRationale.trim()) return maybeRationale;
  if (proposal.summary) return proposal.summary;
  switch (proposal.actionType) {
    case "start_research": return "Available relationship evidence indicates that research is the next step.";
    case "prepare_draft": return "Reviewed relationship context is available and an outreach draft is the next step.";
    case "review_follow_up": return "A follow-up is due and no later reply or outcome is recorded.";
    case "review_task": return "This task has an unresolved next action.";
    default: return "Review the available relationship evidence before continuing.";
  }
}

function slug(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "proposal";
}
