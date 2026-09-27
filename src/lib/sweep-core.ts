export interface SweepBugCandidate {
  key: string;
  title: string;
  description: string;
  priority: string;
  sourceTable: string;
  sourceRecordId: string;
}

export interface SweepTrackRow {
  id: string;
  title: string;
  release_id?: string | null;
  isrc: string | null;
  audio_url: string | null;
  work_id: string | null;
}

export interface SweepReleaseRow {
  id: string;
  title: string;
  upc_ean: string | null;
  release_date: string | null;
  cover_art_url: string | null;
}

export interface SweepRoleRow {
  id: string;
  work_id: string | null;
  role: string | null;
  ownership_type: string | null;
  scope: string | null;
  percent_share: number | null;
}

export interface SweepWorkRow {
  id: string;
  title: string;
}

export function collectTrackSweepBugs(
  trackRows: SweepTrackRow[],
): SweepBugCandidate[] {
  const candidates: SweepBugCandidate[] = [];

  for (const track of trackRows) {
    if (!track.work_id) {
      candidates.push({
        key: `work-missing-${track.id}`,
        title: "Track missing work assignment",
        description: `Track "${track.title}" is not linked to a work, so clearance cannot be computed.`,
        priority: "P1",
        sourceTable: "tracks",
        sourceRecordId: track.id,
      });
    }

    if (!track.isrc) {
      candidates.push({
        key: `isrc-missing-${track.id}`,
        title: "Track missing ISRC",
        description: `Track "${track.title}" has no ISRC.`,
        priority: "P1",
        sourceTable: "tracks",
        sourceRecordId: track.id,
      });
    }

    if (!track.audio_url) {
      candidates.push({
        key: `audio-missing-${track.id}`,
        title: "Track missing audio",
        description: `Track "${track.title}" has no audio file.`,
        priority: "P0",
        sourceTable: "tracks",
        sourceRecordId: track.id,
      });
    }
  }

  return candidates;
}

export function collectReleaseSweepBugs(
  releaseRows: SweepReleaseRow[],
  trackRows: SweepTrackRow[],
): SweepBugCandidate[] {
  const candidates: SweepBugCandidate[] = [];
  const trackCountByRelease = new Map<string, number>();

  for (const track of trackRows) {
    if (track.release_id) {
      trackCountByRelease.set(
        track.release_id,
        (trackCountByRelease.get(track.release_id) ?? 0) + 1,
      );
    }
  }

  for (const release of releaseRows) {
    if (!release.upc_ean) {
      candidates.push({
        key: `release-upc-missing-${release.id}`,
        title: "Release missing UPC/EAN",
        description: `Release "${release.title}" has no UPC/EAN.`,
        priority: "P1",
        sourceTable: "releases",
        sourceRecordId: release.id,
      });
    }

    if (!release.release_date) {
      candidates.push({
        key: `release-date-missing-${release.id}`,
        title: "Release missing date",
        description: `Release "${release.title}" has no release date.`,
        priority: "P2",
        sourceTable: "releases",
        sourceRecordId: release.id,
      });
    }

    if (!release.cover_art_url) {
      candidates.push({
        key: `release-artwork-missing-${release.id}`,
        title: "Release missing cover art",
        description: `Release "${release.title}" has no cover art.`,
        priority: "P1",
        sourceTable: "releases",
        sourceRecordId: release.id,
      });
    }

    if ((trackCountByRelease.get(release.id) ?? 0) === 0) {
      candidates.push({
        key: `release-tracks-missing-${release.id}`,
        title: "Release has no tracks",
        description: `Release "${release.title}" has no tracks.`,
        priority: "P1",
        sourceTable: "releases",
        sourceRecordId: release.id,
      });
    }
  }

  return candidates;
}

export function collectRoleSweepBugs(roleRows: SweepRoleRow[]): SweepBugCandidate[] {
  const candidates: SweepBugCandidate[] = [];

  for (const role of roleRows) {
    if ((role.percent_share ?? 0) > 0 && !role.scope) {
      candidates.push({
        key: `role-scope-missing-${role.id}`,
        title: "Rights line missing scope",
        description: `Role "${role.role ?? role.id}" has a share but no Publishing/Master scope.`,
        priority: "P2",
        sourceTable: "roles",
        sourceRecordId: role.id,
      });
    }
  }

  return candidates;
}

export function collectWorkSweepBugs(
  workRows: SweepWorkRow[],
  roleRows: SweepRoleRow[],
): SweepBugCandidate[] {
  const candidates: SweepBugCandidate[] = [];
  const validRightScopes = new Set(["Publishing", "Master", "Mechanical"]);
  const hasApplicableRightsByWork = new Set<string>();
  const allocationByWork = new Map<string, { Publishing: number; Master: number }>();

  for (const role of roleRows) {
    if (
      role.work_id &&
      role.ownership_type !== "Credit" &&
      validRightScopes.has(role.scope ?? "") &&
      (role.percent_share ?? 0) > 0
    ) {
      hasApplicableRightsByWork.add(role.work_id);
      const allocation = allocationByWork.get(role.work_id) ?? {
        Publishing: 0,
        Master: 0,
      };
      const normalizedScope =
        role.scope === "Mechanical" ? "Publishing" : role.scope;
      if (normalizedScope === "Publishing" || normalizedScope === "Master") {
        allocation[normalizedScope] += role.percent_share ?? 0;
      }
      allocationByWork.set(role.work_id, allocation);
    }
  }

  for (const work of workRows) {
    if (!hasApplicableRightsByWork.has(work.id)) {
      candidates.push({
        key: `work-rights-missing-${work.id}`,
        title: "Work missing rights lines",
        description: `Work "${work.title}" has no applicable rights shares entered.`,
        priority: "P1",
        sourceTable: "works",
        sourceRecordId: work.id,
      });
    }

    const allocation = allocationByWork.get(work.id);
    if (!allocation) continue;

    for (const scope of ["Publishing", "Master"] as const) {
      const total = Math.round(allocation[scope] * 100) / 100;
      if (total > 0 && total < 99.99) {
        candidates.push({
          key: `work-${scope.toLowerCase()}-underallocated-${work.id}`,
          title: `${scope} rights underallocated`,
          description: `Work "${work.title}" has ${total}% ${scope} rights entered, not 100%.`,
          priority: "P1",
          sourceTable: "works",
          sourceRecordId: work.id,
        });
      }

      if (total > 100.01) {
        candidates.push({
          key: `work-${scope.toLowerCase()}-overallocated-${work.id}`,
          title: `${scope} rights overallocated`,
          description: `Work "${work.title}" has ${total}% ${scope} rights entered, over 100%.`,
          priority: "P1",
          sourceTable: "works",
          sourceRecordId: work.id,
        });
      }
    }
  }

  return candidates;
}
