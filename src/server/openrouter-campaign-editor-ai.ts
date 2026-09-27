import OpenAI, { APIConnectionTimeoutError } from "openai";
import { z } from "zod";
import {
  campaignEditorAiProviderResultSchema,
  campaignEditorOperationSchema,
  campaignEditorScopeSchema,
  campaignEditorSurfaceSchema,
} from "./campaign-editor-ai-core";
import type {
  CampaignEditorAiProviderInput,
  CampaignEditorAiProvider,
} from "./campaign-editor-ai-provider";
import { deriveCampaignDocument, parseCampaignDocument, type CampaignDocument } from "../lib/campaign-rich-text";
import {
  disabledCampaignEditorAiProvider,
} from "./campaign-editor-ai-provider";
import type { CampaignEditorSurface } from "./campaign-editor-ai-provider";
import {
  getOpenRouterResponseText,
  openRouterProviderPreferences,
  type OpenRouterProviderOptions,
  type ResponseData,
  type ResponsesClient,
} from "./openrouter-campaign-communicator";

export type CampaignEditorAiFailureCode =
  | "disabled"
  | "refused"
  | "timeout"
  | "network"
  | "provider"
  | "malformed_output"
  | "invalid_proposal"
  | "unknown_citation";

/** Safe, categorized provider failure. Raw provider responses are never retained. */
export class CampaignEditorAiError extends Error {
  readonly code: CampaignEditorAiFailureCode;

  constructor(code: CampaignEditorAiFailureCode, message: string) {
    super(message);
    this.name = "CampaignEditorAiError";
    this.code = code;
  }
}

export type CampaignEditorProviderOptions = OpenRouterProviderOptions & {
  /** Maximum time allowed for one provider request. Defaults to 15 seconds. */
  deadlineMs?: number;
  /** Backwards-compatible alias for callers that name the deadline a timeout. */
  timeoutMs?: number;
};

const editorProposalSchema = z.object({
  replacement_document: z.unknown(),
  rationale: z.string().trim().min(1).max(2_000),
  citation_ids: z.array(z.string().trim().min(1)).max(32),
}).strict();

/**
 * OpenRouter's Responses JSON schema. The document is validated again with the
 * server-owned CampaignDocument parser after decoding, so this transport schema
 * intentionally constrains only the top-level result shape.
 */
