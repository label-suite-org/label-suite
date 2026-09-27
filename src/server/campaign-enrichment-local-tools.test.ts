import { describe, expect, it, vi } from "vitest";
import type {
  CampaignEnrichmentProposalSubmission,
  CampaignEnrichmentQueueQuery,
} from "../lib/campaign-enrichment-local-tool-contract";
import {
  claimCampaignEnrichmentItem,
  getCampaignEnrichmentItem,
  listCampaignEnrichmentQueue,
  releaseCampaignEnrichmentItem,
  submitCampaignEnrichmentProposal,
  validateCampaignEnrichmentProposalSuggestionRows,
  type CampaignEnrichmentClaimRow,
  type CampaignEnrichmentClaimTransaction,
  type CampaignEnrichmentProposalRunRow,
  type CampaignEnrichmentProposalSuggestionRow,
  type CampaignEnrichmentItemSource,
  type CampaignEnrichmentLocalToolDependencies,
  type CampaignEnrichmentQueueSource,
} from "./campaign-enrichment-local-tools";
import { buildLeadRevision } from "./campaign-enrichment-local-tools-core";

const now = new Date("2026-08-10T12:00:00.000Z");
const principal = {
  tokenId: "token-a",
  orgId: "org-a",
  userId: "user-a",
  scopes: ["campaign.enrichment.read", "campaign.enrichment.claim"] as const,
};
const principalB = {
  tokenId: "token-b",
  orgId: "org-a",
  userId: "user-b",
  scopes: ["campaign.enrichment.read", "campaign.enrichment.claim"] as const,
};

function lead(overrides: Partial<CampaignEnrichmentQueueSource["lead"]> = {}): CampaignEnrichmentQueueSource["lead"] {
  return {
    id: "cold",
    campaign_id: "fountain",
    exact_edit_track_id: "track-edit",
    target_name: "Cold Radio",
    target_type: "radio_show",
    target_url: "https://example.com/cold",
    contact_route: "cold@example.com",
    contact_route_verified_at: null,
    discovery_source: "Research",
    recommending_person: null,
    introduction_available: false,
    musical_fit: null,
    relationship_warmth: 3,
    editorial_fit: 3,
    useful_reach: 2,
    direct_free_access: 2,
    pipeline_stage: "identified",
    pitch_angle: null,
    last_contacted_at: null,
    follow_up_at: null,
    outcome: null,
    evidence_url: null,
    published_at: null,
    updated_at: now,
    ...overrides,
  };
}

function queueSource(
  overrides: Omit<Partial<CampaignEnrichmentQueueSource>, "lead"> & {
    lead?: Partial<CampaignEnrichmentQueueSource["lead"]>;
  } = {},
): CampaignEnrichmentQueueSource {
  const { lead: leadOverrides, ...sourceOverrides } = overrides;
  return {
    org_id: "org-a",
    campaign_id: "fountain",
    campaign_name: "Fountain Edits",
    lead: lead(leadOverrides),
    exact_edit: "Fountain Edit",
    accepted_suggestion_identities: [],
    claim_expires_at: null,
    ...sourceOverrides,
  };
}

function suggestion(
  overrides: Partial<CampaignEnrichmentItemSource["suggestions"][number]> = {},
): CampaignEnrichmentItemSource["suggestions"][number] {
  return {
    id: "suggestion-accepted",
    suggestion_type: "programming_focus",
    suggested_value: { value: "Late-night electronic programme", rationale: "Recent archive evidence" },
    evidence: [{
      title: "Programme archive",
      url: "https://example.com/programme",
      retrieved_at: "2026-08-10T11:00:00.000Z",
      citation_text: "The archive lists a weekly electronic programme.",
    }],
    status: "accepted",
    created_at: new Date("2026-08-10T11:00:00.000Z"),
    updated_at: new Date("2026-08-10T11:30:00.000Z"),
    ...overrides,
  };
}

function itemSource(overrides: Partial<CampaignEnrichmentItemSource> = {}): CampaignEnrichmentItemSource {
  return {
    ...queueSource({ lead: { id: "lead-1", contact_route: "lead@example.com" } }),
    campaign_goal: "Find trusted specialist radio support.",
    artist_name: "Nature Boy",
    release_title: "Fountain Edits",
    track_titles: ["Fountain", "Fountain (Dub)"],
    prompt: { id: "prompt-2", version: 2, text: "Research only; do not contact anyone." },
    suggestions: [
      suggestion(),
      suggestion({
        id: "suggestion-pending",
        suggestion_type: "musical_fit",
        status: "pending",
        updated_at: new Date("2026-08-10T11:45:00.000Z"),
      }),
      suggestion({
        id: "suggestion-rejected",
        suggestion_type: "pitch_angle",
        status: "rejected",
        updated_at: new Date("2026-08-10T11:50:00.000Z"),
      }),
    ],
    ...overrides,
  };
}

