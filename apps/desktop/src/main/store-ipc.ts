import type {
  ArchiveStoreInput,
  CreateStoreConnectionInput,
  CreateStoreInput,
  ListStoresInput,
  RestoreStoreInput,
  RemoveStoreConnectionInput,
  StoreContextEnvelope,
  StoreRecord,
  StoreWorkspaceView,
  UpdateStoreConnectionInput,
  UpdateStoreInput,
} from '@amazon-ai-ops/shared-types';
import type { StoreCoordinator } from './store-coordinator';

export const STORE_IPC_CHANNELS = [
  'stores:list',
  'stores:get',
  'stores:create',
  'stores:update',
  'stores:archive',
  'stores:restore',
  'stores:connections:create',
  'stores:connections:update',
  'stores:connections:remove',
  'stores:switch',
  'stores:reconnect',
  'stores:get-active-context',
] as const;

export interface IpcHandlerRegistrar {
  handle(channel: string, listener: (event: unknown, input?: unknown) => unknown): void;
}

export interface StoreIpcEvents {
  onStoreChanged?(view: StoreWorkspaceView): void;
  onStoreRecordChanged?(store: StoreRecord): void;
}

export function registerStoreIpcHandlers(
  ipc: IpcHandlerRegistrar,
  coordinator: StoreCoordinator,
  events: StoreIpcEvents = {},
): void {
  ipc.handle('stores:list', (_event, input) =>
    coordinator.listStores(asOptionalObject(input) as ListStoresInput | undefined));
  ipc.handle('stores:get', (_event, input) => coordinator.getStore(readStoreId(input)));
  ipc.handle('stores:create', (_event, input) => {
    const store = coordinator.createStore(asObject(input) as unknown as CreateStoreInput);
    events.onStoreRecordChanged?.(store);
    return store;
  });
  ipc.handle('stores:update', (_event, input) => {
    const store = coordinator.updateStore(asObject(input) as unknown as UpdateStoreInput);
    events.onStoreRecordChanged?.(store);
    return store;
  });
  ipc.handle('stores:archive', (_event, input) => {
    const store = coordinator.archiveStore(asObject(input) as unknown as ArchiveStoreInput);
    events.onStoreRecordChanged?.(store);
    return store;
  });
  ipc.handle('stores:restore', (_event, input) => {
    const store = coordinator.restoreStore(asObject(input) as unknown as RestoreStoreInput);
    events.onStoreRecordChanged?.(store);
    return store;
  });
  ipc.handle('stores:connections:create', (_event, input) =>
    coordinator.createConnection(readCreateConnectionInput(input)));
  ipc.handle('stores:connections:update', (_event, input) =>
    coordinator.updateConnection(readUpdateConnectionInput(input)));
  ipc.handle('stores:connections:remove', (_event, input) => {
    coordinator.removeConnection(readRemoveConnectionInput(input));
    return { success: true };
  });
  ipc.handle('stores:switch', (_event, input) => {
    const view = coordinator.switchStore(readStoreId(input));
    events.onStoreChanged?.(view);
    return view;
  });
  ipc.handle('stores:reconnect', (_event, input) => {
    const view = coordinator.reconnectStore(readStoreId(input));
    events.onStoreChanged?.(view);
    return view;
  });
  ipc.handle('stores:get-active-context', (): StoreContextEnvelope | null =>
    coordinator.getActiveStoreContext());
}

function readStoreId(value: unknown): unknown {
  if (typeof value === 'string') return value;
  return asObject(value).storeId;
}

function readCreateConnectionInput(value: unknown): CreateStoreConnectionInput {
  const input = asObject(value);
  return {
    storeId: input.storeId as CreateStoreConnectionInput['storeId'],
    provider: input.provider as CreateStoreConnectionInput['provider'],
    accountLabel: input.accountLabel as CreateStoreConnectionInput['accountLabel'],
    externalAccountId: input.externalAccountId as CreateStoreConnectionInput['externalAccountId'],
  };
}

function readUpdateConnectionInput(value: unknown): UpdateStoreConnectionInput {
  const input = asObject(value);
  return {
    id: input.id as UpdateStoreConnectionInput['id'],
    storeId: input.storeId as UpdateStoreConnectionInput['storeId'],
    accountLabel: input.accountLabel as UpdateStoreConnectionInput['accountLabel'],
    externalAccountId: input.externalAccountId as UpdateStoreConnectionInput['externalAccountId'],
  };
}

function readRemoveConnectionInput(value: unknown): RemoveStoreConnectionInput {
  const input = asObject(value);
  return {
    id: input.id as RemoveStoreConnectionInput['id'],
    storeId: input.storeId as RemoveStoreConnectionInput['storeId'],
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('store IPC input must be an object');
  }
  return value as Record<string, unknown>;
}

function asOptionalObject(value: unknown): Record<string, unknown> | undefined {
  return value === undefined ? undefined : asObject(value);
}
