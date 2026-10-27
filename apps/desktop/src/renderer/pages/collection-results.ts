import React from 'react';
import { sanitizeCausalExportText, type LingxingCollectionJobSnapshot } from '@amazon-ai-ops/shared-types';
import { toUserFacingError } from '../user-facing-error';
import { DEFAULT_BUSINESS_REPORT_OPTIONS } from '../components/business-data';
import { buildDataReadinessLedger, type DataReadinessLedger } from '../data-readiness-ledger';
import { type CollectionActionMode, type LastActionResult } from './collection-contracts';
import { getFileExtension, actionResultTitle } from './collection-presentation';

export function collectionActionNextStep(input: {
  canEnterDiagnosis: boolean;
  failedWithoutFiles: boolean;
  hasImportedReceipt?: boolean;
  actionImportState?: NonNullable<LingxingCollectionJobSnapshot['importState']> | 'mixed';
  actionReportTypeCount?: number;
  importedRows: number;
  realFileCount: number;
}): string {
  if (input.failedWithoutFiles) {
    return '下一步：查看失败原因和本次采集清单，确认领星 ready 行、页面模型、日期/店铺/站点后再重试。';
  }
  if (input.actionImportState === 'mixed') {
    return '下一步：刷新当前店铺的采集任务，检查每类报表的入库状态；状态一致前保持生产阻断。';
  }
  if (input.canEnterDiagnosis) {
    return '下一步：查看广告表现，复核 ACOS、花费和订单口径。';
  }
  if (input.actionImportState === 'not_applicable'
    && Number(input.actionReportTypeCount || 0) > 0
    && Number(input.actionReportTypeCount || 0) < 8) {
    return '下一步：继续原完整 8 类任务，或重新获取当前范围的完整 8 类；不会跨批次拼接生产指标。';
  }
  if (input.importedRows > 0 || input.hasImportedReceipt) {
    return '下一步：刷新当前范围数据账本；只有完整 8 类逐类入库后才会放行正式诊断。';
  }
  if (input.realFileCount > 0) {
    return '下一步：点击“导入已下载表格”，把本地表格写入广告指标。';
  }
  return '下一步：检查下载中心页面、报表 ready 状态或失败报表后重试。';
}

export function buildPipelineReadiness(
  pipeline: any,
  fallbackReportOptions: typeof DEFAULT_BUSINESS_REPORT_OPTIONS,
  realFileCount: number,
  importedRows: number,
): DataReadinessLedger {
  const collection = pipeline?.collection;
  const pipelineReportOptions = Array.isArray(collection?.reportOptions) && collection.reportOptions.length > 0
    ? collection.reportOptions
    : fallbackReportOptions;
  return buildDataReadinessLedger({
    requiredReportCount: 8,
    reportOptions: pipelineReportOptions,
    realReportFileCount: realFileCount,
    importedRowCount: importedRows,
    rejectedEvidenceFileCount: Number(collection?.fileAudit?.rejectedEvidenceFileCount || 0),
  });
}

