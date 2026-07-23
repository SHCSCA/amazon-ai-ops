import type {
  StoreCollectionScheduleRequest,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type { StoreCollectionScheduler } from './store-collection-scheduler';

export const STORE_COLLECTION_SCHEDULER_IPC_CHANNELS = [
  'store-collection-scheduler:get',
  'store-collection-scheduler:run-now',
] as const;

export interface StoreCollectionSchedulerIpcRegistrar {
  handle(channel: string, listener: (event: unknown, input?: unknown) => unknown): void;
}

type StoreCollectionSchedulerPort = Pick<StoreCollectionScheduler, 'get' | 'runNow'>;

export function registerStoreCollectionSchedulerIpcHandlers(
  ipc: StoreCollectionSchedulerIpcRegistrar,
  scheduler: StoreCollectionSchedulerPort,
): void {
  ipc.handle('store-collection-scheduler:get', (_event, raw) => {
    const request = readRequest(raw);
    return scheduler.get(request.storeContext);
  });
  ipc.handle('store-collection-scheduler:run-now', (_event, raw) => {
    const request = readRequest(raw);
    return scheduler.runNow(request.storeContext);
  });
}

function readRequest(value: unknown): StoreCollectionScheduleRequest {
  const request = asObject(value, 'store collection scheduler IPC request');
  const unknown = Object.keys(request).filter((key) => key !== 'storeContext');
  if (unknown.length > 0) {
    throw new TypeError(`store collection scheduler IPC request contains unsupported fields: ${unknown.join(', ')}`);
  }
  return {
    storeContext: asObject(request.storeContext, 'storeContext') as unknown as StoreContextEnvelope,
  };
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}
