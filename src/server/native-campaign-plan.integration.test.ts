import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const enabled = process.env.NATIVE_CAMPAIGN_PLAN_INTEGRATION === "1";
const suffix = randomUUID(), org = `campaign-plan-${suffix}`, foreignOrg = `campaign-other-${suffix}`;
const actor = randomUUID(), artist = randomUUID(), release = randomUUID(), otherArtist = randomUUID(), foreignArtist = randomUUID();
let sql: Sql;
let createCampaign: typeof import("./campaigns").createCampaign;
let getPlan: typeof import("./native-campaign-plan").getNativeCampaignPlan;
let updatePlan: typeof import("./native-campaign-plan").updateNativeCampaignPlan;
const base = { campaign_name: "Fixture launch", linked_artist_id: artist, linked_release_id: release, goal: "Plain goal", notes: "Plain notes", budget_planned: 12.5, status: "planning" };
describe.skipIf(!enabled)("native campaign creation and plan on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const target = process.env.DATABASE_URL!; const url = new URL(target);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/native_campaign_plan_fixture") throw new Error("Disposable campaign fixture only");
    sql = postgres(target);
    ({ createCampaign } = await import("./campaigns"));
    ({ getNativeCampaignPlan: getPlan, updateNativeCampaignPlan: updatePlan } = await import("./native-campaign-plan"));
    await sql`insert into label_suite.orgs (id,name,slug) values (${org},'Fixture',${org}), (${foreignOrg},'Other',${foreignOrg})`;
    await sql`insert into label_suite.user (id,name,email,"emailVerified") values (${actor},'Fixture',${`${actor}@example.test`},true)`;
    await sql`insert into label_suite.artists (id,org_id,name) values (${artist},${org},'Artist'), (${otherArtist},${org},'Other artist'), (${foreignArtist},${foreignOrg},'Foreign')`;
    await sql`insert into label_suite.releases (id,org_id,artist_id,title) values (${release},${org},${artist},'Release')`;
  });
  afterAll(async () => {
    if (!sql) return;
    await sql`delete from label_suite.audit_events where org_id in (${org},${foreignOrg})`;
    await sql`delete from label_suite.campaigns where org_id in (${org},${foreignOrg})`;
    await sql`delete from label_suite.releases where id = ${release}`;
    await sql`delete from label_suite.artists where id in (${artist},${otherArtist},${foreignArtist})`;
    await sql`delete from label_suite.user where id = ${actor}`;
    await sql`delete from label_suite.audit_logs where org_id in (${org},${foreignOrg})`;
    await sql`delete from label_suite.orgs where id in (${org},${foreignOrg})`;
    await sql.end();
  });
  it("acknowledges one concurrent creation and one audit; differing and changed identities conflict", async () => {
    const id = randomUUID(), input = { ...base, id };
    expect(await Promise.all([createCampaign(org,input,actor),createCampaign(org,input,actor)])).toEqual([{id,ok:true},{id,ok:true}]);
    expect(await createCampaign(org,input)).toEqual({id,ok:true});
    await expect(createCampaign(org,{...input,campaign_name:"Different web request"})).rejects.toMatchObject({status:409});
    expect(await getPlan(org,id)).toMatchObject({ id,revision:1,fields:{goal:"Plain goal",budget_planned:"12.5"},readonly_fields:[] });
    expect(await sql`select id from label_suite.audit_events where object_id=${id}`).toHaveLength(1);
    await expect(createCampaign(org,{...input,goal:"Changed"},actor)).rejects.toMatchObject({status:409});
    await updatePlan(org,id,{expected_revision:1,owner:"New owner"},actor);
    await expect(createCampaign(org,input,actor)).rejects.toMatchObject({status:409});
  });
  it("replays budget values using their stored PostgreSQL real representation", async () => {
    const id = randomUUID(), input = { ...base, id, budget_planned: 1000000.01, budget_actual: 0.1 };
    expect(await createCampaign(org,input,actor)).toEqual({id,ok:true});
    expect(await createCampaign(org,input,actor)).toEqual({id,ok:true});
    expect(await sql`select id from label_suite.audit_events where object_id=${id}`).toHaveLength(1);
    await expect(createCampaign(org,{...input,budget_actual:0.2},actor)).rejects.toMatchObject({status:409});
  });
  it("rejects foreign collisions and nonmatching catalog associations", async () => {
    const id = randomUUID();
    await sql`insert into label_suite.campaigns (id,org_id,campaign_name) values (${id},${foreignOrg},'Foreign')`;
    await expect(createCampaign(org,{...base,id},actor)).rejects.toMatchObject({status:409});
    await expect(createCampaign(org,{...base,linked_artist_id:otherArtist},actor)).rejects.toMatchObject({status:400});
    await expect(createCampaign(org,{...base,linked_artist_id:foreignArtist},actor)).rejects.toMatchObject({status:404});
    await expect(getPlan(org,id)).rejects.toMatchObject({status:404});
  });
  it("preserves rich documents, applies plain patches with revisions and permits existing archived-plan policy", async () => {
    const id = randomUUID();
    const rich = {type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"Rich",marks:[{type:"bold"}]}]}]};
    await createCampaign(org,{...base,id,goal_document:rich as never},actor);
    await sql`update label_suite.campaigns set brief_document=${sql.json(rich)},brief='Rich',status='archived' where id=${id}`;
    expect(await getPlan(org,id)).toMatchObject({readonly_fields:["goal","brief"]});
    await expect(updatePlan(org,id,{expected_revision:1,goal:"Flatten"},actor)).rejects.toMatchObject({status:409});
    await expect(updatePlan(org,id,{expected_revision:1,brief:"Flatten"},actor)).rejects.toMatchObject({status:409});
    expect(await updatePlan(org,id,{expected_revision:1,owner:"Owner",notes:"Revised notes",budget_actual:4.5,performance_rating:4},actor)).toEqual({id,ok:true,revision:2});
    const [row] = await sql`select goal_document,brief_document,notes,status from label_suite.campaigns where id=${id}`;
    expect(row).toMatchObject({goal_document:rich,brief_document:rich,notes:"Revised notes",status:"archived"});
    await expect(updatePlan(org,id,{expected_revision:1,owner:"Stale"},actor)).rejects.toMatchObject({status:409});
  });
  it("rolls creation and plan writes back when actor audit fails", async () => {
    const id = randomUUID();
    await expect(createCampaign(org,{...base,id},"missing-actor")).rejects.toThrow();
    expect(await sql`select id from label_suite.campaigns where id=${id}`).toHaveLength(0);
    await createCampaign(org,{...base,id},actor);
    await expect(updatePlan(org,id,{expected_revision:1,owner:"Uncommitted"},"missing-actor")).rejects.toThrow();
    expect(await getPlan(org,id)).toMatchObject({revision:1,fields:{owner:""}});
  });
});
