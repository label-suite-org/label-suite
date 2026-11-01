import { and, asc, desc, eq, lt, or, sql, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";
import {
  artists,
  releases,
  tracks,
  contacts,
  media_assets,
  documents,
  ops_tasks,
  sync_deals,
  sync_revisions,
  sync_receipts,
} from "../db/schema";
import Decimal from "decimal.js";
import {
  syncSaveSchema,
  receiptSchema,
  revisedSyncDetails,
  syncMoney,
  type SyncSave,
} from "../lib/sync";
import { HttpError } from "./errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const whereDeal = (orgId: string, id: string) =>
  and(eq(sync_deals.org_id, orgId), eq(sync_deals.id, id));
export async function syncOptions(orgId: string) {
  const [
    artistRows,
    releaseRows,
    trackRows,
    contactRows,
    documentRows,
    assetRows,
  ] = await Promise.all([
    db
      .select({ id: artists.id, label: artists.name })
      .from(artists)
      .where(eq(artists.org_id, orgId))
      .orderBy(asc(artists.name)),
    db
      .select({ id: releases.id, label: releases.title })
      .from(releases)
      .where(eq(releases.org_id, orgId))
      .orderBy(asc(releases.title)),
    db
      .select({
        id: tracks.id,
        label: tracks.title,
        version: tracks.version,
        release_id: tracks.release_id,
      })
      .from(tracks)
      .where(eq(tracks.org_id, orgId))
      .orderBy(asc(tracks.title)),
    db
      .select({ id: contacts.id, label: contacts.name })
      .from(contacts)
      .where(eq(contacts.org_id, orgId))
      .orderBy(asc(contacts.name)),
    db
      .select({ id: documents.id, label: documents.name })
      .from(documents)
      .where(eq(documents.org_id, orgId))
      .orderBy(asc(documents.name)),
    db
      .select({ id: media_assets.id, label: media_assets.asset_name, file_link: media_assets.file_link })
      .from(media_assets)
      .where(eq(media_assets.org_id, orgId))
      .orderBy(asc(media_assets.asset_name)),
  ]);
  return {
    artists: artistRows,
    releases: releaseRows,
    tracks: trackRows.map((t) => ({
      ...t,
      label: `${t.label}${t.version ? ` · ${t.version}` : ""}`,
    })),
    contacts: contactRows,
    documents: documentRows,
    assets: assetRows,
  };
}
const pageLimit = z.number().int().min(1).max(50).default(25);
const dealCursorSchema = z
  .object({ updated_at: z.iso.datetime(), id: z.uuid() })
  .strict();
const receiptCursorSchema = z
  .object({ received_date: z.iso.date(), id: z.uuid() })
  .strict();
const revisionCursorSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
function readCursor<T>(
  value: string | undefined,
  schema: z.ZodType<T>,
): T | undefined {
  if (value === undefined) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]{1,1024}$/.test(value)) throw new Error();
    return schema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    throw new HttpError("Invalid page cursor", 400);
  }
}
const encodeCursor = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

