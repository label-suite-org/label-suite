import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";
import { budget_projects, budget_line_items, project_events, tour_show_details, tour_money_entries } from "../db/schema";
import { entryShow, sourceID, tourEntrySchema, type TourEntry, type TourShow } from "./tour-money-core";
import { writeAuditLog } from "./audit";
import { HttpError } from "./errors";

const cents = z.number().int().min(0).max(100_000_000);
const currency = z.enum(["USD", "CAD", "EUR", "DKK"]);
export const tourDailyMutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("expense"), request_id: z.uuid(), name: z.string().trim().min(1).max(160), amount: cents.refine(n => n > 0), currency,
    date: z.iso.date(), show_id: z.string().max(160).default(""), person: z.string().trim().min(1).max(120), paid: z.boolean(),
    category: z.string().trim().min(1).max(80), budget_line_id: z.string().max(160).default(""), note: z.string().max(4000).default("") }).strict(),
  z.object({ action: z.literal("close_show"), request_id: z.uuid(), show_id: z.string().min(1).max(160), expected_revision: z.string().min(1).max(80),
    cash_total: cents.nullable(), payment_total: cents.nullable(), note: z.string().max(4000).default("") }).strict(),
]);
export type TourDailyMutation = z.infer<typeof tourDailyMutation>;

export function showCloseSummary(show: TourShow, entries: TourEntry[], shows: TourShow[] = [show]) {
  const rows = entries.filter(e => entryShow(e, shows)?.id === show.id);
  const sameCurrency = rows.filter(e => e.currency === show.currency && !e.square?.review);
  const relevant = rows.filter(e => ["merch_cash", "show_payment", "show_close"].includes(e.kind));
  const revision = createHash("sha256").update(JSON.stringify([show.id, show.date, show.currency, show.guarantee,
    relevant.sort((a, b) => a.source.localeCompare(b.source)).map(e => [e.source, e.kind, e.amount, e.currency, e.date, e.show, e.operation, e.note, e.closed_at, e.square?.review])])).digest("hex");
  const sum = (kind: string) => sameCurrency.some(e => e.kind === kind) ? sameCurrency.filter(e => e.kind === kind).reduce((n, e) => n + e.amount, 0) : null;
  const closed = rows.filter(e => e.kind === "show_close").map(e => e.closed_at ?? "").sort().at(-1) || null;
  return { id: show.id, title: show.title, date: show.date, currency: show.currency, guarantee: show.guarantee,
    cash: sum("merch_cash"), received: sum("show_payment"), revision, closed_at: closed };
}

