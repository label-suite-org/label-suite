import { createHash } from "node:crypto";
import { z } from "zod";

export const tourEntrySchema = z.object({
  kind: z.enum(["merch_card", "merch_cash", "merch_refund", "show_payment", "grant", "transfer", "cash_count", "expense", "show_close"]),
  amount: z.number().int().nonnegative().safe(), currency: z.enum(["USD", "CAD", "DKK", "EUR"]),
  date: z.iso.date().nullable(), show: z.string().default(""), person: z.string().default("Unassigned"),
  paid: z.boolean().nullable().default(null), account: z.string().default(""), source: z.string().min(1), note: z.string().default(""),
  category: z.string().optional(), budget_line_id: z.string().optional(),
  operation: z.string().optional(), closed_at: z.string().optional(),
  square: z.object({ merchantId: z.string(), paymentId: z.string(), orderId: z.string(), locationId: z.string(),
    createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
    gross: z.number().int(), tax: z.number().int(), tip: z.number().int(), refunded: z.number().int(), fees: z.number().int().nullable(),
    refundIds: z.array(z.string()).default([]), review: z.string().optional(),
  }).optional(),
}).refine(entry => entry.kind === "expense" || entry.date !== null, { message: "Income and cash counts require a date" });
export type TourEntry = z.infer<typeof tourEntrySchema>;
export type SquareMoney = { amount: number; currency: string };
export type SquarePayment = { id: string; location_id: string; order_id: string; created_at: string; updated_at: string; status: string; source_type: string; total_money: SquareMoney; tip_money?: SquareMoney; refunded_money?: SquareMoney; processing_fee?: { amount_money: SquareMoney }[]; refund_ids?: string[] };
export type SquareOrder = { id: string; total_money: SquareMoney; total_tax_money: SquareMoney; tenders?: { payment_id?: string; id?: string }[]; service_charges?: unknown[] };
export const sourceID = (source: string) => "tour_" + createHash("sha256").update(source).digest("hex");
function money(value: SquareMoney | undefined, currency: string, optional = false): number {
  if (value == null && optional) return 0;
  if (!value || value.currency !== currency || !Number.isSafeInteger(value.amount) || value.amount < 0) throw new Error("Missing or invalid money amount");
  return value.amount;
}
export function normalizeSquare(merchant: string, payment: SquarePayment, order?: SquareOrder): { source: string; data?: TourEntry; held?: string; ignored?: boolean } {
  const source = `square:${merchant}:payment:${payment.id}`;
  if (payment.status !== "COMPLETED") return { source, ignored: true };
  try {
    const currency = payment.total_money?.currency;
    if (payment.source_type !== "CARD") throw new Error("Non-card payment needs cash reconciliation");
    if (!order || order.id !== payment.order_id) throw new Error("Order detail unavailable");
    const gross = money(payment.total_money, currency), tax = money(order.total_tax_money, currency);
    const tip = money(payment.tip_money, currency, true), refunded = money(payment.refunded_money, currency, true);
    if (gross !== money(order.total_money, currency) || order.tenders?.length !== 1 || (order.tenders[0].payment_id || order.tenders[0].id) !== payment.id) throw new Error("Split or unmatched payment");
    if (order.service_charges?.length) throw new Error("Service charge requires review");
    if (refunded > gross || tax + tip > gross) throw new Error("Inconsistent refund or tax amount");
    if (refunded > 0 && refunded < gross && (tax || tip)) throw new Error("Partial tax or tip refund requires review");
    const data = tourEntrySchema.parse({ kind: "merch_card", amount: refunded === gross ? 0 : gross - tax - tip - refunded,
      currency, date: payment.created_at.slice(0, 10), source, account: "Square",
      note: "Net sales after refunds, excluding tax and tips. Processing fees shown separately.",
      square: { merchantId: merchant, paymentId: payment.id, orderId: payment.order_id, locationId: payment.location_id,
        createdAt: payment.created_at, updatedAt: payment.updated_at, gross, tax, tip, refunded,
        fees: payment.processing_fee ? payment.processing_fee.reduce((sum, fee) => sum + money(fee.amount_money, currency), 0) : null,
        refundIds: payment.refund_ids || [] } });
    return { source, data };
  } catch (error) { return { source, held: error instanceof z.ZodError ? "Invalid payment fields" : (error as Error).message }; }
}

