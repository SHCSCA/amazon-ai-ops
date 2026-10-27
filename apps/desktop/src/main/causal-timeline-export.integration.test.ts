import { describe, expect, it, vi } from 'vitest';
import { createHarness } from '@amazon-ai-ops/local-db/src/sqlite/repositories/mission-domain-repo.test-harness';
import { missionControlContextKey, type CausalTimelineExport } from '@amazon-ai-ops/shared-types';
import { MissionDomainService } from './mission-domain-service';
import { registerMissionDomainIpcHandlers } from './mission-domain-ipc';
import { createMissionDomainPreloadApi } from '../preload/mission-domain-api';
import { readMemoryDomainWindowApi } from '../renderer/mission-control/workspaces/mission-domain-window-api';
import { downloadCausalTimelineSnapshot, exportFreshCausalTimeline } from '../renderer/mission-control/workspaces/memory-workspace';

function integratedHarness() {
  const harness = createHarness();
  const { repository, contextOne, contextTwo } = harness;
  const record = repository.appendCausalEvent(contextOne, {
    id: 'event-one', stage: 'FACT', eventType: 'source_fact', entityType: 'operation_note', entityId: 'entity-one',
    title: '当前店铺事实', signal: 'password=do-not-export', status: 'recorded', source: 'collector', actorId: 'main',
  });
  repository.appendEvidenceRef(contextOne, { id: 'proof-one', eventId: record.id, evidenceType: 'report', evidenceRef: 'logical:proof-one', sha256: 'b'.repeat(64) });
  let active = contextOne;
  const storeCoordinator = { assertActiveStoreContext: (context: typeof contextOne) => {
    if (missionControlContextKey(context) !== missionControlContextKey(active)) throw new Error('STALE_OR_CROSS_STORE_CONTEXT');
    return context;
  } };
  const service = new MissionDomainService({ repository, storeCoordinator });
  const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>();
  registerMissionDomainIpcHandlers({ handle: (channel, listener) => { handlers.set(channel, listener); } }, service);
  const preload = createMissionDomainPreloadApi({ invoke: async (channel, request) => handlers.get(channel)?.({}, request) });
  const api = readMemoryDomainWindowApi({ electronAPI: { missionDomain: preload } });
  if (!api) throw new Error('MEMORY_EXPORT_BRIDGE_MISSING');
  return { ...harness, api, service, switchStore: () => { active = contextTwo; } };
}

describe('causal export production IPC and renderer chain', () => {
  it('exports Main-read proof refs through fixed IPC and a redacted download without writing business data', async () => {
    const { database, contextOne, api } = integratedHarness();
    database.pragma('query_only = ON');
    const before = database.prepare('SELECT total_changes() AS count').get();
    const download = vi.fn();
    const result = await exportFreshCausalTimeline(contextOne, api, () => true, { download });
    expect(result?.recordCount).toBe(1);
    expect(download).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(download.mock.calls[0][0].content) as CausalTimelineExport;
    expect(payload.evidenceRefs).toHaveLength(1);
    expect(payload.evidenceRefs[0].evidenceRef).toBe('logical:proof-one');
    expect(payload.scope).toEqual(contextOne);
    expect(JSON.stringify(payload)).not.toContain('do-not-export');
    expect(database.prepare('SELECT total_changes() AS count').get()).toEqual(before);
  });

  it('rejects renderer-supplied record overrides and stale contexts at the Main boundary', async () => {
    const { service, contextOne, api, switchStore } = integratedHarness();
    expect(() => service.executeOperation('causal.exportTimeline', contextOne, { records: [] })).toThrow(/只能指定/);
    switchStore();
    await expect(api.exportCausalTimeline(contextOne)).rejects.toThrow('STALE_OR_CROSS_STORE_CONTEXT');
  });

  it('does not download a delayed response after A to B to A authority changes', async () => {
    const { contextOne, api } = integratedHarness();
    const snapshot = await api.exportCausalTimeline(contextOne);
    let resolve!: (value: CausalTimelineExport) => void;
    let epoch = 1;
    const capturedEpoch = epoch;
    const download = vi.fn();
    const delayed = { exportCausalTimeline: () => new Promise<CausalTimelineExport>(complete => { resolve = complete; }) };
    const pending = exportFreshCausalTimeline(contextOne, delayed, () => epoch === capturedEpoch, { download });
    epoch++;
    epoch++;
    resolve(snapshot);
    expect(await pending).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });

  it('rejects mismatched response scope or counts before creating a download', async () => {
    const { contextOne, contextTwo, api } = integratedHarness();
    const snapshot = await api.exportCausalTimeline(contextOne);
    const download = vi.fn();
    expect(() => downloadCausalTimelineSnapshot(contextTwo, snapshot, { download })).toThrow(/上下文/);
    expect(() => downloadCausalTimelineSnapshot(contextOne, { ...snapshot, evidenceCount: 0 }, { download })).toThrow(/数量/);
    expect(download).not.toHaveBeenCalled();
  });
});
