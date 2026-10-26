import { createHash } from "node:crypto";
import { z } from "zod";
import { fanAudienceSchema, fanId, fanPostalAddress, fanPublicArtistId, requireFanEmail } from "./fan-drops-core";
import { HttpError } from "./errors";
import { escapeEmailHtml } from "./email";

export const messageContentSchema = z.object({
  subject: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(10000),
  link_url: z.url().max(2048).refine(value => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }).nullable(),
  link_label: z.string().trim().min(1).max(80).default("Read more"),
}).strict();
export type FanMessageContent = z.infer<typeof messageContentSchema>;
export const saveFanMessageSchema = z.object({ id: fanId.optional(), expected_revision: z.number().int().positive().optional(), creation_id: z.uuid().optional(), audience: fanAudienceSchema, content: messageContentSchema }).strict()
  .refine(value => Boolean(value.id) === Boolean(value.expected_revision), "Existing messages require a revision")
  .refine(value => !value.creation_id || !value.id, "Creation identity is only valid for a new message");
export const messageRevisionSchema = z.object({ id: fanId, expected_revision: z.number().int().positive() }).strict();
export const scheduleFanMessageSchema = messageRevisionSchema.extend({ scheduled_at: z.iso.datetime({ offset: true }), preview_hash: z.string().length(64) });
export function fanPreviewHash(id: string, revision: number, audience: { id: string; email: string }[]) {
  return createHash("sha256").update(JSON.stringify([id, revision, audience.map(row => [row.id, row.email])])).digest("hex");
}
const campaignText = (value: string) => escapeEmailHtml(value).replaceAll("{", "&#123;").replaceAll("}", "&#125;");
export function fanMessageHtml(content: FanMessageContent, artist: string) {
  const address = fanPublicArtistId() || process.env.FAN_POSTAL_ADDRESS?.trim() ? fanPostalAddress() : null;
  return `<h1>${campaignText(content.subject)}</h1><p>${campaignText(content.body).replace(/\n/g, "<br>")}</p>${content.link_url ? `<p><a href="${campaignText(content.link_url)}">${campaignText(content.link_label)}</a></p>` : ""}<p>Email updates from ${campaignText(artist)}, sent by True Nature.</p>${address ? `<p>${campaignText(address).replace(/\n/g, "<br>")}</p>` : ""}<p><a href="{{ unsubscribe }}">Unsubscribe from all email updates sent by this label</a></p>`;
}
export function requireFanBroadcast(orgId: string) {
  requireFanEmail();
  if (process.env.FAN_BROADCAST_ENABLED !== "true" || process.env.FAN_BREVO_ORG_ID !== orgId) throw new HttpError("Fan broadcasts are not enabled for this workspace", 503);
  const folder = Number(process.env.FAN_BREVO_FOLDER_ID);
  if (!Number.isSafeInteger(folder) || folder < 1 || !process.env.FAN_BREVO_WEBHOOK_SECRET || process.env.FAN_BREVO_WEBHOOK_SECRET.length < 32) throw new HttpError("Fan campaign delivery is not configured", 503);
  return folder;
}
export type FanMessageReport = { sent: number; delivered: number; uniqueClicks: number; hardBounces: number; softBounces: number; complaints: number; unsubscriptions: number };
export const fanReportSchema = z.object({ sent: z.number().nonnegative().default(0), delivered: z.number().nonnegative().default(0), uniqueClicks: z.number().nonnegative().default(0), hardBounces: z.number().nonnegative().default(0), softBounces: z.number().nonnegative().default(0), complaints: z.number().nonnegative().default(0), unsubscriptions: z.number().nonnegative().default(0) });
