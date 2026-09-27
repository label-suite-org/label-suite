import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  artists,
  campaign_stations,
  campaigns,
  documents,
  media_assets,
  radio_stations,
  releases,
  tracks,
} from "../db/schema";
import { db } from "../lib/db";
import { NotFoundError } from "./errors";
import { idSchema, nullableText } from "./validation";

export const RADIO_PLUGGING_STATUSES = [
  "selected",
  "drafted",
  "sent",
  "follow_up_due",
  "replied",
  "added",
  "spun",
  "declined",
  "no_response",
  "bounced",
  "wrong_contact",
] as const;

export const RADIO_PLUGGING_PRIORITIES = ["high", "medium", "low"] as const;

const statusSchema = z.enum(RADIO_PLUGGING_STATUSES);
const prioritySchema = z.enum(RADIO_PLUGGING_PRIORITIES);

const nullableDateInput = z.string().trim().optional().nullable();

export const createCampaignStationSchema = z.object({
  campaign_id: idSchema,
  station_id: idSchema,
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  pitch_angle: nullableText.optional(),
  feedback: nullableText.optional(),
  follow_up_at: nullableDateInput,
});

export const updateCampaignStationSchema = z.object({
  id: idSchema,
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  pitch_angle: nullableText.optional(),
  feedback: nullableText.optional(),
  follow_up_at: nullableDateInput,
  last_contacted_at: nullableDateInput,
});

export const deleteCampaignStationSchema = z.object({ id: idSchema });

export type CreateCampaignStationInput = z.infer<typeof createCampaignStationSchema>;
export type UpdateCampaignStationInput = z.infer<typeof updateCampaignStationSchema>;
export type DeleteCampaignStationInput = z.infer<typeof deleteCampaignStationSchema>;

export interface RadioReadinessItem {
  key: string;
  label: string;
  ready: boolean;
  detail: string;
}

export async function listRadioPluggingCampaigns(orgId: string) {
  const rows = await db
    .select({
      id: campaigns.id,
      campaign_name: campaigns.campaign_name,
      campaign_type: campaigns.campaign_type,
      status: campaigns.status,
      start_date: campaigns.start_date,
      end_date: campaigns.end_date,
      goal: campaigns.goal,
      main_platform: campaigns.main_platform,
      linked_release_id: campaigns.linked_release_id,
      linked_artist_id: campaigns.linked_artist_id,
      release_title: releases.title,
      artist_name: artists.name,
      created_at: campaigns.created_at,
    })
    .from(campaigns)
    .leftJoin(releases, and(eq(campaigns.linked_release_id, releases.id), eq(releases.org_id, orgId)))
    .leftJoin(artists, and(eq(campaigns.linked_artist_id, artists.id), eq(artists.org_id, orgId)))
    .where(eq(campaigns.org_id, orgId))
    .orderBy(desc(campaigns.created_at));

  const relevant = rows.filter(isRadioRelevantCampaign);

  return Promise.all(
    relevant.map(async (campaign) => {
      const stationLinks = await listCampaignStationRows(orgId, campaign.id);
      const statusCounts = countStatuses(stationLinks.map((link) => link.status));
      return {
        ...campaign,
        target_count: stationLinks.length,
        with_email_count: stationLinks.filter((link) => Boolean(link.email)).length,
        sent_count: stationLinks.filter((link) => ["sent", "replied", "added", "spun"].includes(link.status ?? "")).length,
        follow_up_due_count: stationLinks.filter(isFollowUpDue).length,
        status_counts: statusCounts,
      };
    }),
  );
}

export async function getRadioPluggingCampaign(orgId: string, campaignId: string) {
  const campaign = await db
    .select({
      id: campaigns.id,
      campaign_name: campaigns.campaign_name,
      campaign_type: campaigns.campaign_type,
      status: campaigns.status,
      start_date: campaigns.start_date,
      end_date: campaigns.end_date,
      owner: campaigns.owner,
      goal: campaigns.goal,
      notes: campaigns.notes,
      kpi_summary: campaigns.kpi_summary,
      main_platform: campaigns.main_platform,
      linked_release_id: campaigns.linked_release_id,
      linked_artist_id: campaigns.linked_artist_id,
      release_title: releases.title,
      release_date: releases.release_date,
      release_status: releases.status,
      release_cover_art_url: releases.cover_art_url,
      artist_name: artists.name,
    })
    .from(campaigns)
    .leftJoin(releases, and(eq(campaigns.linked_release_id, releases.id), eq(releases.org_id, orgId)))
    .leftJoin(artists, and(eq(campaigns.linked_artist_id, artists.id), eq(artists.org_id, orgId)))
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)));

  const current = campaign[0];
  if (!current) return null;

  const stations = await listCampaignStationRows(orgId, campaignId);
  const statusCounts = countStatuses(stations.map((link) => link.status));
  const readiness = await buildRadioReadiness(orgId, current, stations);

  return {
    ...current,
    stations,
    readiness,
    target_count: stations.length,
    with_email_count: stations.filter((link) => Boolean(link.email)).length,
    sent_count: stations.filter((link) => ["sent", "replied", "added", "spun"].includes(link.status ?? "")).length,
    follow_up_due_count: stations.filter(isFollowUpDue).length,
    status_counts: statusCounts,
  };
}