export async function listSyncDealsPage(
  orgId: string,
  input: {
    limit?: number;
    cursor?: string;
    artist?: string;
    release?: string;
  } = {},
) {
  const limit = pageLimit.parse(input.limit);
  const cursor = readCursor(input.cursor, dealCursorSchema);
  // Preserve PostgreSQL microseconds in the cursor; JavaScript Dates lose them.
  const timestamp = cursor ? sql`${cursor.updated_at}::timestamp` : undefined;
  const rows = await db
    .select({
      deal: sync_deals,
      next_action: ops_tasks.task_name,
      owner: ops_tasks.owner,
      due_date: ops_tasks.due_date,
      task_status: ops_tasks.status,
      cursor_time: sql<string>`to_char(${sync_deals.updated_at}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(sync_deals)
    .leftJoin(
      ops_tasks,
      and(eq(ops_tasks.id, sync_deals.task_id), eq(ops_tasks.org_id, orgId)),
    )
    .where(
      and(
        eq(sync_deals.org_id, orgId),
        input.artist ? eq(sync_deals.artist_id, input.artist) : undefined,
        input.release ? eq(sync_deals.release_id, input.release) : undefined,
        cursor
          ? or(
              lt(sync_deals.updated_at, timestamp!),
              and(
                eq(sync_deals.updated_at, timestamp!),
                lt(sync_deals.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(sync_deals.updated_at), desc(sync_deals.id))
    .limit(limit + 1);
  const has_more = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(({ cursor_time: _cursor, ...row }) => row),
    next_cursor:
      has_more && last
        ? encodeCursor({ updated_at: last.cursor_time, id: last.deal.id })
        : null,
    has_more,
  };
}
export async function listSyncDeals(orgId: string) {
  return db
    .select({
      deal: sync_deals,
      next_action: ops_tasks.task_name,
      owner: ops_tasks.owner,
      due_date: ops_tasks.due_date,
      task_status: ops_tasks.status,
    })
    .from(sync_deals)
    .leftJoin(
      ops_tasks,
      and(eq(ops_tasks.id, sync_deals.task_id), eq(ops_tasks.org_id, orgId)),
    )
    .where(eq(sync_deals.org_id, orgId))
    .orderBy(desc(sync_deals.updated_at), desc(sync_deals.id));
}
export async function getSyncDeal(orgId: string, id: string) {
  const [row] = await db
    .select({
      deal: sync_deals,
      next_action: ops_tasks.task_name,
      owner: ops_tasks.owner,
      due_date: ops_tasks.due_date,
      task_status: ops_tasks.status,
    })
    .from(sync_deals)
    .leftJoin(
      ops_tasks,
      and(eq(ops_tasks.id, sync_deals.task_id), eq(ops_tasks.org_id, orgId)),
    )
    .where(whereDeal(orgId, id));
  if (!row) throw new HttpError("Sync deal not found", 404);
  const [receipts, revisions] = await Promise.all([
    db
      .select()
      .from(sync_receipts)
      .where(
        and(eq(sync_receipts.org_id, orgId), eq(sync_receipts.deal_id, id)),
      )
      .orderBy(desc(sync_receipts.received_date)),
    db
      .select()
      .from(sync_revisions)
      .where(
        and(eq(sync_revisions.org_id, orgId), eq(sync_revisions.deal_id, id)),
      )
      .orderBy(desc(sync_revisions.version)),
  ]);
  return {
    ...row,
    receipts,
    revisions,
    money: syncMoney(row.deal.details, receipts),
  };
}
export async function getNativeSyncDeal(
  orgId: string,
  id: string,
  input: {
    limit?: number;
    receipts_cursor?: string;
    revisions_cursor?: string;
  } = {},
) {
  z.uuid().parse(id);
  const limit = pageLimit.parse(input.limit);
  const receiptCursor = readCursor(input.receipts_cursor, receiptCursorSchema);
  const revisionCursor = readCursor(
    input.revisions_cursor,
    revisionCursorSchema,
  );
  const [row] = await db
    .select({
      deal: sync_deals,
      next_action: ops_tasks.task_name,
      owner: ops_tasks.owner,
      due_date: ops_tasks.due_date,
      task_status: ops_tasks.status,
    })
    .from(sync_deals)
    .leftJoin(
      ops_tasks,
      and(eq(ops_tasks.id, sync_deals.task_id), eq(ops_tasks.org_id, orgId)),
    )
    .where(whereDeal(orgId, id));
  if (!row) throw new HttpError("Sync deal not found", 404);
  const [receiptRows, revisionRows, totals] = await Promise.all([
    db
      .select({
        ...getTableColumns(sync_receipts),
        document_label: documents.name,
      })
      .from(sync_receipts)
      .leftJoin(
        documents,
        and(
          eq(documents.id, sync_receipts.document_id),
          eq(documents.org_id, orgId),
        ),
      )
      .where(
        and(
          eq(sync_receipts.org_id, orgId),
          eq(sync_receipts.deal_id, id),
          receiptCursor
            ? or(
                lt(sync_receipts.received_date, receiptCursor.received_date),
                and(
                  eq(sync_receipts.received_date, receiptCursor.received_date),
                  lt(sync_receipts.id, receiptCursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(sync_receipts.received_date), desc(sync_receipts.id))
      .limit(limit + 1),
    db
      .select({
        id: sync_revisions.id,
        version: sync_revisions.version,
        actor_id: sync_revisions.actor_id,
        created_at: sync_revisions.created_at,
      })
      .from(sync_revisions)
      .where(
        and(
          eq(sync_revisions.org_id, orgId),
          eq(sync_revisions.deal_id, id),
          revisionCursor
            ? lt(sync_revisions.version, revisionCursor.version)
            : undefined,
        ),
      )
      .orderBy(desc(sync_revisions.version))
      .limit(limit + 1),
    db
      .select({
        currency: sync_receipts.currency,
        amount: sql<string>`sum(${sync_receipts.amount})::text`,
      })
      .from(sync_receipts)
      .where(
        and(eq(sync_receipts.org_id, orgId), eq(sync_receipts.deal_id, id)),
      )
      .groupBy(sync_receipts.currency),
  ]);
  const receipts = receiptRows.slice(0, limit);
  const revisions = revisionRows.slice(0, limit);
  const lastReceipt = receipts.at(-1);
  const lastRevision = revisions.at(-1);
  // Resolve only selected same-workspace references, never the full editor catalog.
  const reference = async (
    table:
      | typeof artists
      | typeof releases
      | typeof tracks
      | typeof contacts
      | typeof documents,
    selected: string | null | undefined,
  ) => {
    if (!selected) return null;
    const label = "name" in table ? table.name : table.title;
    const [value] = await db
      .select({ id: table.id, label })
      .from(table)
      .where(and(eq(table.id, selected), eq(table.org_id, orgId)))
      .limit(1);
    return value ?? null;
  };
  const d = row.deal.details;
  const [
    artist,
    release,
    track,
    contact,
    contract_document,
    invoice_document,
    settlement_document,
    cue_document,
    assetRows,
  ] = await Promise.all([
    reference(artists, row.deal.artist_id),
    reference(releases, row.deal.release_id),
    reference(tracks, row.deal.track_id),
    reference(contacts, row.deal.contact_id),
    reference(documents, d.contract_document_id),
    reference(documents, d.invoice_document_id),
    reference(documents, d.settlement_document_id),
    reference(documents, d.cue_document_id),
    row.deal.asset_id
      ? db
          .select({
            id: media_assets.id,
            label: media_assets.asset_name,
            file_link: media_assets.file_link,
          })
          .from(media_assets)
          .where(
            and(
              eq(media_assets.id, row.deal.asset_id),
              eq(media_assets.org_id, orgId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);
  return {
    ...row,
    receipts,
    revisions,
    money: syncMoney(d, totals),
    receipts_page: {
      has_more: receiptRows.length > limit,
      next_cursor:
        receiptRows.length > limit && lastReceipt
          ? encodeCursor({
              received_date: lastReceipt.received_date,
              id: lastReceipt.id,
            })
          : null,
    },
    revisions_page: {
      has_more: revisionRows.length > limit,
      next_cursor:
        revisionRows.length > limit && lastRevision
          ? encodeCursor({ version: lastRevision.version })
          : null,
    },
    references: {
      artist,
      release,
      track,
      contact,
      asset: assetRows[0] ?? null,
      contract_document,
      invoice_document,
      settlement_document,
      cue_document,
    },
  };
}

async function checkLinks(tx: Tx, orgId: string, input: SyncSave) {
  for (const [id, table] of [
    [input.artist_id, artists],
    [input.release_id, releases],
    [input.track_id, tracks],
    [input.contact_id, contacts],
    [input.asset_id, media_assets],
    ...[
      input.details.contract_document_id,
      input.details.invoice_document_id,
      input.details.settlement_document_id,
      input.details.cue_document_id,
    ].map((id) => [id, documents] as const),
  ] as const) {
    if (!id) continue;
    const rows = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, id), eq(table.org_id, orgId)));
    if (!rows.length)
      throw new HttpError("Linked record not found in this workspace", 404);
  }
  if (input.track_id && input.release_id) {
    const [track] = await tx
      .select({ release_id: tracks.release_id })
      .from(tracks)
      .where(and(eq(tracks.id, input.track_id), eq(tracks.org_id, orgId)));
    if (track.release_id !== input.release_id)
      throw new HttpError("Recording must belong to the selected release", 400);
  }
}
export async function saveSyncDeal(
  orgId: string,
  actorId: string,
  raw: unknown,
) {
  const input = syncSaveSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(sync_deals)
      .where(whereDeal(orgId, input.id))
      .for("update");
    if (
      (!before && input.expected_version !== 0) ||
      (before && before.version !== input.expected_version)
    )
      throw new HttpError("This deal changed. Reload before saving.", 409);
    await checkLinks(tx, orgId, input);
    let details;
    try {
      details = revisedSyncDetails(
        before
          ? {
              ...input,
              ...before,
              artist_id: before.artist_id ?? "",
              release_id: before.release_id ?? "",
              track_id: before.track_id ?? "",
              asset_id: before.asset_id ?? "",
              licensee: before.licensee ?? "",
              contact_id: before.contact_id ?? "",
            }
          : null,
        input,
      );
    } catch (error) {
      throw new HttpError((error as Error).message, 400);
    }
    const version = (before?.version ?? 0) + 1;
    let taskId = before?.task_id ?? null;
    if (input.next_action) {
      const values = {
        task_name: input.next_action,
        owner: input.owner || null,
        due_date: input.due_date || null,
        linked_artist_id: input.artist_id || null,
        linked_release_id: input.release_id || null,
      };
      if (taskId) {
        const [task] = await tx
          .select({ name: ops_tasks.task_name })
          .from(ops_tasks)
          .where(and(eq(ops_tasks.id, taskId), eq(ops_tasks.org_id, orgId)));
        await tx
          .update(ops_tasks)
          .set({
            ...values,
            ...(task?.name !== input.next_action ? { status: "todo" } : {}),
            updated_at: new Date(),
          })
          .where(and(eq(ops_tasks.id, taskId), eq(ops_tasks.org_id, orgId)));
      } else {
        taskId = crypto.randomUUID();
        await tx
          .insert(ops_tasks)
          .values({
            id: taskId,
            org_id: orgId,
            ...values,
            notes: `Sync deal: /sync/${input.id}`,
          });
      }
    } else if (taskId)
      throw new HttpError(
        "Keep the linked next action; complete or replace it through Tasks.",
        400,
      );
    const values = {
      production: input.production,
      licensee: input.licensee || null,
      artist_id: input.artist_id || null,
      release_id: input.release_id || null,
      track_id: input.track_id || null,
      contact_id: input.contact_id || null,
      asset_id: input.asset_id || null,
      task_id: taskId,
      details,
      version,
      updated_at: new Date(),
    };
    if (before)
      await tx.update(sync_deals).set(values).where(whereDeal(orgId, input.id));
    else
      await tx
        .insert(sync_deals)
        .values({ id: input.id, org_id: orgId, ...values });
    await tx
      .insert(sync_revisions)
      .values({
        id: crypto.randomUUID(),
        org_id: orgId,
        deal_id: input.id,
        version,
        snapshot: { ...input, details },
        actor_id: actorId,
      });
  });
  return getSyncDeal(orgId, input.id);
}
export async function recordSyncReceipt(
  orgId: string,
  actorId: string,
  raw: unknown,
) {
  const input = receiptSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [deal] = await tx
      .select({ id: sync_deals.id })
      .from(sync_deals)
      .where(whereDeal(orgId, input.deal_id))
      .for("update");
    if (!deal) throw new HttpError("Sync deal not found", 404);
    if (input.document_id) {
      const [doc] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(eq(documents.org_id, orgId), eq(documents.id, input.document_id)),
        );
      if (!doc)
        throw new HttpError(
          "Receipt document not found in this workspace",
          404,
        );
    }
    const [existing] = await tx
      .select()
      .from(sync_receipts)
      .where(
        and(eq(sync_receipts.id, input.id), eq(sync_receipts.org_id, orgId)),
      );
    if (existing) {
      const normalized = receiptSchema.parse({
        ...input,
        amount: existing.amount,
        deal_id: existing.deal_id,
        currency: existing.currency,
        received_date: existing.received_date,
        reference: existing.reference,
        document_id: existing.document_id ?? "",
      });
      if (
        !new Decimal(input.amount).eq(normalized.amount) ||
        [
          "deal_id",
          "currency",
          "received_date",
          "reference",
          "document_id",
        ].some(
          (k) =>
            input[k as keyof typeof input] !==
            normalized[k as keyof typeof normalized],
        )
      )
        throw new HttpError(
          "Receipt reference was already used with different values",
          409,
        );
      return;
    }
    await tx
      .insert(sync_receipts)
      .values({
        ...input,
        document_id: input.document_id || null,
        org_id: orgId,
        actor_id: actorId,
      });
  });
  return getSyncDeal(orgId, input.deal_id);
}
export const syncMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), input: syncSaveSchema }).strict(),
  z.object({ action: z.literal("receipt"), input: receiptSchema }).strict(),
]);
