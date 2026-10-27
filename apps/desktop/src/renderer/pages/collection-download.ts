import { rendererRuntimeLog } from '../runtime-log';
import React from 'react';
import { toUserFacingError } from '../user-facing-error';
import { type CollectionActionMode, type CollectionDownloadApi, type DownloadCollectionActionMode, type CollectionDateRange } from './collection-contracts';

export function rawErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

export function collectionActionError(mode: Exclude<CollectionActionMode, 'import'>, error: unknown): string {
  const raw = rawErrorMessage(error);
  if (!raw) return '采集未完成。';

  if (/IDENTITY_UNVERIFIED|Lingxing page identity is unverified|identity verification.*Lingxing/i.test(raw)) {
    return '领星当前页面身份尚未确认：请保持当前店铺的领星浏览器打开，确认已登录且页面属于当前店铺，然后重试采集。';
  }

  if (/browser session is not ready|请先启动并登录领星|not logged in|browser_session_ready/i.test(raw)) {
    return '领星浏览器会话未就绪：请先在本应用完成 ERP 登录，并从 ERP 广告入口进入 Ads 后重试。';
  }

  if (/requires manual verification|page_model_ready/i.test(raw)) {
    return '页面模型仍未放行：请先点击“验证页面”，完成当前日期、店铺、站点下的页面诊断和单报表验证后再采集。';
  }

  if (/diagnostic_evidence_ready|diagnostic evidence|no matching download-center diagnostic/i.test(raw)) {
    return mode === 'download-existing'
      ? '下载已创建报表前，需要先验证当前范围的下载中心页面。请点击“验证页面”，确认日期、店铺、站点和领星页面一致后再下载。'
      : '重新创建报表前，需要先验证当前范围的下载中心页面。请点击“验证页面”，刷新截图、DOM 和页面模型证据后再创建。';
  }

  if (/唯一业务窗口不一致|采集窗口与当前店铺不一致/i.test(raw)) {
    return '当前页面范围已过期：系统已阻断本次采集。请刷新当前店铺，待页面同步最新采集日期后重试。';
  }

  if (/(missing|not found|缺少|没有|未找到|不存在)/i.test(raw) && /(report|file|path|batch|报表|文件|路径|批次)/i.test(raw)) {
    return mode === 'download-existing'
      ? '当前范围没有可直接下载的已创建报表；本动作不会创建新任务。若你确认领星已经创建完成，请先点击“验证页面”刷新下载中心证据，并确认日期、店铺、站点一致；否则使用“重新获取完整 8 类报表”。'
      : '重新创建后仍没有拿到可用的真实报表文件。请确认领星 Ads 下载中心可访问、页面模型已验证、日期/店铺/站点正确，再重新创建。';
  }

  if (/timeout|ready|wait/i.test(raw)) {
    return mode === 'download-existing'
      ? '已找到下载流程但没有等到可下载状态。请在领星下载中心确认报表为“已创建/ready/可下载”，再点“下载已创建报表”。'
      : '报表任务已尝试创建，但没有等到生成完成。请稍后重试，或在领星下载中心确认任务状态。';
  }

  return toUserFacingError(error, '采集未完成。');
}

export function shouldOfferDownloadCenterVerification(message?: string | null): boolean {
  if (!message) return false;
  return /(验证页面|下载中心页面|页面模型|诊断证据|diagnostic evidence|download-center diagnostic|ready 行|报表范围)/i.test(message);
}

export function shouldAutoVerifyBeforeCollection(message?: string | null): boolean {
  if (!message) return false;
  return /(需要先验证当前范围的下载中心页面|页面模型仍未放行|诊断证据|diagnostic evidence|download-center diagnostic|no matching download-center diagnostic|下载中心页面模型缺少)/i.test(message);
}

export async function invokeCollectionDownloadAction(input: {
  api: CollectionDownloadApi;
  mode: DownloadCollectionActionMode;
  dateRange: CollectionDateRange;
  targetTypes: string[];
}): Promise<any[]> {
  const { api, mode, dateRange, targetTypes } = input;
  if (mode === 'download-existing') {
    if (!api.downloadExistingLingxingReports) {
      throw new Error('领星已创建报表下载接口未暴露，请检查 preload IPC。');
    }
    return [await api.downloadExistingLingxingReports(dateRange, targetTypes)];
  }
  if (mode === 'recreate-full') {
    if (!api.collectLingxingReports) {
      throw new Error('领星完整报表采集接口未暴露，请检查 preload IPC。');
    }
    return [await api.collectLingxingReports(dateRange)];
  }
  if (!api.retryLingxingReport) {
    throw new Error('领星单报表重建接口未暴露，请检查 preload IPC。');
  }
  const results: any[] = [];
  for (const reportType of targetTypes) {
    results.push(await api.retryLingxingReport(dateRange, reportType));
  }
  return results;
}

export async function runCollectionDownloadAction(input: {
  api: CollectionDownloadApi;
  mode: DownloadCollectionActionMode;
  dateRange: CollectionDateRange;
  targetTypes: string[];
  onAutoVerifyStart?: () => void;
  onDiagnostic?: (diagnostic: any) => void;
  onAutoVerifyReady?: (diagnostic: any) => void;
}): Promise<{ actionResults: any[]; diagnostic?: any; autoVerified: boolean }> {
  try {
    return {
      actionResults: await invokeCollectionDownloadAction(input),
      autoVerified: false,
    };
  } catch (caught) {
      rendererRuntimeLog.error('collection.collection_download_failed', { error: caught });
    const message = collectionActionError(input.mode, caught);
    if (!shouldAutoVerifyBeforeCollection(message) || !input.api.diagnoseLingxingDownloadCenter) {
      throw caught;
    }

    input.onAutoVerifyStart?.();
    const diagnostic = await input.api.diagnoseLingxingDownloadCenter(input.dateRange);
    input.onDiagnostic?.(diagnostic);
    if (!diagnostic?.ready) {
      const reason = diagnostic?.errorMessage
        || (Array.isArray(diagnostic?.missingRequiredSelectors) && diagnostic.missingRequiredSelectors.length
          ? `缺少关键控件：${diagnostic.missingRequiredSelectors.join('、')}`
          : '页面模型还未匹配当前下载中心');
      throw new Error(`页面验证未通过：${reason}`);
    }

    input.onAutoVerifyReady?.(diagnostic);
    return {
      actionResults: await invokeCollectionDownloadAction(input),
      diagnostic,
      autoVerified: true,
    };
  }
}
