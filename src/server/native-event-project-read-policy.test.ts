import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./errors";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn(), context: vi.fn(async (_: unknown, operation: () => unknown) => operation()) }));
vi.mock("../lib/native-workspace", () => ({ resolveNativeActor: mocks.actor }));
vi.mock("../lib/db", () => ({ runWithDatabaseContext: mocks.context }));
vi.mock("./native-events-projects", () => ({
  listNativeEvents: mocks.read, getNativeEventDetail: mocks.read,
  listNativeProjects: mocks.read, getNativeProjectDetail: mocks.read,
  createNativeEvent: vi.fn(), updateNativeEvent: vi.fn(), createNativeProject: vi.fn(), updateNativeProject: vi.fn(),
  nativeCreateEventSchema: {}, nativeUpdateEventSchema: {}, nativeCreateProjectSchema: {}, nativeUpdateProjectSchema: {},
}));
import { GET as events } from "../pages/api/native/events";
import { GET as event } from "../pages/api/native/events/[id]";
import { GET as projects } from "../pages/api/native/projects";
import { GET as project } from "../pages/api/native/projects/[id]";
const routes = [events, event, projects, project];
const context = () => ({ request: new Request("https://suite.test/api/native/records?workspaceId=org-a"), params: { id: "record-a" } }) as never;
describe("native Event/Project read authorization and async errors", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.actor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "member" } }); mocks.read.mockResolvedValue({ id: "record-a" }); });
  it.each(routes)("denies payee before any record read (%#)", async route => {
    mocks.actor.mockResolvedValue({ userId: "payee", workspace: { org: { id: "org-a" }, role: "payee" } });
    const response = await route(context());
    expect(response.status).toBe(403); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled();
  });
  it.each(routes)("allows a read-only member (%#)", async route => {
    expect((await route(context())).status).toBe(200);
    expect(mocks.context).toHaveBeenCalledWith({ userId: "user-a", orgId: "org-a" }, expect.any(Function));
  });
  it.each(routes)("serializes an asynchronous invalid-cursor response (%#)", async route => {
    mocks.read.mockRejectedValueOnce(new HttpError("Invalid cursor", 400));
    expect((await route(context())).status).toBe(400);
  });
});
