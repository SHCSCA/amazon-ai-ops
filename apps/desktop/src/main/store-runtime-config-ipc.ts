import type {
  ArchiveStoreRuntimeConfigInput,
  CreateStoreRuntimeConfigInput,
  RestoreStoreRuntimeConfigInput,
  StoreContextEnvelope,
  UpdateStoreRuntimeConfigInput,
} from '@amazon-ai-ops/shared-types';
import type { StoreRuntimeConfigService } from './store-runtime-config-service';

export const STORE_RUNTIME_CONFIG_IPC_CHANNELS = [
  'store-runtime-config:get',
  'store-runtime-config:create',
  'store-runtime-config:update',
  'store-runtime-config:archive',
  'store-runtime-config:restore',
] as const;

export interface StoreRuntimeConfigIpcRegistrar {
  handle(channel: string, listener: (event: unknown, input?: unknown) => unknown): void;
}
type StoreRuntimeConfigPort = Pick<
  StoreRuntimeConfigService,
  'get' | 'create' | 'update' | 'archive' | 'restore'
>;

type AuthorizedRequest<T = undefined> = {
  storeContext: StoreContextEnvelope;
  input: T;
};

export function registerStoreRuntimeConfigIpcHandlers(
  ipc: StoreRuntimeConfigIpcRegistrar,
  service: StoreRuntimeConfigPort,
  onChanged?: (context: StoreContextEnvelope) => void,
): void {
  ipc.handle('store-runtime-config:get', (_event, raw) => {
    const request = readAuthorizedRequest<undefined>(raw, false);
    return service.get(request.storeContext);
  });
  ipc.handle('store-runtime-config:create', (_event, raw) => {
    const request = readAuthorizedRequest<CreateStoreRuntimeConfigInput>(raw, true);
    const result = service.create(request.storeContext, request.input);
    onChanged?.(request.storeContext);
    return result;
  });
  ipc.handle('store-runtime-config:update', (_event, raw) => {
    const request = readAuthorizedRequest<UpdateStoreRuntimeConfigInput>(raw, true);
    const result = service.update(request.storeContext, request.input);
    onChanged?.(request.storeContext);
    return result;
  });
  ipc.handle('store-runtime-config:archive', (_event, raw) => {
    const request = readAuthorizedRequest<ArchiveStoreRuntimeConfigInput>(raw, true);
    const result = service.archive(request.storeContext, request.input);
    onChanged?.(request.storeContext);
    return result;
  });
  ipc.handle('store-runtime-config:restore', (_event, raw) => {
    const request = readAuthorizedRequest<RestoreStoreRuntimeConfigInput>(raw, true);
    const result = service.restore(request.storeContext, request.input);
    onChanged?.(request.storeContext);
    return result;
  });
}

function readAuthorizedRequest<T>(value: unknown, requireInput: boolean): AuthorizedRequest<T> {
  const request = asObject(value, 'store runtime config IPC request');
  const storeContext = asObject(request.storeContext, 'storeContext') as unknown as StoreContextEnvelope;
  if (!requireInput) return { storeContext, input: undefined as T };
  return {
    storeContext,
    input: asObject(request.input, 'input') as T,
  };
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}