export function buildLastActionResult(
  mode: CollectionActionMode,
  results: any[],
  realFileCount: number,
  importedRows: number,
  fallbackArtifacts?: { downloadArtifactId?: string; manifestArtifactId?: string },
  canEnterDiagnosis = false,
): LastActionResult {
  const files = results.flatMap((result) => Array.isArray(result?.files) ? result.files : []);
  const actionImportStates = Array.from(new Set(results
    .map((result) => result?.job?.importState ?? result?.importState)
    .filter((state): state is NonNullable<LingxingCollectionJobSnapshot['importState']> => (
      state === 'pending'
      || state === 'succeeded'
      || state === 'failed'
      || state === 'not_applicable'
    ))));
  const actionImportState: LastActionResult['actionImportState'] = actionImportStates.length === 1
    ? actionImportStates[0]
    : actionImportStates.length > 1 ? 'mixed' : undefined;
  const actionReportTypes = Array.from(new Set(results.flatMap((result) => (
    Array.isArray(result?.job?.request?.reportTypes) ? result.job.request.reportTypes : []
  )).map((reportType) => String(reportType || '').trim()).filter(Boolean)));
  const actionReportTypeCount = actionReportTypes.length > 0 ? actionReportTypes.length : undefined;
  const batchIds = Array.from(new Set(results.map((result) => result?.batch?.id).filter(Boolean)));
  const fileFailures = files
    .filter((file) => file?.status === 'failed' || file?.errorMessage)
    .map((file) => ({
      label: sanitizeCausalExportText(String(file?.displayName || file?.reportType || '未知报表')),
      reason: toUserFacingError(new Error(String(file?.errorMessage || '领星未返回可下载文件')), '报表处理失败，请查看诊断详情后重试。'),
    }));
  const importFailures = results
    .flatMap((result) => Array.isArray(result?.metricsImport?.errors) ? result.metricsImport.errors : [])
    .map((item) => ({
      label: sanitizeCausalExportText(String(item?.reportType || '导入错误')),
      reason: toUserFacingError(new Error(String(item?.message || item?.error || '真实报表未解析出广告指标行')), '报表导入失败，请核对文件后重试。'),
    }));
  const failedFiles = [...fileFailures, ...importFailures];
  const actionDownloadedFiles = files
    .filter((file) => file?.status === 'downloaded' && file?.artifactId)
    .filter((file) => ['.xlsx', '.xls', '.csv'].includes(getFileExtension(String(file?.fileName || ''), String(file?.fileExtension || ''))))
    .map((file) => ({
      label: String(file?.displayName || file?.reportType || '未知报表'),
      fileName: String(file?.fileName || file?.artifactDisplayName || file?.displayName || ''),
      fileExtension: getFileExtension(String(file?.fileName || ''), String(file?.fileExtension || '')),
      artifactId: String(file?.artifactId || ''),
      fileSizeBytes: Number(file?.fileSizeBytes || 0),
    }));
  const metricsImports = results.map((result) => result?.metricsImport).filter(Boolean);
  const insertedRows = metricsImports.reduce((sum, item) => sum + Number(item?.inserted || 0), 0);
  const parsedFiles = metricsImports.reduce((sum, item) => sum + Number(item?.parsedFiles || 0), 0);
  const downloadedCount = realFileCount;
  const actionRealDownloadCount = actionDownloadedFiles.length;
  const failedCount = failedFiles.length;
  const firstBatch = results.find((result) => result?.batch)?.batch;
  const nextStep = collectionActionNextStep({
    canEnterDiagnosis,
    failedWithoutFiles: failedFiles.length > 0 && actionDownloadedFiles.length === 0,
    hasImportedReceipt: parsedFiles > 0,
    ...(actionImportState ? { actionImportState } : {}),
    ...(actionReportTypeCount ? { actionReportTypeCount } : {}),
    importedRows,
    realFileCount,
  });
  const tone: LastActionResult['tone'] = failedCount > 0
    || actionImportState === 'failed'
    || actionImportState === 'mixed'
    ? 'blocked'
    : mode === 'import'
      ? parsedFiles > 0 ? 'success' : 'blocked'
      : actionRealDownloadCount > 0
        ? actionImportState === 'succeeded' || insertedRows > 0 || parsedFiles > 0 ? 'success' : 'warning'
        : 'blocked';
  const isStandalonePartialDownload = mode !== 'import'
    && actionImportState === 'not_applicable'
    && Number(actionReportTypeCount || 0) > 0
    && Number(actionReportTypeCount || 0) < 8;

  return {
    title: isStandalonePartialDownload
      ? '部分报表已下载，等待完整 8 类任务'
      : actionResultTitle(mode, tone),
    tone,
    mode,
    batchIds,
    downloadedCount,
    actionDownloadedFiles,
    failedCount,
    parsedFiles,
    insertedRows,
    currentImportedRows: importedRows,
    ...(actionImportState ? { actionImportState } : {}),
    ...(actionReportTypeCount ? { actionReportTypeCount } : {}),
    productionReady: canEnterDiagnosis,
    downloadArtifactId: firstBatch?.downloadArtifactId || fallbackArtifacts?.downloadArtifactId,
    manifestArtifactId: firstBatch?.manifestArtifactId || fallbackArtifacts?.manifestArtifactId,
    nextStep,
    failedFiles,
  };
}

