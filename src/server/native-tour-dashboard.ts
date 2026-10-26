import { tourCostDetails } from "./tour-costs";
import { savedTourBudget } from "./tour-budget-plan";
import { and, eq, asc, inArray } from "drizzle-orm";
import { db } from "../lib/db";
import { budget_projects, budget_line_items, project_events, tour_details, tour_show_details, tour_lodging, tour_travel_legs, tour_money_entries, tour_square_connections, contacts } from "../db/schema";
import { showCloseSummary } from "./tour-daily-flow";
import { rollupBudgetCosts } from "./budget-efc-core";
import { entryShow, localDate, tourEntrySchema, tourMoneySummary, type TourShow } from "./tour-money-core";

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
    return { id: event.id, date: event.start_date, title: event.title, timezone: event.timezone || timezone, guarantee: show?.guarantee == null ? null : Math.round(show.guarantee * 100), currency: show?.currency || project.currency || "USD", address: event.address, participation: show?.participation };
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
  const contactIDs = [...new Set(events.flatMap(e => [e.contact_id, e.owner_contact_id]).filter((id): id is string => Boolean(id)))];
  const people = contactIDs.length ? await db.select({ id: contacts.id, name: contacts.name, email: contacts.email, phone: contacts.phone }).from(contacts).where(and(eq(contacts.org_id, org), inArray(contacts.id, contactIDs))) : [];
  const dates = new Set(events.map(e => e.start_date));
  const start = project.start_date || events[0]?.start_date, end = project.end_date || events.at(-1)?.start_date;
  if (start && end) for (let at = Date.parse(start + "T12:00:00Z"), i = 0; at <= Date.parse(end + "T12:00:00Z") && i < 366; at += 86400000, i++) dates.add(new Date(at).toISOString().slice(0, 10));
  const daily = [...dates].sort().map(date => ({ date,
    events: events.filter(e => e.start_date <= date && (e.end_date || e.start_date) >= date && e.status !== "cancelled").map(e => ({ id: e.id, title: e.title, kind: e.event_type, confirmed: e.is_confirmed,
      timezone: e.timezone || timezone, time: e.all_day ? null : e.starts_at?.toISOString() ?? null, venue: e.venue_name, address: e.address, notes: e.notes,
      contacts: people.filter(p => p.id === e.contact_id || p.id === e.owner_contact_id) })),
    stays: stays.filter(s => s.check_in <= date && (s.check_out ? s.check_out > date : s.check_in === date)).map(s => ({ id: s.id, title: s.stop_name, address: s.address, status: s.booking_status,
      dates: [s.check_in, s.check_out].filter(Boolean).join(" – "), reference: s.booking_reference, notes: s.notes })),
    travel: travel.filter(t => t.start_date <= date && (t.end_date || t.start_date) >= date).map(t => ({ id: t.id,
      title: [t.origin_label, t.destination_label].filter(Boolean).join(" → ") || "Travel", detail: [t.transport_mode, t.notes].filter(Boolean).join(" · "),
      departure: t.departs_at?.toISOString() ?? null, arrival: t.arrives_at?.toISOString() ?? null, status: t.booking_status })),
  }));
  const performingShows = shows.filter(s => s.participation !== "not_performing");
  const closeShows = performingShows.map(show => {
    const rows = entries.filter(e => e.currency === show.currency && entryShow(e, performingShows)?.id === show.id && !e.square?.review);
    return { ...showCloseSummary(show, entries, performingShows), card: rows.some(e => e.kind === "merch_card") ? rows.filter(e => e.kind === "merch_card").reduce((n, e) => n + e.amount, 0) : null,
      expenses: rows.filter(e => e.kind === "expense").reduce((n, e) => n + e.amount, 0) };
  });
  const budgetPlan = details[0]?.budget_plan ? savedTourBudget.parse(details[0].budget_plan) : null;
  return { costs: tourCostDetails(lines, ledger, project.currency || "USD"), budget_plan: budgetPlan, daily, shows: closeShows,
    allowances: lines.filter(l => l.lock_status === "open").map(l => ({ id: l.id, name: l.name, currency: project.currency || "USD", remaining: Math.max(0, Math.round(((l.forecast_amount ?? l.planned_amount ?? l.amount) - (l.paid_amount ?? 0) - (l.committed_amount ?? 0)) * 100)) })),
    spending: { paid: expenses.filter(e => e.currency === project.currency && e.paid === true).reduce((n, e) => n + e.amount, 0), due: expenses.filter(e => e.currency === project.currency && e.paid === false).reduce((n, e) => n + e.amount, 0), unknown: expenses.filter(e => e.paid === null).length },
    project_id: project.id, title: project.name, as_of: now.toISOString(), today, timezone, money,
    next: next ? { id: next.id, title: next.title, date: next.start_date, time: next.starts_at?.toISOString() ?? null, timezone: next.timezone || timezone, address: next.address, notes: next.notes } : null,
    stays: stays.filter(s => s.check_in <= today && (s.check_out ? s.check_out > today : s.check_in === today)).map(s => ({ id: s.id, title: s.stop_name, address: s.address, status: s.booking_status, dates: [s.check_in, s.check_out].filter(Boolean).join(" – ") })),
    travel: travel.filter(t => t.start_date === today).map(t => ({ id: t.id, title: [t.origin_label, t.destination_label].filter(Boolean).join(" → ") || "Travel", detail: [t.transport_mode, t.departs_at?.toISOString(), t.notes].filter(Boolean).join(" · ") })),
    expenses_by_person: [...new Set(expenses.map(e => `${e.person}:${e.currency}`))].map(key => { const rows = expenses.filter(e => `${e.person}:${e.currency}` === key); return { person: rows[0].person, currency: rows[0].currency, amount: rows.reduce((n, e) => n + e.amount, 0) }; }),
    sync: { enabled: connection?.enabled ?? false, last_success: connection?.last_success?.toISOString() ?? null, error: connection?.error ?? null, held: connection?.held ?? 0, interval_minutes: 5 },
  };
}
