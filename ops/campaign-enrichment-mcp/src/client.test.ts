import { describe, expect, it, vi } from "vitest";
import { LOCAL_TOOL_API_VERSION } from "../../../src/lib/campaign-enrichment-local-tool-contract";
import {
  CampaignEnrichmentClient,
  LocalToolClientError,
} from "./client";

const revision = "a".repeat(64);
const MAX_RESPONSE_BODY_BYTES = 16 * 1_024 * 1_024;
const rawToken = `lsmcp_token-1_${"A".repeat(43)}`;
const queueItem = {
  item_id: "lead-1",
  campaign_id: "campaign-1",
  campaign_name: "Fountain",
  lead_id: "lead-1",
  target_name: "Night Shift",
  target_url: "https://example.com/night-shift",
  discovery_source: "Friend recommendation",
  recommending_person: "A friend",
  introduction_available: true,
  relationship_warmth: 3,
  musical_fit: "Leftfield electronic music",
  exact_edit: "Fountain Edit",
  editorial_fit: 3,
  useful_reach: 2,
  direct_free_access: 2,
  missing_enrichment_fields: ["pitch_angle"],
  lead_revision: revision,
  pipeline_stage: "qualified",
  claim: { status: "unclaimed", expires_at: null },
} as const;
const item = {
  ...queueItem,
  campaign: {
    goal: "Find trusted specialist radio support.",
    artist_name: "Nature Boy",
    release_title: "Fountain Edits",
    track_titles: ["Fountain"],
  },
  lead: {
    target_type: "radio_show",
    contact_route: null,
    contact_route_verified_at: null,
    pitch_angle: null,
    last_contacted_at: null,
    follow_up_at: null,
    outcome: null,
    evidence_url: null,
    published_at: null,
  },
  canonical_lead: {
    id: "lead-1",
    campaign_id: "campaign-1",
    exact_edit_track_id: "track-1",
    target_name: "Night Shift",
    target_type: "radio_show",
    target_url: "https://example.com/night-shift",
    contact_route: null,
    contact_route_verified_at: null,
    discovery_source: "Friend recommendation",
    recommending_person: "A friend",
    introduction_available: true,
    musical_fit: "Leftfield electronic music",
    relationship_warmth: 3,
    editorial_fit: 3,
    useful_reach: 2,
    direct_free_access: 2,
    pipeline_stage: "qualified",
    pitch_angle: null,
    last_contacted_at: null,
    follow_up_at: null,
    outcome: null,
    evidence_url: null,
    published_at: null,
    updated_at: "2026-08-10T12:00:00.000Z",
  },
  prompt: null,
  accepted_research: [],
  pending_suggestions: [],
} as const;
const health = {
  status: "degraded",
  web: "ok",
  database: "ok",
  worker: "unavailable",
  application: { status: "degraded" },
  analytics: { status: "ok", freshness: "current", coverage: "complete" },
  revision: "b".repeat(40),
} as const;
const jobsHealth = {
  queued: 2,
  running: 1,
  failed: 0,
  oldest_queued_at: "2026-08-27T08:00:00.000Z",
  expired_leases: 0,
  active_workers: 1,
} as const;
const releaseBrief = {
  resource_type: "release",
  record: {
    id: "release-1",
    title: "Fountain",
    artist_name: "Nature Boy",
    status: "scheduled",
    release_date: "2026-09-18",
    format: "single",
    phase: "assets_metadata",
  },
  readiness: {
    state: "blocked",
    blockers: ["UPC/EAN"],
    next_action: { label: "Resolve UPC/EAN", href: "/releases/release-1?section=overview&focus=upc" },
  },
} as const;

