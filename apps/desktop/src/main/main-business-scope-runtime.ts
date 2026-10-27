import { validateDateRange } from './main-input-contract';
import { adMetricGrainWhere, inferAdMetricReportType, type AdMetricReportGrain } from '@amazon-ai-ops/local-db/src/sqlite/ad-metric-grain';
import { type ReportFileRecord } from '@amazon-ai-ops/local-db/src/sqlite/repositories/report-file-repo';
import { LINGXING_AD_REPORTS } from '@amazon-ai-ops/lingxing-report-collector';
import type { LingxingReportBatch, LingxingReportFile } from '@amazon-ai-ops/shared-types';
import type { StoreContextEnvelope, StoreRecord } from '@amazon-ai-ops/shared-types';
import { summarizeBusinessReportCoverage } from './business-report-coverage';
import { countImportedRowsForReportFile } from './business-report-import-coverage';
import { assertFormalBusinessWorkflowReady } from './formal-business-data-gate';
import { isExistingRawBusinessReportFile, resolveBusinessReportImportState, selectLatestRawBusinessReportsByType } from './business-report-files';
import { optionalTrimmedString } from './main-download-automation-runtime';
import { loadPersistedLingxingBatch } from './main-report-diagnostic-read-model-runtime';
import { reportFileIndexKey } from './main-local-report-import-runtime';
import { canonicalizeExistingPath } from './main-store-access-runtime';
import type { BusinessBatchOptionView, BusinessBatchResult, BusinessMetricSource, NormalizedBusinessUiScope } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export function resolveBusinessStoreAuthority(submittedContext?: unknown): {
  context: StoreContextEnvelope;
  store: StoreRecord;
} {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.storeCoordinator || !mainRuntimeContext.state.storeRepo) {
    throw new Error('店铺数据域尚未初始化。');
  }
  const context = submittedContext
    ? mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(submittedContext)
    : mainRuntimeContext.state.storeCoordinator.getActiveStoreContext();
  if (!context) throw new Error('请先选择美国站店铺。');
  const store = mainRuntimeContext.state.storeRepo.getStore(context.storeId);
  if (!store || store.status !== 'active') {
    throw new Error('当前店铺不存在或已停用。');
  }
  if (store.marketplace !== 'US' || store.currency !== 'USD') {
    throw new Error('当前版本仅支持 Amazon 美国站与 USD。');
  }
  return { context, store };
}

export function normalizeBusinessUiScope(input: unknown) {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const dateFrom = typeof value.dateFrom === 'string' ? value.dateFrom.trim() : '';
  const dateTo = typeof value.dateTo === 'string' ? value.dateTo.trim() : '';
  validateDateRange({ start: dateFrom, end: dateTo });
  const { context, store } = resolveBusinessStoreAuthority(value.storeContext);
  return {
    dateFrom,
    dateTo,
    storeId: context.storeId,
    storeContext: Object.freeze({ ...context }),
    storeName: store.displayName,
    marketplaceCode: 'US' as const,
    asin: optionalTrimmedString(value.asin),
    batchId: optionalTrimmedString(value.batchId),
    currency: 'USD' as const,
  };
}

export function normalizeBusinessMutationScope(input: unknown): NormalizedBusinessUiScope {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  if (!value.storeContext) {
    throw new Error('该写入操作缺少 StoreContext，请刷新当前店铺后重试。');
  }
  return normalizeBusinessUiScope(value);
}

export function businessMetricsWhere(
  scope: NormalizedBusinessUiScope,
  source?: BusinessMetricSource,
  grain: AdMetricReportGrain = 'actionable',
): { sql: string; params: (string | number)[] } {
  let sql = `
    store_id = ?
    AND date >= ?
    AND date <= ?
    AND COALESCE(marketplace_code, '') = COALESCE(?, '')
    AND ${adMetricGrainWhere(grain)}
  `;
  const params: (string | number)[] = [scope.storeId, scope.dateFrom, scope.dateTo, scope.marketplaceCode];
  if (scope.asin) {
    sql += ' AND upper(COALESCE(asin, \'\')) = upper(?)';
    params.push(scope.asin);
  }
  const sourceFiles = Array.from(new Set(source?.sourceFiles.filter(Boolean) ?? []));
  const batchIds = Array.from(new Set(source?.batchIds?.filter(Boolean) ?? (source?.batchId ? [source.batchId] : [])));
  if (batchIds.length > 0 && sourceFiles.length > 0) {
    sql += `
      AND source_file IN (${sourceFiles.map(() => '?').join(', ')})
      AND batch_id IN (${batchIds.map(() => '?').join(', ')})
    `;
    params.push(...sourceFiles, ...batchIds);
  } else if (batchIds.length > 0) {
    sql += ' AND 1 = 0';
  } else if (sourceFiles.length > 0) {
    sql += ` AND source_file IN (${sourceFiles.map(() => '?').join(', ')})`;
    params.push(...sourceFiles);
  } else {
    sql += ' AND 1 = 0';
  }
  return { sql, params };
}

