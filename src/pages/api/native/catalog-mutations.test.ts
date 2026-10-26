import { beforeEach, expect, it, vi } from "vitest";
const actor = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const context = vi.hoisted(() => ({
  db: {},
  runWithDatabaseContext: vi.fn(async (_: unknown, fn: () => unknown) => fn()),
}));
const tracks = vi.hoisted(() => ({
  createNativeTrack: vi.fn(),
  updateNativeTrack: vi.fn(),
}));
const works = vi.hoisted(() => ({ updateNativeWork: vi.fn() }));
vi.mock("../../../lib/native-workspace", () => actor);
vi.mock("../../../lib/native-session", () => ({
  bearerToken: () => null,
  getNativeSession: vi.fn(),
}));
vi.mock("../../../lib/db", () => context);
vi.mock("../../../server/native-tracks", async (original) => ({
  ...(await original<typeof import("../../../server/native-tracks")>()),
  ...tracks,
}));
vi.mock("../../../server/native-works", async (original) => ({
  ...(await original<typeof import("../../../server/native-works")>()),
  ...works,
}));
import { POST } from "./releases/[id]/tracks";
import { PATCH as updateTrack } from "./releases/[id]/tracks/[trackId]";
import { PATCH as updateWork } from "./works/[id]";
const id = "0b294979-e711-4db0-b840-26f959198cd2";
const input = {
  id,
  title: "New track",
  work: { kind: "existing", id: "work" },
};
const request = (method: string, body: unknown) =>
  ({
    params: { id: "release", trackId: id },
    request: new Request(
      "https://fixture.test/api/native/releases/release/tracks?workspaceId=foreign",
      {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  }) as never;
beforeEach(() => {
  vi.clearAllMocks();
  actor.resolveNativeActor.mockResolvedValue({
    userId: "actor",
    workspace: { org: { id: "org" }, role: "operator" },
  });
  tracks.createNativeTrack.mockResolvedValue({
    ok: true,
    id,
    release_id: "release",
    work_id: "work",
  });
  tracks.updateNativeTrack.mockResolvedValue({ track: { id } });
  works.updateNativeWork.mockResolvedValue({
    ok: true,
    id: "release",
    revision: "r2",
  });
});
it("uses canonical actor/context and strict explicit Work creation shape", async () => {
  expect((await POST(request("POST", input))).status).toBe(201);
  expect(tracks.createNativeTrack).toHaveBeenCalledWith(
    "org",
    "release",
    {
      ...input,
      position: null,
      version: null,
      audio_url: null,
      duration: null,
    },
    "actor",
  );
  expect(context.runWithDatabaseContext).toHaveBeenCalledWith(
    { userId: "actor", orgId: "org" },
    expect.any(Function),
  );
  expect(
    (
      await updateTrack(
        request("PATCH", {
          expected_revision: "r1",
          work_id: "work",
          audio_url: "asset-key",
        }),
      )
    ).status,
  ).toBe(200);
  expect(tracks.updateNativeTrack).toHaveBeenCalledWith(
    "org",
    "release",
    id,
    { expected_revision: "r1", work_id: "work", audio_url: "asset-key" },
    "actor",
  );
  expect(
    (
      await updateWork(
        request("PATCH", { expected_revision: "r1", genre: null }),
      )
    ).status,
  ).toBe(200);
  expect(works.updateNativeWork).toHaveBeenCalledWith(
    "org",
    "release",
    { expected_revision: "r1", genre: null },
    "actor",
  );
});
it.each([
  { ...input, id: "bad" },
  { ...input, org_id: "other" },
  { ...input, work: undefined },
  { ...input, work: { kind: "existing", id: "work", title: "ignored?" } },
  {
    ...input,
    work: {
      kind: "new",
      id,
      title: "Work",
      isrc: "DKAAA2600001",
      auto_isrc: true,
    },
  },
  { ...input, position: 0 },
])("rejects unsafe creation without calling service", async (body) => {
  expect((await POST(request("POST", body))).status).toBe(400);
  expect(tracks.createNativeTrack).not.toHaveBeenCalled();
});
it.each([
  { title: "Missing revision" },
  { expected_revision: "r1" },
  { expected_revision: "r1", alt_isrcs: "Unknown metadata" },
])("rejects unsafe Work patches", async (body) => {
  expect((await updateWork(request("PATCH", body))).status).toBe(400);
  expect(works.updateNativeWork).not.toHaveBeenCalled();
});
it("denies member writes and propagates conflict without acknowledging", async () => {
  actor.resolveNativeActor.mockResolvedValue({
    userId: "member",
    workspace: { org: { id: "org" }, role: "member" },
  });
  expect((await POST(request("POST", input))).status).toBe(403);
  expect(
    (
      await updateWork(
        request("PATCH", { expected_revision: "r1", title: "No" }),
      )
    ).status,
  ).toBe(403);
  expect(tracks.createNativeTrack).not.toHaveBeenCalled();
  expect(works.updateNativeWork).not.toHaveBeenCalled();
  actor.resolveNativeActor.mockResolvedValue({
    userId: "actor",
    workspace: { org: { id: "org" }, role: "operator" },
  });
  const { ConflictError } = await import("../../../server/errors");
  tracks.createNativeTrack.mockRejectedValueOnce(new ConflictError("Changed"));
  expect((await POST(request("POST", input))).status).toBe(409);
});
