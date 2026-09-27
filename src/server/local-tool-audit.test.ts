import { describe, expect, it, vi } from "vitest";
import {
  buildLocalToolAuditLogInput,
  recordLocalToolOperation,
} from "./local-tool-audit";

describe("local-tool operation audit and telemetry", () => {
  it("builds only the bounded safe audit allowlist", () => {
    const input = buildLocalToolAuditLogInput({
      requestId: "request-1",
      tokenId: "token-1",
      orgId: "org-1",
      userId: "user-1",
      tool: "submit_enrichment_proposal",
      operation: "proposal_submit",
      campaignId: "campaign-1",
      leadId: "lead-1",
      resultCategory: "submitted",
      durationMs: 17,
      proposalCount: 2,
    });

    expect(input).toEqual({
      orgId: "org-1",
      actorUserId: "user-1",
      requestId: "request-1",
      action: "local_tool.proposal_submit",
      entityType: "campaign_lead",
      entityId: "lead-1",
      metadata: {
        token_id: "token-1",
        tool: "submit_enrichment_proposal",
        operation: "proposal_submit",
        campaign_id: "campaign-1",
        lead_id: "lead-1",
        result_category: "submitted",
        duration_ms: 17,
        proposal_count: 2,
      },
    });
  });

  it("rejects unallowlisted text and never emits secrets or proposal content", async () => {
    expect(() => buildLocalToolAuditLogInput({
      requestId: "request-1",
      orgId: "org-1",
      tool: "submit_enrichment_proposal",
      operation: "proposal_submit",
      resultCategory: "submitted",
      durationMs: 2,
      proposalCount: 1,
      bearerToken: "lsmcp_secret",
      value: "private proposal value",
      rationale: "private rationale",
      citationText: "private citation",
      email: "private@example.com",
      rawError: "private stack",
    })).toThrow();

    const insertAuditLog = vi.fn().mockResolvedValue(undefined);
    const emitTelemetry = vi.fn();
    await recordLocalToolOperation({
      requestId: "request-2",
      orgId: "org-1",
      userId: "user-1",
      tokenId: "token-1",
      tool: "claim_enrichment_item",
      operation: "claim",
      leadId: "lead-1",
      resultCategory: "claimed",
      durationMs: 3,
      proposalCount: 0,
    }, { insertAuditLog, emitTelemetry });

    const serialized = JSON.stringify([insertAuditLog.mock.calls, emitTelemetry.mock.calls]);
    expect(serialized).not.toMatch(/lsmcp_|secret_hash|proposal value|rationale|citation|private@example|stack/i);
  });

  it("keeps the primary operation best-effort when audit persistence fails", async () => {
    const emitTelemetry = vi.fn();

    await expect(recordLocalToolOperation({
      requestId: "request-3",
      orgId: "org-1",
      tool: "revoke_local_tool_token",
      operation: "token_revoke",
      tokenId: "token-1",
      resultCategory: "revoked",
      durationMs: 4,
      proposalCount: 0,
    }, {
      insertAuditLog: vi.fn().mockRejectedValue(new Error("raw database detail")),
      emitTelemetry,
    })).resolves.toBeUndefined();
    expect(JSON.stringify(emitTelemetry.mock.calls)).not.toContain("raw database detail");
  });

  it("records only bounded diagnostic resource identifiers", () => {
    expect(buildLocalToolAuditLogInput({
      requestId: "request-4",
      tokenId: "token-1",
      orgId: "org-1",
      userId: "user-1",
      tool: "label_suite_operations_brief",
      operation: "operations_brief",
      resourceType: "release",
      resourceId: "release-1",
      resultCategory: "found",
      durationMs: 5,
      proposalCount: 0,
    })).toMatchObject({
      entityType: "release",
      entityId: "release-1",
      metadata: {
        resource_type: "release",
        resource_id: "release-1",
      },
    });
  });
});
