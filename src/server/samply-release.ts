import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import {
  artists,
  releases,
  tracks,
  samply_connections,
  samply_files,
  samply_players,
  samply_projects,
} from "../db/schema";
import { db } from "../lib/db";
import { persistReleaseReadiness, persistTrackReadiness } from "../lib/readiness";
import { ConflictError, NotFoundError } from "./errors";
import {
  buildSamplyEmbedUrl,
  createSamplyPlayer,
  createSamplyProject,
  getSamplyDownloadUrl,
  getSamplyProject,
  getSamplyProjectFile,
  listSamplyComments,
  listSamplyProjects,
  listSamplyProjectFiles,
  listSamplyPlayers,
  type SamplyComment,
  type SamplyBoxSummary,
  type SamplyPlayerSummary,
  type SamplyProjectSummary,
} from "./samply";

export interface ReleaseSamplyProject {
  id: string;
  remoteProjectId: string;
  remoteProjectName: string | null;
  uploadEnabled: boolean;
  primaryPlayerId: string | null;
}

export interface ReleaseSamplyPlayer {
  id: string;
  remotePlayerId: string;
  name: string;
  playerType: string;
  embedUrl: string;
  shareUrl: string | null;
  public: boolean;
  downloadsEnabled: boolean;
  commentsEnabled: boolean;
  quality: string | null;
}

export interface ReleaseSamplyInventoryItem {
  id: string;
  trackId: string | null;
  trackTitle: string | null;
  position: number | null;
  version: string | null;
  remoteBoxId: string;
  remoteStackId: string | null;
  fileName: string;
  duration: number | null;
  audioUrl: string | null;
  syncStatus: string;
  lastSyncedAt: string | null;
}

export interface ReleaseSamplyReview {
  project: ReleaseSamplyProject | null;
  player: ReleaseSamplyPlayer | null;
  fileCount: number;
  lastSyncedAt: string | null;
  artworkUrl: string | null;
  inventory: ReleaseSamplyInventoryItem[];
}

export interface LinkableSamplyProject {
  id: string;
  name: string;
  creatorEmail: string | null;
  uploadEnabled: boolean;
  size: number;
  timeModified: number | null;
  linkedReleaseId: string | null;
  linkedReleaseTitle: string | null;
}

interface ReleaseSummary {
  id: string;
  title: string;
  artistName: string | null;
  coverArtUrl: string | null;
}

interface LocalSamplyProjectRow {
  id: string;
  remoteProjectId: string;
  remoteProjectName: string | null;
  uploadEnabled: boolean;
  primaryPlayerId: string | null;
  lastSyncedAt: Date | null;
  metadata: Record<string, unknown> | null;
}

interface CanonicalSamplyTrackCandidate {
  trackTitle: string;
  remoteBoxId: string;
  remoteStackId: string | null;
  fileName: string;
  duration: number | null;
  order: number;
  versions: CanonicalSamplyTrackVersion[];
}

interface CanonicalSamplyTrackVersion {
  remoteBoxId: string;
  remoteStackId: string | null;
  fileName: string;
  duration: number | null;
  label: string;
  primary: boolean;
}

