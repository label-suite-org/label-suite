import { randomBytes } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, pool, runWithDatabaseContext } from "../lib/db";
import { artists, campaigns, contacts, ops_tasks, pitches, releases, sync_deals, tracks } from "../db/schema";
import { pitchDraftSchema, pitchFollowupSchema, pitchPlayerInput, pitchPlayerMatches, pitchPublicPath, type PitchRecording } from "../lib/pitches";
import { HttpError } from "./errors";
import { getReleaseSamplyReview } from "./samply-release";
import { SamplyApiError, buildSamplyEmbedUrl, createSamplyPlayer, getSamplyAvailability, getSamplyPlayer, listSamplyPlayers, listSamplyProjectFiles, updateSamplyPlayer } from "./samply";

const wherePitch = (org: string, id: string) => and(eq(pitches.org_id, org), eq(pitches.id, id));

export async function pitchOptions(org: string, campaignId: string | null, syncId: string | null, releaseId?: string) {
  if (Boolean(campaignId) === Boolean(syncId)) throw new HttpError("Choose one campaign or sync opportunity", 400);
  const table = campaignId ? campaigns : sync_deals;
  const [context] = await db.select().from(table).where(and(eq(table.org_id, org), eq(table.id, (campaignId ?? syncId)!)));
  if (!context) throw new HttpError("Pitch context not found", 404);
  const selectedRelease = releaseId || ("linked_release_id" in context ? context.linked_release_id : context.release_id);
  const [releaseRows, contactRows, review] = await Promise.all([
    db.select({ id: releases.id, title: releases.title }).from(releases).where(eq(releases.org_id, org)).orderBy(asc(releases.title)),
    db.select({ id: contacts.id, name: contacts.name, email: contacts.email }).from(contacts).where(eq(contacts.org_id, org)).orderBy(asc(contacts.name)),
    selectedRelease ? getReleaseSamplyReview(org, selectedRelease) : null,
  ]);
  if (selectedRelease && !releaseRows.some(r => r.id === selectedRelease)) throw new HttpError("Release not found", 404);
  return {
    campaignId, syncId, contextTitle: "campaign_name" in context ? context.campaign_name : context.production,
    releaseId: selectedRelease ?? "", releases: releaseRows, contacts: contactRows,
    contactId: "contact_id" in context ? context.contact_id : null,
    files: review?.inventory.filter(file => file.trackId && file.syncStatus === "synced") ?? [],
    configured: getSamplyAvailability(org).configured,
  };
}

export async function listPitches(org: string, campaignId: string | null, syncId: string | null) {
  await pitchOptions(org, campaignId, syncId);
  return db.select({ id: pitches.id, title: pitches.title, status: pitches.status, link_state: pitches.link_state, recipient: contacts.name, sent_date: pitches.sent_date, due_date: ops_tasks.due_date, next_action: ops_tasks.task_name, task_status: ops_tasks.status })
    .from(pitches)
    .innerJoin(contacts, and(eq(contacts.id, pitches.contact_id), eq(contacts.org_id, org)))
    .leftJoin(ops_tasks, and(eq(ops_tasks.id, pitches.task_id), eq(ops_tasks.org_id, org)))
    .where(and(eq(pitches.org_id, org), campaignId ? eq(pitches.campaign_id, campaignId) : eq(pitches.sync_deal_id, syncId!)))
    .orderBy(desc(pitches.updated_at));
}

export async function getPitch(org: string, id: string) {
  const [row] = await db.select().from(pitches).where(wherePitch(org, id));
  if (!row) throw new HttpError("Pitch not found", 404);
  const [contact] = await db.select({ name: contacts.name, email: contacts.email }).from(contacts).where(and(eq(contacts.org_id, org), eq(contacts.id, row.contact_id)));
  const [task] = row.task_id ? await db.select().from(ops_tasks).where(and(eq(ops_tasks.org_id, org), eq(ops_tasks.id, row.task_id))) : [];
  return { ...row, recipient: contact?.name ?? "Unknown contact", recipient_email: contact?.email ?? null, next_action: task?.task_name ?? "", due_date: task?.due_date ?? null, task_status: task?.status ?? null, public_path: row.link_state === "ready" ? pitchPublicPath(org, row.token) : null };
}

