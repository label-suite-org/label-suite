import { createHash } from 'node:crypto';
import { and, desc, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../lib/db';
import { budget_projects, tour_money_entries, tour_receipts } from '../db/schema';
import { HttpError } from './errors';
import { extractTourReceipt } from './tour-receipt-extraction';

// shortcut: Paperless API v9 is pinned for its stable task fields; migrate when v9 support ends.
type Receipt = typeof tour_receipts.$inferSelect;
function paperlessConfig(org: string) {
  if (org !== process.env.PAPERLESS_ORG_ID || !process.env.PAPERLESS_URL || !process.env.PAPERLESS_TOKEN) throw new HttpError('Receipt archive is not connected for this workspace', 503);
  const url = new URL(process.env.PAPERLESS_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new HttpError('Receipt archive configuration needs attention', 503);
  return { url: url.origin, token: process.env.PAPERLESS_TOKEN };
}
async function paperless<T>(org: string, path: string, init: RequestInit = {}): Promise<T> {
  const config = paperlessConfig(org);
  let response: Response;
  try { response = await fetch(config.url + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(25000), headers: { Accept: 'application/json; version=9', Authorization: `Token ${config.token}`, ...init.headers } }); }
  catch { throw new HttpError('Receipt archive could not be reached. Your receipt can be retried.', 503); }
  if (!response.ok) throw new HttpError(`Receipt archive request failed (${response.status}). Check the connection and retry.`, 502);
  return response.json() as Promise<T>;
}
async function tour(org: string, project: string) {
  const [row] = await db.select().from(budget_projects).where(and(eq(budget_projects.org_id, org), eq(budget_projects.id, project)));
  if (!row || row.project_type !== 'tour') throw new HttpError('Tour not found', 404);
  return row;
}
function view(row: Receipt) {
  return { id: row.id, status: row.status, upload_confirmed: Boolean(row.task_id || row.document_id), error: row.error, entry_id: row.entry_id,
    document_url: row.document_id ? `${paperlessConfig(row.org_id).url}/documents/${row.document_id}/details` : null,
    suggestion: extractTourReceipt(row.content), text: row.content.slice(0, 20000), created_at: row.created_at.toISOString() };
}
export async function listTourReceipts(org: string, project: string) {
  await tour(org, project);
  paperlessConfig(org);
  const rows = await db.select().from(tour_receipts).where(and(eq(tour_receipts.org_id, org), eq(tour_receipts.project_id, project))).orderBy(desc(tour_receipts.created_at)).limit(100);
  return { items: rows.map(view) };
}
const archiveDocumentSchema = z.object({id:z.number().int().positive(),title:z.string(),created:z.string()});
export async function listPaperlessReceipts(org: string, project: string, query: string, page: number) {
  await tour(org, project); paperlessConfig(org);
  z.string().max(200).parse(query); z.number().int().min(1).max(10000).parse(page);
  const params = new URLSearchParams({page:String(page),page_size:'30',ordering:'-created',fields:'id,title,created'});
  if (query.trim()) params.set('title__icontains',query.trim());
  const result = z.object({results:z.array(archiveDocumentSchema),next:z.string().nullable()}).parse(
    await paperless<unknown>(org,`/api/documents/?${params}`));
  // Never follow a server-provided URL with the archive credential.
  return {items:result.results,next_page:result.next && page < 10000 ? page+1 : null};
}
export async function linkPaperlessReceipt(org: string, project: string, id: string, documentID: number) {
  z.uuid().parse(id); z.number().int().positive().parse(documentID);
  await tour(org, project); paperlessConfig(org);
  // These reads enforce Paperless object permissions, including on repeated selections.
  const doc = archiveDocumentSchema.extend({content:z.string()}).parse(
    await paperless<unknown>(org,`/api/documents/${documentID}/?fields=id,title,created,content`));
  if (doc.id !== documentID) throw new HttpError('Receipt archive returned a different document',502);
  const metadata = z.object({original_checksum:z.string().regex(/^[a-f0-9]{64}$/)}).parse(
    await paperless<unknown>(org,`/api/documents/${documentID}/metadata/`));
  await db.insert(tour_receipts).values({id,org_id:org,project_id:project,sha256:metadata.original_checksum,
    document_id:documentID,status:'review',content:doc.content.slice(0,60000)}).onConflictDoNothing();
  const rows = await db.select().from(tour_receipts).where(and(eq(tour_receipts.org_id,org),
    or(eq(tour_receipts.document_id,documentID),eq(tour_receipts.sha256,metadata.original_checksum))));
  if (rows.length !== 1 || rows[0].project_id !== project) throw new HttpError('This receipt is already assigned to another tour or needs review before linking.',409);
  const row = rows[0];
  if (!row.document_id) throw new HttpError('This receipt already has an upload in progress. Check that scan before linking it.',409);
  // The existing unique document/hash keys make retries and concurrent selections idempotent.
  // Linking evidence never uploads bytes or writes a money entry.
  return getTourReceipt(org,project,row.id);
}
export async function uploadTourReceipt(org: string, project: string, id: string, bytes: Uint8Array) {
  z.uuid().parse(id); await tour(org, project); paperlessConfig(org);
  if (bytes.length < 10 || bytes.length > 10 * 1024 * 1024 || Buffer.from(bytes.subarray(0,5)).toString() !== '%PDF-') throw new HttpError('Choose a PDF receipt under 10 MB', 415);
  const hash = createHash('sha256').update(bytes).digest('hex');
  await db.insert(tour_receipts).values({id, org_id: org, project_id: project, sha256: hash}).onConflictDoNothing();
  const [row] = await db.select().from(tour_receipts).where(and(eq(tour_receipts.org_id, org), eq(tour_receipts.sha256, hash)));
  if (!row || row.project_id !== project) throw new HttpError('This receipt is already assigned to another tour. Review it before adding a cost.', 409);
  if (row.id !== id || row.task_id || row.document_id) return getTourReceipt(org,project,row.id);
  // Claim once; retries inspect the persistent task rather than uploading the same receipt again.
  const claimed = await db.update(tour_receipts).set({status:'processing'}).where(and(eq(tour_receipts.id,row.id),eq(tour_receipts.org_id,org),eq(tour_receipts.status,'uploading'))).returning();
  if (!claimed.length) return getTourReceipt(org,project,row.id);
  try {
    // Reconcile an archive upload whose database transaction or HTTP acknowledgement was lost.
    const existing = await archiveTask(org, row.id, null);
    if (existing) {
      await db.update(tour_receipts).set({task_id:existing.task_id,error:null}).where(and(eq(tour_receipts.org_id,org),eq(tour_receipts.id,row.id)));
      return getTourReceipt(org,project,row.id);
    }
    const form = new FormData(); form.set('document', new Blob([Buffer.from(bytes)], {type:'application/pdf'}), `labelsuite-${id}.pdf`);
    form.set('title', `Tour receipt ${id}`);
    const task = z.uuid().parse(await paperless<unknown>(org, '/api/documents/post_document/', {method:'POST',body:form}));
    await db.update(tour_receipts).set({task_id:task,error:null}).where(and(eq(tour_receipts.org_id,org),eq(tour_receipts.id,row.id)));
  } catch {
    // The archive may have accepted the upload before the response was lost; status lookup reconciles by filename.
    await db.update(tour_receipts).set({error:'Upload confirmation pending. Refresh to check the receipt archive.'}).where(and(eq(tour_receipts.org_id,org),eq(tour_receipts.id,row.id)));
  }
  return getTourReceipt(org,project,row.id);
}
const archiveTaskSchema = z.object({task_id:z.string(),task_file_name:z.string().nullable().optional(),status:z.string(),related_document:z.union([z.string(),z.number()]).nullable().optional()});
async function archiveTask(org: string, id: string, taskID: string | null) {
  const query = taskID ? `task_id=${encodeURIComponent(taskID)}` : `name=${encodeURIComponent(`labelsuite-${id}.pdf`)}`;
  const tasks = z.union([z.array(archiveTaskSchema),z.object({results:z.array(archiveTaskSchema)})]).parse(await paperless<unknown>(org,`/api/tasks/?${query}&page_size=20`));
  return (Array.isArray(tasks) ? tasks : tasks.results).find(t => taskID ? t.task_id===taskID : t.task_file_name===`labelsuite-${id}.pdf`);
}

export async function getTourReceipt(org: string, project: string, id: string) {
  await tour(org,project);
  const [row] = await db.select().from(tour_receipts).where(and(eq(tour_receipts.org_id,org),eq(tour_receipts.project_id,project),eq(tour_receipts.id,id)));
  if (!row) throw new HttpError('Receipt not found',404);
  if (row.status === 'processing') {
    const task = await archiveTask(org, row.id, row.task_id);
    if (task && !row.task_id) await db.update(tour_receipts).set({task_id:task.task_id,error:null}).where(and(eq(tour_receipts.org_id,org),eq(tour_receipts.id,id),eq(tour_receipts.status,'processing')));
    if (task?.status === 'SUCCESS' && task.related_document) {
      const docID = z.coerce.number().int().positive().parse(task.related_document);
      const doc = z.object({content:z.string()}).parse(await paperless<unknown>(org,`/api/documents/${docID}/?fields=content`));
      await db.update(tour_receipts).set({task_id:task.task_id,document_id:docID,status:'review',content:String(doc.content).slice(0,60000),error:null}).where(and(eq(tour_receipts.org_id,org),eq(tour_receipts.id,id),eq(tour_receipts.status,'processing')));
      return getTourReceipt(org,project,id);
    } else if (!task && Date.now()-row.created_at.getTime()>120000) {
      await db.update(tour_receipts).set({status:'uploading',error:'The upload was not confirmed. Send the saved scan again.'}).where(and(eq(tour_receipts.org_id,org),eq(tour_receipts.id,id),eq(tour_receipts.status,'processing')));
      return getTourReceipt(org,project,id);
    } else if (task?.status === 'FAILURE') {
      await db.update(tour_receipts).set({status:'error',error:'The archive could not process this receipt, or already has a copy. Review it in Paperless before trying another scan.'}).where(and(eq(tour_receipts.org_id,org),eq(tour_receipts.id,id),eq(tour_receipts.status,'processing')));
      return getTourReceipt(org,project,id);
    }
  }
  const ledger = row.status==='review' ? await db.select().from(tour_money_entries).where(and(eq(tour_money_entries.org_id,org),eq(tour_money_entries.project_id,project),eq(tour_money_entries.voided,false))) : [];
  const [fresh] = await db.select().from(tour_receipts).where(and(eq(tour_receipts.org_id,org),eq(tour_receipts.id,id)));
  return {...view(fresh),matches:ledger.filter(e=>e.data.kind==='expense').map(e=>({id:e.id,name:String(e.data.note || e.data.source || 'Recorded expense').slice(0,240),amount:e.data.amount,currency:e.data.currency,date:e.data.date ?? null,person:e.data.person ?? null}))};
}
