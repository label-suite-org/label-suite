import { z } from "zod";
import {
  campaignEnrichmentClaimRequestSchema,
  campaignEnrichmentProposalSubmissionSchema,
  campaignEnrichmentQueueQuerySchema,
  campaignEnrichmentReleaseRequestSchema,
  enrichmentProposalFieldSchema,
  LOCAL_TOOL_API_VERSION,
  type CampaignEnrichmentProposalSubmission,
  type CampaignEnrichmentQueueQuery,
  type LocalToolErrorCode,
  type LocalToolSuccessEnvelope,
} from "../../../src/lib/campaign-enrichment-local-tool-contract";
import {
  operatorHealthSchema,
  operatorJobsHealthSchema,
  operatorOperationsBriefInputSchema,
  operatorOperationsBriefSchema,
  type OperatorHealth,
  type OperatorJobsHealth,
  type OperatorOperationsBrief,
  type OperatorOperationsBriefInput,
} from "../../../src/lib/operator-diagnostics-contract";

export interface CredentialStore {
  read(baseUrl: string): Promise<string>;
}

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BODY_BYTES = 16 * 1_024 * 1_024;
const API_PATH = "/api/local-tools/v1/campaign-enrichment";
const OPERATOR_API_PATH = "/api/local-tools/v1/operator";
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_LABEL_LENGTH = 500;
const MAX_URL_LENGTH = 2_048;
const MAX_VALUE_LENGTH = 2_000;
const MAX_CONTEXT_LENGTH = 20_000;
const MAX_QUEUE_ITEMS = 50;
const MAX_ITEM_SUGGESTIONS_PER_STATE = 50;
const MAX_RELEASE_TRACKS = 100;
const MAX_EVIDENCE_PER_SUGGESTION = 8;
const requestIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const pathIdSchema = z.string().trim().min(1).max(128);
const identifierSchema = z.string().min(1).max(MAX_IDENTIFIER_LENGTH);
const labelSchema = z.string().max(MAX_LABEL_LENGTH);
const valueSchema = z.string().max(MAX_VALUE_LENGTH);
const contextSchema = z.string().max(MAX_CONTEXT_LENGTH);
const urlSchema = z.url().max(MAX_URL_LENGTH);
const httpsUrlSchema = urlSchema.refine((value) => new URL(value).protocol === "https:");
const claimConflictDetailsSchema = z.object({
  expires_at: z.iso.datetime({ offset: true }),
}).strict();

const errorDefinitions = {
  authentication_failed: { message: "Authentication failed", retryable: false },
  scope_forbidden: { message: "Required scope is not granted", retryable: false },
  invalid_request: { message: "Invalid request", retryable: false },
  not_found: { message: "Resource not found", retryable: false },
  stale_revision: { message: "Resource changed; refresh and try again", retryable: false },
  claim_conflict: { message: "Resource is already claimed", retryable: true },
  idempotency_conflict: {
    message: "Idempotency key conflicts with a previous request",
    retryable: false,
  },
  service_unavailable: { message: "Service temporarily unavailable", retryable: true },
  internal_error: { message: "Internal server error", retryable: false },
} as const satisfies Record<LocalToolErrorCode, { message: string; retryable: boolean }>;

const claimSummarySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unclaimed"), expires_at: z.null() }).strict(),
  z.object({ status: z.literal("claimed"), expires_at: z.iso.datetime({ offset: true }) }).strict(),
]);

const queueItemSchema = z.object({
  item_id: identifierSchema,
  campaign_id: identifierSchema,
  campaign_name: labelSchema,
  lead_id: identifierSchema,
  target_name: labelSchema,
  target_url: urlSchema.nullable(),
  discovery_source: labelSchema,
  recommending_person: labelSchema.nullable(),
  introduction_available: z.boolean().nullable(),
  relationship_warmth: z.number().int().min(0).max(3),
  musical_fit: valueSchema.nullable(),
  exact_edit: labelSchema.nullable(),
  editorial_fit: z.number().int().min(0).max(3),
  useful_reach: z.number().int().min(0).max(2),
  direct_free_access: z.number().int().min(0).max(2),
  missing_enrichment_fields: z.array(enrichmentProposalFieldSchema).max(4),
  lead_revision: z.string().regex(/^[a-f0-9]{64}$/),
  pipeline_stage: identifierSchema,
  claim: claimSummarySchema,
}).strict();

