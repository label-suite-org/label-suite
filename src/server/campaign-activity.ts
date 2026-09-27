import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { users } from "../db/auth-schema";
import {
  campaign_activity_proposal_decisions,
  campaign_enrichment_suggestions,
  campaign_leads,
  campaign_outreach_drafts,
  campaign_outreach_events,
  campaigns,
  email_logs,
  org_memberships,
  ops_tasks,
  radio_stations,
} from "../db/schema";
import { db } from "../lib/db";
import {
  campaignActivityDecisionSchema,
  composeCampaignActivity,
  type ActivityDecisionRow,
  type ActivityLeadState,
  type ActivityReviewStateRow,
  type ActivitySource,
  type ActivitySourceState,
  type ActivityTaskRow,
  type CampaignActivityInputs,
  type CampaignActivitySnapshot,
} from "./campaign-activity-core";
import { ConflictError, HttpError } from "./errors";

export type ActivitySourceReadOptions = { limit: number };

type OutreachEventRow = CampaignActivityInputs["outreachEvents"][number] & {
  actorLabel?: string | null;
};

type TaskRow = ActivityTaskRow & {
  priority?: string | null;
  owner?: string | null;
  dueDate?: string | null;
  nextAction?: string | null;
  createdAt?: Date | null;
};

type EmailLogRow = CampaignActivityInputs["emailLogs"][number] & {
  createdAt?: Date | null;
};

export type CampaignActivityDecisionUpsert = {
  id: string;
  org_id: string;
  campaign_id: string;
  lead_id: string | null;
  proposal_key: string;
  rule_key: string;
  rule_version: number;
  decision: "dismissed" | "resolved";
  reason: string | null;
  decided_by: string;
  decided_at: Date;
  created_at: Date;
  updated_at: Date;
};

export interface CampaignActivityStore {
  findCampaign(orgId: string, campaignId: string): Promise<boolean>;
  listOutreachEvents(orgId: string, campaignId: string, options?: ActivitySourceReadOptions): Promise<OutreachEventRow[]>;
  listTasks(orgId: string, campaignId: string, options?: ActivitySourceReadOptions): Promise<TaskRow[]>;
  listEmailLogs(orgId: string, campaignId: string, options?: ActivitySourceReadOptions): Promise<EmailLogRow[]>;
  listLeads(orgId: string, campaignId: string, options?: ActivitySourceReadOptions): Promise<ActivityLeadState[]>;
  findLeadsByIds(orgId: string, campaignId: string, leadIds: string[]): Promise<ActivityLeadState[]>;
  listSuggestionReviewStates(orgId: string, campaignId: string, options?: ActivitySourceReadOptions): Promise<ActivityReviewStateRow[]>;
  listDraftReviewStates(orgId: string, campaignId: string, options?: ActivitySourceReadOptions): Promise<ActivityReviewStateRow[]>;
  findDraftReviewStatesByIds(orgId: string, campaignId: string, draftIds: string[]): Promise<ActivityReviewStateRow[]>;
  listDecisions(orgId: string, campaignId: string, options?: ActivitySourceReadOptions): Promise<ActivityDecisionRow[]>;
  upsertDecision(row: CampaignActivityDecisionUpsert): Promise<void>;
}

type CampaignActivityDependencies = {
  store: CampaignActivityStore;
  now: () => Date;
  randomUUID: () => string;
};

