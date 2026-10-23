import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({actor:vi.fn(),token:vi.fn(),session:vi.fn(),upload:vi.fn(),list:vi.fn(),get:vi.fn(),scope:vi.fn(async (_:unknown,op:()=>Promise<unknown>)=>op())}));
vi.mock('../../../../../../lib/native-workspace',()=>({resolveNativeActor:m.actor}));
vi.mock('../../../../../../lib/native-session',()=>({bearerToken:m.token,getNativeSession:m.session}));
vi.mock('../../../../../../lib/db',()=>({runWithDatabaseContext:m.scope}));
vi.mock('../../../../../../server/tour-receipts',()=>({uploadTourReceipt:m.upload,listTourReceipts:m.list,getTourReceipt:m.get}));
import {GET,PUT} from './receipts';
const req=(method='GET',body?:string)=>({params:{id:'tour'},request:new Request('https://suite.test/api/native/projects/tour/tour/receipts?receipt_id=receipt',{method,body})}) as never;
beforeEach(()=>{vi.clearAllMocks();m.actor.mockResolvedValue({userId:'user',workspace:{role:'operator',org:{id:'org'}}});m.get.mockResolvedValue({id:'receipt'});m.upload.mockResolvedValue({id:'receipt'});});
it('scopes reads and bounded uploads to the authenticated workspace',async()=>{
 expect((await GET(req())).status).toBe(200);expect(m.get).toHaveBeenCalledWith('org','tour','receipt');
 expect((await PUT(req('PUT','%PDF-fixture'))).status).toBe(200);
 expect(m.upload).toHaveBeenCalledWith('org','tour','receipt',expect.any(Uint8Array));
 expect(m.scope).toHaveBeenCalledWith({orgId:'org',userId:'user'},expect.any(Function));
});
it('rejects missing access and oversized bodies before forwarding a scan',async()=>{
 m.actor.mockResolvedValue({userId:'user',workspace:{role:'member',org:{id:'org'}}});
 expect((await PUT(req('PUT','%PDF-fixture'))).status).toBe(403);expect(m.upload).not.toHaveBeenCalled();
 m.actor.mockResolvedValue({userId:'user',workspace:{role:'operator',org:{id:'org'}}});
 expect((await PUT(req('PUT','x'.repeat(10*1024*1024+1)))).status).toBe(413);expect(m.upload).not.toHaveBeenCalled();
 m.actor.mockResolvedValue(null);m.token.mockReturnValue('fixture');m.session.mockResolvedValue({userId:'user'});
 expect(await (await GET(req())).json()).toMatchObject({code:'workspace_access_removed'});
});
