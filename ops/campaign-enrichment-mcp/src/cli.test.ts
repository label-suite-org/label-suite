import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { LOCAL_TOOL_API_VERSION } from "../../../src/lib/campaign-enrichment-local-tool-contract";
import { LocalToolClientError } from "./client";
import { runCli } from "./cli";
import { KeychainCredentialError } from "./keychain";

const execFileAsync = promisify(execFile);

const revision = "a".repeat(64);
const rawToken = `lsmcp_token-1_${"A".repeat(43)}`;
const proposal = {
  claim_id: "claim-1",
  expected_lead_revision: revision,
  idempotency_key: "d76af5f9-9568-4ab5-b896-e5b0db67be14",
  proposals: [{
    field: "musical_fit",
    value: "Fits the leftfield electronic brief.",
    rationale: "The programme consistently selects adjacent artists.",
    evidence: [{
      title: "Night Shift programme",
      url: "https://example.com/night-shift",
      retrieved_at: "2026-08-10T12:00:00.000Z",
      citation_text: "Recent episodes feature adjacent electronic artists.",
    }],
  }],
  client: { name: "label-suite-codex", version: "0.1.0", session_label: null },
};

function envelope(data: unknown, requestId = "request-1") {
  return { version: LOCAL_TOOL_API_VERSION, request_id: requestId, data };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const output: string[] = [];
  const errors: string[] = [];
  const credentials = {
    login: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue("lsmcp_secret"),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  const client = {
    listQueue: vi.fn().mockResolvedValue(envelope({ items: [] })),
    getItem: vi.fn().mockResolvedValue(envelope({
      item_id: "lead-1",
      target_name: "Night Shift",
      campaign_name: "Fountain",
      lead_revision: revision,
      missing_enrichment_fields: ["musical_fit"],
    })),
    claimItem: vi.fn().mockResolvedValue(envelope({
      id: "claim-1",
      lead_id: "lead-1",
      claimed_at: "2026-08-10T12:00:00.000Z",
      renewed_at: null,
      expires_at: "2026-08-10T12:20:00.000Z",
    })),
    submitProposal: vi.fn().mockResolvedValue(envelope({
      run_id: "run-1",
      suggestions: [{ id: "suggestion-1", suggestion_type: "musical_fit" }],
    })),
    releaseItem: vi.fn().mockResolvedValue(envelope({ released: true })),
  };
  const createClient = vi.fn().mockReturnValue(client);
  return {
    output,
    errors,
    credentials,
    client,
    createClient,
    supplied: {
      credentials,
      createClient,
      readFile: vi.fn().mockResolvedValue(JSON.stringify(proposal)),
      write: (line: string) => output.push(line),
      writeError: (line: string) => errors.push(line),
      ...overrides,
    },
  };
}

describe("runCli auth", () => {
  it("supports only login, status, and logout through the interactive Keychain store", async () => {
    const deps = dependencies();
    const baseArgs = ["--base-url", "https://suite.truenature.online"];

    await expect(runCli(["auth", "login", ...baseArgs], deps.supplied)).resolves.toBe(0);
    await expect(runCli(["auth", "status", ...baseArgs], deps.supplied)).resolves.toBe(0);
    await expect(runCli(["auth", "logout", ...baseArgs], deps.supplied)).resolves.toBe(0);

    expect(deps.credentials.login).toHaveBeenCalledWith("https://suite.truenature.online");
    expect(deps.credentials.read).toHaveBeenCalledWith("https://suite.truenature.online");
    expect(deps.credentials.logout).toHaveBeenCalledWith("https://suite.truenature.online");
    expect(deps.output).toEqual([
      "Credential stored in macOS Keychain for https://suite.truenature.online.",
      "Authenticated for https://suite.truenature.online.",
      "Credential removed from macOS Keychain for https://suite.truenature.online.",
    ]);
    expect(JSON.stringify([deps.output, deps.errors])).not.toContain("lsmcp_secret");
    expect(deps.createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["credential_not_found", 3, "No credential in macOS Keychain for https://suite.truenature.online."],
    ["keychain_unavailable", 5, "macOS Keychain unavailable."],
  ] as const)("maps %s without printing raw Keychain details", async (code, exitCode, message) => {
    const deps = dependencies();
    deps.credentials.read.mockRejectedValueOnce(Object.assign(new KeychainCredentialError(code), {
      raw: "lsmcp_secret",
    }));

    const exit = await runCli([
      "auth",
      "status",
      "--base-url",
      "https://suite.truenature.online",
    ], deps.supplied);

    expect(exit).toBe(exitCode);
    expect(deps.errors).toEqual([message]);
    expect(JSON.stringify([deps.output, deps.errors])).not.toContain("lsmcp_secret");
  });
});

describe("runCli enrich", () => {
  it("uses the documented list command with a default limit of 20", async () => {
    const deps = dependencies();

    const exit = await runCli([
      "enrich",
      "list",
      "--campaign",
      "campaign-1",
      "--json",
    ], deps.supplied);

    expect(exit).toBe(0);
    expect(deps.client.listQueue).toHaveBeenCalledWith({ campaign_id: "campaign-1", limit: 20 });
    expect(deps.output).toEqual([JSON.stringify(envelope({ items: [] }))]);
  });

  it("preserves an explicit valid list limit", async () => {
    const deps = dependencies();

    const exit = await runCli([
      "enrich",
      "list",
      "--campaign",
      "campaign-1",
      "--limit",
      "7",
    ], deps.supplied);

    expect(exit).toBe(0);
    expect(deps.client.listQueue).toHaveBeenCalledWith({ campaign_id: "campaign-1", limit: 7 });
  });

  it("dispatches show, claim, and release with concise human output", async () => {
    const deps = dependencies();

    await expect(runCli(["enrich", "show", "lead-1"], deps.supplied)).resolves.toBe(0);
    await expect(runCli([
      "enrich",
      "claim",
      "lead-1",
      "--revision",
      revision,
    ], deps.supplied)).resolves.toBe(0);
    await expect(runCli([
      "enrich",
      "release",
      "lead-1",
      "--claim",
      "claim-1",
    ], deps.supplied)).resolves.toBe(0);

    expect(deps.client.getItem).toHaveBeenCalledWith("lead-1");
    expect(deps.client.claimItem).toHaveBeenCalledWith("lead-1", { expected_lead_revision: revision });
    expect(deps.client.releaseItem).toHaveBeenCalledWith("lead-1", "claim-1");
    expect(deps.output).toEqual([
      "lead-1 — Night Shift — Fountain — missing: musical_fit",
      "Claim claim-1 active until 2026-08-10T12:20:00.000Z.",
      "Claim released.",
    ]);
  });

  it("renders untrusted human fields as one terminal-safe line and redacts token material", async () => {
    const deps = dependencies();
    deps.client.getItem.mockResolvedValueOnce(envelope({
      item_id: "lead-1\nforged",
      target_name: "Night\u001b[31m Shift\nForged",
      campaign_name: `Fountain\rOverwrite ${rawToken}`,
      lead_revision: revision,
      missing_enrichment_fields: ["musical_fit"],
    }));

    const exit = await runCli(["enrich", "show", "lead-1"], deps.supplied);

    expect(exit).toBe(0);
    expect(deps.output).toEqual([
      "lead-1 forged — Night Shift Forged — Fountain Overwrite [REDACTED] — missing: musical_fit",
    ]);
    expect(deps.output[0]).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
    expect(deps.output[0]).not.toContain(rawToken);
  });

  it("keeps JSON output terminal-safe, valid, and free of reflected token material", async () => {
    const deps = dependencies();
    deps.client.listQueue.mockResolvedValueOnce(envelope({
      items: [{
        item_id: "lead-1",
        target_name: "Night\u009b31mShift\u2028Forged",
        campaign_name: rawToken,
        missing_enrichment_fields: ["musical_fit"],
      }],
    }));

    const exit = await runCli([
      "enrich",
      "list",
      "--campaign",
      "campaign-1",
      "--limit",
      "20",
      "--json",
    ], deps.supplied);

    expect(exit).toBe(0);
    expect(deps.output).toHaveLength(1);
    expect(deps.output[0]).not.toContain(rawToken);
    expect(deps.output[0]).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
    expect(JSON.parse(deps.output[0])).toMatchObject({
      version: LOCAL_TOOL_API_VERSION,
      data: { items: [{ campaign_name: "[REDACTED]" }] },
    });
  });

  it("validates a proposal file before creating a client or reaching the network", async () => {
    const deps = dependencies({ readFile: vi.fn().mockResolvedValue("{\"accepted\":true}") });

    const exit = await runCli([
      "enrich",
      "propose",
      "lead-1",
      "--file",
      "proposal.json",
    ], deps.supplied);

    expect(exit).toBe(2);
    expect(deps.createClient).not.toHaveBeenCalled();
    expect(deps.client.submitProposal).not.toHaveBeenCalled();
    expect(deps.errors).toEqual(["Invalid proposal file."]);
  });

  it("rejects canonically duplicate evidence before creating a client", async () => {
    const duplicateEvidence = {
      ...proposal,
      proposals: [{
        ...proposal.proposals[0],
        evidence: [proposal.proposals[0].evidence[0], {
          ...proposal.proposals[0].evidence[0],
          title: " night shift   PROGRAMME ",
          url: "https://EXAMPLE.com:443/night-shift",
          retrieved_at: "2026-08-10T14:00:00.000+02:00",
          citation_text: " recent episodes feature  adjacent electronic artists. ",
        }],
      }],
    };
    const deps = dependencies({ readFile: vi.fn().mockResolvedValue(JSON.stringify(duplicateEvidence)) });

    const exit = await runCli(["enrich", "propose", "lead-1", "--file", "proposal.json"], deps.supplied);

    expect(exit).toBe(2);
    expect(deps.createClient).not.toHaveBeenCalled();
    expect(deps.client.submitProposal).not.toHaveBeenCalled();
    expect(deps.errors).toEqual(["Invalid proposal file."]);
  });

  it("submits a validated proposal file and never includes it in human output", async () => {
    const deps = dependencies();

    const exit = await runCli([
      "enrich",
      "propose",
      "lead-1",
      "--file",
      "proposal.json",
    ], deps.supplied);

    expect(exit).toBe(0);
    expect(deps.client.submitProposal).toHaveBeenCalledWith("lead-1", proposal);
    expect(deps.output).toEqual(["Proposal run run-1 submitted with 1 suggestion."]);
    expect(deps.output.join("\n")).not.toContain("Recent episodes");
  });

  it.each([
    ["authentication_failed", 3],
    ["scope_forbidden", 3],
    ["stale_revision", 4],
    ["claim_conflict", 4],
    ["idempotency_conflict", 4],
    ["invalid_request", 2],
    ["not_found", 2],
    ["service_unavailable", 5],
    ["internal_error", 5],
  ] as const)("maps %s to stable exit code %i", async (code, exitCode) => {
    const deps = dependencies();
    deps.client.listQueue.mockRejectedValueOnce(new LocalToolClientError(code, "request-safe"));

    const exit = await runCli([
      "enrich",
      "list",
      "--campaign",
      "campaign-1",
      "--limit",
      "20",
    ], deps.supplied);

    expect(exit).toBe(exitCode);
    expect(deps.errors).toHaveLength(1);
    expect(deps.errors[0]).toContain("Request ID: request-safe");
  });

  it("maps an unknown internal error to one fixed unavailable message and a safe request ID", async () => {
    const deps = dependencies();
    deps.client.listQueue.mockRejectedValueOnce({
      requestId: "request-safe",
      message: "Bearer lsmcp_secret raw transport trace",
    });

    const exit = await runCli([
      "enrich",
      "list",
      "--campaign",
      "campaign-1",
      "--limit",
      "20",
    ], deps.supplied);

    expect(exit).toBe(5);
    expect(deps.errors).toEqual(["Label Suite unavailable. Request ID: request-safe"]);
    expect(JSON.stringify([deps.output, deps.errors])).not.toContain("lsmcp_secret");
  });

  it.each([
    ["enrich", "accept", "suggestion-1"],
    ["enrich", "reject", "suggestion-1"],
    ["enrich", "publish", "lead-1"],
    ["enrich", "send", "lead-1"],
    ["enrich", "list", "--campaign", "campaign-1", "--limit", "51"],
    ["auth", "login"],
  ])("rejects unknown, mutation, incomplete, or invalid commands before composition: %s", async (...args) => {
    const deps = dependencies();

    const exit = await runCli(args, deps.supplied);

    expect(exit).toBe(2);
    expect(deps.createClient).not.toHaveBeenCalled();
    expect(deps.errors).toEqual(["Invalid command or input."]);
  });
});

describe("label-suite launcher", () => {
  it("runs through the checked-in executable and keeps diagnostics off stdout", async () => {
    const launcher = fileURLToPath(new URL("../bin/label-suite.mjs", import.meta.url));
    const result = await execFileAsync(launcher, ["enrich", "accept", "suggestion-1"], { cwd: tmpdir() })
      .then((success) => ({ ...success, code: 0 }))
      .catch((error: unknown) => {
        if (!error || typeof error !== "object") throw error;
        return error as { code: number; stdout: string; stderr: string };
      });

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("Invalid command or input.");
  });
});
