import { describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createMissionDomainPreloadApi } from './mission-domain-api';

const storeContext = normalizeStoreContextEnvelope({
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 1,
});

describe('Mission domain preload API', () => {
  it('is deeply frozen, grouped, and invokes only fixed channels', async () => {
    const invoke = vi.fn(async (channel: string) => ({ channel }));
    const api = createMissionDomainPreloadApi({ invoke });

    expect(Object.keys(api)).toEqual([
      'policies', 'policyVersions', 'policyRuntime', 'missions',
      'grants', 'decisions', 'experiments', 'causal',
    ]);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.values(api).every(Object.isFrozen)).toBe(true);
    expect(api).not.toHaveProperty('invoke');
    expect(api.grants).not.toHaveProperty('issuePolicy');
    expect(api.grants).not.toHaveProperty('appendEvent');
    expect(api.grants).not.toHaveProperty('authorize');
    expect(api.missions).not.toHaveProperty('appendLink');
    expect(api.causal).not.toHaveProperty('appendLink');
    expect(api.causal).not.toHaveProperty('appendEvidenceRef');
    expect(api.experiments).not.toHaveProperty('appendMetricSnapshot');
    expect(api.policyRuntime).not.toHaveProperty('update');

    await api.missions.create(storeContext, { id: 'mission-1' });
    await api.policyRuntime.setAutonomyMode(storeContext, {
      expectedRevision: 2,
      mode: 'manual_approval',
    });
    await api.policyRuntime.setKillSwitch(storeContext, {
      expectedRevision: 3,
      enabled: true,
    });
    await api.grants.listEvents(storeContext, { missionId: 'mission-1' });
    await api.experiments.listObservations(storeContext, { experimentId: 'experiment-1' });
    await api.experiments.listMetricSnapshots(storeContext, { experimentId: 'experiment-1' });

    expect(invoke.mock.calls).toEqual([
      ['mission-domain:missions:create', { storeContext, input: { id: 'mission-1' } }],
      ['mission-domain:policy-runtime:set-autonomy-mode', {
        storeContext,
        input: { expectedRevision: 2, mode: 'manual_approval' },
      }],
      ['mission-domain:policy-runtime:set-kill-switch', {
        storeContext,
        input: { expectedRevision: 3, enabled: true },
      }],
      ['mission-domain:grants:list-events', {
        storeContext,
        input: { missionId: 'mission-1' },
      }],
      ['mission-domain:experiments:list-observations', {
        storeContext,
        input: { experimentId: 'experiment-1' },
      }],
      ['mission-domain:experiments:list-metric-snapshots', {
        storeContext,
        input: { experimentId: 'experiment-1' },
      }],
    ]);
  });

  it('always includes an explicit input object for context-only reads', async () => {
    const invoke = vi.fn(async () => undefined);
    const api = createMissionDomainPreloadApi({ invoke });
    await api.policyRuntime.get(storeContext);
    expect(invoke).toHaveBeenCalledWith('mission-domain:policy-runtime:get', {
      storeContext,
      input: {},
    });
  });
});
