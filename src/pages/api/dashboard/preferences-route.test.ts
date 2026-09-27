import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDashboardPreferences } from "../../../lib/dashboard-preferences";

const service = vi.hoisted(() => ({
  getDashboardPreferences: vi.fn(),
  saveDashboardPreferences: vi.fn(),
  resetDashboardPreferences: vi.fn(),
}));

vi.mock("../../../server/dashboard-preferences", () => service);
vi.mock("../../../server/tenant", () => ({
  requireCapability: (locals: App.Locals, capability: string) => {
    if (capability !== "dashboard.manage_personal") throw new Error(`Unexpected capability: ${capability}`);
    if (!locals.orgId) throw new Error("Active workspace is required");
    return locals.orgId;
  },
  requireOrgId: (locals: App.Locals) => {
    if (!locals.orgId) throw new Error("Active workspace is required");
    return locals.orgId;
  },
}));

import { DELETE, GET, PUT } from "./preferences";

const locals = { orgId: "org-1", user: { id: "user-1" } } as App.Locals;

describe("dashboard preferences route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getDashboardPreferences.mockResolvedValue(defaultDashboardPreferences());
    service.saveDashboardPreferences.mockImplementation(async (_owner, input) => input);
    service.resetDashboardPreferences.mockResolvedValue(defaultDashboardPreferences());
  });

  it("returns preferences for the signed-in person only", async () => {
    const response = await GET({ locals } as never);
    expect(response.status).toBe(200);
    expect(service.getDashboardPreferences).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1" });
  });

  it("validates and saves a complete layout", async () => {
    const preferences = defaultDashboardPreferences();
    const response = await PUT({
      locals,
      request: new Request("https://suite.test/api/dashboard/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(preferences),
      }),
    } as never);
    expect(response.status).toBe(200);
    expect(service.saveDashboardPreferences).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1" }, preferences);
  });

  it("ignores caller-supplied tenant identity and mutates only the authenticated context", async () => {
    const preferences = defaultDashboardPreferences();
    const response = await PUT({
      locals,
      request: new Request("https://suite.test/api/dashboard/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...preferences, orgId: "org-2", userId: "user-2" }),
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(service.saveDashboardPreferences).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1" }, preferences);
  });

  it("rejects overfilled layouts before storage", async () => {
    const response = await PUT({
      locals,
      request: new Request("https://suite.test/api/dashboard/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...defaultDashboardPreferences(),
          pinnedIndicatorIds: ["release_readiness", "due_tasks", "catalog_issues", "net_revenue"],
        }),
      }),
    } as never);
    expect(response.status).toBe(400);
    expect(service.saveDashboardPreferences).not.toHaveBeenCalled();
  });

  it("restores the default by deleting only the caller's override", async () => {
    const response = await DELETE({ locals } as never);
    expect(response.status).toBe(200);
    expect(service.resetDashboardPreferences).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1" });
  });

  it("fails closed without an authenticated user", async () => {
    const response = await GET({ locals: { orgId: "org-1" } } as never);
    expect(response.status).toBe(401);
    expect(service.getDashboardPreferences).not.toHaveBeenCalled();
  });
});
