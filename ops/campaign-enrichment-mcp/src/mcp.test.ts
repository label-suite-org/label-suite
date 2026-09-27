import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { LOCAL_TOOL_API_VERSION } from "../../../src/lib/campaign-enrichment-local-tool-contract";
import { LocalToolClientError, type CampaignEnrichmentClient } from "./client";
import { createCampaignEnrichmentMcpServer } from "./mcp";

const revision = "a".repeat(64);
const TEST_DEPENDENCIES_SYMBOL = "label-suite.campaign-enrichment-mcp.test-dependencies";

function envelope(data: unknown, requestId = "request-1") {
  return { version: LOCAL_TOOL_API_VERSION, request_id: requestId, data };
}

function fakeClient(overrides: Record<string, unknown> = {}): CampaignEnrichmentClient {
  return {
    listQueue: vi.fn().mockResolvedValue(envelope({ items: [] })),
    getItem: vi.fn().mockResolvedValue(envelope({ item_id: "lead-1" })),
    claimItem: vi.fn().mockResolvedValue(envelope({ id: "claim-1" })),
    submitProposal: vi.fn().mockResolvedValue(envelope({ run_id: "run-1" })),
    releaseItem: vi.fn().mockResolvedValue(envelope({ released: true })),
    getHealth: vi.fn().mockResolvedValue({
      status: "ok",
      web: "ok",
      database: "ok",
      worker: "ok",
      application: { status: "ok" },
      analytics: { status: "ok", freshness: "current", coverage: "complete" },
      revision: "b".repeat(40),
    }),
    getJobsHealth: vi.fn().mockResolvedValue(envelope({ queued: 0 })),
    getOperationsBrief: vi.fn().mockResolvedValue(envelope({
      resource_type: "release",
      record: { id: "release-1" },
    })),
    ...overrides,
  } as unknown as CampaignEnrichmentClient;
}

async function protocolClient(server: ReturnType<typeof createCampaignEnrichmentMcpServer>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  let nextId = 1;
  const pending = new Map<number, (message: JSONRPCMessage) => void>();
  clientTransport.onmessage = (message) => {
    if ("id" in message && typeof message.id === "number") {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  };
  await clientTransport.start();
  await server.connect(serverTransport);

  async function request(method: string, params: Record<string, unknown>) {
    const id = nextId++;
    const response = new Promise<JSONRPCMessage>((resolve) => pending.set(id, resolve));
    await clientTransport.send({ jsonrpc: "2.0", id, method, params } as JSONRPCMessage);
    return await response;
  }

  await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "campaign-enrichment-test", version: "0.1.0" },
  });
  await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });

  return {
    listTools: async () => {
      const response = await request("tools/list", {});
      if (!("result" in response)) throw new Error("Expected a tools list result");
      return (response.result as { tools: Array<{ name: string; description?: string }> }).tools;
    },
    callTool: async (name: string, args: Record<string, unknown>) => {
      const response = await request("tools/call", { name, arguments: args });
      if (!("result" in response)) throw new Error("Expected a tool result");
      return response.result as {
        content: Array<{ type: string; text?: string }>;
        structuredContent?: Record<string, unknown>;
        isError?: boolean;
      };
    },
    close: async () => await server.close(),
  };
}

async function runIndexOverStdio(
  input: string,
  options: { preload?: string; env?: NodeJS.ProcessEnv; args?: string[] } = {},
) {
  const indexPath = fileURLToPath(new URL("./index.ts", import.meta.url));
  return await new Promise<{ stdout: string; stderr: string; exitCode: number | null }>(
    (resolve, reject) => {
      const preloadArgs = options.preload === undefined ? [] : ["--import", options.preload];
      const child = spawn(process.execPath, [
        "--import",
        "tsx",
        ...preloadArgs,
        indexPath,
        ...(options.args ?? ["mcp", "serve"]),
      ], {
        cwd: process.cwd(),
        env: { ...process.env, ...options.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("MCP stdio process timed out"));
      }, 5_000);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        resolve({ stdout, stderr, exitCode });
      });
      child.stdin.end(input);
    },
  );
}

