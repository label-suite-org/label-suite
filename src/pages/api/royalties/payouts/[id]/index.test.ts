import { expect, it, vi } from "vitest";
vi.mock("../../../../../lib/db",()=>({db:{}}));
const batch=vi.hoisted(()=>vi.fn().mockResolvedValue({batch:{status:"posted"},lines:[]}));
vi.mock("../../../../../server/royalty-payout-recording",async importOriginal=>({...await importOriginal<typeof import("../../../../../server/royalty-payout-recording")>(),getPayoutBatch:batch}));
vi.mock("../../../../../server/tenant",()=>({requireCapability:()=>"org-a"}));
import { GET } from "./index";
it("resolves encoded batch identifiers used by the browser",async()=>{
  const id="payout-batch:"+"a".repeat(24);
  const response=await GET({locals:{},params:{id:encodeURIComponent(id)}} as never);
  expect(response.status).toBe(200);
  expect(batch).toHaveBeenCalledWith("org-a",id);
});
