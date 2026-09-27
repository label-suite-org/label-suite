import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import {
  campaignEnrichmentClaimRequestSchema,
  campaignEnrichmentProposalSubmissionSchema,
  campaignEnrichmentQueueQuerySchema,
  campaignEnrichmentReleaseRequestSchema,
} from "../../../src/lib/campaign-enrichment-local-tool-contract";
import { operatorOperationsBriefInputSchema } from "../../../src/lib/operator-diagnostics-contract";
import {
  LocalToolClientError,
  type CampaignEnrichmentClient,
} from "./client";

const itemIdSchema = z.string().trim().min(1).max(128);
const itemInputSchema = z.object({ item_id: itemIdSchema }).strict();
const claimInputSchema = campaignEnrichmentClaimRequestSchema.extend({ item_id: itemIdSchema });
const proposalInputSchema = campaignEnrichmentProposalSubmissionSchema.safeExtend({
  item_id: itemIdSchema,
});
const releaseInputSchema = campaignEnrichmentReleaseRequestSchema.extend({ item_id: itemIdSchema });

function toolResult(value: object) {
  return {
    structuredContent: value as Record<string, unknown>,
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

function safeRequestId(error: LocalToolClientError): string | undefined {
  const requestId = error.requestId;
  return typeof requestId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId)
    ? requestId
    : undefined;
}

function localToolFailure(error: LocalToolClientError) {
  const requestId = safeRequestId(error);
  return {
    code: error.code,
    message: error.code === "service_unavailable" || error.code === "internal_error"
      ? "Label Suite unavailable."
      : error.message,
    retryable: error.retryable,
    ...(requestId === undefined ? {} : { request_id: requestId }),
    ...(error.details === undefined ? {} : { details: error.details }),
  };
}

function toolError(error: unknown) {
  const failure = error instanceof LocalToolClientError
    ? localToolFailure(error)
    : {
        code: "service_unavailable" as const,
        message: "Label Suite unavailable.",
        retryable: true,
      };
  const value = { error: failure };
  return {
    ...toolResult(value),
    isError: true,
  };
}

async function invoke(operation: () => Promise<object>) {
  try {
    return toolResult(await operation());
  } catch (error) {
    return toolError(error);
  }
}

export function createCampaignEnrichmentMcpServer(client: CampaignEnrichmentClient) {
  const server = new McpServer({
    name: "label-suite-campaign-enrichment",
    version: "0.1.0",
  });

  server.registerTool("list_enrichment_queue", {
    description: "List prioritized campaign leads needing research. Read-only; cannot change campaign state.",
    inputSchema: campaignEnrichmentQueueQuerySchema,
  }, async (input) => await invoke(() => client.listQueue(input)));
  server.registerTool("get_enrichment_item", {
    description: "Read one campaign lead and its current research context without changing campaign state.",
    inputSchema: itemInputSchema,
  }, async ({ item_id }) => await invoke(() => client.getItem(item_id)));
  server.registerTool("claim_enrichment_item", {
    description: "Claim one campaign lead for bounded enrichment research without changing campaign state.",
    inputSchema: claimInputSchema,
  }, async ({ item_id, ...input }) => await invoke(() => client.claimItem(item_id, input)));
  server.registerTool("submit_enrichment_proposal", {
    description: "Submit evidence-backed enrichment suggestions for later human review.",
    inputSchema: proposalInputSchema,
  }, async ({ item_id, ...input }) => await invoke(() => client.submitProposal(item_id, input)));
  server.registerTool("release_enrichment_item", {
    description: "Release a research claim without changing campaign state.",
    inputSchema: releaseInputSchema,
  }, async ({ item_id, claim_id }) => await invoke(() => client.releaseItem(item_id, claim_id)));
  server.registerTool("label_suite_health", {
    description: "Read bounded application, database, worker, analytics, and deployed revision health. Read-only.",
    inputSchema: z.object({}).strict(),
  }, async () => await invoke(() => client.getHealth()));
  server.registerTool("label_suite_jobs_health", {
    description: "Read tenant-scoped queue counts and worker health without job payloads or lease identifiers.",
    inputSchema: z.object({}).strict(),
  }, async () => await invoke(() => client.getJobsHealth()));
  server.registerTool("label_suite_operations_brief", {
    description: "Read a bounded readiness and blocker brief for one tenant-scoped release or campaign.",
    inputSchema: operatorOperationsBriefInputSchema,
  }, async (input) => await invoke(() => client.getOperationsBrief(input)));

  return server;
}

export function serveCampaignEnrichmentMcp(client: CampaignEnrichmentClient) {
  return serveStdio(
    () => createCampaignEnrichmentMcpServer(client),
    {
      onerror: () => {
        console.error("Label Suite campaign enrichment MCP transport error.");
      },
    },
  );
}
