import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => {
  const state = { current: null as any, result: [] as any[] };
  const predicate = vi.fn((_condition: unknown) => ({ returning: async () => state.result }));
  const set = vi.fn(() => ({ where: predicate }));
  const tx = { select: vi.fn(() => ({ from: () => ({ where: async () => state.current ? [state.current] : [] }) })), update: vi.fn(() => ({ set })) };
  return { state, predicate, set, tx, audit: vi.fn(), readiness: vi.fn(), catalog: vi.fn(), transaction: vi.fn(async (fn: any) => fn(tx)) };
});
vi.mock("../lib/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("../lib/readiness", () => ({ persistReleaseReadiness: mocks.readiness }));
vi.mock("./catalog", () => ({ syncReleaseCatalogEntry: mocks.catalog, archiveReleaseCatalogEntry: vi.fn() }));
vi.mock("./integrations", () => ({ recordAuditEvent: mocks.audit }));
import { nativeUpdateReleaseSchema, updateReleaseForNative } from "./releases";

const revision = "2026-09-16T12:00:00.000Z";
describe("native release revision service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.audit.mockResolvedValue(undefined);
    mocks.state.current = { id: "release-a", org_id: "org-a", title: "Before", format: "single", parent_release_id: null, updated_at: new Date(revision) };
    mocks.state.result = [{ ...mocks.state.current, title: "After", updated_at: new Date("2026-09-16T12:01:00Z") }];
  });
  it("rejects client-selected IDs and requires an explicit revision", () => {
    expect(nativeUpdateReleaseSchema.safeParse({ id: "forged", title: "After", expected_updated_at: revision }).success).toBe(false);
    expect(nativeUpdateReleaseSchema.safeParse({ title: "After" }).success).toBe(false);
  });
  it("rejects absent and stale records before mutation", async () => {
    await expect(updateReleaseForNative("org-a", { id: "release-a", expected_updated_at: "2026-09-15T12:00:00Z" }, "actor")).rejects.toThrow("refresh and retry");
    expect(mocks.set).not.toHaveBeenCalled();
    mocks.state.current = null;
    await expect(updateReleaseForNative("org-a", { id: "release-a", expected_updated_at: revision }, "actor")).rejects.toThrow("not found");
  });
  it("atomically predicates the write on workspace, identity and revision", async () => {
    await updateReleaseForNative("org-a", { id: "release-a", title: "After", expected_updated_at: revision }, "actor");
    const query = new PgDialect().sqlToQuery(mocks.predicate.mock.calls[0][0] as never);
    expect(query.sql).toContain("date_trunc('milliseconds'");
    expect(query.params).toEqual(expect.arrayContaining(["org-a", "release-a", revision]));
    expect(mocks.readiness).toHaveBeenCalledWith("release-a", mocks.tx, "org-a");
    expect(mocks.catalog).toHaveBeenCalledWith(mocks.tx, "org-a", "release-a", { allowMissing: true });
    expect(mocks.audit).toHaveBeenCalledWith("org-a", expect.objectContaining({ actor_user_id: "actor", event_type: "release.updated", before: expect.objectContaining({ title: "Before" }), after: expect.objectContaining({ title: "After" }) }), mocks.tx);
  });
  it("rejects a raced update without readiness or audit writes", async () => {
    mocks.state.result = [];
    await expect(updateReleaseForNative("org-a", { id: "release-a", expected_updated_at: revision }, "actor")).rejects.toThrow("refresh and retry");
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.readiness).not.toHaveBeenCalled();
  });
  it("propagates audit failure out of the transaction instead of claiming success", async () => {
    mocks.audit.mockRejectedValueOnce(new Error("synthetic audit failure"));
    await expect(updateReleaseForNative("org-a", { id: "release-a", expected_updated_at: revision }, "actor")).rejects.toThrow("synthetic audit failure");
  });
});
