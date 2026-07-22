import { describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createMissionControlPreloadApi } from './mission-control-api';

const context = normalizeStoreContextEnvelope({
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 1,
});

describe('Mission Control preload API', () => {
  it('exposes only query and command over fixed channels', async () => {
    const invoke = vi.fn(async (channel: string) => ({ channel }));
    const api = createMissionControlPreloadApi({ invoke });

    expect(Object.keys(api)).toEqual(['query', 'command']);
    expect(Object.isFrozen(api)).toBe(true);
    await api.query({
      query: 'workspace-bootstrap',
      requestId: 'query-1',
      contextEpoch: 0,
      context,
    });
    await api.command({
      command: 'set-autonomy-mode',
      requestId: 'command-1',
      contextEpoch: 0,
      context,
      payload: { mode: 'manual_approval' },
    });

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'mission-control:query',
      'mission-control:command',
    ]);
    expect(api).not.toHaveProperty('invoke');
    expect(api).not.toHaveProperty('openPath');
  });
});
