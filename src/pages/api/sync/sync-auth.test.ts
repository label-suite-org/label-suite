import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { syncSaveSchema, receiptSchema, syncDraft } from "../../../lib/sync";
const actor = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const database = vi.hoisted(() => ({
  db: {},
  runWithDatabaseContext: vi.fn(
    async (_context: unknown, fn: () => Promise<unknown>) => fn(),
  ),
}));
const service = vi.hoisted(() => ({
  getSyncDeal: vi.fn(),
  getNativeSyncDeal: vi.fn(),
  listSyncDealsPage: vi.fn(),
  listSyncDeals: vi.fn(),
  syncOptions: vi.fn(),
  saveSyncDeal: vi.fn(),
  recordSyncReceipt: vi.fn(),
}));
vi.mock("../../../lib/native-workspace", () => actor);
vi.mock("../../../lib/db", () => database);
vi.mock("../../../server/sync", () => ({
  ...service,
  syncMutationSchema: z.discriminatedUnion("action", [
    z.object({ action: z.literal("save"), input: syncSaveSchema }).strict(),
    z.object({ action: z.literal("receipt"), input: receiptSchema }).strict(),
  ]),
}));
import { GET, POST } from "./index";
import { GET as nativeGET, POST as nativePOST } from "../native/sync/index";
const input = {
  id: "6948ae24-51ba-4a84-aedb-ed53af8d5f81",
  expected_version: 0,
  production: "Fixture",
  details: {
    ...syncDraft(),
    recording_title: "Recording",
    version_name: "Instrumental",
    provenance: "Synthetic",
  },
};
const request = () =>
  new Request("https://example.test/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "save", input }),
  });
describe("sync access boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.saveSyncDeal.mockResolvedValue({ ok: true });
  });
  it("denies browser members both reading and writing licensing terms", async () => {
    const context = {
      locals: { orgId: "org", membershipRole: "member", user: { id: "user" } },
      url: new URL("https://example.test/api/sync"),
      request: request(),
    } as never;
    expect((await GET(context)).status).toBe(403);
    expect((await POST(context)).status).toBe(403);
    expect(service.listSyncDeals).not.toHaveBeenCalled();
    expect(service.saveSyncDeal).not.toHaveBeenCalled();
  });
  it("uses the browser's authenticated workspace and actor", async () => {
    expect(
      (
        await POST({
          locals: {
            orgId: "org",
            membershipRole: "operator",
            user: { id: "user" },
          },
          request: request(),
        } as never)
      ).status,
    ).toBe(200);
    expect(service.saveSyncDeal).toHaveBeenCalledWith(
      "org",
      "user",
      expect.objectContaining({ id: input.id }),
    );
  });
  it("denies missing native authentication and member access before reading or writing", async () => {
    const context = {
      request: request(),
      url: new URL("https://example.test/api/native/sync"),
    } as never;
    actor.resolveNativeActor.mockResolvedValue(null);
    expect((await nativeGET(context)).status).toBe(401);
    actor.resolveNativeActor.mockResolvedValue({
      userId: "user",
      workspace: { org: { id: "org" }, role: "member" },
    });
    expect((await nativePOST(context)).status).toBe(403);
    expect((await nativeGET(context)).status).toBe(403);
    expect(service.getNativeSyncDeal).not.toHaveBeenCalled();
    expect(service.listSyncDealsPage).not.toHaveBeenCalled();
    expect(service.saveSyncDeal).not.toHaveBeenCalled();
    expect(service.listSyncDeals).not.toHaveBeenCalled();
  });
  it("scopes native writes to the resolved bearer workspace", async () => {
    actor.resolveNativeActor.mockResolvedValue({
      userId: "user",
      workspace: { org: { id: "org" }, role: "operator" },
    });
    expect((await nativePOST({ request: request() } as never)).status).toBe(
      200,
    );
    expect(database.runWithDatabaseContext).toHaveBeenCalledWith(
      { orgId: "org", userId: "user" },
      expect.any(Function),
    );
    expect(service.saveSyncDeal).toHaveBeenCalledWith(
      "org",
      "user",
      expect.objectContaining({ id: input.id }),
    );
  });
  it("passes native read pagination and filters only after resolving the owner workspace", async () => {
    actor.resolveNativeActor.mockResolvedValue({
      userId: "user",
      workspace: { org: { id: "org" }, role: "owner" },
    });
    service.listSyncDealsPage.mockResolvedValue({
      items: [],
      next_cursor: null,
      has_more: false,
    });
    const url = new URL(
      "https://example.test/api/native/sync?limit=10&cursor=page&artist=artist&release=release",
    );
    const response = await nativeGET({
      request: new Request(url),
      url,
    } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [],
      next_cursor: null,
      has_more: false,
    });
    expect(service.listSyncDealsPage).toHaveBeenCalledWith("org", {
      limit: 10,
      cursor: "page",
      artist: "artist",
      release: "release",
    });
    url.search = `?id=${input.id}&receipts_cursor=receipts&revisions_cursor=revisions`;
    service.getNativeSyncDeal.mockResolvedValue({ deal: { id: input.id } });
    const detail = await nativeGET({ request: new Request(url), url } as never);
    expect(await detail.json()).toEqual({ record: { deal: { id: input.id } } });
    expect(service.getNativeSyncDeal).toHaveBeenCalledWith("org", input.id, {
      limit: 25,
      receipts_cursor: "receipts",
      revisions_cursor: "revisions",
    });
    expect(service.syncOptions).not.toHaveBeenCalled();
  });
});