const defaultStore: CampaignActivityStore = {
  async findCampaign(orgId, campaignId) {
    const rows = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.org_id, orgId), eq(campaigns.id, campaignId)))
      .limit(1);
    return rows.length > 0;
  },

  async listOutreachEvents(orgId, campaignId, options) {
    const rows = db
      .select({
        id: campaign_outreach_events.id,
        campaignId: campaign_outreach_events.campaign_id,
        leadId: campaign_outreach_events.lead_id,
        draftId: campaign_outreach_events.draft_id,
        eventType: campaign_outreach_events.event_type,
        actorUserId: campaign_outreach_events.actor_user_id,
        actorLabel: users.name,
        occurredAt: campaign_outreach_events.occurred_at,
        detailChannel: sql<string | null>`${campaign_outreach_events.details} ->> 'channel'`,
        detailSuggestionId: sql<string | null>`${campaign_outreach_events.details} ->> 'suggestion_id'`,
        detailSuggestionType: sql<string | null>`${campaign_outreach_events.details} ->> 'suggestion_type'`,
        detailFromStage: sql<string | null>`${campaign_outreach_events.details} ->> 'from_stage'`,
        detailToStage: sql<string | null>`${campaign_outreach_events.details} ->> 'to_stage'`,
        detailVersion: sql<string | null>`${campaign_outreach_events.details} ->> 'version'`,
      })
      .from(campaign_outreach_events)
      .leftJoin(org_memberships, and(
        eq(campaign_outreach_events.actor_user_id, org_memberships.user_id),
        eq(org_memberships.org_id, orgId),
      ))
      .leftJoin(users, eq(org_memberships.user_id, users.id))
      .where(and(
        eq(campaign_outreach_events.org_id, orgId),
        eq(campaign_outreach_events.campaign_id, campaignId),
      ))
      .orderBy(desc(campaign_outreach_events.occurred_at), asc(campaign_outreach_events.id));
    const boundedRows = limitSource(rows, options);

    return (await boundedRows).map((row) => ({
      id: row.id,
      campaignId: row.campaignId,
      leadId: row.leadId,
      draftId: row.draftId,
      eventType: normalizeEventType(row.eventType),
      actorUserId: row.actorUserId,
      actorLabel: row.actorLabel,
      occurredAt: row.occurredAt,
      details: compactDetails({
        channel: row.detailChannel,
        suggestion_id: row.detailSuggestionId,
        suggestion_type: row.detailSuggestionType,
        from_stage: row.detailFromStage,
        to_stage: row.detailToStage,
        version: row.detailVersion,
      }),
    }));
  },

  async listTasks(orgId, campaignId, options) {
    const rows = db
      .select({
        id: ops_tasks.id,
        campaignId: ops_tasks.linked_campaign_id,
        leadId: ops_tasks.linked_campaign_lead_id,
        contactId: ops_tasks.linked_contact_id,
        taskName: ops_tasks.task_name,
        status: ops_tasks.status,
        priority: ops_tasks.priority,
        owner: ops_tasks.owner,
        dueDate: ops_tasks.due_date,
        nextAction: ops_tasks.next_action,
        createdAt: ops_tasks.created_at,
        updatedAt: ops_tasks.updated_at,
      })
      .from(ops_tasks)
      .where(and(eq(ops_tasks.org_id, orgId), eq(ops_tasks.linked_campaign_id, campaignId)))
      .orderBy(sql`${ops_tasks.updated_at} desc nulls last`, asc(ops_tasks.id));
    return (await limitSource(rows, options)).map((row) => ({ ...row, campaignId: row.campaignId ?? campaignId }));
  },

  async listEmailLogs(orgId, campaignId, options) {
    const rows = db
      .select({
        id: email_logs.id,
        campaignId: email_logs.campaign_id,
        subject: email_logs.subject,
        status: email_logs.status,
        provider: email_logs.provider,
        operatorLabel: users.name,
        stationLabel: radio_stations.name,
        sentAt: email_logs.sent_at,
        createdAt: email_logs.created_at,
      })
      .from(email_logs)
      .leftJoin(org_memberships, and(
        eq(email_logs.operator_id, org_memberships.user_id),
        eq(org_memberships.org_id, orgId),
      ))
      .leftJoin(users, eq(org_memberships.user_id, users.id))
      .leftJoin(radio_stations, and(
        eq(email_logs.station_id, radio_stations.id),
        eq(radio_stations.org_id, orgId),
      ))
      .where(and(eq(email_logs.org_id, orgId), eq(email_logs.campaign_id, campaignId)))
      .orderBy(sql`${email_logs.sent_at} desc nulls last`, asc(email_logs.id));
    const boundedRows = limitSource(rows, options);

    return (await boundedRows).map((row) => ({
      ...row,
      campaignId: row.campaignId ?? campaignId,
      leadId: null,
      contactId: null,
    }));
  },

  async listLeads(orgId, campaignId, options) {
    const rows = db
      .select({
        id: campaign_leads.id,
        campaignId: campaign_leads.campaign_id,
        contactId: campaign_leads.contact_id,
        followUpAt: campaign_leads.follow_up_at,
        lastContactedAt: campaign_leads.last_contacted_at,
        outcome: campaign_leads.outcome,
        publishedAt: campaign_leads.published_at,
        pipelineStage: campaign_leads.pipeline_stage,
      })
      .from(campaign_leads)
      .where(and(eq(campaign_leads.org_id, orgId), eq(campaign_leads.campaign_id, campaignId)))
      .orderBy(desc(campaign_leads.updated_at), asc(campaign_leads.id));
    return limitSource(rows, options);
  },

  async findLeadsByIds(orgId, campaignId, leadIds) {
    if (leadIds.length === 0) return [];
    return db
      .select({
        id: campaign_leads.id,
        campaignId: campaign_leads.campaign_id,
        contactId: campaign_leads.contact_id,
        followUpAt: campaign_leads.follow_up_at,
        lastContactedAt: campaign_leads.last_contacted_at,
        outcome: campaign_leads.outcome,
        publishedAt: campaign_leads.published_at,
        pipelineStage: campaign_leads.pipeline_stage,
      })
      .from(campaign_leads)
      .where(and(
        eq(campaign_leads.org_id, orgId),
        eq(campaign_leads.campaign_id, campaignId),
        inArray(campaign_leads.id, leadIds),
      ));
  },

  async listSuggestionReviewStates(orgId, campaignId, options) {
    const rows = db
      .select({
        id: campaign_enrichment_suggestions.id,
        campaignId: campaign_enrichment_suggestions.campaign_id,
        leadId: campaign_enrichment_suggestions.lead_id,
        state: campaign_enrichment_suggestions.status,
        occurredAt: campaign_enrichment_suggestions.updated_at,
      })
      .from(campaign_enrichment_suggestions)
      .where(and(
        eq(campaign_enrichment_suggestions.org_id, orgId),
        eq(campaign_enrichment_suggestions.campaign_id, campaignId),
      ))
      .orderBy(sql`${campaign_enrichment_suggestions.updated_at} desc nulls last`, asc(campaign_enrichment_suggestions.id));
    return (await limitSource(rows, options)).map((row) => ({ ...row, id: `suggestion:${row.id}` }));
  },

  async listDraftReviewStates(orgId, campaignId, options) {
    const rows = db
      .select({
        id: campaign_outreach_drafts.id,
        campaignId: campaign_outreach_drafts.campaign_id,
        leadId: campaign_outreach_drafts.lead_id,
        state: campaign_outreach_drafts.status,
        occurredAt: campaign_outreach_drafts.updated_at,
      })
      .from(campaign_outreach_drafts)
      .where(and(
        eq(campaign_outreach_drafts.org_id, orgId),
        eq(campaign_outreach_drafts.campaign_id, campaignId),
      ))
      .orderBy(sql`${campaign_outreach_drafts.updated_at} desc nulls last`, asc(campaign_outreach_drafts.id));
    return (await limitSource(rows, options)).map((row) => ({ ...row, id: `draft:${row.id}` }));
  },

  async findDraftReviewStatesByIds(orgId, campaignId, draftIds) {
    if (draftIds.length === 0) return [];
    const rows = await db
      .select({
        id: campaign_outreach_drafts.id,
        campaignId: campaign_outreach_drafts.campaign_id,
        leadId: campaign_outreach_drafts.lead_id,
        state: campaign_outreach_drafts.status,
        occurredAt: campaign_outreach_drafts.updated_at,
      })
      .from(campaign_outreach_drafts)
      .where(and(
        eq(campaign_outreach_drafts.org_id, orgId),
        eq(campaign_outreach_drafts.campaign_id, campaignId),
        inArray(campaign_outreach_drafts.id, draftIds),
      ));
    return rows.map((row) => ({ ...row, id: `draft:${row.id}` }));
  },

  async listDecisions(orgId, campaignId, options) {
    const rows = db
      .select({
        proposalKey: campaign_activity_proposal_decisions.proposal_key,
        decision: campaign_activity_proposal_decisions.decision,
        reason: campaign_activity_proposal_decisions.reason,
        decidedAt: campaign_activity_proposal_decisions.decided_at,
      })
      .from(campaign_activity_proposal_decisions)
      .where(and(
        eq(campaign_activity_proposal_decisions.org_id, orgId),
        eq(campaign_activity_proposal_decisions.campaign_id, campaignId),
      ))
      .orderBy(desc(campaign_activity_proposal_decisions.decided_at), asc(campaign_activity_proposal_decisions.proposal_key));

    return (await limitSource(rows, options)).map((row) => ({ ...row, decision: parseStoredDecision(row.decision) }));
  },

  async upsertDecision(row) {
    await db.insert(campaign_activity_proposal_decisions).values(row).onConflictDoUpdate({
      target: [
        campaign_activity_proposal_decisions.org_id,
        campaign_activity_proposal_decisions.campaign_id,
        campaign_activity_proposal_decisions.proposal_key,
      ],
      set: {
        lead_id: row.lead_id,
        rule_key: row.rule_key,
        rule_version: row.rule_version,
        decision: row.decision,
        reason: row.reason,
        decided_by: row.decided_by,
        decided_at: row.decided_at,
        updated_at: row.updated_at,
      },
    });
  },
};

