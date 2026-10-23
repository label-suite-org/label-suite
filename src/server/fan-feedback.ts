import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";
import { fans, fan_subscriptions, fan_signups, fan_messages, fan_activity } from "../db/schema";
import { fanId, fanRateKey } from "./fan-drops-core";
import { ConflictError, HttpError, NotFoundError } from "./errors";

export function authenticateFanWebhook(request: Request, orgId: string) {
  const secret = process.env.FAN_BREVO_WEBHOOK_SECRET;
  const supplied = request.headers.get("x-label-suite-fan-secret") ?? "";
  if (!secret || secret.length < 32 || process.env.FAN_BREVO_ORG_ID !== orgId || Buffer.byteLength(secret) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))) throw new HttpError("Unauthorized", 401);
}
const eventSchema = z.object({ event: z.enum(["delivered", "click", "opened", "proxy_open", "hard_bounce", "soft_bounce", "spam", "unsubscribed"]), email: z.string().trim().email().max(254).transform(value => value.toLowerCase()), camp_id: z.number().int().positive(), ts_event: z.number().int().positive(), URL: z.string().max(2048).optional() });
export async function recordFanWebhook(orgId: string, raw: unknown) {
  const event = eventSchema.parse(raw);
  const [fan] = await db.select().from(fans).where(and(eq(fans.org_id, orgId), eq(fans.email, event.email))).for("update");
  if (!fan) return { accepted: true };
  if (["hard_bounce", "spam", "unsubscribed"].includes(event.event)) await db.update(fans).set({ provider_suppressed: true }).where(eq(fans.id, fan.id));
  const [message] = await db.select().from(fan_messages).where(and(eq(fan_messages.org_id, orgId), eq(fan_messages.provider_campaign_id, event.camp_id)));
  if (!message) return { accepted: true };
  const [subscription] = await db.select({ id: fan_subscriptions.id }).from(fan_subscriptions).where(and(eq(fan_subscriptions.org_id, orgId), eq(fan_subscriptions.fan_id, fan.id), eq(fan_subscriptions.artist_id, message.artist_id)));
  if (!subscription || !message.recipient_ids.includes(subscription.id)) return { accepted: true };
  const id = fanRateKey(JSON.stringify([orgId, event.camp_id, subscription.id, event.event, event.ts_event, event.URL ?? ""]));
  await db.insert(fan_activity).values({ id, org_id: orgId, message_id: message.id, subscription_id: subscription.id, kind: event.event, occurred_at: new Date(event.ts_event * 1000) }).onConflictDoNothing();
  return { accepted: true };
}
export async function listFans(orgId: string, artistId: string) {
  fanId.parse(artistId);
  return db.select({ id: fan_subscriptions.id, email: fans.email, name: fan_subscriptions.name, city: fan_subscriptions.city, tags: fan_subscriptions.tags, status: fan_subscriptions.status, provider_suppressed: fans.provider_suppressed, consent_text: fan_subscriptions.consent_text, consent_at: fan_subscriptions.consent_at, confirmed_at: fan_subscriptions.confirmed_at, revoked_at: fan_subscriptions.revoked_at })
    .from(fan_subscriptions).innerJoin(fans, and(eq(fans.org_id, orgId), eq(fans.id, fan_subscriptions.fan_id))).where(and(eq(fan_subscriptions.org_id, orgId), eq(fan_subscriptions.artist_id, artistId))).orderBy(desc(fan_subscriptions.created_at)).limit(1001);
}
export async function fanHistory(orgId: string, id: string) {
  fanId.parse(id);
  const [subscription] = await db.select().from(fan_subscriptions).where(and(eq(fan_subscriptions.org_id, orgId), eq(fan_subscriptions.id, id)));
  if (!subscription) throw new NotFoundError("Fan not found");
  return { signups: await db.select({ id: fan_signups.id, drop_id: fan_signups.drop_id, show_id: fan_signups.show_id, created_at: fan_signups.created_at, confirmed_at: fan_signups.confirmed_at, email_status: fan_signups.email_status }).from(fan_signups).where(and(eq(fan_signups.org_id, orgId), eq(fan_signups.subscription_id, id))).orderBy(desc(fan_signups.created_at)).limit(100),
    activity: await db.select().from(fan_activity).where(and(eq(fan_activity.org_id, orgId), eq(fan_activity.subscription_id, id))).orderBy(desc(fan_activity.occurred_at)).limit(100) };
}
export async function tagFan(orgId: string, raw: unknown) {
  const input = z.object({ id: fanId, expected_tags: z.array(z.string().max(50)).max(20), tags: z.array(z.string().trim().min(1).max(50)).max(20) }).strict().parse(raw);
  const [row] = await db.update(fan_subscriptions).set({ tags: [...new Set(input.tags)] }).where(and(eq(fan_subscriptions.org_id, orgId), eq(fan_subscriptions.id, input.id), sql`${fan_subscriptions.tags} = ${JSON.stringify(input.expected_tags)}::jsonb`)).returning({ id: fan_subscriptions.id, tags: fan_subscriptions.tags });
  if (!row) throw new ConflictError("Fan tags changed or the fan is unavailable; reload before saving");
  return row;
}
