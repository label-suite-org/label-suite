import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../../../server/errors";
import { createDataQualityRoute } from "./data-quality";

const issue: Record<string, unknown> & { id: string; status: string; priority: string; details: Record<string, unknown>; source: string; issue_type: string } = {
  id: "dq-1",
  status: "open",
  priority: "P1",
  details: {},
  source: "warm",
  issue_type: "unmatched_track",
};

describe("integration data-quality route", () => {
  it("passes tenant-scoped filters to the queue service", async () => {
    const list = vi.fn().mockResolvedValue([issue]);
    const { GET } = createDataQualityRoute({
      requireCapability: vi.fn(() => "org-a"),
      listDataQualityIssues: list,
      getDataQualityIssue: vi.fn(),
      updateDataQualityIssue: vi.fn(),
      recordAuditEvent: vi.fn(),
    });
    const response = await GET({ request: new Request("https://suite.test/api/integrations/data-quality?source=warm&priority=P1&status=open"), locals: {} } as never);
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith("org-a", { source: "warm", priority: "P1", status: "open" });
  });

  it("records an audit event for a status transition", async () => {
    const updated = { ...issue, status: "resolved" };
    const audit = vi.fn().mockResolvedValue(undefined);
    const { PATCH } = createDataQualityRoute({
      requireCapability: vi.fn(() => "org-a"),
      listDataQualityIssues: vi.fn(),
      getDataQualityIssue: vi.fn().mockResolvedValue(issue),
      updateDataQualityIssue: vi.fn().mockResolvedValue(updated),
      recordAuditEvent: audit,
    });
    const response = await PATCH({ request: new Request("https://suite.test/api/integrations/data-quality", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "dq-1", status: "resolved" }) }), locals: { user: { id: "user-a" } } } as never);
    expect(response.status).toBe(200);
    expect(audit).toHaveBeenCalledWith("org-a", expect.objectContaining({ event_type: "data_quality_issue.resolved", object_id: "dq-1" }));
  });

  it("does not mutate an issue outside the authenticated organization", async () => {
    const update = vi.fn();
    const audit = vi.fn();
    const { PATCH } = createDataQualityRoute({
      requireCapability: vi.fn(() => "org-a"),
      listDataQualityIssues: vi.fn(),
      getDataQualityIssue: vi.fn().mockRejectedValue(new NotFoundError("Data quality issue not found in active workspace")),
      updateDataQualityIssue: update,
      recordAuditEvent: audit,
    });
    const response = await PATCH({ request: new Request("https://suite.test/api/integrations/data-quality", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "dq-other-org", status: "ignored" }) }), locals: { user: { id: "user-a" } } } as never);
    expect(response.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
