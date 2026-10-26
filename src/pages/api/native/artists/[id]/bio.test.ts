import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), session: vi.fn(), get: vi.fn(), review: vi.fn(), context: vi.fn(async (_: unknown, action: () => Promise<unknown>) => action()) }));
vi.mock("../../../../../lib/db", () => ({ runWithDatabaseContext: mocks.context }));
vi.mock("../../../../../lib/native-workspace", () => ({ resolveNativeActor: mocks.actor }));
vi.mock("../../../../../lib/native-session", () => ({ bearerToken: () => "fixture-only", getNativeSession: mocks.session }));
vi.mock("../../../../../server/native-artist-bio", async () => {
  const { z } = await import("zod");
  return { getNativeArtistBio: mocks.get, reviewNativeArtistBio: mocks.review,
    nativeArtistBioReviewSchema: z.object({ expected_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict() };
});
import { GET, POST } from "./bio";
const hash = "a".repeat(64);
const call = (method: "GET" | "POST", input: unknown = { expected_hash: hash }) => (method === "GET" ? GET : POST)({ params: { id: "artist" }, request: new Request("https://suite.test/api/native/artists/artist/bio?workspaceId=workspace", { method, ...(method === "POST" ? { body: JSON.stringify(input), headers: { "Content-Type": "application/json" } } : {}) }) } as never);
describe("native exact biography review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockResolvedValue({ userId: "actor", workspace: { org: { id: "workspace" }, role: "operator" } });
    mocks.session.mockResolvedValue(null);
    mocks.get.mockResolvedValue({ id: "artist", hash, state: "draft" });
    mocks.review.mockResolvedValue({ id: "artist", ok: true, hash, state: "reviewed" });
  });
  it("returns private scoped source and acknowledges only the requested hash", async () => {
    const source = await call("GET");
    expect(source.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.get).toHaveBeenCalledWith("workspace", "artist");
    expect((await call("POST")).status).toBe(200);
    expect(mocks.review).toHaveBeenCalledWith("workspace", "artist", "actor", { expected_hash: hash });
    expect(mocks.context).toHaveBeenCalledWith({ userId: "actor", orgId: "workspace" }, expect.any(Function));
  });
  it("allows read-only source inspection but rejects review before touching source", async () => {
    mocks.actor.mockResolvedValue({ userId: "actor", workspace: { org: { id: "workspace" }, role: "member" } });
    expect((await call("GET")).status).toBe(200);
    expect((await call("POST")).status).toBe(403);
    expect(mocks.review).not.toHaveBeenCalled();
    mocks.actor.mockResolvedValue({ userId: "actor", workspace: { org: { id: "workspace" }, role: "payee" } });
    expect((await call("GET")).status).toBe(403);
  });
  it("distinguishes expired session from removed workspace access", async () => {
    mocks.actor.mockResolvedValue(null);
    expect((await call("POST")).status).toBe(401);
    mocks.session.mockResolvedValue({ userId: "actor" });
    const response = await call("POST");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "workspace_access_removed" });
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("rejects malformed fingerprints and all editing/provider fields", async () => {
    for (const input of [{ expected_hash: "bad" }, { expected_hash: hash, bio: "replace" }, { expected_hash: hash, provider: "activate" }, {}]) {
      expect((await call("POST", input)).status).toBe(400);
    }
    expect(mocks.review).not.toHaveBeenCalled();
  });
});
