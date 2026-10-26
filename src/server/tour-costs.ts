import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";
import { audit_logs, budget_projects, budget_line_items, tour_money_entries } from "../db/schema";
import { computeLineEfc } from "./budget-efc-core";
import { sourceID, tourEntrySchema } from "./tour-money-core";
import { writeAuditLog } from "./audit";
import { HttpError } from "./errors";

type Line = typeof budget_line_items.$inferSelect;
type Entry = typeof tour_money_entries.$inferSelect;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const minor = (n: number | null) => Math.round((n ?? 0) * 100);
export const costEntryRevision = (row: Entry) => hash([row.id, row.data, row.updated_at, row.voided]);
export const costLineRevision = (row: Line) => hash([row.id, row.name, row.amount, row.forecast_amount, row.planned_amount, row.paid_amount, row.committed_amount, row.lock_status, row.updated_at]);

export function tourCostDetails(lines: Line[], ledger: Entry[], currency: string) {
  const expenses = ledger.filter(row => !row.voided).flatMap(row => {
    const parsed = tourEntrySchema.safeParse(row.data);
    if (!parsed.success || parsed.data.kind !== "expense") return [];
    const e = parsed.data, [first, ...rest] = e.note.split("\n");
    return [{ id: row.id, revision: costEntryRevision(row), name: (first || "Expense").replace(/^\[(?:OWED|PAID[^\]]*|PAYMENT UNVERIFIED)\]\s*/, ""),
      amount: e.amount, currency: e.currency, paid: e.paid, person: e.person, date: e.date, note: rest.join("\n"),
      budget_line_id: e.budget_line_id ?? "", source: row.source_key }];
  });
  const estimates = lines.map(line => {
    const cost = computeLineEfc(line);
    const recorded = expenses.filter(e => e.currency === currency && e.budget_line_id === line.id).reduce((n, e) => n + e.amount, 0);
    return { id: line.id, revision: costLineRevision(line), name: line.name, currency, forecast: minor(cost.forecast), total: minor(cost.efc),
      recorded, remaining: minor(cost.efc) - recorded, editable: line.lock_status === "open" };
  });
  const unassigned = expenses.filter(e => e.currency === currency && !estimates.some(line => line.id === e.budget_line_id)).reduce((n, e) => n + e.amount, 0);
  return { expenses, estimates, unassigned };
}

const base = { request_id: z.uuid(), id: z.string().min(1).max(160), expected_revision: z.string().length(64), currency: z.enum(["USD", "CAD", "EUR", "DKK"]), name: z.string().trim().min(1).max(160) };
const cents = z.number().int().min(0).max(100_000_000);
export const tourCostMutation = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("expense"), amount: cents.refine(n => n > 0), paid: z.boolean().nullable(), person: z.string().trim().min(1).max(120),
    date: z.iso.date().nullable(), note: z.string().max(8000), budget_line_id: z.string().max(160) }).strict(),
  z.object({ ...base, action: z.literal("estimate"), forecast: cents }).strict(),
]);

