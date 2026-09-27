import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  campaign_audience_contacts,
  campaign_audience_stations,
  campaign_audiences,
  campaign_leads,
  campaigns,
  contacts,
  radio_stations,
} from "../db/schema";
import { db } from "../lib/db";
import { ConflictError, NotFoundError } from "./errors";
import { recordAuditEvent } from "./integrations";
import { idSchema, nullableText } from "./validation";

const campaignAudienceRuleArray = z.array(z.string().trim().min(1, "Rule values are required"));

const rawCampaignAudienceRulesSchema = z.object({
  include_contact_roles: campaignAudienceRuleArray.default([]),
  exclude_contact_roles: campaignAudienceRuleArray.default([]),
  require_contact_email: z.boolean().default(true),
  exclude_contact_ids: z.array(idSchema).default([]),
  include_station_states: campaignAudienceRuleArray.default([]),
  exclude_station_states: campaignAudienceRuleArray.default([]),
  require_station_email: z.boolean().default(true),
  exclude_station_ids: z.array(idSchema).default([]),
});

const defaultAudienceRules = () => ({
  include_contact_roles: [],
  exclude_contact_roles: [],
  require_contact_email: true,
  exclude_contact_ids: [],
  include_station_states: [],
  exclude_station_states: [],
  require_station_email: true,
  exclude_station_ids: [],
});

export const campaignAudienceRulesSchema = rawCampaignAudienceRulesSchema.default(defaultAudienceRules());

export const createCampaignAudienceSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1, "Audience name is required"),
  description: nullableText,
  contact_member_ids: z.array(idSchema).default([]),
  station_member_ids: z.array(idSchema).default([]),
  membership_rules: campaignAudienceRulesSchema,
});

export const attachCampaignAudienceSchema = z.object({
  audience_id: idSchema,
});

export type CampaignAudienceRules = z.infer<typeof campaignAudienceRulesSchema>;
export type CreateCampaignAudienceInput = z.infer<typeof createCampaignAudienceSchema>;
export type AttachCampaignAudienceInput = z.infer<typeof attachCampaignAudienceSchema>;

export interface CampaignAudienceWriteOptions {
  expectedRevision?: number;
  audit?: { actorUserId: string; eventType: string; metadata?: Record<string, unknown> };
}

export interface CampaignAudienceOption {
  id: string;
  name: string;
  description: string | null;
  membership_rules: CampaignAudienceRules;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface CampaignAudienceContact {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  company: string | null;
}

export interface CampaignAudienceStation {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  email: string | null;
}

export interface CampaignAudienceResolvedMember {
  id: string;
  name: string;
  detail: string;
  status: "included" | "excluded";
  reason: string;
}

export interface CampaignAudiencePreview {
  audience_id: string;
  audience_name: string;
  audience_description: string | null;
  counts: {
    included_contacts: number;
    excluded_contacts: number;
    included_stations: number;
    excluded_stations: number;
    explicit_contact_members: number;
    explicit_station_members: number;
  };
  included_contacts: CampaignAudienceResolvedMember[];
  excluded_contacts: CampaignAudienceResolvedMember[];
  included_stations: CampaignAudienceResolvedMember[];
  excluded_stations: CampaignAudienceResolvedMember[];
  /** Set only for a bounded native sample; counts are not complete in that case. */
  partial?: boolean;
}

export interface CampaignAudienceSelection {
  campaign_audience_id: string;
  preview: CampaignAudiencePreview;
}

export async function listCampaignAudienceContactOptions(orgId: string) {
  return db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      role: contacts.role,
      company: contacts.company,
    })
    .from(contacts)
    .where(eq(contacts.org_id, orgId))
    .orderBy(desc(contacts.created_at));
}

export async function listCampaignAudienceStationOptions(orgId: string) {
  return db
    .select({
      id: radio_stations.id,
      name: radio_stations.name,
      city: radio_stations.city,
      state: radio_stations.state,
      country: radio_stations.country,
      email: radio_stations.email,
    })
    .from(radio_stations)
    .where(eq(radio_stations.org_id, orgId))
    .orderBy(desc(radio_stations.created_at));
}

