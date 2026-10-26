import { beforeEach, expect, it, vi } from "vitest";
const actor = vi.hoisted(() => ({ resolveNativeActor: vi.fn(), assertNativeCampaignReadAccess: vi.fn(), resolveNativeWorkspace: vi.fn() }));
const context = vi.hoisted(() => ({ db: {}, runWithDatabaseContext: vi.fn(async (_: unknown, fn: () => unknown) => fn()) }));
const service = vi.hoisted(() => ({ createCampaign: vi.fn(), getNativeCampaignPlan: vi.fn(), updateNativeCampaignPlan: vi.fn() }));
vi.mock("../../../lib/db", () => context);
vi.mock("../../../lib/native-workspace", () => actor);
vi.mock("../../../lib/native-session", () => ({ bearerToken: () => null, getNativeSession: vi.fn() }));
vi.mock("../../../server/campaigns", async original => ({ ...await original<typeof import("../../../server/campaigns")>(), createCampaign: service.createCampaign }));
vi.mock("../../../server/native-campaign-plan", async original => ({ ...await original<typeof import("../../../server/native-campaign-plan")>(), getNativeCampaignPlan: service.getNativeCampaignPlan, updateNativeCampaignPlan: service.updateNativeCampaignPlan }));
import { POST } from "./campaigns";
import { GET, PATCH } from "./campaigns/[id]/plan";
const id = "a8d92068-9f65-472c-97a1-aa2c2d994cf5";
const input = { id, campaign_name: "Launch", linked_artist_id: "artist", linked_release_id: "release" };
const request = (method: string, body?: unknown) => ({ params: {id}, request: new Request("https://suite.test/api/native/campaigns?workspaceId=foreign", {method,headers:{"content-type":"application/json"},body:body === undefined ? undefined : JSON.stringify(body)}) }) as never;
beforeEach(() => {
 vi.clearAllMocks(); actor.resolveNativeActor.mockResolvedValue({userId:"actor",workspace:{org:{id:"org"},role:"operator"}});
 service.createCampaign.mockResolvedValue({id,ok:true}); service.updateNativeCampaignPlan.mockResolvedValue({id,ok:true,revision:3}); service.getNativeCampaignPlan.mockResolvedValue({id,revision:2});
});
it("uses canonical actor, context, stable creation and revisioned patch", async () => {
 expect((await POST(request("POST", input))).status).toBe(201);
 expect(service.createCampaign).toHaveBeenCalledWith("org",input,"actor");
 expect((await PATCH(request("PATCH",{expected_revision:2,owner:"Owner"}))).status).toBe(200);
 expect(service.updateNativeCampaignPlan).toHaveBeenCalledWith("org",id,{expected_revision:2,owner:"Owner"},"actor");
 expect(context.runWithDatabaseContext).toHaveBeenCalledWith({userId:"actor",orgId:"org"},expect.any(Function));
 expect((await GET(request("GET"))).status).toBe(200);
 expect(service.getNativeCampaignPlan).toHaveBeenCalledWith("org",id);
});
it.each([{...input,id:"invalid"},{...input,org_id:"other"},{...input,goal_document:{}},{...input,start_date:"2026-02-30"},{...input,budget_planned:-1},{...input,performance_rating:6}])("rejects invalid or unknown create fields", async body => {
 expect((await POST(request("POST",body))).status).toBe(400); expect(service.createCampaign).not.toHaveBeenCalled();
});
it.each([{owner:"Missing revision"},{expected_revision:2,notes_document:{}},{expected_revision:2},{expected_revision:2,linked_artist_id:"other"}])("rejects unsafe patch shapes", async body => {
 expect((await PATCH(request("PATCH",body))).status).toBe(400); expect(service.updateNativeCampaignPlan).not.toHaveBeenCalled();
});
it("denies read-only mutation and maps stale revision", async () => {
 actor.resolveNativeActor.mockResolvedValue({userId:"member",workspace:{org:{id:"org"},role:"member"}});
 expect((await POST(request("POST",input))).status).toBe(403);
 expect((await PATCH(request("PATCH",{expected_revision:2,owner:"Owner"}))).status).toBe(403);
 expect(service.createCampaign).not.toHaveBeenCalled(); expect(service.updateNativeCampaignPlan).not.toHaveBeenCalled();
 actor.resolveNativeActor.mockResolvedValue({userId:"actor",workspace:{org:{id:"org"},role:"operator"}});
 const {ConflictError} = await import("../../../server/errors"); service.updateNativeCampaignPlan.mockRejectedValueOnce(new ConflictError("Stale"));
 expect((await PATCH(request("PATCH",{expected_revision:2,owner:"Owner"}))).status).toBe(409);
});
