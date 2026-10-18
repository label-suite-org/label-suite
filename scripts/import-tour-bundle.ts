/** Operator-only, private JSON input. Dry-run is the default. Never commit a tour bundle. */
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { pool } from "../src/lib/db";
import { sourceID, tourEntrySchema } from "../src/server/tour-money-core";
import { sealSecret } from "../src/server/gmail-enrichment";
const cents = z.number().int().nonnegative();
const bundleSchema = z.object({
  org: z.string().min(1), project: z.string().min(1),
  unresolved: z.array(z.string()).default([]),
  entries: z.array(z.object({ data: tourEntrySchema, voided: z.boolean().default(false) })),
  budgets: z.array(z.object({ source: z.string(), name: z.string(), cents })).default([]),
  supersededBudgets: z.array(z.object({ id: z.string(), expectedForecast: z.number() })).default([]),
  shows: z.array(z.object({ event: z.string(), expectedDate: z.iso.date(), guarantee: cents, expectedGuarantee: z.number().nullable(), currency: z.string() })).default([]),
  stays: z.array(z.object({ source: z.string(), title: z.string(), address: z.string().nullable(), checkIn: z.iso.date(), checkOut: z.iso.date().nullable(), status: z.string(), reference: z.string().nullable(), notes: z.string().nullable(), estimatedCost: cents.optional(),
    existingId: z.string().optional(), expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  }).refine(stay => Boolean(stay.existingId) === Boolean(stay.expectedUpdatedAt), "Existing lodging requires its snapshot revision")).default([]),
  itinerary: z.array(z.object({ event: z.string(), expectedDate: z.iso.date(), expectedNotes: z.string().nullable(), notes: z.string(),
    title: z.object({ expected: z.string(), value: z.string() }).optional(),
    status: z.object({ expected: z.string(), value: z.enum(["planned", "confirmed", "tentative", "cancelled", "external"]) }).optional(),
  })).default([]),
  square: z.object({ merchant: z.string(), client: z.string(), begin: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }),
    token: z.object({ access_token: z.string(), refresh_token: z.string(), expires_at: z.iso.datetime({ offset: true }), merchant_id: z.string().optional() }).passthrough(),
  }).optional(),
});
const args = process.argv.slice(2), path = args.find(a => !a.startsWith("--"));
if (!path || args.some(a => a.startsWith("--") && !["--apply", "--enable-square"].includes(a))) throw new Error("Usage: import-tour-bundle.ts PRIVATE.json [--apply] [--enable-square]");
const mode = await stat(path);
if (mode.mode & 0o077) throw new Error("Tour bundle must be private (chmod 600)");
const bundle = bundleSchema.parse(JSON.parse(await readFile(path, "utf8")));
if (bundle.unresolved.length) throw new Error("Tour bundle has unresolved reconciliation decisions; no import attempted");
if (new Set(bundle.entries.map(e => e.data.source)).size !== bundle.entries.length) throw new Error("Duplicate source identities in bundle");
const client = await pool.connect();
let changes = 0;
try {
  await client.query("begin");
  await client.query("select set_config('app.current_org_id',$1,true)", [bundle.org]);
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,94))", [`tour-square:${bundle.org}:${bundle.project}`]);
  const project = (await client.query("select id,currency from label_suite.budget_projects where org_id=$1 and id=$2 and project_type='tour' for update", [bundle.org, bundle.project])).rows[0];
  if (!project) throw new Error("Target tour not found in this organization");
  for (const entry of bundle.entries) {
    const existing = (await client.query("select project_id,data,voided from label_suite.tour_money_entries where org_id=$1 and source_key=$2", [bundle.org, entry.data.source])).rows[0];
    if (existing) {
      // Migration never overwrites a later live sync, an edit, or a void.
      if (existing.project_id !== bundle.project) throw new Error("A source already belongs to another tour");
      continue;
    }
    await client.query("insert into label_suite.tour_money_entries(id,org_id,project_id,source_key,data,voided) values($1,$2,$3,$4,$5,$6)", [sourceID(`${bundle.org}:${entry.data.source}`), bundle.org, bundle.project, entry.data.source, entry.data, entry.voided]); changes++;
  }
  for (const old of bundle.supersededBudgets) {
    const row = (await client.query("select forecast_amount from label_suite.budget_line_items where id=$1 and org_id=$2 and project_id=$3 for update", [old.id, bundle.org, bundle.project])).rows[0];
    if (!row) throw new Error("Superseded budget is outside this tour");
    if (Number(row.forecast_amount) === 0) continue;
    if (Number(row.forecast_amount) !== old.expectedForecast) throw new Error("Budget changed since reconciliation");
    await client.query("update label_suite.budget_line_items set forecast_amount=0,variance_reason='Superseded by reconciled TREK tour allowances; original plan retained',updated_at=now() where id=$1 and org_id=$2", [old.id, bundle.org]); changes++;
  }
  for (const line of bundle.budgets) {
    const present = (await client.query("select org_id,project_id from label_suite.budget_line_items where id=$1", [sourceID(`${bundle.org}:${line.source}`)])).rows[0];
    if (present && (present.org_id !== bundle.org || present.project_id !== bundle.project)) throw new Error("Budget source belongs to another project");
    const result = await client.query("insert into label_suite.budget_line_items(id,org_id,project_id,name,amount,planned_amount,forecast_amount,phase,status) values($1,$2,$3,$4,$5,$5,$5,'tour','pending') on conflict(id) do nothing", [sourceID(`${bundle.org}:${line.source}`), bundle.org, bundle.project, line.name, line.cents / 100]);
    changes += result.rowCount ?? 0;
  }
  for (const show of bundle.shows) {
    const event = (await client.query("select id from label_suite.project_events where org_id=$1 and project_id=$2 and id=$3 and start_date=$4", [bundle.org, bundle.project, show.event, show.expectedDate])).rows[0];
    if (!event) throw new Error("Show mapping no longer matches the target tour");
    const prior = (await client.query("select guarantee from label_suite.tour_show_details where org_id=$1 and event_id=$2", [bundle.org, show.event])).rows[0];
    const priorAmount = prior?.guarantee == null ? null : Number(prior.guarantee);
    if (priorAmount !== show.expectedGuarantee && priorAmount !== show.guarantee / 100) throw new Error("Show guarantee changed since reconciliation");
    const result = await client.query(`insert into label_suite.tour_show_details(id,org_id,event_id,guarantee,currency) values($1,$2,$3,$4,$5)
      on conflict(org_id,event_id) do update set guarantee=excluded.guarantee,currency=excluded.currency,updated_at=now()
      where tour_show_details.guarantee is distinct from excluded.guarantee or tour_show_details.currency is distinct from excluded.currency`, [sourceID(`${bundle.org}:trek-show:${show.event}`), bundle.org, show.event, show.guarantee / 100, show.currency]);
    changes += result.rowCount ?? 0;
  }
  for (const stay of bundle.stays) {
    const id = stay.existingId ?? sourceID(`${bundle.org}:${stay.source}`);
    const duplicate = await client.query("select id from label_suite.tour_lodging where org_id=$1 and project_id=$2 and check_in=$3 and id<>$4 and (booking_reference=$5 or stop_name=$6)", [bundle.org, bundle.project, stay.checkIn, id, stay.reference, stay.title]);
    if (duplicate.rowCount) throw new Error("Lodging overlaps an existing record; reconcile before importing");
    if (stay.existingId) {
      const prior = (await client.query("select *,check_in::text as arrival,check_out::text as departure from label_suite.tour_lodging where id=$1 and org_id=$2 and project_id=$3 for update", [id, bundle.org, bundle.project])).rows[0];
      if (!prior) throw new Error("Existing lodging is outside this tour");
      const same = prior.stop_name === stay.title && prior.address === stay.address && prior.arrival === stay.checkIn && prior.departure === stay.checkOut && prior.booking_status === stay.status && prior.booking_reference === stay.reference && prior.notes === stay.notes && (stay.estimatedCost === undefined || Number(prior.estimated_cost) === stay.estimatedCost / 100);
      if (same) continue;
      if (new Date(prior.updated_at).getTime() !== Date.parse(stay.expectedUpdatedAt!)) throw new Error("Lodging changed since reconciliation");
      await client.query("update label_suite.tour_lodging set stop_name=$4,address=$5,check_in=$6,check_out=$7,booking_status=$8,booking_reference=$9,notes=$10,estimated_cost=coalesce($11,estimated_cost),updated_at=now() where id=$1 and org_id=$2 and project_id=$3", [id,bundle.org,bundle.project,stay.title,stay.address,stay.checkIn,stay.checkOut,stay.status,stay.reference,stay.notes,stay.estimatedCost === undefined ? null : stay.estimatedCost / 100]);
      changes++;
      continue;
    }
    const result = await client.query("insert into label_suite.tour_lodging(id,org_id,project_id,stop_name,address,check_in,check_out,booking_status,booking_reference,notes,estimated_cost) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(id) do nothing", [id, bundle.org, bundle.project, stay.title, stay.address, stay.checkIn, stay.checkOut, stay.status, stay.reference, stay.notes,stay.estimatedCost === undefined ? null : stay.estimatedCost / 100]);
    changes += result.rowCount ?? 0;
  }
  for (const day of bundle.itinerary) {
    const prior = (await client.query("select title,status,notes from label_suite.project_events where id=$1 and org_id=$2 and project_id=$3 and start_date=$4 for update", [day.event,bundle.org,bundle.project,day.expectedDate])).rows[0];
    if (!prior) throw new Error("Itinerary mapping no longer matches the tour");
    if (prior.notes !== day.expectedNotes && prior.notes !== day.notes) throw new Error("Itinerary notes changed since reconciliation");
    if (day.title && prior.title !== day.title.expected && prior.title !== day.title.value) throw new Error("Event title changed since reconciliation");
    if (day.status && prior.status !== day.status.expected && prior.status !== day.status.value) throw new Error("Event status changed since reconciliation");
    const title = day.title?.value ?? prior.title, status = day.status?.value ?? prior.status;
    if (prior.notes === day.notes && prior.title === title && prior.status === status) continue;
    await client.query("update label_suite.project_events set notes=$4,title=$5,status=$6,updated_at=now() where id=$1 and org_id=$2 and project_id=$3", [day.event,bundle.org,bundle.project,day.notes,title,status]);
    changes++;
  }
  if (bundle.square) {
    const square = bundle.square, providerID = sourceID(`square-provider:${bundle.org}`), connectionID = sourceID(`square-connection:${bundle.org}:${bundle.project}`);
    if (square.token.merchant_id && square.token.merchant_id !== square.merchant) throw new Error("Square merchant mismatch");
    if (Date.parse(square.end) <= Date.parse(square.begin) || Date.parse(square.token.expires_at) <= Date.now()) throw new Error("Square period or authorization is expired");
    const existing = (await client.query("select merchant_id from label_suite.tour_square_connections where org_id=$1 and project_id=$2", [bundle.org, bundle.project])).rows[0];
    if (existing && existing.merchant_id !== square.merchant) throw new Error("Square account already differs");
    if (!existing) {
      await client.query("insert into label_suite.integration_providers(id,org_id,key,name,category,auth_type,status,capabilities) values($1,$2,'square-tour','Square tour sales','commerce','oauth','active',$3)", [providerID, bundle.org, JSON.stringify(["payments.read", "orders.read", "merchant.read"])]);
      await client.query("insert into label_suite.integration_connections(id,org_id,provider_id,label,status) values($1,$2,$3,'Tour Square sales','connected')", [connectionID, bundle.org, providerID]);
      await client.query("insert into label_suite.tour_square_connections(connection_id,org_id,project_id,merchant_id,client_id,encrypted_token,begin_at,end_at,enabled) values($1,$2,$3,$4,$5,$6,$7,$8,$9)", [connectionID,bundle.org,bundle.project,square.merchant,square.client,sealSecret(JSON.stringify(square.token)),square.begin,square.end,args.includes("--enable-square")]); changes++;
    }
  }
  if (changes > 0) {
    const { square: _credentials, ...source } = bundle;
    const hash = createHash("sha256").update(JSON.stringify(source)).digest("hex");
    const run = "tour_import_" + randomUUID();
    await client.query("insert into label_suite.project_import_runs(id,org_id,source_system,source_base_id,mode,status,source_count,snapshot_hash,completed_at) values($1,$2,'trek',$3,'migration','completed',$4,$5,now())", [run, bundle.org, bundle.project, changes, hash]);
    await client.query("insert into label_suite.project_source_records(id,org_id,import_run_id,source_system,source_base_id,source_table_id,source_record_id,normalized_payload_hash,raw_payload,entity_type,entity_id) values($1,$2,$3,'trek',$4,'tour-bundle',$5,$5,$6,'project',$4) on conflict do nothing", [sourceID(`${bundle.org}:${bundle.project}:${hash}`), bundle.org, run, bundle.project, hash, source]);
  }
  await client.query(args.includes("--apply") ? "commit" : "rollback");
  console.log(JSON.stringify({ applied: args.includes("--apply"), changes, entries: bundle.entries.length, stays: bundle.stays.length, budgets: bundle.budgets.length, itineraryDays: bundle.itinerary.length, squareProvisioned: Boolean(bundle.square) }));
} catch {
  await client.query("rollback");
  // Do not print database parameters or credentials from an operator bundle.
  console.error("Tour import aborted. No changes committed. Inspect the private bundle and reconciliation mappings.");
  process.exitCode = 1;
} finally { client.release(); await pool.end(); }
