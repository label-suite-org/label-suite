import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { LOCAL_TOOL_SCOPES } from "../lib/campaign-enrichment-local-tool-contract";
import {
  authenticateLocalToolRequest,
  createLocalToolToken,
  listLocalToolTokens,
  revokeLocalToolToken,
  runAuthenticatedLocalToolRequest,
  type LocalToolTokenDependencies,
  type LocalToolTokenRow,
} from "./local-tool-tokens";

const NOW = new Date("2026-08-10T12:00:00.000Z");
const RAW_TOKEN = "lsmcp_token-1_AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";

function tokenRow(overrides: Partial<LocalToolTokenRow> = {}): LocalToolTokenRow {
  return {
    id: "token-1",
    org_id: "org-1",
    user_id: "user-1",
    name: "Malthe MacBook",
    token_prefix: "lsmcp_token-1",
    secret_hash: createHash("sha256").update(RAW_TOKEN).digest("hex"),
    scopes: [...LOCAL_TOOL_SCOPES],
    expires_at: new Date("2026-09-09T12:00:00.000Z"),
    revoked_at: null,
    last_used_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeDependencies(initialRows: LocalToolTokenRow[] = []) {
  const rows = initialRows.map((row) => ({ ...row, scopes: [...row.scopes] }));
  const memberships = new Map([["org-1:user-1", "operator"]]);
  let activeDatabaseContext: {
    userId: string;
    orgId?: string;
    localToolTokenId?: string;
  } | undefined;
  const databaseContexts: Array<NonNullable<typeof activeDatabaseContext>> = [];
  const dependencies: LocalToolTokenDependencies = {
    now: () => NOW,
    randomUUID: () => "token-1",
    randomBytes: (size) => Buffer.alloc(size, 7),
    hasCapability: (role, capability) => capability === "operations.mutate" && (role === "owner" || role === "operator"),
    async runWithDatabaseContext(context, operation) {
      const previous = activeDatabaseContext;
      activeDatabaseContext = context;
      databaseContexts.push(context);
      try {
        return await operation();
      } finally {
        activeDatabaseContext = previous;
      }
    },
    store: {
      async insert(row) {
        rows.push({ ...row, scopes: [...row.scopes] });
        return row;
      },
      async list(orgId) {
        return rows.filter((row) => row.org_id === orgId);
      },
      async findById(id) {
        return rows.find((row) => row.id === id) ?? null;
      },
      async findMembership(orgId, userId) {
        const role = memberships.get(`${orgId}:${userId}`);
        return role ? { role } : null;
      },
      async revoke(orgId, id, revokedAt) {
        const row = rows.find((candidate) => candidate.org_id === orgId && candidate.id === id);
        if (!row) return null;
        if (!row.revoked_at) {
          row.revoked_at = revokedAt;
          row.updated_at = revokedAt;
        }
        return row;
      },
      async touchLastUsed(orgId, id, usedAt) {
        const row = rows.find((candidate) => candidate.org_id === orgId && candidate.id === id);
        if (row) {
          row.last_used_at = usedAt;
          row.updated_at = usedAt;
        }
      },
    },
  };
  return {
    dependencies,
    rows,
    memberships,
    databaseContexts,
    activeDatabaseContext: () => activeDatabaseContext,
  };
}

function bearer(rawToken = RAW_TOKEN) {
  return new Request("https://labels.example/api/local-tools/campaign-enrichment/queue", {
    headers: { authorization: `Bearer ${rawToken}` },
  });
}

describe("local tool token lifecycle", () => {
  it("returns the plaintext token once and stores only its hash", async () => {
    const { dependencies, rows } = makeDependencies();

    const created = await createLocalToolToken("org-1", "user-1", {
      name: "Malthe MacBook",
      scopes: LOCAL_TOOL_SCOPES,
      expires_in_days: 30,
    }, dependencies);

    expect(created.token).toMatch(/^lsmcp_[a-zA-Z0-9_-]+_[a-zA-Z0-9_-]+$/);
    expect(rows[0]?.secret_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0]?.secret_hash).toBe(createHash("sha256").update(created.token).digest("hex"));
    expect(JSON.stringify(rows[0])).not.toContain(created.token);
    expect(created.record).not.toHaveProperty("secret_hash");
    expect(created.record.expires_at).toEqual(new Date("2026-09-09T12:00:00.000Z"));
  });

  it("defaults an omitted expiry to 30 days", async () => {
    const { dependencies } = makeDependencies();

    const created = await createLocalToolToken("org-1", "user-1", {
      name: "Malthe MacBook",
      scopes: LOCAL_TOOL_SCOPES,
    }, dependencies);

    expect(created.record.expires_at).toEqual(new Date("2026-09-09T12:00:00.000Z"));
  });

  it("lists only tenant records without hashes or plaintext secrets", async () => {
    const { dependencies } = makeDependencies([
      tokenRow(),
      tokenRow({ id: "other-token", org_id: "org-2", secret_hash: "f".repeat(64) }),
    ]);

    const records = await listLocalToolTokens("org-1", dependencies);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: "token-1", org_id: "org-1" });
    expect(JSON.stringify(records)).not.toContain("secret_hash");
    expect(JSON.stringify(records)).not.toContain("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE");
  });

  it("revokes within the tenant and returns the same safe record when repeated", async () => {
    const { dependencies } = makeDependencies([
      tokenRow(),
      tokenRow({ id: "other-token", org_id: "org-2", secret_hash: "f".repeat(64) }),
    ]);

    const first = await revokeLocalToolToken("org-1", "token-1", dependencies);
    const second = await revokeLocalToolToken("org-1", "token-1", dependencies);

    expect(first.revoked_at).toEqual(NOW);
    expect(second).toEqual(first);
    expect(first).not.toHaveProperty("secret_hash");
    await expect(revokeLocalToolToken("org-1", "other-token", dependencies))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe("local tool bearer authentication", () => {
  it("bootstraps only the presented token and retains verified tenant context for the complete operation", async () => {
    const state = makeDependencies([tokenRow()]);
    const originalFindById = state.dependencies.store.findById;
    const originalFindMembership = state.dependencies.store.findMembership;
    const originalTouchLastUsed = state.dependencies.store.touchLastUsed;
    state.dependencies.store.findById = async (id) => {
      expect(state.activeDatabaseContext()).toEqual({
        userId: "",
        localToolTokenId: "token-1",
      });
      return originalFindById(id);
    };
    state.dependencies.store.findMembership = async (orgId, userId) => {
      expect(state.activeDatabaseContext()).toEqual({ userId: "user-1" });
      return originalFindMembership(orgId, userId);
    };
    state.dependencies.store.touchLastUsed = async (orgId, id, usedAt) => {
      expect(state.activeDatabaseContext()).toEqual({ userId: "user-1", orgId: "org-1" });
      return originalTouchLastUsed(orgId, id, usedAt);
    };

    const result = await runAuthenticatedLocalToolRequest(
      bearer(),
      "campaign.enrichment.read",
      async (principal) => {
        expect(state.activeDatabaseContext()).toEqual({ userId: "user-1", orgId: "org-1" });
        return `${principal.orgId}:${principal.tokenId}`;
      },
      state.dependencies,
    );

    expect(result).toBe("org-1:token-1");
    expect(state.activeDatabaseContext()).toBeUndefined();
    expect(state.rows[0]?.last_used_at).toEqual(NOW);
  });

  it("never enters user or organization context for a bearer with the wrong secret", async () => {
    const state = makeDependencies([tokenRow()]);
    const operation = vi.fn();

    await expect(runAuthenticatedLocalToolRequest(
      bearer("lsmcp_token-1_AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI"),
      "campaign.enrichment.read",
      operation,
      state.dependencies,
    )).rejects.toMatchObject({ code: "authentication_failed" });

    expect(operation).not.toHaveBeenCalled();
    expect(state.databaseContexts).toEqual([{
      userId: "",
      localToolTokenId: "token-1",
    }]);
    expect(state.rows[0]?.last_used_at).toBeNull();
  });

  it("returns a tenant principal and updates last_used_at only after authentication succeeds", async () => {
    const row = tokenRow();
    const { dependencies, rows } = makeDependencies([row]);

    const principal = await authenticateLocalToolRequest(
      bearer(),
      "campaign.enrichment.read",
      dependencies,
    );

    expect(principal).toEqual({
      tokenId: "token-1",
      orgId: "org-1",
      userId: "user-1",
      scopes: LOCAL_TOOL_SCOPES,
    });
    expect(rows[0]?.last_used_at).toEqual(NOW);
  });

  it.each([
    ["missing header", new Request("https://labels.example/api/local-tools"), tokenRow()],
    ["malformed header", new Request("https://labels.example/api/local-tools", { headers: { authorization: "Basic abc" } }), tokenRow()],
    ["malformed token", bearer("not-a-token"), tokenRow()],
    ["unknown token", bearer("lsmcp_unknown_AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"), tokenRow()],
    ["hash mismatch", bearer("lsmcp_token-1_AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI"), tokenRow()],
    ["expired token", bearer(), tokenRow({ expires_at: NOW })],
    ["revoked token", bearer(), tokenRow({ revoked_at: new Date("2026-08-09T12:00:00.000Z") })],
  ])("rejects %s with the fixed non-leaking authentication category", async (_label, request, row) => {
    const { dependencies, rows } = makeDependencies([row]);

    await expect(authenticateLocalToolRequest(
      request,
      "campaign.enrichment.read",
      dependencies,
    )).rejects.toMatchObject({ code: "authentication_failed", message: "Authentication failed" });
    expect(rows[0]?.last_used_at).toBeNull();
  });

  it("rejects removed memberships and roles without operations.mutate", async () => {
    const removed = makeDependencies([tokenRow()]);
    removed.memberships.clear();
    const member = makeDependencies([tokenRow()]);
    member.memberships.set("org-1:user-1", "member");
    const unknownRole = makeDependencies([tokenRow()]);
    unknownRole.memberships.set("org-1:user-1", "legacy-admin");
    unknownRole.dependencies.hasCapability = () => {
      throw new Error("Capability lookup must not receive an unknown role");
    };

    await expect(authenticateLocalToolRequest(bearer(), "campaign.enrichment.read", removed.dependencies))
      .rejects.toMatchObject({ code: "authentication_failed", message: "Authentication failed" });
    await expect(authenticateLocalToolRequest(bearer(), "campaign.enrichment.read", member.dependencies))
      .rejects.toMatchObject({ code: "authentication_failed", message: "Authentication failed" });
    await expect(authenticateLocalToolRequest(bearer(), "campaign.enrichment.read", unknownRole.dependencies))
      .rejects.toMatchObject({ code: "authentication_failed", message: "Authentication failed" });
  });

  it("rejects a missing proposal-only scope without updating last_used_at", async () => {
    const { dependencies, rows } = makeDependencies([
      tokenRow({ scopes: ["campaign.enrichment.read"] }),
    ]);

    await expect(authenticateLocalToolRequest(
      bearer(),
      "campaign.enrichment.propose",
      dependencies,
    )).rejects.toMatchObject({ code: "scope_forbidden", message: "Required scope is not granted" });
    expect(rows[0]?.last_used_at).toBeNull();
  });

  it("audits an identified but unverified token without adopting its tenant identity", async () => {
    const { dependencies } = makeDependencies([tokenRow({ revoked_at: NOW })]);
    const record = vi.fn().mockResolvedValue(undefined);

    await expect(authenticateLocalToolRequest(
      bearer(),
      "campaign.enrichment.propose",
      dependencies,
      {
        requestId: "request-auth",
        tool: "submit_enrichment_proposal",
        startedAt: NOW.getTime() - 7,
        record,
      },
    )).rejects.toMatchObject({ code: "authentication_failed" });

    expect(record).toHaveBeenCalledWith({
      requestId: "request-auth",
      tokenId: "token-1",
      tool: "submit_enrichment_proposal",
      operation: "authenticate",
      resultCategory: "authentication_failed",
      durationMs: 7,
      proposalCount: 0,
    });
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/Bearer|secret_hash|AQEBAQ|raw error/i);
  });

  it("emits bounded telemetry for an unresolved authentication failure", async () => {
    const { dependencies } = makeDependencies([tokenRow()]);
    const record = vi.fn().mockResolvedValue(undefined);

    await expect(authenticateLocalToolRequest(
      new Request("https://labels.example/api/local-tools"),
      "campaign.enrichment.read",
      dependencies,
      {
        requestId: "request-unresolved",
        tool: "list_enrichment_queue",
        startedAt: NOW.getTime(),
        record,
      },
    )).rejects.toMatchObject({ code: "authentication_failed" });

    expect(record).toHaveBeenCalledWith({
      requestId: "request-unresolved",
      tool: "list_enrichment_queue",
      operation: "authenticate",
      resultCategory: "authentication_failed",
      durationMs: 0,
      proposalCount: 0,
    });
  });

  it("audits an unexpected authentication dependency failure as internal without raw detail", async () => {
    const { dependencies } = makeDependencies([tokenRow()]);
    dependencies.store.findById = async () => {
      throw new Error("Bearer lsmcp_private database stack");
    };
    const record = vi.fn().mockResolvedValue(undefined);

    await expect(authenticateLocalToolRequest(
      bearer(),
      "campaign.enrichment.read",
      dependencies,
      {
        requestId: "request-internal",
        tool: "list_enrichment_queue",
        startedAt: NOW.getTime(),
        record,
      },
    )).rejects.toThrow();

    expect(record).toHaveBeenCalledWith({
      requestId: "request-internal",
      tokenId: "token-1",
      tool: "list_enrichment_queue",
      operation: "authenticate",
      resultCategory: "internal_error",
      durationMs: 0,
      proposalCount: 0,
    });
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/lsmcp_private|database stack/i);
  });
});