function success(data: unknown, requestId = "request-1") {
  return new Response(JSON.stringify({
    version: LOCAL_TOOL_API_VERSION,
    request_id: requestId,
    data,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function credentials(token = "secret") {
  return { read: vi.fn().mockResolvedValue(token) };
}

describe("CampaignEnrichmentClient", () => {
  it("reads public health without requiring a bearer token, including degraded responses", async () => {
    const store = credentials();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(health), {
      status: 503,
      headers: { "content-type": "application/json" },
    }));
    const client = new CampaignEnrichmentClient({
      baseUrl: "https://suite.example",
      credentials: store,
      fetch: fetchMock,
    });

    await expect(client.getHealth()).resolves.toEqual(health);
    expect(store.read).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://suite.example/api/health",
      expect.objectContaining({ method: "GET", headers: { Accept: "application/json" } }),
    );
  });

  it("calls only the bounded authenticated operator routes", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(success(jobsHealth))
      .mockResolvedValueOnce(success(releaseBrief));
    const client = new CampaignEnrichmentClient({
      baseUrl: "https://suite.example",
      credentials: credentials(),
      fetch: fetchMock,
    });

    await expect(client.getJobsHealth()).resolves.toMatchObject({ data: jobsHealth });
    await expect(client.getOperationsBrief({
      resource_type: "release",
      resource_id: "release/one",
    })).resolves.toMatchObject({ data: releaseBrief });

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["https://suite.example/api/local-tools/v1/operator/jobs/health", "GET"],
      ["https://suite.example/api/local-tools/v1/operator/operations-brief?resource_type=release&resource_id=release%2Fone", "GET"],
    ]);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer secret" });
  });

  it("adds bearer auth internally and validates the versioned queue response", async () => {
    const store = credentials();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(success({ items: [queueItem] }));
    const client = new CampaignEnrichmentClient({
      baseUrl: "https://suite.example",
      credentials: store,
      fetch: fetchMock,
    });

    const result = await client.listQueue({ limit: 20 });

    expect(result).toEqual({
      version: LOCAL_TOOL_API_VERSION,
      request_id: "request-1",
      data: { items: [queueItem] },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://suite.example/api/local-tools/v1/campaign-enrichment/queue?limit=20",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("reads the bearer credential inside every request", async () => {
    const store = credentials();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => success({ items: [] }));
    const client = new CampaignEnrichmentClient({
      baseUrl: "https://suite.example/",
      credentials: store,
      fetch: fetchMock,
    });

    await client.listQueue({ limit: 1 });
    await client.listQueue({ limit: 2 });

    expect(store.read).toHaveBeenCalledTimes(2);
    expect(store.read).toHaveBeenNthCalledWith(1, "https://suite.example");
    expect(store.read).toHaveBeenNthCalledWith(2, "https://suite.example");
  });

  it("calls only the five versioned enrichment routes with validated payloads", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(success(item))
      .mockResolvedValueOnce(success({
        id: "claim-1",
        lead_id: "lead-1",
        claimed_at: "2026-08-10T12:00:00.000Z",
        renewed_at: null,
        expires_at: "2026-08-10T12:20:00.000Z",
      }))
      .mockResolvedValueOnce(success({
        run_id: "run-1",
        suggestions: [{ id: "suggestion-1", suggestion_type: "musical_fit" }],
      }))
      .mockResolvedValueOnce(success({ released: true }));
    const client = new CampaignEnrichmentClient({
      baseUrl: "https://suite.example",
      credentials: credentials(),
      fetch: fetchMock,
    });
    const proposal = {
      claim_id: "claim-1",
      expected_lead_revision: revision,
      idempotency_key: "d76af5f9-9568-4ab5-b896-e5b0db67be14",
      proposals: [{
        field: "musical_fit" as const,
        value: "Fits the leftfield electronic brief.",
        rationale: "The programme consistently selects adjacent artists.",
        evidence: [{
          title: "Night Shift programme",
          url: "https://example.com/night-shift",
          retrieved_at: "2026-08-10T12:00:00.000Z",
          citation_text: "Recent episodes feature adjacent electronic artists.",
        }],
      }],
      client: { name: "label-suite-codex" as const, version: "0.1.0", session_label: null },
    };

    await client.getItem("lead/one");
    await client.claimItem("lead-1", { expected_lead_revision: revision });
    await client.submitProposal("lead-1", proposal);
    await client.releaseItem("lead-1", "claim-1");

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ["https://suite.example/api/local-tools/v1/campaign-enrichment/items/lead%2Fone", "GET", undefined],
      ["https://suite.example/api/local-tools/v1/campaign-enrichment/items/lead-1/claim", "POST", JSON.stringify({
        expected_lead_revision: revision,
        lease_minutes: 20,
      })],
      ["https://suite.example/api/local-tools/v1/campaign-enrichment/items/lead-1/proposals", "POST", JSON.stringify(proposal)],
      ["https://suite.example/api/local-tools/v1/campaign-enrichment/items/lead-1/claim/claim-1", "DELETE", undefined],
    ]);
  });

  it.each([
    "http://suite.example",
    "http://localhost:4321",
    "ftp://suite.example",
    "https://user:password@suite.example",
  ])("rejects a non-HTTPS or credential-bearing base URL before credential access: %s", async (baseUrl) => {
    const store = credentials();

    expect(() => new CampaignEnrichmentClient({ baseUrl, credentials: store })).toThrow(LocalToolClientError);
    expect(store.read).not.toHaveBeenCalled();
  });

  it("permits only the explicit 127.0.0.1 HTTP development origin", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(success({ items: [] }));
    const client = new CampaignEnrichmentClient({
      baseUrl: "http://127.0.0.1:4321",
      credentials: credentials(),
      fetch: fetchMock,
    });

    await client.listQueue({ limit: 20 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:4321/api/local-tools/v1/campaign-enrichment/queue?limit=20",
    );
  });

  it("maps only a validated fixed server error and preserves its safe request ID", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      version: LOCAL_TOOL_API_VERSION,
      request_id: "request-auth",
      error: {
        code: "authentication_failed",
        message: "Authentication failed",
        retryable: false,
      },
    }), { status: 401, headers: { "content-type": "application/json" } }));
    const client = new CampaignEnrichmentClient({
      baseUrl: "https://suite.example",
      credentials: credentials(),
      fetch: fetchMock,
    });

    await expect(client.listQueue({ limit: 20 })).rejects.toMatchObject({
      code: "authentication_failed",
      message: "Authentication failed",
      requestId: "request-auth",
      retryable: false,
    });
  });

  it.each([
    vi.fn<typeof fetch>().mockRejectedValue(new Error("Bearer secret transport detail")),
    vi.fn<typeof fetch>().mockResolvedValue(new Response("secret invalid response", { status: 500 })),
    vi.fn<typeof fetch>().mockResolvedValue(success({ items: [{ ...queueItem, lead_revision: "secret" }] })),
  ])("never includes the token or raw response in a public error", async (fetchMock) => {
    const client = new CampaignEnrichmentClient({
      baseUrl: "https://suite.example",
      credentials: credentials(),
      fetch: fetchMock,
    });

    const error = await client.listQueue({ limit: 20 }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LocalToolClientError);
    expect(String(error)).not.toMatch(/secret|transport detail|invalid response/);
    expect(error).toMatchObject({ code: "service_unavailable" });
  });

  it("rejects an invalid proposal before reading credentials or reaching the network", async () => {
    const store = credentials();
    const fetchMock = vi.fn<typeof fetch>();
    const client = new CampaignEnrichmentClient({
      baseUrl: "https://suite.example",
      credentials: store,
      fetch: fetchMock,
    });

    await expect(client.submitProposal("lead-1", { accepted: true } as never)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(store.read).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an oversized response field", { items: [{ ...queueItem, target_name: "x".repeat(501) }] }],
    ["an oversized queue array", {
      items: Array.from({ length: 51 }, (_, index) => ({
        ...queueItem,
        item_id: `lead-${index}`,
        lead_id: `lead-${index}`,
      })),
    }],
  ])("fails closed on %s", async (_label, data) => {
    const client = new CampaignEnrichmentClient({
      baseUrl: "https://suite.example",
      credentials: credentials(),
      fetch: vi.fn<typeof fetch>().mockResolvedValue(success(data)),
    });

    await expect(client.listQueue({ limit: 20 })).rejects.toMatchObject({
      code: "service_unavailable",
    });
  });

  it("rejects a response whose declared total body exceeds the fixed byte limit", async () => {
    const response = success({ items: [] });
    response.headers.set("content-length", String(MAX_RESPONSE_BODY_BYTES + 1));
    const client = new CampaignEnrichmentClient({
      baseUrl: "https://suite.example",
      credentials: credentials(),
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
    });

    await expect(client.listQueue({ limit: 20 })).rejects.toMatchObject({
      code: "service_unavailable",
    });
  });

  it("stops reading an undeclared response body after the fixed byte limit", async () => {
    const response = new Response(new Uint8Array(MAX_RESPONSE_BODY_BYTES + 1), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    expect(response.headers.get("content-length")).toBeNull();
    const client = new CampaignEnrichmentClient({
      baseUrl: "https://suite.example",
      credentials: credentials(),
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
    });

    await expect(client.listQueue({ limit: 20 })).rejects.toMatchObject({
      code: "service_unavailable",
    });
  });

  it("fails closed when a valid response reflects the current bearer token", async () => {
    const client = new CampaignEnrichmentClient({
      baseUrl: "https://suite.example",
      credentials: credentials(rawToken),
      fetch: vi.fn<typeof fetch>().mockResolvedValue(success({
        items: [{ ...queueItem, target_name: rawToken }],
      })),
    });

    const error = await client.listQueue({ limit: 20 }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "service_unavailable" });
    expect(String(error)).not.toContain(rawToken);
  });

  it.each(["array", "object"] as const)(
    "fails closed on a large malformed %s without exposing traversal errors or credentials",
    async (collectionType) => {
      let padding: unknown;
      if (collectionType === "array") {
        const entries = Array<null | string>(200_000).fill(null);
        entries[0] = rawToken;
        padding = entries;
      } else {
        const entries: Record<string, null | string> = {};
        for (let index = 0; index < 200_000; index += 1) entries[`entry-${index}`] = null;
        entries.credential = rawToken;
        padding = entries;
      }
      const client = new CampaignEnrichmentClient({
        baseUrl: "https://suite.example",
        credentials: credentials(rawToken),
        fetch: vi.fn<typeof fetch>().mockResolvedValue(success({ items: [], padding })),
      });

      const error = await client.listQueue({ limit: 20 }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(LocalToolClientError);
      expect(error).toMatchObject({ code: "service_unavailable" });
      expect(String(error)).not.toMatch(/RangeError|Maximum call stack|too many arguments/);
      expect(String(error)).not.toContain(rawToken);
    },
  );
});
