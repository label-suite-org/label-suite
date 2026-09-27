import { beforeEach, describe, expect, it, vi } from "vitest";
const actor = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const session = vi.hoisted(() => ({ bearerToken: vi.fn(), getNativeSession: vi.fn() }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_: unknown, fn: () => Promise<unknown>) => fn()) }));
const service = vi.hoisted(() => ({ listNativeDataQuality: vi.fn(), getNativeDataQuality: vi.fn(), nativeDataQualityOptions: vi.fn(), actOnNativeDataQuality: vi.fn() }));
vi.mock("../../../lib/native-workspace", () => actor);
vi.mock("../../../lib/native-session", () => session);
vi.mock("../../../lib/db", () => database);
vi.mock("../../../server/native-data-quality", async original => ({ ...await original<typeof import("../../../server/native-data-quality")>(), ...service }));
import { GET as list } from "./data-quality";
import { GET as options } from "./data-quality/options";
import { GET as detail, PATCH as act } from "./data-quality/[id]";
const context = (method = "GET", body?: unknown) => ({params:{id:"issue-a"},request:new Request("https://suite.test/api/native/data-quality/issue-a?workspaceId=forged&q=match&kind=work",{method,headers:{"content-type":"application/json"},...(body ? {body:JSON.stringify(body)} : {})})}) as never;
describe("native Data quality routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actor.resolveNativeActor.mockResolvedValue({userId:"user-a",workspace:{org:{id:"org-a"},role:"owner"}});
    session.bearerToken.mockReturnValue(null);session.getNativeSession.mockResolvedValue(null);
    service.listNativeDataQuality.mockResolvedValue({items:[],next_cursor:null});
    service.getNativeDataQuality.mockResolvedValue({id:"issue-a"});service.actOnNativeDataQuality.mockResolvedValue({id:"issue-a",status:"resolved"});
    service.nativeDataQualityOptions.mockResolvedValue({items:[],next_cursor:null});
  });
  it("passes the resolved user/workspace and exact route ID with private no-store responses", async () => {
    for (const handler of [list,detail,options]) {
      const response=await handler(context()); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(service.listNativeDataQuality).toHaveBeenCalledWith('org-a','user-a',{q:'match',cursor:null,status:null,priority:null,source:null,object_type:null});
    expect(service.getNativeDataQuality).toHaveBeenCalledWith('org-a','user-a','issue-a',null);
    expect(service.nativeDataQualityOptions).toHaveBeenCalledWith('org-a','user-a',{kind:'work',q:'match',cursor:null});
    expect((await act(context('PATCH',{action:'resolve',expected_revision:'r1'}))).status).toBe(200);
    expect(service.actOnNativeDataQuality).toHaveBeenCalledWith('org-a','user-a','issue-a',{action:'resolve',expected_revision:'r1'});
  });
  it("previews the selected connection and requires the reviewed mapping snapshot", async () => {
    const request = new Request("https://suite.test/api/native/data-quality/issue-a?connection_id=connection-b");
    expect((await detail({params:{id:"issue-a"},request} as never)).status).toBe(200);
    expect(service.getNativeDataQuality).toHaveBeenCalledWith("org-a","user-a","issue-a","connection-b");
    for (const expected_link of [null,{id:"mapping-a",revision:"mapping-r1"}]) {
      const body = {action:"link",expected_revision:"issue-r1",connection_id:"connection-b",object_type:"work",object_id:"work-a",expected_link};
      expect((await act(context("PATCH",body))).status).toBe(200);
      expect(service.actOnNativeDataQuality).toHaveBeenLastCalledWith("org-a","user-a","issue-a",body);
    }
  });
  it("rejects missing revisions, arbitrary writes and injected workspace identity", async () => {
    for(const body of [{action:'resolve'},{action:'resolve',expected_revision:'r1',org_id:'foreign'},{action:'link',expected_revision:'r1',connection_id:'a',object_type:'user',object_id:'b'},{action:'link',expected_revision:'r1',connection_id:'a',object_type:'work',object_id:'b'},{action:'pay',expected_revision:'r1'}]) expect((await act(context('PATCH',body))).status).toBe(400);
    expect(service.actOnNativeDataQuality).not.toHaveBeenCalled();
  });
  it("distinguishes unauthenticated and removed workspace access", async () => {
    actor.resolveNativeActor.mockResolvedValue(null);
    for(const handler of [list,detail,options,act]) expect((await handler(context())).status).toBe(401);
    session.bearerToken.mockReturnValue('fixture'); session.getNativeSession.mockResolvedValue({user:{id:'user-a'}});
    for(const handler of [list,detail,options,act]) {
      const response=await handler(context()); expect(response.status).toBe(403); expect(await response.json()).toMatchObject({code:'workspace_access_removed'});
    }
    expect(database.runWithDatabaseContext).not.toHaveBeenCalled();
  });
});