export async function savePitch(org: string, raw: unknown) {
  const input = pitchDraftSchema.parse(raw);
  return db.transaction(async tx => {
    const [before] = await tx.select().from(pitches).where(wherePitch(org, input.id)).for("update");
    if ((before?.version ?? 0) !== input.expected_version) throw new HttpError("Pitch changed; reload before saving", 409);
    if (before && before.link_state !== "draft") throw new HttpError("The shared recording selection is frozen. Create a new pitch for different content.", 409);
    const options = await pitchOptions(org, input.campaign_id, input.sync_deal_id, input.release_id);
    if (!options.contacts.some(c => c.id === input.contact_id)) throw new HttpError("Recipient not found in this workspace", 404);
    const review = await getReleaseSamplyReview(org, input.release_id);
    if (!review.project) throw new HttpError("Link and sync this release with Samply first", 400);
    const recordings: PitchRecording[] = [];
    for (const id of input.file_ids) {
      const file = options.files.find(f => f.id === id);
      if (!file?.trackId) throw new HttpError("A selected recording is unavailable; sync the release and select it again", 400);
      const [track] = await tx.select().from(tracks).where(and(eq(tracks.id, file.trackId), eq(tracks.org_id, org), eq(tracks.release_id, input.release_id)));
      if (!track) throw new HttpError("Recording does not belong to this release", 400);
      recordings.push({ file_id: id, track_id: track.id, box_id: file.remoteBoxId, title: track.title, file_name: file.fileName, version: file.version, isrc: track.isrc });
    }
    const [release] = await tx.select({ artwork: releases.cover_art_url, artist: artists.name }).from(releases)
      .leftJoin(artists, and(eq(artists.id, releases.artist_id), eq(artists.org_id, org)))
      .where(and(eq(releases.org_id, org), eq(releases.id, input.release_id)));
    const values = {
      campaign_id: input.campaign_id, sync_deal_id: input.sync_deal_id, release_id: input.release_id, contact_id: input.contact_id,
      title: input.title, message: input.message, credits: input.credits, rights_note: input.rights_note, reply_email: input.reply_email,
      artist_name: release.artist ?? "", artwork_url: release.artwork?.startsWith("https://") ? release.artwork : null,
      remote_project_id: review.project.remoteProjectId, recordings, downloads: input.downloads,
      version: input.expected_version + 1, updated_at: new Date(),
    };
    if (before) await tx.update(pitches).set(values).where(wherePitch(org, input.id));
    else await tx.insert(pitches).values({ ...values, id: input.id, org_id: org, token: randomBytes(32).toString("hex") });
    return getPitch(org, input.id);
  });
}

export async function savePitchFollowup(org: string, raw: unknown) {
  const input = pitchFollowupSchema.parse(raw);
  return db.transaction(async tx => {
    const [pitch] = await tx.select().from(pitches).where(wherePitch(org, input.id)).for("update");
    if (!pitch) throw new HttpError("Pitch not found", 404);
    if (pitch.version !== input.expected_version) throw new HttpError("Pitch changed; reload before saving", 409);
    if (input.sent_date && !pitch.sent_date && pitch.link_state !== "ready") throw new HttpError("Create a listening link before recording a send", 400);
    let taskId = pitch.task_id;
    if (input.next_action) {
      taskId ??= crypto.randomUUID();
      const task = { task_name: input.next_action, due_date: input.due_date, linked_release_id: pitch.release_id, linked_campaign_id: pitch.campaign_id, linked_contact_id: pitch.contact_id, updated_at: new Date() };
      if (pitch.task_id) {
        const [previous] = await tx.select().from(ops_tasks).where(and(eq(ops_tasks.id, taskId), eq(ops_tasks.org_id, org)));
        await tx.update(ops_tasks).set({ ...task, status: previous.task_name === input.next_action && previous.due_date === input.due_date ? previous.status : "todo" }).where(and(eq(ops_tasks.id, taskId), eq(ops_tasks.org_id, org)));
      }
      else await tx.insert(ops_tasks).values({ id: taskId, org_id: org, ...task, notes: `Pitch: /pitches/${pitch.id}` });
    } else if (taskId) {
      await tx.update(ops_tasks).set({ status: "done", updated_at: new Date() }).where(and(eq(ops_tasks.id, taskId), eq(ops_tasks.org_id, org)));
    }
    await tx.update(pitches).set({ status: input.status, sent_date: input.sent_date, response_note: input.response_note, task_id: taskId, version: pitch.version + 1, updated_at: new Date() }).where(wherePitch(org, input.id));
    return getPitch(org, input.id);
  });
}

