import { z } from "zod";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { budget_categories, budget_line_items, budget_projects, releases } from "../db/schema";
import { db } from "../lib/db";
import { NotFoundError } from "./errors";
import { hasOwn, idSchema, nullableNumber, nullableText } from "./validation";
import { assertBudgetMutationLinks } from "./budget-mutations";

export const createBudgetItemSchema = z.object({
  id: idSchema.optional(),
  release_id: idSchema,
  category_id: nullableText,
  name: z.string().trim().min(1, "name is required"),
  amount: nullableNumber().refine((value) => value != null, "amount must be a number"),
  status: nullableText,
});

export const updateBudgetItemSchema = z.object({
  id: idSchema,
  category_id: nullableText,
  name: z.string().trim().min(1, "name is required").optional(),
  amount: nullableNumber().refine((value) => value === undefined || value !== null, "amount must be a number"),
  status: nullableText,
});

export type CreateBudgetItemInput = z.infer<typeof createBudgetItemSchema>;
export type UpdateBudgetItemInput = z.infer<typeof updateBudgetItemSchema>;

export async function listBudgetItems(orgId: string) {
  return db
    .select({
      id: budget_line_items.id,
      name: budget_line_items.name,
      amount: budget_line_items.amount,
      status: budget_line_items.status,
      category_name: budget_categories.name,
      category_type: budget_categories.type,
      release_title: releases.title,
    })
    .from(budget_line_items)
    .leftJoin(budget_categories, and(eq(budget_line_items.category_id, budget_categories.id), eq(budget_categories.org_id, orgId)))
    .leftJoin(releases, and(eq(budget_line_items.release_id, releases.id), eq(releases.org_id, orgId)))
    .where(and(eq(budget_line_items.org_id, orgId), isNull(budget_line_items.project_id)))
    .orderBy(desc(budget_line_items.created_at))
    .limit(200);
}

export async function listBudgetItemsForRelease(orgId: string, releaseId: string) {
  return db
    .select({
      id: budget_line_items.id,
      name: budget_line_items.name,
      amount: sql<number>`coalesce(${budget_line_items.planned_amount}, ${budget_line_items.amount}, 0)`,
      status: budget_line_items.status,
      category_name: budget_categories.name,
      category_type: budget_categories.type,
    })
    .from(budget_line_items)
    .leftJoin(budget_projects, and(eq(budget_line_items.project_id, budget_projects.id), eq(budget_projects.org_id, orgId)))
    .leftJoin(budget_categories, and(eq(budget_line_items.category_id, budget_categories.id), eq(budget_categories.org_id, orgId)))
    .where(and(
      eq(budget_line_items.org_id, orgId),
      sql`coalesce(${budget_line_items.release_id}, ${budget_projects.release_id}) = ${releaseId}`,
    ))
    .orderBy(asc(budget_categories.type), desc(budget_line_items.created_at));
}

export async function createBudgetItem(orgId: string, input: CreateBudgetItemInput) {
  await assertBudgetMutationLinks(orgId, { release: input.release_id, category: input.category_id });
  const id = input.id ?? crypto.randomUUID();

  await db.insert(budget_line_items).values({
    id,
    org_id: orgId,
    release_id: input.release_id,
    category_id: input.category_id ?? null,
    name: input.name,
    amount: input.amount!,
    status: input.status ?? "pending",
  }).onConflictDoNothing({ target: budget_line_items.id });

  return { id, ok: true };
}

export async function updateBudgetItem(orgId: string, input: UpdateBudgetItemInput) {
  await assertBudgetMutationLinks(orgId, { category: input.category_id });
  const updates: Partial<typeof budget_line_items.$inferInsert> = {};

  if (hasOwn(input, "category_id")) updates.category_id = input.category_id as string | null;
  if (hasOwn(input, "name")) updates.name = input.name as string;
  if (hasOwn(input, "amount")) updates.amount = input.amount as number;
  if (hasOwn(input, "status")) updates.status = input.status as string | null;

  const updated = await db
    .update(budget_line_items)
    .set(updates)
    .where(and(eq(budget_line_items.id, input.id), eq(budget_line_items.org_id, orgId)))
    .returning({ id: budget_line_items.id });

  if (!updated.length) {
    throw new NotFoundError("Budget item not found");
  }

  return { ok: true };
}
