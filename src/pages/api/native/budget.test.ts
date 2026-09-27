import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), token: vi.fn(), session: vi.fn(), read: vi.fn(), update: vi.fn(), propose: vi.fn(), decide: vi.fn(), context: vi.fn() }));
vi.mock("../../../lib/native-workspace", () => ({ resolveNativeActor: mocks.actor }));
vi.mock("../../../lib/native-session", () => ({ bearerToken: mocks.token, getNativeSession: mocks.session }));
vi.mock("../../../lib/db", () => ({ runWithDatabaseContext: mocks.context }));
vi.mock("../../../server/native-budget", () => ({ getNativeBudget: mocks.read }));
vi.mock("../../../server/budget-mutations", async original => ({ ...await original<typeof import("../../../server/budget-mutations")>(), updateBudgetLineForNative: mocks.update, createVarianceRequestForNative: mocks.propose, decideVarianceRequestForNative: mocks.decide }));
import * as route from "./budget";
const actor = (role = "member") => ({ userId: "actor", workspace: { role, org: { id: "scoped-org" } } });
const url = new URL("https://suite.test/api/native/budget?workspaceId=untrusted&project=project-a");
const context = (body?: unknown) => ({ url, request: new Request(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }) as never;
const edit = { action: 'update_line', input: { id: 'line-a', expected_revision: 'revision', expected_currency: 'DKK', planned_amount: 150 } };
beforeEach(() => {
  vi.clearAllMocks(); mocks.actor.mockResolvedValue(actor()); mocks.token.mockReturnValue(null); mocks.session.mockResolvedValue(null);
  mocks.context.mockImplementation(async (_scope, work) => work());
  mocks.read.mockResolvedValue({ projects: [], detail: null }); mocks.update.mockResolvedValue({ ok: true }); mocks.propose.mockResolvedValue({ ok: true }); mocks.decide.mockResolvedValue({ ok: true });
});
it('returns only authenticated workspace data with fresh authority and private caching', async () => {
  const response = await route.GET(context());
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toMatchObject({ authority: { can_edit: false, can_decide: false } });
  expect(mocks.read).toHaveBeenCalledWith('scoped-org', 'actor', { project_id: 'project-a', project_offset: undefined, line_offset: undefined });
});
it('denies financial reads to payees and distinguishes expired sessions from removed membership', async () => {
  mocks.actor.mockResolvedValue(actor('payee')); expect((await route.GET(context())).status).toBe(403);
  mocks.actor.mockResolvedValue(null); expect((await route.GET(context())).status).toBe(401);
  mocks.token.mockReturnValue('fixture'); mocks.session.mockResolvedValue({ user: { id: 'actor' } });
  const response = await route.GET(context()); expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ code: 'workspace_access_removed' });
  expect(mocks.read).not.toHaveBeenCalled();
});
it('rechecks edit capability per request and forwards actor, revision and scoped tenant', async () => {
  expect((await route.POST(context(edit))).status).toBe(403);
  mocks.actor.mockResolvedValue(actor('operator')); expect((await route.POST(context(edit))).status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith('scoped-org', edit.input, 'actor');
  mocks.actor.mockResolvedValue(actor()); expect((await route.POST(context(edit))).status).toBe(403);
  expect(mocks.update).toHaveBeenCalledTimes(1);
});
it('keeps variance decisions owner-only and exposes no payment action', async () => {
  const decision = { action: 'decide_variance', input: { id: 'variance-a', decision: 'approved', expected_request_revision: 'request-revision', expected_revision: 'line-revision', expected_currency: 'DKK' } };
  mocks.actor.mockResolvedValue(actor('operator')); expect((await route.POST(context(decision))).status).toBe(403);
  mocks.actor.mockResolvedValue(actor('owner')); expect((await route.POST(context(decision))).status).toBe(200);
  expect(mocks.decide).toHaveBeenCalledWith('scoped-org', decision.input, 'actor');
  expect((await route.POST(context({ action: 'execute_payment', input: {} }))).status).toBe(400);
  expect(mocks.decide).toHaveBeenCalledTimes(1);
});