export function collectionCompletionNotice(result: LastActionResult): string {
  if (result.mode === 'import') {
    if (result.currentImportedRows > 0 || result.insertedRows > 0) {
      return `导入完成：解析 ${result.parsedFiles} 个真实报表，写入 ${result.insertedRows} 行广告指标，当前范围共有 ${result.currentImportedRows} 行指标。`;
    }
    if (result.parsedFiles > 0 && result.failedCount === 0) {
      return result.productionReady
        ? `导入回执已完成：解析 ${result.parsedFiles} 个有效空表，写入 0 行广告指标；完整 8 类文件哈希和零行回执已闭合，可进入广告表现查看零数据状态。`
        : `导入回执已完成：解析 ${result.parsedFiles} 个有效空表，写入 0 行广告指标；文件哈希和零行回执已登记，系统将继续按完整 8 类任务血缘核对。`;
    }
    return '导入未完成：没有形成可量化的日级广告指标。请检查表头、日期、广告对象和金额/订单列。';
  }

  const actionRealFileCount = result.actionDownloadedFiles.length;
  if (result.actionImportState === 'mixed') {
    return '本次报表的入库状态不一致，系统已保持生产阻断。请刷新当前店铺的采集任务，逐类检查失败原因和入库回执后重试。';
  }
  const isStandalonePartialDownload = result.actionImportState === 'not_applicable'
    && Number(result.actionReportTypeCount || actionRealFileCount) > 0
    && Number(result.actionReportTypeCount || actionRealFileCount) < 8;
  if (actionRealFileCount > 0 && isStandalonePartialDownload) {
    return `本次部分报表已下载，但未写入生产指标：新增 ${actionRealFileCount} 个真实原始报表文件。请继续原完整 8 类任务，或重新获取当前范围的完整 8 类；系统不会跨批次拼接。`;
  }
  const currentActionHasImportReceipt = result.actionImportState === 'succeeded'
    || result.parsedFiles > 0
    || result.insertedRows > 0;
  if (actionRealFileCount > 0 && currentActionHasImportReceipt) {
    if (result.insertedRows !== result.currentImportedRows) {
      return `采集动作已完成：本次新增 ${actionRealFileCount} 个真实原始报表文件，当前范围覆盖 ${result.downloadedCount}/8 类真实报表，本次写入 ${result.insertedRows} 行广告指标，当前范围合计 ${result.currentImportedRows} 行。`;
    }
    return `采集动作已完成：本次新增 ${actionRealFileCount} 个真实原始报表文件，当前范围覆盖 ${result.downloadedCount}/8 类真实报表，已自动导入 ${result.currentImportedRows} 行广告指标。`;
  }
  if (actionRealFileCount > 0) {
    const historicalRows = result.currentImportedRows > 0
      ? `当前范围原有 ${result.currentImportedRows} 行指标只是历史数据，不代表本次已导入。`
      : '当前范围尚无可量化指标。';
    return `真实报表已下载，但本次未形成生产入库回执：新增 ${actionRealFileCount} 个真实原始报表文件，当前范围覆盖 ${result.downloadedCount}/8 类真实报表。${historicalRows}请检查当前任务的入库状态和解析错误。`;
  }
  if (result.downloadedCount > 0 && result.currentImportedRows > 0) {
    return `当前范围已有 ${result.downloadedCount}/8 类真实报表和 ${result.currentImportedRows} 行广告指标，但本次没有新增真实原始报表文件。请打开真实报表目录确认数据来源；不要把本次动作当成新的领星下载。`;
  }
  if (result.downloadedCount > 0) {
    return `当前范围已有 ${result.downloadedCount}/8 类真实报表，但本次没有新增真实原始报表文件，且还没有可量化指标。请点击“导入已下载表格”或重新下载缺失报表。`;
  }
  return `采集动作返回，但当前范围仍未满足量化门槛：真实报表覆盖 ${result.downloadedCount}/8 类，导入指标 ${result.currentImportedRows} 行。没有 xlsx/xls/csv 或解析入库失败时不能进行广告表现。`;
}

export function collectionActionResultStatusLabel(result: LastActionResult): string {
  if (result.actionImportState === 'not_applicable'
    && Number(result.actionReportTypeCount || 0) > 0
    && Number(result.actionReportTypeCount || 0) < 8) {
    return '待完整 8 类';
  }
  return result.tone === 'success' ? '已完成' : result.tone === 'blocked' ? '未完成' : '待补导';
}
