import type { DownloadCenterActionSelectors, DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';

const ALLOWED_DOWNLOAD_CENTER_HOSTS = new Set(['lingxing.com', 'www.lingxing.com', 'erp.lingxing.com', 'ads.lingxing.com']);

export function selectorUsesReportScope(selector: string): boolean {
  return selector.includes('{reportType}')
    || selector.includes('{reportName}')
    || selector.includes('{expectedFilenameKeyword}')
    || selector.includes('{generatedReportName}');
}

export function selectorUsesDateScope(selector: string): boolean {
  return selector.includes('{dateStart}')
    || selector.includes('{dateEnd}')
    || selector.includes('{dateRange}');
}

export function validateDownloadCenterPageModel(value: unknown): asserts value is DownloadCenterPageModel {
  if (!value || typeof value !== 'object') {
    throw new Error('下载中心页面模型必须是 JSON 对象');
  }
  const model = value as DownloadCenterPageModel;
  if (model.name !== 'lingxing-download-center') {
    throw new Error('下载中心页面模型 name 必须是 lingxing-download-center');
  }
  if (typeof model.description !== 'string' || model.description.length > 500) {
    throw new Error('下载中心页面模型 description 无效');
  }
  validateDownloadCenterCandidateUrls(model.candidateUrls);
  validateStringArray(model.entryHints, 'entryHints', 50, 100);
  validateStringArray(model.reportNames, 'reportNames', 50, 100);
  if (!Array.isArray(model.verifySelectors) || model.verifySelectors.length > 50) {
    throw new Error('verifySelectors 必须是长度不超过 50 的数组');
  }
  for (const hint of model.verifySelectors) {
    if (!hint || typeof hint.name !== 'string' || !hint.name.trim() || hint.name.length > 100) {
      throw new Error('verifySelectors.name 无效');
    }
    if (typeof hint.selector !== 'string' || !hint.selector.trim() || hint.selector.length > 500) {
      throw new Error(`verifySelectors.${hint.name}.selector 无效`);
    }
    if (hint.required !== undefined && typeof hint.required !== 'boolean') {
      throw new Error(`verifySelectors.${hint.name}.required 必须是布尔值`);
    }
  }
  if (typeof model.requiresManualVerification !== 'boolean') {
    throw new Error('requiresManualVerification 必须是布尔值');
  }
  validateDownloadCenterActionSelectors(model.actionSelectors, model.requiresManualVerification);
}

function validateDownloadCenterCandidateUrls(value: unknown): asserts value is string[] {
  validateStringArray(value, 'candidateUrls', 10, 500);
  for (const rawUrl of value) {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error(`candidateUrls 包含无效 URL：${rawUrl}`);
    }
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !ALLOWED_DOWNLOAD_CENTER_HOSTS.has(hostname)) {
      throw new Error(`candidateUrls 只允许 HTTPS 领星域名：${rawUrl}`);
    }
  }
}

function validateStringArray(value: unknown, name: string, maxLength: number, maxItemLength: number): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxLength) {
    throw new Error(`${name} 必须是 1-${maxLength} 项字符串数组`);
  }
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || item.length > maxItemLength) {
      throw new Error(`${name} 包含无效字符串`);
    }
  }
}

function validateDownloadCenterActionSelectors(
  selectors: DownloadCenterActionSelectors | undefined,
  requiresManualVerification: boolean,
): void {
  if (!selectors) {
    if (!requiresManualVerification) {
      throw new Error('关闭人工验证前必须提供 actionSelectors');
    }
    return;
  }
  for (const [key, value] of Object.entries(selectors)) {
    if (value === undefined || value === '') continue;
    if (key === 'readyTimeoutMs' || key === 'downloadTimeoutMs') {
      if (!Number.isInteger(value) || Number(value) < 1000 || Number(value) > 1800000) {
        throw new Error(`${key} 必须是 1000-1800000 之间的整数毫秒`);
      }
      continue;
    }
    if (typeof value !== 'string' || value.length > 1000) {
      throw new Error(`actionSelectors.${key} 无效`);
    }
  }
  if (!requiresManualVerification) {
    for (const key of ['dateStartInput', 'dateEndInput', 'createReportButton', 'readyReportSelector', 'downloadButton'] as const) {
      if (typeof selectors[key] !== 'string' || !selectors[key].trim()) {
        throw new Error(`关闭人工验证前必须填写 actionSelectors.${key}`);
      }
    }
    for (const key of ['readyReportSelector', 'statusTextSelector', 'downloadButton'] as const) {
      const selector = selectors[key];
      if (!selector) continue;
      if (!selectorUsesReportScope(selector)) {
        throw new Error(`关闭人工验证前 actionSelectors.${key} 必须包含 {reportName}、{reportType}、{expectedFilenameKeyword} 或 {generatedReportName} 占位符`);
      }
      if (!selectorUsesDateScope(selector)) {
        throw new Error(`关闭人工验证前 actionSelectors.${key} 必须包含 {dateStart}、{dateEnd} 或 {dateRange} 占位符，避免匹配旧报表`);
      }
    }
  }
}
