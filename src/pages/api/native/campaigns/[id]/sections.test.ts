import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeSession = vi.hoisted(() => ({ getNativeSession: vi.fn() }));
vi.mock("../../../../../lib/native-session", () => ({
  getNativeSession: nativeSession.getNativeSession,
  bearerToken: (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null,
}));

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const database = vi.hoisted(() => ({
  runWithDatabaseContext: vi.fn(async (_context: unknown, operation: () => Promise<unknown>) => operation()),
}));
const sections = vi.hoisted(() => ({
  getNativeCampaignSections: vi.fn(),
  mutateNativeCampaignSections: vi.fn(),
}));

vi.mock("../../../../../lib/native-workspace", () => native);
vi.mock("../../../../../lib/db", () => database);
vi.mock("../../../../../server/campaign-sections", async () => {
  const { z } = await import("zod");
  return {
    ...sections,
    nativeCampaignSectionsMutationSchema: z.discriminatedUnion("action", [
      z.object({ action: z.literal("select_template"), template_id: z.string().nullable(), expected_revision: z.number().int().positive() }).strict(),
      z.object({ action: z.literal("attach_audience"), audience_id: z.string(), expected_revision: z.number().int().positive() }).strict(),
      z.object({ action: z.literal("detach_audience"), expected_revision: z.number().int().positive() }).strict(),
    ]),
  };
});

import { GET, POST } from "./sections";
import { HttpError } from "../../../../../server/errors";

const actor = { workspace: { org: { id: "org-a" }, role: "operator" }, userId: "user-a" };
const request = (method: string, body?: unknown) => new Request("https://suite.test/api/native/campaigns/campaign-a/sections?workspaceId=spoofed", {
  method,
  headers: body === undefined ? undefined : { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe("native campaign sections route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeSession.getNativeSession.mockResolvedValue(null);
    native.resolveNativeActor.mockResolvedValue(actor);
    sections.getNativeCampaignSections.mockResolvedValue({ campaign: { id: "campaign-a", revision: 4 }, channels: { available: false, reason: "not_configured" } });
    sections.mutateNativeCampaignSections.mockResolvedValue({ campaign: { id: "campaign-a", revision: 5 }, consequences: { can_send: false, send_performed: false } });
  });

  it("serializes asynchronous missing-record and revision failures", async () => {
    sections.getNativeCampaignSections.mockRejectedValueOnce(new HttpError("Campaign not found", 404));
    const missing = await GET({ request: request("GET"), params: { id: "campaign-a" } } as never);
    expect(missing.status).toBe(404);
    sections.mutateNativeCampaignSections.mockRejectedValueOnce(new HttpError("Campaign changed", 409));
    const conflict = await POST({ request: request("POST", { action: "detach_audience", expected_revision: 4 }), params: { id: "campaign-a" } } as never);
    expect(conflict.status).toBe(409);
  });

  it("reads sections through the bearer workspace and keeps channels explicitly unavailable", async () => {
    const response = await GET({ request: request("GET"), params: { id: "campaign-a" } } as never);
    expect(response.status).toBe(200);
    expect(sections.getNativeCampaignSections).toHaveBeenCalledWith("org-a", "campaign-a");
    await expect(response.json()).resolves.toMatchObject({ channels: { available: false, reason: "not_configured" } });
  });

  it("denies a payee before the campaign sections service is queried", async () => {
    native.resolveNativeActor.mockResolvedValue({ ...actor, workspace: { ...actor.workspace, role: "payee" } });

    const response = await GET({ request: request("GET"), params: { id: "campaign-a" } } as never);

    expect(response.status).toBe(403);
    expect(sections.getNativeCampaignSections).not.toHaveBeenCalled();
  });

  it("permits only an operator to make a revision-checked no-send selection", async () => {
    const body = { action: "select_template", template_id: "template-a", expected_revision: 4 };
    const response = await POST({ request: request("POST", body), params: { id: "campaign-a" } } as never);
    expect(response.status).toBe(200);
    expect(sections.mutateNativeCampaignSections).toHaveBeenCalledWith("org-a", "campaign-a", body, "user-a");
    await expect(response.json()).resolves.toMatchObject({ consequences: { can_send: false, send_performed: false } });
  });

  it("rejects read-only roles and unguarded mutations before the service", async () => {
    native.resolveNativeActor.mockResolvedValue({ ...actor, workspace: { ...actor.workspace, role: "member" } });
    const denied = await POST({ request: request("POST", { action: "detach_audience", expected_revision: 4 }), params: { id: "campaign-a" } } as never);
    expect(denied.status).toBe(403);
    expect(sections.mutateNativeCampaignSections).not.toHaveBeenCalled();

    native.resolveNativeActor.mockResolvedValue(actor);
    const invalid = await POST({ request: request("POST", { action: "detach_audience" }), params: { id: "campaign-a" } } as never);
    expect(invalid.status).toBe(400);
    expect(sections.mutateNativeCampaignSections).not.toHaveBeenCalled();
  });
});

it.each([GET, POST])("distinguishes revoked membership from expired authentication", async (handler) => {
  vi.clearAllMocks();
  native.resolveNativeActor.mockResolvedValue(null);
  nativeSession.getNativeSession.mockResolvedValue({ user: { id: "user-a" } });
  const invoke = () => handler({ request: new Request("https://suite.test/api/native/campaigns/campaign-a?workspaceId=org-a", { headers: { authorization: "Bearer valid-token" } }), params: { id: "campaign-a" } } as never);
  const revoked = await invoke();
  expect(revoked.status).toBe(403);
  await expect(revoked.json()).resolves.toMatchObject({ code: "workspace_access_removed" });
  nativeSession.getNativeSession.mockResolvedValue(null);
  expect((await invoke()).status).toBe(401);
  expect(database.runWithDatabaseContext).not.toHaveBeenCalled();
});
