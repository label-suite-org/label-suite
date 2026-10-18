import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn(), end: vi.fn() }));
vi.mock("../src/lib/db", () => ({ pool: { connect: mocks.connect, end: mocks.end } }));
vi.mock("../src/server/gmail-enrichment", () => ({ sealSecret: vi.fn() }));
const revision = "2026-10-01T00:00:00.000Z";
const stay = { source: "fixture-stay", title: "Confirmed hotel", address: "Fixture address", checkIn: "2026-10-20", checkOut: "2026-10-21", status: "confirmed", reference: "fixture", notes: "Cost in ledger once", estimatedCost: 8000, existingId: "lodging", expectedUpdatedAt: revision };
const day = { event: "event", expectedDate: "2026-10-20", expectedNotes: "Old notes", notes: "Imported itinerary" };
let directory: string, path: string;
const originalArgs = [...process.argv], originalExit = process.exitCode;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), "tour-bundle-test-")); path = join(directory, "bundle.json");
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
});
afterEach(async () => { process.argv = originalArgs; process.exitCode = originalExit; vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });
async function bundle(extra = {}) {
  await writeFile(path, JSON.stringify({ org: "fixture-org", project: "fixture-tour", entries: [], stays: [stay], itinerary: [day], ...extra }), { mode: 0o600 });
  process.argv = ["node", "import-tour-bundle.ts", path];
}
function respond(prior: Record<string, unknown>, notes = "Old notes") {
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("select id,currency")) return { rows: [{ id: "fixture-tour", currency: "USD" }] };
    if (sql.startsWith("select id from label_suite.tour_lodging")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("select *,check_in")) return { rows: [prior] };
    if (sql.startsWith("select title,status,notes")) return { rows: [{ title: "Show", status: "confirmed", notes }] };
    return { rows: [], rowCount: 1 };
  });
}
describe("private tour bundle import", () => {
  it("updates mapped lodging and itinerary but rolls back by default", async () => {
    await bundle(); respond({ updated_at: revision, stop_name: "Old placeholder" });
    await import("./import-tour-bundle");
    const sql = mocks.query.mock.calls.map(c => c[0]);
    expect(sql.filter(s => s.startsWith("update label_suite.tour_lodging"))).toHaveLength(1);
    expect(sql.filter(s => s.startsWith("update label_suite.project_events"))).toHaveLength(1);
    expect(sql.at(-1)).toBe("rollback"); expect(process.exitCode).toBeUndefined();
  });
  it("aborts changed lodging before overwriting it", async () => {
    await bundle(); respond({ updated_at: "2026-10-02T00:00:00Z", stop_name: "New user edit" });
    await import("./import-tour-bundle");
    expect(mocks.query.mock.calls.some(c => c[0].startsWith("update label_suite.tour_lodging"))).toBe(false);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("rollback"); expect(process.exitCode).toBe(1);
  });
  it("repeated imports preserve the same lodging and itinerary without new writes", async () => {
    await bundle(); process.argv.push("--apply");
    respond({ stop_name: stay.title, address: stay.address, arrival: stay.checkIn, departure: stay.checkOut, booking_status: stay.status, booking_reference: stay.reference, notes: stay.notes, estimated_cost: 80, updated_at: "2026-10-02T00:00:00Z" }, day.notes);
    await import("./import-tour-bundle");
    expect(mocks.query.mock.calls.some(c => /^(update|insert)/.test(c[0]))).toBe(false);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("commit"); expect(process.exitCode).toBeUndefined();
  });
  it("refuses an unresolved financial draft before opening a database connection", async () => {
    await bundle({ unresolved: ["Commission overlap unresolved"] });
    await expect(import("./import-tour-bundle")).rejects.toThrow(/unresolved/);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