export function collectBusinessBatchScopeMismatches(batch: LingxingReportBatch, scope: NormalizedBusinessUiScope): string[] {
  const mismatches: string[] = [];
  if ((batch.storeId || '') !== scope.storeId) mismatches.push('批次不属于当前店铺。');
  if (batch.dateStart !== scope.dateFrom) mismatches.push(`开始日期不一致：批次 ${batch.dateStart}，当前范围 ${scope.dateFrom}`);
  if (batch.dateEnd !== scope.dateTo) mismatches.push(`结束日期不一致：批次 ${batch.dateEnd}，当前范围 ${scope.dateTo}`);
  if ((batch.marketplaceCode || '') !== (scope.marketplaceCode || '')) mismatches.push(`站点不一致：批次 ${batch.marketplaceCode || '-'}，当前范围 ${scope.marketplaceCode || '-'}`);
  return mismatches;
}

export function loadLatestBusinessBatch(scope: NormalizedBusinessUiScope): BusinessBatchResult | undefined {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) return undefined;
  if (scope.batchId) {
    try {
      const batchResult = loadPersistedLingxingBatch(scope.batchId);
      const scopeMismatch = collectBusinessBatchScopeMismatches(batchResult.batch, scope);
      const statusMismatch = batchResult.batch.status === 'completed' || batchResult.batch.status === 'completed_with_errors'
        ? []
        : [`数据批次尚未完成：当前状态 ${batchResult.batch.status}`];
      const mismatches = [...statusMismatch, ...scopeMismatch];
      return mismatches.length > 0
        ? { ...batchResult, scopeMismatch: mismatches, sourceBatchIds: [batchResult.batch.id] }
        : { ...batchResult, sourceBatchIds: [batchResult.batch.id] };
    } catch {
      return undefined;
    }
  }
  return composeBusinessBatchForScope(scope);
}

export function loadBusinessBatchesForScope(scope: NormalizedBusinessUiScope): BusinessBatchResult[] {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) return [];
  const rows = mainRuntimeContext.state.db.prepare(`
    SELECT id
    FROM lingxing_report_batches
    WHERE store_id = @storeId
      AND COALESCE(request_id, '') NOT LIKE 'canary:%'
      AND date_start = @dateFrom
      AND date_end = @dateTo
      AND COALESCE(marketplace_code, '') = COALESCE(@marketplaceCode, '')
      AND status IN ('completed', 'completed_with_errors')
    ORDER BY completed_at DESC, created_at DESC, id DESC
  `).all(scope) as Array<{ id?: string }>;
  return rows
    .map((row) => {
      try {
        return row.id ? loadPersistedLingxingBatch(row.id) : undefined;
      } catch {
        return undefined;
      }
    })
    .filter(Boolean) as BusinessBatchResult[];
}

export function composeBusinessBatchForScope(scope: NormalizedBusinessUiScope): BusinessBatchResult | undefined {
  const batches = loadBusinessBatchesForScope(scope);
  if (batches.length === 0) return undefined;

  const latestBatch = batches[0].batch;
  const { files, fileDownloadDirs } = selectLatestRawBusinessReportsByType<LingxingReportFile>(batches);
  return {
    batch: {
      ...latestBatch,
      id: latestBatch.id,
      status: files.length === LINGXING_AD_REPORTS.length ? 'completed' : 'completed_with_errors',
    },
    files,
    sourceBatchIds: batches.map((item) => item.batch.id),
    fileDownloadDirs,
  };
}

