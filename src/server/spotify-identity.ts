import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  artists,
  integration_connections,
  integration_providers,
  releases,
  tracks,
} from "../db/schema";
import { db } from "../lib/db";
import { HttpError, NotFoundError } from "./errors";
import { recordAuditEvent, upsertExternalObjectLink } from "./integrations";
import {
  proposeSpotifyIdentity as proposeSpotifyIdentityCore,
  type SpotifyCatalogCandidate,
  type SpotifyIdentityInput,
} from "./spotify-identity-core";
import { resolveSpotifyIdentityLink } from "./spotify-identity-link";
import { idSchema, nullableText, requiredText } from "./validation";

export const spotifyIdentityInputSchema = z.object({
  object_type: z.enum(["artist", "album", "track"]),
  external_id: requiredText,
  external_url: nullableText,
  name: requiredText,
  artist_name: nullableText,
  isrc: nullableText,
  upc_ean: nullableText,
}).strict();

export const spotifyIdentityProposalSchema = z.union([
  z.object({ spotify_url: z.string().trim().min(1).max(2048) }).strict(),
  spotifyIdentityInputSchema,
]);

export const confirmSpotifyIdentitySchema = z.object({
  connection_id: idSchema,
  object_type: z.enum(["artist", "album", "track"]),
  external_id: requiredText,
  external_url: nullableText,
  label_suite_object_type: z.enum(["artist", "release", "track"]),
  label_suite_object_id: idSchema,
  match_method: z.enum(["isrc", "upc", "title_artist"]),
  match_confidence: z.number().int().min(0).max(100),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export function spotifyIdentityEnrichmentEnabled() {
  return process.env.SPOTIFY_IDENTITY_ENRICHMENT_ENABLED === "true";
}

function requireSpotifyIdentityFlag() {
  if (!spotifyIdentityEnrichmentEnabled()) {
    throw new HttpError("Spotify identity enrichment is not enabled", 404);
  }
}

async function listCandidates(orgId: string, objectType: SpotifyIdentityInput["object_type"]): Promise<SpotifyCatalogCandidate[]> {
  if (objectType === "artist") {
    const rows = await db.select({ id: artists.id, title: artists.name }).from(artists).where(eq(artists.org_id, orgId));
    return rows.map((row) => ({ object_type: "artist", object_id: row.id, title: row.title }));
  }
  if (objectType === "album") {
    const rows = await db.select({ id: releases.id, title: releases.title, artist_name: artists.name, upc_ean: releases.upc_ean })
      .from(releases)
      .leftJoin(artists, eq(releases.artist_id, artists.id))
      .where(eq(releases.org_id, orgId));
    return rows.map((row) => ({ object_type: "album", object_id: row.id, title: row.title, artist_name: row.artist_name, upc_ean: row.upc_ean }));
  }
  const rows = await db.select({ id: tracks.id, title: tracks.title, artist_name: artists.name, isrc: tracks.isrc })
    .from(tracks)
    .leftJoin(releases, eq(tracks.release_id, releases.id))
    .leftJoin(artists, eq(releases.artist_id, artists.id))
    .where(eq(tracks.org_id, orgId));
  return rows.map((row) => ({ object_type: "track", object_id: row.id, title: row.title, artist_name: row.artist_name, isrc: row.isrc }));
}

export async function proposeSpotifyIdentity(orgId: string, raw: z.input<typeof spotifyIdentityProposalSchema>) {
  requireSpotifyIdentityFlag();
  const request = spotifyIdentityProposalSchema.parse(raw);
  const input = "spotify_url" in request ? await resolveSpotifyIdentityLink(request.spotify_url) : request;
  const proposal = proposeSpotifyIdentityCore(input, await listCandidates(orgId, input.object_type));
  return {
    provider_key: "spotify",
    input,
    ...proposal,
    confirmation_required: true,
  };
}

export async function confirmSpotifyIdentity(orgId: string, raw: z.input<typeof confirmSpotifyIdentitySchema>, actorUserId: string | null = null) {
  requireSpotifyIdentityFlag();
  const input = confirmSpotifyIdentitySchema.parse(raw);
  const [connection] = await db.select({ id: integration_connections.id, provider_key: integration_providers.key })
    .from(integration_connections)
    .innerJoin(integration_providers, eq(integration_connections.provider_id, integration_providers.id))
    .where(and(eq(integration_connections.org_id, orgId), eq(integration_connections.id, input.connection_id), eq(integration_connections.status, "connected")))
    .limit(1);
  if (!connection || connection.provider_key !== "spotify") throw new NotFoundError("Connected Spotify integration not found in active workspace");

  const table = input.label_suite_object_type === "artist" ? artists : input.label_suite_object_type === "release" ? releases : tracks;
  const [target] = await db.select({ id: table.id }).from(table)
    .where(and(eq(table.org_id, orgId), eq(table.id, input.label_suite_object_id))).limit(1);
  if (!target) throw new NotFoundError("Spotify identity target not found in active workspace");

  const link = await upsertExternalObjectLink(orgId, {
    connection_id: input.connection_id,
    provider_key: "spotify",
    external_object_type: input.object_type,
    external_object_id: input.external_id,
    external_object_url: input.external_url ?? null,
    label_suite_object_type: input.label_suite_object_type,
    label_suite_object_id: input.label_suite_object_id,
    match_method: input.match_method,
    match_confidence: input.match_confidence,
    status: "active",
    metadata: { ...(input.metadata ?? {}), confirmation: "human", confirmed_by: actorUserId },
  });
  await recordAuditEvent(orgId, {
    actor_user_id: actorUserId,
    actor_type: "user",
    event_type: "spotify_identity_confirmed",
    object_type: input.label_suite_object_type,
    object_id: input.label_suite_object_id,
    metadata: { provider_key: "spotify", external_object_type: input.object_type, external_object_id: input.external_id, match_method: input.match_method, match_confidence: input.match_confidence },
  });
  return link;
}
