import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const database = vi.hoisted(() => ({
  runWithDatabaseContext: vi.fn(async (_context: unknown, operation: () => Promise<unknown>) => operation()),
}));
const artists = vi.hoisted(() => ({
  createArtist: vi.fn(),
  createArtistForNative: vi.fn(),
  createArtistSchema: undefined,
  nativeCreateArtistSchema: undefined,
  getArtistDetail: vi.fn(),
  nativeUpdateArtistSchema: undefined,
  updateArtistForNative: vi.fn(),
}));
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn() }));

vi.mock("../../../../lib/native-workspace", () => native);
vi.mock("../../../../lib/db", () => database);
vi.mock("../../../../server/artists", async () => {
  const { z } = await import("zod");
  return {
    ...artists,
    createArtistSchema: z.object({ name: z.string().trim().min(1), id: z.string().optional() }).passthrough(),
    nativeCreateArtistSchema: z.object({ name: z.string().trim().min(1) }).strict(),
    nativeUpdateArtistSchema: z.object({ name: z.string().optional(), relationship: z.string().nullable().optional(), expected_updated_at: z.string().datetime() }).passthrough(),
  };
});
vi.mock("../../../../server/integrations", () => audit);

import { PATCH } from "./[id]";
import { POST } from "../artists";

const detail = {
  artist: {
    id: "artist-a", name: "Artist A", image_url: null, updated_at: new Date("2026-08-15T10:00:00.000Z"),
    bio: "A bio", spotify_id: null, spotify_followers: null, spotify_popularity: null, pro: null, ipi: null,
    instagram: null, tiktok: null, relationship: "roster", contact_id: null,
  },
  releases: [], campaigns: [], mediaAssets: [], documents: [], rights: [], tasks: [], primaryContact: null,
};

describe("native artist mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.resolveNativeActor.mockResolvedValue({ workspace: { org: { id: "org-a" }, role: "operator" }, userId: "user-a" });
    artists.getArtistDetail.mockResolvedValue(detail);
    artists.createArtistForNative.mockResolvedValue({ id: "artist-new", ok: true });
    artists.updateArtistForNative.mockResolvedValue({ id: "artist-a" });
    audit.recordAuditEvent.mockResolvedValue({ id: "audit-a" });
  });

  const request = (method: string, path: string, body: unknown) => new Request(`https://suite.test${path}?workspaceId=org-a`, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

  it("creates an artist only for an operator and returns its canonical detail", async () => {
    const response = await POST({ request: request("POST", "/api/native/artists", { name: "New Artist" }) } as never);
    expect(response.status).toBe(201);
    expect(artists.createArtistForNative).toHaveBeenCalledWith("org-a", { name: "New Artist" }, "user-a");

    const clientSuppliedID = await POST({ request: request("POST", "/api/native/artists", { id: "client-id", name: "No ID" }) } as never);
    expect(clientSuppliedID.status).toBe(400);
    expect(artists.createArtistForNative).toHaveBeenCalledTimes(1);
  });

  it("requires capability and loaded revision for an identity or relationship edit", async () => {
    const body = { name: "Renamed", relationship: "collaborator", expected_updated_at: "2026-08-15T10:00:00.000Z" };
    const response = await PATCH({ request: request("PATCH", "/api/native/artists/artist-a", body), params: { id: "artist-a" } } as never);
    expect(response.status).toBe(200);
    expect(artists.updateArtistForNative).toHaveBeenCalledWith("org-a", { ...body, id: "artist-a" }, "user-a");

    const missingRevision = await PATCH({ request: request("PATCH", "/api/native/artists/artist-a", { name: "Renamed" }), params: { id: "artist-a" } } as never);
    expect(missingRevision.status).toBe(400);
    expect(artists.updateArtistForNative).toHaveBeenCalledTimes(1);
  });

  it("does not invoke mutation services for read-only members", async () => {
    native.resolveNativeActor.mockResolvedValue({ workspace: { org: { id: "org-a" }, role: "member" }, userId: "user-a" });
    const response = await PATCH({ request: request("PATCH", "/api/native/artists/artist-a", { name: "Nope", expected_updated_at: "2026-08-15T10:00:00.000Z" }), params: { id: "artist-a" } } as never);
    expect(response.status).toBe(403);
    expect(artists.updateArtistForNative).not.toHaveBeenCalled();
  });
});
