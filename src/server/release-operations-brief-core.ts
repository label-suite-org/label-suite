import type { ReleaseTimeline, ReleaseTimelinePhase } from "./release-timeline-core";

export type ReleaseBriefSeverity = "blocker" | "attention" | "watch";
export type ReleaseBriefActionKey =
  | "cover"
  | "upc"
  | "date"
  | "format"
  | "tracks"
  | "track-readiness"
  | "pitch"
  | "timeline"
  | "analytics";

export interface ReleaseBriefItem {
  id: string;
  severity: ReleaseBriefSeverity;
  title: string;
  detail: string;
  actionKey: ReleaseBriefActionKey;
  actionLabel: string;
  evidence: { label: string; href: string };
  priority: number;
}

export interface ReleaseOperationsBriefInput {
  today: string;
  release: {
    id: string;
    title: string;
    artistName: string | null;
    releaseDate: string | null;
    format: string | null;
    upcEan: string | null;
    coverArtUrl: string | null;
    releaseReady: boolean | null;
    status: string | null;
  };
  tracks: Array<{
    id: string;
    title: string;
    ready: boolean | null;
    missing: string | null;
    workId?: string | null;
  }>;
  pitches: Array<{ id: string; status: string | null }>;
  timeline: ReleaseTimeline | null;
  hasScopedAnalytics: boolean;
}

export interface ReleaseOperationsBrief {
  status: "blocked" | "attention" | "clear";
  headline: string;
  summary: string;
  items: ReleaseBriefItem[];
  sourcesChecked: string[];
}

const doneStatuses = new Set(["done", "complete", "completed", "cancelled"]);
const severityRank: Record<ReleaseBriefSeverity, number> = { blocker: 0, attention: 1, watch: 2 };

