import OpenAI from "openai";
import { z } from "zod";
import { buildAcceptedDraftContext } from "./campaign-communicator-core";
import type {
  CampaignCommunicatorProvider,
  GenerateDraftInput,
  GeneratedDraftResult,
  ResearchLeadInput,
  ResearchLeadResult,
  ResearchSuggestion,
} from "./campaign-communicator-provider";

type URLCitationAnnotation = {
  type: "url_citation";
  url: string;
  title?: string;
  start_index: number;
  end_index: number;
};

export type ResponseContent = {
  type: string;
  text?: string;
  refusal?: string;
  annotations?: unknown[];
};

export type ResponseOutput = {
  type: string;
  content?: ResponseContent[];
};

export type ResponseData = {
  status?: string;
  refusal?: string;
  output_text?: string;
  output?: ResponseOutput[];
};

export type ResponsesClient = Pick<OpenAI, "responses">;

export type OpenRouterProviderOptions = {
  apiKey: string;
  model: string;
  client?: ResponsesClient;
  now?: () => Date;
};

const researchSuggestionSchema = z.object({
  field: z.enum(["musical_fit", "pitch_angle", "contact_route", "programming_focus"]),
  value: z.string().trim().min(1).max(1000),
  rationale: z.string().trim().min(1).max(1000),
}).strict();

const researchResultSchema = z.object({
  suggestions: z.array(researchSuggestionSchema).max(8),
}).strict();

const generatedDraftSchema = z.object({
  subject: z.string().trim().min(1).max(500).nullable(),
  body: z.string().trim().min(1).max(10_000),
}).strict();

const researchOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value", "rationale"],
        properties: {
          field: { type: "string", enum: ["musical_fit", "pitch_angle", "contact_route", "programming_focus"] },
          value: { type: "string" },
          rationale: { type: "string" },
        },
      },
    },
  },
} as const;

const draftOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: { type: ["string", "null"] },
    body: { type: "string" },
  },
} as const;

const openRouterWebSearchTool = {
  type: "openrouter:web_search",
  parameters: {
    engine: "exa",
    max_results: 5,
    max_total_results: 5,
    max_uses: 1,
    max_characters: 3000,
  },
} as const;

export const openRouterProviderPreferences = Object.freeze({
  require_parameters: true,
  data_collection: "deny",
  zdr: true,
} as const);

/** Shared privacy-preserving provider policy for tool-using and tool-free calls. */
export const OPENROUTER_PROVIDER_PREFERENCES = openRouterProviderPreferences;

export class OpenRouterCampaignCommunicatorProvider implements CampaignCommunicatorProvider {
  readonly id = "openrouter" as const;
  readonly model: string;
  private readonly client: ResponsesClient;
  private readonly now: () => Date;

  constructor({ apiKey, model, client, now = () => new Date() }: OpenRouterProviderOptions) {
    this.model = requiredValue(model, "OPENROUTER_COMMUNICATOR_MODEL");
    requiredValue(apiKey, "OPENROUTER_API_KEY");
    this.client = client ?? new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: { "X-OpenRouter-Title": "Label Suite" },
    });
    this.now = now;
  }

  async researchLead(input: ResearchLeadInput): Promise<ResearchLeadResult> {
    const response = await this.client.responses.create({
      model: this.model,
      store: false,
      provider: openRouterProviderPreferences,
      tools: [openRouterWebSearchTool],
      instructions: "Research one earned-media target. Use only the provided web search tool. Return concise, factual suggestions. Do not make decisions, modify data, approve copy, alter stages, or send messages.",
      input: JSON.stringify(input),
      text: {
        format: {
          type: "json_schema",
          name: "campaign_lead_research",
          strict: true,
          schema: researchOutputSchema,
        },
      },
    } as never);
    const parsed = researchResultSchema.parse(JSON.parse(getResponseText(response)));
    return {
      suggestions: parsed.suggestions.flatMap((suggestion, index) => {
        const evidence = citationEvidenceForSuggestion(response, index, suggestion, this.now());
        return evidence.length > 0 ? [{ ...suggestion, evidence }] : [];
      }),
    };
  }

  async generateDraft(input: GenerateDraftInput): Promise<GeneratedDraftResult> {
    const draftContext = buildAcceptedDraftContext(input);
    const response = await this.client.responses.create({
      model: this.model,
      store: false,
      provider: openRouterProviderPreferences,
      instructions: "Draft outreach copy from the supplied accepted, cited context only. Do not use tools. Do not make decisions, modify data, approve copy, alter stages, or send messages.",
      input: JSON.stringify(draftContext),
      text: {
        format: {
          type: "json_schema",
          name: "campaign_outreach_draft",
          strict: true,
          schema: draftOutputSchema,
        },
      },
    } as never);

    return generatedDraftSchema.parse(JSON.parse(getResponseText(response)));
  }
}

