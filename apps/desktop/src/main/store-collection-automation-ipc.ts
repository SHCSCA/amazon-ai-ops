import { assertStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { RuntimeLogPort, SetStoreCollectionAutomationInput, StoreCollectionAutomationProjection, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { STORE_COLLECTION_AUTOMATION_IPC_CHANNELS } from '../shared/store-collection-automation-ipc';

export interface StoreCollectionAutomationIpcPort {
  get(context: StoreContextEnvelope): StoreCollectionAutomationProjection;
  set(context: StoreContextEnvelope, input: SetStoreCollectionAutomationInput): StoreCollectionAutomationProjection;
}

export interface StoreCollectionAutomationIpcRegistrar {
  handle(channel: string, listener: (event: unknown, input?: unknown) => unknown): void;
}

export function registerStoreCollectionAutomationIpcHandlers(
  ipc: StoreCollectionAutomationIpcRegistrar,
  service: StoreCollectionAutomationIpcPort,
  logger: Pick<RuntimeLogPort, 'error'>,
  onChanged?: (context: StoreContextEnvelope) => void,
): void {
  for (const channel of STORE_COLLECTION_AUTOMATION_IPC_CHANNELS) {
    ipc.handle(channel, (_event, raw) => {
      try {
        const mutation = channel === 'store-collection-automation:set';
        const request = exactObject(raw, mutation ? ['storeContext', 'input'] : ['storeContext']);
        const context = exactObject(request.storeContext, [
          'storeId', 'browserProfileId', 'marketplace', 'currency', 'businessTimezone', 'businessDate', 'sessionGeneration',
        ]);
        assertStoreContextEnvelope(context);
        if (!mutation) return service.get({ ...context });
        const input = exactObject(request.input, ['expectedRevision', 'automaticCollectionEnabled']);
        if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0
          || typeof input.automaticCollectionEnabled !== 'boolean') throw new TypeError('自动采集开关的版本或启用值无效。');
        const authorizedContext = { ...context };
        const result = service.set(authorizedContext, {
          expectedRevision: input.expectedRevision as number,
          automaticCollectionEnabled: input.automaticCollectionEnabled,
        });
        onChanged?.(authorizedContext);
        return result;
      } catch (error) {
        try { logger.error('main.store_collection_automation_ipc_failed', { channel, error }); }
        catch (loggingError) { throw new AggregateError([error, loggingError], '自动采集 IPC 错误日志写入失败。'); }
        throw error;
      }
    });
  }
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError('自动采集请求包含缺失或不支持的字段。');
  }
  return value as Record<string, unknown>;
}
