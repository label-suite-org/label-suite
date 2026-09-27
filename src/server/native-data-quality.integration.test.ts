import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
const enabled = process.env.NATIVE_DATA_QUALITY_INTEGRATION === "1";
const org = `native-dq-${randomUUID()}`, foreign = `${org}-foreign`, user = `${org}-user`;
let sql: Sql;
let service: typeof import("./native-data-quality");
const scope = { q: null, cursor: null, status: null, priority: null, source: null, object_type: null };
async function issue(name: string) {
  const id = `${org}-${name}`;
  await sql`insert into label_suite.data_quality_issues(id,org_id,connection_id,source,issue_type,external_object_type,external_object_id,details) values (${id},${org},${org},'fixture','unmatched_track','track',${name},${sql.json({ token: 'secret-payload-canary' })})`;
  return service.getNativeDataQuality(org, user, id);
}
describe.skipIf(!enabled)("native data-quality contract", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_fixture")) throw Error("Disposable local fixture required");
    sql = postgres(url.toString()); service = await import("./native-data-quality");
    await sql`insert into label_suite.user(id,name,email,"emailVerified") values (${user},'Fixture',${`${user}@example.test`},true)`;
    for (const id of [org, foreign]) {
      await sql`insert into label_suite.orgs(id,name,slug) values (${id},'Fixture',${id})`;
      await sql`insert into label_suite.integration_providers(id,org_id,key,name,category) values (${id},${id},'fixture','Fixture provider','test')`;
      await sql`insert into label_suite.integration_connections(id,org_id,provider_id,label,auth_ref,settings) values (${id},${id},${id},'Primary feed','secret-auth-canary',${sql.json({ token:'secret-setting-canary' })})`;
      await sql`insert into label_suite.works(id,org_id,title) values (${id},${id},'Target Work')`;
    }
    await sql`insert into label_suite.org_memberships(id,org_id,user_id,role) values (${user},${org},${user},'owner')`;
  });
  afterAll(async () => {
    if (!sql) return;
    for (const table of ['audit_events','external_object_links','data_quality_issues','ops_tasks','integration_connections','integration_providers','works','org_memberships','audit_logs'])
      await sql`delete from ${sql(`label_suite.${table}`)} where org_id in (${org},${foreign})`;
    await sql`delete from label_suite.orgs where id in (${org},${foreign})`;
    await sql`delete from label_suite.user where id=${user}`;
    await sql.end();
  });
  it("pages and filters within tenant without provider credentials or raw payloads", async () => {
    for (let i = 0; i < 51; i++) await sql`insert into label_suite.data_quality_issues(id,org_id,source,issue_type,details) values (${`${org}-page-${String(i).padStart(2,'0')}`},${org},'page %','unmatched',${sql.json({ token:'secret-payload-canary' })})`;
    await sql`insert into label_suite.data_quality_issues(id,org_id,source,issue_type) values (${`${foreign}-issue`},${foreign},'page %','private')`;
    const first = await service.listNativeDataQuality(org,user,{...scope,q:'page %',status:'open'});
    expect(first.items).toHaveLength(50); expect(first.next_cursor).toBeTruthy();
    expect((await service.listNativeDataQuality(org,user,{...scope,q:'page %',cursor:first.next_cursor})).items).toHaveLength(1);
    expect((await service.listNativeDataQuality(org,user,{...scope,q:'page _'})).items).toEqual([]);
    const options = await service.nativeDataQualityOptions(org,user,{kind:'connection',q:null,cursor:null});
    expect(options.items).toEqual([{id:org,label:'Fixture provider · Primary feed'}]);
    await sql`insert into label_suite.integration_connections(id,org_id,provider_id,label) values (${org+'-secondary'},${org},${org},'Archive feed')`;
    const choices = await service.nativeDataQualityOptions(org,user,{kind:'connection',q:null,cursor:null});
    expect(choices.items.map(item=>item.label)).toEqual(['Fixture provider · Primary feed','Fixture provider · Archive feed']);
    expect((await service.nativeDataQualityOptions(org,user,{kind:'connection',q:'Archive',cursor:null})).items.map(item=>item.id)).toEqual([org+'-secondary']);
    expect(JSON.stringify([first,options])).not.toContain('secret-');
    await expect(service.getNativeDataQuality(org,user,`${foreign}-issue`)).rejects.toMatchObject({status:404});
  });
  it("resolves and ignores with exact revision and atomic audit", async () => {
    const before = await issue('status');
    const results = await Promise.allSettled(['resolve','ignore'].map(action => service.actOnNativeDataQuality(org,user,before.id,{action,expected_revision:before.revision})));
    expect(results.filter(item=>item.status==='fulfilled')).toHaveLength(1);
    expect(results.find(item=>item.status==='rejected')).toMatchObject({reason:{status:409}});
    const [audit] = await sql`select "before","after" from label_suite.audit_events where org_id=${org} and object_id=${before.id}`;
    expect(audit.before).toMatchObject({status:'open'}); expect(['resolved','ignored']).toContain(audit.after.status);
  });
  it("creates one task without copying raw provider payloads", async () => {
    const before = await issue('task');
    const after = await service.actOnNativeDataQuality(org,user,before.id,{action:'create_task',expected_revision:before.revision});
    expect(after.status).toBe('triaged'); expect(after.task_id).toBeTruthy();
    const [task] = await sql`select notes from label_suite.ops_tasks where id=${after.task_id!} and org_id=${org}`;
    expect(task.notes).toContain(before.id); expect(task.notes).not.toContain('secret-payload');
    const [audit] = await sql`select "after" from label_suite.audit_events where org_id=${org} and object_id=${before.id}`;
    expect(audit.after.task_id).toBe(after.task_id);
    await expect(service.actOnNativeDataQuality(org,user,before.id,{action:'create_task',expected_revision:after.revision})).rejects.toMatchObject({status:409});
  });
  it("links exact-tenant records and rejects foreign or conflicting identities", async () => {
    const before = await issue('link');
    const input = {action:'link',expected_revision:before.revision,connection_id:org,object_type:'work',object_id:org,expected_link:null};
    await expect(service.actOnNativeDataQuality(org,user,before.id,{...input,connection_id:foreign})).rejects.toMatchObject({status:404});
    await expect(service.actOnNativeDataQuality(org,user,before.id,{...input,object_id:foreign})).rejects.toMatchObject({status:404});
    const after = await service.actOnNativeDataQuality(org,user,before.id,input);
    expect(after).toMatchObject({status:'resolved',object_type:'work',object_id:org});
    await sql`update label_suite.external_object_links set status='ignored' where org_id=${org} and external_object_id='link'`;
    await expect(service.actOnNativeDataQuality(org,user,before.id,{...input,expected_revision:after.revision})).rejects.toMatchObject({status:409});
  });
  it("previews and replaces only the exact reviewed mapping, preserving private metadata", async () => {
    const before = await issue('remap');
    await sql`insert into label_suite.works(id,org_id,title) values (${org+'-new-target'},${org},'New target')`;
    const initial = {action:'link',expected_revision:before.revision,connection_id:org,object_type:'work',object_id:org,expected_link:null};
    const linked = await service.actOnNativeDataQuality(org,user,before.id,initial);
    await sql`update label_suite.external_object_links set status='ignored',metadata=${sql.json({token:'secret-link-canary'})} where org_id=${org} and external_object_id='remap'`;
    const preview = await service.getNativeDataQuality(org,user,before.id,org);
    expect(preview.mapping).toMatchObject({object_type:'work',object_id:org,target_label:'Target Work',status:'ignored'});
    expect(JSON.stringify(preview)).not.toContain('secret-');
    let expected_link = {id:preview.mapping!.id,revision:preview.mapping!.revision};
    const replacement = {...initial,expected_revision:linked.revision,object_id:org+'-new-target',expected_link};
    await sql`update label_suite.external_object_links set status='needs_review' where id=${expected_link.id}`;
    await expect(service.actOnNativeDataQuality(org,user,before.id,replacement)).rejects.toMatchObject({status:409});
    const reviewed = await service.getNativeDataQuality(org,user,before.id,org);
    expected_link = {id:reviewed.mapping!.id,revision:reviewed.mapping!.revision};
    replacement.expected_link = expected_link;
    await expect(service.actOnNativeDataQuality(org,user,before.id,{...replacement,expected_link:{...expected_link,revision:'stale'}})).rejects.toMatchObject({status:409});
    const changed = await service.actOnNativeDataQuality(org,user,before.id,replacement);
    expect(changed).toMatchObject({object_id:org+'-new-target',connection_id:org});
    const fresh = await service.getNativeDataQuality(org,user,before.id,org);
    expect(fresh.mapping).toMatchObject({id:expected_link.id,object_id:org+'-new-target',target_label:'New target',status:'active'});
    expect(fresh.mapping!.revision).not.toBe(expected_link.revision);
    const [saved] = await sql`select metadata from label_suite.external_object_links where id=${expected_link.id}`;
    expect(saved.metadata.token).toBe('secret-link-canary');
    const [audit] = await sql`select "before","after" from label_suite.audit_events where org_id=${org} and object_id=${before.id} and "after"->'mapping'->>'object_id'=${org+'-new-target'}`;
    expect(audit.before.mapping.object_id).toBe(org);expect(audit.after.mapping.object_id).toBe(org+'-new-target');
    await expect(service.actOnNativeDataQuality(org,user,before.id,{...replacement,expected_revision:changed.revision})).rejects.toMatchObject({status:409});
    await expect(service.getNativeDataQuality(org,user,before.id,foreign)).rejects.toMatchObject({status:404});
  });
  it("rejects a new mapping that appeared after the preview and tracks a changed connection", async () => {
    const before = await issue('appeared');
    const preview = await service.getNativeDataQuality(org,user,before.id,org+'-secondary');
    expect(preview.mapping).toBeNull();
    const input = {action:'link',expected_revision:before.revision,connection_id:org+'-secondary',object_type:'work',object_id:org,expected_link:null};
    await sql`insert into label_suite.external_object_links(id,org_id,connection_id,provider_key,external_object_type,external_object_id,label_suite_object_type,label_suite_object_id) values (${org+'-appeared-link'},${org},${org+'-secondary'},'fixture','track','appeared','work',${org})`;
    await expect(service.actOnNativeDataQuality(org,user,before.id,input)).rejects.toMatchObject({status:409});
    const current = await service.getNativeDataQuality(org,user,before.id,org+'-secondary');
    await service.actOnNativeDataQuality(org,user,before.id,{...input,expected_link:{id:current.mapping!.id,revision:current.mapping!.revision}});
    expect((await service.getNativeDataQuality(org,user,before.id)).connection?.id).toBe(org+'-secondary');
  });
  it("rolls back task creation, mapping replacement and issue state if audit persistence fails", async () => {
    const before = await issue('rollback'), fn = `dq_audit_${randomUUID().replaceAll('-','')}`;
    const linkedIssue = await issue('rollback-mapping');
    await service.actOnNativeDataQuality(org,user,linkedIssue.id,{action:'link',expected_revision:linkedIssue.revision,connection_id:org,object_type:'work',object_id:org,expected_link:null});
    const preview = await service.getNativeDataQuality(org,user,linkedIssue.id);
    const [count] = await sql`select count(*)::int as n from label_suite.ops_tasks where org_id=${org}`;
    await sql.unsafe(`create function label_suite.${fn}() returns trigger language plpgsql as $$ begin raise exception 'fixture audit unavailable'; end $$`);
    await sql.unsafe(`create trigger ${fn} before insert on label_suite.audit_events for each row when (new.org_id = '${org}') execute function label_suite.${fn}()`);
    try {
      await expect(service.actOnNativeDataQuality(org,user,before.id,{action:'create_task',expected_revision:before.revision})).rejects.toThrow();
      expect(await service.getNativeDataQuality(org,user,before.id)).toMatchObject({status:'open',revision:before.revision,task_id:null});
      expect((await sql`select count(*)::int as n from label_suite.ops_tasks where org_id=${org}`)[0].n).toBe(count.n);
      await expect(service.actOnNativeDataQuality(org,user,linkedIssue.id,{action:'link',expected_revision:preview.revision,connection_id:org,object_type:'work',object_id:org+'-new-target',expected_link:{id:preview.mapping!.id,revision:preview.mapping!.revision}})).rejects.toThrow();
      expect(await service.getNativeDataQuality(org,user,linkedIssue.id)).toEqual(preview);
    } finally {
      await sql.unsafe(`drop trigger ${fn} on label_suite.audit_events`); await sql.unsafe(`drop function label_suite.${fn}()`);
    }
  });
  it("keeps a validated link target alive until the transaction finishes", async () => {
    const { runWithDatabaseContext } = await import("../lib/db");
    const { assertDataQualityTarget } = await import("./integrations");
    await runWithDatabaseContext({orgId:org,userId:user}, async () => {
      await assertDataQualityTarget(org,'work',org);
      await expect(sql.begin(async tx => {
        await tx`set local lock_timeout='100ms'`;
        await tx`delete from label_suite.works where id=${org} and org_id=${org}`;
      })).rejects.toMatchObject({code:'55P03'});
    });
  });
  it("rechecks current membership and denies read-only roles", async () => {
    for (const role of ['member','payee']) {
      await sql`update label_suite.org_memberships set role=${role} where id=${user}`;
      await expect(service.listNativeDataQuality(org,user,scope)).rejects.toMatchObject({status:403});
      await expect(service.actOnNativeDataQuality(org,user,`${org}-status`,{action:'ignore',expected_revision:'old'})).rejects.toMatchObject({status:403});
    }
    await sql`delete from label_suite.org_memberships where id=${user}`;
    await expect(service.listNativeDataQuality(org,user,scope)).rejects.toMatchObject({status:403,code:'workspace_access_removed'});
  });
});
