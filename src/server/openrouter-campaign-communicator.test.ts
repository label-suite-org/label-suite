import { afterEach, describe, expect, test, vi } from "vitest";
import {
  OpenRouterCampaignCommunicatorProvider,
  getCampaignCommunicatorProvider,
  type ResponsesClient,
} from "./openrouter-campaign-communicator";
import type { GenerateDraftInput } from "./campaign-communicator-provider";

const RESEARCH_INPUT = {
  campaign_name: "Fountain Edits",
  artist_name: "Fountain Edits",
  release_title: "Make It Known",
  target_name: "Example Radio",
  target_url: "https://example.org/show",
};

const DRAFT_INPUT: GenerateDraftInput = {
  campaign_name: "Fountain Edits",
  artist_name: "Fountain Edits",
  release_title: "Make It Known",
  recipient_name: "Ari",
  target_name: "Example Radio",
  channel: "email" as const,
  instruction: null,
  suggestions: [{
    status: "accepted" as const,
    field: "musical_fit" as const,
    value: "The show regularly features leftfield electronic music.",
    rationale: "This makes the release a relevant pitch.",
    evidence: [{
      title: "Example Radio programming",
      url: "https://example.org/show",
      retrieved_at: "2026-08-05T10:00:00.000Z",
      citation_text: "The show regularly features leftfield electronic music.",
    }],
  }],
};

function clientWith(response: unknown): { client: ResponsesClient; requests: unknown[] } {
  const requests: unknown[] = [];
  return {
    client: {
      responses: {
        create: async (request: unknown) => {
          requests.push(request);
          return response;
        },
      },
    } as unknown as ResponsesClient,
    requests,
  };
}

