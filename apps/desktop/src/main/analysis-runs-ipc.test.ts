import { describe, it, expect, vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { V16_API_VERSION } from '@amazon-ai-ops/shared-types/src/v16-api';
import { createAnalysisRunsPreloadApi } from '../preload/analysis-runs-api';
import { registerAnalysisRunsIpcHandlers } from './analysis-runs-ipc';
const context = normalizeStoreContextEnvelope({ storeId: 'store-a', browserProfileId: 'profile-a', marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles', businessDate: '2026-09-07', sessionGeneration: 2 });
function harness() {
  let active = context;
  const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>();
  const service = { runMissionAnalysis: vi.fn(), getAnalysisRun: vi.fn(), listAnalysisRuns: vi.fn().mockReturnValue([]) };
  registerAnalysisRunsIpcHandlers({ handle: (name, handler) => handlers.set(name, handler) }, service, { assertActiveStoreContext: value => {
    const normalized = normalizeStoreContextEnvelope(value);
    if (JSON.stringify(normalized) !== JSON.stringify(active)) throw new Error('店铺上下文已变化');
    return normalized;
  } } as Parameters<typeof registerAnalysisRunsIpcHandlers>[2]);
  const api = createAnalysisRunsPreloadApi({ invoke: async (channel, request) => handlers.get(channel)!(undefined, request) });
  return { service, api, handlers, switchTo: (value: typeof context) => { active = value; } };
}
describe('Analysis Run production boundary', () => {
  it('round-trips shared requests and returns typed success data', async () => {
    const h = harness();
    expect(await h.api.list({ apiVersion: V16_API_VERSION, storeContext: context, input: { missionId: 'mission-a' } })).toEqual({ success: true, data: [] });
    expect(h.service.listAnalysisRuns).toHaveBeenCalledWith(context, { missionId: 'mission-a' });
    expect(h.handlers.has('analysis-runs:update')).toBe(false);
    expect('update' in h.api).toBe(false);
  });
  it('creates by invoking the actual analysis owner, never a raw repository write', async () => {
    const h = harness(); h.service.runMissionAnalysis.mockResolvedValue({ proposals: [] });
    expect(await h.api.create({ apiVersion: V16_API_VERSION, storeContext: context, input: { missionId: 'mission-a' } })).toEqual({ success: true, data: { proposals: [] } });
    expect(h.service.runMissionAnalysis).toHaveBeenCalledWith({ context, missionId: 'mission-a' });
  });
  it.each(['storeId', 'browserProfileId', 'marketplace', 'currency', 'businessTimezone', 'businessDate', 'sessionGeneration'])('rejects missing %s before calling the service', async key => {
    const h = harness(); const bad = { ...context } as Record<string, unknown>; delete bad[key];
    const result = await h.handlers.get('analysis-runs:list')!(undefined, { apiVersion: V16_API_VERSION, storeContext: bad, input: {} });
    expect(result).toMatchObject({ success: false }); expect(h.service.listAnalysisRuns).not.toHaveBeenCalled();
  });
  it('rejects incompatible API versions and renderer-written terminal status', async () => {
    const h = harness();
    for (const request of [ { apiVersion: 'v16/0', storeContext: context, input: {} }, { apiVersion: V16_API_VERSION, storeContext: context, input: { missionId: 'mission-a', status: 'completed' } } ]) {
      expect(await h.handlers.get('analysis-runs:create')!(undefined, request)).toMatchObject({ success: false });
    }
    expect(h.service.runMissionAnalysis).not.toHaveBeenCalled();
  });
  it('keeps filesystem and provider error details in Main', async () => {
    const h = harness();
    h.service.runMissionAnalysis.mockRejectedValue(new Error('provider secret-token at C:\\private\\keys.json'));
    const result = await h.api.create({ apiVersion: V16_API_VERSION, storeContext: context, input: { missionId: 'mission-a' } });
    expect(result).toMatchObject({ success: false });
    expect(JSON.stringify(result)).not.toMatch(/secret-token|private|keys.json/);
  });
  it('discards a completed async result after A to B to A session changes', async () => {
    const h = harness(); let release!: (value: unknown) => void;
    h.service.runMissionAnalysis.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = h.api.create({ apiVersion: V16_API_VERSION, storeContext: context, input: { missionId: 'mission-a' } });
    h.switchTo(normalizeStoreContextEnvelope({ ...context, storeId: 'store-b', browserProfileId: 'profile-b', sessionGeneration: 3 }));
    h.switchTo({ ...context, sessionGeneration: 4 }); release({ proposals: [] });
    expect(await pending).toMatchObject({ success: false, error: expect.stringMatching(/刷新当前店铺/)  });
  });
});