function dependencies(
  queueRows: CampaignEnrichmentQueueSource[],
  item: CampaignEnrichmentItemSource = itemSource(),
): CampaignEnrichmentLocalToolDependencies & {
  store: CampaignEnrichmentLocalToolDependencies["store"] & {
    listQueueRows: ReturnType<typeof vi.fn>;
    loadItem: ReturnType<typeof vi.fn>;
  };
} {
  const listQueueRows = vi.fn(async (
    orgId: string,
    query: Required<CampaignEnrichmentQueueQuery>,
  ) => queueRows.filter((row) => (
    row.org_id === orgId
    && (!query.campaign_id || row.campaign_id === query.campaign_id)
  )));
  const loadItem = vi.fn(async (orgId: string, leadId: string) => (
    item.org_id === orgId && item.lead.id === leadId ? item : null
  ));

  return {
    now: () => now,
    randomUUID: () => "claim-new",
    store: {
      listQueueRows,
      loadItem,
      transaction: async () => {
        throw new Error("Read test must not open a transaction");
      },
    },
  };
}

describe("campaign enrichment local-tool reads", () => {
  it("prioritizes warm Fountain leads and excludes unrelated tenant data", async () => {
    const deps = dependencies([
      queueSource(),
      queueSource({
        lead: {
          id: "friend",
          target_name: "Friend Radio",
          contact_route: "friend@example.com",
          discovery_source: "Friend recommendation",
          relationship_warmth: 1,
          editorial_fit: 0,
          useful_reach: 0,
          direct_free_access: 0,
        },
      }),
      queueSource({
        lead: {
          id: "friend-intro",
          target_name: "Introduced Radio",
          contact_route: "introduced@example.com",
          discovery_source: "Existing relationship",
          introduction_available: true,
          relationship_warmth: 1,
          editorial_fit: 0,
          useful_reach: 0,
          direct_free_access: 0,
        },
      }),
      queueSource({
        org_id: "other-org",
        lead: { id: "other-org-lead", contact_route: "other-org-contact@example.com" },
      }),
    ]);

    const queue = await listCampaignEnrichmentQueue(
      principal,
      { campaign_id: "fountain", limit: 20 },
      deps,
    );

    expect(queue.items.map((item) => item.lead_id)).toEqual(["friend-intro", "friend", "cold"]);
    expect(JSON.stringify(queue)).not.toContain("other-org-contact@example.com");
    expect(deps.store.listQueueRows).toHaveBeenCalledWith("org-a", {
      campaign_id: "fountain",
      state: "all",
      limit: 20,
    }, now);
  });

  it("rejects queue limits outside the reviewed 1-50 bound before data access", async () => {
    const deps = dependencies([queueSource()]);

    await expect(listCampaignEnrichmentQueue(principal, { limit: 0 }, deps)).rejects.toThrow();
    await expect(listCampaignEnrichmentQueue(principal, { limit: 51 }, deps)).rejects.toThrow();

    expect(deps.store.listQueueRows).not.toHaveBeenCalled();
  });

  it("does not mark accepted programming research as missing in the compact queue", async () => {
    const deps = dependencies([queueSource({
      accepted_suggestion_identities: [{
        id: "programming-accepted",
        suggestion_type: "programming_focus",
        status: "accepted",
        updated_at: now,
      }],
    })]);

    const queue = await listCampaignEnrichmentQueue(principal, { limit: 20 }, deps);

    expect(queue.items[0].missing_enrichment_fields).not.toContain("programming_focus");
  });

  it("fails closed instead of hashing an unbounded accepted-identity set", async () => {
    const deps = dependencies([queueSource({
      accepted_suggestion_identities: Array.from({ length: 101 }, (_, index) => ({
        id: `accepted-${index}`,
        suggestion_type: "programming_focus",
        status: "accepted" as const,
        updated_at: now,
      })),
    })]);

    await expect(listCampaignEnrichmentQueue(principal, { limit: 20 }, deps))
      .rejects.toMatchObject({ code: "service_unavailable" });
  });

  it("projects one authoritative lead revision from accepted research only", async () => {
    const source = itemSource() as CampaignEnrichmentItemSource & Record<string, unknown>;
    source.unrelated_contact_list = ["other-org-contact@example.com"];
    source.provider_secret = "provider-secret";
    const deps = dependencies([], source);

    const first = await getCampaignEnrichmentItem(principal, "lead-1", deps);
    const pending = source.suggestions.find((row) => row.status === "pending")!;
    pending.updated_at = new Date("2026-08-10T11:59:00.000Z");
    const afterPendingChange = await getCampaignEnrichmentItem(principal, "lead-1", deps);
    const accepted = source.suggestions.find((row) => row.status === "accepted")!;
    accepted.updated_at = new Date("2026-08-10T11:59:30.000Z");
    const afterAcceptedChange = await getCampaignEnrichmentItem(principal, "lead-1", deps);

    expect(first.lead_revision).toMatch(/^[a-f0-9]{64}$/);
    expect(first.canonical_lead).toEqual({
      id: "lead-1",
      campaign_id: "fountain",
      exact_edit_track_id: "track-edit",
      target_name: "Cold Radio",
      target_type: "radio_show",
      target_url: "https://example.com/cold",
      contact_route: "lead@example.com",
      contact_route_verified_at: null,
      discovery_source: "Research",
      recommending_person: null,
      introduction_available: false,
      musical_fit: null,
      relationship_warmth: 3,
      editorial_fit: 3,
      useful_reach: 2,
      direct_free_access: 2,
      pipeline_stage: "identified",
      pitch_angle: null,
      last_contacted_at: null,
      follow_up_at: null,
      outcome: null,
      evidence_url: null,
      published_at: null,
      updated_at: "2026-08-10T12:00:00.000Z",
    });
    expect(first.accepted_research.every((row) => row.status === "accepted")).toBe(true);
    expect(first.pending_suggestions.every((row) => row.status === "pending")).toBe(true);
    expect(afterPendingChange.lead_revision).toBe(first.lead_revision);
    expect(afterAcceptedChange.lead_revision).not.toBe(first.lead_revision);
    expect(JSON.stringify(first)).not.toContain("other-org-contact@example.com");
    expect(JSON.stringify(first)).not.toContain("provider-secret");
    expect(deps.store.loadItem).toHaveBeenCalledWith("org-a", "lead-1", now);
  });

  it("bounds projected database text and repeated context", async () => {
    const oversized = "x".repeat(25_000);
    const source = itemSource({
      campaign_name: oversized,
      campaign_goal: oversized,
      artist_name: oversized,
      release_title: oversized,
      exact_edit: oversized,
      track_titles: Array.from({ length: 101 }, () => oversized),
      prompt: { id: "prompt-large", version: 3, text: oversized },
      lead: lead({
        id: "lead-1",
        target_name: oversized,
        target_url: `https://example.com/${oversized}`,
        contact_route: oversized,
        discovery_source: oversized,
        recommending_person: oversized,
        musical_fit: oversized,
        pitch_angle: oversized,
        outcome: oversized,
        evidence_url: `https://example.com/${oversized}`,
      }),
      suggestions: [suggestion({
        suggested_value: { value: oversized, rationale: oversized },
      })],
    });
    const deps = dependencies([], source);

    const projected = await getCampaignEnrichmentItem(principal, "lead-1", deps);

    expect(projected.campaign_name.length).toBe(500);
    expect(projected.target_name.length).toBe(500);
    expect(projected.target_url).toHaveLength(2_048);
    expect(projected.campaign.goal).toHaveLength(20_000);
    expect(projected.campaign.artist_name).toHaveLength(500);
    expect(projected.campaign.release_title).toHaveLength(500);
    expect(projected.campaign.track_titles).toHaveLength(100);
    expect(projected.campaign.track_titles[0]).toHaveLength(500);
    expect(projected.prompt?.text).toHaveLength(20_000);
    expect(projected.lead.contact_route).toHaveLength(500);
    expect(projected.lead.pitch_angle).toHaveLength(2_000);
    expect(projected.accepted_research[0].value).toHaveLength(2_000);
    expect(projected.accepted_research[0].rationale).toHaveLength(2_000);
  });

  it("preserves a valid canonical lead evidence URL", async () => {
    const deps = dependencies([], itemSource({
      lead: lead({
        id: "lead-1",
        evidence_url: "https://example.com/evidence",
      }),
    }));

    const projected = await getCampaignEnrichmentItem(principal, "lead-1", deps);

    expect(projected.lead.evidence_url).toBe("https://example.com/evidence");
  });

  it.each([
    ["HTTP", "http://example.com/evidence"],
    ["malformed", "not-a-url"],
    ["oversized", `https://example.com/${"x".repeat(2_048)}`],
  ])("fails closed for a %s canonical lead evidence URL", async (_label, evidenceUrl) => {
    const deps = dependencies([], itemSource({
      lead: lead({ id: "lead-1", evidence_url: evidenceUrl }),
    }));

    const projected = await getCampaignEnrichmentItem(principal, "lead-1", deps);

    expect(projected.lead.evidence_url).toBeNull();
  });
});

