import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const sessions = vi.hoisted(() => ({ bearerToken: vi.fn(), getNativeSession: vi.fn() }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_: unknown, op: () => Promise<unknown>) => op()) }));
const works = vi.hoisted(() => ({ getNativeWork: vi.fn(), listNativeWorks: vi.fn() }));
vi.mock("../../../../../server/native-works", () => works);
const service = vi.hoisted(() => ({ listNativeTracks: vi.fn(), getNativeTrack: vi.fn(), updateNativeTrack: vi.fn() }));
vi.mock("../../../../../lib/native-workspace", () => native);
vi.mock("../../../../../lib/native-session", () => sessions);
vi.mock("../../../../../lib/db", () => database);
vi.mock("../../../../../server/native-tracks", async (original) => ({ ...await original<typeof import("../../../../../server/native-tracks")>(), ...service }));
import { GET as standalone, PATCH as updateStandalone } from "../../tracks/[trackId]";
import { GET as workList } from "../../works";
import { GET as work } from "../../works/[id]";
import { GET as list } from "./tracks";
import { GET as detail, PATCH as update } from "./tracks/[trackId]";

const context = (method = "GET", body?: unknown) => ({ params: { id: "release-a", trackId: "track-a" }, request: new Request("https://suite.test/api/native/releases/release-a/tracks/track-a?workspaceId=ignored", { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }) }) as never;

describe("native release-scoped Track routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "operator" } });
    sessions.bearerToken.mockReturnValue(null); sessions.getNativeSession.mockResolvedValue(null);
    works.listNativeWorks.mockResolvedValue({ items: [], next_cursor: null });
    works.getNativeWork.mockResolvedValue({ work: { id: "release-a" }, tracks: [] });
    service.listNativeTracks.mockResolvedValue({ tracks: [] });
    service.getNativeTrack.mockResolvedValue({ track: { id: "track-a" } });
    service.updateNativeTrack.mockResolvedValue({ track: { id: "track-a", title: "Changed" } });
  });
  it("uses the authenticated workspace and URL release/track identities", async () => {
    expect((await workList(context())).status).toBe(200);
    expect(works.listNativeWorks).toHaveBeenCalledWith("org-a", { q: null, cursor: null, missing_isrc: null });
    expect((await work(context())).status).toBe(200);
    expect(works.getNativeWork).toHaveBeenCalledWith("org-a", "release-a");
    expect((await list(context())).status).toBe(200);
    expect(service.listNativeTracks).toHaveBeenCalledWith("org-a", "release-a");
    expect((await detail(context())).status).toBe(200);
    expect(service.getNativeTrack).toHaveBeenCalledWith("org-a", "release-a", "track-a");
    expect((await update(context("PATCH", { title: "Changed", expected_revision: "r1" }))).status).toBe(200);
    expect(service.updateNativeTrack).toHaveBeenCalledWith("org-a", "release-a", "track-a", { title: "Changed", expected_revision: "r1" }, "user-a");
  });
  it("opens and edits standalone Tracks without pretending they belong to a Release", async () => {
    expect((await standalone(context())).status).toBe(200);
    expect(service.getNativeTrack).toHaveBeenCalledWith("org-a", null, "track-a");
    expect((await updateStandalone(context("PATCH", { title: "Changed", expected_revision: "r1" }))).status).toBe(200);
    expect(service.updateNativeTrack).toHaveBeenCalledWith("org-a", null, "track-a", { title: "Changed", expected_revision: "r1" }, "user-a");
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "member" } });
    expect((await updateStandalone(context("PATCH", { title: "Denied", expected_revision: "r1" }))).status).toBe(403);
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "payee" } });
    expect((await standalone(context())).status).toBe(403);
  });
  it("rejects missing revisions, injected identities and Work mutations", async () => {
    for (const body of [{ expected_revision: "r1" }, { title: "Changed" }, { id: "injected", expected_revision: "r1" }, { release_id: "other", expected_revision: "r1" }, { work_id: "other", expected_revision: "r1" }]) {
      expect((await update(context("PATCH", body))).status).toBe(400);
    }
    expect(service.updateNativeTrack).not.toHaveBeenCalled();
  });
  it("allows read-only reads but denies writes and all payee reads", async () => {
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "member" } });
    expect((await detail(context())).status).toBe(200);
    expect((await update(context("PATCH", { title: "Denied", expected_revision: "r1" }))).status).toBe(403);
    expect(service.updateNativeTrack).not.toHaveBeenCalled();
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "payee" } });
    expect((await workList(context())).status).toBe(403);
    expect((await work(context())).status).toBe(403);
    expect((await detail(context())).status).toBe(403);
    expect((await list(context())).status).toBe(403);
  });
  it("distinguishes expired sessions from removed workspace access", async () => {
    native.resolveNativeActor.mockResolvedValue(null);
    for (const handler of [list, detail, update, work, workList, standalone, updateStandalone]) expect((await handler(context())).status).toBe(401);
    sessions.bearerToken.mockReturnValue("fixture-token"); sessions.getNativeSession.mockResolvedValue({ user: { id: "user-a" } });
    for (const handler of [list, detail, update, work, workList, standalone, updateStandalone]) {
      const response = await handler(context());
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "workspace_access_removed" });
    }
    expect(database.runWithDatabaseContext).not.toHaveBeenCalled();
  });
});