export async function createCampaignStation(orgId: string, input: CreateCampaignStationInput) {
  await assertCampaignAndStation(orgId, input.campaign_id, input.station_id);
  const id = crypto.randomUUID();

  await db
    .insert(campaign_stations)
    .values({
      id,
      org_id: orgId,
      campaign_id: input.campaign_id,
      station_id: input.station_id,
      status: input.status ?? "selected",
      priority: input.priority ?? "medium",
      pitch_angle: input.pitch_angle ?? null,
      feedback: input.feedback ?? null,
      follow_up_at: toDateOrNull(input.follow_up_at),
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [campaign_stations.org_id, campaign_stations.campaign_id, campaign_stations.station_id],
      set: {
        status: input.status ?? "selected",
        priority: input.priority ?? "medium",
        pitch_angle: input.pitch_angle ?? null,
        feedback: input.feedback ?? null,
        follow_up_at: toDateOrNull(input.follow_up_at),
        updated_at: new Date(),
      },
    });

  return { ok: true, id };
}

export async function updateCampaignStation(orgId: string, input: UpdateCampaignStationInput) {
  const updates: Partial<typeof campaign_stations.$inferInsert> = { updated_at: new Date() };
  if (input.status !== undefined) updates.status = input.status;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.pitch_angle !== undefined) updates.pitch_angle = input.pitch_angle;
  if (input.feedback !== undefined) updates.feedback = input.feedback;
  if (input.follow_up_at !== undefined) updates.follow_up_at = toDateOrNull(input.follow_up_at);
  if (input.last_contacted_at !== undefined) updates.last_contacted_at = toDateOrNull(input.last_contacted_at);

  const updated = await db
    .update(campaign_stations)
    .set(updates)
    .where(and(eq(campaign_stations.id, input.id), eq(campaign_stations.org_id, orgId)))
    .returning({ id: campaign_stations.id });

  if (!updated.length) throw new NotFoundError("Campaign station link not found");
  return { ok: true };
}

export async function deleteCampaignStation(orgId: string, input: DeleteCampaignStationInput) {
  const deleted = await db
    .delete(campaign_stations)
    .where(and(eq(campaign_stations.id, input.id), eq(campaign_stations.org_id, orgId)))
    .returning({ id: campaign_stations.id });

  if (!deleted.length) throw new NotFoundError("Campaign station link not found");
  return { ok: true };
}

async function listCampaignStationRows(orgId: string, campaignId: string) {
  return db
    .select({
      id: campaign_stations.id,
      campaign_id: campaign_stations.campaign_id,
      station_id: campaign_stations.station_id,
      status: campaign_stations.status,
      last_contacted_at: campaign_stations.last_contacted_at,
      follow_up_at: campaign_stations.follow_up_at,
      feedback: campaign_stations.feedback,
      priority: campaign_stations.priority,
      pitch_angle: campaign_stations.pitch_angle,
      updated_at: campaign_stations.updated_at,
      name: radio_stations.name,
      call_sign: radio_stations.call_sign,
      frequency: radio_stations.frequency,
      city: radio_stations.city,
      state: radio_stations.state,
      country: radio_stations.country,
      email: radio_stations.email,
      phone: radio_stations.phone,
      website: radio_stations.website,
      dj_name: radio_stations.dj_name,
      tier: radio_stations.tier,
      notes: radio_stations.notes,
    })
    .from(campaign_stations)
    .innerJoin(radio_stations, and(eq(campaign_stations.station_id, radio_stations.id), eq(radio_stations.org_id, orgId)))
    .where(and(eq(campaign_stations.campaign_id, campaignId), eq(campaign_stations.org_id, orgId)))
    .orderBy(asc(radio_stations.name));
}

async function assertCampaignAndStation(orgId: string, campaignId: string, stationId: string) {
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)));
  if (!campaign) throw new NotFoundError("Campaign not found");

  const [station] = await db
    .select({ id: radio_stations.id })
    .from(radio_stations)
    .where(and(eq(radio_stations.id, stationId), eq(radio_stations.org_id, orgId)));
  if (!station) throw new NotFoundError("Radio station not found");
}

function isRadioRelevantCampaign(row: { campaign_name: string; campaign_type: string | null; main_platform: string | null; goal?: string | null }) {
  const haystack = [row.campaign_name, row.campaign_type, row.main_platform, row.goal]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /(radio|plug|airplay|nacc|jbe|mediabase|submodern|college|pr|promo)/.test(haystack);
}

