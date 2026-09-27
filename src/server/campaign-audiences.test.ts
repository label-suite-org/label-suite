import { beforeEach, describe, expect, test, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const whereCalls: Array<{ table: unknown; predicate: unknown }> = [];
  const updateCalls: Array<{ table: unknown; values: Record<string, unknown>; predicate: unknown }> = [];
  const deleteCalls: Array<{ table: unknown }> = [];
  const selectRows: unknown[][] = [];
  const selectErrors: Error[] = [];
  const insertCalls: Array<{ table: unknown; values: unknown }> = [];
  const limitCalls: number[] = [];
  let nextAudienceInsertResult: Array<{ id: string }> = [{ id: "audience-created" }];

  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn((predicate: unknown) => {
          whereCalls.push({ table, predicate });
          const selectError = selectErrors.shift();
          if (selectError) {
            const query = Promise.reject(selectError) as Promise<unknown[]> & {
              orderBy?: () => Promise<unknown[]>;
              limit?: (limit: number) => Promise<unknown[]>;
            };
            query.orderBy = () => query;
            query.limit = async (limit: number) => {
              limitCalls.push(limit);
              throw selectError;
            };
            return query;
          }
          const rows = selectRows.shift() ?? [];
          const query = Promise.resolve(rows) as Promise<unknown[]> & {
            orderBy?: () => Promise<unknown[]>;
            limit?: (limit: number) => Promise<unknown[]>;
          };
          query.orderBy = () => query;
          query.limit = async (limit: number) => { limitCalls.push(limit); return rows; };
          return query;
        }),
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn((predicate: unknown) => {
          updateCalls.push({ table, values, predicate });
          return Promise.resolve([]);
        }),
      })),
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(() => {
        deleteCalls.push({ table });
        return Promise.resolve([]);
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        insertCalls.push({ table, values });
        return {
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(async () => nextAudienceInsertResult),
          })),
        };
      }),
    })),
  };

  return {
    db,
    whereCalls,
    updateCalls,
    deleteCalls,
    selectRows,
    selectErrors,
    insertCalls,
    limitCalls,
    getNextAudienceInsertResult: () => nextAudienceInsertResult,
    setNextAudienceInsertResult: (rows: Array<{ id: string }>) => {
      nextAudienceInsertResult = rows;
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (left: unknown, right: unknown) => ({ kind: "eq", left, right }),
  inArray: (left: unknown, values: unknown[]) => ({ kind: "inArray", left, values }),
  notInArray: (left: unknown, values: unknown[]) => ({ kind: "notInArray", left, values }),
  desc: (value: unknown) => ({ kind: "desc", value }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ kind: "sql", strings: [...strings], values }),
}));

vi.mock("../lib/db", () => ({ db: hoisted.db }));

import {
  attachCampaignAudience,
  buildAudiencePreview,
  createCampaignAudience,
  detachCampaignAudience,
  getCampaignAudienceFeatureAvailability,
  getCampaignAudienceForCampaign,
  listCampaignAudiences,
  previewCampaignAudience,
} from "./campaign-audiences";
import { campaign_audience_contacts, campaign_audience_stations, campaign_audiences, campaign_leads, campaigns, contacts, radio_stations } from "../db/schema";

