import type { SetStoreCollectionAutomationInput, StoreCollectionAutomationProjection, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';

export interface StoreCollectionAutomationRendererApi {
  getStoreCollectionAutomation(context: StoreContextEnvelope): Promise<StoreCollectionAutomationProjection>;
  setStoreCollectionAutomation(context: StoreContextEnvelope, input: SetStoreCollectionAutomationInput): Promise<StoreCollectionAutomationProjection>;
}

export function readStoreCollectionAutomationApi(target: unknown = globalThis): StoreCollectionAutomationRendererApi | null {
  const api = (target as { electronAPI?: Partial<StoreCollectionAutomationRendererApi> } | null)?.electronAPI;
  return typeof api?.getStoreCollectionAutomation === 'function' && typeof api.setStoreCollectionAutomation === 'function'
    ? api as StoreCollectionAutomationRendererApi : null;
}

export function assertStoreCollectionAutomationProjection(value: unknown, context: StoreContextEnvelope): asserts value is StoreCollectionAutomationProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('自动采集状态尚未得到确认，请重新读取。');
  const p = value as Record<string, unknown>;
  const keys = ['storeId', 'browserProfileId', 'automaticCollectionEnabled', 'source', 'revision', 'updatedAt'];
  if (Object.keys(p).length !== keys.length || keys.some(key => !Object.hasOwn(p, key))
    || p.storeId !== context.storeId || p.browserProfileId !== context.browserProfileId
    || typeof p.automaticCollectionEnabled !== 'boolean' || !Number.isSafeInteger(p.revision)) {
    throw new Error('自动采集状态不属于当前店铺或浏览器资料，请重新读取。');
  }
  if (p.source === 'legacy-default') {
    if (p.automaticCollectionEnabled !== true || p.revision !== 0 || p.updatedAt !== null) throw new Error('历史自动采集状态无效，已停止显示可操作状态。');
    return;
  }
  const time = typeof p.updatedAt === 'string' ? Date.parse(p.updatedAt) : NaN;
  if (p.source !== 'explicit-override' || (p.revision as number) < 1 || !Number.isFinite(time)
    || new Date(time).toISOString() !== p.updatedAt) throw new Error('已保存的自动采集状态无效，请重新读取。');
}