export async function getReleaseSamplyReview(
  orgId: string,
  releaseId: string,
): Promise<ReleaseSamplyReview> {
  const projectRow = await getLinkedSamplyProject(orgId, releaseId);

  if (!projectRow) {
    return {
      project: null,
      player: null,
      fileCount: 0,
      lastSyncedAt: null,
      artworkUrl: null,
      inventory: [],
    };
  }

  const playerRow = (
    await db
      .select({
        id: samply_players.id,
        remotePlayerId: samply_players.remote_player_id,
        name: samply_players.name,
        playerType: samply_players.player_type,
        embedUrl: samply_players.embed_url,
        shareUrl: samply_players.share_url,
        public: samply_players.public,
        downloadsEnabled: samply_players.downloads_enabled,
        commentsEnabled: samply_players.comments_enabled,
        quality: samply_players.quality,
      })
      .from(samply_players)
      .where(and(
        eq(samply_players.org_id, orgId),
        eq(samply_players.samply_project_id, projectRow.id),
        eq(samply_players.player_type, "review"),
      ))
      .orderBy(desc(samply_players.updated_at))
      .limit(1)
  )[0];

  const inventoryRows = await db
    .select({
      id: samply_files.id,
      trackId: samply_files.track_id,
      trackTitle: tracks.title,
      position: tracks.position,
      remoteBoxId: samply_files.remote_box_id,
      remoteStackId: samply_files.remote_stack_id,
      fileName: samply_files.file_name,
      duration: tracks.duration,
      audioUrl: tracks.audio_url,
      syncStatus: samply_files.sync_status,
      lastSyncedAt: samply_files.last_synced_at,
    })
    .from(samply_files)
    .leftJoin(tracks, and(eq(samply_files.track_id, tracks.id), eq(tracks.org_id, orgId)))
    .where(and(
      eq(samply_files.org_id, orgId),
      eq(samply_files.samply_project_id, projectRow.id),
      ne(samply_files.sync_status, "missing_remote"),
    ))
    .orderBy(asc(tracks.position), asc(samply_files.file_name));

  const fileCountRow = (
    await db
      .select({ count: sql<string>`count(*)` })
      .from(samply_files)
      .where(and(
        eq(samply_files.org_id, orgId),
        eq(samply_files.samply_project_id, projectRow.id),
        ne(samply_files.sync_status, "missing_remote"),
      ))
  )[0];

  return {
    project: {
      id: projectRow.id,
      remoteProjectId: projectRow.remoteProjectId,
      remoteProjectName: projectRow.remoteProjectName,
      uploadEnabled: Boolean(projectRow.uploadEnabled),
      primaryPlayerId: projectRow.primaryPlayerId,
    },
    player: playerRow
      ? {
          id: playerRow.id,
          remotePlayerId: playerRow.remotePlayerId,
          name: playerRow.name,
          playerType: playerRow.playerType,
          embedUrl: playerRow.embedUrl ?? buildSamplyEmbedUrl(playerRow.remotePlayerId),
          shareUrl: playerRow.shareUrl,
          public: Boolean(playerRow.public),
          downloadsEnabled: Boolean(playerRow.downloadsEnabled),
          commentsEnabled: Boolean(playerRow.commentsEnabled),
          quality: playerRow.quality,
        }
      : null,
    fileCount: Number(fileCountRow?.count ?? 0),
    lastSyncedAt: projectRow.lastSyncedAt ? projectRow.lastSyncedAt.toISOString() : null,
    artworkUrl: typeof projectRow.metadata?.artworkUrl === "string" ? projectRow.metadata.artworkUrl : null,
    inventory: inventoryRows.map((row) => ({
      id: row.id,
      trackId: row.trackId ?? null,
      trackTitle: row.trackTitle ?? null,
      position: row.position ?? null,
      version: inferVersionLabel(row.fileName),
      remoteBoxId: row.remoteBoxId,
      remoteStackId: row.remoteStackId ?? null,
      fileName: row.fileName,
      duration: row.duration ?? null,
      audioUrl: row.audioUrl ?? null,
      syncStatus: row.syncStatus,
      lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    })),
  };
}

export async function getReleaseSamplyProviderContext(
  orgId: string,
  releaseId: string,
): Promise<{
  configured: boolean;
  projectLinked: boolean;
  lastSyncedAt: string | null;
  fileCount: number;
  unresolvedFileCount: number;
  connectionStatus: string | null;
  accessExpired: boolean;
}> {
  const project = await getLinkedSamplyProject(orgId, releaseId);
  const connection = (
    await db
      .select({ status: samply_connections.status })
      .from(samply_connections)
      .where(eq(samply_connections.org_id, orgId))
      .limit(1)
  )[0];

  if (!project) {
    return {
      configured: Boolean(connection),
      projectLinked: false,
      lastSyncedAt: null,
      fileCount: 0,
      unresolvedFileCount: 0,
      connectionStatus: connection?.status ?? null,
      accessExpired: connection?.status === "expired",
    };
  }

  const [fileCountRow, unresolvedFileCountRow] = await Promise.all([
    db.select({ count: sql<string>`count(*)` }).from(samply_files).where(and(
      eq(samply_files.org_id, orgId),
      eq(samply_files.samply_project_id, project.id),
      ne(samply_files.sync_status, "missing_remote"),
    )),
    db.select({ count: sql<string>`count(*)` }).from(samply_files).where(and(
      eq(samply_files.org_id, orgId),
      eq(samply_files.samply_project_id, project.id),
      ne(samply_files.sync_status, "missing_remote"),
      ne(samply_files.sync_status, "synced"),
    )),
  ]);

  return {
    configured: Boolean(connection),
    projectLinked: true,
    lastSyncedAt: project.lastSyncedAt?.toISOString() ?? null,
    fileCount: Number(fileCountRow[0]?.count ?? 0),
    unresolvedFileCount: Number(unresolvedFileCountRow[0]?.count ?? 0),
    connectionStatus: connection?.status ?? null,
    accessExpired: connection?.status === "expired",
  };
}

