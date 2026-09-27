import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CampaignEditorAiError,
  OpenRouterCampaignEditorAiProvider,
  getCampaignEditorAiProvider,
} from "./openrouter-campaign-editor-ai";
import type { CampaignEditorAiProviderInput } from "./campaign-editor-ai-provider";
import type { ResponsesClient } from "./openrouter-campaign-communicator";
import { openRouterProviderPreferences } from "./openrouter-campaign-communicator";

const DOCUMENT = {
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Current copy" }] }],
};

const INPUT: CampaignEditorAiProviderInput = {
  surface: "campaign_goal",
  operation: "improve",
  scope: "document",
  current_document: DOCUMENT,
  selected_document: null,
  instruction: "Make it clearer",
  context: {
    campaign: { id: "campaign-1", name: "Fountain Edits", goal: "Share the release", notes: "Internal notes" },
    release: { id: "release-1", title: "Make It Known", artist_name: "Fountain Edits", track_titles: ["First Light"] },
    lead: null,
    prompt: null,
    accepted_research: [{ id: "research-1", value: "Accepted fact", rationale: "Cited rationale", citation_ids: ["cite-1"] }],
  },
};

function clientWith(response: unknown): { client: ResponsesClient; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => response);
  return {
    create,
    client: { responses: { create } } as unknown as ResponsesClient,
  };
}

function completed(output: unknown) {
  return { status: "completed", output_text: JSON.stringify(output) };
}

