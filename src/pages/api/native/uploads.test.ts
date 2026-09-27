import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const sessions = vi.hoisted(() => ({ bearerToken: vi.fn(), getNativeSession: vi.fn() }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_: unknown, operation: () => Promise<unknown>) => operation()) }));
const service = vi.hoisted(() => ({ prepareResourceUpload: vi.fn(), completeResourceUpload: vi.fn(), getResourceUpload: vi.fn() }));
vi.mock("../../../lib/native-workspace", () => auth);
vi.mock("../../../lib/native-session", () => sessions);
vi.mock("../../../lib/db", () => database);
vi.mock("../../../server/native-resource-uploads", async (original) => ({ ...await original<typeof import("../../../server/native-resource-uploads")>(), ...service }));
import { POST } from "./uploads";
import { GET, PUT } from "./uploads/[id]";
const input = { client_request_id: "f73745cd-abec-4c4e-bca3-ffcf6d54fc24", kind: "documents", name: "Document", context: { kind: "release", id: "release-a" }, provenance: "Artist supplied", capture_method: "files", file_name: "file.pdf", content_type: "application/pdf", size: 5, sha256: "a".repeat(64) };
const context = (method: string, headers?: Record<string, string>) => ({ params: { id: "intent-a" }, request: new Request("https://suite.test/api/native/uploads/intent-a?orgId=untrusted", {
  method, headers: { "content-type": method === "POST" ? "application/json" : "application/octet-stream", ...headers },
  body: method === "GET" ? undefined : method === "POST" ? JSON.stringify(input) : "bytes",
}) }) as never;
describe("native private upload routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.resolveNativeActor.mockResolvedValue({ userId: "actor-a", workspace: { role: "operator", org: { id: "org-a" } } });
    sessions.bearerToken.mockReturnValue(null); sessions.getNativeSession.mockResolvedValue(null);
    for (const fn of Object.values(service)) fn.mockResolvedValue({ id: "intent-a", status: "prepared" });
  });
  it("binds prepare, status and bytes to the authenticated actor and workspace", async () => {
    expect((await POST(context("POST"))).status).toBe(201);
    expect(service.prepareResourceUpload).toHaveBeenCalledWith("org-a", "actor-a", input);
    for (const [route, method] of [[GET, "GET"], [PUT, "PUT"]] as const) {
      const response = await route(context(method));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(service.getResourceUpload).toHaveBeenCalledWith("org-a", "actor-a", "intent-a");
    expect(service.completeResourceUpload).toHaveBeenCalledWith("org-a", "actor-a", "intent-a", new TextEncoder().encode("bytes"));
  });
  it("allows fundraiser capture only for Grant documents", async () => {
    auth.resolveNativeActor.mockResolvedValue({ userId: "actor-a", workspace: { role: "fundraiser", org: { id: "org-a" } } });
    expect((await POST(context("POST"))).status).toBe(403);
    const grant = { ...input, context: { kind: "grant_application", id: "application-a" } };
    const response = await POST({ request: new Request("https://suite.test/api/native/uploads", { method: "POST", body: JSON.stringify(grant) }) } as never);
    expect(response.status).toBe(201);
    expect(service.prepareResourceUpload).toHaveBeenCalledWith("org-a", "actor-a", grant);
  });
  it("rejects oversized request bodies before invoking completion", async () => {
    expect((await PUT(context("PUT", { "content-length": String(26 * 1024 * 1024) }))).status).toBe(413);
    expect(service.completeResourceUpload).not.toHaveBeenCalled();
  });
  it("rejects nonoperators, expired sessions and revoked memberships", async () => {
    auth.resolveNativeActor.mockResolvedValue({ workspace: { role: "member" } });
    expect((await POST(context("POST"))).status).toBe(403);
    expect((await PUT(context("PUT"))).status).toBe(403);
    auth.resolveNativeActor.mockResolvedValue(null);
    expect((await GET(context("GET"))).status).toBe(401);
    sessions.bearerToken.mockReturnValue("fixture"); sessions.getNativeSession.mockResolvedValue({ user: { id: "actor-a" } });
    const response = await PUT(context("PUT"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "workspace_access_removed" });
    expect(database.runWithDatabaseContext).not.toHaveBeenCalled();
  });
});