export async function ensureReleaseSamplyReview(
  orgId: string,
  releaseId: string,
): Promise<ReleaseSamplyReview> {
  const release = await getReleaseSummary(orgId, releaseId);
  const existing = await getReleaseSamplyReview(orgId, releaseId);
  if (existing.player) {
    await markSamplyConnectionVerified(orgId);
    return existing;
  }

  let project = existing.project;

  if (!project) {
    const remoteProject = await createSamplyProject(orgId, {
      name: buildProjectName(release),
    });
    return attachReleaseToRemoteProject(orgId, release, remoteProject);
  }

  const players = await listSamplyPlayers(orgId);
  const remotePlayer = pickPrimaryRemotePlayer(players, project.remoteProjectId)
    ?? await createDefaultReviewPlayer(orgId, project.remoteProjectId, release);

  await persistLinkedProjectAndPlayer(orgId, release.id, release, await getSamplyProject(orgId, project.remoteProjectId), remotePlayer);
  await markSamplyConnectionVerified(orgId);
  return getReleaseSamplyReview(orgId, releaseId);
}

export async function linkReleaseToSamplyProject(
  orgId: string,
  releaseId: string,
  remoteProjectId: string,
): Promise<ReleaseSamplyReview> {
  const release = await getReleaseSummary(orgId, releaseId);
  const remoteProject = await getSamplyProject(orgId, remoteProjectId);
  return attachReleaseToRemoteProject(orgId, release, remoteProject);
}

export async function listLinkableSamplyProjects(orgId: string): Promise<LinkableSamplyProject[]> {
  const [remoteProjects, localLinks] = await Promise.all([
    listSamplyProjects(orgId),
    db
      .select({
        remoteProjectId: samply_projects.remote_project_id,
        releaseId: samply_projects.release_id,
        releaseTitle: releases.title,
      })
      .from(samply_projects)
      .leftJoin(releases, and(eq(samply_projects.release_id, releases.id), eq(releases.org_id, orgId)))
      .where(eq(samply_projects.org_id, orgId)),
  ]);

  const localByRemoteId = new Map<string, { releaseId: string | null; releaseTitle: string | null }>(
    localLinks.map((row) => [
      row.remoteProjectId,
      {
        releaseId: row.releaseId ?? null,
        releaseTitle: row.releaseTitle ?? null,
      },
    ]),
  );

  return remoteProjects
    .map((project: SamplyProjectSummary) => ({
      id: project.id,
      name: project.name,
      creatorEmail: project.creator?.email ?? null,
      uploadEnabled: Boolean(project.upload?.enabled),
      size: Number(project.size ?? 0),
      timeModified: project.timeModified ?? null,
      linkedReleaseId: localByRemoteId.get(project.id)?.releaseId ?? null,
      linkedReleaseTitle: localByRemoteId.get(project.id)?.releaseTitle ?? null,
    }))
    .sort((a: LinkableSamplyProject, b: LinkableSamplyProject) => (b.timeModified ?? 0) - (a.timeModified ?? 0));
}

