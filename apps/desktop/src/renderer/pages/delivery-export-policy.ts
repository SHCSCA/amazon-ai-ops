import type { DeliveryReadinessView, OperationScope } from '../types';

export function canExportNonReadyDeliveryEvidence(readiness: DeliveryReadinessView | null, previewOnly = false): boolean {
  return Boolean(!previewOnly && readiness?.previewOnly !== true
    && readiness?.verificationProtocol === 'v16.current-publication/1'
    && readiness.available === true && readiness.exists === true && readiness.manifestDriven === true
    && readiness.status === 'APP_NEEDS_WORK' && readiness.appReady === false);
}

export interface CurrentDeliveryExportResult {
  success: boolean;
  status?: string;
  bundleDir?: string;
  manifestPath?: string;
  message?: string;
}

export async function exportNonReadyDeliveryEvidence(
  readiness: DeliveryReadinessView | null,
  previewOnly: boolean,
  scope: OperationScope,
  exportCurrentBundle: (scope: OperationScope) => Promise<CurrentDeliveryExportResult>,
): Promise<CurrentDeliveryExportResult> {
  if (!canExportNonReadyDeliveryEvidence(readiness, previewOnly)) throw new Error('请先在真实应用刷新当前验收，再导出未完成验收材料。');
  // 主进程重新核验当前原件；页面标识只决定是否显示入口。
  const result = await exportCurrentBundle({ ...scope });
  if (result.success && !['APP_NEEDS_WORK', 'APP_READY'].includes(result.status ?? '')) {
    throw new Error('导出结果缺少本次验收结论，请刷新验收后重试。');
  }
  return result;
}
