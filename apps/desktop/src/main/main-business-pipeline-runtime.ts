import * as path from 'path';
import * as fs from 'fs';
import { type ReportFileRecord } from '@amazon-ai-ops/local-db/src/sqlite/repositories/report-file-repo';
import { LINGXING_AD_REPORTS } from '@amazon-ai-ops/lingxing-report-collector';
import type { LingxingReportBatch, LingxingReportFile } from '@amazon-ai-ops/shared-types';
import type { StoreContextEnvelope, StoreRecord } from '@amazon-ai-ops/shared-types';
import { normalizeLingxingCollectionStoreName } from '@amazon-ai-ops/shared-types';
import { summarizeBusinessReportCoverage } from './business-report-coverage';
import { buildAdProductHistoryLedger } from './ad-product-history-ledger';
import { projectBusinessOperationEventForRenderer } from './business-operation-event-projection';
import { filterBusinessPipelineOperationEvents } from './operation-event-scope';
import { BUSINESS_REAL_REPORT_EXTENSIONS, BUSINESS_REJECTED_EVIDENCE_EXTENSIONS, isRejectedEvidenceLikePath, resolveBusinessReportImportState } from './business-report-files';
import { type MainArtifactKind } from './main-artifact-registry';
import { getBusinessRecommendationGate, loadBusinessCanonicalMetrics, loadBusinessQuantSummary } from './main-business-metrics-runtime';
import { businessMetricsWhere, countImportedRowsForFile, isExistingRawReportFile, loadBusinessBatchesForScope, loadLatestBusinessBatch, metricSourceFileCandidates, normalizeBusinessUiScope, summarizeBusinessBatchOption } from './main-business-scope-runtime';
import { reportFileIndexKey } from './main-local-report-import-runtime';
import { canonicalizeExistingPath } from './main-store-access-runtime';
import { loadProductStrategyContexts } from './main-ad-strategy-enrichment-runtime';
import { issueRendererArtifact, rendererPayload, rendererSafeDetail } from './main-artifacts-runtime';
import type { BusinessKeywordOpportunityRow, BusinessMetricSource } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export function handleGetBusinessKeywordOpportunities(input: unknown): BusinessKeywordOpportunityRow[] {
  const mainRuntimeContext = getMainRuntimeContext();
  const gate = getBusinessRecommendationGate(input, 'keyword-opportunities');
  const { sql, params } = businessMetricsWhere(gate.scope, gate.metricSource);
  if (!mainRuntimeContext.state.db) return [];
  const rows = mainRuntimeContext.state.db.prepare(`
    SELECT
      COALESCE(asin, '') AS asin,
      COALESCE(portfolio_name, '') AS portfolioName,
      COALESCE(campaign_name, '') AS campaignName,
      COALESCE(ad_group_name, '') AS adGroupName,
      COALESCE(report_type, '') AS entityType,
      COALESCE(NULLIF(search_term, ''), NULLIF(targeting, ''), NULLIF(match_type, ''), '') AS keyword,
      COALESCE(SUM(clicks), 0) AS clicks,
      COALESCE(SUM(orders), 0) AS orders,
      COALESCE(SUM(cost), 0) AS spend,
      COALESCE(SUM(sales), 0) AS sales,
      COALESCE(MAX(source_file), '') AS sourceFile
    FROM ad_daily_metrics
    WHERE ${sql}
    GROUP BY asin, portfolio_name, campaign_name, ad_group_name, report_type, keyword
    HAVING keyword <> ''
    ORDER BY spend DESC, clicks DESC
    LIMIT 200
  `).all(...params) as Array<{
    asin?: string;
    portfolioName?: string;
    campaignName?: string;
    adGroupName?: string;
    entityType?: string;
    keyword?: string;
    clicks?: number;
    orders?: number;
    spend?: number;
    sales?: number;
    sourceFile?: string;
  }>;

  const deduped = new Map<string, BusinessKeywordOpportunityRow>();
  for (const row of rows) {
    const clicks = Number(row.clicks || 0);
    const orders = Number(row.orders || 0);
    const spend = Number(row.spend || 0);
    const sales = Number(row.sales || 0);
    const acos = sales > 0 ? spend / sales : 0;
    const key = [
      gate.scope.storeName,
      gate.scope.marketplaceCode,
      row.asin || '',
      row.campaignName || '',
      row.adGroupName || '',
      row.entityType || '',
      (row.keyword || '').trim().toLowerCase(),
    ].join('|');
    if (deduped.has(key)) continue;
    const waste = spend > 0 && orders === 0;
    const converting = orders > 0 || sales > 0;
    deduped.set(key, {
      asin: row.asin || undefined,
      portfolioName: row.portfolioName || undefined,
      campaignName: row.campaignName || undefined,
      adGroupName: row.adGroupName || undefined,
      entityType: row.entityType || 'keyword',
      keyword: row.keyword || '-',
      coverageStatus: '待 Listing 覆盖核对',
      clicks,
      orders,
      spend,
      sales,
      acos,
      opportunityLevel: converting ? 'high' : waste ? 'medium' : 'low',
      recommendedPlacement: converting ? '优先进入标题/五点或精准词库' : waste ? '先否定或降价后再观察' : '保留观察',
      risk: waste ? '花费无订单，避免直接扩量' : '需结合 Listing 相关性复核',
      sourceFile: row.sourceFile || undefined,
    });
  }

  return Array.from(deduped.values());
}