export async function syncReleaseFromSamplyProject(
  orgId: string,
  releaseId: string,
): Promise<ReleaseSamplyReview> {
  const release = await getReleaseSummary(orgId, releaseId);
  const projectRow = await getLinkedSamplyProject(orgId, releaseId);
  if (!projectRow) {
    throw new NotFoundError("No Samply project is linked to this release");
  }

  const [remoteProject, remoteBoxes] = await Promise.all([
    getSamplyProject(orgId, projectRow.remoteProjectId),
    listSamplyProjectFiles(orgId, projectRow.remoteProjectId),
  ]);

  const candidates = deriveCanonicalTrackCandidates(remoteBoxes);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(samply_projects)
      .set({
        remote_project_name: remoteProject.name,
        upload_enabled: Boolean(remoteProject.upload?.enabled),
        last_synced_at: now,
        updated_at: now,
        metadata: {
          ...(projectRow.metadata ?? {}),
          source: "linked-project",
          syncAuthority: "samply",
          releaseTitle: release.title,
          artworkUrl: remoteProject.artwork ?? null,
          color: remoteProject.color ?? null,
          creatorEmail: remoteProject.creator?.email ?? null,
          timeCreated: remoteProject.timeCreated ?? null,
          timeModified: remoteProject.timeModified ?? null,
        },
      })
      .where(and(eq(samply_projects.id, projectRow.id), eq(samply_projects.org_id, orgId)));

    if (remoteProject.artwork && remoteProject.artwork !== release.coverArtUrl) {
      await tx
        .update(releases)
        .set({
          cover_art_url: remoteProject.artwork,
          updated_at: now,
        })
        .where(and(eq(releases.id, releaseId), eq(releases.org_id, orgId)));
    }

    const localTracks = await tx
      .select({
        id: tracks.id,
        title: tracks.title,
        audioUrl: tracks.audio_url,
        workId: tracks.work_id,
      })
      .from(tracks)
      .where(and(eq(tracks.org_id, orgId), eq(tracks.release_id, releaseId)))
      .orderBy(asc(tracks.position), asc(tracks.created_at));

    const existingMappings = await tx
      .select({
        id: samply_files.id,
        remoteBoxId: samply_files.remote_box_id,
        remoteStackId: samply_files.remote_stack_id,
        trackId: samply_files.track_id,
        syncStatus: samply_files.sync_status,
      })
      .from(samply_files)
      .where(and(eq(samply_files.org_id, orgId), eq(samply_files.samply_project_id, projectRow.id)));

    const mappedByBoxId = new Map(existingMappings.map((row) => [row.remoteBoxId, row]));
    const mappedByStackId = new Map(
      existingMappings
        .filter((row) => row.remoteStackId)
        .map((row) => [row.remoteStackId!, row]),
    );
    const seenRemoteBoxIds = new Set<string>();
    const touchedTrackIds = new Set<string>();

    for (const candidate of candidates) {
      for (const version of candidate.versions) {
        seenRemoteBoxIds.add(version.remoteBoxId);
      }

      const directMatch = mappedByBoxId.get(candidate.remoteBoxId)
        ?? (candidate.remoteStackId ? mappedByStackId.get(candidate.remoteStackId) : undefined);

      const trackId = selectMappedSamplyTrackId(directMatch?.trackId, localTracks);

      if (trackId) {
        await tx
          .update(tracks)
          .set({
            title: candidate.trackTitle,
            position: candidate.order,
            duration: candidate.duration,
            audio_url: buildReleaseSamplyAudioUrl(releaseId, candidate.remoteBoxId),
            updated_at: now,
          })
          .where(and(eq(tracks.id, trackId), eq(tracks.org_id, orgId)));
        touchedTrackIds.add(trackId);
      }

      for (const version of candidate.versions) {
        const existingVersionMapping = mappedByBoxId.get(version.remoteBoxId);
        await tx.insert(samply_files).values({
          id: existingVersionMapping?.id ?? crypto.randomUUID(),
          org_id: orgId,
          samply_project_id: projectRow.id,
          track_id: trackId,
          remote_box_id: version.remoteBoxId,
          remote_stack_id: version.remoteStackId,
          file_name: version.fileName,
          sync_status: trackId ? "synced" : "unmatched",
          last_synced_at: now,
          updated_at: now,
        }).onConflictDoUpdate({
          target: [samply_files.org_id, samply_files.remote_box_id],
          set: {
            track_id: trackId,
            remote_stack_id: version.remoteStackId,
            file_name: version.fileName,
            sync_status: trackId ? "synced" : "unmatched",
            last_synced_at: now,
            updated_at: now,
          },
        });
      }
    }

    for (const mapping of existingMappings) {
      if (seenRemoteBoxIds.has(mapping.remoteBoxId)) continue;
      await tx
        .update(samply_files)
        .set({
          sync_status: "missing_remote",
          last_synced_at: now,
          updated_at: now,
        })
        .where(and(eq(samply_files.id, mapping.id), eq(samply_files.org_id, orgId)));
    }

    const removableTrackIds = localTracks
      .filter((track) => !touchedTrackIds.has(track.id))
      .filter((track) => !track.workId)
      .filter((track) =>
        isSamplyManagedAudioUrl(track.audioUrl) ||
        isLegacySamplyProjectLink(track.audioUrl) ||
        /\[main\]$/i.test(track.title.trim())
      )
      .map((track) => track.id);

    for (const trackId of removableTrackIds) {
      await tx
        .update(samply_files)
        .set({
          track_id: null,
          updated_at: now,
        })
        .where(and(eq(samply_files.track_id, trackId), eq(samply_files.org_id, orgId)));
      await tx
        .delete(tracks)
        .where(and(eq(tracks.id, trackId), eq(tracks.org_id, orgId)));
    }

    for (const trackId of touchedTrackIds) {
      await persistTrackReadiness(trackId, tx, orgId);
    }
    await persistReleaseReadiness(releaseId, tx, orgId);
  });

  await markSamplyConnectionVerified(orgId);
  return getReleaseSamplyReview(orgId, releaseId);
}

