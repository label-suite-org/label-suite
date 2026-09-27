import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { bugs } from "../db/schema";
import { db } from "../lib/db";
import { NotFoundError } from "./errors";
import { hasOwn, idSchema, nullableText } from "./validation";

export const updateBugSchema = z.object({
  id: idSchema,
  status: nullableText,
  priority: nullableText,
});

export type UpdateBugInput = z.infer<typeof updateBugSchema>;

export async function updateBug(orgId: string, input: UpdateBugInput) {
  const updates: Partial<typeof bugs.$inferInsert> = { updated_at: new Date() };

  if (hasOwn(input, "status")) updates.status = input.status as string | null;
  if (hasOwn(input, "priority")) updates.priority = input.priority as string | null;

  const updated = await db
    .update(bugs)
    .set(updates)
    .where(and(eq(bugs.id, input.id), eq(bugs.org_id, orgId)))
    .returning({ id: bugs.id });

  if (!updated.length) {
    throw new NotFoundError("Bug not found");
  }

  return { ok: true };
}