async function fakeClientPreload(result: object, privateToken: string, expectedBaseUrl?: string) {
  const directory = await mkdtemp(join(tmpdir(), "label-suite-mcp-test-"));
  const path = join(directory, "fake-client-preload.mjs");
  await writeFile(path, `
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";

childProcess.spawn = () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  queueMicrotask(() => child.emit("close", 44, null));
  return child;
};
syncBuiltinESMExports();

const privateToken = ${JSON.stringify(privateToken)};
const result = ${JSON.stringify(result)};
const expectedBaseUrl = ${JSON.stringify(expectedBaseUrl)};
globalThis[Symbol.for(${JSON.stringify(TEST_DEPENDENCIES_SYMBOL)})] = {
  createClient: (options) => {
    if (expectedBaseUrl !== undefined && options.baseUrl !== expectedBaseUrl) {
      throw new Error("Unexpected MCP base URL");
    }
    return ({
    listQueue: async () => {
      void privateToken;
      return result;
    },
    getItem: async () => result,
    claimItem: async () => result,
    submitProposal: async () => result,
    releaseItem: async () => result,
    getHealth: async () => result,
    getJobsHealth: async () => result,
    getOperationsBrief: async () => result,
    });
  },
};
`, "utf8");
  return {
    path,
    cleanup: async () => await rm(directory, { recursive: true, force: true }),
  };
}

