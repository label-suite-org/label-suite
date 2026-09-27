import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { artists, contacts, releases, roles, royalties_revenue, tracks, works } from "../db/schema";
import { db } from "../lib/db";
import { NotFoundError } from "./errors";
import { hasOwn, idSchema, nullableNumber, nullableText } from "./validation";

// ─── ISRC normalization ────────────────────────────

export function normalizeIsrc(isrc: string | null | undefined): string {
  if (!isrc) return "";
  return isrc.replace(/[-\s]/g, "").toUpperCase();
}

// ─── ISRC → work_id matching ──────────────────────

export async function matchIsrcToWork(orgId: string, isrc: string): Promise<string | null> {
  const normalized = normalizeIsrc(isrc);
  if (!normalized) return null;

  // Try exact match first
  const exact = await db
    .select({ id: works.id })
    .from(works)
    .where(and(eq(works.isrc, isrc), eq(works.org_id, orgId)))
    .limit(1);

  if (exact.length) return exact[0].id;

  // Try normalized match on primary ISRC
  const all = await db
    .select({ id: works.id, isrc: works.isrc, alt_isrcs: works.alt_isrcs })
    .from(works)
    .where(eq(works.org_id, orgId));

  for (const w of all) {
    if (w.isrc && normalizeIsrc(w.isrc) === normalized) return w.id;
  }

  // Try alt ISRCs (comma-separated)
  for (const w of all) {
    if (w.alt_isrcs) {
      const alts = w.alt_isrcs.split(",").map(s => normalizeIsrc(s.trim()));
      if (alts.includes(normalized)) return w.id;
    }
  }

  return null;
}

export async function matchIsrcToTrack(orgId: string, isrc: string): Promise<string | null> {
  const normalized = normalizeIsrc(isrc);
  if (!normalized) return null;

  const exact = await db
    .select({ id: tracks.id })
    .from(tracks)
    .where(and(eq(tracks.isrc, isrc), eq(tracks.org_id, orgId)))
    .limit(1);

  if (exact.length) return exact[0].id;

  const all = await db
    .select({ id: tracks.id, isrc: tracks.isrc })
    .from(tracks)
    .where(eq(tracks.org_id, orgId));
  for (const t of all) {
    if (t.isrc && normalizeIsrc(t.isrc) === normalized) return t.id;
  }

  return null;
}

async function requireArtistInOrg(orgId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const rows = await db.select({ id: artists.id }).from(artists).where(and(eq(artists.id, id), eq(artists.org_id, orgId))).limit(1);
  if (!rows.length) throw new NotFoundError("Artist not found in active workspace");
  return id;
}

async function requireReleaseInOrg(orgId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const rows = await db.select({ id: releases.id }).from(releases).where(and(eq(releases.id, id), eq(releases.org_id, orgId))).limit(1);
  if (!rows.length) throw new NotFoundError("Release not found in active workspace");
  return id;
}

async function requireWorkInOrg(orgId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const rows = await db.select({ id: works.id }).from(works).where(and(eq(works.id, id), eq(works.org_id, orgId))).limit(1);
  if (!rows.length) throw new NotFoundError("Work not found in active workspace");
  return id;
}

async function requireTrackInOrg(orgId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const rows = await db.select({ id: tracks.id }).from(tracks).where(and(eq(tracks.id, id), eq(tracks.org_id, orgId))).limit(1);
  if (!rows.length) throw new NotFoundError("Track not found in active workspace");
  return id;
}

async function requireContactInOrg(orgId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const rows = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, id), eq(contacts.org_id, orgId))).limit(1);
  if (!rows.length) throw new NotFoundError("Contact not found in active workspace");
  return id;
}

// ─── Zod schemas ──────────────────────────────────

const royaltyBaseSchema = {
  record_name: z.string().trim().min(1, "record_name is required"),
  statement_period: nullableText,
  source: nullableText,
  artist_id: nullableText,
  release_id: nullableText,
  gross_revenue: nullableNumber(),
  costs: nullableNumber(),
  net_revenue: nullableNumber(),
  paid_out: nullableText,
  payment_date: nullableText,
  notes: nullableText,
  revenue_type: nullableText,
  revenue_month: nullableText,
  source_contact_id: nullableText,
  payment_method: nullableText,
  work_id: nullableText,
  track_id: nullableText,
  statement_id: nullableText,
};

export const createRoyaltySchema = z.object({
  id: idSchema.optional(),
  ...royaltyBaseSchema,
});

