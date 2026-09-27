import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HttpError } from "../../../../server/errors";

const service = vi.hoisted(() => ({
  prepareRoyaltyStatements: vi.fn(),
}));
const tenant = vi.hoisted(() => ({
  requireCapability: vi.fn(),
}));

vi.mock("../../../../server/royalty-statements", () => ({
  prepareRoyaltyStatements: service.prepareRoyaltyStatements,
  prepareRoyaltyStatementsSchema: z.object({
    period_start: z.string(),
    period_end: z.string(),
    currency: z.string().default("USD").transform((value) => value.toUpperCase()),
  }),
}));
vi.mock("../../../../server/tenant", () => tenant);

import { POST } from "./prepare";

describe("royalty statement preparation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenant.requireCapability.mockReturnValue("org-a");
    service.prepareRoyaltyStatements.mockResolvedValue({
      calculationRunId: "run-1",
      plans: [],
      blockers: [],
      protectedStatements: [],
      reconciliations: [],
      sourceTotal: "0.00000000",
      allocatedTotal: "0.00000000",
    });
  });

  it("uses the authenticated tenant and normalizes the currency before preparing statements", async () => {
    const response = await POST({
      locals: { orgId: "caller-supplied-org" },
      request: new Request("https://suite.test/api/royalties/statements/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period_start: "2026-01-01", period_end: "2026-01-31", currency: "eur" }),
      }),
    } as never);

    expect(response.status).toBe(201);
    expect(tenant.requireCapability).toHaveBeenCalledWith(expect.anything(), "royalties.mutate");
    expect(service.prepareRoyaltyStatements).toHaveBeenCalledWith("org-a", {
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      currency: "EUR",
    });
  });

  it("does not call the statement service when capability enforcement fails", async () => {
    tenant.requireCapability.mockImplementation(() => {
      throw new HttpError("Insufficient permissions", 403);
    });

    const response = await POST({
      locals: { orgId: "org-a" },
      request: new Request("https://suite.test/api/royalties/statements/prepare", { method: "POST" }),
    } as never);

    expect(response.status).toBe(403);
    expect(service.prepareRoyaltyStatements).not.toHaveBeenCalled();
  });
});
