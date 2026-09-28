import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./download";
import { writeAuditLog } from "../../../../../server/audit";

vi.mock("../../../../../lib/db", () => ({ db: {}, runWithDatabaseContext: vi.fn() }));
vi.mock("../../../../../server/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../../../../../server/payee-portal", () => ({
  getPayeeStatementDownload: vi.fn().mockResolvedValue({
    id: "statement-1", periodStart: "2026-01-01", periodEnd: "2026-01-31",
    currency: "EUR", status: "issued", earningsAmount: "123.45", adjustmentsAmount: "0",
    payoutAmount: "0", closingBalance: "123.45", lines: [],
  }),
}));
vi.mock("../../../../../server/observability", () => ({ logEvent: vi.fn() }));

beforeEach(() => vi.mocked(writeAuditLog).mockReset());

it("releases a statement only after its sensitive-read audit succeeds", async () => {
  const context = {
    locals: { orgId: "org-1", membershipRole: "payee", user: { id: "payee-1", email: "payee@example.test" } },
    params: { id: "statement-1" },
  };
  vi.mocked(writeAuditLog).mockRejectedValueOnce(new Error("Audit unavailable"));
  const denied = await GET(context as never);
  expect(denied.status).toBe(503);
  expect(await denied.text()).not.toContain("123.45");
  expect(denied.headers.get("content-disposition")).toBeNull();

  vi.mocked(writeAuditLog).mockResolvedValueOnce();
  const allowed = await GET(context as never);
  expect(allowed.status).toBe(200);
  expect(await allowed.text()).toContain("123.45");
  expect(writeAuditLog).toHaveBeenLastCalledWith(expect.objectContaining({
    orgId: "org-1", actorUserId: "payee-1", action: "payee_portal.statement_download", entityId: "statement-1",
  }));
});
