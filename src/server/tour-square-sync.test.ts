import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), enqueue: vi.fn(), fetch: vi.fn() }));
vi.mock("../lib/db", () => ({ pool: { connect: async () => ({ query: state.query, release: state.release }), query: state.query } }));
vi.mock("./gmail-enrichment", () => ({ sealSecret: (s: string) => s, openSecret: (s: string) => s }));
vi.mock("./jobs", () => ({ jobStore: { enqueue: state.enqueue } }));
import { enqueueTourSquareSyncs, syncTourSquare } from "./tour-square-sync";
const connection = { merchant_id: "merchant", client_id: "client", encrypted_token: JSON.stringify({ access_token: "fixture-token", refresh_token: "fixture-refresh", expires_at: "2099-10-01T00:00:00Z", refreshed_at: new Date().toISOString() }), begin_at: new Date("2026-10-01Z"), end_at: new Date("2026-11-01Z") };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", state.fetch);
  state.query.mockImplementation(async (sql: string) => {
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
    if (sql.includes("select c.*")) return { rows: [connection] };
    return { rows: [], rowCount: 0 };
  });
  state.fetch.mockImplementation(async (url: string) => Response.json(url.endsWith("locations") ? { locations: [{ id: "location" }] } : { payments: [] }));
});
it("schedules with stable five-minute identities", async () => {
  state.query.mockResolvedValue({ rows: [{ org_id: "org", project_id: "tour" }] });
  await enqueueTourSquareSyncs(new Date("2026-10-01T10:01:00Z"));
  await enqueueTourSquareSyncs(new Date("2026-10-01T10:04:00Z"));
  expect(state.enqueue.mock.calls[0][0].idempotencyKey).toBe(state.enqueue.mock.calls[1][0].idempotencyKey);
});
it("serializes sync and does not fetch when another worker holds the lock", async () => {
  state.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("pg_try_advisory_lock") ? [{ acquired: false }] : [] }));
  expect(await syncTourSquare("org", "tour", new AbortController().signal)).toEqual({ skipped: "already_running" });
  expect(state.fetch).not.toHaveBeenCalled(); expect(state.release).toHaveBeenCalled();
});
it("records success only after a complete fetch and a committed ledger", async () => {
  expect(await syncTourSquare("org", "tour", new AbortController().signal)).toMatchObject({ changed: 0, verified: 0, held: 0 });
  const queries = state.query.mock.calls.map(c => c[0] as string);
  expect(queries.indexOf("commit")).toBeGreaterThan(queries.findIndex(q => q.includes("last_success_at=now()")));
  expect(queries).toContain("reset app.current_org_id");
});
it("does not mark a failed fetch successful or leak response bodies", async () => {
  state.fetch.mockResolvedValue(new Response("secret-provider-details", { status: 401 }));
  await expect(syncTourSquare("org", "tour", new AbortController().signal)).rejects.toThrow("Square access expired");
  expect(state.query.mock.calls.some(c => c[0].includes("last_success_at=now()"))).toBe(false);
  expect(JSON.stringify(state.query.mock.calls)).not.toContain("secret-provider-details");
});
