import { pool } from "../lib/db";
import { sealSecret, openSecret } from "./gmail-enrichment";
import { jobStore } from "./jobs";
import { normalizeSquare, sourceID, type SquarePayment, type SquareOrder } from "./tour-money-core";

const scopes = ["MERCHANT_PROFILE_READ", "PAYMENTS_READ", "ORDERS_READ"];
async function request<T>(path: string, token: string | null, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch("https://connect.squareup.com" + path, { method: body ? "POST" : "GET", redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { "Square-Version": "2026-09-16", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(response.status === 401 ? "Square access expired or was revoked; reconnect the account" : `Square request failed (HTTP ${response.status})`);
  return response.json() as Promise<T>;
}
type Token = { access_token: string; refresh_token: string; expires_at: string; merchant_id?: string; refreshed_at?: string };
function validToken(token: Token) { return token.access_token && token.refresh_token && Number.isFinite(Date.parse(token.expires_at)); }

export async function enqueueTourSquareSyncs(now = new Date()) {
  // The worker's PGOPTIONS establishes its assigned organization, as for calendar jobs.
  const { rows } = await pool.query("select org_id, project_id from label_suite.tour_square_connections where enabled and org_id=label_suite.current_org_id()");
  for (const row of rows) await jobStore.enqueue({ orgId: row.org_id, jobType: "tour_square_sync", trigger: "scheduled", payload: { projectId: row.project_id },
    idempotencyKey: `${row.project_id}:${Math.floor(now.getTime() / 300_000)}`, maxAttempts: 3 });
  return rows.length;
}

export async function syncTourSquare(orgId: string, projectId: string, abort: AbortSignal) {
  const client = await pool.connect();
  const signal = AbortSignal.any([abort, AbortSignal.timeout(240_000)]);
  const lock = `tour-square:${orgId}:${projectId}`;
  let locked = false, transaction = false;
  try {
    await client.query("select set_config('app.current_org_id',$1,false)", [orgId]);
    locked = (await client.query("select pg_try_advisory_lock(hashtextextended($1,93)) as acquired", [lock])).rows[0].acquired;
    if (!locked) return { skipped: "already_running" };
    const connection = (await client.query("select c.* from label_suite.tour_square_connections c join label_suite.budget_projects p on p.id=c.project_id and p.org_id=c.org_id where c.org_id=$1 and c.project_id=$2 and c.enabled", [orgId, projectId])).rows[0];
    if (!connection) return { skipped: "not_enabled" };
    await client.query("update label_suite.tour_square_connections set last_attempt_at=now() where org_id=$1 and project_id=$2", [orgId, projectId]);
    let token: Token = JSON.parse(openSecret(connection.encrypted_token));
    if (!validToken(token)) throw new Error("Square credentials need reconnecting");
    // Renew weekly; commit the single-use refresh token before any fallible sales fetch.
    const issued = token.refreshed_at ? Date.parse(token.refreshed_at) : Date.parse(token.expires_at) - 30 * 86400000;
    if (issued < Date.now() - 7 * 86400000 || Date.parse(token.expires_at) < Date.now() + 86400000) {
      const fresh = await request<Token>("/oauth2/token", null, signal, { client_id: connection.client_id, grant_type: "refresh_token", refresh_token: token.refresh_token, scopes });
      if (!validToken(fresh) || (fresh.merchant_id && fresh.merchant_id !== connection.merchant_id)) throw new Error("Square refresh incomplete; reconnect the account");
      token = { ...fresh, refreshed_at: new Date().toISOString() };
      await client.query("update label_suite.tour_square_connections set encrypted_token=$3 where org_id=$1 and project_id=$2", [orgId, projectId, sealSecret(JSON.stringify(token))]);
    }
    const locations = await request<{ locations?: { id: string }[] }>("/v2/locations", token.access_token, signal);
    const payments = new Map<string, SquarePayment>();
    for (const location of locations.locations ?? []) {
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const query = new URLSearchParams({ begin_time: connection.begin_at.toISOString(), end_time: connection.end_at.toISOString(), location_id: location.id, limit: "100", ...(cursor ? { cursor } : {}) });
        const page = await request<{ payments?: SquarePayment[]; cursor?: string }>("/v2/payments?" + query, token.access_token, signal);
        for (const payment of page.payments ?? []) payments.set(payment.id, payment);
        cursor = page.cursor;
        if (cursor && seen.has(cursor)) throw new Error("Square returned a repeated page");
        if (cursor) seen.add(cursor);
        if (payments.size > 5000 || seen.size > 100) throw new Error("Square import period exceeds the safe page limit");
      } while (cursor);
    }
    const ids = [...new Set([...payments.values()].filter(p => p.status === "COMPLETED" && p.order_id).map(p => p.order_id))];
    const orders = new Map<string, SquareOrder>();
    for (let i = 0; i < ids.length; i += 100) {
      const page = await request<{ orders?: SquareOrder[] }>("/v2/orders/batch-retrieve", token.access_token, signal, { order_ids: ids.slice(i, i + 100) });
      for (const order of page.orders ?? []) orders.set(order.id, order);
    }
    const rows = [...payments.values()].map(p => normalizeSquare(connection.merchant_id, p, orders.get(p.order_id)));
    signal.throwIfAborted();
    await client.query("begin"); transaction = true;
    // Serialize with migration/manual writes to prevent importing over an overlapping card total.
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,94))", [lock]);
    const overlap = await client.query("select id from label_suite.tour_money_entries where org_id=$1 and project_id=$2 and not voided and data->>'kind' in ('merch_card','merch_refund') and not (data ? 'square') limit 1", [orgId, projectId]);
    if (overlap.rowCount) throw new Error("Manual card sales overlap; reconcile before Square sync");
    let changed = 0;
    for (const row of rows) {
      if (row.data) {
        const result = await client.query(`insert into label_suite.tour_money_entries(id,org_id,project_id,source_key,data) values($1,$2,$3,$4,$5)
          on conflict(org_id,source_key) do update set data=excluded.data,updated_at=now()
          where tour_money_entries.project_id=excluded.project_id and not tour_money_entries.voided
          and tour_money_entries.data is distinct from excluded.data
          and coalesce(tour_money_entries.data#>>'{square,updatedAt}','') <= excluded.data#>>'{square,updatedAt}'`,
          [sourceID(`${orgId}:${row.source}`), orgId, projectId, row.source, row.data]);
        changed += result.rowCount ?? 0;
      } else if (row.held) {
        // A new ambiguous refund must not leave an old receipt appearing verified.
        await client.query("update label_suite.tour_money_entries set data=jsonb_set(data,'{square,review}',to_jsonb($4::text)),updated_at=now() where org_id=$1 and project_id=$2 and source_key=$3 and data ? 'square' and not voided", [orgId, projectId, row.source, row.held]);
      }
    }
    const held = rows.filter(r => r.held).length;
    await client.query("update label_suite.tour_square_connections set last_success_at=now(),error=null,held_count=$3 where org_id=$1 and project_id=$2", [orgId, projectId, held]);
    await client.query("commit"); transaction = false;
    return { changed, verified: rows.filter(r => r.data).length, held };
  } catch (error) {
    if (transaction) await client.query("rollback");
    // Only our own bounded messages are persisted; provider response bodies/tokens never are.
    const message = error instanceof Error && /^(Square |Manual card)/.test(error.message) ? error.message : "Square sync failed; retry or check the server connection";
    if (locked) await client.query("update label_suite.tour_square_connections set error=$3 where org_id=$1 and project_id=$2", [orgId, projectId, message]);
    throw new Error(message);
  } finally {
    try {
      if (locked) await client.query("select pg_advisory_unlock(hashtextextended($1,93))", [lock]);
      await client.query("reset app.current_org_id");
      client.release();
    } catch { client.release(true); }
  }
}