export function summarizeBusinessBatchOption(scope: NormalizedBusinessUiScope, batchResult: BusinessBatchResult): BusinessBatchOptionView {
  const mainRuntimeContext = getMainRuntimeContext();
  const realFiles = batchResult.files.filter((file) => isExistingRawBusinessReportFile(file, batchResult.batch));
  const indexedFilesByKey = new Map<string, ReportFileRecord>();
  const batchIds = Array.from(new Set([
    batchResult.batch.id,
    ...(batchResult.sourceBatchIds || []),
    ...realFiles.map((file) => file.batchId).filter((value): value is string => Boolean(value)),
  ]));
  for (const batchId of batchIds) {
    for (const indexed of mainRuntimeContext.state.reportFileRepo?.findForStore(scope.storeId, { batchId, limit: 5000 }) || []) {
      indexedFilesByKey.set(reportFileIndexKey(indexed.batchId, indexed.reportType, indexed.filePath), indexed);
    }
  }
  const importedReportTypes = new Set<string>();
  const formalReportFiles: Array<{
    batchId: string;
    reportType: string;
    importedRows: number;
    status: string;
  }> = [];
  const importedRowCount = realFiles.reduce((sum, file) => {
    if (!file.filePath) return sum;
    const filePath = canonicalizeExistingPath(file.filePath);
    const batchId = file.batchId || batchResult.batch.id;
    const indexed = indexedFilesByKey.get(reportFileIndexKey(batchId, file.reportType, filePath));
    const importState = resolveBusinessReportImportState({
      fileStatus: file.status,
      indexedStatus: indexed?.status,
      countedMetricRows: countImportedRowsForFile(scope, filePath, batchId),
    });
    formalReportFiles.push({
      batchId,
      reportType: file.reportType,
      importedRows: importState.importedRows,
      status: importState.status,
    });
    if (importState.status === 'imported') importedReportTypes.add(file.reportType);
    return sum + importState.importedRows;
  }, 0);
  const coverage = summarizeBusinessReportCoverage({
    expectedTypes: LINGXING_AD_REPORTS.map((report) => report.type),
    realReportFiles: realFiles,
  });
  let projectedStatus = batchResult.batch.status;
  if (projectedStatus === 'completed') {
    try {
      assertFormalBusinessWorkflowReady({
        workflow: 'recommendation',
        requiredReportTypes: LINGXING_AD_REPORTS.map((report) => report.type),
        realReportFiles: formalReportFiles,
        collectionJob: mainRuntimeContext.state.lingxingImportRepo?.getCollectionJobForStore(
          scope.storeId,
          batchResult.batch.id,
        ),
      });
    } catch {
      
      
      
      projectedStatus = 'completed_with_errors';
    }
  }

  return {
    id: batchResult.batch.id,
    status: projectedStatus,
    dateStart: batchResult.batch.dateStart,
    dateEnd: batchResult.batch.dateEnd,
    storeName: batchResult.batch.storeName,
    marketplaceCode: batchResult.batch.marketplaceCode,
    downloadDir: batchResult.batch.downloadDir,
    manifestPath: batchResult.batch.manifestPath,
    createdAt: batchResult.batch.createdAt,
    completedAt: batchResult.batch.completedAt,
    totalFileRecords: batchResult.files.length,
    realReportFileCount: coverage.realReportFileCount,
    importedReportTypeCount: importedReportTypes.size,
    importedRowCount,
    missingReportLabels: LINGXING_AD_REPORTS
      .filter((report) => coverage.missingReportTypes.includes(report.type))
      .map((report) => report.displayName),
  };
}

export function handleGetBusinessBatchOptions(input: unknown): BusinessBatchOptionView[] {
  const scope = normalizeBusinessUiScope(input);
  return loadBusinessBatchesForScope(scope).map((batchResult) => summarizeBusinessBatchOption(scope, batchResult));
}

export function isExistingRawReportFile(file: LingxingReportFile, batch?: LingxingReportBatch): file is LingxingReportFile & { filePath: string } {
  return isExistingRawBusinessReportFile(file, batch);
}

export function metricSourceFileCandidates(filePath: string): string[] {
  return Array.from(new Set([
    filePath,
    canonicalizeExistingPath(filePath),
  ]));
}

export function countImportedRowsForFile(scope: NormalizedBusinessUiScope, filePath: string, batchId?: string): number {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) return 0;
  return countImportedRowsForReportFile(mainRuntimeContext.state.db, {
    scope,
    sourceFiles: metricSourceFileCandidates(filePath),
    batchId,
  });
}

export function readBusinessMetricSummary(sql: string, params: (string | number)[]) {
  const mainRuntimeContext = getMainRuntimeContext();
  return mainRuntimeContext.state.db!.prepare(`
    SELECT
      COUNT(*) AS importedRows,
      COALESCE(SUM(cost), 0) AS totalSpend,
      COALESCE(SUM(sales), 0) AS totalSales,
      COALESCE(SUM(orders), 0) AS totalOrders,
      COALESCE(SUM(clicks), 0) AS totalClicks,
      COALESCE(SUM(impressions), 0) AS totalImpressions
    FROM ad_daily_metrics
    WHERE ${sql}
  `).get(...params) as {
    importedRows?: number;
    totalSpend?: number;
    totalSales?: number;
    totalOrders?: number;
    totalClicks?: number;
    totalImpressions?: number;
  } | undefined;
}

export function loadAvailableBusinessMetricReportTypes(sql: string, params: (string | number)[]): string[] {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) return [];
  const rows = mainRuntimeContext.state.db.prepare(`
    SELECT report_type AS reportType, source_file AS sourceFile
    FROM ad_daily_metrics
    WHERE ${sql}
  `).all(...params) as Array<{ reportType?: string | null; sourceFile?: string | null }>;
  return Array.from(new Set(
    rows
      .map((row) => inferAdMetricReportType(row.reportType, row.sourceFile))
      .filter(Boolean),
  ));
}