export function buildReleaseOperationsBrief(input: ReleaseOperationsBriefInput): ReleaseOperationsBrief {
  const { release } = input;
  const releaseHref = `/releases/${release.id}`;
  const releaseRecordEvidence = { label: "Release record", href: `${releaseHref}?section=overview` };
  const items: ReleaseBriefItem[] = [];

  if (!release.releaseDate) {
    items.push(item("release-date", "blocker", "Release date is missing", "Scheduling, delivery and timeline urgency cannot be evaluated until the release has a date.", "date", "Set date", { label: "Release date", href: `${releaseHref}?section=overview&focus=date` }, 20));
  }
  if (!release.upcEan) {
    items.push(item("upc", "blocker", "UPC/EAN is missing", "The release cannot pass delivery readiness without a barcode.", "upc", "Add UPC/EAN", { label: "UPC/EAN", href: `${releaseHref}?section=overview&focus=upc` }, 22));
  }
  if (!release.coverArtUrl) {
    items.push(item("cover", "blocker", "Cover art is missing", "No final artwork link is recorded for this release.", "cover", "Add cover", { label: "Cover art", href: `${releaseHref}?section=overview&focus=cover` }, 24));
  }
  if (!release.format) {
    items.push(item("format", "attention", "Release format is missing", "Set whether this is a single, EP, album or video so downstream views can interpret it correctly.", "format", "Set format", { label: "Release format", href: `${releaseHref}?section=overview&focus=format` }, 35));
  }

  if (input.tracks.length === 0) {
    items.push(item("tracks", "blocker", "No tracks are linked", "A release needs at least one linked track before readiness is meaningful.", "tracks", "Add tracks", { label: "Track readiness", href: `${releaseHref}/tracks` }, 10));
  } else {
    const unreadyTracks = input.tracks.filter((track) => !track.ready);
    if (unreadyTracks.length > 0) {
      const details = unreadyTracks
        .slice(0, 3)
        .map((track) => `${track.title}: ${track.missing?.trim() || "Readiness check incomplete"}`);
      if (unreadyTracks.length > 3) details.push(`and ${unreadyTracks.length - 3} more`);
      const representative = unreadyTracks[0];
      items.push(item(
        "track-readiness",
        "blocker",
        `${unreadyTracks.length} track${unreadyTracks.length === 1 ? "" : "s"} need work`,
        details.join(" · "),
        "track-readiness",
        "Review tracks",
        buildTrackBlockerEvidence({
          releaseHref,
          track: representative,
          missing: representative.missing || "",
        }),
        12,
      ));
    }
  }

  for (const phase of input.timeline?.phases ?? []) {
    if (phase.health !== "blocked" && phase.health !== "attention") continue;
    const severity = phase.health === "blocked" ? "blocker" : "attention";
    items.push(item(
      `timeline-${phase.key}`,
      severity,
      `${phase.label} ${phase.health === "blocked" ? "is blocked" : "needs attention"}`,
      timelineDetail(phase, input.today),
      "timeline",
      "Open timeline",
      { label: "Release timeline", href: `${releaseHref}#release-timeline` },
      phase.health === "blocked" ? 5 : 30,
    ));
  }

  if (input.pitches.length === 0) {
    const days = daysBetween(input.today, release.releaseDate);
    const severity: ReleaseBriefSeverity = days != null && days > 56 ? "watch" : "attention";
    items.push(item("pitch", severity, "No DSP pitch is logged", "No platform pitch is linked to this release yet.", "pitch", "Add pitch", { label: "DSP pitches", href: `${releaseHref}#dsp-pitches` }, 45));
  }

  if (!input.hasScopedAnalytics && isReleased(input.today, release.releaseDate, release.status)) {
    items.push(item("analytics", "watch", "No scoped performance data is linked", "The release is out, but no matched stream or audience data is available for monitoring.", "analytics", "Check data", { label: "Release analytics", href: `${releaseHref}#performance-data` }, 70));
  }

  const hasDerivedBlocker = items.some((entry) => entry.severity === "blocker");
  if (release.releaseReady === false && !hasDerivedBlocker) {
    items.push(item("readiness-state", "attention", "Stored readiness needs review", "The release is marked not ready, but the visible grounded checks do not explain a blocker. Run or inspect the readiness sweep.", "track-readiness", "Review readiness", releaseRecordEvidence, 40));
  }

  items.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.priority - b.priority || a.title.localeCompare(b.title));

  const blockers = items.filter((entry) => entry.severity === "blocker").length;
  const attention = items.length - blockers;
  const status = blockers > 0 ? "blocked" : items.length > 0 ? "attention" : "clear";
  const headline = blockers > 0
    ? `${blockers} operational blocker${blockers === 1 ? "" : "s"} need action`
    : items.length > 0
      ? `${items.length} item${items.length === 1 ? "" : "s"} to review`
      : "No operational blockers found";
  const summary = blockers > 0
    ? `${attention ? `${attention} additional item${attention === 1 ? "" : "s"} should also be reviewed. ` : ""}Nothing will be changed without an operator action.`
    : items.length > 0
      ? "These findings are derived from linked Label Suite records. Nothing will be changed without an operator action."
      : "The linked release record, tracks and operational data do not currently expose a blocker.";

  return {
    status,
    headline,
    summary,
    items,
    sourcesChecked: [
      "Release record",
      "Track readiness",
      "DSP pitches",
      ...(input.timeline ? ["Release timeline"] : []),
      ...(input.hasScopedAnalytics ? ["Release analytics"] : []),
    ],
  };
}

function item(
  id: string,
  severity: ReleaseBriefSeverity,
  title: string,
  detail: string,
  actionKey: ReleaseBriefActionKey,
  actionLabel: string,
  evidence: ReleaseBriefItem["evidence"],
  priority: number,
): ReleaseBriefItem {
  return { id, severity, title, detail, actionKey, actionLabel, evidence, priority };
}