export async function resolveReleaseSamplyDownload(
  orgId: string,
  releaseId: string,
  remoteBoxId: string,
): Promise<{ url: string; expires: number }> {
  const projectRow = await getLinkedSamplyProject(orgId, releaseId);
  if (!projectRow) {
    throw new NotFoundError("No Samply project is linked to this release");
  }

  const box = await getSamplyProjectFile(orgId, projectRow.remoteProjectId, remoteBoxId);
  if (box.object !== "file") {
    throw new NotFoundError("Samply audio file not found");
  }

  return getSamplyDownloadUrl(orgId, projectRow.remoteProjectId, remoteBoxId);
}

export async function listReleaseSamplyFileComments(
  orgId: string,
  releaseId: string,
  remoteBoxId: string,
): Promise<SamplyComment[]> {
  const projectRow = await getLinkedSamplyProject(orgId, releaseId);
  if (!projectRow) {
    throw new NotFoundError("No Samply project is linked to this release");
  }

  const mapping = (
    await db
      .select({ id: samply_files.id })
      .from(samply_files)
      .where(and(
        eq(samply_files.org_id, orgId),
        eq(samply_files.samply_project_id, projectRow.id),
        eq(samply_files.remote_box_id, remoteBoxId),
        ne(samply_files.sync_status, "missing_remote"),
      ))
      .limit(1)
  )[0];

  if (!mapping) {
    throw new NotFoundError("Samply audio file is not linked to this release");
  }

  return listSamplyComments(orgId, projectRow.remoteProjectId, remoteBoxId);
}

async function getReleaseSummary(orgId: string, releaseId: string): Promise<ReleaseSummary> {
  const row = (
    await db
      .select({
        id: releases.id,
        title: releases.title,
        artistName: artists.name,
        coverArtUrl: releases.cover_art_url,
      })
      .from(releases)
      .leftJoin(artists, and(eq(releases.artist_id, artists.id), eq(artists.org_id, orgId)))
      .where(and(eq(releases.org_id, orgId), eq(releases.id, releaseId)))
      .limit(1)
  )[0];

  if (!row) {
    throw new NotFoundError("Release not found");
  }

  return row;
}

async function getLinkedSamplyProject(
  orgId: string,
  releaseId: string,
): Promise<LocalSamplyProjectRow | null> {
  return (
    await db
      .select({
        id: samply_projects.id,
        remoteProjectId: samply_projects.remote_project_id,
        remoteProjectName: samply_projects.remote_project_name,
        uploadEnabled: samply_projects.upload_enabled,
        primaryPlayerId: samply_projects.primary_player_id,
        lastSyncedAt: samply_projects.last_synced_at,
        metadata: samply_projects.metadata,
      })
      .from(samply_projects)
      .where(and(eq(samply_projects.org_id, orgId), eq(samply_projects.release_id, releaseId)))
      .orderBy(desc(samply_projects.updated_at))
      .limit(1)
  )[0] ?? null;
}