const defaultDependencies: CampaignActivityDependencies = {
  store: defaultStore,
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
};

export async function getCampaignActivitySnapshot(
  orgId: string,
  campaignId: string,
  dependencies: Partial<CampaignActivityDependencies> = {},
  options?: { sourceLimit?: number },
): Promise<CampaignActivitySnapshot> {
  const resolved = { ...defaultDependencies, ...dependencies };
  await requireCampaign(resolved.store, orgId, campaignId);
  const input = await loadActivityInputs(orgId, campaignId, resolved.store, options);
  return composeSnapshot({ ...input, campaignId, now: resolved.now() });
}

export async function decideCampaignActivityProposal(
  orgId: string,
  campaignId: string,
  input: unknown,
  actorUserId: string,
  dependencies: Partial<CampaignActivityDependencies> = {},
): Promise<CampaignActivitySnapshot> {
  const payload = campaignActivityDecisionSchema.parse(input);
  const resolved = { ...defaultDependencies, ...dependencies };
  await requireCampaign(resolved.store, orgId, campaignId);
  const now = resolved.now();
  const sourceInput = await loadActivityInputs(orgId, campaignId, resolved.store);
  const decisionsWithoutCurrent = sourceInput.decisions.filter((row) => row.proposalKey !== payload.proposal_key);
  const before = composeSnapshot({
    ...sourceInput,
    campaignId,
    now,
    decisions: decisionsWithoutCurrent,
  });
  const proposal = before.proposals.find((item) => item.key === payload.proposal_key && item.state === "pending");
  if (!proposal) throw new ConflictError("Activity proposal is stale or unavailable");

  const row: CampaignActivityDecisionUpsert = {
    id: resolved.randomUUID(),
    org_id: orgId,
    campaign_id: campaignId,
    lead_id: proposal.leadId,
    proposal_key: proposal.key,
    rule_key: proposal.ruleKey,
    rule_version: proposal.ruleVersion,
    decision: payload.decision,
    reason: payload.reason,
    decided_by: actorUserId,
    decided_at: now,
    created_at: now,
    updated_at: now,
  };
  await resolved.store.upsertDecision(row);

  return composeSnapshot({
    ...sourceInput,
    campaignId,
    now,
    decisions: [
      ...decisionsWithoutCurrent,
      { proposalKey: row.proposal_key, decision: row.decision, reason: row.reason, decidedAt: row.decided_at },
    ],
  });
}