export type TourShow = { id: string; date: string; title: string; timezone: string; guarantee: number | null; currency: string; address?: string | null; participation?: string | null };
// ICU formatters are expensive native allocations; reuse them across dashboard reads.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const hourFormatters = new Map<string, Intl.DateTimeFormat>();
export function localDate(instant: Date, timezone: string) {
  let formatter = dateFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    dateFormatters.set(timezone, formatter);
  }
  return formatter.format(instant);
}
export function entryShow(entry: TourEntry, shows: TourShow[]) {
  if (entry.show) return shows.find(show => show.id === entry.show || show.date === entry.show);
  if (!entry.square) return shows.find(show => show.date === entry.date);
  // A 4am local cutoff keeps after-midnight merch with the preceding show.
  const at = new Date(entry.square.createdAt);
  const matches = shows.filter(show => {
    let formatter = hourFormatters.get(show.timezone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-US", { timeZone: show.timezone, hour: "2-digit", hourCycle: "h23" });
      hourFormatters.set(show.timezone, formatter);
    }
    const hour = Number(formatter.format(at));
    const date = localDate(at, show.timezone);
    const showDate = hour < 4 ? new Date(Date.parse(date + "T12:00:00Z") - 86400000).toISOString().slice(0, 10) : date;
    return show.date === showDate;
  });
  return matches.length === 1 ? matches[0] : undefined;
}
export function tourMoneySummary(entries: TourEntry[], shows: TourShow[], today: string, currency: string, forecastCost: number | null) {
  shows = shows.filter(show => show.participation !== "not_performing");
  const usable = entries.filter(e => e.currency === currency && !e.square?.review);
  const assignedShows = new Map(usable.map(entry => [entry, entryShow(entry, shows)]));
  const sum = (rows: TourEntry[]) => rows.reduce((n, e) => n + (e.kind === "merch_refund" ? -e.amount : e.amount), 0);
  const merch = usable.filter(e => ["merch_card", "merch_cash", "merch_refund"].includes(e.kind));
  const past = shows.filter(s => s.date < today), remaining = shows.filter(s => s.date >= today).length;
  const observed = past.filter(s => merch.some(e => assignedShows.get(e)?.id === s.id));
  const average = observed.length ? Math.round(sum(merch.filter(e => observed.some(s => assignedShows.get(e)?.id === s.id))) / observed.length) : null;
  const guaranteesKnown = shows.length > 0 && shows.every(s => s.guarantee !== null && s.currency === currency);
  const contracted = guaranteesKnown ? shows.reduce((n, s) => n + s.guarantee!, 0) : null;
  // Payments fulfil guarantees; they must never be added on top of the same guarantee.
  const forecastShows = contracted === null ? null : shows.reduce((n, s) => n + Math.max(s.guarantee!, sum(usable.filter(e => e.kind === "show_payment" && assignedShows.get(e)?.id === s.id))), 0);
  const grants = sum(usable.filter(e => e.kind === "grant"));
  const recordedIncome = sum(usable.filter(e => ["merch_card", "merch_cash", "merch_refund", "show_payment", "grant"].includes(e.kind)));
  const fees = usable.reduce((n, e) => n + (e.square?.fees ?? 0), 0);
  const required = forecastCost === null || forecastShows === null ? null : Math.max(0, forecastCost - forecastShows - grants - sum(merch));
  const forecastResult = required === null || (remaining > 0 && average === null) ? null : forecastShows! + grants + sum(merch) + (average ?? 0) * remaining - forecastCost!;
  const last = [...past].sort((a, b) => b.date.localeCompare(a.date))[0];
  const lastEntries = last ? usable.filter(e => assignedShows.get(e)?.id === last.id) : [];
  const latestCounts = new Map<string, TourEntry>();
  for (const entry of entries.filter(e => e.kind === "cash_count").sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))) latestCounts.set([entry.currency, entry.person, entry.account].join(":"), entry);
  return { currency, recorded_income: recordedIncome, contracted, forecast_cost: forecastCost, forecast_result: forecastResult,
    remaining_shows: remaining, observed_nights: observed.length, average_merch: average,
    breakeven_per_show: required === null || !remaining ? null : Math.ceil(required / remaining), processing_fees: fees,
    last_show: last ? { title: last.title, date: last.date, card: lastEntries.some(e => e.kind === "merch_card") ? sum(lastEntries.filter(e => e.kind === "merch_card")) : null,
      cash: lastEntries.some(e => e.kind === "merch_cash") ? sum(lastEntries.filter(e => e.kind === "merch_cash")) : null,
      received: sum(lastEntries.filter(e => e.kind === "show_payment")) } : null,
    cash_counts: [...latestCounts.values()].map(e => ({ currency: e.currency, amount: e.amount, person: e.person, date: e.date })),
    attention: [
      "Forecast is provisional; missing cash, unrecorded expenses and merch production costs may change it.",
      ...(entries.some(e => e.currency !== currency && !["cash_count", "transfer", "show_close"].includes(e.kind)) ? ["Other-currency entries are kept separately and excluded from this forecast."] : []),
      ...(contracted === null ? ["Show guarantees or currencies need reconciliation."] : []),
      ...(forecastCost === null ? ["No complete cost forecast is recorded."] : []),
      ...(!lastEntries.some(e => e.kind === "merch_cash") ? ["Cash merch for the last show is unrecorded."] : []),
      ...(entries.some(e => e.square?.review) ? ["Previously imported Square payments changed and need review; excluded from totals."] : []),
      ...(usable.some(e => e.kind === "show_payment" && !assignedShows.get(e)) ? ["Unallocated show payments are excluded from the forecast."] : []),
    ] };
}