export function getCampaignCommunicatorProvider(environment: Record<string, string | undefined> = process.env): CampaignCommunicatorProvider {
  return new OpenRouterCampaignCommunicatorProvider({
    apiKey: requiredValue(environment.OPENROUTER_API_KEY, "OPENROUTER_API_KEY"),
    model: requiredValue(environment.OPENROUTER_COMMUNICATOR_MODEL, "OPENROUTER_COMMUNICATOR_MODEL"),
  });
}

function requiredValue(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`${name} is not configured`);
  return value;
}

export function getOpenRouterResponseText(response: ResponseData) {
  if ((typeof response.refusal === "string" && response.refusal.trim()) || response.status === "refused" || response.status === "refusal" || response.status === "rejected") {
    throw new Error("OpenRouter communicator response was refused");
  }
  const content = response.output?.flatMap((item) => item.type === "message" ? item.content ?? [] : []) ?? [];
  if (response.output?.some((item) => item.type === "refusal") || content.some((item) => item.type === "refusal")) {
    throw new Error("OpenRouter communicator response was refused");
  }
  if (response.status && response.status !== "completed") {
    throw new Error("OpenRouter communicator response was not completed");
  }
  if (response.output_text?.trim()) return response.output_text;
  const outputText = content.find(isOutputText)?.text;
  if (!outputText?.trim()) throw new Error("OpenRouter communicator response did not include output text");
  return outputText;
}

// Keep the internal name available to existing call sites in this module while
// exporting a provider-neutral response extractor for the editor adapter.
const getResponseText = getOpenRouterResponseText;

function citationEvidenceForSuggestion(
  response: ResponseData,
  suggestionIndex: number,
  suggestion: z.infer<typeof researchSuggestionSchema>,
  retrievedAt: Date,
): ResearchSuggestion["evidence"] {
  return outputTexts(response).flatMap((content) => {
    const suggestionRange = findSuggestionObjectRange(content.text, suggestionIndex);
    if (!suggestionRange) return [];
    const valueRange = findSuggestionValueRange(content.text, suggestionRange, suggestion.value);
    if (!valueRange) return [];

    return (content.annotations ?? [])
      .filter(isURLCitation)
      .filter((citation) => citation.start_index < valueRange.end && citation.end_index > valueRange.start)
      .map((citation) => ({
        title: citation.title?.trim() || new URL(citation.url).hostname,
        url: citation.url,
        retrieved_at: retrievedAt.toISOString(),
        citation_text: suggestion.value,
      }));
  });
}

function findSuggestionObjectRange(text: string, suggestionIndex: number) {
  const propertyIndex = text.indexOf('"suggestions"');
  if (propertyIndex < 0) return null;
  const arrayStart = text.indexOf("[", propertyIndex);
  if (arrayStart < 0) return null;

  let cursor = skipWhitespace(text, arrayStart + 1);
  for (let index = 0; index <= suggestionIndex; index += 1) {
    if (text[cursor] !== "{") return null;
    const start = cursor;
    const end = findJSONObjectEnd(text, start);
    if (end === null) return null;
    if (index === suggestionIndex) return { start, end };
    cursor = skipWhitespace(text, end);
    if (text[cursor] !== ",") return null;
    cursor = skipWhitespace(text, cursor + 1);
  }
  return null;
}

function findSuggestionValueRange(text: string, objectRange: { start: number; end: number }, value: string) {
  const keyStart = text.indexOf('"value"', objectRange.start);
  if (keyStart < objectRange.start || keyStart >= objectRange.end) return null;
  let cursor = skipWhitespace(text, keyStart + '"value"'.length);
  if (text[cursor] !== ":") return null;
  cursor = skipWhitespace(text, cursor + 1);
  const end = findJSONStringEnd(text, cursor);
  if (end === null || end > objectRange.end) return null;

  try {
    return JSON.parse(text.slice(cursor, end)) === value ? { start: cursor, end } : null;
  } catch {
    return null;
  }
}

function skipWhitespace(text: string, cursor: number) {
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

function findJSONObjectEnd(text: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let cursor = start; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return cursor + 1;
  }
  return null;
}

function findJSONStringEnd(text: string, start: number) {
  if (text[start] !== '"') return null;
  let escaped = false;
  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === '"') return cursor + 1;
  }
  return null;
}

function outputTexts(response: ResponseData) {
  return response.output
    ?.flatMap((item) => item.type === "message" ? item.content ?? [] : [])
    .filter(isOutputText)
    ?? [];
}

function isOutputText(content: ResponseContent): content is ResponseContent & { type: "output_text"; text: string } {
  return content.type === "output_text" && typeof content.text === "string";
}

function isURLCitation(annotation: unknown): annotation is URLCitationAnnotation {
  if (!annotation || typeof annotation !== "object") return false;
  const value = annotation as Partial<URLCitationAnnotation>;
  return value.type === "url_citation"
    && typeof value.url === "string"
    && isHttpUrl(value.url)
    && (value.title === undefined || typeof value.title === "string")
    && typeof value.start_index === "number"
    && typeof value.end_index === "number";
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
