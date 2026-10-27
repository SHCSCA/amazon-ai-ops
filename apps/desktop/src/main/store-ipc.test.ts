import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { type StoreCoordinator } from './store-coordinator';
import {
  registerStoreIpcHandlers,
  STORE_IPC_CHANNELS,
} from './store-ipc';
import {
  activeContext,
  createCoordinator,
} from "./store-ipc.test-fixtures";

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
});
