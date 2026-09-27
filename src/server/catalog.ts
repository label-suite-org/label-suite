import { z } from "zod";
import { and, asc, count, eq, ilike, or, sql } from "drizzle-orm";
import { catalog_entries, orgs, releases } from "../db/schema";
import { db } from "../lib/db";
import {
  buildCatalogNumberPlan,
  type CatalogEntryKind,
  type CatalogNumberConfig,
  type CatalogOrderingEntry,
} from "./catalog-core";
import { HttpError, NotFoundError } from "./errors";
import { hasOwn, idSchema, nullableText } from "./validation";
import { observeOperation } from "./observability";

const catalogEntryKinds = ["release", "cd", "lp", "video"] as const;
const catalogEntryStatuses = ["planned", "scheduled", "published", "archived"] as const;

const catalogEntryBaseSchema = {
  entry_type: z.enum(catalogEntryKinds),
  title: z.string().trim().min(1, "Title is required").max(240),
  release_id: nullableText,
  release_date: nullableText,
  status: z.enum(catalogEntryStatuses).optional(),
  sort_position: z.number().int().min(0).max(999999).optional(),
  notes: nullableText,
};

export const createCatalogEntrySchema = z.object({
  id: idSchema.optional(),
  ...catalogEntryBaseSchema,
}).strict();

export const updateCatalogEntrySchema = z.object({
  id: idSchema,
  entry_type: catalogEntryBaseSchema.entry_type.optional(),
  title: catalogEntryBaseSchema.title.optional(),
  release_id: catalogEntryBaseSchema.release_id,
  release_date: catalogEntryBaseSchema.release_date,
  status: catalogEntryBaseSchema.status,
  sort_position: catalogEntryBaseSchema.sort_position,
  notes: catalogEntryBaseSchema.notes,
}).strict();

export const deleteCatalogEntrySchema = z.object({ id: idSchema });

export type CreateCatalogEntryInput = z.infer<typeof createCatalogEntrySchema>;
export type UpdateCatalogEntryInput = z.infer<typeof updateCatalogEntrySchema>;
export type DeleteCatalogEntryInput = z.infer<typeof deleteCatalogEntrySchema>;

export type CatalogEntryRow = typeof catalog_entries.$inferSelect & {
  release_title: string | null;
};

type CatalogDbClient = Pick<typeof db, "select" | "insert" | "update">;

const NATIVE_CATALOG_MAX_PAGE_SIZE = 100;

