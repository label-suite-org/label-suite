import { operatorOperationsBriefInputSchema } from "../lib/operator-diagnostics-contract";
import {
  boundedLocalToolDurationMs,
  localToolResultCategoryForError,
  recordLocalToolOperation,
  type LocalToolOperationEvent,
} from "./local-tool-audit";
import { handleLocalToolError, localToolJson } from "./local-tools-api";
import { runAuthenticatedLocalToolRequest, type LocalToolPrincipal } from "./local-tool-tokens";
import { getOperatorJobsHealth, getOperatorOperationsBrief } from "./operator-diagnostics";
import { getOrCreateRequestId } from "./request-context";

export type OperatorDiagnosticsOperation =
  | { kind: "jobs_health" }
  | { kind: "operations_brief"; searchParams: URLSearchParams };

export async function executeOperatorDiagnostics(
  request: Request,
  operation: OperatorDiagnosticsOperation,
): Promise<Response> {
  const requestId = getOrCreateRequestId();
  const startedAt = Date.now();
  const tool = `label_suite_${operation.kind}` as const;

  try {
    return await runAuthenticatedLocalToolRequest(
      request,
      "operator.diagnostics.read",
      async (principal) => executeAuthenticated(
        principal,
        operation,
        requestId,
        startedAt,
      ),
      undefined,
      { requestId, tool, startedAt },
    );
  } catch (error) {
    return handleLocalToolError(error, requestId);
  }
}

async function executeAuthenticated(
  principal: LocalToolPrincipal,
  operation: OperatorDiagnosticsOperation,
  requestId: string,
  startedAt: number,
): Promise<Response> {
  let resource: { resourceType: "release" | "campaign"; resourceId: string } | undefined;
  try {
    if (operation.kind === "jobs_health") {
      const data = await getOperatorJobsHealth(principal.orgId);
      await record(principal, operation.kind, requestId, startedAt, "found");
      return localToolJson(data, 200, requestId);
    }

    const input = operatorOperationsBriefInputSchema.parse({
      resource_type: operation.searchParams.get("resource_type"),
      resource_id: operation.searchParams.get("resource_id"),
    });
    resource = { resourceType: input.resource_type, resourceId: input.resource_id };
    const data = await getOperatorOperationsBrief(principal.orgId, input);
    await record(principal, operation.kind, requestId, startedAt, "found", resource);
    return localToolJson(data, 200, requestId);
  } catch (error) {
    await record(
      principal,
      operation.kind,
      requestId,
      startedAt,
      localToolResultCategoryForError(error),
      resource,
    );
    return handleLocalToolError(error, requestId);
  }
}

async function record(
  principal: LocalToolPrincipal,
  operation: OperatorDiagnosticsOperation["kind"],
  requestId: string,
  startedAt: number,
  resultCategory: LocalToolOperationEvent["resultCategory"],
  resource?: { resourceType: "release" | "campaign"; resourceId: string },
): Promise<void> {
  await recordLocalToolOperation({
    requestId,
    tokenId: principal.tokenId,
    orgId: principal.orgId,
    userId: principal.userId,
    tool: `label_suite_${operation}`,
    operation,
    ...(resource ?? {}),
    resultCategory,
    durationMs: boundedLocalToolDurationMs(startedAt),
    proposalCount: 0,
  });
}
