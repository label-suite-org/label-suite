import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { artist_portals, artist_portal_submissions, artists, documents } from "../db/schema";
import { db, runWithDatabaseContext } from "../lib/db";
import { artistSubmissionSchema, type SharedAgreement } from "../lib/artist-portal";
import { HttpError } from "./errors";
import { createDownloadUrl, tenantStorageKey } from "./storage";

export const portalManagementSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_link") }).strict(),
  z.object({ action: z.literal("revoke") }).strict(),
  z.object({ action: z.literal("share"), document_ids: z.array(z.string().min(1).max(200)).max(100) }).strict(),
  z.object({ action: z.literal("review"), submission_id: z.uuid() }).strict(),
]);

export function portalTokenHash(token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError("This link is unavailable. Ask the label for a new link.", 401);
  return createHash("sha256").update(token).digest("hex");
}

function portalWhere(orgId: string, artistId: string) {
  return and(eq(artist_portals.org_id, orgId), eq(artist_portals.artist_id, artistId));
}

export async function getArtistPortalManagement(orgId: string, artistId: string) {
  const [artist] = await db.select({ id: artists.id, name: artists.name }).from(artists)
    .where(and(eq(artists.org_id, orgId), eq(artists.id, artistId)));
  if (!artist) throw new HttpError("Artist not found", 404);
  const [portal] = await db.select({ id: artist_portals.id, agreements: artist_portals.agreements, revoked_at: artist_portals.revoked_at })
    .from(artist_portals).where(portalWhere(orgId, artistId));
  const availableDocuments = await db.select({ id: documents.id, name: documents.name, status: documents.status, file_link: documents.file_link })
    .from(documents).where(and(eq(documents.org_id, orgId), eq(documents.artist_id, artistId))).orderBy(desc(documents.created_at));
  const submissions = portal ? await listSubmissions(portal.id, orgId) : [];
  return { artist, portal: portal ?? null, documents: availableDocuments, submissions };
}

export async function manageArtistPortal(orgId: string, artistId: string, rawInput: unknown) {
  const input = portalManagementSchema.parse(rawInput);
  const [artist] = await db.select({ name: artists.name }).from(artists)
    .where(and(eq(artists.org_id, orgId), eq(artists.id, artistId)));
  if (!artist) throw new HttpError("Artist not found", 404);
  if (input.action === "create_link") {
    const token = randomBytes(32).toString("base64url");
    await db.insert(artist_portals).values({
      id: randomUUID(), org_id: orgId, artist_id: artistId, artist_name: artist.name, token_hash: portalTokenHash(token),
    }).onConflictDoUpdate({ target: [artist_portals.org_id, artist_portals.artist_id], set: {
      token_hash: portalTokenHash(token), artist_name: artist.name, revoked_at: null, updated_at: new Date(),
    } });
    return { token };
  }
  const [portal] = await db.select({ id: artist_portals.id }).from(artist_portals).where(portalWhere(orgId, artistId));
  if (!portal) throw new HttpError("Create a private link first", 404);
  if (input.action === "revoke") {
    await db.update(artist_portals).set({ revoked_at: new Date(), updated_at: new Date() }).where(portalWhere(orgId, artistId));
  } else if (input.action === "share") {
    const rows = await db.select({ id: documents.id, name: documents.name, status: documents.status, file_link: documents.file_link })
      .from(documents).where(and(eq(documents.org_id, orgId), eq(documents.artist_id, artistId)));
    const agreements: SharedAgreement[] = [...new Set(input.document_ids)].map((id) => {
      const doc = rows.find((row) => row.id === id);
      if (!doc?.file_link) throw new HttpError("Select documents with files belonging to this artist", 400);
      validateAgreementLink(doc.file_link, orgId);
      return { id: doc.id, name: doc.name, status: doc.status, file_link: doc.file_link };
    });
    await db.update(artist_portals).set({ agreements, artist_name: artist.name, updated_at: new Date() }).where(portalWhere(orgId, artistId));
  } else {
    const rows = await db.update(artist_portal_submissions).set({ reviewed_at: new Date() })
      .where(and(eq(artist_portal_submissions.id, input.submission_id), eq(artist_portal_submissions.portal_id, portal.id), eq(artist_portal_submissions.org_id, orgId)))
      .returning({ id: artist_portal_submissions.id });
    if (!rows.length) throw new HttpError("Submission not found", 404);
  }
  return { ok: true };
}