// Called by the dedicated link route outside the request-wide transaction.
// Commit the reservation BEFORE any provider write. An uncertain create is
// recovered by its unique name, never by blindly creating a second link.
export async function changePitchLink(org: string, actor: string, id: string, action: "create" | "revoke", expectedVersion: number) {
  if (!getSamplyAvailability(org).configured) throw new HttpError("Samply is not configured for this workspace", 503);
  // A session lock spans the independently committed reservation/provider steps.
  // Concurrent recovery must not republish a player while another request revokes it.
  const lock = await pool.connect();
  let locked = false;
  try {
    const result = await lock.query("select pg_try_advisory_lock(hashtext($1),hashtext($2)) as locked", [org, `pitch:${id}`]);
    locked = result.rows[0].locked;
    if (!locked) throw new HttpError("This listening link is being updated. Wait for it to finish, then reload.", 409);
    return await changeReservedPitchLink(org, actor, id, action, expectedVersion);
  } finally {
    try { if (locked) await lock.query("select pg_advisory_unlock(hashtext($1),hashtext($2))", [org, `pitch:${id}`]); }
    finally { lock.release(); }
  }
}

async function changeReservedPitchLink(org: string, actor: string, id: string, action: "create" | "revoke", expectedVersion: number) {
  const context = { orgId: org, userId: actor };
  let preflightPlayers: Awaited<ReturnType<typeof listSamplyPlayers>> | undefined;
  const reservation = await runWithDatabaseContext(context, async () => {
    const [pitch] = await db.select().from(pitches).where(wherePitch(org, id)).for("update");
    if (!pitch) throw new HttpError("Pitch not found", 404);
    if (pitch.version !== expectedVersion) throw new HttpError("Pitch changed; reload before changing the link", 409);
    if (action === "revoke") {
      if (!["ready", "revoking", "revoked"].includes(pitch.link_state) && !(pitch.link_state === "preparing" && pitch.player_id)) throw new HttpError("Recover the Samply player before revoking it", 409);
      if (pitch.link_state !== "revoked") await db.update(pitches).set({ link_state: "revoking", version: pitch.version + 1, updated_at: new Date() }).where(wherePitch(org, id));
      return { pitch, create: false };
    }
    if (!["draft", "preparing", "ready"].includes(pitch.link_state)) throw new HttpError("This link was revoked; create a new pitch", 409);
    if (pitch.link_state === "draft") {
      // Read-only preflight failures leave the draft editable. Reserve only
      // after confirming each selected ID is an individual provider file.
      const files = await listSamplyProjectFiles(org, pitch.remote_project_id);
      if (!pitch.recordings.every(recording => files.some(file => file.id === recording.box_id && file.object === "file" && !file.trashed))) {
        throw new HttpError("A selected Samply file is missing or is a folder/version stack. Sync the release and select its individual files.", 409);
      }
      preflightPlayers = await listSamplyPlayers(org);
    }
    if (pitch.link_state === "draft") await db.update(pitches).set({ link_state: "preparing", version: pitch.version + 1, updated_at: new Date() }).where(wherePitch(org, id));
    return { pitch, create: pitch.link_state === "draft" };
  });
  const pitch = reservation.pitch;
  if (action === "revoke") {
    if (pitch.link_state === "revoked") return runWithDatabaseContext(context, () => getPitch(org, id));
    await updateSamplyPlayer(org, pitch.player_id!, { public: false });
    if ((await getSamplyPlayer(org, pitch.player_id!)).public) throw new HttpError("The page is hidden, but Samply access could not be revoked. Retry revocation.", 502);
    return runWithDatabaseContext(context, async () => {
      await db.update(pitches).set({ link_state: "revoked", updated_at: new Date() }).where(wherePitch(org, id));
      return getPitch(org, id);
    });
  }
  if (pitch.link_state === "ready") return runWithDatabaseContext(context, () => getPitch(org, id));

  let playerId = pitch.player_id;
  if (!playerId) {
    const input = pitchPlayerInput(pitch);
    const matches = (preflightPlayers ?? await listSamplyPlayers(org)).filter(player => player.name === input.name && player.projectid === input.projectid);
    if (matches.length > 1) throw new HttpError("Multiple matching Samply links need review before continuing", 409);
    let player = matches[0] ?? null;
    if (!player && reservation.create) {
      try { player = await createSamplyPlayer(org, input); }
      catch (error) {
        // An explicit authentication/permission rejection did not create a link.
        // Keep timeouts and other uncertain outcomes reserved for recovery.
        if (error instanceof SamplyApiError && [401, 403].includes(error.status)) {
          await runWithDatabaseContext(context, () => db.update(pitches).set({ link_state: "draft", updated_at: new Date() }).where(and(wherePitch(org, id), eq(pitches.link_state, "preparing"))));
          throw new HttpError("Samply denied link creation. Check the configured token's player-write access, then retry. Your draft is still editable.", error.status);
        }
        throw error;
      }
    }
    if (!player) throw new HttpError("The previous Samply create has an unconfirmed outcome. Check Samply before retrying; no duplicate link was created.", 409);
    playerId = player.id;
    await runWithDatabaseContext(context, async () => {
      await db.update(pitches).set({ player_id: playerId, updated_at: new Date() }).where(and(wherePitch(org, id), eq(pitches.link_state, "preparing")));
    });
  }
  const player = await getSamplyPlayer(org, playerId);
  if (!pitchPlayerMatches(player, pitch)) {
    if (player.public) await updateSamplyPlayer(org, playerId, { public: false });
    throw new HttpError("Samply link contents or permissions differ from this pitch. Review the link in Samply before continuing.", 409);
  }
  // API-created players can have an internal UUID and a different public share
  // ID in playerUrl. Keep the internal ID for API updates and revocation.
  let embedId = player.id;
  if (player.playerUrl) {
    const url = new URL(player.playerUrl);
    const path = url.pathname.match(/^\/(?:p|player)\/([A-Za-z0-9_-]+)\/?$/);
    const shareId = url.searchParams.get("token") ?? path?.[1];
    if (url.origin !== "https://samply.app" || url.username || url.password || !path || !shareId || !/^[A-Za-z0-9_-]{1,160}$/.test(shareId)) {
      throw new HttpError("Samply returned an unsupported listening link. Review the player before continuing.", 502);
    }
    embedId = shareId;
  }
  await updateSamplyPlayer(org, playerId, { public: true });
  const verified = await getSamplyPlayer(org, playerId);
  if (!verified.public || !pitchPlayerMatches(verified, pitch)) {
    await updateSamplyPlayer(org, playerId, { public: false });
    throw new HttpError("Samply did not confirm the selected files and access settings", 502);
  }
  return runWithDatabaseContext(context, async () => {
    await db.update(pitches).set({ link_state: "ready", player_embed_id: embedId, updated_at: new Date() }).where(and(wherePitch(org, id), eq(pitches.link_state, "preparing")));
    return getPitch(org, id);
  });
}

export async function getPublicPitch(org: string, token: string) {
  const [pitch] = await db.select().from(pitches).where(and(eq(pitches.org_id, org), eq(pitches.token, token), eq(pitches.link_state, "ready")));
  if (!pitch?.player_id || !pitch.player_embed_id) return null;
  // Explicit projection: never expose recipient data, notes, tasks, deal terms,
  // or the provider project id to a bearer-link visitor.
  return { title: pitch.title, message: pitch.message, credits: pitch.credits, rights_note: pitch.rights_note, reply_email: pitch.reply_email,
    artist_name: pitch.artist_name, artwork_url: pitch.artwork_url, downloads: pitch.downloads,
    download_url: pitch.downloads ? `https://samply.app/p/${encodeURIComponent(pitch.player_embed_id)}` : null,
    recordings: pitch.recordings.map(file => ({ title: file.title, file_name: file.file_name, version: file.version, isrc: file.isrc })),
    embed_url: buildSamplyEmbedUrl(pitch.player_embed_id) };
}