function buildProjectName(release: ReleaseSummary): string {
  const artist = release.artistName?.trim();
  return artist ? `${artist} - ${release.title}` : release.title;
}

function buildPlayerName(release: ReleaseSummary): string {
  return `${release.title} Review`;
}

function buildReleaseSamplyAudioUrl(releaseId: string, remoteBoxId: string): string {
  return `/api/releases/${encodeURIComponent(releaseId)}/samply/files/${encodeURIComponent(remoteBoxId)}/download`;
}

export function deriveCanonicalTrackCandidates(boxes: SamplyBoxSummary[]): CanonicalSamplyTrackCandidate[] {
  const boxById = new Map(boxes.map((box) => [box.id, box]));
  const folderDescendantIds = collectFolderDescendantIds(boxes);
  const stackedChildIds = new Set(
    boxes
      .filter((box) => box.object === "stack" && !box.trashed)
      .flatMap((box) => box.children?.map((child) => child.id) ?? []),
  );

  // Samply returns `/all` in the project's configured order. Preserve that
  // order because projects using `sortBy: custom` must not be reordered by
  // timestamps when they are mirrored into the release tracklist.
  const orderedBoxes = boxes.filter((box) => {
    if (box.trashed || folderDescendantIds.has(box.id)) return false;
    if (box.object === "stack") return true;
    if (box.object !== "file") return false;
    return !stackedChildIds.has(box.id) && isProbablyAudioFile(box.name, box.duration);
  });

  const candidates = orderedBoxes.flatMap<CanonicalSamplyTrackCandidate>((box) => {
    if (box.object === "stack") {
      const versions = (box.children ?? [])
        .map((child, childIndex): CanonicalSamplyTrackVersion | null => {
          const childFile = boxById.get(child.id);
          if (!childFile || childFile.trashed || childFile.object !== "file" || !isProbablyAudioFile(childFile.name, childFile.duration)) {
            return null;
          }
          return {
            remoteBoxId: childFile.id,
            remoteStackId: box.id,
            fileName: childFile.name,
            duration: normalizeDuration(childFile.duration),
            label: child.name?.trim() || inferVersionLabel(childFile.name) || `v${childIndex + 1}`,
            primary: false,
          };
        })
        .filter((version): version is CanonicalSamplyTrackVersion => version !== null);
      if (!versions.length) return [];
      const primaryIndex = versions.length - 1;
      const primaryVersion = versions[primaryIndex]!;
      versions[primaryIndex] = { ...primaryVersion, primary: true };
      return [{
        trackTitle: stripAudioExtension(box.name),
        remoteBoxId: primaryVersion.remoteBoxId,
        remoteStackId: box.id,
        fileName: primaryVersion.fileName,
        duration: primaryVersion.duration,
        order: 0,
        versions,
      }];
    }

    return [{
      trackTitle: stripAudioExtension(box.name),
      remoteBoxId: box.id,
      remoteStackId: null,
      fileName: box.name,
      duration: normalizeDuration(box.duration),
      order: 0,
      versions: [{
        remoteBoxId: box.id,
        remoteStackId: null,
        fileName: box.name,
        duration: normalizeDuration(box.duration),
        label: inferVersionLabel(box.name) || "Main",
        primary: true,
      }],
    }];
  });

  return candidates.map((candidate, index) => ({ ...candidate, order: index + 1 }));
}

export function selectMappedSamplyTrackId(
  mappedTrackId: string | null | undefined,
  localTracks: Array<{ id: string; workId: string | null }>,
): string | null {
  if (!mappedTrackId) return null;
  return localTracks.some((track) => track.id === mappedTrackId && track.workId)
    ? mappedTrackId
    : null;
}

function collectFolderDescendantIds(boxes: SamplyBoxSummary[]): Set<string> {
  const boxById = new Map(boxes.map((box) => [box.id, box]));
  const descendants = new Set<string>();
  const visit = (id: string) => {
    if (descendants.has(id)) return;
    descendants.add(id);
    const box = boxById.get(id);
    for (const child of box?.children ?? []) {
      visit(child.id);
    }
  };

  for (const folder of boxes.filter((box) => box.object === "folder" && !box.trashed)) {
    for (const child of folder.children ?? []) {
      visit(child.id);
    }
  }

  return descendants;
}

