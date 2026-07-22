import { describe, expect, it, vi } from 'vitest';
import type { StoreCoordinator } from './store-coordinator';
import { registerStoreIpcHandlers, STORE_IPC_CHANNELS } from './store-ipc';

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
      createConnection: vi.fn(),
      updateConnection: vi.fn(),
      removeConnection: vi.fn(),
      switchStore: vi.fn(() => ({ store: { storeId: 'store-one' }, context: { storeId: 'store-one' } })),
      reconnectStore: vi.fn(),
      getActiveStoreContext: vi.fn(() => null),
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
      createConnection: vi.fn(),
      updateConnection: vi.fn(),
      removeConnection: vi.fn(),
      switchStore: vi.fn(),
      reconnectStore: vi.fn(),
      getActiveStoreContext: vi.fn(),
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
});
