import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ resolveNativeActor: vi.fn(), bearerToken: vi.fn(), getNativeSession: vi.fn() }));
const service = vi.hoisted(() => ({ listNativeRadioStations: vi.fn(), getNativeRadioStation: vi.fn(), updateNativeRadioPreparation: vi.fn(), createNativeRadioDraft: vi.fn() }));
vi.mock("../../../../../lib/native-workspace", () => ({ resolveNativeActor: auth.resolveNativeActor }));
vi.mock("../../../../../lib/native-session", () => ({ bearerToken: auth.bearerToken, getNativeSession: auth.getNativeSession }));
vi.mock("../../../../../lib/db", () => ({ db: {}, runWithDatabaseContext: async (_: unknown, work: () => Promise<unknown>) => work() }));
vi.mock("../../../../../server/native-radio", async original => ({ ...await original<typeof import("../../../../../server/native-radio")>(), ...service }));
vi.mock("../../../../../server/campaign-communicator", async original => ({ ...await original<typeof import("../../../../../server/campaign-communicator")>(), createNativeRadioDraft: service.createNativeRadioDraft }));
import { GET as list } from "./radio";
import { GET as detail, PATCH, POST } from "./radio/[stationId]";
const input = { expected_revision: 'exact-revision', priority: 'high', pitch_angle: 'Local scene', feedback: null };
const context = (body: unknown = input) => ({ params: { id: 'campaign-a', stationId: 'link-a' }, url: new URL('https://suite.test/api/native/campaigns/campaign-a/radio?q=Station&workspaceId=ignored'),
  request: new Request('https://suite.test/api/native/campaigns/campaign-a/radio/link-a?workspaceId=ignored', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }) as never;
describe('native radio boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.resolveNativeActor.mockResolvedValue({ userId: 'actor-a', workspace: { role: 'operator', org: { id: 'org-a' } } });
    auth.bearerToken.mockReturnValue(null); auth.getNativeSession.mockResolvedValue(null);
    service.listNativeRadioStations.mockResolvedValue({ items: [] }); service.getNativeRadioStation.mockResolvedValue({ station: {} }); service.updateNativeRadioPreparation.mockResolvedValue({ station: {} });
  });
  it('uses only authorized workspace and exact route identity with no-store responses', async () => {
    for (const handler of [list, detail, PATCH]) {
      const response = await handler(context());
      expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(service.listNativeRadioStations).toHaveBeenCalledWith('org-a', 'campaign-a', null, 'Station');
    expect(service.getNativeRadioStation).toHaveBeenCalledWith('org-a', 'campaign-a', 'link-a');
    expect(service.updateNativeRadioPreparation).toHaveBeenCalledWith('org-a', 'campaign-a', 'link-a', 'actor-a', input);
  });
  it('allows member reads but denies edits and denies payee reads', async () => {
    auth.resolveNativeActor.mockResolvedValue({ userId: 'actor-a', workspace: { role: 'member', org: { id: 'org-a' } } });
    expect((await detail(context())).status).toBe(200); expect((await PATCH(context())).status).toBe(403);
    auth.resolveNativeActor.mockResolvedValue({ userId: 'actor-a', workspace: { role: 'payee', org: { id: 'org-a' } } });
    for (const handler of [list, detail, PATCH]) expect((await handler(context())).status).toBe(403);
    expect(service.updateNativeRadioPreparation).not.toHaveBeenCalled();
  });
  it('rejects send, provider, delivery and follow-up fields before mutation', async () => {
    for (const extra of [{ status: 'sent' }, { send: true }, { provider: 'email' }, { follow_up_at: '2026-10-01' }, { last_contacted_at: '2026-10-01' }]) {
      expect((await PATCH(context({ ...input, ...extra }))).status).toBe(400);
    }
    expect(service.updateNativeRadioPreparation).not.toHaveBeenCalled();
  });
  it('accepts only manual draft fields for the authenticated workspace and guards write access', async () => {
    const payload = { expected_station_revision: 'revision', target: { scope: 'focused', lead_id: 'lead', expected_lead_revision: 'lead-revision' },
      source: null, subject: null, body: 'Manual draft' };
    service.createNativeRadioDraft.mockResolvedValue({ id: 'new-draft', status: 'draft' });
    const response = await POST(context(payload));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(service.createNativeRadioDraft).toHaveBeenCalledWith('org-a', 'campaign-a', 'link-a', 'actor-a', payload);
    service.createNativeRadioDraft.mockClear();
    expect((await POST(context({ ...payload, send: true }))).status).toBe(400);
    auth.resolveNativeActor.mockResolvedValue({ userId: 'actor-a', workspace: { role: 'member', org: { id: 'org-a' } } });
    expect((await POST(context(payload))).status).toBe(403);
    expect(service.createNativeRadioDraft).not.toHaveBeenCalled();
  });
  it('forwards structured drafts without a plain fallback and rejects ambiguous content', async () => {
    const payload = { expected_station_revision: 'revision', target: { scope: 'focused', lead_id: 'lead', expected_lead_revision: 'lead-revision' },
      source: null, subject: 'Radio', body_document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Listen', marks: [{ type: 'bold' }] }] }] } };
    service.createNativeRadioDraft.mockResolvedValue({ id: 'rich-draft', status: 'draft' });
    expect((await POST(context(payload))).status).toBe(201);
    expect(service.createNativeRadioDraft).toHaveBeenCalledWith('org-a', 'campaign-a', 'link-a', 'actor-a', payload);
    service.createNativeRadioDraft.mockClear();
    expect((await POST(context({ ...payload, body: 'Flattened' }))).status).toBe(400);
    expect(service.createNativeRadioDraft).not.toHaveBeenCalled();
  });
  it('distinguishes authentication expiry from removed workspace membership', async () => {
    auth.resolveNativeActor.mockResolvedValue(null);
    expect((await detail(context())).status).toBe(401);
    auth.bearerToken.mockReturnValue('fixture'); auth.getNativeSession.mockResolvedValue({ user: { id: 'actor-a' } });
    const response = await detail(context());
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ code: 'workspace_access_removed' });
    expect(service.getNativeRadioStation).not.toHaveBeenCalled();
  });
});
