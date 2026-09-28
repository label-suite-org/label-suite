import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lock: vi.fn(), evidence: vi.fn(), update: vi.fn() }));
vi.mock("../lib/db", () => {
  const query = { from: vi.fn(), where: vi.fn(), for: mocks.lock };
  query.from.mockReturnValue(query); query.where.mockReturnValue(query);
  const tx = { select: () => query, execute: mocks.evidence, update: mocks.update };
  return { db: { transaction: (fn: (tx: unknown) => unknown) => fn(tx) } };
});
import { reviewRoyaltyStatement } from "./royalty-statement-review";
const stamp = "2026-09-28T00:00:00.000Z";
beforeEach(() => { vi.clearAllMocks(); mocks.lock.mockResolvedValue([{ status: "calculated", period_start: "2026-08-01", period_end: "2026-08-31", updated_at: new Date(stamp) }]); });
it("rejects missing workspace statements before mutation", async () => {
  mocks.lock.mockResolvedValue([]);
  await expect(reviewRoyaltyStatement("org", "foreign", stamp)).rejects.toMatchObject({ status: 404 });
  expect(mocks.update).not.toHaveBeenCalled();
});
it("rejects stale review input before evaluating evidence", async () => {
  await expect(reviewRoyaltyStatement("org", "statement", "2020-01-01T00:00:00.000Z")).rejects.toMatchObject({ status: 409 });
  expect(mocks.evidence).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});
it("does not mark unverified evidence as reviewed", async () => {
  mocks.evidence.mockResolvedValue({ rows: [{ valid: false }] });
  await expect(reviewRoyaltyStatement("org", "statement", stamp)).rejects.toMatchObject({ status: 409 });
  expect(mocks.update).not.toHaveBeenCalled();
});
