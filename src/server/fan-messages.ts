import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { artists, fan_messages, fan_subscriptions, fans, job_runs } from "../db/schema";
import { db, runWithDatabaseContext } from "../lib/db";
import { ConflictError, HttpError, NotFoundError } from "./errors";
import { fanAudience } from "./fan-drops";
import { saveFanMessageSchema, messageRevisionSchema, scheduleFanMessageSchema, fanPreviewHash, fanMessageHtml, fanReportSchema, requireFanBroadcast } from "./fan-messages-core";

export async function listFanMessages(orgId: string, artistId?: string) {
  const rows = await db.select().from(fan_messages).where(and(eq(fan_messages.org_id, orgId), artistId ? eq(fan_messages.artist_id, artistId) : undefined)).orderBy(desc(fan_messages.created_at)).limit(100);
  return rows.map(({ recipient_ids: _, ...message }) => message);
}
async function lockedMessage(orgId: string, id: string, revision?: number) {
  const [message] = await db.select().from(fan_messages).where(and(eq(fan_messages.org_id, orgId), eq(fan_messages.id, id))).for("update");
  if (!message) throw new NotFoundError("Message not found");
  if (revision !== undefined && message.revision !== revision) throw new ConflictError("Message changed; reload and review it");
  return message;
}
export async function saveFanMessage(orgId: string, raw: unknown) {
  const input = saveFanMessageSchema.parse(raw);
  const [artist] = await db.select({ id: artists.id }).from(artists).where(and(eq(artists.org_id, orgId), eq(artists.id, input.audience.artist_id)));
  if (!artist) throw new NotFoundError("Artist not found");
  if (input.id) {
    const current = await lockedMessage(orgId, input.id, input.expected_revision);
    if (current.status !== "draft") throw new ConflictError("Only draft messages can be edited. Cancel and create a new draft to reschedule.");
    return (await db.update(fan_messages).set({ artist_id: artist.id, audience: input.audience, content: input.content, revision: current.revision + 1, updated_at: new Date() }).where(eq(fan_messages.id, current.id)).returning())[0];
  }
  return (await db.insert(fan_messages).values({ id: crypto.randomUUID(), org_id: orgId, artist_id: artist.id, audience: input.audience, content: input.content }).returning())[0];
}
export async function previewFanMessage(orgId: string, raw: unknown) {
  const input = messageRevisionSchema.parse(raw);
  const message = await lockedMessage(orgId, input.id, input.expected_revision);
  const audience = await fanAudience(orgId, message.audience);
  const [artist] = await db.select({ name: artists.name }).from(artists).where(and(eq(artists.org_id, orgId), eq(artists.id, message.artist_id)));
  return { count: audience.length, audience: audience.slice(0, 500), limit_exceeded: audience.length > 500, preview_hash: fanPreviewHash(message.id, message.revision, audience), html: fanMessageHtml(message.content, artist?.name ?? "Artist") };
}
export async function scheduleFanMessage(orgId: string, raw: unknown) {
  const input = scheduleFanMessageSchema.parse(raw); requireFanBroadcast(orgId);
  const message = await lockedMessage(orgId, input.id, input.expected_revision);
  if (message.status !== "draft") throw new ConflictError("Only a draft can be scheduled");
  const scheduled = new Date(input.scheduled_at);
  if (scheduled.getTime() < Date.now() || scheduled.getTime() > Date.now() + 366 * 86400_000) throw new HttpError("Choose a future time within one year", 400);
  const audience = await fanAudience(orgId, message.audience);
  // shortcut: at most 500 recipients per campaign; raise after measuring worker and provider throughput.
  if (!audience.length || audience.length > 500) throw new HttpError("Choose an audience of 1–500 confirmed fans", 400);
  if (fanPreviewHash(message.id, message.revision, audience) !== input.preview_hash) throw new ConflictError("Audience changed; preview it again before scheduling");
  const [updated] = await db.update(fan_messages).set({ status: "scheduled", scheduled_at: scheduled, recipient_ids: audience.map(row => row.id), recipient_count: audience.length, revision: message.revision + 1, updated_at: new Date() }).where(eq(fan_messages.id, message.id)).returning();
  await db.insert(job_runs).values({ id: crypto.randomUUID(), org_id: orgId, job_type: "fan_message", trigger: "api", payload: { messageId: message.id }, available_at: scheduled, idempotency_key: message.id, max_attempts: 3 });
  return updated;
}
export async function cancelFanMessage(orgId: string, raw: unknown) {
  const input = messageRevisionSchema.parse(raw);
  const message = await lockedMessage(orgId, input.id, input.expected_revision);
  if (!["draft", "scheduled"].includes(message.status)) throw new ConflictError("Delivery has started; this message can no longer be cancelled here");
  return (await db.update(fan_messages).set({ status: "cancelled", revision: message.revision + 1, updated_at: new Date() }).where(eq(fan_messages.id, message.id)).returning())[0];
}

