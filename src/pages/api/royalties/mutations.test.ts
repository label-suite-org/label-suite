import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../../lib/db", () => ({ db: {} }));
const services = vi.hoisted(() => ({ review: vi.fn(), record: vi.fn(), reverse: vi.fn() }));
vi.mock("../../../server/royalty-statement-review", async importOriginal => ({
  ...await importOriginal<typeof import("../../../server/royalty-statement-review")>(),
  reviewRoyaltyStatement: services.review,
}));
vi.mock("../../../server/royalty-payout-recording", async importOriginal => ({
  ...await importOriginal<typeof import("../../../server/royalty-payout-recording")>(),
  recordPayoutBatch: services.record, reversePayoutBatch: services.reverse,
}));
import { POST as review } from "./statements/[id]/review";
import { POST as issue } from "./statements/[id]/issue";
import { POST as record } from "./payouts";
import { POST as reverse } from "./payouts/[id]/reverse";

const revision = { expected_updated_at: "2026-09-28T00:00:00.000Z" };
const batchId = "payout-batch:" + "a".repeat(24);
const cases = [
  { name: "review", route: review, id: "statement-a", body: revision, service: services.review },
  { name: "issue", route: issue, id: "statement-a", body: { ...revision, evidence_reference: "Reviewed source" }, service: services.review },
  { name: "record", route: record, id: batchId, body: { idempotency_key: "d29a787c-076c-4f80-8b2b-c7c371c65252", reference: "Bank record", effective_date: "2026-09-28", lines: [{ statement_id: "statement-a", amount: "1" }] }, service: services.record },
  { name: "reverse", route: reverse, id: batchId, body: { reference: "Correction", effective_date: "2026-09-28" }, service: services.reverse },
];
function context(item: typeof cases[number], locals: Record<string, unknown>, origin = "https://suite.test") {
  return { request: new Request("https://suite.test/api/royalties", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(item.body) }), params: { id: item.id }, locals } as never;
}
beforeEach(() => {
  vi.stubEnv("PUBLIC_SITE_URL", "https://suite.test");
  for (const service of Object.values(services)) service.mockReset().mockResolvedValue({ duplicate: false });
});
afterEach(() => vi.unstubAllEnvs());

it.each(cases)("$name denies unprivileged and cross-origin requests before invoking the service", async item => {
  for (const membershipRole of ["member", "payee", "fundraiser"]) {
    expect((await item.route(context(item, { orgId: "org-a", membershipRole, user: { id: "user-a" } }))).status).toBe(403);
  }
  expect((await item.route(context(item, {}))).status).toBe(403);
  expect((await item.route(context(item, { orgId: "org-a", membershipRole: "owner", user: { id: "user-a" } }, "https://foreign.test"))).status).toBe(403);
  expect(item.service).not.toHaveBeenCalled();
});

it.each(cases)("$name uses the authenticated workspace", async item => {
  const response = await item.route(context(item, { orgId: "active-workspace", membershipRole: "operator", user: { id: "user-a" } }));
  expect(response.status).toBeLessThan(300);
  expect(item.service.mock.calls[0][0]).toBe("active-workspace");
});
