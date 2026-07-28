import { describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { StoreCoordinator } from './store-coordinator';
import { registerStoreIpcHandlers, STORE_IPC_CHANNELS } from './store-ipc';

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
    getStore: vi.fn(),
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
  } as unknown as StoreCoordinator;
}

describe('store IPC boundary', () => {
  it('registers only logical store CRUD/context channels and emits switch results', () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = {
      listStores: vi.fn(() => []),
      getStore: vi.fn(),
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
    } as unknown as StoreCoordinator;
    const onStoreChanged = vi.fn();

    registerStoreIpcHandlers({
      handle: (channel, handler) => handlers.set(channel, handler),
    }, coordinator, { onStoreChanged });

    expect([...handlers.keys()]).toEqual(STORE_IPC_CHANNELS);
    expect([...handlers.keys()].some((channel) => /path|profile|cookie|password/i.test(channel))).toBe(false);
    const result = handlers.get('stores:switch')?.({}, { storeId: 'store-one' });
    expect(coordinator.switchStore).toHaveBeenCalledWith('store-one');
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
    } as unknown as StoreCoordinator;
    registerStoreIpcHandlers({ handle: (channel, handler) => handlers.set(channel, handler) }, coordinator);

    expect(() => handlers.get('stores:create')?.({}, 'C:\\renderer-controlled')).toThrow(/object/);
    expect(coordinator.createStore).not.toHaveBeenCalled();
  });

  it('rebuilds connection commands from an explicit Renderer-safe field allowlist', () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const coordinator = {
      listStores: vi.fn(),
      getStore: vi.fn(),
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
      id: 'capability-one',
      storeId: 'store-one',
      provider: 'lingxing',
      accountLabel: 'operator@example.com',
      externalAccountId: 'external-one',
      status: 'ready',
      lastVerifiedAt: 'forged',
      lastFailureCode: 'forged',
    };

    handlers.get('stores:connections:create')?.({}, forged);
    handlers.get('stores:connections:update')?.({}, forged);
    handlers.get('stores:connections:remove')?.({}, forged);

    expect(coordinator.createConnection).toHaveBeenCalledWith({
      storeId: 'store-one',
      provider: 'lingxing',
      accountLabel: 'operator@example.com',
      externalAccountId: 'external-one',
    });
    expect(coordinator.updateConnection).toHaveBeenCalledWith({
      id: 'capability-one',
      storeId: 'store-one',
      accountLabel: 'operator@example.com',
      externalAccountId: 'external-one',
    });
    expect(coordinator.removeConnection).toHaveBeenCalledWith({
      id: 'capability-one',
      storeId: 'store-one',
    });
  });

  it.each([
    ['stores:switch', { storeId: 'store-two' }, 'switchStore'],
    ['stores:reconnect', { storeId: 'store-one' }, 'reconnectStore'],
    ['stores:connections:create', {
      storeId: 'store-one', provider: 'lingxing', accountLabel: 'operator', externalAccountId: 'external-one',
    }, 'createConnection'],
    ['stores:connections:update', {
      id: 'connection-one', storeId: 'store-one', accountLabel: 'operator', externalAccountId: 'external-one',
    }, 'updateConnection'],
    ['stores:connections:remove', {
      id: 'connection-one', storeId: 'store-one',
    }, 'removeConnection'],
  ] as const)('runs the active execution guard before %s mutates coordinator state', (
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

    handlers.get(channel)?.({}, input);

    expect(beforeActiveStoreMutation).toHaveBeenCalledWith(activeContext, channel);
    const coordinatorMutation = coordinator[mutation] as ReturnType<typeof vi.fn>;
    expect(beforeActiveStoreMutation.mock.invocationCallOrder[0])
      .toBeLessThan(coordinatorMutation.mock.invocationCallOrder[0]);
  });

  it.each([
    ['stores:switch', { storeId: 'store-two' }, 'switchStore'],
    ['stores:reconnect', { storeId: 'store-one' }, 'reconnectStore'],
    ['stores:connections:create', {
      storeId: 'store-one', provider: 'amazon_ads', accountLabel: 'operator', externalAccountId: 'external-one',
    }, 'createConnection'],
    ['stores:connections:update', {
      id: 'connection-one', storeId: 'store-one', accountLabel: 'operator', externalAccountId: 'external-one',
    }, 'updateConnection'],
    ['stores:connections:remove', {
      id: 'connection-one', storeId: 'store-one',
    }, 'removeConnection'],
  ] as const)('does not mutate coordinator state when the active execution guard rejects %s', (
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

    expect(() => handlers.get(channel)?.({}, input)).toThrow('execution batch is active');
    expect(coordinator[mutation]).not.toHaveBeenCalled();
  });
});
