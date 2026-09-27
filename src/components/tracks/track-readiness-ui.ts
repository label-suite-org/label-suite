export type TrackReadinessCheckState = "complete" | "missing" | "not-applicable";

export interface TrackReadinessInput {
  audioUrl?: string | null;
  isrc?: string | null;
  workId?: string | null;
  clearance_pub?: number | null;
  clearance_master?: number | null;
  clearance_pub_entered?: number | null;
  clearance_master_entered?: number | null;
}

export interface TrackReadinessCheck {
  label: string;
  state: TrackReadinessCheckState;
  detail: string;
}

export function isTrackReadinessComplete(readyCount: number, trackCount: number): boolean {
  return trackCount > 0 && readyCount === trackCount;
}

export function buildTrackReadinessChecks(track: TrackReadinessInput): TrackReadinessCheck[] {
  const publishingEntered = Number(track.clearance_pub_entered ?? 0);
  const masterEntered = Number(track.clearance_master_entered ?? 0);
  const hasAnyRights = publishingEntered > 0 || masterEntered > 0;

  return [
    {
      label: "Audio file",
      state: track.audioUrl ? "complete" : "missing",
      detail: track.audioUrl ? "Audio is linked" : "Upload or paste an audio link",
    },
    {
      label: "ISRC",
      state: track.isrc ? "complete" : "missing",
      detail: track.isrc || "Add an ISRC or link a work with ISRC",
    },
    buildClearanceCheck("Publishing", track.clearance_pub, publishingEntered, hasAnyRights),
    buildClearanceCheck("Master", track.clearance_master, masterEntered, hasAnyRights),
    {
      label: "Linked work",
      state: track.workId ? "complete" : "missing",
      detail: track.workId ? "Recording identity linked" : "Link this track to a work",
    },
  ];
}

function buildClearanceCheck(
  scope: "Publishing" | "Master",
  progressValue: number | null | undefined,
  entered: number,
  hasAnyRights: boolean,
): TrackReadinessCheck {
  if (entered <= 0) {
    return {
      label: `${scope} clearance`,
      state: hasAnyRights ? "not-applicable" : "missing",
      detail: hasAnyRights ? `No ${scope.toLowerCase()} rights entered` : `No rights entered on this track`,
    };
  }

  const progress = Number(progressValue ?? 0);
  return {
    label: `${scope} clearance`,
    state: progress >= 1 ? "complete" : "missing",
    detail: `${Math.round(progress * 100)}% complete`,
  };
}