describe("OpenRouter campaign communicator provider", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("selects OpenRouter using the configured API key and model", () => {
    const provider = getCampaignCommunicatorProvider({
      OPENROUTER_API_KEY: "test-key",
      OPENROUTER_COMMUNICATOR_MODEL: "google/gemini-3.6-flash",
    });

    expect(provider.id).toBe("openrouter");
    expect(provider.model).toBe("google/gemini-3.6-flash");
  });

  test("fails closed when the OpenRouter API key is absent", () => {
    expect(() => getCampaignCommunicatorProvider({})).toThrow("OPENROUTER_API_KEY is not configured");
  });

  test("uses the approved model and fails closed when it is absent", () => {
    expect(() => getCampaignCommunicatorProvider({ OPENROUTER_API_KEY: "test-key" })).toThrow("OPENROUTER_COMMUNICATOR_MODEL is not configured");
  });

  test("researches through web search only and returns URL-cited suggestions", async () => {
    const citedValue = "The show regularly features leftfield electronic music.";
    const responseText = JSON.stringify({
      suggestions: [{
        field: "musical_fit",
        value: citedValue,
        rationale: "This makes the release a relevant pitch.",
      }],
    });
    const { client, requests } = clientWith({
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: responseText,
          annotations: [{
            type: "url_citation",
            url: "https://example.org/show",
            start_index: responseText.indexOf(citedValue),
            end_index: responseText.indexOf(citedValue) + citedValue.length,
          }],
        }],
      }],
    });
    const provider = new OpenRouterCampaignCommunicatorProvider({
      apiKey: "test-key",
      model: "approved-model",
      client,
      now: () => new Date("2026-08-05T10:00:00.000Z"),
    });

    const parsed = await provider.researchLead(RESEARCH_INPUT);

    expect(requests).toHaveLength(1);
    const researchRequest = requests[0] as { store: boolean; tools: unknown; provider: unknown };
    expect(researchRequest.store).toBe(false);
    expect(researchRequest.provider).toEqual({
      require_parameters: true,
      data_collection: "deny",
      zdr: true,
    });
    expect(researchRequest.tools).toEqual([{
      type: "openrouter:web_search",
      parameters: {
        engine: "exa",
        max_results: 5,
        max_total_results: 5,
        max_uses: 1,
        max_characters: 3000,
      },
    }]);
    expect(parsed.suggestions[0].evidence[0].url).toBe("https://example.org/show");
    expect(parsed.suggestions[0].evidence[0].title).toBe("example.org");
  });

  test("excludes research suggestions when the response has no URL citation", async () => {
    const { client } = clientWith({
      output_text: JSON.stringify({
        suggestions: [{
          field: "musical_fit",
          value: "An unsupported claim.",
          rationale: "This must not become draft context.",
        }],
      }),
    });
    const provider = new OpenRouterCampaignCommunicatorProvider({ apiKey: "test-key", model: "approved-model", client });

    await expect(provider.researchLead(RESEARCH_INPUT)).resolves.toEqual({ suggestions: [] });
  });

  test("excludes an individual research suggestion without a matching URL citation", async () => {
    const citedValue = "The show regularly features leftfield electronic music.";
    const responseText = JSON.stringify({
      suggestions: [
        { field: "musical_fit", value: citedValue, rationale: "Supported by its programme." },
        { field: "pitch_angle", value: "An unsupported pitch angle.", rationale: "This must be excluded." },
      ],
    });
    const { client } = clientWith({
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: responseText,
          annotations: [{
            type: "url_citation",
            url: "https://example.org/show",
            title: "Example Radio programming",
            start_index: responseText.indexOf(citedValue),
            end_index: responseText.indexOf(citedValue) + citedValue.length,
          }],
        }],
      }],
    });
    const provider = new OpenRouterCampaignCommunicatorProvider({ apiKey: "test-key", model: "approved-model", client });

    await expect(provider.researchLead(RESEARCH_INPUT)).resolves.toMatchObject({
      suggestions: [{ value: citedValue }],
    });
  });

  test("excludes a suggestion when a URL citation overlaps its rationale but not its value", async () => {
    const rationale = "This rationale is cited, but the suggested value is not.";
    const responseText = JSON.stringify({
      suggestions: [{
        field: "musical_fit",
        value: "An uncited suggested value.",
        rationale,
      }],
    });
    const rationaleStart = responseText.indexOf(rationale);
    const { client } = clientWith({
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: responseText,
          annotations: [{
            type: "url_citation",
            url: "https://example.org/rationale",
            title: "Rationale-only source",
            start_index: rationaleStart,
            end_index: rationaleStart + rationale.length,
          }],
        }],
      }],
    });
    const provider = new OpenRouterCampaignCommunicatorProvider({ apiKey: "test-key", model: "approved-model", client });

    await expect(provider.researchLead(RESEARCH_INPUT)).resolves.toEqual({ suggestions: [] });
  });

  test("does not let duplicate suggestion values inherit another object's citation", async () => {
    const duplicateValue = "The show regularly features leftfield electronic music.";
    const responseText = JSON.stringify({
      suggestions: [
        { field: "musical_fit", value: duplicateValue, rationale: "First suggestion." },
        { field: "pitch_angle", value: duplicateValue, rationale: "Second suggestion." },
      ],
    });
    const secondObjectStart = responseText.lastIndexOf('{"field"');
    const { client } = clientWith({
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: responseText,
          annotations: [{
            type: "url_citation",
            url: "https://example.org/second",
            title: "Second source",
            start_index: secondObjectStart,
            end_index: secondObjectStart + duplicateValue.length,
          }],
        }],
      }],
    });
    const provider = new OpenRouterCampaignCommunicatorProvider({ apiKey: "test-key", model: "approved-model", client });

    await expect(provider.researchLead(RESEARCH_INPUT)).resolves.toMatchObject({
      suggestions: [{ field: "pitch_angle", rationale: "Second suggestion." }],
    });
  });

  test("does not let a substring value inherit its containing suggestion's citation", async () => {
    const citedValue = "The show regularly features electronic music.";
    const substringValue = "electronic music";
    const responseText = JSON.stringify({
      suggestions: [
        { field: "musical_fit", value: citedValue, rationale: "Supported by its programme." },
        { field: "pitch_angle", value: substringValue, rationale: "Unsupported detail." },
      ],
    });
    const citedSubstringStart = responseText.indexOf(substringValue);
    const { client } = clientWith({
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: responseText,
          annotations: [{
            type: "url_citation",
            url: "https://example.org/programming",
            title: "Programming",
            start_index: citedSubstringStart,
            end_index: citedSubstringStart + substringValue.length,
          }],
        }],
      }],
    });
    const provider = new OpenRouterCampaignCommunicatorProvider({ apiKey: "test-key", model: "approved-model", client });

    await expect(provider.researchLead(RESEARCH_INPUT)).resolves.toMatchObject({
      suggestions: [{ field: "musical_fit", value: citedValue }],
    });
  });

  test("drafts without tools and does not persist the provider request", async () => {
    const { client, requests } = clientWith({
      output_text: JSON.stringify({
        subject: "Fountain Edits — Make It Known",
        body: "Hi Ari,\n\nI thought this could fit Example Radio.\n\nBest,\nFountain Edits",
      }),
    });
    const provider = new OpenRouterCampaignCommunicatorProvider({ apiKey: "test-key", model: "approved-model", client });

    await expect(provider.generateDraft(DRAFT_INPUT)).resolves.toEqual({
      subject: "Fountain Edits — Make It Known",
      body: "Hi Ari,\n\nI thought this could fit Example Radio.\n\nBest,\nFountain Edits",
    });

    const draftRequest = requests[0] as { store: boolean; tools?: unknown };
    expect(draftRequest.store).toBe(false);
    expect(draftRequest.tools).toBeUndefined();
  });

  test("refusal takes precedence over contradictory output text", async () => {
    const { client } = clientWith({
      status: "completed",
      output_text: JSON.stringify({ subject: null, body: "Should not be accepted" }),
      output: [{ type: "message", content: [{ type: "refusal", refusal: "Policy refusal" }] }],
    });
    const provider = new OpenRouterCampaignCommunicatorProvider({ apiKey: "test-key", model: "approved-model", client });
    await expect(provider.generateDraft(DRAFT_INPUT)).rejects.toThrow("refused");
  });

  test("ignores a malformed top-level refusal when valid output is present", async () => {
    const { client } = clientWith({
      status: "completed",
      refusal: { reason: "not a string" },
      output_text: JSON.stringify({ subject: null, body: "A valid draft." }),
    });
    const provider = new OpenRouterCampaignCommunicatorProvider({ apiKey: "test-key", model: "approved-model", client });

    await expect(provider.generateDraft(DRAFT_INPUT)).resolves.toEqual({ subject: null, body: "A valid draft." });
  });

  test("sends provider requests only to the OpenRouter Responses endpoint", async () => {
    let capturedRequest: Request | null = null;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequest = new Request(input, init);
      return new Response(JSON.stringify({
        status: "completed",
        output_text: JSON.stringify({ subject: null, body: "A cited draft." }),
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const provider = new OpenRouterCampaignCommunicatorProvider({
      apiKey: "openrouter-test-key",
      model: "google/gemini-3.6-flash",
    });

    await provider.generateDraft(DRAFT_INPUT);

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.url).toBe("https://openrouter.ai/api/v1/responses");
    expect(capturedRequest!.headers.get("authorization")).toBe("Bearer openrouter-test-key");
    expect(capturedRequest!.headers.get("x-openrouter-title")).toBe("Label Suite");
    const body = JSON.parse(await capturedRequest!.clone().text());
    expect(body.provider).toEqual({
      require_parameters: true,
      data_collection: "deny",
      zdr: true,
    });
  });

  test("serializes only accepted suggestions with usable citation evidence into a draft request", async () => {
    const { client, requests } = clientWith({
      output_text: JSON.stringify({ subject: null, body: "A cited draft." }),
    });
    const provider = new OpenRouterCampaignCommunicatorProvider({ apiKey: "test-key", model: "approved-model", client });
    const accepted = { ...DRAFT_INPUT.suggestions[0], status: "accepted" as const };
    const input = {
      ...DRAFT_INPUT,
      suggestions: [
        accepted,
        { ...accepted, status: "pending" as const, value: "Pending suggestion." },
        { ...accepted, status: "rejected" as const, value: "Rejected suggestion." },
        { ...accepted, value: "Uncited suggestion.", evidence: [] },
      ],
    };

    await provider.generateDraft(input as unknown as typeof DRAFT_INPUT);

    const draftRequest = requests[0] as { input: string };
    expect(JSON.parse(draftRequest.input).suggestions).toEqual([accepted]);
  });
});