function nativeCatalogOffset(cursor: string | null): number {
  const value = Number(cursor ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function nativeCatalogPageSize(limit: string | null): number {
  const value = Number(limit ?? 50);
  return Number.isInteger(value) ? Math.min(Math.max(value, 1), NATIVE_CATALOG_MAX_PAGE_SIZE) : 50;
}

/** Bounded, workspace-scoped catalog page for native clients. */
export async function listNativeCatalogEntries(orgId: string, options: { query: string | null; cursor: string | null; limit: string | null }) {
  const limit = nativeCatalogPageSize(options.limit);
  const offset = nativeCatalogOffset(options.cursor);
  const query = options.query?.trim() || null;
  const filters = [eq(catalog_entries.org_id, orgId)];
  if (query) {
    const pattern = `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    filters.push(or(ilike(catalog_entries.catalog_number, pattern), ilike(catalog_entries.title, pattern), ilike(releases.title, pattern))!);
  }
  const order = [asc(sql`${catalog_entries.release_date} is null`), asc(catalog_entries.release_date), asc(catalog_entries.sort_position), asc(catalog_entries.created_at), asc(catalog_entries.id)] as const;
  const [rows, totalRows] = await Promise.all([
    db.select({
      id: catalog_entries.id, catalog_number: catalog_entries.catalog_number, entry_type: catalog_entries.entry_type,
      title: catalog_entries.title, release_date: catalog_entries.release_date, status: catalog_entries.status, notes: catalog_entries.notes,
      release_id: catalog_entries.release_id, release_title: releases.title,
      release_count: sql<number>`(select count(*)::int from ${catalog_entries} related where related.org_id = ${orgId} and related.release_id = ${catalog_entries.release_id})`,
    }).from(catalog_entries).leftJoin(releases, and(eq(catalog_entries.release_id, releases.id), eq(releases.org_id, orgId)))
      .where(and(...filters)).orderBy(...order).limit(limit + 1).offset(offset),
    db.select({ total: count() }).from(catalog_entries).leftJoin(releases, and(eq(catalog_entries.release_id, releases.id), eq(releases.org_id, orgId))).where(and(...filters)),
  ]);
  return { rows: rows.slice(0, limit), total: Number(totalRows[0]?.total ?? 0), has_more: rows.length > limit, next_cursor: rows.length > limit ? String(offset + limit) : null, query };
}

export function listCatalogEntries(orgId: string): Promise<CatalogEntryRow[]> {
  return observeOperation("catalog.workspace", orgId, async () => db
    .select({
      id: catalog_entries.id,
      org_id: catalog_entries.org_id,
      entry_type: catalog_entries.entry_type,
      title: catalog_entries.title,
      release_id: catalog_entries.release_id,
      release_date: catalog_entries.release_date,
      status: catalog_entries.status,
      catalog_number: catalog_entries.catalog_number,
      catalog_number_locked: catalog_entries.catalog_number_locked,
      catalog_number_source: catalog_entries.catalog_number_source,
      sort_position: catalog_entries.sort_position,
      notes: catalog_entries.notes,
      created_at: catalog_entries.created_at,
      updated_at: catalog_entries.updated_at,
      release_title: releases.title,
    })
    .from(catalog_entries)
    .leftJoin(releases, and(
      eq(catalog_entries.release_id, releases.id),
      eq(releases.org_id, orgId),
    ))
    .where(eq(catalog_entries.org_id, orgId))
    .orderBy(
      asc(sql`${catalog_entries.release_date} is null`),
      asc(catalog_entries.release_date),
      asc(catalog_entries.sort_position),
      asc(catalog_entries.created_at),
      asc(catalog_entries.id),
    ) as Promise<CatalogEntryRow[]>);
}

export async function listCatalogReleaseOptions(orgId: string) {
  return db
    .select({ id: releases.id, title: releases.title })
    .from(releases)
    .where(eq(releases.org_id, orgId))
    .orderBy(asc(releases.title));
}

export async function createCatalogEntry(orgId: string, input: CreateCatalogEntryInput) {
  return db.transaction(async (tx) => {
    if (input.release_id) await assertReleaseInOrg(tx, orgId, input.release_id);
    const id = input.id ?? crypto.randomUUID();

    await tx.insert(catalog_entries).values({
      id,
      org_id: orgId,
      entry_type: input.entry_type,
      title: input.title,
      release_id: input.release_id ?? null,
      release_date: input.release_date ?? null,
      status: input.status ?? "planned",
      catalog_number_source: "generated",
      sort_position: input.sort_position ?? 0,
      notes: input.notes ?? null,
    }).onConflictDoNothing({ target: catalog_entries.id });

    const created = await requireCatalogEntry(tx, orgId, id);
    await resequenceCatalog(tx, orgId);

    if (created.status === "published" && !created.catalog_number_locked) {
      await tx
        .update(catalog_entries)
        .set({ catalog_number_locked: true, updated_at: new Date() })
        .where(and(eq(catalog_entries.id, id), eq(catalog_entries.org_id, orgId)));
    }

    return { id, ok: true, catalog_number: (await requireCatalogEntry(tx, orgId, id)).catalog_number };
  });
}

export async function updateCatalogEntry(orgId: string, input: UpdateCatalogEntryInput) {
  return db.transaction(async (tx) => {
    const existing = await requireCatalogEntry(tx, orgId, input.id);
    if (input.release_id) await assertReleaseInOrg(tx, orgId, input.release_id);

    const updates: Partial<typeof catalog_entries.$inferInsert> = { updated_at: new Date() };
    if (hasOwn(input, "entry_type")) updates.entry_type = input.entry_type as string;
    if (hasOwn(input, "title")) updates.title = input.title as string;
    if (hasOwn(input, "release_id")) updates.release_id = input.release_id as string | null;
    if (hasOwn(input, "release_date")) updates.release_date = input.release_date as string | null;
    if (input.status !== undefined) updates.status = input.status;
    if (hasOwn(input, "sort_position")) updates.sort_position = input.sort_position as number;
    if (hasOwn(input, "notes")) updates.notes = input.notes as string | null;

    await tx
      .update(catalog_entries)
      .set(updates)
      .where(and(eq(catalog_entries.id, input.id), eq(catalog_entries.org_id, orgId)));

    if (!existing.catalog_number_locked) {
      await resequenceCatalog(tx, orgId);
      const next = await requireCatalogEntry(tx, orgId, input.id);
      if (next.status === "published") {
        await tx
          .update(catalog_entries)
          .set({ catalog_number_locked: true, updated_at: new Date() })
          .where(and(eq(catalog_entries.id, input.id), eq(catalog_entries.org_id, orgId)));
      }
    }

    return { ok: true, catalog_number: (await requireCatalogEntry(tx, orgId, input.id)).catalog_number };
  });
}

export async function deleteCatalogEntry(orgId: string, input: DeleteCatalogEntryInput) {
  return db.transaction(async (tx) => {
    const existing = await requireCatalogEntry(tx, orgId, input.id);
    await tx
      .update(catalog_entries)
      .set({ status: "archived", release_id: null, updated_at: new Date() })
      .where(and(eq(catalog_entries.id, input.id), eq(catalog_entries.org_id, orgId)));

    if (!existing.catalog_number_locked) await resequenceCatalog(tx, orgId);
    return { ok: true };
  });
}

export async function ensureReleaseCatalogEntry(
  client: CatalogDbClient,
  orgId: string,
  releaseId: string,
  releaseOverride?: {
    id: string;
    title: string;
    release_date: string | null;
    status: string | null;
    notes: string | null;
  },
) {
  const existing = await findReleaseCatalogEntry(client, orgId, releaseId);
  if (existing) return existing;

  const release = releaseOverride ?? await requireRelease(client, orgId, releaseId);
  await client.insert(catalog_entries).values({
    id: `release:${release.id}`,
    org_id: orgId,
    entry_type: "release",
    title: release.title,
    release_id: release.id,
    release_date: release.release_date,
    status: catalogStatusForRelease(release.status),
    catalog_number_source: "generated",
    sort_position: 0,
    notes: release.notes,
  }).onConflictDoNothing({ target: catalog_entries.id });

  return requireCatalogEntry(client, orgId, `release:${release.id}`);
}

export async function syncReleaseCatalogEntry(
  client: CatalogDbClient,
  orgId: string,
  releaseId: string,
  options: { allowMissing?: boolean } = {},
) {
  const release = await findReleaseRecord(client, orgId, releaseId);
  if (!release) {
    if (options.allowMissing) return null;
    throw new NotFoundError("Release not found");
  }
  const entry = await ensureReleaseCatalogEntry(client, orgId, releaseId, release);
  await client
    .update(catalog_entries)
    .set({
      title: release.title,
      release_date: release.release_date,
      status: catalogStatusForRelease(release.status),
      notes: release.notes,
      updated_at: new Date(),
    })
    .where(and(eq(catalog_entries.id, entry.id), eq(catalog_entries.org_id, orgId)));

  await resequenceCatalog(client, orgId);
  const next = await requireCatalogEntry(client, orgId, entry.id);
  if (next.status === "published" && !next.catalog_number_locked) {
    await client
      .update(catalog_entries)
      .set({ catalog_number_locked: true, updated_at: new Date() })
      .where(and(eq(catalog_entries.id, entry.id), eq(catalog_entries.org_id, orgId)));
  }
  return requireCatalogEntry(client, orgId, entry.id);
}

export async function archiveReleaseCatalogEntry(
  client: CatalogDbClient,
  orgId: string,
  releaseId: string,
) {
  const entry = await findReleaseCatalogEntry(client, orgId, releaseId);
  if (!entry) return null;

  await client
    .update(catalog_entries)
    .set({
      status: "archived",
      release_id: null,
      updated_at: new Date(),
    })
    .where(and(eq(catalog_entries.id, entry.id), eq(catalog_entries.org_id, orgId)));

  if (!entry.catalog_number_locked) await resequenceCatalog(client, orgId);
  return requireCatalogEntry(client, orgId, entry.id);
}

export async function resequenceCatalogEntries(client: CatalogDbClient, orgId: string): Promise<void> {
  await resequenceCatalog(client, orgId);
}

async function resequenceCatalog(client: CatalogDbClient, orgId: string): Promise<void> {
  const settings = await client
    .select({ prefix: orgs.catalog_prefix, width: orgs.catalog_number_width })
    .from(orgs)
    .where(eq(orgs.id, orgId));
  const entries = await client
    .select()
    .from(catalog_entries)
    .where(eq(catalog_entries.org_id, orgId));
  const config = catalogNumberConfig(settings[0]);
  const plan = buildCatalogNumberPlan(entries.map(toOrderingEntry), config);
  const changed = entries.filter((entry) => !entry.catalog_number_locked && entry.catalog_number !== plan.get(entry.id));

  for (const entry of changed) {
    await client
      .update(catalog_entries)
      .set({ catalog_number: `__pending__:${entry.id}`, updated_at: new Date() })
      .where(and(eq(catalog_entries.id, entry.id), eq(catalog_entries.org_id, orgId)));
  }
  for (const entry of changed) {
    await client
      .update(catalog_entries)
      .set({ catalog_number: plan.get(entry.id)!, catalog_number_source: "generated", updated_at: new Date() })
      .where(and(eq(catalog_entries.id, entry.id), eq(catalog_entries.org_id, orgId)));
  }
}

async function findReleaseCatalogEntry(client: CatalogDbClient, orgId: string, releaseId: string) {
  const rows = await client
    .select()
    .from(catalog_entries)
    .where(and(
      eq(catalog_entries.org_id, orgId),
      eq(catalog_entries.release_id, releaseId),
      eq(catalog_entries.entry_type, "release"),
    ));
  return rows[0] ?? null;
}

async function requireCatalogEntry(client: CatalogDbClient, orgId: string, id: string) {
  const rows = await client
    .select()
    .from(catalog_entries)
    .where(and(eq(catalog_entries.id, id), eq(catalog_entries.org_id, orgId)));
  if (!rows[0]) throw new NotFoundError("Catalog entry not found");
  return rows[0];
}

async function findReleaseRecord(client: CatalogDbClient, orgId: string, id: string) {
  const rows = await client
    .select({
      id: releases.id,
      title: releases.title,
      release_date: releases.release_date,
      status: releases.status,
      notes: releases.notes,
    })
    .from(releases)
    .where(and(eq(releases.id, id), eq(releases.org_id, orgId)));
  return rows[0] ?? null;
}

async function requireRelease(client: CatalogDbClient, orgId: string, id: string) {
  const release = await findReleaseRecord(client, orgId, id);
  if (!release) throw new NotFoundError("Release not found");
  return release;
}

async function assertReleaseInOrg(client: CatalogDbClient, orgId: string, releaseId: string) {
  await requireRelease(client, orgId, releaseId);
}

function toOrderingEntry(entry: typeof catalog_entries.$inferSelect): CatalogOrderingEntry {
  return {
    id: entry.id,
    entry_type: normalizeEntryType(entry.entry_type),
    release_date: entry.release_date,
    sort_position: entry.sort_position,
    created_at: entry.created_at ?? new Date(0),
    catalog_number: entry.catalog_number,
    catalog_number_locked: entry.catalog_number_locked,
  };
}

function normalizeEntryType(value: string): CatalogEntryKind {
  if ((catalogEntryKinds as readonly string[]).includes(value)) return value as CatalogEntryKind;
  throw new HttpError(`Unsupported catalog entry type: ${value}`, 400);
}

function catalogStatusForRelease(value: string | null): string {
  switch ((value ?? "draft").toLowerCase()) {
    case "released": return "published";
    case "scheduled": return "scheduled";
    case "archived": return "archived";
    default: return "planned";
  }
}

function catalogNumberConfig(row: { prefix: string | null; width: number | null } | undefined): CatalogNumberConfig {
  const prefix = row?.prefix?.trim().toUpperCase() || "CAT";
  const width = row?.width && row.width >= 1 && row.width <= 12 ? row.width : 3;
  return { prefix, width };
}
