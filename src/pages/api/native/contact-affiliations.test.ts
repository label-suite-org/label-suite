import { beforeEach, expect, it, vi } from "vitest";
const actor=vi.hoisted(()=>({resolveNativeActor:vi.fn()}));
const context=vi.hoisted(()=>({db:{},runWithDatabaseContext:vi.fn(async(_:unknown,fn:()=>unknown)=>fn())}));
const service=vi.hoisted(()=>({createContactOrganization:vi.fn(),listNativeAffiliations:vi.fn(),mutateNativeAffiliation:vi.fn()}));
vi.mock("../../../lib/db",()=>context);
vi.mock("../../../lib/native-workspace",()=>actor);
vi.mock("../../../lib/native-session",()=>({bearerToken:()=>null,getNativeSession:vi.fn()}));
vi.mock("../../../server/contacts",async original=>({...await original<typeof import("../../../server/contacts")>(),createContactOrganization:service.createContactOrganization}));
vi.mock("../../../server/native-contact-affiliations",async original=>({...await original<typeof import("../../../server/native-contact-affiliations")>(),listNativeAffiliations:service.listNativeAffiliations,mutateNativeAffiliation:service.mutateNativeAffiliation}));
import {GET,POST,PATCH,DELETE} from "./contacts/[id]/affiliations";
const id="c1d6ba63-a38e-4efa-8d43-df657fd7c77b", revision="2026-10-26T01:00:00.000001Z";
const req=(method:string,body?:unknown)=>({params:{id:"person"},request:new Request("https://fixture.test/api/native/contacts/person/affiliations?id="+id,{method,headers:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)})}) as never;
beforeEach(()=>{vi.clearAllMocks();actor.resolveNativeActor.mockResolvedValue({userId:"actor",workspace:{org:{id:"org"},role:"operator"}});service.createContactOrganization.mockResolvedValue({id,ok:true});service.mutateNativeAffiliation.mockResolvedValue({id,ok:true});service.listNativeAffiliations.mockResolvedValue({items:[],next_cursor:null});});
it("binds person, actor and workspace server-side for strict link operations and exact lookup",async()=>{
 expect((await POST(req("POST",{id,organization_id:"org-record",title:"Manager"}))).status).toBe(201);
 expect(service.createContactOrganization).toHaveBeenCalledWith("org",{id,contact_id:"person",organization_id:"org-record",title:"Manager"},"actor");
 expect((await PATCH(req("PATCH",{id,expected_revision:revision,title:"Agent"}))).status).toBe(200);
 expect(service.mutateNativeAffiliation).toHaveBeenCalledWith("org","person",{id,expected_revision:revision,title:"Agent"},"actor",false);
 expect((await DELETE(req("DELETE",{id,expected_revision:revision}))).status).toBe(200);
 expect(service.mutateNativeAffiliation).toHaveBeenLastCalledWith("org","person",{id,expected_revision:revision},"actor",true);
 expect((await GET(req("GET"))).status).toBe(200);
 expect(service.listNativeAffiliations).toHaveBeenCalledWith("org","person",{id,cursor:null});
 expect(context.runWithDatabaseContext).toHaveBeenCalledWith({userId:"actor",orgId:"org"},expect.any(Function));
});
it.each([{id,organization_id:"org",contact_id:"other"},{id:"bad",organization_id:"org"},{id,organization_id:"org",source:"gmail"}])("rejects invalid creation shape",async body=>{expect((await POST(req("POST",body))).status).toBe(400);expect(service.createContactOrganization).not.toHaveBeenCalled();});
it("rejects missing revisions, unknown fields and identity retargeting",async()=>{
 for(const body of [{id,title:"No revision"},{id,expected_revision:revision},{id,expected_revision:revision,organization_id:"other"}]) expect((await PATCH(req("PATCH",body))).status).toBe(400);
 expect((await DELETE(req("DELETE",{id,expected_revision:revision,contact_id:"other"}))).status).toBe(400);
 expect(service.mutateNativeAffiliation).not.toHaveBeenCalled();
});
it("denies member writes and payee reads before database work",async()=>{
 actor.resolveNativeActor.mockResolvedValue({userId:"member",workspace:{org:{id:"org"},role:"member"}});
 for(const method of [POST,PATCH,DELETE]) expect((await method(req("POST",{}))).status).toBe(403);
 expect(service.createContactOrganization).not.toHaveBeenCalled();expect(service.mutateNativeAffiliation).not.toHaveBeenCalled();
 actor.resolveNativeActor.mockResolvedValue({userId:"payee",workspace:{org:{id:"org"},role:"payee"}});
 expect((await GET(req("GET"))).status).toBe(403);expect(service.listNativeAffiliations).not.toHaveBeenCalled();
});
