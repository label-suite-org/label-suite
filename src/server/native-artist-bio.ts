import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { artists, org_memberships } from "../db/schema";
import { db } from "../lib/db";
import { normalizeReviewedRichText } from "../lib/reviewed-rich-text";
import { reviewArtistBio } from "./artists";
import { HttpError, NotFoundError } from "./errors";
import { recordAuditEvent } from "./integrations";
import { hasCapability, type MembershipRole } from "./native-capabilities";

export const nativeArtistBioReviewSchema = z.object({ expected_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export async function getNativeArtistBio(orgId: string, artistId: string, executor: Pick<typeof db, "select"> = db) {
  const [row] = await executor.select().from(artists)
    .where(and(eq(artists.org_id, orgId), eq(artists.id, artistId))).limit(1);
  if (!row) throw new NotFoundError("Artist not found");
  const source = normalizeReviewedRichText(row.bio_document, row.bio, {
    reviewStatus: row.bio_review_status === "reviewed" ? "reviewed" : "draft", reviewedHash: row.bio_reviewed_hash,
  });
  return { id: row.id, document: source.document, plain_text: source.plainText, hash: source.hash,
    state: source.state, reviewable: !source.usedFallback && source.state !== "missing", used_fallback: source.usedFallback };
}

export async function reviewNativeArtistBio(orgId: string, artistId: string, actorId: string, raw: unknown) {
  const input = nativeArtistBioReviewSchema.parse(raw);
  return db.transaction(async executor => {
    const [member] = await executor.select({ role: org_memberships.role }).from(org_memberships)
      .where(and(eq(org_memberships.org_id, orgId), eq(org_memberships.user_id, actorId))).for("share");
    if (!member) throw new HttpError("Workspace access removed", 403, "workspace_access_removed");
    if (!hasCapability(member.role as MembershipRole, "operations.mutate")) throw new HttpError("Insufficient permissions", 403);
    const [row] = await executor.select({ id: artists.id }).from(artists)
      .where(and(eq(artists.org_id, orgId), eq(artists.id, artistId))).for("update");
    if (!row) throw new NotFoundError("Artist not found");
    const before = await getNativeArtistBio(orgId, artistId, executor);
    const reviewed = await reviewArtistBio(orgId, artistId, actorId, { expectedHash: input.expected_hash, executor });
    if (before.state !== "reviewed") await recordAuditEvent(orgId, {
      actor_user_id: actorId, event_type: "artist.bio_reviewed", object_type: "artist", object_id: artistId,
      before: { state: before.state, hash: before.hash }, after: { state: reviewed.state, hash: reviewed.hash },
    }, executor);
    return { id: artistId, ...reviewed };
  });
}
