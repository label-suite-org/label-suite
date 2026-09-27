import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.NATIVE_GRANTS_INTEGRATION === "1";
const orgId = `native-grants-${randomUUID()}`, actorId = `${orgId}-actor`, applicationId = `${orgId}-application`;
let sql: Sql;

describe.skipIf(!enabled)("native Grant application revisions and audit", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("_fixture")) throw new Error("Disposable local fixture database required");
    // Module transformation belongs to setup; the test timeout measures database behavior.
    await import("./native-grants");
    sql = postgres(url.toString(), { max: 1 });
    await sql`insert into label_suite.user (id,name,email,"emailVerified") values (${actorId},'Grant actor',${`${actorId}@example.test`},true)`;
    await sql`insert into label_suite.orgs (id,name,slug) values (${orgId},'Grant fixture',${orgId})`;
    await sql`insert into label_suite.grant_applications (id,org_id,next_action,updated_at) values (${applicationId},${orgId},'Write draft','2026-09-01 12:00:00.123456')`;
  });
  afterAll(async () => {
    if (!sql) return;
    await sql`delete from label_suite.audit_events where org_id=${orgId}`;
    await sql`delete from label_suite.grant_application_requirements where org_id=${orgId}`;
    await sql`delete from label_suite.grant_application_documents where org_id=${orgId}`;
    for (const table of ["ops_tasks", "project_events", "media_assets"]) await sql.unsafe(`delete from label_suite.${table} where org_id=$1`, [orgId]);
    await sql`delete from label_suite.documents where org_id in (${orgId},${`${orgId}-other`})`;
    await sql`delete from label_suite.grant_application_events where org_id=${orgId}`;
    await sql`delete from label_suite.grant_applications where org_id=${orgId}`;
    await sql`delete from label_suite.funding_source_events where org_id=${orgId}`;
    await sql`delete from label_suite.funding_sources where org_id=${orgId}`;
    await sql`delete from label_suite.budget_projects where org_id=${orgId}`;
    await sql`delete from label_suite.grant_deadlines where org_id=${orgId}`;
    await sql`delete from label_suite.grant_requirements where org_id=${orgId}`;
    await sql`delete from label_suite.grants where org_id=${orgId}`;
    await sql`delete from label_suite.audit_logs where org_id in (${orgId},${`${orgId}-other`})`;
    await sql`delete from label_suite.org_memberships where org_id=${orgId}`;
    await sql`delete from label_suite.orgs where id in (${orgId},${`${orgId}-other`})`;
    await sql`delete from label_suite.user where id=${actorId}`;
    await sql.end();
  });
  it("preserves scope and exact revisions and rolls back an edit if its audit cannot commit", async () => {
    const { updateNativeGrantApplication } = await import('./native-grants');
    const input = { id: applicationId, expected_revision: '2026-09-01 12:00:00.123456', next_action: 'Review draft' };
    await expect(updateNativeGrantApplication('other-org', actorId, input)).rejects.toThrow('not found');
    await expect(updateNativeGrantApplication(orgId, actorId, { ...input, expected_revision: '2026-09-01 12:00:00.123' })).rejects.toThrow('changed');
    await expect(updateNativeGrantApplication(orgId, 'missing-actor', input)).rejects.toThrow();
    expect((await sql`select next_action from label_suite.grant_applications where id=${applicationId}`)[0].next_action).toBe('Write draft');
    await updateNativeGrantApplication(orgId, actorId, input);
    await expect(updateNativeGrantApplication(orgId, actorId, input)).rejects.toThrow('changed');
    expect((await sql`select next_action from label_suite.grant_applications where id=${applicationId}`)[0].next_action).toBe('Review draft');
    expect(await sql`select actor_user_id,event_type from label_suite.audit_events where org_id=${orgId}`).toEqual([{ actor_user_id: actorId, event_type: 'grant_application.updated' }]);
    expect(await sql`select event_type from label_suite.grant_application_events where org_id=${orgId}`).toEqual([{ event_type: 'note' }]);
  });
  it("allows one concurrent edit and advances an exact future revision without losing microseconds", async () => {
    const { updateNativeGrantApplication } = await import('./native-grants');
    await sql`update label_suite.grant_applications set updated_at='2099-09-01 12:00:00.123456' where id=${applicationId}`;
    const input = { id: applicationId, expected_revision: '2099-09-01 12:00:00.123456' };
    const results = await Promise.allSettled([
      updateNativeGrantApplication(orgId, actorId, { ...input, next_action: 'First reviewer' }),
      updateNativeGrantApplication(orgId, actorId, { ...input, next_action: 'Second reviewer' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await sql`select updated_at::text as revision from label_suite.grant_applications where id=${applicationId}`)[0].revision).toBe('2099-09-01 12:00:00.123457');
  });

  it("creates canonical applications and keeps award synchronization scoped to verified currencies", async () => {
    const { createNativeGrantApplication, updateNativeGrantApplication } = await import('./native-grants');
    const grantId = `${orgId}-grant`, projectId = `${orgId}-project`;
    await sql`insert into label_suite.grants (id,org_id,name,currency) values (${grantId},${orgId},'Test fund','DKK')`;
    await sql`insert into label_suite.budget_projects (id,org_id,name,currency) values (${projectId},${orgId},'Test project','DKK')`;
    const fields = { grant_id: grantId, project_id: projectId, amount_requested: 125.50, expected_currency: 'DKK' };
    await expect(createNativeGrantApplication(orgId, actorId, { ...fields, expected_currency: 'EUR' })).rejects.toThrow('currency');
    await expect(createNativeGrantApplication(orgId, actorId, { ...fields, amount_requested: 1.234 })).rejects.toThrow();
    const created = await createNativeGrantApplication(orgId, actorId, fields);
    const [{ revision }] = await sql`select updated_at::text as revision from label_suite.grant_applications where id=${created.id}`;
    const award = { id: created.id, expected_revision: revision, expected_currency: 'DKK', outcome: 'approved', amount_awarded: 100, reporting_due: '2026-12-04' };
    await sql`update label_suite.budget_projects set currency='EUR' where id=${projectId}`;
    await expect(updateNativeGrantApplication(orgId, actorId, award)).rejects.toThrow('currencies differ');
    expect(await sql`select id from label_suite.funding_sources where org_id=${orgId}`).toHaveLength(0);
    await sql`update label_suite.budget_projects set currency='DKK' where id=${projectId}`;
    await updateNativeGrantApplication(orgId, actorId, award);
    const [application] = await sql`select outcome,workflow_stage,funding_source_id,next_action_due from label_suite.grant_applications where id=${created.id}`;
    expect(application).toMatchObject({ outcome: 'approved', workflow_stage: 'reporting', funding_source_id: `grant-award-${created.id}` });
    expect(await sql`select amount_confirmed,status from label_suite.funding_sources where org_id=${orgId}`).toEqual([{ amount_confirmed: 100, status: 'confirmed' }]);
    expect(await sql`select event_type from label_suite.audit_events where object_id=${created.id} order by created_at`).toEqual([{ event_type: 'grant_application.created' }, { event_type: 'grant_application.updated' }]);
  });

  it("uses the project currency for an application without a Grant and synchronizes awards created natively", async () => {
    const { createNativeGrantApplication } = await import('./native-grants');
    const projectId = `${orgId}-euro-project`;
    await sql`insert into label_suite.budget_projects (id,org_id,name,currency) values (${projectId},${orgId},'Euro project','EUR')`;
    const created = await createNativeGrantApplication(orgId, actorId, { project_id: projectId, expected_currency: 'EUR', outcome: 'approved', amount_awarded: 80.25, reporting_due: '2026-12-04' });
    expect(await sql`select amount_confirmed,status from label_suite.funding_sources where project_id=${projectId}`).toEqual([{ amount_confirmed: 80.25, status: 'confirmed' }]);
    expect((await sql`select funding_source_id from label_suite.grant_applications where id=${created.id}`)[0].funding_source_id).toBe(`grant-award-${created.id}`);
  });

  it("guards requirement and evidence snapshots, preserves canonical Documents and rolls back failed attachment audits", async () => {
    const { getNativeGrantAttachments, mutateNativeGrantAttachments } = await import('./native-grants');
    const documentId = `${orgId}-doc`, foreignDocument = `${orgId}-foreign-doc`, foreignOrg = `${orgId}-other`;
    await sql`insert into label_suite.orgs (id,name,slug) values (${foreignOrg},'Other grants',${foreignOrg})`;
    await sql`insert into label_suite.documents (id,org_id,name) values (${documentId},${orgId},'Evidence'),(${foreignDocument},${foreignOrg},'Private evidence')`;
    const [{ revision }] = await sql`select updated_at::text as revision from label_suite.grant_applications where id=${applicationId}`;
    let context = await getNativeGrantAttachments(orgId, applicationId);
    const guard = { application_id: applicationId, expected_revision: revision };
    const link = { ...guard, expected_context_revision: context.revision, action: 'link_evidence', document_id: documentId, asset_role: 'other', required: true, readiness_status: 'ready' };
    await expect(mutateNativeGrantAttachments(orgId, actorId, { ...link, document_id: foreignDocument })).rejects.toThrow('not found');
    await expect(mutateNativeGrantAttachments(orgId, 'missing-actor', link)).rejects.toThrow();
    expect((await getNativeGrantAttachments(orgId, applicationId)).evidence).toHaveLength(0);
    await mutateNativeGrantAttachments(orgId, actorId, link);
    await expect(mutateNativeGrantAttachments(orgId, actorId, { ...guard, expected_context_revision: context.revision, action: 'replace_requirements', requirements: [] })).rejects.toThrow('changed');
    context = await getNativeGrantAttachments(orgId, applicationId);
    await mutateNativeGrantAttachments(orgId, actorId, { ...guard, expected_context_revision: context.revision, action: 'replace_requirements', requirements: [{ document_id: documentId, required: true, readiness_status: 'ready', notes: 'Reviewed' }] });
    context = await getNativeGrantAttachments(orgId, applicationId);
    expect(context.requirements[0]).toMatchObject({ document_id: documentId, readiness_status: 'ready' });
    await mutateNativeGrantAttachments(orgId, actorId, { ...guard, expected_context_revision: context.revision, action: 'unlink_evidence', link_id: context.evidence[0].id });
    expect((await getNativeGrantAttachments(orgId, applicationId)).evidence).toHaveLength(0);
    expect(await sql`select id from label_suite.documents where id=${documentId}`).toHaveLength(1);
    expect(await sql`select event_type from label_suite.audit_events where object_id=${applicationId} and event_type in ('grant_application.link_evidence','grant_application.replace_requirements','grant_application.unlink_evidence')`).toHaveLength(3);
    context = await getNativeGrantAttachments(orgId, applicationId);
    await mutateNativeGrantAttachments(orgId, actorId, { ...guard, expected_context_revision: context.revision, action: 'replace_requirements', requirements: [] });
    expect((await getNativeGrantAttachments(orgId, applicationId)).requirements).toHaveLength(0);
    expect(await sql`select id from label_suite.documents where id=${documentId}`).toHaveLength(1);
    // Restore a real assigned row for the following read-contract test.
    context = await getNativeGrantAttachments(orgId, applicationId);
    await mutateNativeGrantAttachments(orgId, actorId, { ...guard, expected_context_revision: context.revision, action: 'replace_requirements', requirements: [{ document_id: documentId, required: true, readiness_status: 'ready', notes: 'Reviewed' }] });
  });

  it("projects canonical status, scoped records and evidence without private file URLs", async () => {
    const { getNativeGrants } = await import('./native-grants-query');
    const documentId = `${orgId}-doc`, grantId = `${orgId}-grant`;
    await sql`update label_suite.grant_applications set grant_id=${grantId},workflow_stage='decision_pending',outcome='rejected',status='submitted' where id=${applicationId}`;
    await sql`update label_suite.grants set last_verified_at='2026-01-01',research_status='stale' where id=${grantId}`;
    await sql`update label_suite.documents set file_link='private/grant-evidence.pdf' where id=${documentId}`;
    await sql`insert into label_suite.grant_application_documents (id,org_id,application_id,document_id) values (${`${orgId}-read-link`},${orgId},${applicationId},${documentId})`;
    await sql`insert into label_suite.grant_requirements (id,org_id,grant_id,name,required) values (${`${orgId}-wire-requirement`},${orgId},${grantId},'Optional context',false)`;
    await sql`insert into label_suite.grant_deadlines (id,org_id,grant_id,deadline_date,label) values (${`${orgId}-wire-deadline`},${orgId},${grantId},'2028-01-01','Future call')`;
    const snapshot = await getNativeGrants(orgId, actorId, { application_id: applicationId });
    if (process.env.NATIVE_GRANTS_CONTRACT_PATH) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(process.env.NATIVE_GRANTS_CONTRACT_PATH, JSON.stringify({ ...snapshot, authority: { can_edit: true, can_attach: true } }));
    }
    expect(snapshot.detail!.application).toMatchObject({ workflow_stage: 'decision_pending', outcome: 'rejected', status: 'submitted', grant_id: grantId });
    expect(snapshot.opportunities.find((grant) => grant.id === grantId)).toMatchObject({ freshness: 'stale', last_verified_at: '2026-01-01' });
    expect(Number.isFinite(snapshot.opportunities.find((grant) => grant.id === grantId)!.verification_age_days)).toBe(true);
    expect(snapshot.detail!.evidence[0].document_id).toBe(documentId);
    expect(JSON.stringify(snapshot)).not.toContain('private/grant-evidence.pdf');
    expect(snapshot.detail!.payment_execution).toBe(false);
    expect(snapshot.detail!.relationship_scope.tasks).toBe('grant');
    expect(snapshot.detail!.relationship_scope.documents).toBe('project');
    expect(snapshot.detail!.report.state).toBe('evidence_snapshot');
    expect(snapshot.detail!.report.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.detail!.report.awardAmount).toBeNull();
    await expect(getNativeGrants(`${orgId}-other`, actorId, { application_id: applicationId })).rejects.toThrow('not found');
  });

  it("keeps project and Grant relationships separate and exposes scoped existing documents for projectless evidence", async () => {
    const { getNativeGrants } = await import('./native-grants-query');
    const { listNativeResources } = await import('./native-assets');
    const projectId = `${orgId}-project`, grantId = `${orgId}-grant`, unrelatedProject = `${orgId}-euro-project`;
    const linkedApplication = `${orgId}-relationships`, projectless = `${orgId}-projectless`;
    await sql`insert into label_suite.grant_applications (id,org_id,project_id,grant_id) values (${linkedApplication},${orgId},${projectId},${grantId}), (${projectless},${orgId},null,null)`;
    for (const [suffix, project] of [['related', projectId], ['unrelated', unrelatedProject]]) {
      await sql`insert into label_suite.project_events (id,org_id,title,event_type,start_date,project_id) values (${`${orgId}-${suffix}-event`},${orgId},${suffix},'other','2026-12-04',${project})`;
      await sql`insert into label_suite.media_assets (id,org_id,asset_name,project_id) values (${`${orgId}-${suffix}-asset`},${orgId},${suffix},${project})`;
      await sql`insert into label_suite.documents (id,org_id,name,project_id) values (${`${orgId}-${suffix}-document`},${orgId},${suffix},${project})`;
    }
    await sql`insert into label_suite.ops_tasks (id,org_id,task_name,project_id,linked_grant_id) values
      (${`${orgId}-grant-task`},${orgId},'Grant task',null,${grantId}), (${`${orgId}-project-task`},${orgId},'Project-only task',${projectId},null)`;
    const related = (await getNativeGrants(orgId, actorId, { application_id: linkedApplication })).detail!.relationships;
    expect(related.events.map(row => row.id)).toEqual([`${orgId}-related-event`]);
    expect(related.assets.map(row => row.id)).toEqual([`${orgId}-related-asset`]);
    expect(related.documents.map(row => row.id)).toEqual([`${orgId}-related-document`]);
    expect(related.tasks.map(row => row.id)).toEqual([`${orgId}-grant-task`]);
    expect((await getNativeGrants(orgId, actorId, { application_id: projectless })).detail!.relationships)
      .toEqual({ grant: null, project: null, events: [], assets: [], documents: [], tasks: [], budget: [] });
    // The native document picker uses the existing paginated resource search, without a project filter.
    const library = await listNativeResources(orgId, 'documents', null, null);
    expect(library.items.map(row => row.id)).toContain(`${orgId}-related-document`);
    expect(library.items.map(row => row.id)).not.toContain(`${orgId}-foreign-doc`);
    expect(library.items.length).toBeLessThanOrEqual(25);
    expect(JSON.stringify(library)).not.toMatch(/file_link|storage_key|storage_bucket/);
  });

  it("orders actionable deadlines and includes inherited missing requirements", async () => {
    const { getNativeGrants } = await import('./native-grants-query');
    const grantId = `${orgId}-grant`, urgentId = `${orgId}-urgent`, requirementId = `${orgId}-requirement`;
    await sql`insert into label_suite.grant_requirements (id,org_id,grant_id,name,required) values (${requirementId},${orgId},${grantId},'Budget document',true)`;
    await sql`update label_suite.grant_applications set workflow_stage='writing',outcome='unknown' where id=${applicationId}`;
    await sql`insert into label_suite.grant_applications (id,org_id,next_action,next_action_due) values (${urgentId},${orgId},'Urgent action','2000-01-01')`;
    const snapshot = await getNativeGrants(orgId, actorId, {});
    expect(snapshot.applications[0].id).toBe(urgentId);
    expect(snapshot.worklist.some((item) => item.applicationId === applicationId && item.kind === 'materials')).toBe(true);
    expect(snapshot.applications.find((item) => item.id === applicationId)!.checklist).toContainEqual(expect.objectContaining({ requirementId, readinessStatus: 'missing' }));
  });

  it("guards Grant catalog changes by parent and row revisions with atomic audits", async () => {
    const { mutateNativeGrantCatalog } = await import('./native-grants');
    const { getNativeGrants } = await import('./native-grants-query');
    const grantId = `${orgId}-grant`;
    const revision = async () => (await sql`select updated_at::text as revision from label_suite.grants where id=${grantId}`)[0].revision;
    const { createGrantRequirement, createGrantDeadline } = await import('./grants-workspace-mutations');
    for (const write of [() => createGrantRequirement(orgId, { grant_id: grantId, name: 'Added on web' }), () => createGrantDeadline(orgId, { grant_id: grantId, deadline_date: '2027-01-01' })]) {
      const stale = await revision();
      await write();
      await expect(mutateNativeGrantCatalog(orgId, actorId, { grant_id: grantId, expected_grant_revision: stale, action: 'create_requirement', fields: { name: 'Stale native form' } })).rejects.toThrow('changed');
    }
    const input = { grant_id: grantId, expected_grant_revision: await revision(), action: 'create_deadline', fields: { deadline_date: '2026-12-04', label: 'Submit' } };
    await expect(mutateNativeGrantCatalog(`${orgId}-other`, actorId, input)).rejects.toThrow('not found');
    await expect(mutateNativeGrantCatalog(orgId, 'missing-actor', input)).rejects.toThrow();
    expect(await sql`select id from label_suite.grant_deadlines where org_id=${orgId} and deadline_date='2026-12-04'`).toHaveLength(0);
    const created = await mutateNativeGrantCatalog(orgId, actorId, input);
    await expect(mutateNativeGrantCatalog(orgId, actorId, input)).rejects.toThrow('changed');
    const detail = (await getNativeGrants(orgId, actorId, { application_id: applicationId })).detail!;
    const deadline = detail.deadlines.find(row => row.id === created.id)!;
    expect(deadline.revision).toBeTruthy();
    const edit = { action: 'update_deadline', grant_id: grantId, expected_grant_revision: detail.grant_revision, id: created.id, expected_revision: deadline.revision, fields: { deadline_date: '2026-12-05', status: 'open' } };
    await expect(mutateNativeGrantCatalog(orgId, actorId, { ...edit, expected_revision: 'stale' })).rejects.toThrow('changed');
    await expect(mutateNativeGrantCatalog(orgId, actorId, { ...edit, fields: { deadline_date: 'tomorrow' } })).rejects.toThrow();
    await mutateNativeGrantCatalog(orgId, actorId, edit);
    expect((await sql`select deadline_date::text,status from label_suite.grant_deadlines where id=${created.id}`)[0]).toEqual({ deadline_date: '2026-12-05', status: 'open' });
    const requirement = await mutateNativeGrantCatalog(orgId, actorId, { action: 'create_requirement', grant_id: grantId, expected_grant_revision: await revision(), fields: { name: 'Report evidence', asset_role: 'budget', required: true } });
    const [row] = await sql`select updated_at::text as revision from label_suite.grant_requirements where id=${requirement.id}`;
    await mutateNativeGrantCatalog(orgId, actorId, { action: 'update_requirement', grant_id: grantId, expected_grant_revision: await revision(), id: requirement.id, expected_revision: row.revision, fields: { name: 'Final report evidence' } });
    expect(await sql`select name,asset_role from label_suite.grant_requirements where id=${requirement.id}`).toEqual([{ name: 'Final report evidence', asset_role: 'budget' }]);
    expect(await sql`select id from label_suite.audit_events where org_id=${orgId} and event_type like 'grant.%'`).toHaveLength(4);
  });

  it("continues the actionable worklist beyond its first hundred rows", async () => {
    const { getNativeGrants } = await import('./native-grants-query');
    await sql`insert into label_suite.grant_applications (id,org_id,next_action,next_action_due) select ${orgId} || '-page-' || n, ${orgId}, 'Follow up', '2001-01-01'::date from generate_series(1,102) n`;
    const first = await getNativeGrants(orgId, actorId, {});
    expect(first.worklist).toHaveLength(100);
    expect(first.next_worklist_offset).toBe(100);
    const second = await getNativeGrants(orgId, actorId, { worklist_offset: first.next_worklist_offset });
    expect(second.worklist.length).toBeGreaterThan(0);
    const ids = new Set(first.worklist.map((item) => item.id));
    expect(second.worklist.every((item) => !ids.has(item.id))).toBe(true);
  });

  it("provides bounded, tenant-scoped form choices with literal search and active members", async () => {
    const { getNativeGrantChoices } = await import('./native-grants-query');
    await sql`insert into label_suite.org_memberships (id,org_id,user_id,role) values (${`${orgId}-membership`},${orgId},${actorId},'member')`;
    expect((await getNativeGrantChoices(orgId, actorId, { kind: 'members' })).choices).toEqual([{ id: actorId, name: 'Grant actor', currency: null, project_id: null }]);
    expect((await getNativeGrantChoices(`${orgId}-other`, actorId, { kind: 'members' })).choices).toEqual([]);
    await sql`delete from label_suite.org_memberships where org_id=${orgId}`;
    expect((await getNativeGrantChoices(orgId, actorId, { kind: 'members' })).choices).toEqual([]);
    for (let i = 0; i < 26; i++) await sql`insert into label_suite.documents (id,org_id,name) values (${`${orgId}-choice-${String(i).padStart(2, '0')}`},${orgId},${`Choice 100% ${i}`})`;
    const first = await getNativeGrantChoices(orgId, actorId, { kind: 'documents', q: 'CHOICE 100%' });
    expect(first.choices).toHaveLength(25);
    expect(first.next_cursor).toBe(first.choices[24].id);
    const next = await getNativeGrantChoices(orgId, actorId, { kind: 'documents', q: 'choice 100%', cursor: first.next_cursor });
    expect(next.choices).toHaveLength(1); expect(next.next_cursor).toBeNull();
    expect(first.choices.some(row => row.id === next.choices[0].id)).toBe(false);
    expect((await getNativeGrantChoices(orgId, actorId, { kind: 'documents', q: 'Private evidence' })).choices).toEqual([]);
    const funding = await getNativeGrantChoices(orgId, actorId, { kind: 'funding', project_id: `${orgId}-euro-project` });
    expect(funding.choices.length).toBeGreaterThan(0);
    expect(funding.choices.every(row => row.project_id === `${orgId}-euro-project`)).toBe(true);
    expect((await getNativeGrantChoices(orgId, actorId, { kind: 'funding', project_id: 'foreign-project' })).choices).toEqual([]);
    for (const kind of ['grants', 'projects', 'contacts']) {
      const page = await getNativeGrantChoices(orgId, actorId, { kind });
      expect(page.choices.every(row => row.id.startsWith(orgId))).toBe(true);
    }
    await expect(getNativeGrantChoices(orgId, actorId, { kind: 'secrets' })).rejects.toThrow();
  });

  it("opens an exact grant opportunity independently of applications and rejects foreign scope", async () => {
    const { getNativeGrants } = await import('./native-grants-query');
    const grantId = `${orgId}-navigation-grant`, linked = `${orgId}-navigation-application`;
    await sql`insert into label_suite.grants(id,org_id,name) values (${grantId},${orgId},'Linked opportunity')`;
    await sql`insert into label_suite.grant_applications(id,org_id,grant_id) values (${linked},${orgId},${grantId})`;
    const result = await getNativeGrants(orgId, actorId, { grant_id: grantId });
    expect(result.selected_grant_id).toBe(grantId);
    expect(result.opportunities.map(row => row.id)).toEqual([grantId]);
    expect(result.applications.map(row => row.id)).toEqual([linked]);
    expect(result.detail).toBeNull();
    expect((await getNativeGrants(orgId, actorId, { grant_id: grantId, offset: 50 })).opportunities.map(row => row.id)).toEqual([grantId]);
    await expect(getNativeGrants(`${orgId}-other`, actorId, { grant_id: grantId })).rejects.toThrow('not found');
    await expect(getNativeGrants(orgId, actorId, { application_id: grantId })).rejects.toThrow('not found');
  });

});
