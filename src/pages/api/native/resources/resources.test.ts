import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const sessions = vi.hoisted(() => ({ bearerToken: vi.fn(), getNativeSession: vi.fn() }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_: unknown, op: () => Promise<unknown>) => op()) }));
const service = vi.hoisted(() => ({ listNativeResources: vi.fn(), getNativeResource: vi.fn(), nativeResourceDownload: vi.fn(), changeNativeResourceContext: vi.fn() }));
vi.mock("../../../../lib/native-workspace", () => auth);
vi.mock("../../../../lib/native-session", () => sessions);
vi.mock("../../../../lib/db", () => database);
vi.mock("../../../../server/native-assets", async (original) => ({ ...await original<typeof import("../../../../server/native-assets")>(), ...service }));
import { GET as list } from "./[kind]";
import { GET as detail } from "./[kind]/[id]";
import { PATCH } from "./[kind]/[id]/context";
import { GET as download } from "./[kind]/[id]/files/[fileId]";
const context = () => ({ params: { kind: "documents", id: "doc-a", fileId: "file-a" },
  url: new URL("https://suite.test/api/native/resources/documents?q=term&orgId=untrusted"),
  request: new Request("https://suite.test/api/native/resources/documents?orgId=untrusted") }) as never;
describe("native private resource routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { role: "member", org: { id: "org-a" } } });
    sessions.bearerToken.mockReturnValue(null); sessions.getNativeSession.mockResolvedValue(null);
    service.listNativeResources.mockResolvedValue({ items: [] });
    service.getNativeResource.mockResolvedValue({ record: { id: "doc-a" } });
    service.nativeResourceDownload.mockResolvedValue({ url: "https://private.test/short-lived" });
  });
  it("uses authenticated workspace identity and prevents caching private responses", async () => {
    for (const route of [list, detail, download]) {
      const response = await route(context());
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(service.listNativeResources).toHaveBeenCalledWith("org-a", "documents", "term", null, undefined);
    expect(service.nativeResourceDownload).toHaveBeenCalledWith("org-a", "documents", "doc-a", "file-a");
  });
  it("rejects unsupported resource types before querying records", async () => {
    const invalid = { ...context() as object, params: { kind: "users" } } as never;
    expect((await list(invalid)).status).toBe(400);
    expect(service.listNativeResources).not.toHaveBeenCalled();
  });
  it("requires operator capability and takes link identity from the validated route and body", async () => {
    const input = { action: "unlink", context: { kind: "release", id: "release-a" }, expected_revision: "r1" };
    const mutation = () => ({ params: { kind: "documents", id: "doc-a" }, request: new Request("https://suite.test/api/native/resources/documents/doc-a/context", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }) }) as never;
    expect((await PATCH(mutation())).status).toBe(403);
    expect(service.changeNativeResourceContext).not.toHaveBeenCalled();
    auth.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { role: "operator", org: { id: "org-a" } } });
    service.changeNativeResourceContext.mockResolvedValue({ contexts: [] });
    const response = await PATCH(mutation());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.changeNativeResourceContext).toHaveBeenCalledWith("org-a", "documents", "doc-a", input, "user-a");
  });
  it("denies payees and distinguishes expired authentication from revoked membership", async () => {
    auth.resolveNativeActor.mockResolvedValue({ workspace: { role: "payee" } });
    for (const route of [list, detail, download]) expect((await route(context())).status).toBe(403);
    auth.resolveNativeActor.mockResolvedValue(null);
    expect((await download(context())).status).toBe(401);
    sessions.bearerToken.mockReturnValue("fixture"); sessions.getNativeSession.mockResolvedValue({ user: { id: "user-a" } });
    const revoked = await download(context());
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).toMatchObject({ code: "workspace_access_removed" });
    expect(service.nativeResourceDownload).not.toHaveBeenCalled();
  });
});
