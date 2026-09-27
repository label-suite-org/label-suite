import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), token: vi.fn(), session: vi.fn(), read: vi.fn(), choices: vi.fn(), create: vi.fn(), update: vi.fn(), attachments: vi.fn(), catalog: vi.fn() }));
vi.mock("../../../lib/native-workspace", () => ({ resolveNativeActor: mocks.actor }));
vi.mock("../../../lib/native-session", () => ({ bearerToken: mocks.token, getNativeSession: mocks.session }));
vi.mock("../../../lib/db", () => ({ db: {}, runWithDatabaseContext: vi.fn() }));
vi.mock("../../../server/native-grants-query", () => ({ getNativeGrants: mocks.read, getNativeGrantChoices: mocks.choices }));
vi.mock("../../../server/native-grants", async original => ({ ...await original<typeof import("../../../server/native-grants")>(), createNativeGrantApplication: mocks.create, updateNativeGrantApplication: mocks.update, mutateNativeGrantAttachments: mocks.attachments, mutateNativeGrantCatalog: mocks.catalog }));
import * as route from "./grants";
const actor = (role = "member") => ({ userId: "actor", workspace: { role, org: { id: "scoped-org" } } });
const url = new URL("https://suite.test/api/native/grants?workspaceId=untrusted&application=application-a");
const context = (body?: unknown) => ({ url, request: new Request(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }) as never;
beforeEach(() => {
  vi.clearAllMocks(); mocks.actor.mockResolvedValue(actor()); mocks.token.mockReturnValue(null); mocks.session.mockResolvedValue(null);
  mocks.read.mockResolvedValue({ applications: [], detail: null }); mocks.create.mockResolvedValue({ id: 'created', ok: true }); mocks.update.mockResolvedValue({ ok: true }); mocks.attachments.mockResolvedValue({ ok: true });
});
it('uses the authenticated workspace and returns live capabilities with private caching', async () => {
  const response = await route.GET(context());
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toMatchObject({ authority: { can_edit: false, can_attach: false } });
  expect(mocks.read).toHaveBeenCalledWith('scoped-org', 'actor', { application_id: 'application-a', offset: undefined, worklist_offset: undefined });
});
it('denies payee reads and distinguishes expired sessions from removed workspace access', async () => {
  mocks.actor.mockResolvedValue(actor('payee')); expect((await route.GET(context())).status).toBe(403);
  mocks.actor.mockResolvedValue(null); expect((await route.GET(context())).status).toBe(401);
  mocks.token.mockReturnValue('fixture'); mocks.session.mockResolvedValue({ user: { id: 'actor' } });
  const response = await route.GET(context()); expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ code: 'workspace_access_removed' });
  expect(mocks.read).not.toHaveBeenCalled();
});
it('rechecks mutation authority and keeps create/update actor and revision scoped', async () => {
  const input = { id: 'application-a', expected_revision: 'exact-revision', next_action: 'Review evidence' };
  const edit = { action: 'update_application', input };
  expect((await route.POST(context(edit))).status).toBe(403);
  mocks.actor.mockResolvedValue(actor('fundraiser')); expect((await route.POST(context(edit))).status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith('scoped-org', 'actor', input);
  expect((await route.POST(context({ action: 'create_application', input: { next_action: 'Write draft' } }))).status).toBe(201);
  expect(mocks.create).toHaveBeenCalledWith('scoped-org', 'actor', { next_action: 'Write draft' });
  mocks.actor.mockResolvedValue(actor()); expect((await route.POST(context(edit))).status).toBe(403);
  expect(mocks.update).toHaveBeenCalledTimes(1);
});
it('accepts canonical evidence IDs but exposes no raw upload, payment or submission action', async () => {
  const input = { action: 'link_evidence', application_id: 'application-a', expected_revision: 'exact', expected_context_revision: 'a'.repeat(64), document_id: 'document-a', asset_role: 'other', required: true, readiness_status: 'ready' };
  expect((await route.POST(context({ action: 'update_attachments', input }))).status).toBe(403);
  mocks.actor.mockResolvedValue(actor('operator'));
  expect((await route.POST(context({ action: 'update_attachments', input }))).status).toBe(200);
  expect(mocks.attachments).toHaveBeenCalledWith('scoped-org', 'actor', input);
  expect((await route.POST(context({ action: 'update_attachments', input: { ...input, storage_key: 'private/other' } }))).status).toBe(400);
  for (const action of ['execute_payment', 'submit_application']) expect((await route.POST(context({ action, input: {} }))).status).toBe(400);
  expect(mocks.attachments).toHaveBeenCalledTimes(1);
});

it('requires fundraising authority for revision guarded catalog changes', async () => {
  const input = { action: 'create_requirement', grant_id: 'grant-a', expected_grant_revision: 'exact', fields: { name: 'Budget evidence' } };
  expect((await route.POST(context({ action: 'update_catalog', input }))).status).toBe(403);
  mocks.actor.mockResolvedValue(actor('fundraiser')); mocks.catalog.mockResolvedValue({ id: 'requirement-a', ok: true });
  expect((await route.POST(context({ action: 'update_catalog', input }))).status).toBe(200);
  expect(mocks.catalog).toHaveBeenCalledWith('scoped-org', 'actor', input);
  expect((await route.POST(context({ action: 'update_catalog', input: { ...input, fields: { name: 'Budget', sort_order: 2_147_483_648 } } }))).status).toBe(400);
  expect(mocks.catalog).toHaveBeenCalledTimes(1);
});

it('scopes form choices to the authenticated workspace and denies payees', async () => {
  const choiceURL = new URL('https://suite.test/api/native/grants?workspaceId=untrusted&choice_kind=funding&q=Support&cursor=previous&project_id=project-a');
  const ctx = { url: choiceURL, request: new Request(choiceURL) } as never;
  mocks.choices.mockResolvedValue({ choices: [], next_cursor: null });
  const response = await route.GET(ctx);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(mocks.choices).toHaveBeenCalledWith('scoped-org', 'actor', { kind: 'funding', q: 'Support', cursor: 'previous', project_id: 'project-a' });
  mocks.actor.mockResolvedValue(actor('payee'));
  expect((await route.GET(ctx)).status).toBe(403);
  expect(mocks.choices).toHaveBeenCalledTimes(1);
});
