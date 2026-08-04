import { describe, expect, it, vi } from 'vitest';
import {
  missionControlContextKey,
  normalizeStoreContextEnvelope,
  type MissionControlQueryRequest,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type { StoreCoordinator } from './store-coordinator';
import type { MissionControlAdapter } from './mission-control-legacy-adapter';
import {
  MISSION_CONTROL_IPC_CHANNELS,
  registerMissionControlIpcHandlers,
} from './mission-control-ipc';

function fixtureContext(overrides: Partial<StoreContextEnvelope> = {}): StoreContextEnvelope {
  return normalizeStoreContextEnvelope({
    storeId: 'store-one',
    browserProfileId: 'profile-one',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration: 3,
    ...overrides,
  });
}

function query(context: StoreContextEnvelope, extra: Record<string, unknown> = {}) {
  return {
    query: 'workspace-bootstrap',
    requestId: 'request-1',
    contextEpoch: 9,
    context,
    ...extra,
  };
}

function today(context = fixtureContext()) {
  return {
    storeId: context.storeId,
    authorityKey: missionControlContextKey(context),
    businessDate: context.businessDate,
    marketplace: 'US' as const,
    currency: 'USD' as const,
    generatedAt: '2026-07-22T12:00:00.000Z',
    facts: {
      productCount: 0,
      configuredProductCount: 0,
      collectionJobCount: 0,
      importedMetricRows: 0,
      operationEventsToday: 0,
      browserSessionReady: false,
    },
    readiness: [],
    blockers: ['fixture'],
    attentionItems: [],
    nextAction: {
      id: 'collect',
      label: '采集',
      detail: 'fixture',
      targetView: 'collection/reports' as const,
      requiredCapabilityId: 'collection.reports.view',
      available: false,
      blockerCode: 'FIXTURE_BLOCKED',
    },
  };
}

function adapter(queryImpl?: MissionControlAdapter['query']): MissionControlAdapter {
  return {
    query: queryImpl ?? (() => ({
      query: 'workspace-bootstrap',
      data: {
        capabilities: [],
        autonomy: {
          currentMode: 'manual_approval',
          manualApprovalAvailable: true,
          policyAutoAvailable: false,
        },
        today: today(),
      },
    })),
    command: () => ({
      command: 'set-autonomy-mode',
      status: 'NOOP',
      currentMode: 'manual_approval',
      detail: 'already manual',
    }),
  };
}

function setup(current: { value: StoreContextEnvelope | null }, service = adapter()) {
  const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
  const coordinator = {
    assertActiveStoreContext: vi.fn((value: unknown) => value as StoreContextEnvelope),
    getActiveStoreContext: vi.fn(() => current.value),
  } as unknown as StoreCoordinator;
  registerMissionControlIpcHandlers(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    coordinator,
    service,
    () => new Date('2026-07-22T12:34:56.000Z'),
  );
  return { handlers, coordinator };
}

describe('Mission Control IPC authority boundary', () => {
  it('registers exactly the two fixed channels and returns an explicit Main-authoritative meta', async () => {
    const rendererContext = fixtureContext();
    const authoritative = fixtureContext();
    const { handlers } = setup({ value: authoritative });

    expect([...handlers.keys()]).toEqual(MISSION_CONTROL_IPC_CHANNELS);
    const result = await handlers.get('mission-control:query')?.({}, query(rendererContext));
    expect(result).toEqual(expect.objectContaining({
      query: 'workspace-bootstrap',
      requestId: 'request-1',
      contextEpoch: 9,
      authoritativeContext: authoritative,
      completedAt: '2026-07-22T12:34:56.000Z',
    }));
    expect(result).not.toHaveProperty('context');
  });

  it('rejects a business-date mismatch even though StoreCoordinator does not compare it', async () => {
    const submitted = fixtureContext({ businessDate: '2026-07-21' as StoreContextEnvelope['businessDate'] });
    const { handlers } = setup({ value: fixtureContext() });

    await expect(handlers.get('mission-control:query')?.({}, query(submitted)))
      .rejects.toThrow('MISSION_CONTROL_STORE_CONTEXT_MISMATCH');
  });

  it('rejects a response when Main authority changes while the adapter is awaiting', async () => {
    const before = fixtureContext();
    const current = { value: before as StoreContextEnvelope | null };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const service = adapter(async (request: MissionControlQueryRequest) => {
      await gate;
      return {
        query: 'workspace-bootstrap',
        data: {
          capabilities: [],
          autonomy: {
            currentMode: 'manual_approval',
            manualApprovalAvailable: true,
            policyAutoAvailable: false,
          },
          today: today(),
        },
      };
    });
    const { handlers } = setup(current, service);
    const pending = Promise.resolve(handlers.get('mission-control:query')?.({}, query(before)));
    current.value = fixtureContext({ sessionGeneration: 4 });
    release();

    await expect(pending).rejects.toThrow(/STORE_CONTEXT_MISMATCH|CHANGED_DURING_REQUEST/);
  });

  it('normalizes strictly before calling the adapter and never uses contextEpoch as authority', async () => {
    const current = fixtureContext();
    const service = adapter();
    const spy = vi.spyOn(service, 'query');
    const { handlers, coordinator } = setup({ value: current }, service);

    await expect(handlers.get('mission-control:query')?.({}, query(current, { filePath: 'C:\\secret' })))
      .rejects.toThrow(/unsupported field filePath/);
    expect(spy).not.toHaveBeenCalled();
    expect(coordinator.assertActiveStoreContext).not.toHaveBeenCalled();

    const result = await handlers.get('mission-control:query')?.({}, {
      ...query(current),
      contextEpoch: 999_999,
    });
    expect(result).toEqual(expect.objectContaining({ contextEpoch: 999_999 }));
  });
});