async function loadActivityInputs(orgId: string, campaignId: string, store: CampaignActivityStore, options?: { sourceLimit?: number }) {
  const readOptions = options?.sourceLimit ? { limit: options.sourceLimit } : undefined;
  const [outreachEvents, tasks, emailLogs, leads, suggestions, drafts, decisions] = await Promise.all([
    readSource("outreach_events", "Outreach event activity is unavailable", () => readStore(store.listOutreachEvents, orgId, campaignId, readOptions), options?.sourceLimit),
    readSource("tasks", "Task activity is unavailable", () => readStore(store.listTasks, orgId, campaignId, readOptions), options?.sourceLimit),
    readSource("email_logs", "Email activity is unavailable", () => readStore(store.listEmailLogs, orgId, campaignId, readOptions), options?.sourceLimit),
    readSource("lead_milestones", "Lead milestone activity is unavailable", () => readStore(store.listLeads, orgId, campaignId, readOptions), options?.sourceLimit),
    readSource("review_state", "Review state is unavailable", () => readStore(store.listSuggestionReviewStates, orgId, campaignId, readOptions), options?.sourceLimit),
    readSource("review_state", "Review state is unavailable", () => readStore(store.listDraftReviewStates, orgId, campaignId, readOptions), options?.sourceLimit),
    readSource("review_state", "Review state is unavailable", () => readStore(store.listDecisions, orgId, campaignId, readOptions), options?.sourceLimit),
  ]);
  const support = options?.sourceLimit === undefined
    ? { leads: [] as ActivityLeadState[], drafts: [] as ActivityReviewStateRow[] }
    : await loadReferenceSupport(orgId, campaignId, store, {
      outreachEvents: outreachEvents.rows,
      tasks: tasks.rows,
      emailLogs: emailLogs.rows,
      leads: leads.rows,
      reviewStates: [...suggestions.rows, ...drafts.rows],
      leadSourceAvailable: leads.state.state !== "unavailable",
      draftSourceAvailable: drafts.state.state !== "unavailable",
    });
  return sanitizeActivityInputs({
    campaignId,
    outreachEvents: outreachEvents.rows,
    tasks: tasks.rows,
    emailLogs: emailLogs.rows,
    leads: leads.rows,
    supportLeads: support.leads,
    reviewStates: [...suggestions.rows, ...drafts.rows],
    supportDrafts: support.drafts,
    decisions: decisions.rows,
    sourceStates: [
      outreachEvents.state,
      tasks.state,
      emailLogs.state,
      leads.state,
      mergeSourceStates(suggestions.state, drafts.state, decisions.state),
    ],
  });
}