export const campaignEditorProposalOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["replacement_document", "rationale", "citation_ids"],
  properties: {
    replacement_document: { $ref: "#/$defs/document" },
    rationale: { type: "string", minLength: 1, maxLength: 2_000 },
    citation_ids: {
      type: "array",
      maxItems: 32,
      items: { type: "string", minLength: 1 },
    },
  },
  $defs: {
    document: {
      type: "object",
      additionalProperties: false,
      required: ["type", "content"],
      properties: { type: { type: "string", enum: ["doc"] }, content: { type: "array", minItems: 1, items: { $ref: "#/$defs/block" } } },
    },
    block: { anyOf: [{ $ref: "#/$defs/paragraph" }, { $ref: "#/$defs/heading" }, { $ref: "#/$defs/blockquote" }, { $ref: "#/$defs/bulletList" }, { $ref: "#/$defs/orderedList" }, { $ref: "#/$defs/orderedListWithAttrs" }] },
    paragraph: {
      type: "object", additionalProperties: false, required: ["type", "content"],
      properties: { type: { type: "string", enum: ["paragraph"] }, content: { type: "array", items: { $ref: "#/$defs/inline" } } },
    },
    heading: {
      type: "object", additionalProperties: false, required: ["type", "attrs", "content"],
      properties: { type: { type: "string", enum: ["heading"] }, attrs: { type: "object", additionalProperties: false, required: ["level"], properties: { level: { type: "integer", enum: [2, 3] } } }, content: { type: "array", items: { $ref: "#/$defs/inline" } } },
    },
    blockquote: {
      type: "object", additionalProperties: false, required: ["type", "content"],
      properties: { type: { type: "string", enum: ["blockquote"] }, content: { type: "array", minItems: 1, items: { $ref: "#/$defs/block" } } },
    },
    bulletList: {
      type: "object", additionalProperties: false, required: ["type", "content"],
      properties: { type: { type: "string", enum: ["bulletList"] }, content: { type: "array", minItems: 1, items: { $ref: "#/$defs/listItem" } } },
    },
    orderedList: {
      type: "object", additionalProperties: false, required: ["type", "content"],
      properties: { type: { type: "string", enum: ["orderedList"] }, content: { type: "array", minItems: 1, items: { $ref: "#/$defs/listItem" } } },
    },
    orderedListWithAttrs: {
      type: "object", additionalProperties: false, required: ["type", "attrs", "content"],
      properties: { type: { type: "string", enum: ["orderedList"] }, attrs: { type: "object", additionalProperties: false, required: ["start"], properties: { start: { type: "integer", minimum: 1 } } }, content: { type: "array", minItems: 1, items: { $ref: "#/$defs/listItem" } } },
    },
    listItem: {
      type: "object", additionalProperties: false, required: ["type", "content"],
      properties: { type: { type: "string", enum: ["listItem"] }, content: { type: "array", minItems: 1, items: { $ref: "#/$defs/block" } } },
    },
    inline: { anyOf: [{ $ref: "#/$defs/text" }, { $ref: "#/$defs/textWithMarks" }, { $ref: "#/$defs/hardBreak" }] },
    text: { type: "object", additionalProperties: false, required: ["type", "text"], properties: { type: { type: "string", enum: ["text"] }, text: { type: "string" } } },
    textWithMarks: { type: "object", additionalProperties: false, required: ["type", "text", "marks"], properties: { type: { type: "string", enum: ["text"] }, text: { type: "string" }, marks: { type: "array", minItems: 1, items: { $ref: "#/$defs/mark" } } } },
    hardBreak: { type: "object", additionalProperties: false, required: ["type"], properties: { type: { type: "string", enum: ["hardBreak"] } } },
    mark: { anyOf: [{ $ref: "#/$defs/simpleMark" }, { $ref: "#/$defs/linkMark" }] },
    simpleMark: { type: "object", additionalProperties: false, required: ["type"], properties: { type: { type: "string", enum: ["bold", "italic"] } } },
    linkMark: { type: "object", additionalProperties: false, required: ["type", "attrs"], properties: { type: { type: "string", enum: ["link"] }, attrs: { type: "object", additionalProperties: false, required: ["href"], properties: { href: { type: "string" } } } } },
  },
} as const;

export const CAMPAIGN_EDITOR_PROPOSAL_INSTRUCTIONS = [
  "Transform only the supplied campaign copy and context.",
  "Use no tools and perform no research.",
  "Do not invent facts, names, dates, contact details, or claims.",
  "Do not approve, publish, send, mutate pipeline stages, or decide recipients.",
  "Return only the requested replacement_document, short rationale, and citation_ids.",
].join(" ");

export class OpenRouterCampaignEditorAiProvider implements CampaignEditorAiProvider {
  readonly id = "openrouter" as const;
  readonly model: string;
  readonly deadlineMs: number;
  private readonly client: ResponsesClient;

