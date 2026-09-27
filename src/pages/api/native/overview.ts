import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../lib/db";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { listArtists } from "../../../server/artists";
import { listNativeCampaignSummaries } from "../../../server/native-campaigns";
import { listReleases } from "../../../server/releases";
import { json } from "../../../server/api";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const actor = await resolveNativeActor(request);
  if (!actor) return json({ error: "Authentication required" }, 401);

  return runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
    const [artistRows, releaseRows, campaignRows] = await Promise.all([
      listArtists(actor.workspace.org.id),
      listReleases(actor.workspace.org.id),
      listNativeCampaignSummaries(actor.workspace.org.id, { archived: false, cursor: null, limit: "50" }),
    ]);

    return json({
      artists: artistRows.slice(0, 100).map(({ id, name, image_url }) => ({ id, name, image_url })),
      releases: releaseRows.slice(0, 100).map(({ id, title, artist_name, status, release_date, cover_art_url }) => ({ id, title, artist_name, status, release_date, cover_art_url })),
      campaigns: campaignRows.items,
    });
  });
};