export async function listCampaignAudiences(orgId: string, options: { limit?: number } = {}): Promise<CampaignAudienceOption[]> {
  const query = db
    .select({
      id: campaign_audiences.id,
      name: campaign_audiences.name,
      description: campaign_audiences.description,
      membership_rules: campaign_audiences.membership_rules,
      created_at: campaign_audiences.created_at,
      updated_at: campaign_audiences.updated_at,
    })
    .from(campaign_audiences)
    .where(eq(campaign_audiences.org_id, orgId))
    .orderBy(sql`${campaign_audiences.updated_at} desc nulls last`);

  const rows = options.limit === undefined ? await query : await query.limit(options.limit + 1);

  return rows.map((row) => ({
    ...row,
    membership_rules: normalizeAudienceRules(row.membership_rules),
  }));
}

export async function createCampaignAudience(orgId: string, input: CreateCampaignAudienceInput) {
  const payload = createCampaignAudienceSchema.parse(input);
  const id = payload.id ?? crypto.randomUUID();
  const normalizedRules = normalizeAudienceRules(payload.membership_rules);
  const cleanedContactIds = uniqueSortedIds(payload.contact_member_ids);
  const cleanedStationIds = uniqueSortedIds(payload.station_member_ids);
  const now = new Date();

  await assertOrgContacts(orgId, cleanedContactIds);
  await assertOrgStations(orgId, cleanedStationIds);

  const inserted = await db
    .insert(campaign_audiences)
    .values({
      id,
      org_id: orgId,
      name: payload.name,
      description: payload.description ?? null,
      membership_rules: normalizedRules,
      created_at: now,
      updated_at: now,
    })
    .onConflictDoNothing({ target: campaign_audiences.id })
    .returning({ id: campaign_audiences.id });

  if (!inserted.length) {
    throw new ConflictError("Audience ID already exists");
  }

  if (cleanedContactIds.length > 0) {
    await db.insert(campaign_audience_contacts).values(
      cleanedContactIds.map((contactId) => ({
        id: crypto.randomUUID(),
        org_id: orgId,
        audience_id: id,
        contact_id: contactId,
        created_at: now,
      })),
    );
  }

  if (cleanedStationIds.length > 0) {
    await db.insert(campaign_audience_stations).values(
      cleanedStationIds.map((stationId) => ({
        id: crypto.randomUUID(),
        org_id: orgId,
        audience_id: id,
        station_id: stationId,
        created_at: now,
      })),
    );
  }

  return {
    id,
    ok: true,
  };
}

const FOCUSED_LEAD_TERMINAL_STAGES = ["confirmed", "published", "nurture"] as const;

export async function previewCampaignAudience(
  orgId: string,
  audienceId: string,
  campaignId?: string,
  options: { memberSampleLimit?: number } = {},
): Promise<CampaignAudiencePreview> {
  const audience = await loadAudience(orgId, audienceId);

  const explicitContactsQuery = db.select({ id: campaign_audience_contacts.contact_id }).from(campaign_audience_contacts)
    .where(and(eq(campaign_audience_contacts.org_id, orgId), eq(campaign_audience_contacts.audience_id, audienceId)));
  const explicitStationsQuery = db.select({ id: campaign_audience_stations.station_id }).from(campaign_audience_stations)
    .where(and(eq(campaign_audience_stations.org_id, orgId), eq(campaign_audience_stations.audience_id, audienceId)));
  const contactsQuery = db.select({ id: contacts.id, name: contacts.name, email: contacts.email, role: contacts.role, company: contacts.company })
    .from(contacts).where(eq(contacts.org_id, orgId)).orderBy(desc(contacts.created_at));
  const stationsQuery = db.select({ id: radio_stations.id, name: radio_stations.name, city: radio_stations.city, state: radio_stations.state, country: radio_stations.country, email: radio_stations.email })
    .from(radio_stations).where(eq(radio_stations.org_id, orgId)).orderBy(desc(radio_stations.created_at));
  const focusedLeadsQuery = campaignId ? db.select({ station_id: campaign_leads.station_id }).from(campaign_leads)
    .where(and(eq(campaign_leads.org_id, orgId), eq(campaign_leads.campaign_id, campaignId), notInArray(campaign_leads.pipeline_stage, [...FOCUSED_LEAD_TERMINAL_STAGES]))) : null;
  const limit = options.memberSampleLimit;
  const [explicitContacts, explicitStations, allContacts, allStations, focusedLeads] = await Promise.all([
    limit === undefined ? explicitContactsQuery : explicitContactsQuery.limit(limit),
    limit === undefined ? explicitStationsQuery : explicitStationsQuery.limit(limit),
    limit === undefined ? contactsQuery : contactsQuery.limit(limit),
    limit === undefined ? stationsQuery : stationsQuery.limit(limit),
    focusedLeadsQuery ? (limit === undefined ? focusedLeadsQuery : focusedLeadsQuery.limit(limit)) : Promise.resolve([]),
  ]);

  const preview = buildAudiencePreview(audience, {
    explicitContactIds: explicitContacts.map((row) => row.id),
    explicitStationIds: explicitStations.map((row) => row.id),
    focusedStationIds: focusedLeads
      .map((row) => row.station_id)
      .filter((stationId): stationId is string => typeof stationId === "string"),
    allContacts,
    allStations,
  });
  return limit === undefined || [explicitContacts, explicitStations, allContacts, allStations, focusedLeads].every((rows) => rows.length < limit)
    ? preview
    : { ...preview, partial: true };
}

