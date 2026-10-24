import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { artists, releases, project_events, fan_drops, fans, fan_subscriptions, fan_signups, fan_rate_limits, job_runs } from "../db/schema";
import { db, runWithDatabaseContext } from "../lib/db";
import { ConflictError, HttpError, NotFoundError } from "./errors";
import { saveDropSchema, publishDropSchema, fanSignupSchema, fanAudienceSchema, fanRateKey, fanToken, readFanToken, requireFanEmail, fanAllowedEmail, requireFanRecipient, type PublishedDrop } from "./fan-drops-core";
import { canonicalAppOrigin } from "./request-security";
import { escapeEmailHtml, sendEmailViaBrevo } from "./email";

export function publicDropPath(orgId: string, slug: string) { return `/drops/${encodeURIComponent(orgId)}/${encodeURIComponent(slug)}`; }
export async function listFanDrops(orgId: string, artistId?: string) {
  return db.select().from(fan_drops).where(and(eq(fan_drops.org_id, orgId), artistId ? eq(fan_drops.artist_id, artistId) : undefined)).orderBy(desc(fan_drops.updated_at)).limit(100);
}
export async function saveFanDrop(orgId: string, raw: unknown) {
  const input = saveDropSchema.parse(raw);
  const [artist] = await db.select({ id: artists.id }).from(artists).where(and(eq(artists.org_id, orgId), eq(artists.id, input.artist_id)));
  if (!artist) throw new NotFoundError("Artist not found");
  if (input.release_id) {
    const [release] = await db.select({ id: releases.id }).from(releases).where(and(eq(releases.org_id, orgId), eq(releases.id, input.release_id), eq(releases.artist_id, input.artist_id)));
    if (!release) throw new NotFoundError("Release does not belong to this artist");
  }
  const values = { artist_id: input.artist_id, release_id: input.release_id, slug: input.slug, content: input.content, updated_at: new Date() };
  if (!input.id) return (await db.insert(fan_drops).values({ ...values, id: crypto.randomUUID(), org_id: orgId }).returning())[0];
  const [current] = await db.select().from(fan_drops).where(and(eq(fan_drops.org_id, orgId), eq(fan_drops.id, input.id))).for("update");
  if (!current) throw new NotFoundError("Drop not found");
  if (current.revision !== input.expected_revision) throw new ConflictError("The Drop changed; reload before saving");
  if (current.artist_id !== input.artist_id) throw new ConflictError("Create a new Drop to change its artist");
  if (current.published && current.slug !== input.slug) throw new ConflictError("Unpublish before changing the link");
  return (await db.update(fan_drops).set({ ...values, revision: current.revision + 1 }).where(and(eq(fan_drops.org_id, orgId), eq(fan_drops.id, input.id))).returning())[0];
}
export async function publishFanDrop(orgId: string, raw: unknown) {
  const input = publishDropSchema.parse(raw);
  const [drop] = await db.select().from(fan_drops).where(and(eq(fan_drops.org_id, orgId), eq(fan_drops.id, input.id))).for("update");
  if (!drop) throw new NotFoundError("Drop not found");
  if (drop.revision !== input.expected_revision) throw new ConflictError("The Drop changed; review the current draft");
  let published: PublishedDrop | null = null;
  if (input.publish) {
    const [artist] = await db.select({ name: artists.name }).from(artists).where(and(eq(artists.org_id, orgId), eq(artists.id, drop.artist_id)));
    if (!artist) throw new NotFoundError("Artist not found");
    if (drop.release_id) {
      const [release] = await db.select({ id: releases.id }).from(releases).where(and(eq(releases.org_id, orgId), eq(releases.id, drop.release_id), eq(releases.artist_id, drop.artist_id)));
      if (!release) throw new ConflictError("The release no longer belongs to this artist");
    }
    const ids = drop.content.shows.map(show => show.event_id);
    const events = ids.length ? await db.select().from(project_events).where(and(eq(project_events.org_id, orgId), eq(project_events.artist_id, drop.artist_id), inArray(project_events.id, ids))) : [];
    if (events.length !== ids.length) throw new ConflictError("A selected show is unavailable for this artist");
    const { shows, ...content } = drop.content;
    published = { ...content, artist_name: artist.name, consent_text: `I agree to receive email updates from ${artist.name}. I can unsubscribe at any time.`,
      shows: shows.map(show => {
        const event = events.find(event => event.id === show.event_id)!;
        return { id: event.id, title: event.title, city: event.city, venue: event.venue_name, starts_at: event.starts_at?.toISOString() ?? null, start_date: event.start_date, timezone: event.timezone, ticket_url: show.ticket_url };
      }),
    };
  }
  return (await db.update(fan_drops).set({ published, published_revision: published ? drop.revision : null, revision: drop.revision + 1, updated_at: new Date() })
    .where(and(eq(fan_drops.org_id, orgId), eq(fan_drops.id, input.id))).returning())[0];
}
export async function getPublicFanDrop(orgId: string, slug: string) {
  // This projection never returns draft content, internal event fields or fan identities.
  const [drop] = await db.select({ id: fan_drops.id, slug: fan_drops.slug, published: fan_drops.published, published_revision: fan_drops.published_revision })
    .from(fan_drops).where(and(eq(fan_drops.org_id, orgId), eq(fan_drops.slug, slug), isNotNull(fan_drops.published))).limit(1);
  return drop ?? null;
}
async function takeSignupLimit(orgId: string, key: string, limit: number, windowMs: number, now: Date) {
  const start = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await db.insert(fan_rate_limits).values({ org_id: orgId, key: fanRateKey(key), window_start: start, count: 1 }).onConflictDoUpdate({
    target: [fan_rate_limits.org_id, fan_rate_limits.key],
    set: { window_start: start, count: sql`case when ${fan_rate_limits.window_start} = ${start} then ${fan_rate_limits.count} + 1 else 1 end` },
  }).returning({ count: fan_rate_limits.count });
  if (row.count > limit) throw new HttpError("Too many signup attempts. Please try again later.", 429);
}
export async function signupToFanDrop(orgId: string, slug: string, raw: unknown, clientAddress: string) {
  const input = fanSignupSchema.parse(raw);
  const result = { accepted: true, message: "If eligible, you will receive a confirmation email. Check your inbox." };
  if (input.website) return result;
  requireFanEmail();
  requireFanRecipient(orgId, input.email);
  const [drop] = await db.select().from(fan_drops).where(and(eq(fan_drops.org_id, orgId), eq(fan_drops.slug, slug), isNotNull(fan_drops.published))).for("share");
  if (!drop?.published || !drop.published_revision) throw new NotFoundError("Drop not found");
  if (input.published_revision !== drop.published_revision) throw new ConflictError("This page changed. Reload before signing up.");
  const show = input.show_id ? drop.published.shows.find(show => show.id === input.show_id) : null;
  if (input.show_id && !show) throw new HttpError("Choose a listed show", 400);
  const now = new Date();
  await takeSignupLimit(orgId, `address:${clientAddress}`, 20, 3600_000, now);
  await takeSignupLimit(orgId, `email:${input.email}`, 3, 86400_000, now);
  await takeSignupLimit(orgId, `drop:${drop.id}`, 1000, 3600_000, now);
  const [fan] = await db.insert(fans).values({ id: crypto.randomUUID(), org_id: orgId, email: input.email }).onConflictDoUpdate({ target: [fans.org_id, fans.email], set: { email: input.email } }).returning();
  if (fan.provider_suppressed) return result;
  const [subscription] = await db.insert(fan_subscriptions).values({ id: crypto.randomUUID(), org_id: orgId, fan_id: fan.id, artist_id: drop.artist_id })
    .onConflictDoUpdate({ target: [fan_subscriptions.org_id, fan_subscriptions.fan_id, fan_subscriptions.artist_id], set: { fan_id: fan.id } }).returning();
  const id = crypto.randomUUID();
  await db.insert(fan_signups).values({ id, org_id: orgId, drop_id: drop.id, subscription_id: subscription.id, name: input.name, city: show?.city ?? input.city,
    success_url: drop.published.success_url, success_label: drop.published.success_label, show_id: input.show_id, consent_text: drop.published.consent_text, published_revision: drop.published_revision, expires_at: new Date(now.getTime() + 86400_000), created_at: now });
  // The job and signup commit together; no network call occurs in the request transaction.
  await db.insert(job_runs).values({ id: crypto.randomUUID(), org_id: orgId, job_type: "fan_confirmation", trigger: "api", payload: { signupId: id }, idempotency_key: id, max_attempts: 3 });
  return result;
}
export async function confirmFanSignup(token: string) {
  const claims = readFanToken(token, "confirm");
  return runWithDatabaseContext({ userId: "fan-public", orgId: claims.orgId }, async () => {
    const [identity] = await db.select({ fan_id: fan_subscriptions.fan_id, subscription_id: fan_subscriptions.id }).from(fan_signups)
      .innerJoin(fan_subscriptions, eq(fan_subscriptions.id, fan_signups.subscription_id))
      .where(and(eq(fan_signups.org_id, claims.orgId), eq(fan_signups.id, claims.id)));
    if (!identity) throw new NotFoundError("Signup not found");
    const [fan] = await db.select().from(fans).where(and(eq(fans.org_id, claims.orgId), eq(fans.id, identity.fan_id))).for("update");
    const [subscription] = await db.select().from(fan_subscriptions).where(and(eq(fan_subscriptions.org_id, claims.orgId), eq(fan_subscriptions.id, identity.subscription_id))).for("update");
    const [signup] = await db.select().from(fan_signups).where(and(eq(fan_signups.org_id, claims.orgId), eq(fan_signups.id, claims.id))).for("update");
    if (!signup || signup.expires_at.getTime() <= Date.now()) throw new HttpError("This signup link expired", 400);
    if (!subscription) throw new NotFoundError("Subscription not found");
    if (subscription.revoked_at && subscription.revoked_at >= signup.created_at) throw new ConflictError("You unsubscribed after requesting this link. Sign up again if you want updates.");
    if (!fan || fan.provider_suppressed) throw new ConflictError("This address cannot receive email updates. Contact the artist for help.");
    if (!signup.confirmed_at) {
      const now = new Date();
      if (!subscription.consent_at || subscription.consent_at <= signup.created_at) await db.update(fan_subscriptions).set({ status: "confirmed", name: signup.name, city: signup.city, consent_text: signup.consent_text, consent_revision: signup.published_revision,
        consent_at: signup.created_at, confirmed_at: now, revoked_at: null }).where(and(eq(fan_subscriptions.org_id, claims.orgId), eq(fan_subscriptions.id, subscription.id)));
      await db.update(fan_signups).set({ confirmed_at: now }).where(and(eq(fan_signups.org_id, claims.orgId), eq(fan_signups.id, signup.id)));
    }
    const unsubscribe = new URL("/fans/unsubscribe", canonicalAppOrigin());
    unsubscribe.searchParams.set("token", fanToken("unsubscribe", claims.orgId, subscription.id, Date.now() + 3650 * 86400_000));
    return { confirmed: true, success_url: signup.success_url, success_label: signup.success_label, unsubscribe_url: unsubscribe.toString() };
  });
}
export async function unsubscribeFan(token: string) {
  const claims = readFanToken(token, "unsubscribe");
  return runWithDatabaseContext({ userId: "fan-public", orgId: claims.orgId }, async () => {
    await db.update(fan_subscriptions).set({ status: "unsubscribed", revoked_at: new Date() }).where(and(eq(fan_subscriptions.org_id, claims.orgId), eq(fan_subscriptions.id, claims.id)));
    return { unsubscribed: true };
  });
}
export async function fanAudience(orgId: string, raw: unknown) {
  const input = fanAudienceSchema.parse(raw);
  const conditions = [eq(fan_subscriptions.org_id, orgId), eq(fans.org_id, orgId), eq(fan_subscriptions.artist_id, input.artist_id), eq(fan_subscriptions.status, "confirmed"), eq(fans.provider_suppressed, false)];
  const allowed = fanAllowedEmail();
  if (allowed) { requireFanRecipient(orgId, allowed); conditions.push(eq(fans.email, allowed)); }
  if (input.city) conditions.push(sql`lower(${fan_subscriptions.city}) = lower(${input.city})`);
  if (input.tag) conditions.push(sql`${fan_subscriptions.tags} @> ${JSON.stringify([input.tag])}::jsonb`);
  if (input.drop_id) conditions.push(sql`exists (select 1 from ${fan_signups} where ${fan_signups.org_id} = ${orgId} and ${fan_signups.subscription_id} = ${fan_subscriptions.id} and ${fan_signups.drop_id} = ${input.drop_id} and ${fan_signups.confirmed_at} is not null)`);
  return db.select({ id: fan_subscriptions.id, email: fans.email, name: fan_subscriptions.name, city: fan_subscriptions.city, tags: fan_subscriptions.tags, confirmed_at: fan_subscriptions.confirmed_at })
    .from(fan_subscriptions).innerJoin(fans, eq(fans.id, fan_subscriptions.fan_id)).where(and(...conditions)).orderBy(asc(fan_subscriptions.id)).limit(10001);
}
export async function dispatchFanConfirmation(orgId: string, signupId: string, signal?: AbortSignal) {
  requireFanEmail();
  const prepared = await runWithDatabaseContext({ userId: "fan-worker", orgId }, async () => {
    await db.select({ id: fan_signups.id }).from(fan_signups).where(and(eq(fan_signups.org_id, orgId), eq(fan_signups.id, signupId))).for("update");
    const [row] = await db.select({ signup: fan_signups, email: fans.email, suppressed: fans.provider_suppressed, artist: artists.name, revoked: fan_subscriptions.revoked_at })
      .from(fan_signups).innerJoin(fan_subscriptions, and(eq(fan_subscriptions.id, fan_signups.subscription_id), eq(fan_subscriptions.org_id, orgId)))
      .innerJoin(fans, and(eq(fans.id, fan_subscriptions.fan_id), eq(fans.org_id, orgId)))
      .innerJoin(artists, and(eq(artists.id, fan_subscriptions.artist_id), eq(artists.org_id, orgId)))
      .where(and(eq(fan_signups.org_id, orgId), eq(fan_signups.id, signupId)));
    if (!row || ["submitted", "failed", "unknown", "suppressed"].includes(row.signup.email_status)) return null;
    const suppressed = row.suppressed || row.signup.confirmed_at || row.signup.expires_at.getTime() <= Date.now() || (row.revoked && row.revoked >= row.signup.created_at);
    const status = suppressed ? "suppressed" : row.signup.email_status === "sending" ? "unknown" : "sending";
    await db.update(fan_signups).set({ email_status: status }).where(and(eq(fan_signups.org_id, orgId), eq(fan_signups.id, signupId)));
    return status === "sending" ? row : null;
  });
  if (!prepared) return { skipped: true };
  let status: "submitted" | "failed" | "unknown" = "unknown";
  try {
    requireFanRecipient(orgId, prepared.email);
    const token = fanToken("confirm", orgId, signupId, prepared.signup.expires_at.getTime());
    const url = new URL("/fans/confirm", canonicalAppOrigin()); url.searchParams.set("token", token);
    const unsubscribe = new URL("/fans/unsubscribe", canonicalAppOrigin());
    unsubscribe.searchParams.set("token", fanToken("unsubscribe", orgId, prepared.signup.subscription_id, Date.now() + 3650 * 86400_000));
    const result = await sendEmailViaBrevo({ signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), toEmail: prepared.email, subject: `Confirm email updates from ${prepared.artist}`,
      htmlBody: `<p>You requested email updates from ${escapeEmailHtml(prepared.artist)}.</p><p><a href="${escapeEmailHtml(url.toString())}">Confirm my email</a></p><p>This link expires in 24 hours. If you did not request it, ignore this email.</p><p><a href="${escapeEmailHtml(unsubscribe.toString())}">Unsubscribe from this artist</a></p>` });
    status = result.status === "sent" ? "submitted" : "failed";
  } catch { /* A timeout may follow provider acceptance; never resend an unknown outcome. */ }
  await runWithDatabaseContext({ userId: "fan-worker", orgId }, () => db.update(fan_signups).set({ email_status: status }).where(and(eq(fan_signups.org_id, orgId), eq(fan_signups.id, signupId))));
  return { status };
}
