import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { DeliveryReadinessView } from './delivery-readiness-view';
import { StoreOperationScopeService } from './store-operation-scope-service';
import { getMainRuntimeContext } from './main-runtime-access';

export function handleGetDeliveryReadiness(): Promise<DeliveryReadinessView> {
  const mainRuntimeContext = getMainRuntimeContext();
  return mainRuntimeContext.deliveryRuntime.getReadiness();
}

export function handleGetStoragePaths() {
  const mainRuntimeContext = getMainRuntimeContext();
  return mainRuntimeContext.deliveryRuntime.getStoragePaths();
}

export function handleGetDeliveryEvidenceStatus(input?: unknown) {
  const mainRuntimeContext = getMainRuntimeContext();
  return mainRuntimeContext.deliveryRuntime.getEvidenceStatus(input);
}

export function normalizePersistedOperationScope(input: unknown) {
  const request = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const dateFrom = typeof request.dateFrom === 'string' ? request.dateFrom.trim() : '';
  const dateTo = typeof request.dateTo === 'string' ? request.dateTo.trim() : '';
  const storeName = typeof request.storeName === 'string' ? request.storeName.trim() : '';
  const marketplaceCode = typeof request.marketplaceCode === 'string' ? request.marketplaceCode.trim() : '';
  if (!dateFrom || !dateTo || !storeName || !marketplaceCode) {
    throw new Error('运营范围缺少日期、店铺或站点。');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    throw new Error('运营范围日期必须是 YYYY-MM-DD。');
  }
  if (dateFrom > dateTo) {
    throw new Error('运营范围开始日期不能晚于结束日期。');
  }
  return {
    dateFrom,
    dateTo,
    storeName,
    marketplaceCode,
    asin: typeof request.asin === 'string' && request.asin.trim() ? request.asin.trim() : undefined,
    batchId: typeof request.batchId === 'string' && request.batchId.trim() ? request.batchId.trim() : undefined,
    currency: 'USD' as const,
  };
}

export function currentStoreOperationScopeService(): StoreOperationScopeService {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.storeCoordinator || !mainRuntimeContext.state.configurationBus) {
    throw new Error('店铺级运营范围服务尚未初始化。');
  }
  return new StoreOperationScopeService({
    storeCoordinator: mainRuntimeContext.state.storeCoordinator,
    settings: mainRuntimeContext.state.configurationBus,
  });
}

export function handleGetOperationScope(contextInput?: unknown) {
  const mainRuntimeContext = getMainRuntimeContext();
  const context = contextInput ?? mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext();
  if (!context) return null;
  return currentStoreOperationScopeService().get(context as StoreContextEnvelope);
}

export function handleSaveOperationScope(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('保存运营范围需要 StoreContext 与 scope。');
  }
  const request = input as { storeContext?: unknown; scope?: unknown };
  if (!request.storeContext || !Object.prototype.hasOwnProperty.call(request, 'scope')) {
    throw new TypeError('保存运营范围需要 StoreContext 与 scope。');
  }
  return currentStoreOperationScopeService().save(
    request.storeContext as StoreContextEnvelope,
    request.scope,
  );
}

export function handleExportDeliveryBundle(input?: unknown) {
  const mainRuntimeContext = getMainRuntimeContext();
  return mainRuntimeContext.exportCurrentDeliveryBundle(input);
}

export function handleRefreshFinalReadiness(input?: { adReadbackPath?: string }) {
  const mainRuntimeContext = getMainRuntimeContext();
  return mainRuntimeContext.deliveryRuntime.refreshFinalReadiness(input);
}
