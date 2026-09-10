import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { V16_API_VERSION, V16_SERVICE_CHANNELS, type V16Request } from '@amazon-ai-ops/shared-types/src/v16-api';
import { createV16ServicesPreloadApi } from '../preload/v16-services-preload';
import { registerV16ServicesIpc, type V16Services } from './v16-services-ipc';

const context = normalizeStoreContextEnvelope({ storeId: 'store-a', browserProfileId: 'profile-a', marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles', businessDate: '2026-09-07', sessionGeneration: 3 });
function setup() {
  const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>();
  let current = { ...context };
  const services: V16Services = {
    domain: { executeOperation: vi.fn(() => []) },
    analysis: { runMissionAnalysis: vi.fn(), getMissionAnalysisProjection: vi.fn(), authorizeProposalBatch: vi.fn() },
    execution: { listBatches: vi.fn(() => []), resolveIdentity: vi.fn(), createBatch: vi.fn(), startBatch: vi.fn(), cancelBatch: vi.fn(), reconcileUnknownBatch: vi.fn(), takeOverVisibleBrowser: vi.fn() },
    storeCoordinator: { assertActiveStoreContext: value => {
      const normalized = normalizeStoreContextEnvelope(value);
      if (JSON.stringify(normalized) !== JSON.stringify(current)) throw Object.assign(new Error('stale context'), { code: 'STALE_STORE_CONTEXT' });
      return normalized;
    } },
  };
  registerV16ServicesIpc({ handle: (channel, handler) => { handlers.set(channel, handler); } }, services);
  const invoke = vi.fn(async (channel: string, request: unknown) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error('Missing channel: ' + channel);
    return handler({}, request);
  });
  return { api: createV16ServicesPreloadApi({ invoke }), services, handlers, invoke, setContext: (next: typeof context) => { current = next; } };
}
function request<T>(input: T): V16Request<T> { return { apiVersion: V16_API_VERSION, storeContext: context, input }; }

describe('V1.6 Preload/Main/production service round trip (L1 contract, not package UI evidence)', () => {
  it('registers exactly the shared typed methods and excludes raw execution/effect writes', () => {
    const { api, handlers } = setup();
    expect(Object.keys(api).length).toBe(Object.keys(V16_SERVICE_CHANNELS).length);
    expect(handlers.size).toBe(Object.keys(api).length);
    expect(api).not.toHaveProperty('executionRecordIntent');
    expect(api).not.toHaveProperty('executionRecordReadback');
    expect(api).not.toHaveProperty('decisionRecordVerification');
  });
  it('round-trips Mission reads with the complete context and one success envelope', async () => {
    const { api, services } = setup();
    expect(await api.missionList(request({}))).toEqual({ success: true, data: [] });
    expect(services.domain.executeOperation).toHaveBeenCalledWith('missions.list', context, {});
  });
  it('forwards proposal authorization to AnalysisAuthority rather than issuing a draft grant', async () => {
    const { api, services } = setup();
    await api.grantIssue(request({ missionId: 'mission-1', proposalIds: ['proposal-1'] }));
    expect(services.analysis.authorizeProposalBatch).toHaveBeenCalledWith({ context, missionId: 'mission-1', proposalIds: ['proposal-1'] });
    expect(services.domain.executeOperation).not.toHaveBeenCalled();
  });
  it('forwards batches through ExecutionAuthority with the exact native shape', async () => {
    const { api, services } = setup();
    await api.executionCreateBatch(request({ grantId: 'grant-1' }));
    expect(services.execution.createBatch).toHaveBeenCalledWith({ context, grantId: 'grant-1' });
  });
  it.each(['storeId', 'browserProfileId', 'marketplace', 'currency', 'businessTimezone', 'businessDate', 'sessionGeneration'] as const)('rejects missing or mismatched %s before domain access', async key => {
    const { api, services } = setup();
    const raw = request({});
    const invalid = { ...raw.storeContext } as Record<string, unknown>;
    delete invalid[key];
    expect(await api.missionList({ ...raw, storeContext: invalid as unknown as typeof context })).toMatchObject({ success: false });
    expect(await api.missionList({ ...raw, storeContext: { ...context, [key]: key === 'sessionGeneration' ? 4 : 'wrong' } })).toMatchObject({ success: false });
    expect(services.domain.executeOperation).not.toHaveBeenCalled();
  });
  it('rejects incompatible versions and nested authority overrides', async () => {
    const { api, services } = setup();
    expect(await api.missionList({ ...request({}), apiVersion: 'v16/0' as typeof V16_API_VERSION })).toMatchObject({ success: false, code: 'API_VERSION_MISMATCH' });
    expect(await api.missionList(request({ storeContext: context } as never))).toMatchObject({ success: false });
    expect(services.domain.executeOperation).not.toHaveBeenCalled();
  });
  it('discards late responses after an A to B to A session change', async () => {
    const { api, services, setContext } = setup();
    let release!: (value: never) => void;
    vi.mocked(services.analysis.runMissionAnalysis).mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = api.analysisRun(request({ missionId: 'mission-1' }));
    setContext(normalizeStoreContextEnvelope({ ...context, storeId: 'store-b', browserProfileId: 'profile-b', sessionGeneration: 4 }));
    setContext({ ...context, sessionGeneration: 5 });
    release({ proposals: [] } as never);
    expect(await pending).toMatchObject({ success: false, code: 'STALE_STORE_CONTEXT' });
  });
  it('does not expose Main-only paths through the new facade', async () => {
    const { api, services } = setup();
    vi.mocked(services.domain.executeOperation).mockReturnValue({ screenshotPath: 'C:/private/proof.png' });
    const result = await api.memoryList(request({}));
    expect(result).toMatchObject({ success: false });
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