  constructor({ apiKey, model, client, deadlineMs, timeoutMs }: CampaignEditorProviderOptions) {
    this.model = requiredValue(model, "OPENROUTER_COMMUNICATOR_MODEL");
    requiredValue(apiKey, "OPENROUTER_API_KEY");
    this.deadlineMs = boundedDeadline(deadlineMs ?? timeoutMs ?? 15_000);
    this.client = client ?? new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: { "X-OpenRouter-Title": "Label Suite" },
    });
  }

  async transform(input: CampaignEditorAiProviderInput): Promise<{
    replacement_document: CampaignDocument;
    rationale: string;
    citation_ids: string[];
  }> {
    let serializedInput: string;
    try {
      serializedInput = JSON.stringify(serializeProviderInput(input));
    } catch {
      throw new CampaignEditorAiError("invalid_proposal", "Campaign editor AI input document is invalid");
    }

    const controller = new AbortController();
    const deadlineError = new CampaignEditorAiError("timeout", "Campaign editor AI request timed out");
    let rejectDeadline: (reason?: unknown) => void;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const timer = setTimeout(() => {
      // Reject before aborting: a cooperative client may synchronously reject
      // from its abort listener, but the adapter deadline remains authoritative.
      rejectDeadline(deadlineError);
      controller.abort();
    }, this.deadlineMs);

    let response: unknown;
    try {
      const request = this.client.responses.create({
        model: this.model,
        store: false,
        provider: openRouterProviderPreferences,
        instructions: CAMPAIGN_EDITOR_PROPOSAL_INSTRUCTIONS,
        input: serializedInput,
        text: {
          format: {
            type: "json_schema",
            name: "campaign_editor_proposal",
            strict: true,
            schema: campaignEditorProposalOutputSchema,
          },
        },
      } as never, { signal: controller.signal, maxRetries: 0 } as never);
      // Race rather than relying on the client honoring AbortSignal. Promise.race
      // observes later client rejection, preventing an unhandled rejection.
      response = await Promise.race([request, deadline]);
    } catch (error) {
      if (error === deadlineError) throw deadlineError;
      throw classifyTransportError(error);
    } finally {
      clearTimeout(timer);
    }

    let responseText: string;
    try {
      responseText = getOpenRouterResponseText(response as ResponseData);
    } catch (error) {
      if (error instanceof CampaignEditorAiError) throw error;
      const message = error instanceof Error ? error.message : "";
      if (message.includes("refused")) throw new CampaignEditorAiError("refused", "Campaign editor AI request was refused");
      const responseStatus = response && typeof response === "object" && "status" in response
        ? (response as { status?: unknown }).status
        : undefined;
      if (typeof responseStatus === "string" && responseStatus !== "completed") {
        throw new CampaignEditorAiError("provider", "Campaign editor AI provider request did not complete");
      }
      throw new CampaignEditorAiError("malformed_output", "Campaign editor AI response did not contain valid output");
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(responseText);
    } catch {
      throw new CampaignEditorAiError("malformed_output", "Campaign editor AI response was not valid JSON");
    }

    let parsed: z.infer<typeof campaignEditorAiProviderResultSchema>;
    try {
      parsed = campaignEditorAiProviderResultSchema.parse(editorProposalSchema.parse(decoded));
    } catch {
      throw new CampaignEditorAiError("invalid_proposal", "Campaign editor AI response failed proposal validation");
    }

    let replacementDocument: CampaignDocument;
    try {
      replacementDocument = parseCampaignDocument(parsed.replacement_document, characterLimitForSurface(input.surface));
    } catch {
      throw new CampaignEditorAiError("invalid_proposal", "Campaign editor AI replacement document is invalid");
    }

    const allowedCitationIds = new Set(input.context.accepted_research.flatMap((item) => item.citation_ids
      .filter((id): id is string => typeof id === "string")
      .map((id) => id.trim())
      .filter(Boolean)));
    const citationIds = [...new Set(parsed.citation_ids)];
    if (citationIds.some((id) => !allowedCitationIds.has(id))) {
      throw new CampaignEditorAiError("unknown_citation", "Campaign editor AI returned an unknown citation ID");
    }

    return {
      replacement_document: replacementDocument,
      rationale: parsed.rationale,
      citation_ids: citationIds,
    };
  }
}

export const OpenRouterCampaignEditorProvider = OpenRouterCampaignEditorAiProvider;

/** Return a safe manual-editing state when either existing OpenRouter setting is absent. */
export function getCampaignEditorAiProvider(
  environment: Record<string, string | undefined> = process.env,
): CampaignEditorAiProvider {
  const apiKey = environment.OPENROUTER_API_KEY?.trim();
  const model = environment.OPENROUTER_COMMUNICATOR_MODEL?.trim();
  if (!apiKey || !model) return disabledCampaignEditorAiProvider;
  return new OpenRouterCampaignEditorAiProvider({ apiKey, model });
}

export const getOpenRouterCampaignEditorAiProvider = getCampaignEditorAiProvider;
export const getCampaignEditorProvider = getCampaignEditorAiProvider;