function claimRow(overrides: Partial<CampaignEnrichmentClaimRow> = {}): CampaignEnrichmentClaimRow {
  return {
    id: "claim-existing",
    org_id: "org-a",
    campaign_id: "fountain",
    lead_id: "lead-1",
    token_id: principal.tokenId,
    user_id: principal.userId,
    claimed_at: new Date("2026-08-10T11:50:00.000Z"),
    renewed_at: null,
    expires_at: new Date("2026-08-10T12:10:00.000Z"),
    created_at: new Date("2026-08-10T11:50:00.000Z"),
    updated_at: new Date("2026-08-10T11:50:00.000Z"),
    ...overrides,
  };
}

function leaseDependencies(existing: CampaignEnrichmentClaimRow | null = null) {
  const lockedLead = lead({ id: "lead-1" });
  let currentClaim = existing;
  const tx: CampaignEnrichmentClaimTransaction = {
    lockLead: vi.fn(async (orgId, leadId) => (
      orgId === "org-a" && leadId === lockedLead.id ? lockedLead : null
    )),
    listAcceptedSuggestionIdentities: vi.fn(async (orgId, campaignId, leadId) => (
      orgId === "org-a" && campaignId === "fountain" && leadId === "lead-1" ? [] : []
    )),
    findClaimForUpdate: vi.fn(async (orgId, campaignId, leadId) => (
      currentClaim && currentClaim.org_id === orgId
      && currentClaim.campaign_id === campaignId
      && currentClaim.lead_id === leadId
        ? currentClaim
        : null
    )),
    findRunByIdempotencyKeyForUpdate: vi.fn(async () => null),
    listSuggestionsByRun: vi.fn(async () => []),
    insertClaim: vi.fn(async (row) => {
      currentClaim = row;
      return row;
    }),
    updateClaim: vi.fn(async (orgId, campaignId, leadId, claimId, changes) => {
      if (
        !currentClaim
        || currentClaim.org_id !== orgId
        || currentClaim.campaign_id !== campaignId
        || currentClaim.lead_id !== leadId
        || currentClaim.id !== claimId
      ) return null;
      currentClaim = { ...currentClaim, ...changes };
      return currentClaim;
    }),
    insertRun: vi.fn(async (row) => row),
    insertSuggestions: vi.fn(async () => undefined),
    insertEvent: vi.fn(async () => undefined),
    deleteOwnedClaim: vi.fn(async (orgId, campaignId, leadId, claimId, tokenId, userId) => {
      if (
        !currentClaim
        || currentClaim.org_id !== orgId
        || currentClaim.campaign_id !== campaignId
        || currentClaim.lead_id !== leadId
        || currentClaim.id !== claimId
        || currentClaim.token_id !== tokenId
        || currentClaim.user_id !== userId
      ) return false;
      currentClaim = null;
      return true;
    }),
  };
  const transaction: CampaignEnrichmentLocalToolDependencies["store"]["transaction"] = async <T>(
    operation: (transaction: CampaignEnrichmentClaimTransaction) => Promise<T>,
  ) => operation(tx);
  const updateLead = vi.fn();
  const insertEvent = vi.fn();
  const deps: CampaignEnrichmentLocalToolDependencies = {
    now: () => now,
    randomUUID: () => "claim-new",
    store: {
      listQueueRows: async () => [],
      loadItem: async () => null,
      transaction,
    },
  };

  return { ...deps, store: { ...deps.store, transaction }, tx, updateLead, insertEvent, currentClaim: () => currentClaim };
}

