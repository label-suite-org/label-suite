import { and, eq, asc } from "drizzle-orm";
import { db } from "../lib/db";
import { budget_projects, budget_line_items, project_events, tour_details, tour_show_details, tour_lodging, tour_travel_legs, tour_money_entries, tour_square_connections } from "../db/schema";
import { rollupBudgetCosts } from "./budget-efc-core";
import { localDate, tourEntrySchema, tourMoneySummary, type TourShow } from "./tour-money-core";

export async function getNativeTourDashboard(org: string, projectID: string, now = new Date()) {
  const [project] = await db.select().from(budget_projects).where(and(eq(budget_projects.org_id, org), eq(budget_projects.id, projectID)));
  if (!project || project.project_type !== "tour") return null;
  const [events, details, showDetails, lines, stays, travel, ledger, connections] = await Promise.all([
    db.select().from(project_events).where(and(eq(project_events.org_id, org), eq(project_events.project_id, projectID))).orderBy(asc(project_events.start_date)),
    db.select().from(tour_details).where(and(eq(tour_details.org_id, org), eq(tour_details.project_id, projectID))),
    db.select({ detail: tour_show_details }).from(tour_show_details).innerJoin(project_events, and(eq(project_events.id, tour_show_details.event_id), eq(project_events.org_id, org))).where(and(eq(tour_show_details.org_id, org), eq(project_events.project_id, projectID))),
    db.select().from(budget_line_items).where(and(eq(budget_line_items.org_id, org), eq(budget_line_items.project_id, projectID))),
    db.select().from(tour_lodging).where(and(eq(tour_lodging.org_id, org), eq(tour_lodging.project_id, projectID))),
    db.select().from(tour_travel_legs).where(and(eq(tour_travel_legs.org_id, org), eq(tour_travel_legs.project_id, projectID))),
    db.select().from(tour_money_entries).where(and(eq(tour_money_entries.org_id, org), eq(tour_money_entries.project_id, projectID), eq(tour_money_entries.voided, false))),
    db.select({ enabled: tour_square_connections.enabled, last_success: tour_square_connections.last_success_at, last_attempt: tour_square_connections.last_attempt_at, error: tour_square_connections.error, held: tour_square_connections.held_count }).from(tour_square_connections).where(and(eq(tour_square_connections.org_id, org), eq(tour_square_connections.project_id, projectID))),
  ]);
  const timezone = details[0]?.base_timezone || events[0]?.timezone || "UTC";
  const today = localDate(now, timezone);
  const shows: TourShow[] = events.filter(e => e.event_type === "concert" && e.status !== "cancelled").map(event => {
    const show = showDetails.find(d => d.detail.event_id === event.id)?.detail;
    return { id: event.id, date: event.start_date, title: event.title, timezone: event.timezone || timezone, guarantee: show?.guarantee == null ? null : Math.round(show.guarantee * 100), currency: show?.currency || project.currency || "USD", address: event.address };
  });
  const parsed = ledger.map(row => tourEntrySchema.safeParse(row.data));
  const entries = parsed.flatMap(result => result.success ? [result.data] : []);
  const forecast = lines.length ? Math.round(rollupBudgetCosts(lines).efc * 100) : null;
  const money = tourMoneySummary(entries, shows, today, project.currency || "USD", forecast);
  if (parsed.some(r => !r.success)) money.attention.push("Some imported money records could not be validated and are excluded.");
  const connection = connections[0];
  if (!connection?.enabled) money.attention.push("Automatic Square sync is not enabled.");
  else if (!connection.last_success || now.getTime() - connection.last_success.getTime() > 15 * 60_000) money.attention.push("Square sales are out of date; check sync status.");
  if (connection?.held) money.attention.push(`${connection.held} Square payments need review and are excluded.`);
  const next = events.find(e => e.start_date >= today && e.status !== "cancelled");
  const expenses = entries.filter(e => e.kind === "expense");
  return { project_id: project.id, title: project.name, as_of: now.toISOString(), today, timezone, money,
    next: next ? { id: next.id, title: next.title, date: next.start_date, time: next.starts_at?.toISOString() ?? null, timezone: next.timezone || timezone, address: next.address, notes: next.notes } : null,
    stays: stays.filter(s => s.check_in <= today && (s.check_out ? s.check_out > today : s.check_in === today)).map(s => ({ id: s.id, title: s.stop_name, address: s.address, status: s.booking_status, dates: [s.check_in, s.check_out].filter(Boolean).join(" – ") })),
    travel: travel.filter(t => t.start_date === today).map(t => ({ id: t.id, title: [t.origin_label, t.destination_label].filter(Boolean).join(" → ") || "Travel", detail: [t.transport_mode, t.departs_at?.toISOString(), t.notes].filter(Boolean).join(" · ") })),
    expenses_by_person: [...new Set(expenses.map(e => `${e.person}:${e.currency}`))].map(key => { const rows = expenses.filter(e => `${e.person}:${e.currency}` === key); return { person: rows[0].person, currency: rows[0].currency, amount: rows.reduce((n, e) => n + e.amount, 0) }; }),
    sync: { enabled: connection?.enabled ?? false, last_success: connection?.last_success?.toISOString() ?? null, error: connection?.error ?? null, held: connection?.held ?? 0, interval_minutes: 5 },
  };
}