function serializeProviderInput(input: CampaignEditorAiProviderInput) {
  const surface = campaignEditorSurfaceSchema.parse(input.surface);
  const operation = campaignEditorOperationSchema.parse(input.operation);
  const scope = campaignEditorScopeSchema.parse(input.scope);
  const characterLimit = characterLimitForSurface(surface);
  const currentDocument = deriveCampaignDocument(input.current_document, characterLimit).document;
  const selectedDocument = input.selected_document === null
    ? null
    : deriveCampaignDocument(input.selected_document, characterLimit).document;

  return {
    surface,
    operation,
    scope,
    current_document: currentDocument,
    selected_document: selectedDocument,
    instruction: input.instruction === null ? null : strictString(input.instruction, "instruction"),
    context: {
      campaign: {
        id: strictString(input.context.campaign.id, "campaign id"),
        name: strictString(input.context.campaign.name, "campaign name"),
        goal: strictString(input.context.campaign.goal, "campaign goal"),
        notes: strictString(input.context.campaign.notes, "campaign notes"),
      },
      release: input.context.release ? {
        id: strictString(input.context.release.id, "release id"),
        title: strictString(input.context.release.title, "release title"),
        artist_name: input.context.release.artist_name === null ? null : strictString(input.context.release.artist_name, "release artist name"),
        track_titles: input.context.release.track_titles.map((title) => strictString(title, "track title")),
      } : null,
      lead: input.context.lead ? {
        id: strictString(input.context.lead.id, "lead id"),
        target_name: strictString(input.context.lead.target_name, "lead target name"),
        musical_fit: input.context.lead.musical_fit === null ? null : strictString(input.context.lead.musical_fit, "lead musical fit"),
        pitch_angle: input.context.lead.pitch_angle === null ? null : strictString(input.context.lead.pitch_angle, "lead pitch angle"),
      } : null,
      prompt: input.context.prompt ? {
        id: strictString(input.context.prompt.id, "prompt id"),
        version: strictVersion(input.context.prompt.version),
        text: strictString(input.context.prompt.text, "prompt text"),
      } : null,
      accepted_research: input.context.accepted_research.map((item) => ({
        id: strictString(item.id, "research id"),
        value: strictString(item.value, "research value"),
        rationale: strictString(item.rationale, "research rationale"),
        citation_ids: item.citation_ids
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter(Boolean),
      })),
    },
  };
}

function characterLimitForSurface(surface: CampaignEditorSurface): 10_000 | 20_000 {
  return surface === "focused_outreach_body" || surface === "radio_update_body" ? 10_000 : 20_000;
}

function classifyTransportError(error: unknown): CampaignEditorAiError {
  const candidate = error as { name?: unknown; code?: unknown; status?: unknown; message?: unknown } | null;
  const name = typeof candidate?.name === "string" ? candidate.name : "";
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = typeof candidate?.message === "string" ? candidate.message.toLowerCase() : "";
  if (typeof candidate?.status === "number" && Number.isFinite(candidate.status)) {
    return new CampaignEditorAiError("provider", "Campaign editor AI provider request failed");
  }
  if (error instanceof APIConnectionTimeoutError || name === "APIConnectionTimeoutError" || code === "APIConnectionTimeoutError" || code === "ETIMEDOUT") {
    return new CampaignEditorAiError("timeout", "Campaign editor AI request timed out");
  }
  if (name.startsWith("API") || code.startsWith("API") || code === "provider" || message.includes("provider")) {
    return new CampaignEditorAiError("provider", "Campaign editor AI provider request failed");
  }
  return new CampaignEditorAiError("network", "Campaign editor AI network request failed");
}

function strictString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`Campaign editor ${label} is invalid`);
  return value;
}

function strictVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError("Campaign editor prompt version is invalid");
  return value as number;
}

function boundedDeadline(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 120_000) throw new RangeError("Campaign editor AI deadline is invalid");
  return Math.floor(value);
}

function requiredValue(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is not configured`);
  return value;
}