export async function getCampaignAudienceForCampaign(
  orgId: string,
  campaignId: string,
  options: { memberSampleLimit?: number } = {},
): Promise<CampaignAudienceSelection | null> {
  try {
    const campaign = await loadCampaign(orgId, campaignId);
    const selectedId = campaign.campaign_audience_id;
    if (!selectedId) return null;

    return {
      campaign_audience_id: selectedId,
      preview: await previewCampaignAudience(orgId, selectedId, campaignId, options),
    };
  } catch (error) {
    if (isCampaignAudienceSchemaUnavailable(error)) {
      return null;
    }
    throw error;
  }
}

export async function getCampaignAudienceFeatureAvailability(orgId: string) {
  try {
    await db
      .select({ id: campaigns.id, campaign_audience_id: campaigns.campaign_audience_id })
      .from(campaigns)
      .where(eq(campaigns.org_id, orgId))
      .limit(1);

    await db.select({ id: campaign_audiences.id }).from(campaign_audiences).limit(1);
    await db.select({ id: campaign_audience_contacts.id }).from(campaign_audience_contacts).limit(1);
    await db.select({ id: campaign_audience_stations.id }).from(campaign_audience_stations).limit(1);

    return true;
  } catch (error) {
    if (isCampaignAudienceSchemaUnavailable(error)) {
      return false;
    }
    throw error;
  }
}

export async function attachCampaignAudience(orgId: string, campaignId: string, input: AttachCampaignAudienceInput, options: CampaignAudienceWriteOptions = {}) {
  const payload = attachCampaignAudienceSchema.parse(input);
  await loadCampaign(orgId, campaignId);
  await loadAudience(orgId, payload.audience_id);

  const current = await db
    .select({ campaignId: campaigns.id })
    .from(campaigns)
    .where(and(
      eq(campaigns.id, campaignId),
      eq(campaigns.org_id, orgId),
      eq(campaigns.campaign_audience_id, payload.audience_id),
    ));

  if (current.length > 0 && options.expectedRevision === undefined && !options.audit) {
    return { ok: true };
  }

  return writeCampaignAudienceSelection(orgId, campaignId, payload.audience_id, options);
}

export async function detachCampaignAudience(orgId: string, campaignId: string, options: CampaignAudienceWriteOptions = {}) {
  const campaign = await loadCampaign(orgId, campaignId);
  if (!campaign.campaign_audience_id && options.expectedRevision === undefined && !options.audit) {
    return { ok: true };
  }

  return writeCampaignAudienceSelection(orgId, campaignId, null, options);
}

async function writeCampaignAudienceSelection(
  orgId: string,
  campaignId: string,
  audienceId: string | null,
  options: CampaignAudienceWriteOptions,
) {
  if (options.expectedRevision === undefined && !options.audit) {
    await db
      .update(campaigns)
      .set({ campaign_audience_id: audienceId, updated_at: new Date(), revision: sql`${campaigns.revision} + 1` })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)));
    return { ok: true };
  }
  return db.transaction(async (tx) => {
    const where = [eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)];
    if (options.expectedRevision !== undefined) where.push(eq(campaigns.revision, options.expectedRevision));
    const rows = await tx
      .update(campaigns)
      .set({ campaign_audience_id: audienceId, updated_at: new Date(), revision: sql`${campaigns.revision} + 1` })
      .where(and(...where))
      .returning({ revision: campaigns.revision });
    if (!rows.length) {
      throw new ConflictError(options.expectedRevision === undefined ? "Campaign not found" : "Campaign changed; refresh and try again");
    }
    const revision = rows[0]!.revision;
    if (options.audit) {
      await recordAuditEvent(orgId, {
        actor_user_id: options.audit.actorUserId,
        event_type: options.audit.eventType,
        object_type: "campaign",
        object_id: campaignId,
        after: { revision, campaign_audience_id: audienceId },
        metadata: options.audit.metadata ?? {},
      }, tx);
    }
    return { ok: true, revision };
  });
}

