import { describe, expect, it } from 'vitest';
import {
  MISSION_CONTROL_LEGACY_ROUTE_IDS,
  MISSION_CONTROL_VIEW_IDS,
  MISSION_CONTROL_WORKSPACE_IDS,
  missionControlContextKey,
  normalizeMissionControlCommandRequest,
  normalizeMissionControlQueryRequest,
} from './mission-control';
import { normalizeStoreContextEnvelope } from './store';

const context = {
  storeId: 'SHC001',
  browserProfileId: 'store-profile-SHC001',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 4,
};

describe('Mission Control production contract', () => {
  it('keeps the ten prototype workspaces and sixteen legacy adapters stable', () => {
    expect(MISSION_CONTROL_WORKSPACE_IDS).toEqual([
      'today',
      'missions',
      'decisions',
      'experiments',
      'execution',
      'memory',
      'objects',
      'collection',
      'policy',
      'settings',
    ]);
    expect(MISSION_CONTROL_LEGACY_ROUTE_IDS).toHaveLength(16);
    expect(MISSION_CONTROL_VIEW_IDS).toHaveLength(22);
    expect(new Set(MISSION_CONTROL_VIEW_IDS).size).toBe(MISSION_CONTROL_VIEW_IDS.length);
    for (const workspace of MISSION_CONTROL_WORKSPACE_IDS) {
      expect(MISSION_CONTROL_VIEW_IDS.some((view) => view.startsWith(`${workspace}/`))).toBe(true);
    }
  });

  it('normalizes a store-bound bootstrap query and rejects extra fields', () => {
    expect(normalizeMissionControlQueryRequest({
      query: 'workspace-bootstrap',
      requestId: 'bootstrap:4',
      contextEpoch: 3,
      context,
    })).toMatchObject({
      requestId: 'bootstrap:4',
      contextEpoch: 3,
      context: normalizeStoreContextEnvelope(context),
    });

    expect(() => normalizeMissionControlQueryRequest({
      query: 'workspace-bootstrap',
      requestId: 'bootstrap:4',
      contextEpoch: 3,
      context,
      storeId: 'SHC002',
    })).toThrow('unsupported field storeId');
  });

  it('normalizes autonomy commands without accepting hidden payload fields', () => {
    expect(normalizeMissionControlCommandRequest({
      command: 'set-autonomy-mode',
      requestId: 'mode:4',
      contextEpoch: 3,
      context,
      payload: { mode: 'policy_auto', missionId: 'mission-001' },
    })).toMatchObject({
      command: 'set-autonomy-mode',
      payload: { mode: 'policy_auto', missionId: 'mission-001' },
    });

    expect(() => normalizeMissionControlCommandRequest({
      command: 'set-autonomy-mode',
      requestId: 'mode:4',
      contextEpoch: 3,
      context,
      payload: { mode: 'policy_auto', bypass: true },
    })).toThrow('unsupported field bypass');
  });

  it('binds cache identity to profile and generation as well as store', () => {
    const key = missionControlContextKey(context as never);
    expect(key).toContain('shc001');
    expect(key).toContain('store-profile-shc001');
    expect(key).toContain('|4');
    expect(missionControlContextKey({ ...context, sessionGeneration: 5 } as never)).not.toBe(key);
  });
});
