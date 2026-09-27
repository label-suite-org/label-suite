import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ resolveNativeActor: vi.fn(), bearerToken: vi.fn(), getNativeSession: vi.fn() }));
const service = vi.hoisted(() => ({ getNativeCampaignPublicPageReview: vi.fn(), applyNativePublicPageAction: vi.fn() }));
vi.mock("../../../../../lib/native-workspace", () => ({ resolveNativeActor: auth.resolveNativeActor }));
vi.mock("../../../../../lib/native-session", () => ({ bearerToken: auth.bearerToken, getNativeSession: auth.getNativeSession }));
vi.mock("../../../../../lib/db", () => ({ runWithDatabaseContext: async (_: unknown, work: () => Promise<unknown>) => work() }));
vi.mock("../../../../../server/campaign-public-page", async original => ({ ...await original<typeof import("../../../../../server/campaign-public-page")>(), ...service }));
import { GET, POST } from "./public-page";
const context = { params: { id: "campaign-a" }, request: new Request("https://suite.test/api/native/campaigns/campaign-a/public-page?workspaceId=foreign") } as never;
beforeEach(() => {
  vi.clearAllMocks();
  auth.resolveNativeActor.mockResolvedValue({ userId: "actor-a", workspace: { role: "member", org: { id: "org-a" } } });
  auth.bearerToken.mockReturnValue(null); auth.getNativeSession.mockResolvedValue(null);
  service.getNativeCampaignPublicPageReview.mockResolvedValue({ page: null });
});
it("allows member review in the authorized workspace without caching or publication", async () => {
  const response = await GET(context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(service.getNativeCampaignPublicPageReview).toHaveBeenCalledWith("org-a", "campaign-a");
});
it("denies payees and distinguishes expired authentication from removed workspace access", async () => {
  auth.resolveNativeActor.mockResolvedValue({ userId: "actor-a", workspace: { role: "payee", org: { id: "org-a" } } });
  expect((await GET(context)).status).toBe(403);
  auth.resolveNativeActor.mockResolvedValue(null);
  expect((await GET(context)).status).toBe(401);
  auth.bearerToken.mockReturnValue("fixture"); auth.getNativeSession.mockResolvedValue({ user: { id: "actor-a" } });
  const response = await GET(context);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "workspace_access_removed" });
  expect(service.getNativeCampaignPublicPageReview).not.toHaveBeenCalled();
});

it("requires explicit owner publication and accepts operator review only", async () => {
  const input = { revision_id: "revision", expected_review_token: "a".repeat(64), confirmation: "publish" };
  const post = (body: unknown) => POST({ params: { id: "campaign-a" }, request: new Request("https://suite.test/api/native/campaigns/campaign-a/public-page", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) } as never);
  service.applyNativePublicPageAction.mockResolvedValue({ ok: true });
  expect((await post(input)).status).toBe(403);
  auth.resolveNativeActor.mockResolvedValue({ userId: "actor-a", workspace: { role: "operator", org: { id: "org-a" } } });
  expect((await post(input)).status).toBe(403);
  expect((await post({ ...input, confirmation: "review" })).status).toBe(200);
  auth.resolveNativeActor.mockResolvedValue({ userId: "actor-a", workspace: { role: "owner", org: { id: "org-a" } } });
  expect((await post({ ...input, send: true })).status).toBe(400);
  expect((await post(input)).status).toBe(200);
  expect(service.applyNativePublicPageAction).toHaveBeenLastCalledWith("org-a", "campaign-a", "actor-a", input);
});