const claimRequest = {
  expected_lead_revision: buildLeadRevision(lead({ id: "lead-1" }), []),
  lease_minutes: 20,
};

describe("campaign enrichment local-tool leases", () => {
  it("renews an owned lease and rejects a different active owner", async () => {
    const deps = leaseDependencies();

    const first = await claimCampaignEnrichmentItem(principal, "lead-1", claimRequest, deps);
    const renewed = await claimCampaignEnrichmentItem(principal, "lead-1", claimRequest, deps);

    expect(first.result_category).toBe("claimed");
    expect(renewed.result_category).toBe("renewed");
    expect(renewed.id).toBe(first.id);
    expect(renewed.renewed_at).toEqual(now);
    await expect(claimCampaignEnrichmentItem(principalB, "lead-1", claimRequest, deps))
      .rejects.toMatchObject({
        code: "claim_conflict",
        details: { expires_at: "2026-08-10T12:20:00.000Z" },
      });
    expect(deps.tx.lockLead).toHaveBeenCalledWith("org-a", "lead-1");
    expect(deps.updateLead).not.toHaveBeenCalled();
    expect(deps.insertEvent).not.toHaveBeenCalled();
  });

  it("reclaims an expired lease without changing the lead", async () => {
    const expiredDeps = leaseDependencies(claimRow({
      expires_at: new Date("2026-08-10T11:59:59.000Z"),
    }));
    const before = JSON.stringify(lead({ id: "lead-1" }));

    const result = await claimCampaignEnrichmentItem(principalB, "lead-1", claimRequest, expiredDeps);

    expect(result.result_category).toBe("reclaimed");
    expect(result.id).toBe("claim-new");
    expect(result.token_id).toBe(principalB.tokenId);
    expect(result.user_id).toBe(principalB.userId);
    expect(result.expires_at).toEqual(new Date("2026-08-10T12:20:00.000Z"));
    expect(expiredDeps.updateLead).not.toHaveBeenCalled();
    expect(expiredDeps.insertEvent).not.toHaveBeenCalled();
    expect(JSON.stringify(lead({ id: "lead-1" }))).toBe(before);
  });

  it("checks lease expiry after acquiring the row locks", async () => {
    let clock = new Date("2026-08-10T11:59:59.000Z");
    const deps = leaseDependencies(claimRow({
      expires_at: new Date("2026-08-10T12:00:00.000Z"),
    }));
    deps.now = () => clock;
    vi.mocked(deps.tx.lockLead).mockImplementation(async () => {
      clock = new Date("2026-08-10T12:00:01.000Z");
      return lead({ id: "lead-1" });
    });

    const result = await claimCampaignEnrichmentItem(principalB, "lead-1", claimRequest, deps);

    expect(result.token_id).toBe("token-b");
    expect(result.claimed_at).toEqual(clock);
    expect(result.expires_at).toEqual(new Date("2026-08-10T12:20:01.000Z"));
  });

  it("fails closed before claiming when accepted revision input is unbounded", async () => {
    const deps = leaseDependencies();
    vi.mocked(deps.tx.listAcceptedSuggestionIdentities).mockResolvedValue(
      Array.from({ length: 101 }, (_, index) => ({
        id: `accepted-${index}`,
        suggestion_type: "programming_focus",
        status: "accepted" as const,
        updated_at: now,
      })),
    );

    await expect(claimCampaignEnrichmentItem(principal, "lead-1", claimRequest, deps))
      .rejects.toMatchObject({ code: "service_unavailable" });
    expect(deps.tx.insertClaim).not.toHaveBeenCalled();
    expect(deps.tx.updateClaim).not.toHaveBeenCalled();
  });

  it("rejects stale revisions and lease durations over 20 minutes before writing", async () => {
    const deps = leaseDependencies();

    await expect(claimCampaignEnrichmentItem(principal, "lead-1", {
      ...claimRequest,
      expected_lead_revision: "f".repeat(64),
    }, deps)).rejects.toMatchObject({ code: "stale_revision" });
    await expect(claimCampaignEnrichmentItem(principal, "lead-1", {
      ...claimRequest,
      lease_minutes: 21,
    }, deps)).rejects.toThrow();

    expect(deps.tx.insertClaim).not.toHaveBeenCalled();
    expect(deps.tx.updateClaim).not.toHaveBeenCalled();
  });

  it("releases only an active owned claim and treats missing or expired leases as released", async () => {
    const owned = leaseDependencies(claimRow());

    await expect(releaseCampaignEnrichmentItem(principal, "lead-1", "claim-existing", owned))
      .resolves.toEqual({ released: true, result_category: "released" });
    expect(owned.tx.deleteOwnedClaim).toHaveBeenCalledWith(
      "org-a",
      "fountain",
      "lead-1",
      "claim-existing",
      "token-a",
      "user-a",
    );
    await expect(releaseCampaignEnrichmentItem(principal, "lead-1", "claim-existing", owned))
      .resolves.toEqual({ released: true, result_category: "release_noop" });

    const expired = leaseDependencies(claimRow({ expires_at: now }));
    await expect(releaseCampaignEnrichmentItem(principal, "lead-1", "claim-existing", expired))
      .resolves.toEqual({ released: true, result_category: "release_noop" });
    expect(expired.tx.deleteOwnedClaim).not.toHaveBeenCalled();

    const foreign = leaseDependencies(claimRow({ token_id: "token-b", user_id: "user-b" }));
    await expect(releaseCampaignEnrichmentItem(principal, "lead-1", "claim-existing", foreign))
      .resolves.toEqual({ released: true, result_category: "release_noop" });
    expect(foreign.tx.deleteOwnedClaim).not.toHaveBeenCalled();
  });
});