export function buildAudiencePreview(
  audience: {
    id: string;
    name: string;
    description: string | null;
    membership_rules: CampaignAudienceRules;
  },
  options: {
    explicitContactIds: string[];
    explicitStationIds: string[];
    focusedStationIds?: string[];
    allContacts: CampaignAudienceContact[];
    allStations: CampaignAudienceStation[];
  },
): CampaignAudiencePreview {
  const rules = normalizeAudienceRules(audience.membership_rules);
  const explicitContactSet = new Set(options.explicitContactIds);
  const excludedContactSet = new Set(normalizeRuleset(rules.exclude_contact_ids));
  const explicitStationSet = new Set(options.explicitStationIds);
  const focusedStationSet = new Set(options.focusedStationIds ?? []);
  const excludedStationSet = new Set(normalizeRuleset(rules.exclude_station_ids));
  const includeContactRoleSet = new Set(normalizeRuleset(rules.include_contact_roles));
  const excludeContactRoleSet = new Set(normalizeRuleset(rules.exclude_contact_roles));
  const includeStationStates = new Set(normalizeRuleset(rules.include_station_states));
  const excludeStationStates = new Set(normalizeRuleset(rules.exclude_station_states));

  const includedContacts: CampaignAudienceResolvedMember[] = [];
  const excludedContacts: CampaignAudienceResolvedMember[] = [];
  const includedStations: CampaignAudienceResolvedMember[] = [];
  const excludedStations: CampaignAudienceResolvedMember[] = [];

  for (const contact of options.allContacts) {
    const match = explicitContactSet.has(contact.id)
      || (includeContactRoleSet.size > 0 && includeContactRoleSet.has(normalizeText(contact.role)));

    if (!match) continue;

    const detailParts = [contact.role, contact.company].filter(Boolean);
    const contactDetail = detailParts.join(" · ") || "no role/company metadata";
    const base = {
      id: contact.id,
      name: contact.name,
      detail: contactDetail,
    };

    if (excludedContactSet.has(contact.id)) {
      excludedContacts.push({
        ...base,
        status: "excluded",
        reason: "excluded by explicit exclude list",
      });
      continue;
    }

    if (excludeContactRoleSet.size > 0 && excludeContactRoleSet.has(normalizeText(contact.role))) {
      excludedContacts.push({
        ...base,
        status: "excluded",
        reason: "excluded by role",
      });
      continue;
    }

    if (rules.require_contact_email && !contact.email) {
      excludedContacts.push({
        ...base,
        status: "excluded",
        reason: "missing email",
      });
      continue;
    }

    includedContacts.push({
      ...base,
      status: "included",
      reason: explicitContactSet.has(contact.id) ? "explicit member" : "matched role rule",
    });
  }

  for (const station of options.allStations) {
    const location = normalizeText(station.state);
    const includeByState = includeStationStates.size > 0
      ? includeStationStates.has(location)
      : false;
    const match = explicitStationSet.has(station.id) || includeByState;

    if (!match) continue;

    const stationDetail = [station.city, station.state, station.country].filter(Boolean).join(" · ") || "no location metadata";
    const base = {
      id: station.id,
      name: station.name,
      detail: stationDetail,
    };

    if (focusedStationSet.has(station.id)) {
      excludedStations.push({
        ...base,
        status: "excluded",
        reason: "Focused outreach",
      });
      continue;
    }

    if (excludedStationSet.has(station.id)) {
      excludedStations.push({
        ...base,
        status: "excluded",
        reason: "excluded by explicit exclude list",
      });
      continue;
    }

    if (excludeStationStates.has(location)) {
      excludedStations.push({
        ...base,
        status: "excluded",
        reason: "excluded by state rule",
      });
      continue;
    }

    if (rules.require_station_email && !station.email) {
      excludedStations.push({
        ...base,
        status: "excluded",
        reason: "missing email",
      });
      continue;
    }

    includedStations.push({
      ...base,
      status: "included",
      reason: explicitStationSet.has(station.id) ? "explicit member" : "matched station state rule",
    });
  }

  includedContacts.sort((a, b) => a.name.localeCompare(b.name));
  excludedContacts.sort((a, b) => a.name.localeCompare(b.name));
  includedStations.sort((a, b) => a.name.localeCompare(b.name));
  excludedStations.sort((a, b) => a.name.localeCompare(b.name));

  return {
    audience_id: audience.id,
    audience_name: audience.name,
    audience_description: audience.description,
    counts: {
      explicit_contact_members: explicitContactSet.size,
      explicit_station_members: explicitStationSet.size,
      included_contacts: includedContacts.length,
      excluded_contacts: excludedContacts.length,
      included_stations: includedStations.length,
      excluded_stations: excludedStations.length,
    },
    included_contacts: includedContacts,
    excluded_contacts: excludedContacts,
    included_stations: includedStations,
    excluded_stations: excludedStations,
  };
}