export const updateRoyaltySchema = z.object({
  id: idSchema,
  ...Object.fromEntries(
    Object.entries(royaltyBaseSchema).map(([key, schema]) => [key, schema.optional()]),
  ),
});

export const deleteRoyaltySchema = z.object({
  id: idSchema,
});

export type CreateRoyaltyInput = z.infer<typeof createRoyaltySchema>;
export type UpdateRoyaltyInput = z.infer<typeof updateRoyaltySchema>;
export type DeleteRoyaltyInput = z.infer<typeof deleteRoyaltySchema>;

// ─── CRUD ─────────────────────────────────────────

export async function listRoyaltyRecords(orgId: string) {
  return db
    .select({
      id: royalties_revenue.id,
      record_name: royalties_revenue.record_name,
      statement_period: royalties_revenue.statement_period,
      source: royalties_revenue.source,
      gross_revenue: royalties_revenue.gross_revenue,
      costs: royalties_revenue.costs,
      net_revenue: royalties_revenue.net_revenue,
      paid_out: royalties_revenue.paid_out,
      payment_date: royalties_revenue.payment_date,
      notes: royalties_revenue.notes,
      revenue_type: royalties_revenue.revenue_type,
      artist_id: royalties_revenue.artist_id,
      release_id: royalties_revenue.release_id,
      work_id: royalties_revenue.work_id,
      track_id: royalties_revenue.track_id,
      statement_id: royalties_revenue.statement_id,
      artist_name: artists.name,
      release_title: releases.title,
      work_title: works.title,
    })
    .from(royalties_revenue)
    .leftJoin(artists, and(eq(royalties_revenue.artist_id, artists.id), eq(artists.org_id, orgId)))
    .leftJoin(releases, and(eq(royalties_revenue.release_id, releases.id), eq(releases.org_id, orgId)))
    .leftJoin(works, and(eq(royalties_revenue.work_id, works.id), eq(works.org_id, orgId)))
    .where(eq(royalties_revenue.org_id, orgId))
    .orderBy(desc(royalties_revenue.created_at));
}

export async function getRoyaltyTotals(orgId: string) {
  const totals = await db
    .select({
      total_net: sql<number>`coalesce(sum(${royalties_revenue.net_revenue}), 0)`,
      unpaid_count: sql<number>`coalesce(sum(case when ${royalties_revenue.paid_out} = 'unpaid' then 1 else 0 end), 0)`.mapWith(Number),
      paid_this_year: sql<number>`coalesce(sum(case when ${royalties_revenue.paid_out} = 'paid' and ${royalties_revenue.payment_date} >= ${new Date().getFullYear() + '-01-01'} then 1 else 0 end), 0)`,
    })
    .from(royalties_revenue)
    .where(eq(royalties_revenue.org_id, orgId));

  return {
    totalNet: totals[0]?.total_net ?? 0,
    unpaidCount: totals[0]?.unpaid_count ?? 0,
    paidThisYear: totals[0]?.paid_this_year ?? 0,
  };
}

export async function createRoyalty(orgId: string, input: CreateRoyaltyInput) {
  const id = input.id ?? crypto.randomUUID();
  const artistId = await requireArtistInOrg(orgId, input.artist_id);
  const releaseId = await requireReleaseInOrg(orgId, input.release_id);
  const workId = await requireWorkInOrg(orgId, input.work_id);
  const trackId = await requireTrackInOrg(orgId, input.track_id);
  const sourceContactId = await requireContactInOrg(orgId, input.source_contact_id);

  await db.insert(royalties_revenue).values({
    id,
    org_id: orgId,
    record_name: input.record_name,
    statement_period: input.statement_period ?? null,
    source: input.source ?? null,
    artist_id: artistId,
    release_id: releaseId,
    gross_revenue: input.gross_revenue ?? null,
    costs: input.costs ?? null,
    net_revenue: input.net_revenue ?? null,
    paid_out: input.paid_out ?? "unpaid",
    payment_date: input.payment_date ?? null,
    notes: input.notes ?? null,
    revenue_type: input.revenue_type ?? null,
    revenue_month: input.revenue_month ?? null,
    source_contact_id: sourceContactId,
    payment_method: input.payment_method ?? null,
    work_id: workId,
    track_id: trackId,
    statement_id: input.statement_id ?? null,
  }).onConflictDoNothing({ target: royalties_revenue.id });

  return { id, ok: true };
}