function normalizeDuration(value: number | null | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.max(0, Math.round(value));
}

function stripAudioExtension(value: string): string {
  return value.trim().replace(/\.[a-z0-9]{2,5}$/i, "");
}

function inferVersionLabel(value: string): string | null {
  return value.match(/\bv\d+(?:\.\d+)?\b/i)?.[0] ?? null;
}

function isProbablyAudioFile(name: string, duration: number | null | undefined): boolean {
  if (typeof duration === "number" && duration > 0) return true;
  return /\.(mp3|wav|aif|aiff|flac|m4a|aac|ogg|opus)$/i.test(name);
}

function isSamplyManagedAudioUrl(value: string | null): boolean {
  return Boolean(value?.startsWith("/api/releases/") && value.includes("/samply/files/"));
}

function isLegacySamplyProjectLink(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.hostname.includes("samply") && url.pathname.includes("/p/");
  } catch {
    return false;
  }
}

async function attachReleaseToRemoteProject(
  orgId: string,
  release: ReleaseSummary,
  remoteProject: SamplyProjectSummary,
): Promise<ReleaseSamplyReview> {
  const players = await listSamplyPlayers(orgId);
  const remotePlayer = pickPrimaryRemotePlayer(players, remoteProject.id)
    ?? await tryCreateDefaultReviewPlayer(orgId, remoteProject.id, release);

  await persistLinkedProjectAndPlayer(orgId, release.id, release, remoteProject, remotePlayer);
  await markSamplyConnectionVerified(orgId);
  return getReleaseSamplyReview(orgId, release.id);
}

async function tryCreateDefaultReviewPlayer(
  orgId: string,
  remoteProjectId: string,
  release: ReleaseSummary,
): Promise<SamplyPlayerSummary | null> {
  try {
    return await createDefaultReviewPlayer(orgId, remoteProjectId, release);
  } catch (error) {
    if (typeof error === "object" && error !== null && "status" in error && (error as { status?: number }).status === 403) {
      return null;
    }
    throw error;
  }
}