const validSubmission: CampaignEnrichmentProposalSubmission = {
  claim_id: "claim-existing",
  expected_lead_revision: buildLeadRevision(lead({ id: "lead-1" }), []),
  idempotency_key: "018f47be-19f1-7a52-b9d8-30fcd2f54a44",
  proposals: [
    {
      field: "musical_fit",
      value: "Warm, leftfield club music",
      rationale: "Recent programming includes compatible artists.",
      evidence: [{
        title: "Night Radio archive",
        url: "https://example.com/night-radio/archive",
        retrieved_at: "2026-08-10T11:00:00.000Z",
        citation_text: "Recent programming includes leftfield club music.",
      }],
    },
    {
      field: "programming_focus",
      value: "Late-night electronic programme",
      rationale: "The current schedule has a weekly specialist slot.",
      evidence: [{
        title: "Night Radio schedule",
        url: "https://example.com/night-radio/schedule",
        retrieved_at: "2026-08-10T11:05:00.000Z",
        citation_text: "The schedule lists a weekly late-night electronic programme.",
      }],
    },
  ],
  client: {
    name: "label-suite-codex",
    version: "0.1.0",
    session_label: "fountain-research",
  },
};

function proposalDependencies(input: {
  claim?: CampaignEnrichmentClaimRow | null;
  failAfterSuggestionInsert?: boolean;
  runInsertError?: Error;
} = {}) {
  const leads = [
    lead({ id: "lead-1" }),
    lead({ id: "lead-2", target_name: "Second Radio", updated_at: new Date("2026-08-10T11:30:00.000Z") }),
  ];
  let currentClaim = input.claim === undefined ? claimRow() : input.claim;
  const runs: CampaignEnrichmentProposalRunRow[] = [];
  const suggestions: CampaignEnrichmentProposalSuggestionRow[] = [];
  const events: Array<Record<string, unknown>> = [];
  const operations: string[] = [];
  let sequence = 0;
  const generatedIds = ["run-new", "suggestion-one", "suggestion-two", "event-new"];

  const tx: CampaignEnrichmentClaimTransaction = {
    lockLead: vi.fn(async (orgId, leadId) => {
      operations.push("lockLead");
      return orgId === "org-a" ? leads.find((row) => row.id === leadId) ?? null : null;
    }),
    listAcceptedSuggestionIdentities: vi.fn(async () => {
      operations.push("listAcceptedSuggestionIdentities");
      return [];
    }),
    findClaimForUpdate: vi.fn(async (orgId, campaignId, leadId) => {
      operations.push("findClaimForUpdate");
      return currentClaim
        && currentClaim.org_id === orgId
        && currentClaim.campaign_id === campaignId
        && currentClaim.lead_id === leadId
        ? currentClaim
        : null;
    }),
    findRunByIdempotencyKeyForUpdate: vi.fn(async (orgId, sourceKind, idempotencyKey) => {
      operations.push("findRunByIdempotencyKeyForUpdate");
      return runs.find((row) => (
        row.org_id === orgId
        && row.source_kind === sourceKind
        && row.idempotency_key === idempotencyKey
      )) ?? null;
    }),
    listSuggestionsByRun: vi.fn(async (orgId, campaignId, leadId, runId) => {
      operations.push("listSuggestionsByRun");
      return suggestions.filter((row) => (
        row.org_id === orgId
        && row.campaign_id === campaignId
        && row.lead_id === leadId
        && row.enrichment_run_id === runId
      ));
    }),
    insertClaim: vi.fn(async (row) => {
      currentClaim = row;
      return row;
    }),
    updateClaim: vi.fn(async () => currentClaim),
    insertRun: vi.fn(async (row) => {
      operations.push("insertRun");
      if (input.runInsertError) throw input.runInsertError;
      runs.push(row);
      return row;
    }),
    insertSuggestions: vi.fn(async (rows) => {
      operations.push("insertSuggestions");
      suggestions.push(...rows);
      if (input.failAfterSuggestionInsert) throw new Error("suggestion insert failed");
    }),
    insertEvent: vi.fn(async (row) => {
      operations.push("insertEvent");
      events.push(row);
    }),
    deleteOwnedClaim: vi.fn(async (orgId, campaignId, leadId, claimId, tokenId, userId) => {
      operations.push("deleteOwnedClaim");
      if (
        !currentClaim
        || currentClaim.org_id !== orgId
        || currentClaim.campaign_id !== campaignId
        || currentClaim.lead_id !== leadId
        || currentClaim.id !== claimId
        || currentClaim.token_id !== tokenId
        || currentClaim.user_id !== userId
      ) return false;
      currentClaim = null;
      return true;
    }),
  };
  const transactionMock = vi.fn();
  const transaction: CampaignEnrichmentLocalToolDependencies["store"]["transaction"] = async <T>(
    operation: (transaction: CampaignEnrichmentClaimTransaction) => Promise<T>,
  ) => {
    transactionMock(operation);
    const snapshot = {
      claim: structuredClone(currentClaim),
      runs: structuredClone(runs),
      suggestions: structuredClone(suggestions),
      events: structuredClone(events),
    };
    try {
      return await operation(tx);
    } catch (error) {
      currentClaim = snapshot.claim;
      runs.splice(0, runs.length, ...snapshot.runs);
      suggestions.splice(0, suggestions.length, ...snapshot.suggestions);
      events.splice(0, events.length, ...snapshot.events);
      throw error;
    }
  };
  const updateLead = vi.fn();
  const decideSuggestion = vi.fn();
  const supersedeDrafts = vi.fn();
  const callProvider = vi.fn();
  const deps: CampaignEnrichmentLocalToolDependencies = {
    now: () => now,
    randomUUID: () => generatedIds[sequence++] ?? `generated-${sequence}`,
    store: {
      listQueueRows: async () => [],
      loadItem: async () => null,
      transaction,
    },
  };

  return {
    ...deps,
    store: { ...deps.store, transaction },
    transactionMock,
    tx,
    runs,
    suggestions,
    events,
    operations,
    updateLead,
    decideSuggestion,
    supersedeDrafts,
    callProvider,
    currentClaim: () => currentClaim,
  };
}

