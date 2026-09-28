import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { royalty_statements } from "../db/schema";
import { db } from "../lib/db";
import { ConflictError, NotFoundError } from "./errors";

export const reviewRoyaltyStatementSchema = z.object({
  expected_updated_at: z.string().datetime(),
}).strict();

export async function reviewRoyaltyStatement(orgId: string, statementId: string, expectedUpdatedAt: string) {
  return db.transaction(async tx => {
    const [statement] = await tx.select().from(royalty_statements)
      .where(and(eq(royalty_statements.org_id, orgId), eq(royalty_statements.id, statementId))).for("update");
    if (!statement) throw new NotFoundError("Statement not found in this workspace");
    if (statement.updated_at?.getTime() !== new Date(expectedUpdatedAt).getTime()) {
      throw new ConflictError("Statement changed; reload it before reviewing");
    }
    if (statement.status !== "calculated") throw new ConflictError("Only a calculated statement can be reviewed");
    const result = await tx.execute<{ valid: boolean }>(sql`
      select count(*) > 0
        and bool_and(coalesce(line.line_type = 'earning'
          and earning.id is not null and split.id is not null
          and split.contact_id = ${statement.contact_id}
          and earning.currency = ${statement.currency}
          and earning.updated_at <= line.created_at, false))
        and sum(line.amount) = ${statement.earnings_amount}::numeric
        and ${statement.opening_balance}::numeric + ${statement.earnings_amount}::numeric
          + ${statement.adjustments_amount}::numeric - ${statement.payout_amount}::numeric
          = ${statement.closing_balance}::numeric as valid
      from label_suite.royalty_statement_lines line
      left join label_suite.royalty_earnings earning on earning.id = line.earning_id and earning.org_id = line.org_id
      left join label_suite.royalty_split_lines split on split.id = line.split_line_id and split.org_id = line.org_id
      where line.org_id = ${orgId} and line.statement_id = ${statementId}
    `);
    if (result.rows[0]?.valid !== true) {
      throw new ConflictError("Statement evidence or totals need correction before review");
    }
    const [updated] = await tx.update(royalty_statements).set({ status: "reviewed", updated_at: new Date() })
      .where(and(eq(royalty_statements.org_id, orgId), eq(royalty_statements.id, statementId))).returning();
    return updated;
  });
}
