import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { campaigns } from "../db/schema";
import { db } from "../lib/db";
import { deriveCampaignDocument, legacyTextToCampaignDocument } from "../lib/campaign-rich-text";
import { createCampaignSchema, updateCampaign } from "./campaigns";
import { ConflictError, NotFoundError } from "./errors";
import { recordAuditEvent } from "./integrations";

export const nativeCampaignCreateSchema = createCampaignSchema.omit({ goal_document: true, notes_document: true })
  .extend({ id: z.uuid(), campaign_name: z.string().trim().min(1).max(500) }).strict();
export const nativeCampaignPlanSchema = nativeCampaignCreateSchema.omit({ id: true }).partial()
  .extend({ expected_revision: z.number().int().positive() }).strict().superRefine((input, ctx) => {
    if (Object.keys(input).length < 2) ctx.addIssue({ code: "custom", message: "Change at least one plan field" });
    if ((input.linked_artist_id !== undefined) !== (input.linked_release_id !== undefined)) ctx.addIssue({ code: "custom", message: "Artist and release must be reviewed together" });
  });

const fields = ["campaign_name", "linked_artist_id", "linked_release_id", "campaign_type", "start_date", "end_date", "status", "owner", "goal", "brief", "notes", "budget_planned", "budget_actual", "kpi_summary", "performance_rating", "main_platform"] as const;
function plainDocument(document: unknown, text: string | null) {
  if (document === null) return true;
  try {
    const derived = deriveCampaignDocument(document, 20_000);
    return derived.plainText === (text ?? "") && isDeepStrictEqual(derived.document, legacyTextToCampaignDocument(derived.plainText));
  } catch { return false; }
}
function readonlyFields(row: typeof campaigns.$inferSelect) {
  return [!plainDocument(row.goal_document, row.goal) ? "goal" : null, !plainDocument(row.notes_document, row.notes) ? "notes" : null,
    row.brief_document !== null ? "brief" : null].filter((key): key is string => key !== null);
}
export async function getNativeCampaignPlan(orgId: string, id: string) {
  const [row] = await db.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.org_id, orgId)));
  if (!row) throw new NotFoundError("Campaign not found");
  return { id, revision: row.revision, fields: Object.fromEntries(fields.map(key => [key, row[key] === null ? "" : String(row[key])])), readonly_fields: readonlyFields(row) };
}
export async function updateNativeCampaignPlan(orgId: string, id: string, input: z.infer<typeof nativeCampaignPlanSchema>, actorUserId: string) {
  return db.transaction(async tx => {
    const [current] = await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.org_id, orgId))).for("update");
    if (!current) throw new NotFoundError("Campaign not found");
    if (current.revision !== input.expected_revision) throw new ConflictError("Campaign changed; reload and review before saving.");
    if (readonlyFields(current).some(key => Object.hasOwn(input, key))) throw new ConflictError("Rich campaign documents cannot be replaced by plain text. Use the full editor.");
    await updateCampaign(orgId, { id, ...input }, tx);
    await recordAuditEvent(orgId, { actor_user_id: actorUserId, event_type: "campaign.plan.update", object_type: "campaign", object_id: id,
      before: Object.fromEntries(Object.keys(input).filter(key => key !== "expected_revision").map(key => [key, current[key as keyof typeof current]])),
      after: input, metadata: { expected_revision: current.revision, resulting_revision: current.revision + 1 } }, tx);
    return { id, ok: true, revision: current.revision + 1 };
  });
}
