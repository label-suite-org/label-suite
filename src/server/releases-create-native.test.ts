import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => {
  const state = { inserted: [] as any[], selected: [] as any[][] };
  const where = vi.fn(async (_condition: unknown) => state.selected.shift() ?? []);
  const values = vi.fn(() => ({ onConflictDoNothing: () => ({ returning: async () => state.inserted }) }));
  const tx = { select: () => ({ from: () => ({ where }) }), insert: () => ({ values }) };
  return { state, where, values, tx, audit: vi.fn(), readiness: vi.fn(), catalog: vi.fn(), transaction: vi.fn(async (operation: any) => operation(tx)) };
});
vi.mock("../lib/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("../lib/readiness", () => ({ persistReleaseReadiness: mocks.readiness }));
vi.mock("./catalog", () => ({ syncReleaseCatalogEntry: mocks.catalog, archiveReleaseCatalogEntry: vi.fn() }));
vi.mock("./integrations", () => ({ recordAuditEvent: mocks.audit }));
import { createReleaseForNative } from "./releases";

const input = { id: "12345678-1234-4234-8234-123456789abc", title: "New release" };
const row = { ...input, org_id: "org-a", artist_id: null, release_date: null, format: "single", status: "draft" };
describe("native release creation service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.inserted = [row]; mocks.state.selected = [];
    mocks.audit.mockResolvedValue(undefined);
  });
  it("shares canonical defaults, catalog/readiness and actor-attributed transactional audit", async () => {
    await expect(createReleaseForNative("org-a", input, "actor-a")).resolves.toEqual({ id: input.id, ok: true, repeated: false });
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining(row));
    expect(mocks.catalog).toHaveBeenCalledWith(mocks.tx, "org-a", input.id, { allowMissing: true });
    expect(mocks.readiness).toHaveBeenCalledWith(input.id, mocks.tx, "org-a");
    expect(mocks.audit).toHaveBeenCalledWith("org-a", expect.objectContaining({ actor_user_id: "actor-a", event_type: "release.created", object_id: input.id }), mocks.tx);
  });
  it("returns an identical collision as a replay with no secondary writes", async () => {
    mocks.state.inserted = []; mocks.state.selected = [ [row] ];
    await expect(createReleaseForNative("org-a", input, "actor-a")).resolves.toMatchObject({ id: input.id, repeated: true });
    expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.readiness).not.toHaveBeenCalled(); expect(mocks.catalog).not.toHaveBeenCalled();
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0] as never);
    expect(query.params).toEqual([input.id, "org-a"]);
  });
  it("rejects differing details or an ID outside the workspace without secondary writes", async () => {
    mocks.state.inserted = [];
    for (const existing of [[{ ...row, title: "Changed by another editor" }], []]) {
      mocks.state.selected = [existing];
      await expect(createReleaseForNative("org-a", input, "actor-a")).rejects.toMatchObject({ status: 409 });
    }
    expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.catalog).not.toHaveBeenCalled();
  });
  it("rejects an artist outside the workspace before inserting", async () => {
    mocks.state.selected = [[]];
    await expect(createReleaseForNative("org-a", { ...input, artist_id: "foreign-artist" }, "actor-a")).rejects.toMatchObject({ status: 404 });
    expect(mocks.values).not.toHaveBeenCalled();
    expect(new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0] as never).params).toEqual(["foreign-artist", "org-a"]);
  });
  it("propagates audit failure through the creation transaction", async () => {
    mocks.audit.mockRejectedValueOnce(new Error("synthetic audit failure"));
    await expect(createReleaseForNative("org-a", input, "actor-a")).rejects.toThrow("synthetic audit failure");
  });
});
