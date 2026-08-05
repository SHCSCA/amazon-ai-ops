import { describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { StoreRepositoryError } from '@amazon-ai-ops/local-db';
import { StoreCoordinatorError, type StoreCoordinator } from './store-coordinator';
import {
  registerStoreIpcHandlers,
  STORE_IPC_CHANNELS,
  type StoreIpcMutationScope,
} from './store-ipc';

const activeContext = normalizeStoreContextEnvelope({
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-23',
  sessionGeneration: 4,
});

function createCoordinator(): StoreCoordinator {
  return {
    listStores: vi.fn(() => []),
    getStore: vi.fn((storeId) => ({ storeId, status: 'active', marketplace: 'US' })),
    getConnection: vi.fn((storeId, id) => ({ id, storeId, provider: 'amazon_ads' })),
    createStore: vi.fn(),
    updateStore: vi.fn(),
    archiveStore: vi.fn(),
    restoreStore: vi.fn(),
    createConnection: vi.fn(() => ({ storeId: 'store-one' })),
    updateConnection: vi.fn(() => ({ storeId: 'store-one' })),
    removeConnection: vi.fn(),
    switchStore: vi.fn(() => ({ store: { storeId: 'store-two' }, context: activeContext })),
    reconnectStore: vi.fn(() => ({ store: { storeId: 'store-one' }, context: activeContext })),
    getActiveStoreContext: vi.fn(() => activeContext),
    getActiveStoreWorkspaceView: vi.fn(() => null),
    getOperatorWorkspaceSelection: vi.fn(() => null),
  } as unknown as StoreCoordinator;
}

describe('store IPC boundary', () => {
  it('registers only logical store CRUD/context channels and emits switch results', async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = {
      listStores: vi.fn(() => []),
      getStore: vi.fn((storeId) => ({ storeId, status: 'active', marketplace: 'US' })),
      getConnection: vi.fn((storeId, id) => ({ id, storeId, provider: 'amazon_ads' })),
      createStore: vi.fn(),
      updateStore: vi.fn(),
      archiveStore: vi.fn(),
      restoreStore: vi.fn(),
      createConnection: vi.fn(() => ({ storeId: 'store-one' })),
      updateConnection: vi.fn(() => ({ storeId: 'store-one' })),
      removeConnection: vi.fn(),
      switchStore: vi.fn(() => ({ store: { storeId: 'store-one' }, context: { storeId: 'store-one' } })),
      reconnectStore: vi.fn(),
      getActiveStoreContext: vi.fn(() => null),
      getActiveStoreWorkspaceView: vi.fn(() => null),
      getOperatorWorkspaceSelection: vi.fn(() => null),
    } as unknown as StoreCoordinator;
    const onStoreChanged = vi.fn();

    registerStoreIpcHandlers({
      handle: (channel, handler) => handlers.set(channel, handler),
    }, coordinator, { onStoreChanged });

    expect([...handlers.keys()]).toEqual(STORE_IPC_CHANNELS);
    expect([...handlers.keys()].some((channel) => /path|profile|cookie|password/i.test(channel))).toBe(false);
    const result = await handlers.get('stores:switch')?.({}, {
      storeId: 'store-one', marketplace: 'US',
    });
    expect(coordinator.switchStore).toHaveBeenCalledWith({
      storeId: 'store-one', marketplace: 'US',
    });
    expect(onStoreChanged).toHaveBeenCalledWith(result);
  });

  it('returns the complete Renderer-safe active workspace view through a read-only channel', () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const activeView = {
      store: { storeId: 'store-one', marketplace: 'US', currency: 'USD' },
      context: activeContext,
      connections: [{ id: 'connection-one', storeId: 'store-one', provider: 'lingxing' }],
      sessions: [],
    };
    const coordinator = createCoordinator();
    vi.mocked(coordinator.getActiveStoreWorkspaceView).mockReturnValue(activeView as never);

    registerStoreIpcHandlers({
      handle: (channel, handler) => handlers.set(channel, handler),
    }, coordinator);

    expect(handlers.get('stores:get-active-workspace-view')?.({}, {
      storeId: 'renderer-cannot-select-authority',
      password: 'renderer-cannot-send-secrets',
    })).toBe(activeView);
    expect(coordinator.getActiveStoreWorkspaceView).toHaveBeenCalledOnce();
    expect(coordinator.createConnection).not.toHaveBeenCalled();
  });

  it('rejects non-object CRUD payloads before repository access', () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = {
      listStores: vi.fn(),
      getStore: vi.fn(),
      getConnection: vi.fn((storeId, id) => ({ id, storeId, provider: 'amazon_ads' })),
      createStore: vi.fn(),
      updateStore: vi.fn(),
      archiveStore: vi.fn(),
      restoreStore: vi.fn(),
      createConnection: vi.fn(),
      updateConnection: vi.fn(),
      removeConnection: vi.fn(),
      switchStore: vi.fn(),
      reconnectStore: vi.fn(),
      getActiveStoreContext: vi.fn(),
      getActiveStoreWorkspaceView: vi.fn(() => null),
      getOperatorWorkspaceSelection: vi.fn(() => null),
    } as unknown as StoreCoordinator;
    const laneCall = vi.fn();
    async function withUserStoreMutation<Result>(
      _scope: StoreIpcMutationScope,
      work: () => Result | Promise<Result>,
    ): Promise<Result> {
      laneCall();
      return work();
    }
    registerStoreIpcHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      coordinator,
      { withUserStoreMutation },
    );

    expect(() => handlers.get('stores:create')?.({}, 'C:\\renderer-controlled')).toThrow(/object/);
    expect(coordinator.createStore).not.toHaveBeenCalled();
    expect(laneCall).not.toHaveBeenCalled();
  });

  it('rejects an invalid Renderer store id before claiming the shared mutation lane', () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    const withUserStoreMutation = vi.fn(async (_scope, work) => work());
    registerStoreIpcHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      coordinator,
      { withUserStoreMutation },
    );

    expect(() => handlers.get('stores:switch')?.({}, {
      storeId: 'C:\\renderer-profile', marketplace: 'US',
    }))
      .toThrow(/storeId/i);

    expect(withUserStoreMutation).not.toHaveBeenCalled();
    expect(coordinator.switchStore).not.toHaveBeenCalled();
  });

  it('requires an explicit US marketplace for switch and rejects a Main scope mismatch pre-write', async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    const withUserStoreMutation = vi.fn(async (_scope, work) => work());
    registerStoreIpcHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      coordinator,
      { withUserStoreMutation },
    );

    expect(() => handlers.get('stores:switch')?.({}, { storeId: 'store-two' }))
      .toThrow(/marketplace is required/);
    expect(withUserStoreMutation).not.toHaveBeenCalled();

    vi.mocked(coordinator.getStore).mockReturnValue({
      storeId: 'store-two',
      status: 'active',
      marketplace: 'CA',
    } as never);
    await expect(handlers.get('stores:switch')?.({}, {
      storeId: 'store-two', marketplace: 'US',
    })).rejects.toMatchObject({ code: 'STORE_CONTEXT_MISMATCH' });
    expect(coordinator.switchStore).not.toHaveBeenCalled();
  });

  it('reads selection and cross-store daily status outside the mutation lane', () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    const selection = {
      schemaVersion: 1,
      storeId: 'store-one',
      marketplace: 'US',
      selectedAt: '2026-07-23T00:00:00.000Z',
    };
    vi.mocked(coordinator.getOperatorWorkspaceSelection).mockReturnValue(selection as never);
    const withUserStoreMutation = vi.fn(async (_scope, work) => work());
    const dailyStatusReader = {
      list: vi.fn(() => ({
        schemaVersion: 1,
        marketplace: 'US',
        generatedAt: '2026-07-23T00:00:00.000Z',
        stores: [],
      })),
    };
    registerStoreIpcHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      coordinator,
      { withUserStoreMutation },
      dailyStatusReader as never,
    );

    expect(handlers.get('stores:get-selection')?.({})).toEqual(selection);
    expect(handlers.get('stores:daily-status:list')?.({}, {
      marketplace: 'US', includeInactive: true, includeArchived: true,
    })).toMatchObject({ marketplace: 'US', stores: [] });
    expect(dailyStatusReader.list).toHaveBeenCalledWith({
      marketplace: 'US', includeInactive: true, includeArchived: true,
    });
    expect(withUserStoreMutation).not.toHaveBeenCalled();
  });

  it('rejects an unsupported Renderer marketplace before claiming the shared mutation lane', () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    const withUserStoreMutation = vi.fn(async (_scope, work) => work());
    registerStoreIpcHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      coordinator,
      { withUserStoreMutation },
    );

    expect(() => handlers.get('stores:create')?.({}, {
      displayName: 'US Store',
      marketplace: 'DE',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
    })).toThrow(/marketplace/i);

    expect(withUserStoreMutation).not.toHaveBeenCalled();
    expect(coordinator.createStore).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'empty display name',
      channel: 'stores:create',
      input: { displayName: '', marketplace: 'US', currency: 'USD' },
    },
    {
      label: 'unsupported currency',
      channel: 'stores:create',
      input: { displayName: 'US Store', marketplace: 'US', currency: 'EUR' },
    },
    {
      label: 'non-US business timezone',
      channel: 'stores:create',
      input: {
        displayName: 'US Store',
        marketplace: 'US',
        currency: 'USD',
        businessTimezone: 'Asia/Shanghai',
      },
    },
    {
      label: 'missing update patch',
      channel: 'stores:update',
      input: { storeId: 'store-one' },
    },
    {
      label: 'archived update status',
      channel: 'stores:update',
      input: {
        storeId: 'store-one',
        patch: { status: 'archived' },
        expectedUpdatedAt: '2026-07-23T00:00:00.000Z',
      },
    },
    {
      label: 'missing update revision',
      channel: 'stores:update',
      input: { storeId: 'store-one', patch: { displayName: 'Renamed' } },
    },
    {
      label: 'missing archive revision',
      channel: 'stores:archive',
      input: { storeId: 'store-one' },
    },
    {
      label: 'missing restore revision',
      channel: 'stores:restore',
      input: { storeId: 'store-one' },
    },
    {
      label: 'invalid expected revision',
      channel: 'stores:archive',
      input: { storeId: 'store-one', expectedUpdatedAt: 42 },
    },
    {
      label: 'invalid restore store id',
      channel: 'stores:restore',
      input: { storeId: '../store-one' },
    },
    {
      label: 'unsupported connection provider',
      channel: 'stores:connections:create',
      input: { storeId: 'store-one', provider: 'seller_central' },
    },
    {
      label: 'control character in account label',
      channel: 'stores:connections:create',
      input: { storeId: 'store-one', provider: 'lingxing', accountLabel: 'operator\u0000' },
    },
    {
      label: 'invalid connection capability id',
      channel: 'stores:connections:update',
      input: { id: 'C:\\connection', storeId: 'store-one' },
    },
    {
      label: 'empty connection update patch',
      channel: 'stores:connections:update',
      input: { id: 'connection-one', storeId: 'store-one' },
    },
    {
      label: 'oversized external account id',
      channel: 'stores:connections:update',
      input: { id: 'connection-one', storeId: 'store-one', externalAccountId: 'x'.repeat(257) },
    },
    {
      label: 'missing connection update revision',
      channel: 'stores:connections:update',
      input: { id: 'connection-one', storeId: 'store-one', accountLabel: 'operator' },
    },
    {
      label: 'missing connection remove revision',
      channel: 'stores:connections:remove',
      input: { id: 'connection-one', storeId: 'store-one' },
    },
    {
      label: 'missing remove capability id',
      channel: 'stores:connections:remove',
      input: { storeId: 'store-one' },
    },
    {
      label: 'invalid reconnect store id',
      channel: 'stores:reconnect',
      input: { storeId: 'store one' },
    },
  ])('rejects $label before claiming the shared mutation lane', ({ channel, input }) => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    const withUserStoreMutation = vi.fn(async (_scope, work) => work());
    registerStoreIpcHandlers(
      { handle: (registeredChannel, handler) => handlers.set(registeredChannel, handler) },
      coordinator,
      { withUserStoreMutation },
    );

    expect(() => handlers.get(channel)?.({}, input)).toThrow();
    expect(withUserStoreMutation).not.toHaveBeenCalled();
  });

  it.each([
    ['stores:connections:create', {
      storeId: 'store-one',
      provider: 'lingxing',
      accountLabel: 'operator',
      externalAccountId: 'renderer-forged-stable-id',
    }, 'createConnection'],
    ['stores:connections:update', {
      id: 'connection-one',
      storeId: 'store-one',
      externalAccountId: 'renderer-forged-stable-id',
      expectedUpdatedAt: '2026-07-23T00:00:00.000Z',
    }, 'updateConnection'],
  ] as const)('rejects Renderer Lingxing stable identity on %s before browser transition or DB write', (
    channel,
    input,
    mutation,
  ) => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    vi.mocked(coordinator.getConnection).mockReturnValue({
      id: 'connection-one',
      storeId: 'store-one',
      provider: 'lingxing',
    } as never);
    const withUserStoreMutation = vi.fn(async (_scope, work) => work());
    const beforeActiveStoreMutation = vi.fn();
    registerStoreIpcHandlers(
      { handle: (registeredChannel, handler) => handlers.set(registeredChannel, handler) },
      coordinator,
      { withUserStoreMutation, beforeActiveStoreMutation },
    );

    expect(() => handlers.get(channel)?.({}, input)).toThrow(/Main-enrolled identity/);
    expect(withUserStoreMutation).not.toHaveBeenCalled();
    expect(beforeActiveStoreMutation).not.toHaveBeenCalled();
    expect(coordinator[mutation]).not.toHaveBeenCalled();
  });

  it('rebuilds connection commands from an explicit Renderer-safe field allowlist', async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = {
      listStores: vi.fn(),
      getStore: vi.fn(),
      getConnection: vi.fn((storeId, id) => ({ id, storeId, provider: 'amazon_ads' })),
      createStore: vi.fn(),
      updateStore: vi.fn(),
      archiveStore: vi.fn(),
      restoreStore: vi.fn(),
      createConnection: vi.fn(() => ({ storeId: 'store-one' })),
      updateConnection: vi.fn(() => ({ storeId: 'store-one' })),
      removeConnection: vi.fn(),
      switchStore: vi.fn(),
      reconnectStore: vi.fn(),
      getActiveStoreContext: vi.fn(),
      getActiveStoreWorkspaceView: vi.fn(() => null),
    } as unknown as StoreCoordinator;
    registerStoreIpcHandlers({ handle: (channel, handler) => handlers.set(channel, handler) }, coordinator);
    const forged = {
      id: ' CAPABILITY-One ',
      storeId: ' Store-One ',
      provider: ' AMAZON_ADS ',
      accountLabel: ' operator@example.com ',
      collectionStoreName: ' US Main Store ',
      status: 'ready',
      lastVerifiedAt: 'forged',
      lastFailureCode: 'forged',
      expectedUpdatedAt: ' 2026-07-23T00:00:00.000Z ',
    };

    expect(() => handlers.get('stores:connections:create')?.({}, {
      ...forged,
      externalAccountId: 'renderer-forged-ads-identity',
    })).toThrow(/Main-enrolled identity/);
    expect(() => handlers.get('stores:connections:update')?.({}, {
      ...forged,
      externalAccountId: 'renderer-forged-ads-identity',
    })).toThrow(/Main-enrolled identity/);
    await handlers.get('stores:connections:create')?.({}, forged);
    await handlers.get('stores:connections:update')?.({}, forged);
    await handlers.get('stores:connections:remove')?.({}, forged);

    expect(coordinator.createConnection).toHaveBeenCalledWith({
      storeId: 'store-one',
      provider: 'amazon_ads',
      accountLabel: 'operator@example.com',
      collectionStoreName: 'US Main Store',
    });
    expect(coordinator.updateConnection).toHaveBeenCalledWith({
      id: 'capability-one',
      storeId: 'store-one',
      accountLabel: 'operator@example.com',
      collectionStoreName: 'US Main Store',
      expectedUpdatedAt: '2026-07-23T00:00:00.000Z',
    });
    expect(coordinator.removeConnection).toHaveBeenCalledWith({
      id: 'capability-one',
      storeId: 'store-one',
      expectedUpdatedAt: '2026-07-23T00:00:00.000Z',
    });
  });

  it('rebuilds and normalizes Store CRUD commands from Renderer-safe allowlists', async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    vi.mocked(coordinator.createStore).mockReturnValue({ storeId: 'store-created' } as never);
    vi.mocked(coordinator.updateStore).mockReturnValue({ storeId: 'store-one' } as never);
    vi.mocked(coordinator.archiveStore).mockReturnValue({ storeId: 'store-one' } as never);
    vi.mocked(coordinator.restoreStore).mockReturnValue({ storeId: 'store-one' } as never);
    registerStoreIpcHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      coordinator,
    );

    await handlers.get('stores:create')?.({}, {
      displayName: '  US   Store  ',
      marketplace: ' us ',
      currency: ' usd ',
      businessTimezone: ' America/Los_Angeles ',
      browserProfileId: 'renderer-forged-profile',
      status: 'archived',
      password: 'renderer-secret',
    });
    await handlers.get('stores:update')?.({}, {
      storeId: ' Store-One ',
      patch: {
        displayName: '  Renamed   Store ',
        status: 'active',
        businessTimezone: ' America/Los_Angeles ',
        archivedAt: 'forged',
      },
      expectedUpdatedAt: ' 2026-07-23T00:00:00.000Z ',
      browserProfileId: 'renderer-forged-profile',
    });
    await handlers.get('stores:archive')?.({}, {
      storeId: ' STORE-ONE ',
      expectedUpdatedAt: ' 2026-07-23T00:00:00.000Z ',
      reason: '  operator archive ',
      hardDelete: true,
    });
    await handlers.get('stores:restore')?.({}, {
      storeId: ' STORE-ONE ',
      expectedUpdatedAt: ' 2026-07-24T00:00:00.000Z ',
      browserProfileId: 'renderer-forged-profile',
    });

    expect(coordinator.createStore).toHaveBeenCalledWith({
      displayName: 'US Store',
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
    });
    expect(coordinator.updateStore).toHaveBeenCalledWith({
      storeId: 'store-one',
      patch: {
        displayName: 'Renamed Store',
        status: 'active',
        businessTimezone: 'America/Los_Angeles',
      },
      expectedUpdatedAt: '2026-07-23T00:00:00.000Z',
    });
    expect(coordinator.archiveStore).toHaveBeenCalledWith({
      storeId: 'store-one',
      expectedUpdatedAt: '2026-07-23T00:00:00.000Z',
      reason: 'operator archive',
    });
    expect(coordinator.restoreStore).toHaveBeenCalledWith({
      storeId: 'store-one',
      expectedUpdatedAt: '2026-07-24T00:00:00.000Z',
    });
  });

  it.each([
    ['stores:switch', { storeId: 'store-two', marketplace: 'US' }, 'switchStore'],
    ['stores:reconnect', { storeId: 'store-one' }, 'reconnectStore'],
    ['stores:connections:create', {
      storeId: 'store-one', provider: 'amazon_ads', accountLabel: 'operator',
    }, 'createConnection'],
    ['stores:connections:update', {
      id: 'connection-one', storeId: 'store-one', accountLabel: 'operator', expectedUpdatedAt: '2026-07-23T00:00:00.000Z',
    }, 'updateConnection'],
    ['stores:connections:remove', {
      id: 'connection-one', storeId: 'store-one', expectedUpdatedAt: '2026-07-23T00:00:00.000Z',
    }, 'removeConnection'],
  ] as const)('runs the active execution guard before %s mutates coordinator state', async (
    channel,
    input,
    mutation,
  ) => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    const beforeActiveStoreMutation = vi.fn();
    registerStoreIpcHandlers(
      { handle: (registeredChannel, handler) => handlers.set(registeredChannel, handler) },
      coordinator,
      { beforeActiveStoreMutation },
    );

    await handlers.get(channel)?.({}, input);

    expect(beforeActiveStoreMutation).toHaveBeenCalledWith(activeContext, channel);
    const coordinatorMutation = coordinator[mutation] as ReturnType<typeof vi.fn>;
    expect(beforeActiveStoreMutation.mock.invocationCallOrder[0])
      .toBeLessThan(coordinatorMutation.mock.invocationCallOrder[0]);
  });

  it.each([
    ['stores:switch', { storeId: 'store-two', marketplace: 'US' }, 'switchStore'],
    ['stores:reconnect', { storeId: 'store-one' }, 'reconnectStore'],
    ['stores:connections:create', {
      storeId: 'store-one', provider: 'amazon_ads', accountLabel: 'operator',
    }, 'createConnection'],
    ['stores:connections:update', {
      id: 'connection-one', storeId: 'store-one', accountLabel: 'operator', expectedUpdatedAt: '2026-07-23T00:00:00.000Z',
    }, 'updateConnection'],
    ['stores:connections:remove', {
      id: 'connection-one', storeId: 'store-one', expectedUpdatedAt: '2026-07-23T00:00:00.000Z',
    }, 'removeConnection'],
  ] as const)('does not mutate coordinator state when the active execution guard rejects %s', async (
    channel,
    input,
    mutation,
  ) => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    registerStoreIpcHandlers(
      { handle: (registeredChannel, handler) => handlers.set(registeredChannel, handler) },
      coordinator,
      { beforeActiveStoreMutation: () => { throw new Error('execution batch is active'); } },
    );

    await expect(handlers.get(channel)?.({}, input)).rejects.toThrow('execution batch is active');
    expect(coordinator[mutation]).not.toHaveBeenCalled();
  });

  it('claims one user mutation scope around every mutating channel but not read-only channels', async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    vi.mocked(coordinator.createStore).mockReturnValue({ storeId: 'store-created' } as never);
    vi.mocked(coordinator.updateStore).mockReturnValue({ storeId: 'store-one' } as never);
    vi.mocked(coordinator.archiveStore).mockReturnValue({ storeId: 'store-one' } as never);
    vi.mocked(coordinator.restoreStore).mockReturnValue({ storeId: 'store-one' } as never);
    const scopes: Array<{
      operation: string;
      targetStoreId?: string;
    }> = [];
    const withUserStoreMutation = vi.fn(async (scope, work) => {
      scopes.push(scope);
      return work();
    });
    registerStoreIpcHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      coordinator,
      { withUserStoreMutation },
    );

    await handlers.get('stores:create')?.({}, {
      displayName: 'Created',
      marketplace: 'US',
      currency: 'USD',
    });
    await handlers.get('stores:update')?.({}, {
      storeId: 'store-one',
      patch: { displayName: 'Updated' },
      expectedUpdatedAt: '2026-07-23T00:00:00.000Z',
    });
    await handlers.get('stores:archive')?.({}, {
      storeId: 'store-one',
      expectedUpdatedAt: '2026-07-23T00:00:00.000Z',
    });
    await handlers.get('stores:restore')?.({}, {
      storeId: 'store-one',
      expectedUpdatedAt: '2026-07-24T00:00:00.000Z',
    });
    await handlers.get('stores:connections:create')?.({}, {
      storeId: 'store-one',
      provider: 'amazon_ads',
      accountLabel: 'operator',
    });
    await handlers.get('stores:connections:update')?.({}, {
      id: 'connection-one',
      storeId: 'store-one',
      accountLabel: 'operator',
      expectedUpdatedAt: '2026-07-23T00:00:00.000Z',
    });
    await handlers.get('stores:connections:remove')?.({}, {
      id: 'connection-one',
      storeId: 'store-one',
      expectedUpdatedAt: '2026-07-23T00:00:00.000Z',
    });
    await handlers.get('stores:switch')?.({}, { storeId: 'store-two', marketplace: 'US' });
    await handlers.get('stores:reconnect')?.({}, { storeId: 'store-one' });
    handlers.get('stores:list')?.({}, undefined);
    handlers.get('stores:get-active-context')?.({});

    expect(scopes.map(({ operation }) => operation)).toEqual([
      'stores:create',
      'stores:update',
      'stores:archive',
      'stores:restore',
      'stores:connections:create',
      'stores:connections:update',
      'stores:connections:remove',
      'stores:switch',
      'stores:reconnect',
    ]);
    expect(scopes.find(({ operation }) => operation === 'stores:create'))
      .not.toHaveProperty('targetStoreId');
    expect(scopes.find(({ operation }) => operation === 'stores:switch'))
      .toMatchObject({ targetStoreId: 'store-two', targetMarketplace: 'US' });
    expect(withUserStoreMutation).toHaveBeenCalledTimes(9);
  });

  it('reads active authority after the shared mutation lane is claimed', async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    const nextContext = normalizeStoreContextEnvelope({
      ...activeContext,
      businessDate: '2026-07-24',
      sessionGeneration: 5,
    });
    vi.mocked(coordinator.getActiveStoreContext).mockReturnValue(nextContext);
    const beforeActiveStoreMutation = vi.fn();
    const withUserStoreMutation = vi.fn(async (_scope, work) => {
      expect(coordinator.getActiveStoreContext).not.toHaveBeenCalled();
      return work();
    });
    registerStoreIpcHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      coordinator,
      { withUserStoreMutation, beforeActiveStoreMutation },
    );

    await handlers.get('stores:switch')?.({}, { storeId: 'store-two', marketplace: 'US' });

    expect(withUserStoreMutation).toHaveBeenCalledOnce();
    expect(beforeActiveStoreMutation).toHaveBeenCalledWith(nextContext, 'stores:switch');
  });

  it('awaits the active-store guard before mutating coordinator state', async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    let releaseGuard!: () => void;
    const guard = new Promise<void>((resolve) => {
      releaseGuard = resolve;
    });
    registerStoreIpcHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      coordinator,
      { beforeActiveStoreMutation: () => guard },
    );

    const mutation = handlers.get('stores:switch')?.({}, { storeId: 'store-two', marketplace: 'US' });
    await Promise.resolve();
    expect(coordinator.switchStore).not.toHaveBeenCalled();

    releaseGuard();
    await mutation;
    expect(coordinator.switchStore).toHaveBeenCalledOnce();
  });

  it('keeps the user mutation lane held until asynchronous post-mutation callbacks settle', async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    let releaseChanged!: () => void;
    const changed = new Promise<void>((resolve) => {
      releaseChanged = resolve;
    });
    const order: string[] = [];
    registerStoreIpcHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      coordinator,
      {
        withUserStoreMutation: async (_scope, work) => {
          order.push('claimed');
          try {
            return await work();
          } finally {
            order.push('released');
          }
        },
        onStoreChanged: async () => {
          order.push('callback-started');
          await changed;
          order.push('callback-finished');
        },
      },
    );

    const mutation = handlers.get('stores:switch')?.({}, { storeId: 'store-two', marketplace: 'US' });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['claimed', 'callback-started']);

    releaseChanged();
    await mutation;
    expect(order).toEqual([
      'claimed',
      'callback-started',
      'callback-finished',
      'released',
    ]);
  });

  it('reports a post-commit callback failure without misreporting the committed mutation', async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    const withUserStoreMutation = vi.fn(async (_scope, work) => work());
    const onPostCommitFailure = vi.fn();
    registerStoreIpcHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      coordinator,
      {
        withUserStoreMutation,
        onStoreChanged: async () => {
          throw new Error('runtime close readback failed');
        },
        onPostCommitFailure,
      },
    );

    await expect(
      handlers.get('stores:switch')?.({}, { storeId: 'store-two', marketplace: 'US' }),
    ).resolves.toMatchObject({ store: { storeId: 'store-two' } });
    expect(coordinator.switchStore).toHaveBeenCalledOnce();
    expect(withUserStoreMutation).toHaveBeenCalledOnce();
    expect(onPostCommitFailure).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'stores:switch',
      targetStoreId: 'store-two',
      error: expect.objectContaining({ message: 'runtime close readback failed' }),
    }));
  });

  it.each([
    {
      label: 'invalid coordinator input',
      channel: 'stores:create',
      input: { displayName: 'Parser-valid name', marketplace: 'US', currency: 'USD' },
      mutation: 'createStore',
      error: new StoreCoordinatorError('INVALID_DISPLAY_NAME', 'displayName is required'),
    },
    {
      label: 'duplicate repository identity',
      channel: 'stores:create',
      input: { displayName: 'Duplicate', marketplace: 'US', currency: 'USD' },
      mutation: 'createStore',
      error: new StoreRepositoryError('STORE_ALREADY_EXISTS', 'store already exists'),
    },
  ])('rethrows $label only after the shared mutation lane resolves normally', async ({
    channel,
    input,
    mutation,
    error,
  }) => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    vi.mocked(coordinator[mutation as keyof StoreCoordinator] as ReturnType<typeof vi.fn>)
      .mockImplementation(() => { throw error; });
    let laneResolved: unknown;
    let laneRejected: unknown;
    async function withUserStoreMutation<Result>(
      _scope: StoreIpcMutationScope,
      work: () => Result | Promise<Result>,
    ): Promise<Result> {
      try {
        const result = await work();
        laneResolved = result;
        return result;
      } catch (laneError) {
        laneRejected = laneError;
        throw laneError;
      }
    }
    registerStoreIpcHandlers(
      { handle: (registeredChannel, handler) => handlers.set(registeredChannel, handler) },
      coordinator,
      { withUserStoreMutation },
    );

    await expect(handlers.get(channel)?.({}, input)).rejects.toBe(error);

    expect(laneRejected).toBeUndefined();
    expect(laneResolved).toBeTypeOf('object');
    expect(Object.isFrozen(laneResolved)).toBe(true);
    expect(coordinator[mutation as keyof StoreCoordinator]).toHaveBeenCalledOnce();
  });

  it('rethrows a proven write-free switch preflight rejection after the lane resolves', async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    const error = new StoreCoordinatorError('STORE_NOT_FOUND', 'store was not found');
    vi.mocked(coordinator.getStore).mockImplementation(() => { throw error; });
    let laneResolved: unknown;
    let laneRejected: unknown;
    async function withUserStoreMutation<Result>(
      _scope: StoreIpcMutationScope,
      work: () => Result | Promise<Result>,
    ): Promise<Result> {
      try {
        const result = await work();
        laneResolved = result;
        return result;
      } catch (laneError) {
        laneRejected = laneError;
        throw laneError;
      }
    }
    registerStoreIpcHandlers(
      { handle: (registeredChannel, handler) => handlers.set(registeredChannel, handler) },
      coordinator,
      { withUserStoreMutation },
    );

    await expect(
      handlers.get('stores:switch')?.({}, { storeId: 'store-missing', marketplace: 'US' }),
    ).rejects.toBe(error);

    expect(laneRejected).toBeUndefined();
    expect(Object.isFrozen(laneResolved)).toBe(true);
    expect(coordinator.switchStore).not.toHaveBeenCalled();
  });

  it('keeps unknown coordinator failures inside the shared mutation lane', async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    const error = new Error('unexpected coordinator corruption');
    vi.mocked(coordinator.createStore).mockImplementation(() => { throw error; });
    let laneResolved: unknown;
    let laneRejected: unknown;
    async function withUserStoreMutation<Result>(
      _scope: StoreIpcMutationScope,
      work: () => Result | Promise<Result>,
    ): Promise<Result> {
      try {
        const result = await work();
        laneResolved = result;
        return result;
      } catch (laneError) {
        laneRejected = laneError;
        throw laneError;
      }
    }
    registerStoreIpcHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      coordinator,
      { withUserStoreMutation },
    );

    await expect(handlers.get('stores:create')?.({}, {
      displayName: 'Unknown failure',
      marketplace: 'US',
      currency: 'USD',
    })).rejects.toBe(error);

    expect(laneResolved).toBeUndefined();
    expect(laneRejected).toBe(error);
  });

  it('keeps a typed repository error outside the operation allowlist inside the lane', async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = createCoordinator();
    const error = new StoreRepositoryError(
      'MIGRATION_NOT_FOUND',
      'unexpected authority repository state',
    );
    vi.mocked(coordinator.createStore).mockImplementation(() => { throw error; });
    let laneResolved: unknown;
    let laneRejected: unknown;
    async function withUserStoreMutation<Result>(
      _scope: StoreIpcMutationScope,
      work: () => Result | Promise<Result>,
    ): Promise<Result> {
      try {
        const result = await work();
        laneResolved = result;
        return result;
      } catch (laneError) {
        laneRejected = laneError;
        throw laneError;
      }
    }
    registerStoreIpcHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      coordinator,
      { withUserStoreMutation },
    );

    await expect(handlers.get('stores:create')?.({}, {
      displayName: 'US Store',
      marketplace: 'US',
      currency: 'USD',
    })).rejects.toBe(error);

    expect(laneResolved).toBeUndefined();
    expect(laneRejected).toBe(error);
  });

  it.each([
    ['stores:switch', 'switchStore'],
    ['stores:reconnect', 'reconnectStore'],
  ] as const)(
    'keeps a post-commit typed readback failure from %s inside the shared mutation lane',
    async (channel, mutation) => {
      const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
      const coordinator = createCoordinator();
      const error = new StoreRepositoryError(
        'INVALID_STORE_INPUT',
        'workspace readback was inconsistent after generation advance',
      );
      vi.mocked(coordinator[mutation]).mockImplementation(() => { throw error; });
      let laneResolved: unknown;
      let laneRejected: unknown;
      async function withUserStoreMutation<Result>(
        _scope: StoreIpcMutationScope,
        work: () => Result | Promise<Result>,
      ): Promise<Result> {
        try {
          const result = await work();
          laneResolved = result;
          return result;
        } catch (laneError) {
          laneRejected = laneError;
          throw laneError;
        }
      }
      registerStoreIpcHandlers(
        { handle: (registeredChannel, handler) => handlers.set(registeredChannel, handler) },
        coordinator,
        { withUserStoreMutation },
      );

      await expect(
        handlers.get(channel)?.({}, {
          storeId: 'store-one',
          ...(channel === 'stores:switch' ? { marketplace: 'US' } : {}),
        }),
      ).rejects.toBe(error);

      expect(laneResolved).toBeUndefined();
      expect(laneRejected).toBe(error);
    },
  );

  it('keeps a recognized pre-mutation callback failure inside the shared mutation lane', async () => {
      const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
      const coordinator = createCoordinator();
      const error = new StoreCoordinatorError(
        'STORE_CONTEXT_MISMATCH',
        'runtime close proof failed',
      );
      let laneResolved: unknown;
      let laneRejected: unknown;
      async function withUserStoreMutation<Result>(
        _scope: StoreIpcMutationScope,
        work: () => Result | Promise<Result>,
      ): Promise<Result> {
        try {
          const result = await work();
          laneResolved = result;
          return result;
        } catch (laneError) {
          laneRejected = laneError;
          throw laneError;
        }
      }
      registerStoreIpcHandlers(
        { handle: (channel, handler) => handlers.set(channel, handler) },
        coordinator,
        {
          withUserStoreMutation,
          beforeActiveStoreMutation: async () => { throw error; },
        },
      );

      await expect(
        handlers.get('stores:switch')?.({}, { storeId: 'store-two', marketplace: 'US' }),
      ).rejects.toBe(error);

      expect(laneResolved).toBeUndefined();
      expect(laneRejected).toBe(error);
      expect(coordinator.switchStore).not.toHaveBeenCalled();
  });
});
