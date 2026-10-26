import { and, asc, desc, eq } from "drizzle-orm";
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
      .select({ id: media_assets.id, label: media_assets.asset_name })
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
    .orderBy(desc(sync_deals.updated_at));
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