export async function saveTourCost(org: string, projectID: string, actor: string, raw: unknown) {
  const input = tourCostMutation.parse(raw), fingerprint = hash(input);
  return db.transaction(async tx => {
    const [project] = await tx.select().from(budget_projects).where(and(eq(budget_projects.org_id, org), eq(budget_projects.id, projectID))).for("update");
    if (!project || project.project_type !== "tour") throw new HttpError("Tour not found", 404);
    const [prior] = await tx.select().from(audit_logs).where(and(eq(audit_logs.org_id, org), eq(audit_logs.entity_id, projectID), eq(audit_logs.action, "tour.cost.updated"), eq(audit_logs.request_id, input.request_id)));
    if (prior) {
      if (prior.metadata?.fingerprint !== fingerprint) throw new HttpError("This save ID was used for different values. Reload before editing.", 409);
      return { saved: true, request_id: input.request_id, entry_id: input.id, repeated: true };
    }
    let before: Record<string, unknown>, after: Record<string, unknown>;
    const budgetChanges: Array<{ id: string; before: unknown; after: unknown }> = [];
    if (input.action === "estimate") {
      const [line] = await tx.select().from(budget_line_items).where(and(eq(budget_line_items.org_id, org), eq(budget_line_items.project_id, projectID), eq(budget_line_items.id, input.id))).for("update");
      if (!line) throw new HttpError("Estimate not found in this tour", 404);
      if (project.currency !== input.currency || costLineRevision(line) !== input.expected_revision) throw new HttpError("This estimate changed. Reload and review your edit.", 409);
      if (line.lock_status !== "open") throw new HttpError("This estimate requires budget approval before editing.", 409);
      before = line;
      after = { name: input.name, forecast_amount: input.forecast / 100, updated_at: new Date() };
      await tx.update(budget_line_items).set(after).where(and(eq(budget_line_items.org_id, org), eq(budget_line_items.id, line.id)));
    } else {
      const [row] = await tx.select().from(tour_money_entries).where(and(eq(tour_money_entries.org_id, org), eq(tour_money_entries.project_id, projectID), eq(tour_money_entries.id, input.id))).for("update");
      if (!row || row.voided || row.data.kind !== "expense") throw new HttpError("Expense not found in this tour", 404);
      const previous = tourEntrySchema.parse(row.data);
      if (costEntryRevision(row) !== input.expected_revision || previous.currency !== input.currency) throw new HttpError("This expense changed. Reload and review your edit.", 409);
      if (input.budget_line_id && input.currency !== project.currency) throw new HttpError("Budget assignments must use the tour currency", 400);
      const lineIDs = [...new Set([previous.budget_line_id, input.budget_line_id].filter((id): id is string => Boolean(id)))];
      for (const id of lineIDs) {
        const [line] = await tx.select().from(budget_line_items).where(and(eq(budget_line_items.org_id, org), eq(budget_line_items.project_id, projectID), eq(budget_line_items.id, id))).for("update");
        if (!line) throw new HttpError("Budget assignment is outside this tour", 400);
        if (line.lock_status !== "open") throw new HttpError("This budget line requires approval before editing its expenses.", 409);
        let paid = minor(line.paid_amount), due = minor(line.committed_amount);
        if (previous.budget_line_id === id) {
          if (previous.paid === true) paid -= previous.amount; else due -= previous.amount;
        }
        if (input.budget_line_id === id) {
          if (input.paid === true) paid += input.amount; else due += input.amount;
        }
        if (paid < 0 || due < 0) throw new HttpError("The assigned budget amounts need reconciliation before this expense can change.", 409);
        const ownLine = id === sourceID(`${org}:${previous.source}:budget`);
        // A standalone expense generated its own forecast. Preserve later manual forecast changes.
        const forecast = ownLine && minor(line.forecast_amount) === previous.amount ? (!input.budget_line_id || input.budget_line_id === id ? input.amount / 100 : 0) : line.forecast_amount;
        const change = { paid_amount: paid / 100, committed_amount: due / 100, forecast_amount: forecast, updated_at: new Date() };
        budgetChanges.push({ id, before: { paid_amount: line.paid_amount, committed_amount: line.committed_amount, forecast_amount: line.forecast_amount }, after: change });
        await tx.update(budget_line_items).set(change)
          .where(and(eq(budget_line_items.org_id, org), eq(budget_line_items.id, id)));
      }
      before = row.data;
      after = tourEntrySchema.parse({ ...row.data, amount: input.amount, paid: input.paid, person: input.person, date: input.date,
        note: [input.name, input.note].filter(Boolean).join("\n"), budget_line_id: input.budget_line_id || undefined });
      await tx.update(tour_money_entries).set({ data: after, updated_at: new Date() }).where(and(eq(tour_money_entries.org_id, org), eq(tour_money_entries.id, row.id)));
    }
    await writeAuditLog({ orgId: org, actorUserId: actor, requestId: input.request_id, action: "tour.cost.updated", entityType: "project", entityId: projectID,
      beforeData: before, afterData: after, metadata: { fingerprint, item_id: input.id, kind: input.action, budget_changes: budgetChanges } }, tx);
    return { saved: true, request_id: input.request_id, entry_id: input.id, repeated: false };
  });
}
