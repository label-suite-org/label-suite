import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../../../server/errors";

vi.mock("../../../server/tenant", () => ({ requireCapability: vi.fn() }));

import { createAnalyticsDataQualityRoute } from "./data-quality";

const report = { health: {}, evidence: { limit: 1_000, returnedRows: 0, partial: false, version: "a".repeat(64) }, sources: [], candidates: [] } as never;

describe("analytics data-quality route", () => {
  it("injects the tenant/service seam and forwards a versioned review", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { PATCH } = createAnalyticsDataQualityRoute({ requireCapability: vi.fn(() => "tenant-a"), listAnalyticsDataQuality: vi.fn().mockResolvedValue(report), saveAnalyticsDuplicateReview: save });
    const response = await PATCH({ request: new Request("https://suite.test/api/analytics/data-quality", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateKey: "candidate-a", evidenceVersion: "a".repeat(64), disposition: "keep_separate" }) }), locals: { user: { id: "reviewer-a" } } } as never);
    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ orgId: "tenant-a", reviewedBy: "reviewer-a", evidenceVersion: "a".repeat(64) }));
  });

  it("returns the service's version/orphan conflict without a database", async () => {
    const { PATCH } = createAnalyticsDataQualityRoute({ requireCapability: vi.fn(() => "tenant-a"), listAnalyticsDataQuality: vi.fn().mockResolvedValue(report), saveAnalyticsDuplicateReview: vi.fn().mockRejectedValue(new HttpError("Duplicate candidate is no longer present for this workspace", 409)) });
    const response = await PATCH({ request: new Request("https://suite.test/api/analytics/data-quality", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateKey: "orphan", evidenceVersion: "a".repeat(64), disposition: "keep_separate" }) }), locals: { user: { id: "reviewer-a" } } } as never);
    expect(response.status).toBe(409);
  });
});
