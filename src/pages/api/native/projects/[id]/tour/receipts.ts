import type { APIRoute } from 'astro';
import { z } from 'zod';
import { resolveNativeActor } from '../../../../../../lib/native-workspace';
import { bearerToken, getNativeSession } from '../../../../../../lib/native-session';
import { runWithDatabaseContext } from '../../../../../../lib/db';
import { json, handleApiError } from '../../../../../../server/api';
import { hasCapability } from '../../../../../../server/native-capabilities';
import { HttpError } from '../../../../../../server/errors';
import { boundedMultipartRequest } from '../../../../../../server/upload-security';
import { getTourReceipt, listTourReceipts, uploadTourReceipt, listPaperlessReceipts, linkPaperlessReceipt } from '../../../../../../server/tour-receipts';
export const prerender = false;
const handle: APIRoute = async ({request,params}) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token=bearerToken(request), session=token ? await getNativeSession(token) : null;
      return session ? json({error:'Workspace access removed',code:'workspace_access_removed'},403) : json({error:'Authentication required'},401);
    }
    if (!hasCapability(actor.workspace.role,'budgets.mutate')) throw new HttpError('Budget editing permission required',403);
    if (!params.id) throw new HttpError('Tour required',400);
    const paramsQuery=new URL(request.url).searchParams;
    const id=paramsQuery.get('receipt_id');
    const link=request.method==='POST' ? z.object({receipt_id:z.uuid(),document_id:z.number().int().positive()}).strict().parse(await (await boundedMultipartRequest(request,4096)).json()) : null;
    const archive=paramsQuery.get('archive');
    const page=archive==='paperless' ? z.coerce.number().int().min(1).max(10000).parse(paramsQuery.get('page') ?? 1) : 1;
    const query=z.string().max(200).parse(paramsQuery.get('query') ?? '');
    const bytes=request.method==='PUT' ? new Uint8Array(await (await boundedMultipartRequest(request,10*1024*1024)).arrayBuffer()) : null;
    const result=await runWithDatabaseContext({orgId:actor.workspace.org.id,userId:actor.userId},async ()=> {
      if (link) return linkPaperlessReceipt(actor.workspace.org.id,params.id!,link.receipt_id,link.document_id);
      if (request.method==='GET' && archive==='paperless') return listPaperlessReceipts(actor.workspace.org.id,params.id!,query,page);
      if (bytes) {if (!id) throw new HttpError('Receipt ID required',400);return uploadTourReceipt(actor.workspace.org.id,params.id!,id,bytes);}
      return id ? getTourReceipt(actor.workspace.org.id,params.id!,id) : listTourReceipts(actor.workspace.org.id,params.id!);
    });
    return json(result);
  } catch(error) {return handleApiError(error);}
};
export const GET=handle;
export const PUT=handle;

export const POST=handle;