const evidenceSchema = z.object({
  title: z.string().min(1).max(300),
  url: httpsUrlSchema,
  retrieved_at: z.iso.datetime({ offset: true }),
  citation_text: z.string().min(1).max(1_000),
}).strict();

const suggestionSchema = z.object({
  id: identifierSchema,
  suggestion_type: enrichmentProposalFieldSchema,
  value: valueSchema,
  rationale: valueSchema.nullable(),
  evidence: z.array(evidenceSchema).max(MAX_EVIDENCE_PER_SUGGESTION),
  status: z.enum(["pending", "accepted"]),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
}).strict();

const canonicalLeadSchema = z.object({
  id: identifierSchema,
  campaign_id: identifierSchema,
  exact_edit_track_id: identifierSchema.nullable(),
  target_name: labelSchema,
  target_type: identifierSchema,
  target_url: urlSchema.nullable(),
  contact_route: labelSchema.nullable(),
  contact_route_verified_at: z.iso.datetime({ offset: true }).nullable(),
  discovery_source: labelSchema,
  recommending_person: labelSchema.nullable(),
  introduction_available: z.boolean().nullable(),
  musical_fit: valueSchema.nullable(),
  relationship_warmth: z.number().int().min(0).max(3),
  editorial_fit: z.number().int().min(0).max(3),
  useful_reach: z.number().int().min(0).max(2),
  direct_free_access: z.number().int().min(0).max(2),
  pipeline_stage: identifierSchema,
  pitch_angle: valueSchema.nullable(),
  last_contacted_at: z.iso.datetime({ offset: true }).nullable(),
  follow_up_at: z.iso.datetime({ offset: true }).nullable(),
  outcome: valueSchema.nullable(),
  evidence_url: httpsUrlSchema.nullable(),
  published_at: z.iso.datetime({ offset: true }).nullable(),
  updated_at: z.iso.datetime({ offset: true }).nullable(),
}).strict();

const itemSchema = queueItemSchema.extend({
  campaign: z.object({
    goal: contextSchema.nullable(),
    artist_name: labelSchema.nullable(),
    release_title: labelSchema.nullable(),
    track_titles: z.array(labelSchema).max(MAX_RELEASE_TRACKS),
  }).strict(),
  lead: z.object({
    target_type: identifierSchema,
    contact_route: labelSchema.nullable(),
    contact_route_verified_at: z.iso.datetime({ offset: true }).nullable(),
    pitch_angle: valueSchema.nullable(),
    last_contacted_at: z.iso.datetime({ offset: true }).nullable(),
    follow_up_at: z.iso.datetime({ offset: true }).nullable(),
    outcome: valueSchema.nullable(),
    evidence_url: httpsUrlSchema.nullable(),
    published_at: z.iso.datetime({ offset: true }).nullable(),
  }).strict(),
  canonical_lead: canonicalLeadSchema,
  prompt: z.object({
    id: identifierSchema,
    version: z.number().int().nonnegative(),
    text: contextSchema,
  }).strict().nullable(),
  accepted_research: z.array(suggestionSchema).max(MAX_ITEM_SUGGESTIONS_PER_STATE),
  pending_suggestions: z.array(suggestionSchema).max(MAX_ITEM_SUGGESTIONS_PER_STATE),
}).strict();

const queueDataSchema = z.object({ items: z.array(queueItemSchema).max(MAX_QUEUE_ITEMS) }).strict();
const claimDataSchema = z.object({
  id: identifierSchema,
  lead_id: identifierSchema,
  claimed_at: z.iso.datetime({ offset: true }),
  renewed_at: z.iso.datetime({ offset: true }).nullable(),
  expires_at: z.iso.datetime({ offset: true }),
}).strict();
const proposalDataSchema = z.object({
  run_id: identifierSchema,
  suggestions: z.array(z.object({
    id: identifierSchema,
    suggestion_type: enrichmentProposalFieldSchema,
  }).strict()).min(1).max(8),
}).strict();
const releaseDataSchema = z.object({ released: z.boolean() }).strict();

const errorPayloadSchemas = (Object.entries(errorDefinitions) as Array<[
  LocalToolErrorCode,
  (typeof errorDefinitions)[LocalToolErrorCode],
]>).map(([code, definition]) => {
  const base = {
    code: z.literal(code),
    message: z.literal(definition.message),
    retryable: z.literal(definition.retryable),
  };
  return code === "claim_conflict"
    ? z.object({
        ...base,
        details: claimConflictDetailsSchema.optional(),
      }).strict()
    : z.object(base).strict();
});

