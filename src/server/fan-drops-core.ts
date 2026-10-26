import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HttpError } from "./errors";

export const fanId = z.string().trim().min(1).max(150).regex(/^[A-Za-z0-9_-]+$/);
const webUrl = z.url().max(2048).refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Use an HTTPS URL without credentials");
export const dropContentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(3000),
  artwork_url: webUrl.nullable(),
  privacy_url: webUrl,
  success_url: webUrl.nullable(),
  success_label: z.string().trim().min(1).max(80).default("Continue"),
  shows: z.array(z.object({ event_id: fanId, ticket_url: webUrl.nullable() }).strict()).max(100).default([]),
}).strict().refine(value => new Set(value.shows.map(show => show.event_id)).size === value.shows.length, "Choose each show once");
export type DropContent = z.infer<typeof dropContentSchema>;
export interface PublishedDrop {
  title: string; description: string; artwork_url: string | null; privacy_url: string;
  success_url: string | null; success_label: string; artist_name: string; consent_text: string;
  shows: { id: string; title: string; city: string | null; venue: string | null; starts_at: string | null; start_date: string | null; timezone: string | null; ticket_url: string | null }[];
}
export const saveDropSchema = z.object({
  id: fanId.optional(), expected_revision: z.number().int().positive().optional(), creation_id: z.uuid().optional(),
  artist_id: fanId, release_id: fanId.nullable(),
  slug: z.string().min(3).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  content: dropContentSchema,
}).strict().refine(value => Boolean(value.id) === Boolean(value.expected_revision), "Existing Drops require a revision")
  .refine(value => !value.creation_id || !value.id, "Creation identity is only valid for a new Drop");
export const publishDropSchema = z.object({ id: fanId, expected_revision: z.number().int().positive(), publish: z.boolean() }).strict();
export const fanSignupSchema = z.object({
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  name: z.string().trim().max(150).default(""), city: z.string().trim().max(100).default(""),
  show_id: fanId.nullable().default(null), consent: z.literal(true),
  published_revision: z.number().int().positive(), website: z.string().max(200).default(""),
}).strict();
export const fanAudienceSchema = z.object({ artist_id: fanId, drop_id: fanId.optional(), city: z.string().trim().max(100).optional(), tag: z.string().trim().min(1).max(50).optional() }).strict();
export type FanAudience = z.infer<typeof fanAudienceSchema>;

function tokenSecret() {
  const secret = process.env.FAN_TOKEN_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new HttpError("Fan verification is not configured", 503);
  return secret;
}
export function fanToken(purpose: "confirm" | "unsubscribe", orgId: string, id: string, expires: number) {
  const payload = Buffer.from(JSON.stringify({ purpose, orgId, id, expires })).toString("base64url");
  return `${payload}.${createHmac("sha256", tokenSecret()).update(payload).digest("base64url")}`;
}
export function readFanToken(token: string, purpose: "confirm" | "unsubscribe", now = Date.now()) {
  const invalid = () => new HttpError("This link is invalid or expired. Request a new signup link.", 400);
  if (token.length > 1024) throw invalid();
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw invalid();
  const expected = createHmac("sha256", tokenSecret()).update(payload).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw invalid();
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { throw invalid(); }
  const result = z.object({ purpose: z.literal(purpose), orgId: fanId, id: fanId, expires: z.number().int().positive() }).strict().safeParse(decoded);
  if (!result.success || result.data.expires <= now) throw invalid();
  return result.data;
}
export function fanRateKey(value: string) { return createHmac("sha256", tokenSecret()).update(value).digest("hex"); }
export function fanAllowedEmail() {
  const value = process.env.FAN_ALLOWED_EMAIL;
  if (value === undefined) return null;
  const parsed = z.email().safeParse(value.trim().toLowerCase());
  if (!parsed.success) throw new HttpError("Fan pilot recipient is not configured", 503);
  return parsed.data;
}
export function fanPostalAddress() {
  const value = process.env.FAN_POSTAL_ADDRESS?.trim();
  if (!value || value.length > 500 || /[<>]/.test(value)) throw new HttpError("Fan postal address is not configured", 503);
  return value;
}
export function fanPublicArtistId() {
  if (process.env.FAN_PUBLIC_SIGNUP_ENABLED !== "true") return null;
  const artist = fanId.safeParse(process.env.FAN_PUBLIC_ARTIST_ID);
  if (!artist.success) throw new HttpError("Public fan artist is not configured", 503);
  fanPostalAddress();
  return artist.data;
}
export function fanDailyEmailLimit() {
  const value = Number(process.env.FAN_DAILY_EMAIL_LIMIT ?? "200");
  // shortcut: reserve at least 50 of the current 300/day plan for other mail; revisit with account-wide quota management.
  if (!Number.isSafeInteger(value) || value < 1 || value > 250) throw new HttpError("Fan daily email limit must be between 1 and 250", 503);
  return value;
}
export function requireFanRecipient(orgId: string, email: string, artistId?: string) {
  const allowed = fanAllowedEmail();
  if (!allowed) throw new HttpError("Fan pilot recipient is not configured", 503);
  const publicArtist = fanPublicArtistId();
  if (process.env.FAN_BREVO_ORG_ID !== orgId || (email.toLowerCase() !== allowed && (!publicArtist || publicArtist !== artistId))) throw new HttpError("This signup accepts only permitted addresses", 403);
}
export function fanEmailEnabled() { return process.env.FAN_EMAIL_ENABLED === "true"; }
export function requireFanEmail() {
  if (!fanEmailEnabled()) throw new HttpError("Email signup is not available yet", 503);
  tokenSecret();
  if (!fanAllowedEmail()) throw new HttpError("Fan pilot recipient is not configured", 503);
  fanPublicArtistId(); fanDailyEmailLimit();
  if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) throw new HttpError("Email signup is not configured", 503);
}