async function requireCampaign(store: CampaignActivityStore, orgId: string, campaignId: string) {
  if (!(await store.findCampaign(orgId, campaignId))) {
    throw new HttpError("Campaign not found", 404);
  }
}

function sanitizeActivityInputs(input: {
  campaignId: string;
  outreachEvents: OutreachEventRow[];
  tasks: TaskRow[];
  emailLogs: EmailLogRow[];
  leads: ActivityLeadState[];
  supportLeads: ActivityLeadState[];
  reviewStates: ActivityReviewStateRow[];
  supportDrafts: ActivityReviewStateRow[];
  decisions: ActivityDecisionRow[];
  sourceStates: ActivitySourceState[];
}) {
  const leads = input.leads
    .filter((lead) => !lead.campaignId || lead.campaignId === input.campaignId)
    .map((lead) => ({ ...lead, campaignId: input.campaignId }));
  const supportLeads = input.supportLeads
    .filter((lead) => !lead.campaignId || lead.campaignId === input.campaignId)
    .map((lead) => ({ ...lead, campaignId: input.campaignId }));
  const allLeads = [...leads, ...supportLeads];
  const leadIds = new Set(allLeads.map((lead) => lead.id));
  const leadContacts = new Map(allLeads.map((lead) => [lead.id, lead.contactId]));
  const drafts = new Map<string, string | null>();
  for (const review of [...input.reviewStates, ...input.supportDrafts]) {
    if (!review.id.startsWith("draft:")) continue;
    const draftId = review.id.slice("draft:".length);
    if (review.campaignId === input.campaignId && (!review.leadId || leadIds.has(review.leadId))) {
      drafts.set(draftId, review.leadId);
    }
  }
  const validLeadId = (leadId: string | null | undefined) => leadId && leadIds.has(leadId) ? leadId : null;
  const validContactId = (leadId: string | null, contactId: string | null | undefined) => {
    if (!leadId || !contactId) return null;
    return leadContacts.get(leadId) === contactId ? contactId : null;
  };
  const validDraftId = (leadId: string | null, draftId: string | null | undefined) => {
    if (!draftId || !drafts.has(draftId)) return null;
    const draftLead = drafts.get(draftId);
    return (!draftLead || (leadId !== null && draftLead === leadId)) ? draftId : null;
  };
  const outreachEvents = input.outreachEvents
    .filter((event) => event.campaignId === input.campaignId)
    .map((event) => {
      const leadId = validLeadId(event.leadId);
      return { ...event, campaignId: input.campaignId, leadId, draftId: validDraftId(leadId, event.draftId) };
    });
  const tasks = input.tasks
    .filter((task) => task.campaignId === input.campaignId)
    .map((task) => {
      const leadId = validLeadId(task.leadId);
      return { ...task, campaignId: input.campaignId, leadId, contactId: validContactId(leadId, task.contactId) };
    });
  const emailLogs = input.emailLogs
    .filter((email) => email.campaignId === input.campaignId)
    .map((email) => {
      const leadId = validLeadId(email.leadId);
      return { ...email, campaignId: input.campaignId, leadId, contactId: validContactId(leadId, email.contactId) };
    });
  const reviewStates = input.reviewStates
    .filter((review) => review.campaignId === input.campaignId)
    .filter((review) => !review.id.startsWith("draft:") || drafts.has(review.id.slice("draft:".length)))
    .map((review) => ({ ...review, campaignId: input.campaignId, leadId: validLeadId(review.leadId) }));
  return {
    ...input,
    outreachEvents,
    tasks,
    emailLogs,
    leads,
    reviewStates,
  };
}

