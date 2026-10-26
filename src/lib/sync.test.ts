import { describe, it, expect } from "vitest";
import {
  syncSaveSchema,
  syncDraft,
  revisedSyncDetails,
  syncMoney,
  receiptSchema,
} from "./sync";
function fixture() {
  return syncSaveSchema.parse({
    id: crypto.randomUUID(),
    expected_version: 0,
    production: "Fixture film",
    details: {
      ...syncDraft(),
      recording_title: "Fixture cover",
      version_name: "Instrumental",
      provenance: "Synthetic test",
      fee_amount: "25000",
    },
  });
}
describe("sync deal evidence and money", () => {
  it("preserves reported fees without inventing currency, scope or clearance", () => {
    const input = fixture();
    expect(input.details.currency).toBe("");
    expect(input.details.fee_basis).toBe("unknown");
    expect(revisedSyncDetails(null, input).publishing_status).toBe("unknown");
    expect(syncMoney(input.details, [])).toEqual({
      totals: {},
      balance: null,
      status: "unknown",
    });
  });
  it("reopens material approvals and retains the earlier signed snapshot", () => {
    const before = fixture();
    Object.assign(before.details, {
      master_status: "approved",
      master_evidence: "Artist approval",
      authority: "Recording agreement",
      publishing_status: "approved",
      publishing_evidence: "Publisher email",
      contract_status: "signed",
      contract_document_id: "doc",
      signed_date: "2026-10-25",
      commercial_status: "accepted_in_principle",
    });
    const next = structuredClone(before);
    next.details.promotion = "Standalone trailer";
    const revised = revisedSyncDetails(before, next);
    expect(revised.master_status).toBe("pending");
    expect(revised.publishing_status).toBe("pending");
    expect(revised.contract_status).toBe("needs_review");
    expect(before.details.contract_status).toBe("signed");
  });
  it("allows a signed master while publishing remains unknown, but requires signature evidence", () => {
    const input = fixture();
    input.details.contract_status = "signed";
    expect(() => revisedSyncDetails(null, input)).toThrow(/document/);
    input.details.contract_document_id = "doc";
    input.details.signed_date = "2026-10-25";
    expect(revisedSyncDetails(null, input).publishing_status).toBe("unknown");
    input.details.master_status = "approved";
    expect(() => revisedSyncDetails(null, input)).toThrow(/authority/);
  });
  it("tracks partial receipts exactly and does not combine currencies or allocate an all-in fee", () => {
    const input = fixture();
    Object.assign(input.details, {
      currency: "USD",
      fee_basis: "master_only",
      commercial_status: "accepted_in_principle",
    });
    const receipts = [
      { amount: "10000.10", currency: "USD" },
      { amount: "0.20", currency: "USD" },
      { amount: "100", currency: "EUR" },
    ];
    expect(syncMoney(input.details, receipts)).toEqual({
      totals: { USD: "10000.3", EUR: "100" },
      balance: "14999.7",
      status: "part_received",
    });
    input.details.fee_basis = "all_in";
    expect(syncMoney(input.details, receipts).balance).toBeNull();
    expect(
      receiptSchema.safeParse({
        id: crypto.randomUUID(),
        deal_id: input.id,
        amount: "0",
        currency: "USD",
        received_date: "2026-10-25",
        reference: "fixture",
      }).success,
    ).toBe(false);
  });
  it("requires delivery of an identified file and settlement evidence", () => {
    const input = fixture();
    input.details.delivery_status = "delivered";
    expect(() => revisedSyncDetails(null, input)).toThrow(/exact file/);
    Object.assign(input.details, {
      delivery_file: "fixture-instrumental.wav",
      delivery_date: "2026-10-25",
      delivery_recipient: "Music supervisor",
      delivery_evidence: "Delivery receipt",
    });
    expect(revisedSyncDetails(null, input).version_name).toBe("Instrumental");
    const changed = structuredClone(input);
    changed.details.version_name = "Alternate instrumental";
    const revision = revisedSyncDetails(input, changed);
    expect(revision.delivery_status).toBe("pending");
    expect(input.details.delivery_status).toBe("delivered");
    input.details.settlement_status = "paid";
    expect(() => revisedSyncDetails(null, input)).toThrow(/worksheet/);
  });
});
