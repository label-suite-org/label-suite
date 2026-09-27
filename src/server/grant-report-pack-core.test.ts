import { describe, expect, it } from "vitest";
import { buildGrantReportPack } from "./grant-report-pack-core";

describe("grant report pack", () => {
  it("lists allocated budget lines, receipts, and completeness warnings", () => {
    const pack = buildGrantReportPack({
      applicationId: "app-1",
      awardAmount: 50_000,
      restrictedTo: "production",
      lines: [
        { id: "line-1", name: "Studio", category: "production", planned: 30_000, committed: 25_000, paid: 20_000, documents: [{ id: "doc-1", name: "Invoice", linkType: "receipt", downloadUrl: "/receipt.pdf" }] },
        { id: "line-2", name: "Ads", category: "marketing", planned: 10_000, committed: 10_000, paid: 5_000, documents: [] },
      ],
    });

    expect(pack.lines).toEqual([
      expect.objectContaining({ id: "line-1", actual: 20_000, variance: 10_000 }),
      expect.objectContaining({ id: "line-2", actual: 5_000, variance: 5_000 }),
    ]);
    expect(pack.spendToDate).toBe(25_000);
    expect(pack.receiptCompleteness).toMatchObject({ paidLines: 2, paidLinesWithReceipts: 1, paidLinesWithoutReceipts: 1 });
    expect(pack.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_receipt", lineId: "line-2" }),
      expect.objectContaining({ code: "outside_restricted_use", lineId: "line-2" }),
    ]));
  });

  it("deduplicates lines reached through multiple funding needs", () => {
    const pack = buildGrantReportPack({
      applicationId: "app-2", awardAmount: 20_000, restrictedTo: null,
      lines: [
        { id: "line-1", name: "Mix", category: "production", planned: 20_000, committed: 0, paid: 0, documents: [] },
        { id: "line-1", name: "Mix", category: "production", planned: 20_000, committed: 0, paid: 0, documents: [] },
      ],
    });
    expect(pack.lines).toHaveLength(1);
  });
});
