import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalToolError } from "./local-tools-api";

const auth = vi.hoisted(() => ({ runAuthenticatedLocalToolRequest: vi.fn() }));
const audit = vi.hoisted(() => ({ recordLocalToolOperation: vi.fn().mockResolvedValue(undefined) }));
const diagnostics = vi.hoisted(() => ({
  getOperatorJobsHealth: vi.fn(),
  getOperatorOperationsBrief: vi.fn(),
}));

vi.mock("./local-tool-tokens", async () => ({
  ...await vi.importActual<typeof import("./local-tool-tokens")>("./local-tool-tokens"),
  ...auth,
}));
vi.mock("./local-tool-audit", async () => ({
  ...await vi.importActual<typeof import("./local-tool-audit")>("./local-tool-audit"),
  ...audit,
}));
vi.mock("./operator-diagnostics", () => diagnostics);

const principal = {
  tokenId: "token-a",
  orgId: "org-a",
  userId: "user-a",
  scopes: ["operator.diagnostics.read"] as const,
};

describe("executeOperatorDiagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.runAuthenticatedLocalToolRequest.mockImplementation(
      async (_request, _scope, operation) => operation(principal),
    );
    diagnostics.getOperatorJobsHealth.mockResolvedValue({
      queued: 0,
      running: 1,
      failed: 0,
      oldest_queued_at: null,
      expired_leases: 0,
      active_workers: 1,
    });
    diagnostics.getOperatorOperationsBrief.mockResolvedValue({
      resource_type: "release",
      record: { id: "release-1" },
      readiness: { state: "ready", blockers: [] },
    });
  });

  it("uses the dedicated read scope and resolved organization for job health", async () => {
    const { executeOperatorDiagnostics } = await import("./operator-diagnostics-execution");
    const request = new Request("https://suite.example/api/local-tools/v1/operator/jobs/health");

    const response = await executeOperatorDiagnostics(request, { kind: "jobs_health" });

    expect(response.status).toBe(200);
    expect(auth.runAuthenticatedLocalToolRequest).toHaveBeenCalledWith(
      request,
      "operator.diagnostics.read",
      expect.any(Function),
      undefined,
      expect.objectContaining({ tool: "label_suite_jobs_health" }),
    );
    expect(diagnostics.getOperatorJobsHealth).toHaveBeenCalledWith("org-a");
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-a",
      tool: "label_suite_jobs_health",
      operation: "jobs_health",
      resultCategory: "found",
    }));
  });

  it("validates and audits one bounded release brief", async () => {
    const { executeOperatorDiagnostics } = await import("./operator-diagnostics-execution");
    const request = new Request("https://suite.example/api/local-tools/v1/operator/operations-brief?resource_type=release&resource_id=release-1");

    const response = await executeOperatorDiagnostics(request, {
      kind: "operations_brief",
      searchParams: new URL(request.url).searchParams,
    });

    expect(response.status).toBe(200);
    expect(diagnostics.getOperatorOperationsBrief).toHaveBeenCalledWith("org-a", {
      resource_type: "release",
      resource_id: "release-1",
    });
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: "release",
      resourceId: "release-1",
      proposalCount: 0,
    }));
  });

  it("returns authentication failure before any diagnostic query", async () => {
    auth.runAuthenticatedLocalToolRequest.mockRejectedValueOnce(new LocalToolError("scope_forbidden"));
    const { executeOperatorDiagnostics } = await import("./operator-diagnostics-execution");

    const response = await executeOperatorDiagnostics(
      new Request("https://suite.example/api/local-tools/v1/operator/jobs/health"),
      { kind: "jobs_health" },
    );

    expect(response.status).toBe(403);
    expect(diagnostics.getOperatorJobsHealth).not.toHaveBeenCalled();
  });
});