const errorEnvelopeSchema = z.object({
  version: z.literal(LOCAL_TOOL_API_VERSION),
  request_id: requestIdSchema,
  error: z.union(errorPayloadSchemas as [
    (typeof errorPayloadSchemas)[number],
    (typeof errorPayloadSchemas)[number],
    ...(typeof errorPayloadSchemas)[number][],
  ]),
}).strict();

export type CampaignEnrichmentQueueData = z.infer<typeof queueDataSchema>;
export type CampaignEnrichmentItemData = z.infer<typeof itemSchema>;
export type CampaignEnrichmentClaimData = z.infer<typeof claimDataSchema>;
export type CampaignEnrichmentProposalData = z.infer<typeof proposalDataSchema>;
export type CampaignEnrichmentReleaseData = z.infer<typeof releaseDataSchema>;

export class LocalToolClientError extends Error {
  readonly code: LocalToolErrorCode;
  readonly retryable: boolean;
  readonly requestId: string | undefined;
  readonly details: { expires_at: string } | undefined;

  constructor(code: LocalToolErrorCode, requestId?: string, details?: { expires_at: string }) {
    const definition = errorDefinitions[code];
    super(definition.message);
    this.name = "LocalToolClientError";
    this.code = code;
    this.retryable = definition.retryable;
    this.requestId = requestId;
    this.details = details;
  }
}

export interface CampaignEnrichmentClientOptions {
  baseUrl: string;
  credentials: CredentialStore;
  fetch?: typeof fetch;
}

export class CampaignEnrichmentClient {
  readonly baseUrl: string;
  private readonly credentials: CredentialStore;
  private readonly fetch: typeof fetch;