describe("campaign enrichment MCP", () => {
  it("accepts the documented MCP command with one validated HTTPS base URL", async () => {
    const expected = envelope({ items: [] }, "spawned-base-url-request");
    const preload = await fakeClientPreload(expected, "private", "https://suite.truenature.online");

    try {
      const result = await runIndexOverStdio("", {
        preload: preload.path,
        env: { NODE_ENV: "test", VITEST: "true" },
        args: ["mcp", "serve", "--base-url", "https://suite.truenature.online"],
      });

      expect(result).toMatchObject({ exitCode: 0, stdout: "" });
      expect(result.stderr).toContain("Label Suite operator MCP server ready on stdio.");
    } finally {
      await preload.cleanup();
    }
  });

  it.each([
    ["mcp", "serve", "--base-url", "http://example.com"],
    ["mcp", "serve", "--base-url", "https://suite.truenature.online", "--base-url", "https://example.com"],
    ["mcp", "serve", "--unknown", "value"],
  ])("rejects malformed, duplicate, or unknown MCP arguments: %s", async (...args) => {
    const result = await runIndexOverStdio("", { args });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("Invalid command or input.");
  });

  it("registers the existing proposal tools plus three bounded diagnostics", async () => {
    const protocol = await protocolClient(createCampaignEnrichmentMcpServer(fakeClient()));

    expect((await protocol.listTools()).map((tool) => tool.name)).toEqual([
      "list_enrichment_queue",
      "get_enrichment_item",
      "claim_enrichment_item",
      "submit_enrichment_proposal",
      "release_enrichment_item",
      "label_suite_health",
      "label_suite_jobs_health",
      "label_suite_operations_brief",
    ]);
    await protocol.close();
  });

  it("does not expose acceptance or campaign mutation language", async () => {
    const protocol = await protocolClient(createCampaignEnrichmentMcpServer(fakeClient()));
    const manifest = await protocol.listTools();

    expect(JSON.stringify(manifest)).not.toMatch(
      /accept_suggestion|publish|send_email|change_stage/,
    );
    await protocol.close();
  });

  it("dispatches each strict tool input to the matching reviewed client method", async () => {
    const client = fakeClient();
    const protocol = await protocolClient(createCampaignEnrichmentMcpServer(client));
    const proposal = {
      claim_id: "claim-1",
      expected_lead_revision: revision,
      idempotency_key: "d76af5f9-9568-4ab5-b896-e5b0db67be14",
      proposals: [{
        field: "musical_fit",
        value: "Fits the brief.",
        rationale: "Adjacent programming.",
        evidence: [{
          title: "Programme archive",
          url: "https://example.com/archive",
          retrieved_at: "2026-08-10T12:00:00.000Z",
          citation_text: "Recent episodes support the fit.",
        }],
      }],
      client: { name: "label-suite-codex", version: "0.1.0", session_label: null },
    };

    await protocol.callTool("list_enrichment_queue", { campaign_id: "campaign-1", limit: 10 });
    await protocol.callTool("get_enrichment_item", { item_id: "lead-1" });
    await protocol.callTool("claim_enrichment_item", {
      item_id: "lead-1",
      expected_lead_revision: revision,
    });
    await protocol.callTool("submit_enrichment_proposal", { item_id: "lead-1", ...proposal });
    await protocol.callTool("release_enrichment_item", { item_id: "lead-1", claim_id: "claim-1" });
    await protocol.callTool("label_suite_health", {});
    await protocol.callTool("label_suite_jobs_health", {});
    await protocol.callTool("label_suite_operations_brief", {
      resource_type: "release",
      resource_id: "release-1",
    });

    expect(client.listQueue).toHaveBeenCalledWith({ campaign_id: "campaign-1", state: "all", limit: 10 });
    expect(client.getItem).toHaveBeenCalledWith("lead-1");
    expect(client.claimItem).toHaveBeenCalledWith("lead-1", {
      expected_lead_revision: revision,
      lease_minutes: 20,
    });
    expect(client.submitProposal).toHaveBeenCalledWith("lead-1", proposal);
    expect(client.releaseItem).toHaveBeenCalledWith("lead-1", "claim-1");
    expect(client.getHealth).toHaveBeenCalledWith();
    expect(client.getJobsHealth).toHaveBeenCalledWith();
    expect(client.getOperationsBrief).toHaveBeenCalledWith({
      resource_type: "release",
      resource_id: "release-1",
    });

    await protocol.close();
  });

  it("returns the validated client envelope as structured content and compact JSON text", async () => {
    const expected = envelope({ items: [] });
    const protocol = await protocolClient(createCampaignEnrichmentMcpServer(fakeClient()));

    const result = await protocol.callTool("list_enrichment_queue", {});

    expect(result).toMatchObject({
      structuredContent: expected,
      content: [{ type: "text", text: JSON.stringify(expected) }],
    });
    await protocol.close();
  });

  it("maps known client failures to fixed safe tool errors", async () => {
    const client = fakeClient({
      listQueue: vi.fn().mockRejectedValue(new LocalToolClientError(
        "claim_conflict",
        "request-safe",
        { expires_at: "2026-08-10T12:20:00.000Z" },
      )),
    });
    const protocol = await protocolClient(createCampaignEnrichmentMcpServer(client));

    const result = await protocol.callTool("list_enrichment_queue", {});

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: {
        code: "claim_conflict",
        message: "Resource is already claimed",
        retryable: true,
        request_id: "request-safe",
        details: { expires_at: "2026-08-10T12:20:00.000Z" },
      },
    });
    expect(result.content).toEqual([{
      type: "text",
      text: JSON.stringify(result.structuredContent),
    }]);
    await protocol.close();
  });

  it("suppresses unknown request IDs from structured and text errors", async () => {
    const rawToken = `lsmcp_token-1_${"A".repeat(43)}`;
    const client = fakeClient({
      listQueue: vi.fn().mockRejectedValue(Object.assign(
        new Error(`Bearer ${rawToken} raw provider response`),
        { requestId: rawToken },
      )),
    });
    const protocol = await protocolClient(createCampaignEnrichmentMcpServer(client));

    const result = await protocol.callTool("list_enrichment_queue", {});
    const serialized = JSON.stringify(result);

    const expected = {
      error: {
        code: "service_unavailable",
        message: "Label Suite unavailable.",
        retryable: true,
      },
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(expected);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(expected) }]);
    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain("provider response");
    await protocol.close();
  });

  it("rejects unknown input fields before calling the client", async () => {
    const client = fakeClient();
    const protocol = await protocolClient(createCampaignEnrichmentMcpServer(client));

    const result = await protocol.callTool("get_enrichment_item", {
      item_id: "lead-1",
      change_stage: "contacted",
    });

    expect(result.isError).toBe(true);
    expect(client.getItem).not.toHaveBeenCalled();
    await protocol.close();
  });

  it("rejects canonically duplicate evidence before calling the client", async () => {
    const client = fakeClient();
    const protocol = await protocolClient(createCampaignEnrichmentMcpServer(client));
    const evidence = {
      title: "Programme archive",
      url: "https://example.com/archive",
      retrieved_at: "2026-08-10T12:00:00.000Z",
      citation_text: "Recent episodes support the fit.",
    };

    const result = await protocol.callTool("submit_enrichment_proposal", {
      item_id: "lead-1",
      claim_id: "claim-1",
      expected_lead_revision: revision,
      idempotency_key: "d76af5f9-9568-4ab5-b896-e5b0db67be14",
      proposals: [{
        field: "musical_fit",
        value: "Fits the brief.",
        rationale: "Adjacent programming.",
        evidence: [evidence, {
          title: " programme  ARCHIVE ",
          url: "https://EXAMPLE.com:443/archive",
          retrieved_at: "2026-08-10T14:00:00.000+02:00",
          citation_text: " recent episodes support  the fit. ",
        }],
      }],
      client: { name: "label-suite-codex", version: "0.1.0", session_label: null },
    });

    expect(result.isError).toBe(true);
    expect(client.submitProposal).not.toHaveBeenCalled();
    await protocol.close();
  });

  it("serves list and call protocol frames on stdout while keeping diagnostics on stderr", async () => {
    const frames = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "stdio-test", version: "0.1.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "get_enrichment_item",
          arguments: { item_id: "lead-1", change_stage: "contacted" },
        },
      },
    ].map((frame) => JSON.stringify(frame)).join("\n") + "\n";

    const result = await runIndexOverStdio(frames);
    const messages = result.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const listResponse = messages.find((message) => message.id === 2);
    const callResponse = messages.find((message) => message.id === 3);

    expect(result.exitCode).toBe(0);
    expect(listResponse.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "list_enrichment_queue",
      "get_enrichment_item",
      "claim_enrichment_item",
      "submit_enrichment_proposal",
      "release_enrichment_item",
      "label_suite_health",
      "label_suite_jobs_health",
      "label_suite_operations_brief",
    ]);
    expect(callResponse.result.isError).toBe(true);
    expect(result.stderr).toContain("Label Suite operator MCP server ready on stdio.");
  });

  it("uses an explicit test-only fake client for a successful spawned stdio call", async () => {
    const rawToken = `lsmcp_token-1_${"B".repeat(43)}`;
    const expected = envelope({ items: [] }, "spawned-request-1");
    const preload = await fakeClientPreload(expected, rawToken);
    const frames = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "spawned-success-test", version: "0.1.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "list_enrichment_queue", arguments: {} },
      },
    ].map((frame) => JSON.stringify(frame)).join("\n") + "\n";

    try {
      const result = await runIndexOverStdio(frames, {
        preload: preload.path,
        env: { NODE_ENV: "test", VITEST: "true" },
      });
      const messages = result.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const callResponse = messages.find((message) => message.id === 2);

      expect(result.exitCode).toBe(0);
      expect(callResponse.result.structuredContent).toEqual(expected);
      expect(callResponse.result.content).toEqual([
        { type: "text", text: JSON.stringify(expected) },
      ]);
      expect(result.stderr).toContain("Label Suite operator MCP server ready on stdio.");
      expect(result.stdout).not.toContain(rawToken);
      expect(result.stderr).not.toContain(rawToken);
    } finally {
      await preload.cleanup();
    }
  });

  it("negotiates the current 2026-07-28 stdio protocol through the official server entry", async () => {
    const envelopeMeta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "modern-stdio-test", version: "0.1.0" },
      "io.modelcontextprotocol/clientCapabilities": {},
    };
    const frames = [
      { jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: envelopeMeta } },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: envelopeMeta } },
    ].map((frame) => JSON.stringify(frame)).join("\n") + "\n";

    const result = await runIndexOverStdio(frames);
    const messages = result.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

    expect(messages.find((message) => message.id === 1).result.supportedVersions).toEqual([
      "2026-07-28",
    ]);
    expect(messages.find((message) => message.id === 2).result.tools).toHaveLength(8);
    expect(result.exitCode).toBe(0);
  });
});