async function assertOrgContacts(orgId: string, contactIds: string[]) {
  if (!contactIds.length) return;

  const rows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.org_id, orgId), inArray(contacts.id, contactIds)));

  if (rows.length !== contactIds.length) {
    throw new NotFoundError("One or more contact IDs are not available in this workspace");
  }
}

async function assertOrgStations(orgId: string, stationIds: string[]) {
  if (!stationIds.length) return;

  const rows = await db
    .select({ id: radio_stations.id })
    .from(radio_stations)
    .where(and(eq(radio_stations.org_id, orgId), inArray(radio_stations.id, stationIds)));

  if (rows.length !== stationIds.length) {
    throw new NotFoundError("One or more station IDs are not available in this workspace");
  }
}

async function loadCampaign(orgId: string, campaignId: string) {
  const rows = await db
    .select({
      id: campaigns.id,
      campaign_audience_id: campaigns.campaign_audience_id,
    })
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)));

  const campaign = rows[0];
  if (!campaign) {
    throw new NotFoundError("Campaign not found");
  }
  return campaign;
}

async function loadAudience(orgId: string, audienceId: string) {
  const rows = await db
    .select({
      id: campaign_audiences.id,
      name: campaign_audiences.name,
      description: campaign_audiences.description,
      membership_rules: campaign_audiences.membership_rules,
    })
    .from(campaign_audiences)
    .where(and(eq(campaign_audiences.id, audienceId), eq(campaign_audiences.org_id, orgId)));

  const audience = rows[0];
  if (!audience) {
    throw new NotFoundError("Audience not found");
  }

  return {
    ...audience,
    membership_rules: normalizeAudienceRules(audience.membership_rules as CampaignAudienceRules | null),
  };
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function normalizeRuleset(values: string[]) {
  return values
    .map((value) => normalizeText(value))
    .filter(Boolean);
}

function normalizeAudienceRules(value: CampaignAudienceRules | null | undefined): CampaignAudienceRules {
  const raw = campaignAudienceRulesSchema.parse(value ?? defaultAudienceRules());
  return {
    include_contact_roles: uniqueStrings(normalizeRuleset(raw.include_contact_roles)),
    exclude_contact_roles: uniqueStrings(normalizeRuleset(raw.exclude_contact_roles)),
    require_contact_email: raw.require_contact_email,
    exclude_contact_ids: uniqueStrings(raw.exclude_contact_ids),
    include_station_states: uniqueStrings(normalizeRuleset(raw.include_station_states)),
    exclude_station_states: uniqueStrings(normalizeRuleset(raw.exclude_station_states)),
    require_station_email: raw.require_station_email,
    exclude_station_ids: uniqueStrings(raw.exclude_station_ids),
  };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function uniqueSortedIds(values: string[]) {
  return uniqueStrings(values).sort();
}

function isCampaignAudienceSchemaUnavailable(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const err = error as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  const errorCode = err.code ?? err.cause?.code;
  const errorMessage = (err.message ?? err.cause?.message ?? "").toLowerCase();

  return (
    errorCode === "42P01" ||
    errorCode === "42703" ||
    errorMessage.includes("campaign_audience")
  );
}

export { isCampaignAudienceSchemaUnavailable };
