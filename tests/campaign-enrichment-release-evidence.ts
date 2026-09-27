import { CAMPAIGN_ENRICHMENT_CANONICAL_LEAD_FIELDS } from "../src/lib/campaign-enrichment-local-tool-contract";

const ACTIVITY_SOURCES = [
  "outreach_events",
  "tasks",
  "email_logs",
  "lead_milestones",
  "review_state",
] as const;
const ENRICHMENT_FIELDS = ["musical_fit", "pitch_angle", "contact_route", "programming_focus"] as const;

type JsonRecord = Record<string, unknown>;

export function requireCompleteActivitySourceStates(value: unknown) {
  const snapshot = requiredRecord(value, "campaign activity snapshot");
  if (!Array.isArray(snapshot.sourceStates)) {
    throw new Error("Campaign Activity sourceStates were unavailable");
  }

  const states = snapshot.sourceStates.map((entry, index) => requiredRecord(entry, `Campaign Activity sourceState ${index}`));
  for (const state of states) {
    if (!ACTIVITY_SOURCES.includes(state.source as (typeof ACTIVITY_SOURCES)[number])) {
      throw new Error(`Unexpected Campaign Activity source: ${String(state.source)}`);
    }
  }

  return ACTIVITY_SOURCES.map((source) => {
    const matches = states.filter((state) => state.source === source);
    if (matches.length !== 1) {
      throw new Error(`Campaign Activity source ${source} appeared ${matches.length} times`);
    }
    const state = matches[0]!;
    if (state.state !== "complete" || state.message !== null) {
      throw new Error(`Campaign Activity source ${source} was not complete: ${String(state.message ?? state.state)}`);
    }
    return { source, state: "complete" as const, message: null };
  });
}

export function canonicalLeadEvidence(value: unknown) {
  const item = requiredRecord(value, "campaign enrichment item");
  const lead = requiredRecord(item.canonical_lead, "campaign enrichment canonical_lead");
  const actualKeys = Object.keys(lead).sort();
  const expectedKeys = [...CAMPAIGN_ENRICHMENT_CANONICAL_LEAD_FIELDS].sort();
  const missing = expectedKeys.filter((key) => !actualKeys.includes(key));
  const unexpected = actualKeys.filter((key) => !expectedKeys.includes(key as (typeof expectedKeys)[number]));
  if (missing.length || unexpected.length) {
    throw new Error(`Canonical lead DTO fields differ; missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`);
  }
  assertCanonicalLeadTypes(lead);

  if (!(typeof item.exact_edit === "string" || item.exact_edit === null)) {
    throw new Error("Campaign enrichment exact_edit was invalid");
  }
  if (typeof item.lead_revision !== "string" || !/^[a-f0-9]{64}$/.test(item.lead_revision)) {
    throw new Error("Campaign enrichment lead_revision was invalid");
  }
  if (!Array.isArray(item.missing_enrichment_fields) || item.missing_enrichment_fields.some((field) => (
    typeof field !== "string" || !ENRICHMENT_FIELDS.includes(field as (typeof ENRICHMENT_FIELDS)[number])
  ))) {
    throw new Error("Campaign enrichment missing_enrichment_fields were invalid");
  }

  return {
    lead: structuredClone(lead),
    exact_edit: item.exact_edit,
    lead_revision: item.lead_revision,
    missing_enrichment_fields: [...item.missing_enrichment_fields],
  };
}

function assertCanonicalLeadTypes(lead: JsonRecord) {
  for (const field of ["id", "campaign_id", "target_name", "target_type", "discovery_source", "pipeline_stage"] as const) {
    if (typeof lead[field] !== "string" || !lead[field]) throw new Error(`Canonical lead field ${field} was invalid`);
  }
  for (const field of [
    "exact_edit_track_id",
    "target_url",
    "contact_route",
    "recommending_person",
    "musical_fit",
    "pitch_angle",
    "outcome",
    "evidence_url",
  ] as const) {
    if (!(typeof lead[field] === "string" || lead[field] === null)) {
      throw new Error(`Canonical lead field ${field} was invalid`);
    }
  }
  for (const field of [
    "contact_route_verified_at",
    "last_contacted_at",
    "follow_up_at",
    "published_at",
    "updated_at",
  ] as const) {
    const value = lead[field];
    if (!(value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))))) {
      throw new Error(`Canonical lead field ${field} was invalid`);
    }
  }
  if (!(typeof lead.introduction_available === "boolean" || lead.introduction_available === null)) {
    throw new Error("Canonical lead field introduction_available was invalid");
  }
  const scoreLimits = {
    relationship_warmth: 3,
    editorial_fit: 3,
    useful_reach: 2,
    direct_free_access: 2,
  } as const;
  for (const [field, maximum] of Object.entries(scoreLimits) as Array<[keyof typeof scoreLimits, number]>) {
    if (typeof lead[field] !== "number" || !Number.isInteger(lead[field]) || lead[field] < 0 || lead[field] > maximum) {
      throw new Error(`Canonical lead field ${field} was invalid`);
    }
  }
}

function requiredRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} was not an object`);
  }
  return value as JsonRecord;
}