export function handleGetBusinessUiDataPipeline(input: unknown) {
  const mainRuntimeContext = getMainRuntimeContext();
  const scope = normalizeBusinessUiScope(input);
  const batchResult = loadLatestBusinessBatch(scope);
  const availableBatches = loadBusinessBatchesForScope(scope).map((item) => summarizeBusinessBatchOption(scope, item));
  const files = batchResult?.files || [];
  const reportFileIndexByKey = new Map<string, ReportFileRecord>();
  const indexBatchIds = Array.from(new Set([
    batchResult?.batch.id,
    ...(batchResult?.sourceBatchIds || []),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)));
  for (const batchId of indexBatchIds) {
    const indexedFiles = mainRuntimeContext.state.reportFileRepo?.findForStore(scope.storeId, { batchId, limit: 5000 }) || [];
    for (const indexedFile of indexedFiles) {
      reportFileIndexByKey.set(reportFileIndexKey(indexedFile.batchId, indexedFile.reportType, indexedFile.filePath), indexedFile);
    }
  }
  const fileBatchForPath = (file: LingxingReportFile): LingxingReportBatch | undefined => {
    const downloadDir = batchResult?.fileDownloadDirs?.[file.id] || batchResult?.batch.downloadDir;
    return batchResult?.batch && downloadDir ? { ...batchResult.batch, downloadDir } : batchResult?.batch;
  };
  const realReportFiles = files
    .filter((file) => isExistingRawReportFile(file, fileBatchForPath(file)))
    .map((file) => {
      const filePath = canonicalizeExistingPath(file.filePath);
      const batchId = file.batchId || batchResult?.batch.id || '';
      const indexedFile = reportFileIndexByKey.get(reportFileIndexKey(batchId, file.reportType, filePath));
      const countedRows = countImportedRowsForFile(scope, filePath, batchId);
      const { importedRows, status } = resolveBusinessReportImportState({
        fileStatus: file.status,
        indexedStatus: indexedFile?.status,
        countedMetricRows: countedRows,
      });
      return {
        id: file.id,
        batchId,
        reportType: file.reportType,
        displayName: file.displayName,
        status,
        filePath,
        folderPath: path.dirname(filePath),
        fileName: path.basename(filePath),
        fileSizeBytes: fs.statSync(filePath).size,
        importedRows,
        fileHash: indexedFile?.fileHash || undefined,
        importError: indexedFile?.importError || undefined,
        lastImportedAt: indexedFile?.lastImportedAt || undefined,
        updatedAt: indexedFile?.updatedAt || file.updatedAt,
      };
    });
  const realReportSourceFiles = Array.from(new Set(realReportFiles.flatMap((file) => metricSourceFileCandidates(file.filePath))));
  const realReportBatchIds = Array.from(new Set(
    realReportFiles
      .map((file) => file.batchId || batchResult?.batch.id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  ));
  const metricSource: BusinessMetricSource | undefined = batchResult && !batchResult.scopeMismatch?.length && realReportSourceFiles.length > 0
    ? { batchId: batchResult.batch.id, batchIds: realReportBatchIds, sourceFiles: realReportSourceFiles }
    : undefined;

  const reportCoverage = summarizeBusinessReportCoverage({
    expectedTypes: LINGXING_AD_REPORTS.map((report) => report.type),
    realReportFiles,
  });
  const latestFileByType = new Map<string, (typeof realReportFiles)[number]>();
  for (const file of realReportFiles) {
    if (!latestFileByType.has(file.reportType)) latestFileByType.set(file.reportType, file);
  }

  const reportOptions = LINGXING_AD_REPORTS.map((report) => {
    const file = latestFileByType.get(report.type);
    return {
      type: report.type,
      label: report.displayName,
      status: file?.status || 'missing',
      realFileAvailable: !reportCoverage.missingReportTypes.includes(report.type),
      importedRows: reportCoverage.importedRowsByType.get(report.type) || 0,
    };
  });
  const fileAuditRecords = files.map((file) => {
    const filePath = file.filePath ? path.resolve(file.filePath) : '';
    const extension = filePath ? path.extname(filePath).toLowerCase() : '';
    let exists = false;
    try {
      exists = Boolean(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
      exists = false;
    }
    const realReport = Boolean(filePath) && isExistingRawReportFile(file, fileBatchForPath(file));
    return {
      status: file.status,
      extension,
      exists,
      realReport,
      evidenceLike: exists && !realReport && isRejectedEvidenceLikePath(filePath),
    };
  });
  const importedRowCount = reportOptions.reduce((sum, item) => sum + item.importedRows, 0);
  const missingReportLabels = reportOptions
    .filter((item) => !item.realFileAvailable)
    .map((item) => item.label);

  const quant = loadBusinessQuantSummary(scope, reportCoverage.realReportFileCount, metricSource);
  const operationEventsInRange = mainRuntimeContext.state.operationEventRepo?.findByScopeForStore(scope.storeId, {
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    marketplaceCode: scope.marketplaceCode,
    limit: 300,
  }) || [];
  const operationEvents = filterBusinessPipelineOperationEvents({
    scopeAsin: scope.asin,
    events: operationEventsInRange,
  });
  const productContexts = loadProductStrategyContexts(scope);
  const productHistoryMetrics = metricSource
    ? loadBusinessCanonicalMetrics(scope, metricSource, 5000)
    : [];
  const productHistoryLedgers = buildAdProductHistoryLedger({
    scope: {
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      batchId: scope.batchId || batchResult?.batch.id,
    },
    metrics: productHistoryMetrics,
    operationEvents,
    productContexts,
  });
  const blockers = Array.from(new Set([
    ...(batchResult?.scopeMismatch?.length ? ['数据批次与当前运营范围不一致，已阻断文件和指标展示。', ...batchResult.scopeMismatch] : []),
    ...(!batchResult ? ['当前范围没有匹配的数据批次。'] : []),
    ...(reportCoverage.realReportFileCount === 0 ? ['当前范围还没有可量化的真实广告数据'] : []),
    ...(quant.importedRows === 0 ? ['当前范围没有导入广告指标行，广告量化保持阻断。'] : []),
  ]));

  const evidencePaths = [
    ...(batchResult?.batch.downloadDir ? [{ label: '下载文件夹', path: batchResult.batch.downloadDir, kind: 'folder' as const }] : []),
    ...(batchResult?.batch.manifestPath ? [{ label: '采集 Manifest', path: batchResult.batch.manifestPath, kind: 'audit' as const }] : []),
    ...realReportFiles.slice(0, 8).map((file) => ({ label: file.displayName, path: file.filePath, kind: 'file' as const })),
  ];

  return {
    scope: {
      storeId: scope.storeId,
      storeContext: scope.storeContext,
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      batchId: scope.batchId,
      currency: 'USD' as const,
    },
    generatedAt: new Date().toISOString(),
    collection: {
      status: reportCoverage.statusWithImportedRows(quant.importedRows),
      latestBatch: batchResult?.batch ? {
        id: batchResult.batch.id,
        status: batchResult.batch.status,
        dateStart: batchResult.batch.dateStart,
        dateEnd: batchResult.batch.dateEnd,
        storeName: batchResult.batch.storeName,
        marketplaceCode: batchResult.batch.marketplaceCode,
        downloadDir: batchResult.batch.downloadDir,
        manifestPath: batchResult.batch.manifestPath,
        completedAt: batchResult.batch.completedAt,
      } : null,
      sourceBatchIds: batchResult?.sourceBatchIds || (batchResult?.batch.id ? [batchResult.batch.id] : []),
      availableBatches,
      reportOptions,
      realReportFiles,
      evidencePaths,
      fileAudit: {
        totalFileRecords: files.length,
        downloadedFileRecords: fileAuditRecords.filter((file) => file.status === 'downloaded' && file.realReport).length,
        existingFileRecords: fileAuditRecords.filter((file) => file.exists).length,
        realReportFileCount: reportCoverage.realReportFileCount,
        importedRowCount,
        rejectedEvidenceFileCount: fileAuditRecords.filter((file) => file.evidenceLike).length,
        missingReportLabels,
        downloadDir: batchResult?.batch.downloadDir,
        manifestPath: batchResult?.batch.manifestPath,
      },
      blockers,
      audit: {
        databaseReady: Boolean(mainRuntimeContext.state.db),
        acceptedExtensions: Array.from(BUSINESS_REAL_REPORT_EXTENSIONS),
        rejectedEvidenceExtensions: BUSINESS_REJECTED_EVIDENCE_EXTENSIONS,
        notes: [
          '只读读取 lingxing_report_batches、lingxing_report_files 和 ad_daily_metrics。',
          '广告量化指标必须绑定当前数据批次 batch_id，旧导入数据仅允许通过当前真实报表 source_file 回退匹配。',
          '手动输入的数据批次必须与当前日期、店铺和站点一致，否则整条数据管道阻断。',
          '只有存在于磁盘的 .xlsx/.xls/.csv filePath 计为真实原始报表文件。',
          '审计 JSON、PNG 截图、HTML/DOM 快照和 Trace 不计为真实报表文件。',
          ...(batchResult?.scopeMismatch?.length ? batchResult.scopeMismatch : []),
        ],
      },
    },
    quant,
    operations: {
      events: operationEvents,
      eventCount: operationEvents.length,
      notes: [
        '运营事件用于解释广告波动和 AI 阶段诊断，例如 Coupon、BD、价格、Listing、库存和站外推广。',
        '当前版本由运营手动维护事件；后续可接入领星/亚马逊活动、价格和库存自动读取。',
      ],
    },
    productContext: {
      products: productContexts,
      productCount: productContexts.length,
      notes: [
        '产品配置用于给 AI 提供推广阶段、成本结构、最低价、目标净利率、目标 ACOS 和目标 TACOS。',
        '未配置产品时，AI 仍可分析广告数据，但动态阈值不会包含利润空间约束。',
      ],
    },
    productHistory: {
      ledgers: productHistoryLedgers,
      ledgerCount: productHistoryLedgers.length,
      notes: [
        '产品广告历史账本按当前运营范围、真实报表批次和 source_file 生成，保留日级广告事实。',
        'AI 阶段判断和动态阈值会优先参考这份按 ASIN 聚合的每日历史，而不是只看周期汇总。',
      ],
    },
  };
}

export function assertBatchContainsRealReportFiles(
  result: { batch: LingxingReportBatch; files: LingxingReportFile[] },
  actionLabel: string,
): void {
  const realFiles = result.files.filter((file) => isExistingRawReportFile(file, result.batch));
  if (realFiles.length > 0) return;

  const failureReasons = result.files
    .filter((file) => file.status === 'failed' || file.errorMessage)
    .map((file) => `${file.displayName || file.reportType}: ${file.errorMessage || '未拿到真实报表文件'}`)
    .slice(0, 5);
  const detail = failureReasons.length ? `失败原因：${failureReasons.join('；')}` : '没有任何 .xlsx/.xls/.csv 原始报表落盘。';
  throw new Error(`${actionLabel}未完成：当前动作没有拿到真实领星广告表格。${detail}`);
}

export function lingxingCollectionCancellationKey(input: {
  storeId: string;
  requestId?: string;
  jobId?: string;
}): string[] {
  if (!input.requestId || !input.jobId) return [];
  return [`collection:${JSON.stringify([input.storeId, input.requestId, input.jobId])}`];
}

export function authorizedLingxingCollectionTarget(
  submittedContext: StoreContextEnvelope,
): { context: StoreContextEnvelope; store: StoreRecord; target: { marketplaceCode: 'US'; storeId: string; storeName: string } } {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.storeCoordinator || !mainRuntimeContext.state.storeRepo) {
    throw new Error('店铺会话协调器尚未就绪。');
  }
  const context = mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(submittedContext);
  const store = mainRuntimeContext.state.storeRepo.getStore(context.storeId);
  if (!store || store.status !== 'active') {
    throw new Error('当前店铺不存在或已停用，领星操作已拒绝。');
  }
  const connection = mainRuntimeContext.state.storeRepo.getConnection(context.storeId, 'lingxing');
  if (!connection) {
    throw new Error('当前店铺尚未配置领星连接，仅领星采集被阻断。');
  }
  const targetStoreName = connection.collectionStoreName?.trim();
  const normalizedTargetStoreName = normalizeLingxingCollectionStoreName(targetStoreName);
  if (!targetStoreName || !normalizedTargetStoreName
    || connection.normalizedCollectionStoreName !== normalizedTargetStoreName) {
    throw new Error('当前店铺缺少有效的领星下载中心店铺名称映射，仅领星采集被阻断。');
  }
  return {
    context,
    store,
    target: {
      marketplaceCode: 'US',
      storeId: context.storeId,
      storeName: targetStoreName,
    },
  };
}

export function projectBusinessReportFileForRenderer(storeId: string, file: any) {
  const fileArtifact = issueRendererArtifact(
    storeId,
    file.filePath,
    'report-file',
    file.fileName || file.displayName,
  );
  const folderArtifact = issueRendererArtifact(
    storeId,
    file.folderPath || (file.filePath ? path.dirname(file.filePath) : undefined),
    'report-folder',
    '原始报表目录',
  );
  return {
    id: String(file.id || ''),
    ...(file.batchId ? { batchId: String(file.batchId) } : {}),
    reportType: String(file.reportType || ''),
    displayName: String(file.displayName || file.reportType || '原始报表'),
    status: String(file.status || 'missing'),
    fileName: String(file.fileName || (file.filePath ? path.basename(file.filePath) : '')),
    fileExtension: String(path.extname(file.fileName || file.filePath || '')).toLowerCase(),
    fileSizeBytes: Number(file.fileSizeBytes || 0),
    importedRows: Number(file.importedRows || 0),
    ...(file.fileHash ? { fileHash: String(file.fileHash) } : {}),
    ...(file.importError ? { importError: rendererSafeDetail(file.importError) } : {}),
    ...(file.lastImportedAt ? { lastImportedAt: String(file.lastImportedAt) } : {}),
    ...(file.updatedAt ? { updatedAt: String(file.updatedAt) } : {}),
    ...(fileArtifact ? {
      artifactId: fileArtifact.artifactId,
      sourceArtifactId: fileArtifact.artifactId,
      artifactDisplayName: fileArtifact.displayName,
    } : {}),
    ...(folderArtifact ? {
      folderArtifactId: folderArtifact.artifactId,
      folderDisplayName: folderArtifact.displayName,
    } : {}),
  };
}

export function projectBusinessBatchForRenderer(storeId: string, batch: any) {
  if (!batch) return null;
  const downloadArtifact = issueRendererArtifact(storeId, batch.downloadDir, 'report-folder', '原始报表目录');
  const manifestArtifact = issueRendererArtifact(storeId, batch.manifestPath, 'manifest', '采集清单');
  return {
    id: String(batch.id || ''),
    status: String(batch.status || ''),
    dateStart: String(batch.dateStart || ''),
    dateEnd: String(batch.dateEnd || ''),
    ...(batch.storeName ? { storeName: String(batch.storeName) } : {}),
    ...(batch.marketplaceCode ? { marketplaceCode: String(batch.marketplaceCode) } : {}),
    ...(batch.createdAt ? { createdAt: String(batch.createdAt) } : {}),
    ...(batch.completedAt ? { completedAt: String(batch.completedAt) } : {}),
    ...(downloadArtifact ? {
      downloadArtifactId: downloadArtifact.artifactId,
      downloadDisplayName: downloadArtifact.displayName,
    } : {}),
    ...(manifestArtifact ? {
      manifestArtifactId: manifestArtifact.artifactId,
      manifestDisplayName: manifestArtifact.displayName,
    } : {}),
  };
}

export function projectBusinessBatchOptionForRenderer(storeId: string, batch: any) {
  const safeBatch = projectBusinessBatchForRenderer(storeId, batch)!;
  return {
    ...safeBatch,
    totalFileRecords: Number(batch.totalFileRecords || 0),
    realReportFileCount: Number(batch.realReportFileCount || 0),
    importedReportTypeCount: Number(batch.importedReportTypeCount || 0),
    importedRowCount: Number(batch.importedRowCount || 0),
    missingReportLabels: Array.isArray(batch.missingReportLabels)
      ? batch.missingReportLabels.map((item: unknown) => String(item))
      : [],
  };
}

export function projectBusinessPipelineForRenderer(pipeline: any) {
  const storeId = String(pipeline?.scope?.storeId || pipeline?.scope?.storeContext?.storeId || '');
  if (!storeId) throw new Error('业务数据投影缺少当前店铺权威。');
  const collection = pipeline?.collection || {};
  const realReportFiles = Array.isArray(collection.realReportFiles)
    ? collection.realReportFiles.map((file: any) => projectBusinessReportFileForRenderer(storeId, file))
    : [];
  const evidenceArtifacts = (Array.isArray(collection.evidencePaths) ? collection.evidencePaths : [])
    .map((item: any) => {
      const artifactKind: MainArtifactKind = item.kind === 'folder'
        ? 'report-folder'
        : item.kind === 'file'
          ? 'report-file'
          : 'manifest';
      const artifact = issueRendererArtifact(storeId, item.path, artifactKind, String(item.label || '本地证据'));
      return artifact ? {
        label: String(item.label || artifact.displayName),
        artifactId: artifact.artifactId,
        displayName: artifact.displayName,
        kind: item.kind === 'folder' || item.kind === 'file' ? item.kind : 'audit',
      } : undefined;
    })
    .filter(Boolean);
  const latestBatch = projectBusinessBatchForRenderer(storeId, collection.latestBatch);
  const safeOperationEvents = Array.isArray(pipeline?.operations?.events)
    ? pipeline.operations.events.map(projectBusinessOperationEventForRenderer)
    : [];
  const safeProductHistoryLedgers = Array.isArray(pipeline?.productHistory?.ledgers)
    ? pipeline.productHistory.ledgers.map((ledger: any) => ({
        ...ledger,
        events: Array.isArray(ledger?.events)
          ? ledger.events.map(projectBusinessOperationEventForRenderer)
          : [],
      }))
    : [];
  const safe = {
    ...pipeline,
    operations: {
      ...pipeline.operations,
      events: safeOperationEvents,
      eventCount: safeOperationEvents.length,
    },
    productHistory: {
      ...pipeline.productHistory,
      ledgers: safeProductHistoryLedgers,
      ledgerCount: safeProductHistoryLedgers.length,
    },
    collection: {
      status: collection.status,
      latestBatch,
      sourceBatchIds: Array.isArray(collection.sourceBatchIds) ? [...collection.sourceBatchIds] : [],
      availableBatches: Array.isArray(collection.availableBatches)
        ? collection.availableBatches.map((batch: any) => projectBusinessBatchOptionForRenderer(storeId, batch))
        : [],
      reportOptions: Array.isArray(collection.reportOptions) ? collection.reportOptions : [],
      realReportFiles,
      evidenceArtifacts,
      fileAudit: {
        totalFileRecords: Number(collection.fileAudit?.totalFileRecords || 0),
        downloadedFileRecords: Number(collection.fileAudit?.downloadedFileRecords || 0),
        existingFileRecords: Number(collection.fileAudit?.existingFileRecords || 0),
        realReportFileCount: Number(collection.fileAudit?.realReportFileCount || 0),
        importedRowCount: Number(collection.fileAudit?.importedRowCount || 0),
        rejectedEvidenceFileCount: Number(collection.fileAudit?.rejectedEvidenceFileCount || 0),
        missingReportLabels: Array.isArray(collection.fileAudit?.missingReportLabels)
          ? collection.fileAudit.missingReportLabels.map((item: unknown) => String(item))
          : [],
        ...(latestBatch?.downloadArtifactId ? {
          downloadArtifactId: latestBatch.downloadArtifactId,
          downloadDisplayName: latestBatch.downloadDisplayName,
        } : {}),
        ...(latestBatch?.manifestArtifactId ? {
          manifestArtifactId: latestBatch.manifestArtifactId,
          manifestDisplayName: latestBatch.manifestDisplayName,
        } : {}),
      },
      blockers: Array.isArray(collection.blockers) ? collection.blockers.map((item: unknown) => rendererSafeDetail(item) || '') : [],
      audit: {
        ...collection.audit,
        notes: [
          '只读读取当前店铺的报表批次、报表文件和广告指标。',
          '广告量化指标必须绑定当前数据批次；旧导入数据只允许由 Main 按当前真实报表来源回退匹配。',
          '手动输入的数据批次必须与当前日期、店铺和站点一致，否则整条数据管道阻断。',
          '只有 Main 已校验存在的 xlsx/xls/csv 原始报表计为真实文件。',
          '审计 JSON、PNG 截图、HTML/DOM 快照和 Trace 不计为真实报表文件。',
        ],
      },
    },
  };
  return rendererPayload(safe);
}
