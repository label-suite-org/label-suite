import { z } from "zod";
import { HttpError } from "./errors";
import type { SpotifyIdentityInput } from "./spotify-identity-core";

const metadataSchema = z.object({
  type: z.enum(["artist", "album", "track"]),
  id: z.string(),
  name: z.string().trim().min(1),
  artists: z.array(z.object({ name: z.string().trim().min(1) })).optional(),
  external_ids: z.object({ isrc: z.string().optional(), upc: z.string().optional(), ean: z.string().optional() }).optional(),
});

export async function resolveSpotifyIdentityLink(link: string): Promise<SpotifyIdentityInput> {
  const match = /^(?:spotify:(artist|album|track):|https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(artist|album|track)\/)([A-Za-z0-9]{22})(?:\?[^#\s]*)?$/.exec(link.trim());
  if (!match) throw new HttpError("Enter a Spotify artist, album or track URL or URI", 400);
  if (process.env.SPOTIFY_IDENTITY_ENRICHMENT_ENABLED !== "true") {
    throw new HttpError("Spotify identity enrichment is not enabled", 404);
  }
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new HttpError("Spotify identity credentials are not configured", 503);
  const type = (match[1] ?? match[2]) as SpotifyIdentityInput["object_type"];
  const id = match[3]!;
  const signal = AbortSignal.timeout(10_000);
  try {
    const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST", redirect: "error", signal,
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!tokenResponse.ok) throw new HttpError("Spotify authentication is unavailable", 502);
    const token = z.object({ access_token: z.string().min(1), token_type: z.literal("Bearer") }).parse(await tokenResponse.json());
    const response = await fetch(`https://api.spotify.com/v1/${type}s/${id}`, {
      redirect: "error", signal, headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!response.ok) throw new HttpError(response.status === 404 ? "Spotify object was not found" : "Spotify metadata is unavailable", response.status === 404 ? 404 : 502);
    const item = metadataSchema.parse(await response.json());
    if (item.id !== id || item.type !== type) throw new HttpError("Spotify returned a different object", 502);
    return {
      object_type: type, external_id: id, external_url: `https://open.spotify.com/${type}/${id}`,
      name: item.name, artist_name: type === "artist" ? null : item.artists?.[0]?.name ?? null,
      isrc: item.external_ids?.isrc ?? null, upc_ean: item.external_ids?.upc ?? item.external_ids?.ean ?? null,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError("Spotify metadata could not be retrieved", 502);
  }
}
