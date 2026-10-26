import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";
import { budget_projects, tour_details } from "../db/schema";
import { writeAuditLog } from "./audit";
import { HttpError } from "./errors";

const amount = z.number().int().min(0).max(100_000_000).nullable();
const percent = z.number().min(0).max(99.99).nullable();
export const tourBudgetAssumptions = z.object({
  merch: amount, fees: amount, low: amount, expected: amount, high: amount,
  cut: percent, futureFee: percent, funding: amount,
  fundingName: z.string().trim().min(1).max(80),
  fundingNote: z.string().max(1000).nullable(),
  sourceNote: z.string().max(1000).nullable(),
  reviewedThrough: z.iso.date().nullable(),
}).strict().refine(p => (p.merch == null && p.fees == null) || p.reviewedThrough != null, "Merch review date required")
  .refine(p => p.cut == null || p.futureFee == null || p.cut + p.futureFee < 100, "Combined deductions must be below 100%")
  .refine(p => p.low == null || p.expected == null || p.high == null || (p.low <= p.expected && p.expected <= p.high), "Keep Low ≤ Expected ≤ High");
export const tourBudgetMutation = z.object({
  request_id: z.uuid(), expected_revision: z.uuid().nullable(),
  currency: z.enum(["USD", "CAD", "EUR", "DKK"]), plan: tourBudgetAssumptions,
}).strict();
export const savedTourBudget = z.object({ revision: z.uuid(), updated_at: z.iso.datetime(), currency: z.string(), plan: tourBudgetAssumptions });

export async function saveTourBudgetPlan(org: string, projectID: string, actor: string, raw: unknown) {
  const input = tourBudgetMutation.parse(raw);
  return db.transaction(async tx => {
    const [project] = await tx.select().from(budget_projects).where(and(eq(budget_projects.org_id, org), eq(budget_projects.id, projectID))).for("update");
    if (!project || project.project_type !== "tour") throw new HttpError("Tour not found", 404);
    if (project.currency !== input.currency) throw new HttpError("Tour currency changed. Reload before saving.", 409);
    const [details] = await tx.select().from(tour_details).where(and(eq(tour_details.org_id, org), eq(tour_details.project_id, projectID)));
    const prior = details?.budget_plan ? savedTourBudget.parse(details.budget_plan) : null;
    if (prior?.revision === input.request_id && JSON.stringify(prior.plan) === JSON.stringify(input.plan)) return prior;
    if ((prior?.revision ?? null) !== input.expected_revision || prior?.revision === input.request_id) throw new HttpError("Budget assumptions changed. Reload and review before saving again.", 409);
    const saved = { revision: input.request_id, updated_at: new Date().toISOString(), currency: input.currency, plan: input.plan };
    if (details) await tx.update(tour_details).set({ budget_plan: saved, updated_at: new Date() }).where(and(eq(tour_details.org_id, org), eq(tour_details.id, details.id)));
    else await tx.insert(tour_details).values({ id: randomUUID(), org_id: org, project_id: projectID, budget_plan: saved });
    await writeAuditLog({ orgId: org, actorUserId: actor, requestId: input.request_id, action: "tour.budget_assumptions.saved", entityType: "tour_budget_plan", entityId: projectID, beforeData: prior, afterData: saved }, tx);
    return saved;
  });
}