describe("campaign audience helper logic", () => {
  beforeEach(() => {
    hoisted.whereCalls.length = 0;
    hoisted.updateCalls.length = 0;
    hoisted.deleteCalls.length = 0;
    hoisted.selectRows.length = 0;
    hoisted.selectErrors.length = 0;
    hoisted.insertCalls.length = 0;
    hoisted.limitCalls.length = 0;
    hoisted.setNextAudienceInsertResult([{ id: "audience-created" }]);
    vi.clearAllMocks();
  });

  test("uses SQL sentinel limits for requested native audience options", async () => {
    hoisted.selectRows.push([]);
    await listCampaignAudiences("org-1", { limit: 25 });
    expect(hoisted.limitCalls).toEqual([26]);
  });

  test("uses SQL-bounded member samples and marks their totals partial", async () => {
    hoisted.selectRows.push(
      [{ id: "audience-1", name: "North", description: null, membership_rules: {} }],
      [], [], Array.from({ length: 26 }, (_, index) => ({ id: `contact-${index}`, name: "Contact", email: "c@example.test", role: null, company: null })), [], [],
    );
    const preview = await previewCampaignAudience("org-1", "audience-1", undefined, { memberSampleLimit: 26 });
    expect(hoisted.limitCalls).toEqual([26, 26, 26, 26]);
    expect(preview.partial).toBe(true);
  });

  test("buildAudiencePreview applies explicit membership, eligibility rules, and exclusion reasons", () => {
    const preview = buildAudiencePreview(
      {
        id: "audience-1",
        name: "North",
        description: null,
        membership_rules: {
          include_contact_roles: ["Presenter"],
          exclude_contact_roles: ["Intern"],
          require_contact_email: true,
          exclude_contact_ids: ["contact-bad"],
          include_station_states: ["NY"],
          exclude_station_states: ["TX"],
          require_station_email: true,
          exclude_station_ids: ["station-blocked"],
        },
      },
      {
        explicitContactIds: ["contact-explicit", "contact-bad"],
        explicitStationIds: ["station-explicit", "station-blocked"],
        allContacts: [
          { id: "contact-explicit", name: "Mina", email: "mina@example.com", role: "Presenter", company: "North" },
          { id: "contact-role", name: "Jon", email: "jon@example.com", role: "Presenter", company: "West" },
          { id: "contact-bad", name: "Blocked", email: "blocked@example.com", role: "Presenter", company: "Block" },
          { id: "contact-no-email", name: "Silent", email: null, role: "Presenter", company: "Quiet" },
        ],
        allStations: [
          { id: "station-explicit", name: "North FM", city: "Boston", state: "CA", country: "US", email: "north@radio.fm" },
          { id: "station-role", name: "NY Local", city: "Albany", state: "NY", country: "US", email: "ny@radio.fm" },
          { id: "station-blocked", name: "Blocked", city: "Dallas", state: "NY", country: "US", email: "blocked@radio.fm" },
          { id: "station-no-email", name: "No Mail", city: "Houston", state: "NY", country: "US", email: null },
          { id: "station-excluded-by-state", name: "Texas Radio", city: "Austin", state: "TX", country: "US", email: "texas@radio.fm" },
        ],
      },
    );

    expect(preview.counts.included_contacts).toBe(2);
    expect(preview.counts.excluded_contacts).toBe(2);
    expect(preview.counts.explicit_contact_members).toBe(2);
    expect(preview.included_contacts.map((row) => row.id)).toEqual(["contact-role", "contact-explicit"]);
    expect(preview.excluded_contacts.map((row) => row.id).sort()).toEqual(["contact-bad", "contact-no-email"]);

    expect(preview.counts.excluded_stations).toBe(2);
    expect(preview.counts.included_stations).toBe(2);
    expect(preview.counts.explicit_station_members).toBe(2);
    expect(preview.included_stations.map((row) => row.id).sort()).toEqual(["station-explicit", "station-role"].sort());
    expect(preview.excluded_stations.map((row) => row.id).sort()).toEqual([
      "station-blocked",
      "station-no-email",
    ].sort());
  });

  test("buildAudiencePreview can return an empty, deterministic result when nothing matches", () => {
    const preview = buildAudiencePreview(
      {
        id: "audience-empty",
        name: "Empty",
        description: null,
        membership_rules: {
          include_contact_roles: [],
          exclude_contact_roles: [],
          require_contact_email: true,
          exclude_contact_ids: [],
          include_station_states: [],
          exclude_station_states: [],
          require_station_email: true,
          exclude_station_ids: [],
        },
      },
      {
        explicitContactIds: [],
        explicitStationIds: [],
        allContacts: [
          { id: "contact-any", name: "Contact", email: "contact@x.com", role: "Director", company: "Label" },
        ],
        allStations: [
          { id: "station-any", name: "Station", city: "Boston", state: "MA", country: "US", email: "station@x.com" },
        ],
      },
    );

    expect(preview.counts).toEqual({
      included_contacts: 0,
      excluded_contacts: 0,
      included_stations: 0,
      excluded_stations: 0,
      explicit_contact_members: 0,
      explicit_station_members: 0,
    });
    expect(preview.included_contacts).toEqual([]);
    expect(preview.excluded_contacts).toEqual([]);
    expect(preview.included_stations).toEqual([]);
    expect(preview.excluded_stations).toEqual([]);
  });

  test("buildAudiencePreview excludes non-terminal focused outreach stations with the exact visible reason", () => {
    const preview = buildAudiencePreview(
      {
        id: "audience-focused",
        name: "Radio",
        description: null,
        membership_rules: {
          include_contact_roles: [],
          exclude_contact_roles: [],
          require_contact_email: true,
          exclude_contact_ids: [],
          include_station_states: [],
          exclude_station_states: [],
          require_station_email: true,
          exclude_station_ids: [],
        },
      },
      {
        explicitContactIds: [],
        explicitStationIds: ["station-focused", "station-open"],
        focusedStationIds: ["station-focused"],
        allContacts: [],
        allStations: [
          { id: "station-focused", name: "Focused FM", city: "Copenhagen", state: null, country: "DK", email: "focused@example.com" },
          { id: "station-open", name: "Open FM", city: "Aarhus", state: null, country: "DK", email: "open@example.com" },
        ],
      },
    );

    expect(preview.excluded_stations).toContainEqual(expect.objectContaining({
      id: "station-focused",
      reason: "Focused outreach",
    }));
    expect(preview.included_stations.map((station) => station.id)).toEqual(["station-open"]);
  });

  test("previewCampaignAudience scopes focused lead lookup to the same organization and campaign", async () => {
    hoisted.selectRows.push(
      [{ id: "audience-1", name: "North", description: null, membership_rules: { include_contact_roles: [], exclude_contact_roles: [], require_contact_email: true, exclude_contact_ids: [], include_station_states: [], exclude_station_states: [], require_station_email: true, exclude_station_ids: [] } }],
      [],
      [{ id: "station-1" }],
      [],
      [],
      [{ station_id: "station-focused" }],
    );

    await previewCampaignAudience("org-1", "audience-1", "campaign-1");

    const leadLookup = hoisted.whereCalls.find((call) => call.table === campaign_leads);
    expect(leadLookup).toBeDefined();
    expect(hasTenantFilter(leadLookup!, campaign_leads, campaign_leads.org_id, "org-1")).toBe(true);
    expect(hasTenantFilter(leadLookup!, campaign_leads, campaign_leads.campaign_id, "campaign-1")).toBe(true);
    expect(containsCondition(leadLookup?.predicate, campaign_leads.pipeline_stage, "notInArray")).toBe(true);
    expect(findCondition(leadLookup?.predicate, campaign_leads.pipeline_stage, "notInArray")).toMatchObject({
      values: ["confirmed", "published", "nurture"],
    });
  });

  test("previewCampaignAudience enforces tenant-scoped filters for audience/contact/station lookups", async () => {
    hoisted.selectRows.push(
      [{ id: "audience-1", name: "North", description: null, membership_rules: { include_contact_roles: [], exclude_contact_roles: [], require_contact_email: true, exclude_contact_ids: [], include_station_states: [], exclude_station_states: [], require_station_email: true, exclude_station_ids: [] } }],
      [],
      [],
      [],
      [],
    );

    const preview = await previewCampaignAudience("org-1", "audience-1");

    expect(preview.audience_id).toBe("audience-1");
    expect(hoisted.whereCalls).toHaveLength(5);
    expect(hasTenantFilter(hoisted.whereCalls[0], campaign_audiences, campaign_audiences.org_id, "org-1")).toBe(true);
    expect(hasTenantFilter(hoisted.whereCalls[1], campaign_audience_contacts, campaign_audience_contacts.org_id, "org-1")).toBe(true);
    expect(hasTenantFilter(hoisted.whereCalls[2], campaign_audience_stations, campaign_audience_stations.org_id, "org-1")).toBe(true);
    expect(hasTenantFilter(hoisted.whereCalls[3], contacts, contacts.org_id, "org-1")).toBe(true);
    expect(hasTenantFilter(hoisted.whereCalls[4], radio_stations, radio_stations.org_id, "org-1")).toBe(true);
    expect(hoisted.insertCalls).toHaveLength(0);
    expect(hoisted.updateCalls).toHaveLength(0);
    expect(hoisted.deleteCalls).toHaveLength(0);
  });

  test("attachCampaignAudience links a new campaign audience and updates campaign row", async () => {
    hoisted.selectRows.push(
      [{ id: "campaign-1", campaign_audience_id: null }],
      [{ id: "audience-target", name: "Target", description: null, membership_rules: {
        include_contact_roles: [],
        exclude_contact_roles: [],
        require_contact_email: true,
        exclude_contact_ids: [],
        include_station_states: [],
        exclude_station_states: [],
        require_station_email: true,
        exclude_station_ids: [],
      } }],
      [],
    );

    const result = await attachCampaignAudience("org-1", "campaign-1", { audience_id: "audience-target" });

    expect(result).toEqual({ ok: true });
    expect(hoisted.updateCalls).toHaveLength(1);
    expect(hoisted.updateCalls[0].table).toBe(campaigns);
    expect(hoisted.updateCalls[0].values).toMatchObject({
      campaign_audience_id: "audience-target",
      revision: { kind: "sql" },
      updated_at: expect.any(Date),
    });
  });

  test("createCampaignAudience aborts when the supplied id already exists", async () => {
    hoisted.selectRows.push(
      [{ id: "contact-1" }],
      [{ id: "station-1" }],
    );
    hoisted.setNextAudienceInsertResult([]);

    await expect(createCampaignAudience("org-1", {
      id: "audience-existing",
      name: "Existing",
      description: null,
      contact_member_ids: ["contact-1"],
      station_member_ids: ["station-1"],
      membership_rules: {
        include_contact_roles: [],
        exclude_contact_roles: [],
        require_contact_email: true,
        exclude_contact_ids: [],
        include_station_states: [],
        exclude_station_states: [],
        require_station_email: true,
        exclude_station_ids: [],
      },
    })).rejects.toMatchObject({ status: 409, message: "Audience ID already exists" });

    expect(hoisted.insertCalls).toHaveLength(1);
    expect(hoisted.insertCalls[0].table).toBe(campaign_audiences);
  });

  test("createCampaignAudience normalizes member/station ids, persists org-scoped links, and records audit timestamps", async () => {
    hoisted.selectRows.push(
      [{ id: "contact-b" }, { id: "contact-a" }],
      [{ id: "station-z" }, { id: "station-a" }],
    );

    const result = await createCampaignAudience("org-1", {
      name: "Regional",
      description: "Scoped list",
      contact_member_ids: ["contact-b", "contact-a", "contact-a"],
      station_member_ids: ["station-z", "station-a", "station-z"],
      membership_rules: {
        include_contact_roles: ["Presenter", "  presenter ", "Support"],
        exclude_contact_roles: ["Intern"],
        require_contact_email: true,
        exclude_contact_ids: ["contact-legacy"],
        include_station_states: ["NY", "ny"],
        exclude_station_states: ["TX"],
        require_station_email: true,
        exclude_station_ids: ["station-legacy"],
      },
    });

    expect(result).toMatchObject({ id: expect.any(String), ok: true });

    const audienceInsert = hoisted.insertCalls[0].values as {
      org_id: string;
      membership_rules: { include_contact_roles: string[]; include_station_states: string[] };
      created_at: unknown;
      updated_at: unknown;
    };
    expect(audienceInsert.org_id).toBe("org-1");
    expect(audienceInsert.membership_rules).toMatchObject({
      include_contact_roles: ["presenter", "support"],
      include_station_states: ["ny"],
    });
    expect(audienceInsert.created_at).toBeInstanceOf(Date);
    expect(audienceInsert.updated_at).toBeInstanceOf(Date);

    const contactInsert = hoisted.insertCalls[1].values as { id: string; org_id: string; audience_id: string; contact_id: string; created_at: unknown }[];
    expect(contactInsert).toHaveLength(2);
    expect(contactInsert).toMatchObject([
      { id: expect.any(String), org_id: "org-1", audience_id: result.id, contact_id: "contact-a", created_at: expect.any(Date) },
      { id: expect.any(String), org_id: "org-1", audience_id: result.id, contact_id: "contact-b", created_at: expect.any(Date) },
    ]);

    const stationInsert = hoisted.insertCalls[2].values as { id: string; org_id: string; audience_id: string; station_id: string; created_at: unknown }[];
    expect(stationInsert).toHaveLength(2);
    expect(stationInsert).toMatchObject([
      { id: expect.any(String), org_id: "org-1", audience_id: result.id, station_id: "station-a", created_at: expect.any(Date) },
      { id: expect.any(String), org_id: "org-1", audience_id: result.id, station_id: "station-z", created_at: expect.any(Date) },
    ]);
  });

  test("createCampaignAudience rejects contact ids not in the current organization", async () => {
    hoisted.selectRows.push([]);

    await expect(createCampaignAudience("org-1", {
      name: "Invalid",
      description: null,
      contact_member_ids: ["contact-missing"],
      station_member_ids: [],
      membership_rules: {
        include_contact_roles: [],
        exclude_contact_roles: [],
        require_contact_email: true,
        exclude_contact_ids: [],
        include_station_states: [],
        exclude_station_states: [],
        require_station_email: true,
        exclude_station_ids: [],
      },
    })).rejects.toMatchObject({
      status: 404,
      message: "One or more contact IDs are not available in this workspace",
    });
    expect(hoisted.insertCalls).toHaveLength(0);
  });

  test("createCampaignAudience rejects station ids not in the current organization", async () => {
    hoisted.selectRows.push(
      [{ id: "contact-a" }],
      [],
    );

    await expect(createCampaignAudience("org-1", {
      name: "Invalid Station",
      description: null,
      contact_member_ids: ["contact-a"],
      station_member_ids: ["station-missing"],
      membership_rules: {
        include_contact_roles: [],
        exclude_contact_roles: [],
        require_contact_email: true,
        exclude_contact_ids: [],
        include_station_states: [],
        exclude_station_states: [],
        require_station_email: true,
        exclude_station_ids: [],
      },
    })).rejects.toMatchObject({
      status: 404,
      message: "One or more station IDs are not available in this workspace",
    });
    expect(hoisted.insertCalls).toHaveLength(0);
  });

  test("attachCampaignAudience is idempotent for already persisted campaign link", async () => {
    hoisted.selectRows.push(
      [{ id: "campaign-1", campaign_audience_id: "audience-target" }],
      [{ id: "audience-target", name: "Target", description: null, membership_rules: {
        include_contact_roles: [],
        exclude_contact_roles: [],
        require_contact_email: true,
        exclude_contact_ids: [],
        include_station_states: [],
        exclude_station_states: [],
        require_station_email: true,
        exclude_station_ids: [],
      } }],
      [{ campaignId: "campaign-1" }],
    );

    const result = await attachCampaignAudience("org-1", "campaign-1", { audience_id: "audience-target" });

    expect(result).toEqual({ ok: true });
    expect(hoisted.updateCalls).toHaveLength(0);
  });

  test("detachCampaignAudience no-ops if campaign currently has no linked audience", async () => {
    hoisted.selectRows.push([{ id: "campaign-1", campaign_audience_id: null }]);

    const result = await detachCampaignAudience("org-1", "campaign-1");

    expect(result).toEqual({ ok: true });
    expect(hoisted.updateCalls).toHaveLength(0);
  });

  test("detachCampaignAudience clears campaign audience link and updates audit timestamp", async () => {
    hoisted.selectRows.push(
      [{ id: "campaign-1", campaign_audience_id: "audience-target" }],
    );

    const result = await detachCampaignAudience("org-1", "campaign-1");

    expect(result).toEqual({ ok: true });
    expect(hoisted.updateCalls).toHaveLength(1);
    expect(hoisted.updateCalls[0].table).toBe(campaigns);
    expect(hoisted.updateCalls[0].values).toMatchObject({
      campaign_audience_id: null,
      revision: { kind: "sql" },
      updated_at: expect.any(Date),
    });
  });

  test("getCampaignAudienceForCampaign returns null for campaign with no audience", async () => {
    hoisted.selectRows.push([{ id: "campaign-1", campaign_audience_id: null }]);

    await expect(getCampaignAudienceForCampaign("org-1", "campaign-1")).resolves.toBeNull();
  });

  test("getCampaignAudienceForCampaign is tenant-safe for missing campaign", async () => {
    hoisted.selectRows.push([]);

    await expect(getCampaignAudienceForCampaign("org-1", "campaign-1")).rejects.toMatchObject({
      status: 404,
      message: "Campaign not found",
    });
    expect(hoisted.updateCalls).toHaveLength(0);
    expect(hoisted.insertCalls).toHaveLength(0);
    expect(hoisted.deleteCalls).toHaveLength(0);
  });

  test("getCampaignAudienceForCampaign returns null when campaign audience schema is unavailable", async () => {
    hoisted.selectErrors.push(Object.assign(new Error("relation campaign_audiences does not exist"), { code: "42P01" }));

    await expect(getCampaignAudienceForCampaign("org-1", "campaign-1")).resolves.toBeNull();
  });

  test("getCampaignAudienceFeatureAvailability is false when campaign audience schema is unavailable", async () => {
    hoisted.selectErrors.push(Object.assign(new Error("relation campaign_audiences does not exist"), { code: "42P01" }));

    const result = await getCampaignAudienceFeatureAvailability("org-1");

    expect(result).toBe(false);
  });
});