// Only operators can select the source files. Link holders cannot request arbitrary keys.
export function validateAgreementLink(link: string, orgId: string): "url" | "storage" {
  if (/^https?:\/\//i.test(link)) {
    const url = new URL(link);
    if (url.username || url.password) throw new HttpError("Agreement URLs must not contain credentials", 400);
    return "url";
  }
  if (!link || /[:\\]/.test(link) || link.startsWith("/")) throw new HttpError("Unsupported agreement file link", 400);
  tenantStorageKey(orgId, link);
  return "storage";
}

async function listSubmissions(portalId: string, orgId: string) {
  return db.select({ id: artist_portal_submissions.id, details: artist_portal_submissions.details,
    created_at: artist_portal_submissions.created_at, reviewed_at: artist_portal_submissions.reviewed_at })
    .from(artist_portal_submissions)
    .where(and(eq(artist_portal_submissions.portal_id, portalId), eq(artist_portal_submissions.org_id, orgId)))
    .orderBy(desc(artist_portal_submissions.created_at));
}

export async function withArtistPortal<T>(request: Request, operation: (portal: typeof artist_portals.$inferSelect) => Promise<T>): Promise<T> {
  const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] ?? "";
  const hash = portalTokenHash(token);
  // No organization or user context is granted to a link holder. RLS only opens this archive.
  return runWithDatabaseContext({ userId: "" }, async () => {
    await db.execute(sql`select set_config('app.artist_portal_hash', ${hash}, true)`);
    const [portal] = await db.select().from(artist_portals)
      .where(and(eq(artist_portals.token_hash, hash), isNull(artist_portals.revoked_at)));
    if (!portal) throw new HttpError("This link is unavailable. Ask the label for a new link.", 401);
    return operation(portal);
  });
}

export async function readArtistPortal(portal: typeof artist_portals.$inferSelect) {
  const agreements = portal.agreements.map(({ id, name, status }) => ({ id, name, status }));
  return { artist_name: portal.artist_name, agreements, submissions: await listSubmissions(portal.id, portal.org_id) };
}

export async function openArtistAgreement(portal: typeof artist_portals.$inferSelect, documentId: string) {
  const doc = portal.agreements.find((item) => item.id === documentId);
  if (!doc) throw new HttpError("Agreement not found", 404);
  return { url: validateAgreementLink(doc.file_link, portal.org_id) === "url"
    ? doc.file_link : await createDownloadUrl(doc.file_link, portal.org_id, 60) };
}

export async function submitArtistDetails(portal: typeof artist_portals.$inferSelect, rawInput: unknown) {
  const details = artistSubmissionSchema.parse(rawInput);
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${portal.id}, 0))`);
  const [existing] = await db.select({ id: artist_portal_submissions.id, details: artist_portal_submissions.details }).from(artist_portal_submissions)
    .where(and(eq(artist_portal_submissions.portal_id, portal.id), eq(artist_portal_submissions.org_id, portal.org_id), eq(artist_portal_submissions.request_id, details.id)));
  if (existing) {
    if (JSON.stringify(artistSubmissionSchema.parse(existing.details)) !== JSON.stringify(details)) {
      throw new HttpError("This submission was already received with different details. Copy your changes, reload the archive, and send them as a new submission.", 409);
    }
    return { ok: true };
  }
  const [recent] = await db.select({ count: sql<number>`count(*)::int` }).from(artist_portal_submissions)
    .where(and(eq(artist_portal_submissions.portal_id, portal.id), eq(artist_portal_submissions.org_id, portal.org_id), sql`${artist_portal_submissions.created_at} > now() - interval '1 hour'`));
  if (recent.count >= 50) throw new HttpError("Too many submissions. Please try again in an hour.", 429);
  await db.insert(artist_portal_submissions).values({
    id: randomUUID(), org_id: portal.org_id, portal_id: portal.id, request_id: details.id, details,
  });
  return { ok: true };
}

export async function readPortalJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new HttpError("JSON is required", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError("Request body is required", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) {
        await reader.cancel();
        throw new HttpError("Submission is too large", 413);
      }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new HttpError("Invalid JSON body", 400); }
  } finally { reader.releaseLock(); }
}
