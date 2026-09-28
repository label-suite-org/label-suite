import { beforeEach, expect, it, vi } from "vitest";
const service=vi.hoisted(()=>({getNativeRoyaltyPage:vi.fn(),getNativeRoyaltyStatement:vi.fn()}));
vi.mock("../../../../server/native-royalties",()=>service);
vi.mock("../../../../server/tenant",()=>({requireOrgId:(locals:{orgId?:string})=>{if(!locals.orgId)throw new Error("No workspace");return locals.orgId;}}));
import { GET as list } from "./index";
import { GET as detail } from "./[id]/index";
beforeEach(()=>{vi.clearAllMocks();service.getNativeRoyaltyPage.mockResolvedValue({rows:[],next_offset:null});service.getNativeRoyaltyStatement.mockResolvedValue({statement:{id:"statement-a"}});});
it("scopes statement reads to the active workspace and refuses the payee role",async()=>{
  const context={locals:{orgId:"org-a",membershipRole:"member"},url:new URL("https://suite.test/api/royalties/statements?orgId=foreign&offset=50"),params:{id:"statement-a"}};
  expect((await list(context as never)).status).toBe(200);
  expect(service.getNativeRoyaltyPage).toHaveBeenCalledWith("org-a",{section:"statements",offset:"50"});
  expect((await detail(context as never)).status).toBe(200);
  expect(service.getNativeRoyaltyStatement).toHaveBeenCalledWith("org-a","statement-a","50");
  vi.clearAllMocks();context.locals.membershipRole="payee";
  expect((await list(context as never)).status).toBe(403);
  expect((await detail(context as never)).status).toBe(403);
  expect(service.getNativeRoyaltyPage).not.toHaveBeenCalled();
  expect(service.getNativeRoyaltyStatement).not.toHaveBeenCalled();
});