function hasTenantFilter(
  call: { table: unknown; predicate: unknown },
  table: unknown,
  column: { name: string },
  orgId: string,
): boolean {
  if (call.table !== table) return false;
  return hasOrgPredicate(call.predicate, column, orgId);
}

function hasOrgPredicate(predicate: unknown, column: { name: string }, orgId: string): boolean {
  if (!predicate || typeof predicate !== "object") return false;

  if ((predicate as { kind?: string }).kind === "eq") {
    const eqPredicate = predicate as { kind: string; left?: { name?: string }; right?: unknown };
    return eqPredicate.left?.name === column.name && eqPredicate.right === orgId;
  }

  if ((predicate as { kind?: string }).kind === "and") {
    const andPredicate = predicate as { kind: string; conditions?: unknown[] };
    return (andPredicate.conditions ?? []).some((child) => hasOrgPredicate(child, column, orgId));
  }

  return false;
}

function containsCondition(predicate: unknown, column: { name: string }, kind: string): boolean {
  if (!predicate || typeof predicate !== "object") return false;
  const record = predicate as { kind?: string; left?: { name?: string }; conditions?: unknown[] };
  if (record.kind === kind && record.left?.name === column.name) return true;
  if (record.kind === "and") return (record.conditions ?? []).some((child) => containsCondition(child, column, kind));
  return false;
}

function findCondition(predicate: unknown, column: { name: string }, kind: string): unknown {
  if (!predicate || typeof predicate !== "object") return undefined;
  const record = predicate as { kind?: string; left?: { name?: string }; conditions?: unknown[] };
  if (record.kind === kind && record.left?.name === column.name) return record;
  if (record.kind === "and") {
    return (record.conditions ?? []).map((child) => findCondition(child, column, kind)).find(Boolean);
  }
  return undefined;
}
