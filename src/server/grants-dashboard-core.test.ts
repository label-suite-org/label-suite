import { describe, expect, it } from "vitest";
import { buildGrantsDashboard } from "./grants-dashboard-core";

describe("buildGrantsDashboard", () => {
  it("keeps pending funding in the gap and ranks an exact category match", () => {
    const result = buildGrantsDashboard({
      projects: [{ id: "project-1", name: "Export", status: "active", currency: "DKK", totalPlanned: 100, funding: [{ status: "confirmed", amount: 30 }, { status: "pending", amount: 70 }], purposes: ["marketing"] }],
      grants: [{ id: "grant-1", name: "Marketing grant", category: "Marketing", status: "open", deadline: "2026-08-01", maxAmount: 50, currency: "DKK" }],
      applications: [],
    }, "2026-07-12");
    expect(result.projects[0]).toMatchObject({ fundingGap: 70, topMatch: { id: "grant-1" } });
  });
});
