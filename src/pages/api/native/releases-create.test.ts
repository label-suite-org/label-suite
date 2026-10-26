import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), create: vi.fn(), context: vi.fn(async (_value: unknown, operation: () => Promise<unknown>) => operation()) }));
vi.mock("../../../lib/native-workspace", () => ({ resolveNativeActor: mocks.actor }));
vi.mock("../../../lib/db", () => ({ db: {}, runWithDatabaseContext: mocks.context }));
vi.mock("../../../server/releases", async (original) => ({ ...await original<typeof import("../../../server/releases")>(), createReleaseForNative: mocks.create }));
import { POST } from "./releases";
import { ConflictError, NotFoundError } from "../../../server/errors";

const id = "12345678-1234-4234-8234-123456789abc";
const input = { id, title: "A new release", artist_id: "artist-a", release_date: "2027-01-15", format: "EP" };
const request = (body: unknown = input) => POST({ request: new Request("https://suite.test/api/native/releases", { method: "POST", body: JSON.stringify(body) }) } as never);

describe("native release creation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockResolvedValue({ userId: "actor-a", workspace: { org: { id: "org-a" }, role: "operator" } });
    mocks.create.mockResolvedValue({ id, ok: true, repeated: false });
  });
  it("creates through the actor's database context and acknowledges the stable identity", async () => {
    const response = await request();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id, ok: true, repeated: false });
    expect(mocks.context).toHaveBeenCalledWith({ userId: "actor-a", orgId: "org-a" }, expect.any(Function));
    expect(mocks.create).toHaveBeenCalledWith("org-a", input, "actor-a");
  });
  it("acknowledges an identical retry without treating it as a second creation", async () => {
    mocks.create.mockResolvedValue({ id, ok: true, repeated: true });
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id, repeated: true });
  });
  it("rejects absent access and read-only members before creation", async () => {
    mocks.actor.mockResolvedValueOnce(null);
    expect((await request()).status).toBe(401);
    mocks.actor.mockResolvedValueOnce({ userId: "member", workspace: { org: { id: "org-a" }, role: "member" } });
    expect((await request()).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects unknown fields, absent identity, blank title and invalid dates", async () => {
    for (const body of [{ ...input, status: "released" }, { title: input.title }, { ...input, title: " " }, { ...input, release_date: "2027-02-30" }]) {
      expect((await request(body)).status).toBe(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("retains safe conflict and relationship errors without exposing records", async () => {
    mocks.create.mockRejectedValueOnce(new ConflictError("Release identity already exists with different details"));
    expect((await request()).status).toBe(409);
    mocks.create.mockRejectedValueOnce(new NotFoundError("Artist not found"));
    expect((await request()).status).toBe(404);
  });
});