export async function updateRoyalty(orgId: string, input: UpdateRoyaltyInput) {
  const updates: Partial<typeof royalties_revenue.$inferInsert> = { updated_at: new Date() };

  if (hasOwn(input, "record_name")) updates.record_name = input.record_name as string;
  if (hasOwn(input, "statement_period")) updates.statement_period = input.statement_period as string | null;
  if (hasOwn(input, "source")) updates.source = input.source as string | null;
  if (hasOwn(input, "artist_id")) updates.artist_id = await requireArtistInOrg(orgId, input.artist_id as string | null | undefined);
  if (hasOwn(input, "release_id")) updates.release_id = await requireReleaseInOrg(orgId, input.release_id as string | null | undefined);
  if (hasOwn(input, "gross_revenue")) updates.gross_revenue = input.gross_revenue as number | null;
  if (hasOwn(input, "costs")) updates.costs = input.costs as number | null;
  if (hasOwn(input, "net_revenue")) updates.net_revenue = input.net_revenue as number | null;
  if (hasOwn(input, "paid_out")) updates.paid_out = input.paid_out as string | null;
  if (hasOwn(input, "payment_date")) updates.payment_date = input.payment_date as string | null;
  if (hasOwn(input, "notes")) updates.notes = input.notes as string | null;
  if (hasOwn(input, "revenue_type")) updates.revenue_type = input.revenue_type as string | null;
  if (hasOwn(input, "revenue_month")) updates.revenue_month = input.revenue_month as string | null;
  if (hasOwn(input, "source_contact_id")) updates.source_contact_id = await requireContactInOrg(orgId, input.source_contact_id as string | null | undefined);
  if (hasOwn(input, "payment_method")) updates.payment_method = input.payment_method as string | null;
  if (hasOwn(input, "work_id")) updates.work_id = await requireWorkInOrg(orgId, input.work_id as string | null | undefined);
  if (hasOwn(input, "track_id")) updates.track_id = await requireTrackInOrg(orgId, input.track_id as string | null | undefined);
  if (hasOwn(input, "statement_id")) updates.statement_id = input.statement_id as string | null;

  const updated = await db
    .update(royalties_revenue)
    .set(updates)
    .where(and(eq(royalties_revenue.id, input.id), eq(royalties_revenue.org_id, orgId)))
    .returning({ id: royalties_revenue.id });

  if (!updated.length) {
    throw new NotFoundError("Royalty record not found");
  }

  return { ok: true };
}

// ─── Bulk import ──────────────────────────────────

export const importRoyaltyRowsSchema = z.object({
  rows: z.array(z.object({
    record_name: z.string().trim().min(1, "record_name is required"),
    statement_period: nullableText,
    source: nullableText,
    artist_id: nullableText,
    release_id: nullableText,
    gross_revenue: nullableNumber(),
    costs: nullableNumber(),
    net_revenue: nullableNumber(),
    paid_out: nullableText,
    payment_date: nullableText,
    notes: nullableText,
    revenue_type: nullableText,
    isrc: nullableText,
    work_id: nullableText,
    track_id: nullableText,
  })).min(1, "At least one row is required"),
});

export type ImportRoyaltyRowsInput = z.infer<typeof importRoyaltyRowsSchema>;

export async function bulkCreateRoyalties(orgId: string, input: ImportRoyaltyRowsInput) {
  const statementId = crypto.randomUUID();
  let matchedCount = 0;

  const values = await Promise.all(input.rows.map(async (row) => {
    let workId = await requireWorkInOrg(orgId, row.work_id);
    let trackId = await requireTrackInOrg(orgId, row.track_id);

    if (!workId && row.isrc) {
      workId = await matchIsrcToWork(orgId, row.isrc);
      if (workId) matchedCount++;
    }
    if (!trackId && row.isrc) {
      trackId = await matchIsrcToTrack(orgId, row.isrc);
    }

    return {
      id: crypto.randomUUID(),
      org_id: orgId,
      record_name: row.record_name,
      statement_period: row.statement_period ?? null,
      source: row.source ?? null,
      artist_id: row.artist_id ?? null,
      release_id: row.release_id ?? null,
      gross_revenue: row.gross_revenue ?? null,
      costs: row.costs ?? null,
      net_revenue: row.net_revenue ?? null,
      paid_out: row.paid_out ?? "unpaid",
      payment_date: row.payment_date ?? null,
      notes: row.notes ?? null,
      revenue_type: row.revenue_type ?? null,
      work_id: workId,
      track_id: trackId,
      statement_id: statementId,
    };
  }));

  await db.insert(royalties_revenue).values(values).onConflictDoNothing({ target: royalties_revenue.id });

  return { count: values.length, matched_isrcs: matchedCount, statement_id: statementId, ok: true };
}