export async function saveTourDailyEntry(org: string, projectID: string, actor: string, raw: unknown) {
  const input = tourDailyMutation.parse(raw);
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return db.transaction(async tx => {
    const [project] = await tx.select().from(budget_projects).where(and(eq(budget_projects.org_id, org), eq(budget_projects.id, projectID))).for("update");
    if (!project || project.project_type !== "tour") throw new HttpError("Tour not found", 404);
    if (!currency.safeParse(project.currency).success) throw new HttpError("Set the tour’s budget currency before recording money", 400);
    const source = `native:${projectID}:${input.action}:${input.request_id}`;
    const [prior] = await tx.select().from(tour_money_entries).where(and(eq(tour_money_entries.org_id, org), eq(tour_money_entries.source_key, source)));
    if (prior) {
      if (prior.voided) throw new HttpError("This entry was voided. Review it in the workspace before saving again.", 409);
      if (prior.project_id !== projectID || prior.data.operation !== fingerprint) throw new HttpError("This save ID was already used for different values. Review the saved entry.", 409);
      return { saved: true, request_id: input.request_id, entry_id: prior.id, repeated: true };
    }
    let data: TourEntry;
    if (input.action === "expense") {
      if (project.start_date && input.date < project.start_date || project.end_date && input.date > project.end_date) throw new HttpError("Choose a date within this tour", 400);
      if (input.show_id) {
        const [event] = await tx.select().from(project_events).where(and(eq(project_events.org_id, org), eq(project_events.project_id, projectID), eq(project_events.id, input.show_id)));
        if (!event || event.status === "cancelled") throw new HttpError("Event is outside this tour or cancelled", 400);
      }
      let lineID: string | undefined;
      // The project's budget has one currency. Other-currency expenses remain explicit ledger costs, never converted or mixed.
      if (input.currency === project.currency) {
        lineID = input.budget_line_id || sourceID(`${org}:${source}:budget`);
        if (input.budget_line_id) {
          const [line] = await tx.select().from(budget_line_items).where(and(eq(budget_line_items.org_id, org), eq(budget_line_items.project_id, projectID), eq(budget_line_items.id, lineID))).for("update");
          if (!line) throw new HttpError("Budget allowance is outside this tour", 400);
          if (line.lock_status !== "open") throw new HttpError("This allowance requires budget approval. Choose an open allowance or record an additional cost.", 409);
          const field = input.paid ? budget_line_items.paid_amount : budget_line_items.committed_amount;
          await tx.update(budget_line_items).set({ [input.paid ? "paid_amount" : "committed_amount"]: sql`coalesce(${field}, 0) + ${input.amount / 100}`, updated_at: new Date() }).where(and(eq(budget_line_items.id, lineID), eq(budget_line_items.org_id, org)));
        } else {
          await tx.insert(budget_line_items).values({ id: lineID, org_id: org, project_id: projectID, name: input.name, amount: input.amount / 100,
            planned_amount: 0, forecast_amount: input.amount / 100, paid_amount: input.paid ? input.amount / 100 : 0,
            committed_amount: input.paid ? 0 : input.amount / 100, status: input.paid ? "paid" : "approved", phase: "tour", spend_month: input.date.slice(0, 7), lock_status: "open" });
        }
      } else if (input.budget_line_id) throw new HttpError("An allowance must use the project currency. Keep this expense separate until converted.", 400);
      data = tourEntrySchema.parse({ kind: "expense", source, amount: input.amount, currency: input.currency, date: input.date,
        show: input.show_id, person: input.person, paid: input.paid, category: input.category, budget_line_id: lineID,
        note: [input.name, input.note].filter(Boolean).join("\n"), operation: fingerprint });
    } else {
      const [event] = await tx.select().from(project_events).where(and(eq(project_events.org_id, org), eq(project_events.project_id, projectID), eq(project_events.id, input.show_id))).for("update");
      const showRows = await tx.select({ event: project_events, detail: tour_show_details }).from(project_events)
        .leftJoin(tour_show_details, and(eq(tour_show_details.org_id, org), eq(tour_show_details.event_id, project_events.id)))
        .where(and(eq(project_events.org_id, org), eq(project_events.project_id, projectID)));
      const detail = showRows.find(row => row.event.id === input.show_id)?.detail;
      if (!event || event.event_type !== "concert" || event.status === "cancelled" || detail?.participation === "not_performing") throw new HttpError("Performing show not found in this tour", 404);
      const shows: TourShow[] = showRows.filter(row => row.event.event_type === "concert" && row.event.status !== "cancelled" && row.detail?.participation !== "not_performing")
        .map(({ event, detail }) => ({ id: event.id, title: event.title, date: event.start_date, timezone: event.timezone || "UTC", guarantee: detail?.guarantee == null ? null : Math.round(detail.guarantee * 100), currency: detail?.currency || project.currency! }));
      const show = shows.find(row => row.id === event.id)!;
      const ledger = await tx.select().from(tour_money_entries).where(and(eq(tour_money_entries.org_id, org), eq(tour_money_entries.project_id, projectID), eq(tour_money_entries.voided, false)));
      const entries = ledger.flatMap(row => { const parsed = tourEntrySchema.safeParse(row.data); return parsed.success ? [parsed.data] : []; });
      if (showCloseSummary(show, entries, shows).revision !== input.expected_revision) throw new HttpError("This show changed. Refresh its totals and review your draft before saving.", 409);
      for (const [kind, total] of [["merch_cash", input.cash_total], ["show_payment", input.payment_total]] as const) {
        if (total === null) continue;
        const key = `native:${projectID}:show:${show.id}:${kind}`;
        const others = entries.filter(e => e.kind === kind && e.source !== key && entryShow(e, shows)?.id === show.id);
        if (others.some(e => e.currency !== show.currency)) throw new HttpError("Existing show income uses another currency. Reconcile it before closing.", 409);
        const already = others.reduce((n, e) => n + e.amount, 0);
        if (total < already) throw new HttpError("The entered total is below other recorded income. Review those entries before correcting it.", 409);
        const value = tourEntrySchema.parse({ kind, amount: total - already, currency: show.currency, date: show.date, show: show.id, source: key, note: input.note, paid: true });
        const [existing] = await tx.select().from(tour_money_entries).where(and(eq(tour_money_entries.org_id, org), eq(tour_money_entries.source_key, key)));
        if (existing?.voided) throw new HttpError("This show total was voided. Reconcile it in the workspace before closing.", 409);
        await tx.insert(tour_money_entries).values({ id: sourceID(`${org}:${key}`), org_id: org, project_id: projectID, source_key: key, data: value })
          .onConflictDoUpdate({ target: [tour_money_entries.org_id, tour_money_entries.source_key], set: { data: value, updated_at: new Date() } });
      }
      data = tourEntrySchema.parse({ kind: "show_close", amount: 0, currency: show.currency, date: show.date, show: show.id,
        source, note: input.note, operation: fingerprint, closed_at: new Date().toISOString() });
    }
    const id = sourceID(`${org}:${source}`);
    await tx.insert(tour_money_entries).values({ id, org_id: org, project_id: projectID, source_key: source, data });
    await writeAuditLog({ orgId: org, actorUserId: actor, action: `tour.${input.action}`, entityType: "project", entityId: projectID, afterData: input, requestId: input.request_id }, tx);
    return { saved: true, request_id: input.request_id, entry_id: id, repeated: false };
  });
}