function countStatuses(statuses: Array<string | null>) {
  const counts: Record<string, number> = {};
  for (const status of statuses) {
    const key = status || "selected";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function isFollowUpDue(row: { status: string | null; follow_up_at: Date | null }) {
  if (!row.follow_up_at) return false;
  if (["replied", "added", "spun", "declined", "bounced", "wrong_contact"].includes(row.status ?? "")) return false;
  return row.follow_up_at.getTime() <= Date.now();
}

function toDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function buildRadioReadiness(
  orgId: string,
  campaign: {
    linked_release_id: string | null;
    linked_artist_id: string | null;
    release_cover_art_url: string | null;
    goal: string | null;
    notes: string | null;
    kpi_summary: string | null;
  },
  stationRows: Awaited<ReturnType<typeof listCampaignStationRows>>,
): Promise<RadioReadinessItem[]> {
  const releaseTracks = campaign.linked_release_id
    ? await db
        .select({ title: tracks.title, version: tracks.version, isrc: tracks.isrc, audio_url: tracks.audio_url })
        .from(tracks)
        .where(and(eq(tracks.release_id, campaign.linked_release_id), eq(tracks.org_id, orgId)))
    : [];

  const releaseDocs = campaign.linked_release_id
    ? await db
        .select({ name: documents.name, doc_type: documents.doc_type, file_link: documents.file_link, notes: documents.notes })
        .from(documents)
        .where(and(eq(documents.release_id, campaign.linked_release_id), eq(documents.org_id, orgId)))
    : [];

  const releaseAssets = campaign.linked_release_id
    ? await db
        .select({ asset_name: media_assets.asset_name, asset_type: media_assets.asset_type, file_link: media_assets.file_link, notes: media_assets.notes })
        .from(media_assets)
        .where(and(eq(media_assets.linked_release_id, campaign.linked_release_id), eq(media_assets.org_id, orgId)))
    : [];

  const artistDocs = campaign.linked_artist_id
    ? await db
        .select({ name: documents.name, doc_type: documents.doc_type, file_link: documents.file_link, notes: documents.notes })
        .from(documents)
        .where(and(eq(documents.artist_id, campaign.linked_artist_id), eq(documents.org_id, orgId)))
    : [];

  const docsAndAssets = [...releaseDocs, ...artistDocs, ...releaseAssets];
  const campaignText = [campaign.goal, campaign.notes, campaign.kpi_summary].filter(Boolean).join(" ").toLowerCase();
  const trackText = releaseTracks.map((track) => `${track.title} ${track.version ?? ""}`).join(" ").toLowerCase();
  const assetText = docsAndAssets
    .map((item) => `${"name" in item ? item.name : item.asset_name} ${"doc_type" in item ? item.doc_type ?? "" : item.asset_type ?? ""} ${item.notes ?? ""}`)
    .join(" ")
    .toLowerCase();

  const hasAudioAsset = releaseAssets.some((asset) => {
    const text = `${asset.asset_name} ${asset.asset_type ?? ""}`.toLowerCase();
    return Boolean(asset.file_link) && /(wav|mp3|audio|master|listen|download)/.test(text);
  });

  return [
    {
      key: "radio_edit",
      label: "Radio edit",
      ready: /radio edit|radio version/.test(`${trackText} ${campaignText}`),
      detail: "Looked in track version/title and campaign notes.",
    },
    {
      key: "clean_version",
      label: "Clean version",
      ready: /clean|explicit-free|radio safe/.test(`${trackText} ${campaignText}`),
      detail: "Needed when lyrics/content require a clean servicing version.",
    },
    {
      key: "isrc",
      label: "ISRC present",
      ready: releaseTracks.length > 0 && releaseTracks.every((track) => Boolean(track.isrc)),
      detail: releaseTracks.length ? `${releaseTracks.filter((track) => track.isrc).length}/${releaseTracks.length} linked tracks have ISRCs.` : "No linked release tracks found.",
    },
    {
      key: "audio_link",
      label: "WAV/MP3 or listen/download link",
      ready: releaseTracks.some((track) => Boolean(track.audio_url)) || hasAudioAsset,
      detail: "Derived from track audio URLs or linked media assets.",
    },
    {
      key: "epk_one_sheet",
      label: "EPK / one-sheet",
      ready: /(epk|one[-\s]?sheet|press kit|onepager)/.test(assetText),
      detail: "Derived from linked documents/media names and types.",
    },
    {
      key: "press_photo",
      label: "Press photo",
      ready: /(press photo|photo|image|portrait|promo shot)/.test(assetText) || Boolean(campaign.release_cover_art_url),
      detail: "Cover art counts as a weak visual fallback; press photo is better.",
    },
    {
      key: "station_fit",
      label: "Comparable artists / station fit",
      ready: /(comparable|ffo|for fans of|riyl|station fit|sounds like)/.test(campaignText),
      detail: "Write station-fit language in goal/notes if not present.",
    },
    {
      key: "direct_contact",
      label: "Direct contact",
      ready: stationRows.some((station) => Boolean(station.email)),
      detail: `${stationRows.filter((station) => station.email).length}/${stationRows.length} target stations have email.`,
    },
  ];
}

export function radioStatusLabel(status: string | null | undefined) {
  return (status || "selected").replace(/_/g, " ");
}