describe("OpenRouter campaign editor AI provider", () => {
  afterEach(() => vi.useRealTimers());

  test("sends a private, tool-free strict proposal request with minimized input", async () => {
    const { client, create } = clientWith(completed({
      replacement_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Improved copy" }] }] },
      rationale: "Clarified the supplied copy.",
      citation_ids: ["cite-1"],
    }));
    const provider = new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client });
    const input = { ...INPUT, contact_email: "secret@example.com", extra: { provider_secret: "do-not-send" } } as CampaignEditorAiProviderInput & Record<string, unknown>;

    await expect(provider.transform(input)).resolves.toMatchObject({ rationale: "Clarified the supplied copy.", citation_ids: ["cite-1"] });

    const request = create.mock.calls[0][0] as Record<string, unknown>;
    expect(request.store).toBe(false);
    expect(request.provider).toEqual(expect.objectContaining({ data_collection: "deny", zdr: true }));
    expect(request).not.toHaveProperty("tools");
    expect(JSON.stringify(request)).not.toContain("contact_email");
    expect(JSON.stringify(request)).not.toContain("provider_secret");
    expect(request.instructions).toEqual(expect.stringContaining("Use no tools"));
    expect(request.instructions).toEqual(expect.stringContaining("Do not invent facts"));
    expect(request.instructions).toEqual(expect.stringContaining("Do not approve, publish, send"));
    expect(request.text).toMatchObject({ format: { type: "json_schema", name: "campaign_editor_proposal", strict: true } });
  });

  test("returns a validated document and refuses unknown citation IDs", async () => {
    const { client } = clientWith(completed({
      replacement_document: DOCUMENT,
      rationale: "No change needed.",
      citation_ids: ["unknown"],
    }));
    const provider = new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client });
    await expect(provider.transform(INPUT)).rejects.toMatchObject({ code: "unknown_citation" });
  });

  test("normalizes accepted and provider citation IDs before subset comparison", async () => {
    const { client } = clientWith(completed({ replacement_document: DOCUMENT, rationale: "Kept the copy.", citation_ids: [" cite-1 ", "cite-1"] }));
    const provider = new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client });
    const input = { ...INPUT, context: { ...INPUT.context, accepted_research: [{ ...INPUT.context.accepted_research[0], citation_ids: [" cite-1 ", "cite-1", ""] }] } };
    await expect(provider.transform(input)).resolves.toMatchObject({ citation_ids: ["cite-1"] });
  });

  test("aborts a hung request at the adapter deadline and clears the timer", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const create = vi.fn((_request: unknown, options?: { signal?: AbortSignal }) => {
      capturedSignal = options?.signal;
      return new Promise<never>((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    });
    const client = { responses: { create } } as unknown as ResponsesClient;
    const provider = new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client, deadlineMs: 100 });
    const pending = provider.transform(INPUT);
    const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });
    expect(capturedSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(capturedSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(capturedSignal?.aborted).toBe(true);
  });

  test("returns the adapter timeout at its deadline when a client ignores abort and resolves late", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const create = vi.fn((_request: unknown, options?: { signal?: AbortSignal }) => {
      capturedSignal = options?.signal;
      return new Promise((resolve) => setTimeout(() => resolve(completed({
        replacement_document: DOCUMENT,
        rationale: "Late success.",
        citation_ids: [],
      })), 200));
    });
    const provider = new OpenRouterCampaignEditorAiProvider({
      apiKey: "test-key",
      model: "approved-model",
      client: { responses: { create } } as unknown as ResponsesClient,
      deadlineMs: 100,
    });
    let outcome = "pending";
    const pending = provider.transform(INPUT).then(
      () => { outcome = "success"; },
      (error: CampaignEditorAiError) => { outcome = error.code; },
    );

    await vi.advanceTimersByTimeAsync(100);

    expect(outcome).toBe("timeout");
    expect(capturedSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(outcome).toBe("timeout");
  });

  test("observes a non-cooperative client's late rejection after the adapter timeout", async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const create = vi.fn(() => new Promise((_resolve, reject) => setTimeout(() => reject(new Error("late rejection")), 200)));
    const provider = new OpenRouterCampaignEditorAiProvider({
      apiKey: "test-key",
      model: "approved-model",
      client: { responses: { create } } as unknown as ResponsesClient,
      deadlineMs: 100,
    });

    try {
      const pending = provider.transform(INPUT);
      const timeout = expect(pending).rejects.toMatchObject({ code: "timeout" });
      await vi.advanceTimersByTimeAsync(100);
      await timeout;
      await vi.advanceTimersByTimeAsync(100);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  test("passes signal as request options, not JSON body, and cleans up after success/error", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const create = vi.fn(async (request: unknown, options?: { signal?: AbortSignal }) => {
      if (options?.signal) signals.push(options.signal);
      expect(JSON.stringify(request)).not.toContain("signal");
      return completed({ replacement_document: DOCUMENT, rationale: "Kept the copy.", citation_ids: [] });
    });
    const client = { responses: { create } } as unknown as ResponsesClient;
    const provider = new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client, deadlineMs: 100 });
    await expect(provider.transform(INPUT)).resolves.toBeDefined();
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(signals[0].aborted).toBe(false);

    const failing = vi.fn(async (_request: unknown, options?: { signal?: AbortSignal }) => {
      if (options?.signal) signals.push(options.signal);
      throw new Error("provider failed");
    });
    const failingProvider = new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client: { responses: { create: failing } } as unknown as ResponsesClient, deadlineMs: 100 });
    await expect(failingProvider.transform(INPUT)).rejects.toMatchObject({ code: "provider" });
    await vi.advanceTimersByTimeAsync(200);
    expect(signals[1]?.aborted).toBe(false);
  });

  test("projects nested runtime extras and rejects invalid document extras before transport", async () => {
    const validClient = clientWith(completed({ replacement_document: DOCUMENT, rationale: "Kept the copy.", citation_ids: [] }));
    const validProvider = new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client: validClient.client });
    const nestedExtrasInput = {
      ...INPUT,
      context: {
        ...INPUT.context,
        campaign: { ...INPUT.context.campaign, contact_email: "hidden@example.com" },
        release: { ...INPUT.context.release!, provider_secret: "hidden", track_titles: ["First Light"] },
        lead: { id: "lead-1", target_name: "Target", musical_fit: "fit", pitch_angle: "angle", contact_email: "hidden@example.com" },
        prompt: { id: "prompt-1", version: 1, text: "Prompt", provider_secret: "hidden" },
        accepted_research: [{ ...INPUT.context.accepted_research[0], contact_list: [{ contact_email: "hidden@example.com" }], provider_secret: "hidden" }],
      },
    } as unknown as CampaignEditorAiProviderInput;
    await expect(validProvider.transform(nestedExtrasInput)).resolves.toBeDefined();
    expect(JSON.stringify(validClient.create.mock.calls[0][0])).not.toContain("hidden@example.com");
    expect(JSON.stringify(validClient.create.mock.calls[0][0])).not.toContain("provider_secret");

    const invalidClient = clientWith(completed({ replacement_document: DOCUMENT, rationale: "Kept the copy.", citation_ids: [] }));
    const invalidProvider = new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client: invalidClient.client });
    const invalidDocumentInput = { ...nestedExtrasInput, current_document: { ...DOCUMENT, runtime_secret: "secret" } } as unknown as CampaignEditorAiProviderInput;
    await expect(invalidProvider.transform(invalidDocumentInput)).rejects.toMatchObject({ code: "invalid_proposal" });
    expect(invalidClient.create).not.toHaveBeenCalled();
  });

  test("freezes the shared provider privacy policy", async () => {
    expect(Object.isFrozen(openRouterProviderPreferences)).toBe(true);
    const original = openRouterProviderPreferences.data_collection;
    try { (openRouterProviderPreferences as { data_collection: string }).data_collection = "allow"; } catch { /* strict freeze is expected */ }
    expect(openRouterProviderPreferences.data_collection).toBe(original);
  });

  test("rejects oversized rationale and surface-specific document limits", async () => {
    const oversizedRationale = clientWith(completed({
      replacement_document: DOCUMENT,
      rationale: "x".repeat(2_001),
      citation_ids: [],
    }));
    await expect(new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client: oversizedRationale.client }).transform(INPUT)).rejects.toMatchObject({ code: "invalid_proposal" });

    const tooLong = "x".repeat(10_001);
    const focusedInput = { ...INPUT, surface: "focused_outreach_body" as const };
    const oversizedDocument = clientWith(completed({
      replacement_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: tooLong }] }] },
      rationale: "Too long.",
      citation_ids: [],
    }));
    await expect(new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client: oversizedDocument.client }).transform(focusedInput)).rejects.toMatchObject({ code: "invalid_proposal" });
  });

  test("classifies provider status before timeout wording and recognizes only known SDK timeout signals", async () => {
    const statusError = Object.assign(new Error("invalid timeout parameter"), { status: 400 });
    const knownSdkTimeout = Object.assign(new Error("request timed out"), { name: "APIConnectionTimeoutError" });
    const ordinaryAbort = Object.assign(new Error("request timed out"), { name: "AbortError" });
    for (const [error, code] of [[statusError, "provider"], [knownSdkTimeout, "timeout"], [ordinaryAbort, "network"]] as const) {
      const client = { responses: { create: vi.fn().mockRejectedValue(error) } } as unknown as ResponsesClient;
      await expect(new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client }).transform(INPUT)).rejects.toMatchObject({ code });
    }
  });

  test("categorizes refusal, transport failures, malformed output, and invalid documents", async () => {
    const cases: Array<[unknown, string]> = [
      [{ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] }, "refused"],
      [new Error("socket closed"), "network"],
    ];
    for (const [response, code] of cases) {
      const { client } = response instanceof Error
        ? { client: { responses: { create: vi.fn().mockRejectedValue(response) } } as unknown as ResponsesClient }
        : clientWith(response);
      const provider = new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client });
      await expect(provider.transform(INPUT)).rejects.toMatchObject({ code });
    }

    const malformed = clientWith(completed({ not_json: true }));
    (malformed.client.responses.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "completed", output_text: "{" });
    await expect(new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client: malformed.client }).transform(INPUT)).rejects.toMatchObject({ code: "malformed_output" });

    const invalid = clientWith(completed({
      replacement_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Unsafe", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] },
      rationale: "Invalid link.",
      citation_ids: [],
    }));
    await expect(new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client: invalid.client }).transform(INPUT)).rejects.toMatchObject({ code: "invalid_proposal" });
  });

  test("ignores a malformed top-level refusal when valid output is present", async () => {
    const { client } = clientWith({
      status: "completed",
      refusal: { reason: "not a string" },
      output_text: JSON.stringify({ replacement_document: DOCUMENT, rationale: "Kept the copy.", citation_ids: [] }),
    });
    await expect(new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client }).transform(INPUT)).resolves.toMatchObject({ rationale: "Kept the copy." });
  });

  test("rejects invalid runtime enum values before calling the client", async () => {
    for (const input of [
      { ...INPUT, surface: "not-a-surface" },
      { ...INPUT, operation: "not-an-operation" },
      { ...INPUT, scope: "not-a-scope" },
    ]) {
      const { client, create } = clientWith(completed({ replacement_document: DOCUMENT, rationale: "Kept the copy.", citation_ids: [] }));
      const provider = new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client });
      await expect(provider.transform(input as unknown as CampaignEditorAiProviderInput)).rejects.toMatchObject({ code: "invalid_proposal" });
      expect(create).not.toHaveBeenCalled();
    }
  });

  test("categorizes contradictory refusal before output text", async () => {
    const { client } = clientWith({
      status: "completed",
      output_text: JSON.stringify({ replacement_document: DOCUMENT, rationale: "Ignore me", citation_ids: [] }),
      output: [{ type: "message", content: [{ type: "refusal", refusal: "Policy refusal" }] }],
    });
    await expect(new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client }).transform(INPUT)).rejects.toMatchObject({ code: "refused" });
  });

  test("returns disabled/manual editing state when configuration is incomplete", () => {
    expect(getCampaignEditorAiProvider({}).id).toBe("disabled");
    expect(getCampaignEditorAiProvider({ OPENROUTER_API_KEY: "key" }).id).toBe("disabled");
    expect(getCampaignEditorAiProvider({ OPENROUTER_COMMUNICATOR_MODEL: "model" }).id).toBe("disabled");
  });

  test("does not expose raw provider errors", async () => {
    const { client } = { client: { responses: { create: vi.fn().mockRejectedValue(new Error("SECRET PROVIDER BODY")) } } as unknown as ResponsesClient };
    const provider = new OpenRouterCampaignEditorAiProvider({ apiKey: "test-key", model: "approved-model", client });
    let error: CampaignEditorAiError | undefined;
    try {
      await provider.transform(INPUT);
    } catch (value) {
      if (value instanceof CampaignEditorAiError) error = value;
    }
    expect(error).toBeInstanceOf(CampaignEditorAiError);
    expect(error?.message).not.toContain("SECRET PROVIDER BODY");
  });
});
