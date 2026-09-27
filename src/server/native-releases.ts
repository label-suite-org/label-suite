export type NativeReleasePipelineSource = {
  id: string;
  title: string;
  artist_name: string | null;
  cover_art_url: string | null;
  release_date: string | null;
  status: string | null;
  release_ready: boolean | null;
  missing_release_fields: string[];
};

export type NativeReleasePipelineItem = {
  id: string;
  title: string;
  artist_name: string | null;
  cover_art_url: string | null;
  image_state: "available" | "missing";
  release_date: string | null;
  phase: string | null;
  readiness: "ready" | "blocked" | "pending";
  blockers: string[];
};

export const NATIVE_RELEASE_PIPELINE_LIMIT = 50;
export const NATIVE_RELEASE_CHILD_LIMIT = 8;

export type NativeReleaseDetailSource = {
  id: string;
  title: string;
  artist_id: string | null;
  artist_name: string | null;
  cover_art_url: string | null;
  release_date: string | null;
  status: string | null;
  format: string | null;
  upc_ean: string | null;
  /** ISO timestamp revision emitted by the canonical Release query. */
  updated_at?: Date | null;
  release_ready: boolean | null;
  release_missing: string | null;
  timeline: {
    currentPhaseKey: string | null;
    phases: Array<{ key: string; label: string }>;
    childReleases: Array<{ id: string; title: string; releaseDate: string | null; status: string | null; ready: boolean | null }>;
  };
};

export type NativeReleaseCampaignSource = {
  id: string;
  campaign_name: string;
  campaign_type: string | null;
  status: string | null;
};

const sectionDefinitions = [
  ["overview", "Overview"], ["timeline", "Timeline"], ["tracks", "Tracks"], ["works", "Works"],
  ["campaigns", "Campaigns"], ["analytics", "Analytics"], ["royalties", "Royalties"], ["budget", "Budget"],
  ["assets", "Assets"], ["documents", "Documents"], ["tasks", "Tasks"], ["activity", "Activity"],
] as const;

function blockers(value: string | null | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function readiness(ready: boolean | null, missing: string[]): "ready" | "blocked" | "pending" {
  if (ready === true && missing.length === 0) return "ready";
  if (missing.length > 0 || ready === false) return "blocked";
  return "pending";
}

export function projectNativeReleasePipeline(rows: NativeReleasePipelineSource[], phases: ReadonlyMap<string, string | null> = new Map()): NativeReleasePipelineItem[] {
  return rows.slice(0, NATIVE_RELEASE_PIPELINE_LIMIT).map((row) => {
    const missing = row.missing_release_fields;
    return {
      id: row.id,
      title: row.title,
      artist_name: row.artist_name,
      cover_art_url: row.cover_art_url,
      image_state: row.cover_art_url ? "available" : "missing",
      release_date: row.release_date,
      phase: phases.get(row.id) ?? row.status,
      readiness: readiness(row.release_ready, missing),
      blockers: missing,
    };
  });
}

export type NativeReleaseProviderContextSource = {
  samply: {
    configured: boolean;
    projectLinked: boolean;
    lastSyncedAt: string | null;
    fileCount: number;
    unresolvedFileCount: number;
    connectionStatus: string | null;
    accessExpired?: boolean;
  };
  dsp: {
    pitches: Array<{ id: string; platform: string | null; status: string | null; sentDate: string | null; response: string | null }>;
    manuallyMaintained: boolean;
    hasMore?: boolean;
  };
};

// No provider freshness SLA is defined: an observation date is not proof of freshness.
function validObservedAt(value: string | null): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

export function projectNativeReleaseProviderContext(source: NativeReleaseProviderContextSource) {
  const { samply, dsp } = source;
  const audioState = samply.connectionStatus === "failed"
    ? "failure"
    : !samply.configured || !samply.projectLinked
      ? "unavailable"
      : samply.connectionStatus === "manual"
        ? "manual"
        : samply.unresolvedFileCount > 0
          ? "partial"
          : "configured";
  const audioAccess = samply.accessExpired
    ? { state: "expired" as const }
    : samply.projectLinked
      ? { state: "metadata_only" as const, reason: "Native provider context contains metadata only; playback is not available" }
      : { state: "unavailable" as const, reason: "No linked Samply project" };
  const pitches = dsp.pitches.map((pitch) => ({
    id: pitch.id,
    platform: pitch.platform,
    status: pitch.status,
    sent_date: pitch.sentDate,
    response: pitch.response,
  }));
  const dspLatest = pitches.find((pitch) => pitch.sent_date)?.sent_date ?? null;

  return {
    audio: {
      source: "samply" as const,
      state: audioState,
      freshness: { state: "unknown" as const, observed_at: validObservedAt(samply.lastSyncedAt) },
      access: audioAccess,
      item_count: samply.fileCount,
      unresolved_item_count: samply.unresolvedFileCount,
    },
    dsp: {
      source: "canonical_dsp_pitches" as const,
      state: dsp.manuallyMaintained ? "manual" as const : pitches.length ? "configured" as const : "unavailable" as const,
      freshness: { state: "unknown" as const, observed_at: validObservedAt(dspLatest) },
      pitches,
      has_more: dsp.hasMore === true,
    },
  };
}

export function projectNativeReleaseCampaigns(rows: NativeReleaseCampaignSource[]) {
  return rows.map((campaign) => ({ id: campaign.id, name: campaign.campaign_name, type: campaign.campaign_type, status: campaign.status }));
}

export function projectNativeReleaseDetail(source: NativeReleaseDetailSource) {
  const missing = blockers(source.release_missing);
  const state = readiness(source.release_ready, missing);
  const firstBlocker = missing[0];
  const focus = firstBlocker === "UPC/EAN" ? "upc" : firstBlocker === "cover" ? "cover" : firstBlocker === "date" ? "date" : null;
  const section = firstBlocker === "tracks" ? "tracks" : "overview";
  const nextAction = firstBlocker
    ? { label: `Resolve ${firstBlocker}`, href: focus ? `/releases/${encodeURIComponent(source.id)}?section=${section}&focus=${focus}` : `/releases/${encodeURIComponent(source.id)}?section=${section}` }
    : { label: "Review release timeline", href: `/releases/${encodeURIComponent(source.id)}?section=timeline` };

  return {
    release: {
      id: source.id,
      title: source.title,
      artist_id: source.artist_id,
      artist_name: source.artist_name,
      cover_art_url: source.cover_art_url,
      image_state: source.cover_art_url ? "available" as const : "missing" as const,
      release_date: source.release_date,
      status: source.status,
      format: source.format,
      upc_ean: source.upc_ean,
      updated_at: source.updated_at?.toISOString() ?? null,
      release_ready: source.release_ready,
      release_missing: source.release_missing,
    },
    phase: source.timeline.currentPhaseKey ?? source.status,
    readiness: { state, blockers: missing },
    next_action: nextAction,
    sections: sectionDefinitions.map(([key, title]) => ({ key, title })),
    child_releases: source.timeline.childReleases.slice(0, NATIVE_RELEASE_CHILD_LIMIT).map((child) => ({
      id: child.id,
      title: child.title,
      release_date: child.releaseDate,
      status: child.status,
      ready: child.ready,
    })),
  };
}
