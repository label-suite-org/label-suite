import { describe, expect, it } from "vitest";
import { entryShow, normalizeSquare, tourEntrySchema, tourMoneySummary, type SquarePayment, type SquareOrder, type TourShow } from "./tour-money-core";
const payment: SquarePayment = { id: "payment-1", location_id: "location", order_id: "order", created_at: "2026-10-18T06:30:00Z", updated_at: "2026-10-18T07:00:00Z", status: "COMPLETED", source_type: "CARD", total_money: { amount: 1100, currency: "USD" }, processing_fee: [{ amount_money: { amount: 45, currency: "USD" } }] };
const order: SquareOrder = { id: "order", total_money: payment.total_money, total_tax_money: { amount: 100, currency: "USD" }, tenders: [{ payment_id: payment.id }] };
const shows: TourShow[] = [{ id: "show-1", date: "2026-10-17", title: "Past show", timezone: "America/Los_Angeles", guarantee: 150000, currency: "USD" }, { id: "show-2", date: "2026-10-20", title: "Next show", timezone: "America/Los_Angeles", guarantee: 150000, currency: "USD" }];
const entry = (kind: string, amount: number, extra = {}) => tourEntrySchema.parse({ kind, amount, currency: "USD", date: "2026-10-17", source: "fixture", ...extra });
describe("tour money", () => {
  it("excludes dates where the touring artist is not performing from show forecasts", () => {
    const external = { ...shows[1], id: "external", date: "2026-10-24", guarantee: null, participation: "not_performing" };
    const result = tourMoneySummary([entry("merch_card", 10000)], [...shows, external], "2026-10-18", "USD", 400000);
    expect(result.contracted).toBe(300000);
    expect(result.remaining_shows).toBe(1);
    expect(result.forecast_result).toBe(-80000);
  });
  it("retains the same identity across imports and deducts refunds exactly once", () => {
    const first = normalizeSquare("merchant", payment, order);
    const repeat = normalizeSquare("merchant", { ...payment, refunded_money: payment.total_money }, order);
    expect(first.source).toBe(repeat.source);
    expect(first.data?.amount).toBe(1000);
    expect(first.data?.square?.fees).toBe(45);
    expect(repeat.data?.amount).toBe(0);
  });
  it("holds ambiguous refunds, split tenders, and cash rather than guessing", () => {
    expect(normalizeSquare("m", { ...payment, refunded_money: { amount: 500, currency: "USD" } }, order).held).toMatch(/Partial/);
    expect(normalizeSquare("m", payment, { ...order, tenders: [] }).held).toMatch(/Split/);
    expect(normalizeSquare("m", { ...payment, source_type: "CASH" }, order).held).toMatch(/reconciliation/);
  });
  it("assigns after-midnight receipts to the local show date", () => {
    const data = normalizeSquare("m", { ...payment, created_at: "2026-10-18T08:30:00Z" }, order).data!;
    expect(entryShow(data, shows)?.id).toBe("show-1");
  });
  it("does not count balances, transfers or fulfilled guarantees twice", () => {
    const result = tourMoneySummary([entry("merch_card", 10000), entry("show_payment", 150000), entry("cash_count", 58000), entry("cash_count", 42000, { currency: "CAD" }), entry("transfer", 200000)], shows, "2026-10-18", "USD", 400000);
    expect(result.recorded_income).toBe(160000);
    expect(result.forecast_result).toBe(-80000);
    expect(result.breakeven_per_show).toBe(90000);
    expect(result.last_show?.cash).toBeNull();
    expect(result.cash_counts).toHaveLength(2);
  });
  it("leaves unknown forecasts and missing sales unknown; excludes held receipts", () => {
    const data = normalizeSquare("m", payment, order).data!;
    data.square!.review = "Refund requires review";
    const result = tourMoneySummary([data], shows, "2026-10-18", "USD", null);
    expect(result.recorded_income).toBe(0);
    expect(result.last_show?.card).toBeNull();
    expect(result.forecast_result).toBeNull();
  });
});