function buildTrackBlockerEvidence({ releaseHref, track, missing }: {
  releaseHref: string;
  track: ReleaseOperationsBriefInput["tracks"][number];
  missing: string;
}): ReleaseBriefItem["evidence"] {
  const trackFocus = firstMissingTrackFocus(missing);

  if ((trackFocus.kind === "scope") && track.workId) {
    return {
      label: humanizeScope(trackFocus.scope),
      href: `/works/${track.workId}?scope=${trackFocus.scope}&focus=${trackFocus.scope}`,
    };
  }

  if (trackFocus.kind === "work-clearance" && track.workId) {
    return {
      label: "Work clearance",
      href: `/works/${track.workId}?scope=publishing&focus=publishing`,
    };
  }

  if (track.workId && trackFocus.kind === "credit") {
    return {
      label: "Credited persons",
      href: `/works/${track.workId}?scope=credits&focus=credits`,
    };
  }

  if (trackFocus.kind === "field" && trackFocus.focus) {
    return {
      label: `${track.title} track`,
      href: `${releaseHref}/tracks?track=${encodeURIComponent(track.id)}&focus=${trackFocus.focus}`,
    };
  }

  return {
    label: `${track.title} track`,
    href: `${releaseHref}/tracks?track=${encodeURIComponent(track.id)}`,
  };
}

function firstMissingTrackFocus(missing: string): {
  focus: "audio" | "isrc" | "work" | null;
  kind: "field";
} | {
  kind: "scope";
  scope: "publishing" | "master";
} | {
  kind: "credit";
} | {
  kind: "work-clearance";
} | {
  kind: "none";
} {
  const lower = missing.toLowerCase();

  if (lower.includes("audio file")) {
    return { kind: "field", focus: "audio" };
  }
  if (lower.includes("isrc") && !lower.includes("work assignment")) {
    return { kind: "field", focus: "isrc" };
  }
  if (lower.includes("work assignment")) {
    return { kind: "field", focus: "work" };
  }
  if (lower.includes("publishing clearance")) {
    return { kind: "scope", scope: "publishing" };
  }
  if (lower.includes("master clearance")) {
    return { kind: "scope", scope: "master" };
  }
  if (lower.includes("no rights entered")) {
    return { kind: "work-clearance" };
  }
  if (lower.includes("credited persons") || lower.includes("credited person") || lower.includes("credit")) {
    return { kind: "credit" };
  }

  return { kind: "none" };
}

function humanizeScope(scope: "publishing" | "master") {
  return scope === "publishing" ? "Publishing clearance" : "Master clearance";
}

function timelineDetail(phase: ReleaseTimelinePhase, today: string): string {
  const openMilestones = phase.milestones.filter((entry) => isOpen(entry.status));
  const openTasks = phase.tasks.filter((entry) => isOpen(entry.status));
  const candidates = [...openMilestones, ...openTasks]
    .sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"));
  const detail = candidates.slice(0, 2).map((entry) => {
    if (entry.dueDate && entry.dueDate < today) return `${entry.title} was due ${formatShortDate(entry.dueDate)}`;
    if (!entry.owner?.trim()) return `${entry.title} has no owner`;
    if (entry.dueDate) return `${entry.title} is due ${formatShortDate(entry.dueDate)}`;
    return `${entry.title} is still open`;
  });
  if (detail.length > 0) return detail.join(" · ");
  if (phase.budget.planned > 0 && phase.budget.committed >= phase.budget.planned * 0.9) {
    return "Committed budget has reached at least 90% of the phase plan.";
  }
  return "Linked timeline data marks this phase for review.";
}

function isOpen(status: string | null | undefined): boolean {
  return !doneStatuses.has((status ?? "todo").toLowerCase());
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function daysBetween(today: string, releaseDate: string | null): number | null {
  if (!releaseDate) return null;
  return Math.ceil((new Date(`${releaseDate}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000);
}

function isReleased(today: string, releaseDate: string | null, status: string | null): boolean {
  if ((status ?? "").toLowerCase() === "released") return true;
  return releaseDate != null && releaseDate < today;
}