// ─── Delete ───────────────────────────────────────

export async function deleteRoyalty(orgId: string, input: DeleteRoyaltyInput) {
  const deleted = await db
    .delete(royalties_revenue)
    .where(and(eq(royalties_revenue.id, input.id), eq(royalties_revenue.org_id, orgId)))
    .returning({ id: royalties_revenue.id });

  if (!deleted.length) {
    throw new NotFoundError("Royalty record not found");
  }

  return { ok: true };
}

// ─── Payout splits ───────────────────────────────

export interface PayoutSplit {
  contact_id: string;
  contact_name: string;
  scope: string;
  role: string;
  percent_share: number;
  amount_owed: number;
  royalty_count: number;
}

export interface ContactPayout {
  contact_id: string;
  contact_name: string;
  master_owed: number;
  publishing_owed: number;
  total_owed: number;
  splits: PayoutSplit[];
}

export async function getPayoutSplits(orgId: string, statementId?: string): Promise<ContactPayout[]> {
  // Get all unpaid royalty records with work_id, joined with roles
  const conditions = [
    eq(royalties_revenue.org_id, orgId),
    eq(royalties_revenue.paid_out, "unpaid"),
  ];
  if (statementId) conditions.push(eq(royalties_revenue.statement_id, statementId));

  const rows = await db
    .select({
      royalty_id: royalties_revenue.id,
      record_name: royalties_revenue.record_name,
      net_revenue: royalties_revenue.net_revenue,
      work_id: royalties_revenue.work_id,
      contact_id: contacts.id,
      contact_name: contacts.name,
      scope: roles.scope,
      role: roles.role,
      percent_share: roles.percent_share,
    })
    .from(royalties_revenue)
    .innerJoin(roles, and(eq(royalties_revenue.work_id, roles.work_id), eq(roles.org_id, orgId)))
    .innerJoin(contacts, and(eq(roles.contact_id, contacts.id), eq(contacts.org_id, orgId)))
    .where(and(...conditions, 
      sql`${roles.ownership_type} != 'Credit'`,
      sql`${roles.scope} = 'Master'`,
      sql`${roles.percent_share} IS NOT NULL`
    ))
    .orderBy(contacts.name, roles.scope);

  // Aggregate by contact
  const contactMap = new Map<string, ContactPayout>();

  for (const row of rows) {
    const share = (row.percent_share ?? 0) / 100;
    const revenue = row.net_revenue ?? 0;
    const amount = revenue * share;

    let cp = contactMap.get(row.contact_id!);
    if (!cp) {
      cp = {
        contact_id: row.contact_id!,
        contact_name: row.contact_name!,
        master_owed: 0,
        publishing_owed: 0,
        total_owed: 0,
        splits: [],
      };
      contactMap.set(row.contact_id!, cp);
    }

    const scope = (row.scope || "Unknown").toLowerCase();
    if (scope === "master") {
      cp.master_owed += amount;
    } else if (scope === "publishing") {
      cp.publishing_owed += amount;
    }

    cp.total_owed += amount;

    cp.splits.push({
      contact_id: row.contact_id!,
      contact_name: row.contact_name!,
      scope: row.scope || "Unknown",
      role: row.role || "Unknown",
      percent_share: row.percent_share ?? 0,
      amount_owed: amount,
      royalty_count: 1, // Will be deduped/summed
    });
  }

  // Dedupe splits (same contact/scope/role → sum amounts)
  for (const cp of contactMap.values()) {
    const merged = new Map<string, PayoutSplit>();
    for (const s of cp.splits) {
      const key = `${s.scope}|${s.role}`;
      if (merged.has(key)) {
        const existing = merged.get(key)!;
        existing.amount_owed += s.amount_owed;
        existing.royalty_count += s.royalty_count;
      } else {
        merged.set(key, { ...s });
      }
    }
    cp.splits = Array.from(merged.values()).sort((a, b) => b.amount_owed - a.amount_owed);
  }

  return Array.from(contactMap.values()).sort((a, b) => b.total_owed - a.total_owed);
}
