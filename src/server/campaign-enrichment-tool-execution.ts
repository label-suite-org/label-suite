import {
  campaignEnrichmentClaimRequestSchema,
  campaignEnrichmentProposalSubmissionSchema,
  campaignEnrichmentQueueQuerySchema,
  campaignEnrichmentReleaseRequestSchema,
} from "../lib/campaign-enrichment-local-tool-contract";
import {
  claimCampaignEnrichmentItem,
  getCampaignEnrichmentItem,
  listCampaignEnrichmentQueue,
  releaseCampaignEnrichmentItem,
  submitCampaignEnrichmentProposal,
} from "./campaign-enrichment-local-tools";
import {
  boundedLocalToolDurationMs,
  localToolResultCategoryForError,
  recordLocalToolOperation,
  type LocalToolOperationEvent,
} from "./local-tool-audit";
import {
  handleLocalToolError,
  localToolJson,
  LocalToolError,
  readLocalToolJson,
} from "./local-tools-api";
import {
  runAuthenticatedLocalToolRequest,
  type LocalToolPrincipal,
} from "./local-tool-tokens";
import { getOrCreateRequestId } from "./request-context";

export type CampaignEnrichmentToolOperation =
  | { kind: "list_queue"; searchParams: URLSearchParams }
  | { kind: "get_item"; itemId: string | undefined }
  | { kind: "claim_item"; itemId: string | undefined }
  | { kind: "release_item"; itemId: string | undefined; claimId: string | undefined }
  | { kind: "submit_proposal"; itemId: string | undefined };

type OperationResult = {
  data: unknown;
  status: number;
  resultCategory: LocalToolOperationEvent["resultCategory"];
};

type OperationDefinition = {
  scope: "campaign.enrichment.read" | "campaign.enrichment.claim" | "campaign.enrichment.propose";
  tool:
    | "list_enrichment_queue"
    | "get_enrichment_item"
    | "claim_enrichment_item"
    | "release_enrichment_item"
    | "submit_enrichment_proposal";
  operation: "queue_list" | "item_get" | "claim" | "release" | "proposal_submit";
};

type AuditContext = Pick<LocalToolOperationEvent, "proposalCount"> &
  Partial<Pick<LocalToolOperationEvent, "campaignId" | "leadId">>;

export async function executeCampaignEnrichmentTool(
  request: Request,
  operation: CampaignEnrichmentToolOperation,
): Promise<Response> {
  const requestId = getOrCreateRequestId();
  const startedAt = Date.now();
  const definition = definitionFor(operation);
  const auditContext: AuditContext = { proposalCount: 0 };

  try {
    return await runAuthenticatedLocalToolRequest(request, definition.scope, async (principal) => {
      try {
        const result = await executeOperation(principal, request, operation, auditContext);
        await recordOperation(principal, definition, {
          requestId,
          startedAt,
          ...auditContext,
          resultCategory: result.resultCategory,
        });
        return localToolJson(result.data, result.status, requestId);
      } catch (error) {
        await recordOperation(principal, definition, {
          requestId,
          startedAt,
          ...auditContext,
          resultCategory: localToolResultCategoryForError(error),
        });
        return handleLocalToolError(error, requestId);
      }
    }, undefined, {
      requestId,
      tool: definition.tool,
      startedAt,
    });
  } catch (error) {
    return handleLocalToolError(error, requestId);
  }
}

function definitionFor(operation: CampaignEnrichmentToolOperation): OperationDefinition {
  switch (operation.kind) {
    case "list_queue":
      return {
        scope: "campaign.enrichment.read",
        tool: "list_enrichment_queue",
        operation: "queue_list",
      };
    case "get_item":
      return {
        scope: "campaign.enrichment.read",
        tool: "get_enrichment_item",
        operation: "item_get",
      };
    case "claim_item":
      return {
        scope: "campaign.enrichment.claim",
        tool: "claim_enrichment_item",
        operation: "claim",
      };
    case "release_item":
      return {
        scope: "campaign.enrichment.claim",
        tool: "release_enrichment_item",
        operation: "release",
      };
    case "submit_proposal":
      return {
        scope: "campaign.enrichment.propose",
        tool: "submit_enrichment_proposal",
        operation: "proposal_submit",
      };
  }
}

