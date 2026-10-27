import type { AiDiagnosisRunView, BusinessDataPipeline, DeliveryEvidenceStatusView, DeliveryReadinessView, OperationScope, RecommendationView } from '../types';
import type { StoreContextEnvelope, StoreRuntimeConfigProjection } from '@amazon-ai-ops/shared-types';
import { assertStoreRuntimeConfigProjection } from '../store-runtime-config-projection';
import { rendererRuntimeLog } from '../runtime-log';

export interface DeliveryLoadedState {
  data: BusinessDataPipeline | null;
  readiness: DeliveryReadinessView | null;
  settings?: Record<string, unknown> | null;
  runs: AiDiagnosisRunView[];
  pending: RecommendationView[];
  needsReview: RecommendationView[];
  approved: RecommendationView[];
  evidence: DeliveryEvidenceStatusView | null;
  notes: string[];
}

export async function loadDeliveryState(
  api: Record<string, any>, scope: OperationScope & { storeContext: StoreContextEnvelope }, isCurrent: () => boolean,
): Promise<DeliveryLoadedState | null> {
  const state: DeliveryLoadedState = { data: null, readiness: null, runs: [], pending: [], needsReview: [], approved: [], evidence: null, notes: [] };
  // 每次续链先核对世代，旧范围读取不得继续触发当前店铺的后续 IPC。
  if (!isCurrent()) return null;
  let businessDataReadable = false;
  if (typeof api.getStoreRuntimeConfig === 'function') {
    const projection = await api.getStoreRuntimeConfig({ ...scope.storeContext }) as StoreRuntimeConfigProjection;
    if (!isCurrent()) return null;
    assertStoreRuntimeConfigProjection(projection, scope.storeContext);
    businessDataReadable = projection.current !== null;
    if (!businessDataReadable) {
      rendererRuntimeLog.warn('delivery.business_data_unavailable', {
        reason: 'STORE_RUNTIME_CONFIG_MISSING', storeId: scope.storeContext.storeId,
      });
      state.notes.push('当前店铺还没有运行配置，业务数据状态未知；请先到“系统设置”创建当前店铺运行配置。最终验收仍以实际核验原件为准。');
    }
  } else {
    rendererRuntimeLog.warn('delivery.business_data_unavailable', {
      reason: 'STORE_RUNTIME_CONFIG_API_UNAVAILABLE', storeId: scope.storeContext.storeId,
    });
    state.notes.push('店铺配置读取能力未连接，业务数据状态未知；请重新启动最新桌面应用。');
  }
  if (businessDataReadable && typeof api.getBusinessUiDataPipeline === 'function') {
    state.data = await api.getBusinessUiDataPipeline(scope);
    if (!isCurrent()) return null;
  } else if (businessDataReadable) state.notes.push('数据管道能力未连接，请重新启动应用后重试。');
  if (typeof api.getDeliveryReadiness === 'function') {
    state.readiness = await api.getDeliveryReadiness();
    if (!isCurrent()) return null;
  } else state.notes.push('最终验收能力未连接，请重新启动应用后重试。');
  if (typeof api.getSettings === 'function') {
    state.settings = await api.getSettings();
    if (!isCurrent()) return null;
  }
  const filter = { ...scope, batchId: scope.batchId || state.data?.collection?.latestBatch?.id };
  if (typeof api.listAiDiagnosisRuns === 'function') {
    const runs = await api.listAiDiagnosisRuns({ ...filter, limit: 5 });
    if (!isCurrent()) return null;
    state.runs = Array.isArray(runs) ? runs : [];
  }
  if (typeof api.getRecommendations === 'function') {
    const [pending, needsReview, approved] = await Promise.all(['pending', 'needs_review', 'approved']
      .map(status => api.getRecommendations({ ...filter, limit: 20, status })));
    if (!isCurrent()) return null;
    state.pending = Array.isArray(pending) ? pending : [];
    state.needsReview = Array.isArray(needsReview) ? needsReview : [];
    state.approved = Array.isArray(approved) ? approved : [];
  }
  if (typeof api.getDeliveryEvidenceStatus === 'function') {
    state.evidence = await api.getDeliveryEvidenceStatus(scope);
    if (!isCurrent()) return null;
  }
  return state;
}