async function brevo(path: string, method: "GET" | "POST", body?: unknown, signal?: AbortSignal, allowMissing = false): Promise<unknown> {
  signal?.throwIfAborted();
  const response = await fetch(`https://api.brevo.com/v3${path}`, { method, headers: { "api-key": process.env.BREVO_API_KEY!, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new HttpError(`Email provider request failed (${response.status})`, 503);
  if (response.status === 204) return null;
  return response.json();
}
const providerId = z.object({ id: z.number().int().positive() });
const providerContact = z.object({ emailBlacklisted: z.boolean() });
const workerContext = <T>(orgId: string, operation: () => Promise<T>) => runWithDatabaseContext({ userId: "fan-worker", orgId }, operation);

export async function dispatchFanMessage(orgId: string, messageId: string, signal?: AbortSignal) {
  const folderId = requireFanBroadcast(orgId);
  const message = await workerContext(orgId, async () => {
    const row = await lockedMessage(orgId, messageId);
    if (["preparing", "submitting"].includes(row.status)) {
      await db.update(fan_messages).set({ status: "review", failure_code: "worker_interrupted", updated_at: new Date() }).where(eq(fan_messages.id, row.id));
      return null;
    }
    if (row.status !== "scheduled" || !row.scheduled_at || row.scheduled_at.getTime() > Date.now()) return null;
    await db.update(fan_messages).set({ status: "preparing", updated_at: new Date() }).where(eq(fan_messages.id, row.id));
    return row;
  });
  if (!message) return { skipped: true };
  let stage = "prepare_list";
  try {
    const initial = await workerContext(orgId, () => fanAudience(orgId, message.audience));
    const approved = new Set(message.recipient_ids);
    const candidates = initial.filter(row => approved.has(row.id));
    const list = providerId.parse(await brevo("/contacts/lists", "POST", { name: `Label Suite ${message.id}`, folderId }, signal));
    await workerContext(orgId, () => db.update(fan_messages).set({ provider_list_id: list.id }).where(eq(fan_messages.id, messageId)));
    stage = "prepare_contacts";
    const synced: typeof candidates = [];
    for (const candidate of candidates) {
      const existing = await brevo(`/contacts/${encodeURIComponent(candidate.email)}`, "GET", undefined, signal, true);
      if (existing !== null && providerContact.parse(existing).emailBlacklisted) {
        await workerContext(orgId, () => db.update(fans).set({ provider_suppressed: true }).where(and(eq(fans.org_id, orgId), eq(fans.email, candidate.email))));
        continue;
      }
      // Never reset emailBlacklisted or add contacts to an existing welcome list.
      await brevo("/contacts", "POST", { email: candidate.email, listIds: [list.id], updateEnabled: true }, signal);
      synced.push(candidate);
    }
    const [artist] = await workerContext(orgId, () => db.select({ name: artists.name }).from(artists).where(and(eq(artists.org_id, orgId), eq(artists.id, message.artist_id))));
    stage = "create_campaign";
    const campaign = providerId.parse(await brevo("/emailCampaigns", "POST", { name: `Label Suite ${message.id}`, type: "classic", subject: message.content.subject,
      sender: { email: process.env.BREVO_SENDER_EMAIL, name: artist.name }, htmlContent: fanMessageHtml(message.content, artist.name), recipients: { listIds: [list.id] } }, signal));
    // Persist the provider identity before any send. Lost create responses require manual reconciliation.
    await workerContext(orgId, () => db.update(fan_messages).set({ provider_campaign_id: campaign.id, status: "submitting" }).where(eq(fan_messages.id, messageId)));
    stage = "submit_campaign";
    await workerContext(orgId, async () => {
      // Consent changes wait for this bounded handoff; later opt-outs cannot recall queued provider mail.
      if (synced.length) {
        const ids = synced.map(row => row.id);
        const subscriptions = await db.select({ fan_id: fan_subscriptions.fan_id }).from(fan_subscriptions).where(and(eq(fan_subscriptions.org_id, orgId), inArray(fan_subscriptions.id, ids)));
        if (subscriptions.length) await db.select({ id: fans.id }).from(fans).where(and(eq(fans.org_id, orgId), inArray(fans.id, subscriptions.map(row => row.fan_id)))).orderBy(asc(fans.id)).for("update");
        await db.select({ id: fan_subscriptions.id }).from(fan_subscriptions).where(and(eq(fan_subscriptions.org_id, orgId), inArray(fan_subscriptions.id, ids))).orderBy(asc(fan_subscriptions.id)).for("update");
      }
      const eligible = new Set((await fanAudience(orgId, message.audience)).map(row => row.id));
      const removed = synced.filter(row => !eligible.has(row.id));
      if (removed.length) {
        const removal = z.object({ contacts: z.object({ success: z.array(z.string()).default([]), failure: z.array(z.string()).default([]) }) }).parse(await brevo(`/contacts/lists/${list.id}/contacts/remove`, "POST", { emails: removed.map(row => row.email) }, signal));
        if (removal.contacts.failure.length || removed.some(row => !removal.contacts.success.includes(row.email))) throw new ConflictError("Provider did not confirm all audience exclusions");
      }
      const count = synced.length - removed.length;
      if (count) {
        requireFanBroadcast(orgId); signal?.throwIfAborted();
        await brevo(`/emailCampaigns/${campaign.id}/sendNow`, "POST", undefined, signal);
      }
      await db.update(fan_messages).set({ status: count ? "submitted" : "cancelled", recipient_count: count, updated_at: new Date() }).where(eq(fan_messages.id, messageId));
    });
    return { submitted: true };
  } catch {
    // Provider acceptance may precede a lost response. Retrying must never repeat a send.
    await workerContext(orgId, () => db.update(fan_messages).set({ status: "review", failure_code: stage, updated_at: new Date() }).where(eq(fan_messages.id, messageId)));
    return { review_required: true, stage };
  }
}
export async function reconcileFanMessage(orgId: string, raw: unknown) {
  const input = messageRevisionSchema.parse(raw);
  if (process.env.FAN_BREVO_ORG_ID !== orgId || !process.env.BREVO_API_KEY) throw new HttpError("Email provider is not configured for this workspace", 503);
  const message = await lockedMessage(orgId, input.id, input.expected_revision);
  if (!message.provider_campaign_id) throw new ConflictError("No provider campaign ID is recorded. Check the provider using this message ID before taking further action.");
  const report = z.object({ id: z.number(), name: z.string(), status: z.string(), statistics: z.object({ globalStats: fanReportSchema }).optional() }).parse(await brevo(`/emailCampaigns/${message.provider_campaign_id}?statistics=globalStats&excludeHtmlContent=true`, "GET"));
  if (report.id !== message.provider_campaign_id || report.name !== `Label Suite ${message.id}`) throw new ConflictError("Provider campaign identity does not match");
  const status = report.status === "sent" ? "sent" : ["queued", "scheduled"].includes(report.status) ? "submitted" : message.status;
  return (await db.update(fan_messages).set({ status, report: report.statistics?.globalStats ?? null, updated_at: new Date() }).where(eq(fan_messages.id, message.id)).returning())[0];
}