async function executeOperation(
  principal: LocalToolPrincipal,
  request: Request,
  operation: CampaignEnrichmentToolOperation,
  auditContext: AuditContext,
): Promise<OperationResult> {
  switch (operation.kind) {
    case "list_queue": {
      const raw = Object.fromEntries(operation.searchParams.entries()) as Record<string, unknown>;
      if ("limit" in raw) raw.limit = Number(raw.limit);
      const query = campaignEnrichmentQueueQuerySchema.parse(raw);
      auditContext.campaignId = query.campaign_id;
      return {
        data: await listCampaignEnrichmentQueue(principal, query),
        status: 200,
        resultCategory: "listed",
      };
    }
    case "get_item": {
      const itemId = requirePathId(operation.itemId);
      auditContext.leadId = itemId;
      const result = await getCampaignEnrichmentItem(principal, itemId);
      auditContext.campaignId = result.campaign_id;
      auditContext.leadId = result.lead_id;
      return { data: result, status: 200, resultCategory: "found" };
    }
    case "claim_item": {
      const itemId = requirePathId(operation.itemId);
      auditContext.leadId = itemId;
      const input = campaignEnrichmentClaimRequestSchema.parse(await readLocalToolJson(request));
      const { result_category: resultCategory, ...claim } = await claimCampaignEnrichmentItem(
        principal,
        itemId,
        input,
      );
      auditContext.campaignId = claim.campaign_id;
      auditContext.leadId = claim.lead_id;
      return {
        data: {
          id: claim.id,
          lead_id: claim.lead_id,
          claimed_at: claim.claimed_at.toISOString(),
          renewed_at: claim.renewed_at?.toISOString() ?? null,
          expires_at: claim.expires_at.toISOString(),
        },
        status: 200,
        resultCategory,
      };
    }
    case "release_item": {
      const itemId = requirePathId(operation.itemId);
      auditContext.leadId = itemId;
      const { claim_id: claimId } = campaignEnrichmentReleaseRequestSchema.parse({
        claim_id: operation.claimId,
      });
      const { result_category: resultCategory, ...result } = await releaseCampaignEnrichmentItem(
        principal,
        itemId,
        claimId,
      );
      return { data: result, status: 200, resultCategory };
    }
    case "submit_proposal": {
      const itemId = requirePathId(operation.itemId);
      auditContext.leadId = itemId;
      const submission = campaignEnrichmentProposalSubmissionSchema.parse(await readLocalToolJson(request));
      auditContext.proposalCount = submission.proposals.length;
      const { created, campaign_id: campaignId, lead_id: leadId, ...safeResult } =
        await submitCampaignEnrichmentProposal(principal, itemId, submission);
      auditContext.campaignId = campaignId;
      auditContext.leadId = leadId;
      return {
        data: safeResult,
        status: created ? 201 : 200,
        resultCategory: created ? "submitted" : "replayed",
      };
    }
  }
}

function requirePathId(value: string | undefined): string {
  const id = value?.trim();
  if (!id || id.length > 128) throw new LocalToolError("invalid_request");
  return id;
}

async function recordOperation(
  principal: LocalToolPrincipal,
  definition: OperationDefinition,
  input: {
    requestId: string;
    startedAt: number;
    resultCategory: LocalToolOperationEvent["resultCategory"];
    proposalCount: number;
    campaignId?: string;
    leadId?: string;
  },
): Promise<void> {
  try {
    await recordLocalToolOperation({
      requestId: input.requestId,
      tokenId: principal.tokenId,
      orgId: principal.orgId,
      userId: principal.userId,
      tool: definition.tool,
      operation: definition.operation,
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      ...(input.leadId ? { leadId: input.leadId } : {}),
      resultCategory: input.resultCategory,
      durationMs: boundedLocalToolDurationMs(input.startedAt),
      proposalCount: input.proposalCount,
    });
  } catch {
    // Observability must never replace the operation's fixed safe envelope.
  }
}