  constructor(options: CampaignEnrichmentClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.credentials = options.credentials;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async getHealth(): Promise<OperatorHealth> {
    try {
      const response = await this.fetch(`${this.baseUrl}/api/health`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return operatorHealthSchema.parse(await readBoundedJson(response));
    } catch {
      throw new LocalToolClientError("service_unavailable");
    }
  }

  async getJobsHealth(): Promise<LocalToolSuccessEnvelope<OperatorJobsHealth>> {
    return await this.request(
      `${OPERATOR_API_PATH}/jobs/health`,
      { method: "GET" },
      operatorJobsHealthSchema,
    );
  }

  async getOperationsBrief(
    input: OperatorOperationsBriefInput,
  ): Promise<LocalToolSuccessEnvelope<OperatorOperationsBrief>> {
    const parsed = parseInput(operatorOperationsBriefInputSchema, input);
    const query = new URLSearchParams({
      resource_type: parsed.resource_type,
      resource_id: parsed.resource_id,
    });
    return await this.request(
      `${OPERATOR_API_PATH}/operations-brief?${query.toString()}`,
      { method: "GET" },
      operatorOperationsBriefSchema,
    );
  }

  async listQueue(
    input: Partial<CampaignEnrichmentQueueQuery> = {},
  ): Promise<LocalToolSuccessEnvelope<CampaignEnrichmentQueueData>> {
    const parsed = parseInput(campaignEnrichmentQueueQuerySchema, input);
    const query = new URLSearchParams();
    if (Object.hasOwn(input, "campaign_id") && parsed.campaign_id !== undefined) {
      query.set("campaign_id", parsed.campaign_id);
    }
    if (Object.hasOwn(input, "state")) query.set("state", parsed.state);
    if (Object.hasOwn(input, "limit")) query.set("limit", String(parsed.limit));
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return await this.request(`${API_PATH}/queue${suffix}`, { method: "GET" }, queueDataSchema);
  }

  async getItem(itemId: string): Promise<LocalToolSuccessEnvelope<CampaignEnrichmentItemData>> {
    return await this.request(
      `${API_PATH}/items/${encodePathId(itemId)}`,
      { method: "GET" },
      itemSchema,
    );
  }

  async claimItem(
    itemId: string,
    input: z.input<typeof campaignEnrichmentClaimRequestSchema>,
  ): Promise<LocalToolSuccessEnvelope<CampaignEnrichmentClaimData>> {
    const parsed = parseInput(campaignEnrichmentClaimRequestSchema, input);
    return await this.request(
      `${API_PATH}/items/${encodePathId(itemId)}/claim`,
      { method: "POST", body: JSON.stringify(parsed) },
      claimDataSchema,
    );
  }

  async submitProposal(
    itemId: string,
    input: CampaignEnrichmentProposalSubmission,
  ): Promise<LocalToolSuccessEnvelope<CampaignEnrichmentProposalData>> {
    const parsed = parseInput(campaignEnrichmentProposalSubmissionSchema, input);
    return await this.request(
      `${API_PATH}/items/${encodePathId(itemId)}/proposals`,
      { method: "POST", body: JSON.stringify(parsed) },
      proposalDataSchema,
    );
  }

  async releaseItem(
    itemId: string,
    claimId: string,
  ): Promise<LocalToolSuccessEnvelope<CampaignEnrichmentReleaseData>> {
    const parsed = parseInput(campaignEnrichmentReleaseRequestSchema, { claim_id: claimId });
    return await this.request(
      `${API_PATH}/items/${encodePathId(itemId)}/claim/${encodeURIComponent(parsed.claim_id)}`,
      { method: "DELETE" },
      releaseDataSchema,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    dataSchema: z.ZodType<T>,
  ): Promise<LocalToolSuccessEnvelope<T>> {
    const token = await this.readCredential();
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new LocalToolClientError("service_unavailable");
    }

    let body: unknown;
    try {
      body = await readBoundedJson(response);
    } catch {
      throw new LocalToolClientError("service_unavailable");
    }
    if (containsCredential(body, token)) {
      throw new LocalToolClientError("service_unavailable");
    }

    const errorEnvelope = errorEnvelopeSchema.safeParse(body);
    if (errorEnvelope.success) {
      const { error, request_id: requestId } = errorEnvelope.data;
      const parsedDetails = error.code === "claim_conflict" && "details" in error
        ? claimConflictDetailsSchema.safeParse(error.details)
        : undefined;
      const details = parsedDetails?.success ? parsedDetails.data : undefined;
      throw new LocalToolClientError(
        error.code,
        requestId,
        details,
      );
    }
    if (!response.ok) throw new LocalToolClientError("service_unavailable", safeRequestId(body));

    const envelopeSchema = z.object({
      version: z.literal(LOCAL_TOOL_API_VERSION),
      request_id: requestIdSchema,
      data: dataSchema,
    }).strict();
    const envelope = envelopeSchema.safeParse(body);
    if (!envelope.success) {
      throw new LocalToolClientError("service_unavailable", safeRequestId(body));
    }
    return envelope.data as LocalToolSuccessEnvelope<T>;
  }

  private async readCredential(): Promise<string> {
    let token: string;
    try {
      token = (await this.credentials.read(this.baseUrl)).trim();
    } catch (error) {
      const code = credentialErrorCode(error) === "credential_not_found"
        ? "authentication_failed"
        : "service_unavailable";
      throw new LocalToolClientError(code);
    }
    if (token.length === 0 || token.length > 4_096 || /[\r\n\0]/.test(token)) {
      throw new LocalToolClientError("authentication_failed");
    }
    return token;
  }
}

export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LocalToolClientError("invalid_request");
  }
  const isHttps = url.protocol === "https:";
  const isLoopbackDevelopment = url.protocol === "http:" && url.hostname === "127.0.0.1";
  if (
    (!isHttps && !isLoopbackDevelopment)
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new LocalToolClientError("invalid_request");
  }
  return url.origin;
}

function encodePathId(value: string): string {
  return encodeURIComponent(parseInput(pathIdSchema, value));
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new LocalToolClientError("invalid_request");
  return result.data;
}

function credentialErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function safeRequestId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("request_id" in value)) return undefined;
  const parsed = requestIdSchema.safeParse(value.request_id);
  return parsed.success ? parsed.data : undefined;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BODY_BYTES) {
      throw new Error("Response body exceeds the configured limit");
    }
  }

  if (response.body === null) throw new Error("Response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BODY_BYTES) {
        await reader.cancel();
        throw new Error("Response body exceeds the configured limit");
      }
      chunks.push(value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The response is already unusable; preserve the original failure.
    }
    throw error;
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

function containsCredential(value: unknown, credential: string): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (current.includes(credential)) return true;
      continue;
    }
    if (Array.isArray(current)) {
      for (const entry of current) pending.push(entry);
      continue;
    }
    if (current !== null && typeof current === "object") {
      for (const entry of Object.values(current)) pending.push(entry);
    }
  }
  return false;
}