describe("campaign enrichment local-tool proposal intake", () => {
  it("creates pending cited suggestions and releases the claim without mutating the lead", async () => {
    const deps = proposalDependencies();
    const beforeLead = structuredClone(lead({ id: "lead-1" }));

    const result = await submitCampaignEnrichmentProposal(principal, "lead-1", validSubmission, deps);

    expect(result).toMatchObject({ created: true, run_id: "run-new" });
    expect(result.suggestions).toHaveLength(2);
    expect(deps.tx.insertRun).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
      source_kind: "codex_mcp",
      expected_lead_revision: validSubmission.expected_lead_revision,
      submitted_by_user_id: "user-a",
      local_tool_token_id: "token-a",
      client_metadata: validSubmission.client,
    }));
    expect(deps.tx.insertSuggestions).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        id: "suggestion-one",
        status: "pending",
        suggestion_type: "musical_fit",
        suggested_value: {
          value: "Warm, leftfield club music",
          rationale: "Recent programming includes compatible artists.",
        },
        evidence: validSubmission.proposals[0].evidence,
      }),
    ]));
    expect(deps.tx.insertEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "enrichment_proposals_submitted",
      actor_user_id: "user-a",
      details: {
        enrichment_run_id: "run-new",
        suggestion_ids: ["suggestion-one", "suggestion-two"],
        suggestion_count: 2,
      },
    }));
    expect(deps.tx.deleteOwnedClaim).toHaveBeenCalledTimes(1);
    expect(deps.operations).toEqual([
      "lockLead",
      "listAcceptedSuggestionIdentities",
      "findClaimForUpdate",
      "findRunByIdempotencyKeyForUpdate",
      "insertRun",
      "insertSuggestions",
      "insertEvent",
      "deleteOwnedClaim",
    ]);
    expect(deps.transactionMock).toHaveBeenCalledTimes(1);
    expect(lead({ id: "lead-1" })).toEqual(beforeLead);
    expect(deps.updateLead).not.toHaveBeenCalled();
    expect(deps.decideSuggestion).not.toHaveBeenCalled();
    expect(deps.supersedeDrafts).not.toHaveBeenCalled();
    expect(deps.callProvider).not.toHaveBeenCalled();
  });

  it("rejects stale revisions, expired or foreign claims, and cross-tenant leads before writing", async () => {
    const stale = proposalDependencies();
    await expect(submitCampaignEnrichmentProposal(principal, "lead-1", {
      ...validSubmission,
      expected_lead_revision: "f".repeat(64),
    }, stale)).rejects.toMatchObject({ code: "stale_revision" });

    for (const claim of [
      claimRow({ expires_at: now }),
      claimRow({ token_id: "token-b" }),
      claimRow({ user_id: "user-b" }),
    ]) {
      const deps = proposalDependencies({ claim });
      await expect(submitCampaignEnrichmentProposal(principal, "lead-1", validSubmission, deps))
        .rejects.toMatchObject({ code: "claim_conflict" });
      expect(deps.tx.insertRun).not.toHaveBeenCalled();
    }

    const crossTenant = proposalDependencies();
    await expect(submitCampaignEnrichmentProposal(
      { ...principal, orgId: "other-org" },
      "lead-1",
      validSubmission,
      crossTenant,
    )).rejects.toMatchObject({ code: "not_found" });
    expect(crossTenant.tx.insertRun).not.toHaveBeenCalled();
    expect(stale.tx.insertRun).not.toHaveBeenCalled();
  });

  it.each([
    ["uppercase revision", { ...validSubmission, expected_lead_revision: "A".repeat(64) }],
    ["bad revision", { ...validSubmission, expected_lead_revision: "bad" }],
    ["unsafe evidence", {
      ...validSubmission,
      proposals: [{ ...validSubmission.proposals[0], evidence: [{ ...validSubmission.proposals[0].evidence[0], url: "http://example.com" }] }],
    }],
    ["unsupported field", {
      ...validSubmission,
      proposals: [{ ...validSubmission.proposals[0], field: "stage" }],
    }],
    ["duplicate fields", {
      ...validSubmission,
      proposals: [validSubmission.proposals[0], { ...validSubmission.proposals[0] }],
    }],
    ["nine proposals", {
      ...validSubmission,
      proposals: Array.from({ length: 9 }, (_, index) => ({
        ...validSubmission.proposals[0],
        value: `Value ${index}`,
      })),
    }],
  ])("rejects %s during strict submission validation", async (_label, submission) => {
    const deps = proposalDependencies();

    await expect(submitCampaignEnrichmentProposal(
      principal,
      "lead-1",
      submission as CampaignEnrichmentProposalSubmission,
      deps,
    )).rejects.toThrow();

    expect(deps.transactionMock).not.toHaveBeenCalled();
  });

  it("returns the same safe result for an identical retry without requiring the released claim", async () => {
    const deps = proposalDependencies();

    const created = await submitCampaignEnrichmentProposal(principal, "lead-1", validSubmission, deps);
    const replayed = await submitCampaignEnrichmentProposal(principal, "lead-1", validSubmission, deps);

    expect(replayed).toEqual({ ...created, created: false });
    expect(deps.tx.insertRun).toHaveBeenCalledTimes(1);
    expect(deps.tx.insertSuggestions).toHaveBeenCalledTimes(1);
    expect(deps.tx.insertEvent).toHaveBeenCalledTimes(1);
    expect(deps.tx.deleteOwnedClaim).toHaveBeenCalledTimes(1);
  });

  it("refuses to replay an incomplete prior suggestion result", async () => {
    const deps = proposalDependencies();
    await submitCampaignEnrichmentProposal(principal, "lead-1", validSubmission, deps);
    deps.suggestions.pop();

    await expect(submitCampaignEnrichmentProposal(principal, "lead-1", validSubmission, deps))
      .rejects.toMatchObject({ code: "idempotency_conflict" });

    expect(deps.tx.insertRun).toHaveBeenCalledTimes(1);
  });

  it("fails closed on an extra malformed prior suggestion row before narrowing", async () => {
    const deps = proposalDependencies();
    await submitCampaignEnrichmentProposal(principal, "lead-1", validSubmission, deps);
    const malformedRows = [
      ...deps.suggestions,
      {
        ...deps.suggestions[0],
        id: "suggestion-corrupt",
        suggestion_type: "unsupported_field",
      },
    ];

    expect(() => validateCampaignEnrichmentProposalSuggestionRows(malformedRows))
      .toThrow(expect.objectContaining({ code: "idempotency_conflict" }));
  });

  it("maps a concurrent idempotency-key insert collision to the fixed conflict", async () => {
    const deps = proposalDependencies({
      runInsertError: Object.assign(new Error("private unique detail"), {
        code: "23505",
        constraint: "campaign_enrichment_runs_local_tool_idempotency_unique_idx",
      }),
    });

    await expect(submitCampaignEnrichmentProposal(principal, "lead-1", validSubmission, deps))
      .rejects.toMatchObject({ code: "idempotency_conflict" });

    expect(deps.runs).toEqual([]);
    expect(deps.suggestions).toEqual([]);
    expect(deps.currentClaim()).toEqual(claimRow());
  });

  it.each([
    ["different token", principalB, "lead-1", validSubmission],
    ["different lead", principal, "lead-2", validSubmission],
    ["different payload", principal, "lead-1", {
      ...validSubmission,
      proposals: [{ ...validSubmission.proposals[0], rationale: "A different rationale." }],
    }],
  ])("rejects an idempotency key reused by a %s", async (_label, actor, itemId, submission) => {
    const deps = proposalDependencies();
    await submitCampaignEnrichmentProposal(principal, "lead-1", validSubmission, deps);

    await expect(submitCampaignEnrichmentProposal(
      actor,
      itemId,
      submission,
      deps,
    )).rejects.toMatchObject({ code: "idempotency_conflict" });

    expect(deps.tx.insertRun).toHaveBeenCalledTimes(1);
    expect(deps.suggestions).toHaveLength(2);
  });

  it("rejects an idempotency key replayed against a missing lead", async () => {
    const deps = proposalDependencies();
    await submitCampaignEnrichmentProposal(principal, "lead-1", validSubmission, deps);

    await expect(submitCampaignEnrichmentProposal(
      principal,
      "missing-lead",
      validSubmission,
      deps,
    )).rejects.toMatchObject({ code: "idempotency_conflict" });

    expect(deps.tx.insertRun).toHaveBeenCalledTimes(1);
    expect(deps.suggestions).toHaveLength(2);
  });

  it("rolls back the run, suggestions, event, and claim release when suggestion insertion fails", async () => {
    const deps = proposalDependencies({ failAfterSuggestionInsert: true });

    await expect(submitCampaignEnrichmentProposal(principal, "lead-1", validSubmission, deps))
      .rejects.toThrow("suggestion insert failed");

    expect(deps.runs).toEqual([]);
    expect(deps.suggestions).toEqual([]);
    expect(deps.events).toEqual([]);
    expect(deps.currentClaim()).toEqual(claimRow());
    expect(deps.tx.insertEvent).not.toHaveBeenCalled();
    expect(deps.tx.deleteOwnedClaim).not.toHaveBeenCalled();
  });
});