async function persistLinkedProjectAndPlayer(
  orgId: string,
  releaseId: string,
  release: ReleaseSummary,
  remoteProject: SamplyProjectSummary,
  remotePlayer: SamplyPlayerSummary | null,
): Promise<void> {
  const conflictingLink = (
    await db
      .select({
        id: samply_projects.id,
        releaseId: samply_projects.release_id,
      })
      .from(samply_projects)
      .where(and(
        eq(samply_projects.org_id, orgId),
        eq(samply_projects.remote_project_id, remoteProject.id),
        ne(samply_projects.release_id, releaseId),
      ))
      .limit(1)
  )[0];

  if (conflictingLink?.releaseId) {
    throw new ConflictError("This Samply project is already linked to another release");
  }

  const now = new Date();
  const existingRemoteProject = (
    await db
      .select({ id: samply_projects.id, releaseId: samply_projects.release_id })
      .from(samply_projects)
      .where(and(eq(samply_projects.org_id, orgId), eq(samply_projects.remote_project_id, remoteProject.id)))
      .limit(1)
  )[0];

  const localProjectId = existingRemoteProject?.id ?? crypto.randomUUID();
  const localPlayerId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx
      .update(samply_projects)
      .set({
        release_id: null,
        updated_at: now,
      })
      .where(and(eq(samply_projects.org_id, orgId), eq(samply_projects.release_id, releaseId), ne(samply_projects.id, localProjectId)));

    if (existingRemoteProject) {
      await tx
        .update(samply_projects)
        .set({
          release_id: releaseId,
          remote_project_name: remoteProject.name,
          upload_enabled: Boolean(remoteProject.upload?.enabled),
          last_synced_at: now,
          updated_at: now,
          metadata: {
            source: existingRemoteProject.releaseId ? "release-review" : "linked-project",
            syncAuthority: "samply",
            releaseTitle: release.title,
            artworkUrl: remoteProject.artwork ?? null,
            color: remoteProject.color ?? null,
            creatorEmail: remoteProject.creator?.email ?? null,
            timeCreated: remoteProject.timeCreated ?? null,
            timeModified: remoteProject.timeModified ?? null,
          },
        })
        .where(and(eq(samply_projects.id, localProjectId), eq(samply_projects.org_id, orgId)));
    } else {
      await tx.insert(samply_projects).values({
        id: localProjectId,
        org_id: orgId,
        release_id: releaseId,
        remote_project_id: remoteProject.id,
        remote_project_name: remoteProject.name,
        upload_enabled: Boolean(remoteProject.upload?.enabled),
        last_synced_at: now,
        updated_at: now,
        metadata: {
          source: "linked-project",
          syncAuthority: "samply",
          releaseTitle: release.title,
          artworkUrl: remoteProject.artwork ?? null,
          color: remoteProject.color ?? null,
          creatorEmail: remoteProject.creator?.email ?? null,
          timeCreated: remoteProject.timeCreated ?? null,
          timeModified: remoteProject.timeModified ?? null,
        },
      });
    }

    if (remotePlayer) {
      await tx.insert(samply_players).values({
        id: localPlayerId,
        org_id: orgId,
        samply_project_id: localProjectId,
        release_id: releaseId,
        remote_player_id: remotePlayer.id,
        player_type: "review",
        name: remotePlayer.name,
        embed_url: buildSamplyEmbedUrl(remotePlayer.id, remotePlayer.color ?? null),
        share_url: null,
        public: Boolean(remotePlayer.public),
        downloads_enabled: Boolean(remotePlayer.options?.downloads),
        comments_enabled: Boolean(remotePlayer.options?.comments),
        quality: remotePlayer.options?.quality ?? null,
        updated_at: now,
      }).onConflictDoUpdate({
        target: [samply_players.org_id, samply_players.remote_player_id],
        set: {
          samply_project_id: localProjectId,
          release_id: releaseId,
          name: remotePlayer.name,
          embed_url: buildSamplyEmbedUrl(remotePlayer.id, remotePlayer.color ?? null),
          public: Boolean(remotePlayer.public),
          downloads_enabled: Boolean(remotePlayer.options?.downloads),
          comments_enabled: Boolean(remotePlayer.options?.comments),
          quality: remotePlayer.options?.quality ?? null,
          updated_at: now,
        },
      });

      await tx
        .update(samply_projects)
        .set({
          primary_player_id: sql`(
            select id from ${samply_players}
            where ${samply_players.org_id} = ${orgId}
              and ${samply_players.remote_player_id} = ${remotePlayer.id}
            limit 1
          )`,
          updated_at: now,
        })
        .where(and(eq(samply_projects.id, localProjectId), eq(samply_projects.org_id, orgId)));
    }
  });
}

function pickPrimaryRemotePlayer(
  players: SamplyPlayerSummary[],
  remoteProjectId: string,
): SamplyPlayerSummary | null {
  const scoped = players
    .filter((player) => player.projectid === remoteProjectId)
    .sort((a, b) => (b.timeModified ?? 0) - (a.timeModified ?? 0));

  if (!scoped.length) return null;

  return scoped.find((player) => !player.folderid && !(player.boxids?.length)) ?? scoped[0];
}

async function createDefaultReviewPlayer(
  orgId: string,
  remoteProjectId: string,
  release: ReleaseSummary,
): Promise<SamplyPlayerSummary> {
  return createSamplyPlayer(orgId, {
    name: buildPlayerName(release),
    projectid: remoteProjectId,
    public: false,
    options: {
      quality: "lossless",
      metadata: true,
      isrc: true,
      downloads: false,
      comments: true,
      loudnessMatch: false,
      studio: false,
      stacks: true,
      samplyCTA: false,
      boxSubtitle: "artist",
    },
  });
}

async function markSamplyConnectionVerified(orgId: string): Promise<void> {
  const now = new Date();
  await db.insert(samply_connections).values({
    id: `samply:${orgId}`,
    org_id: orgId,
    label: "Samply",
    base_url: process.env.SAMPLY_BASE_URL?.trim() || "https://samply.app/api/v0",
    status: "verified",
    last_checked_at: now,
    updated_at: now,
  }).onConflictDoUpdate({
    target: samply_connections.org_id,
    set: {
      base_url: process.env.SAMPLY_BASE_URL?.trim() || "https://samply.app/api/v0",
      status: "verified",
      last_checked_at: now,
      updated_at: now,
    },
  });
}
