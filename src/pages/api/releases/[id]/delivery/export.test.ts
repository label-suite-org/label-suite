import { expect, it, vi } from "vitest";
import { GET } from "./export";
import { listReleaseDeliveryAttempts } from "../../../../../server/delivery-exports";

vi.mock("../../../../../lib/db", () => ({ db: {}, runWithDatabaseContext: vi.fn() }));
vi.mock("../../../../../server/observability", () => ({ logEvent: vi.fn() }));
vi.mock("../../../../../server/delivery-exports", () => ({
  listReleaseDeliveryAttempts: vi.fn().mockResolvedValue([
    { id: "older", payload_version: 1, patch_version: 1, payload: { release: { title: "Original" } } },
    { id: "latest", payload_version: 1, patch_version: 2, payload: { release: { title: "Corrected" } } },
  ]),
  exportReleaseDelivery: vi.fn(), manualDeliveryExportSchema: {},
}));

it("downloads the requested stored version only from the active release and workspace", async () => {
  const context = { locals: { orgId: "org-1" }, params: { id: "release-1" },
    url: new URL("https://suite.example.test/api/releases/release-1/delivery/export?attempt=older") };
  const response = await GET(context as never);
  expect(listReleaseDeliveryAttempts).toHaveBeenLastCalledWith("org-1", "release-1");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="delivery-v1.1.json"');
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ release: { title: "Original" } });
  context.url.searchParams.set("attempt", "foreign-attempt");
  expect((await GET(context as never)).status).toBe(404);
  expect((await GET({ ...context, locals: {} } as never)).status).toBe(401);
});