async function loadReferenceSupport(
  orgId: string,
  campaignId: string,
  store: CampaignActivityStore,
  input: Pick<CampaignActivityInputs, "outreachEvents" | "tasks" | "emailLogs" | "leads" | "reviewStates">
    & { leadSourceAvailable: boolean; draftSourceAvailable: boolean },
) {
  const visibleLeadIds = new Set(input.leads
    .filter((lead) => !lead.campaignId || lead.campaignId === campaignId)
    .map((lead) => lead.id));
  const visibleDraftIds = new Set(input.reviewStates
    .filter((review) => review.campaignId === campaignId && review.id.startsWith("draft:"))
    .map((review) => review.id.slice("draft:".length)));
  const referencedLeadIds = uniqueReferenceIds([
    ...input.outreachEvents.filter((event) => event.campaignId === campaignId).map((event) => event.leadId),
    ...input.tasks.filter((task) => task.campaignId === campaignId).map((task) => task.leadId),
    ...input.emailLogs.filter((email) => email.campaignId === campaignId).map((email) => email.leadId ?? null),
  ]).filter((id) => !visibleLeadIds.has(id));
  const referencedDraftIds = uniqueReferenceIds(input.outreachEvents
    .filter((event) => event.campaignId === campaignId)
    .map((event) => event.draftId))
    .filter((id) => !visibleDraftIds.has(id));
  const [leads, drafts] = await Promise.all([
    input.leadSourceAvailable && referencedLeadIds.length ? store.findLeadsByIds(orgId, campaignId, referencedLeadIds) : [],
    input.draftSourceAvailable && referencedDraftIds.length ? store.findDraftReviewStatesByIds(orgId, campaignId, referencedDraftIds) : [],
  ]);
  return { leads, drafts };
}

function uniqueReferenceIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function composeSnapshot(
  input: Awaited<ReturnType<typeof loadActivityInputs>> & { campaignId: string; now: Date },
) {
  const snapshot = composeCampaignActivity(input);
  const actorLabels = new Map(input.outreachEvents.map((event) => [event.id, event.actorLabel ?? null]));
  return {
    ...snapshot,
    items: snapshot.items.map((item) => item.source.kind === "event"
      ? { ...item, actor: { ...item.actor, label: actorLabels.get(item.source.recordId) ?? null } }
      : item),
  };
}

async function readStore<T>(
  read: (orgId: string, campaignId: string, options?: ActivitySourceReadOptions) => Promise<T[]>,
  orgId: string,
  campaignId: string,
  options?: ActivitySourceReadOptions,
): Promise<T[]> {
  return options ? read(orgId, campaignId, options) : read(orgId, campaignId);
}

function limitSource<T>(query: T, options?: ActivitySourceReadOptions): T {
  return options ? (query as T & { limit: (value: number) => T }).limit(options.limit + 1) : query;
}

async function readSource<T>(source: ActivitySource, unavailableMessage: string, read: () => Promise<T[]>, sourceLimit?: number) {
  try {
    const rows = await read();
    const partial = sourceLimit !== undefined && rows.length > sourceLimit;
    return { rows: partial ? rows.slice(0, sourceLimit) : rows, state: sourceState(source, partial ? "partial" : "complete", partial ? `Limited to ${sourceLimit} recent source records` : null) };
  } catch (error) {
    if (isSchemaUnavailable(error)) return { rows: [] as T[], state: sourceState(source, "unavailable", unavailableMessage) };
    throw error;
  }
}

function sourceState(source: ActivitySource, state: ActivitySourceState["state"], message: string | null): ActivitySourceState {
  return { source, state, message };
}

function mergeSourceStates(...states: ActivitySourceState[]): ActivitySourceState {
  if (states.some((state) => state.state === "unavailable")) {
    return sourceState("review_state", "unavailable", "Review state is unavailable");
  }
  const partial = states.find((state) => state.state === "partial");
  return partial
    ? sourceState("review_state", "partial", partial.message)
    : sourceState("review_state", "complete", null);
}

function isSchemaUnavailable(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth += 1) {
    const value = current as { code?: unknown; cause?: unknown };
    if (value.code === "42P01" || value.code === "42703") return true;
    current = value.cause;
  }
  return false;
}

function normalizeEventType(eventType: string) {
  if (eventType === "draft_generated" || eventType === "draft_version_created") return "draft_created";
  return eventType;
}

function compactDetails(values: Record<string, string | null>) {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== null));
}

function parseStoredDecision(value: string): ActivityDecisionRow["decision"] {
  if (value === "dismissed" || value === "resolved") return value;
  throw new TypeError("Invalid stored activity proposal decision");
}
