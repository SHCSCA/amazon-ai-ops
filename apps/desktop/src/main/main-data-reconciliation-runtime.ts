import { roundMoney } from './business-metric-projection';
import { buildDataReconciliationMarkdown } from './data-reconciliation-markdown';
import * as path from 'path';
import * as fs from 'fs';
import { adMetricCanonicalWhere } from '@amazon-ai-ops/local-db/src/sqlite/ad-metric-grain';
import { safeFileSegment } from './acceptance-audit-export';
import { businessMetricsWhere, loadAvailableBusinessMetricReportTypes, metricSourceFileCandidates, normalizeBusinessUiScope, readBusinessMetricSummary } from './main-business-scope-runtime';
import { handleGetBusinessUiDataPipeline } from './main-business-pipeline-runtime';
import { currentArtifactStore, issueRendererArtifact, rendererPayload, rendererSafeDetail } from './main-artifacts-runtime';
import type { BusinessMetricSource } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export function businessMetricSummaryForExport(sql: string, params: (string | number)[]) {
  const summary = readBusinessMetricSummary(sql, params);
  return {
    rows: Number(summary?.importedRows || 0),
    spend: roundMoney(summary?.totalSpend),
    sales: roundMoney(summary?.totalSales),
    orders: Number(summary?.totalOrders || 0),
    clicks: Number(summary?.totalClicks || 0),
    impressions: Number(summary?.totalImpressions || 0),
    currency: 'USD',
  };
}

export function handleExportDataReconciliation(input: unknown) {
  const mainRuntimeContext = getMainRuntimeContext();
  const scope = normalizeBusinessUiScope(input);
  const pipeline = handleGetBusinessUiDataPipeline(scope);
  const sourceFiles = Array.from(new Set((pipeline.collection.realReportFiles || []).flatMap((file: any) => metricSourceFileCandidates(file.filePath))));
  const sourceBatchIds = Array.from(new Set((pipeline.collection.sourceBatchIds || []).filter(Boolean)));
  const metricSource: BusinessMetricSource | undefined = sourceFiles.length > 0
    ? { batchIds: sourceBatchIds, batchId: sourceBatchIds[0], sourceFiles }
    : undefined;
  const blockers = new Set<string>([
    ...(pipeline.collection.blockers || []),
    ...(pipeline.quant.blockers || []),
  ]);
  let dbReport: any = {
    databaseReady: Boolean(mainRuntimeContext.state.db),
    availableReportTypes: [],
    canonical: { reportTypes: [], summarySource: 'none', isApproximate: false },
    totals: {
      canonical: { rows: 0, spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0, currency: 'USD' },
      actionable: { rows: 0, spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0, currency: 'USD' },
      breakdown: { rows: 0, spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0, currency: 'USD' },
    },
    byReportType: [],
  };

  if (!mainRuntimeContext.state.db) {
    blockers.add('本地数据库不可用，无法导出口径核对。');
  } else if (!metricSource) {
    blockers.add('当前范围缺少真实报表文件，无法绑定 DB 指标来源。');
  } else {
    const allMetrics = businessMetricsWhere(scope, metricSource, 'all');
    const actionableMetrics = businessMetricsWhere(scope, metricSource, 'actionable');
    const breakdownMetrics = businessMetricsWhere(scope, metricSource, 'breakdown');
    const availableReportTypes = loadAvailableBusinessMetricReportTypes(allMetrics.sql, allMetrics.params);
    const canonical = adMetricCanonicalWhere(availableReportTypes);
    const canonicalSql = `${allMetrics.sql} AND ${canonical.whereSql}`;
    const byReportType = mainRuntimeContext.state.db.prepare(`
      SELECT
        report_type AS reportType,
        COUNT(*) AS rows,
        ROUND(COALESCE(SUM(cost), 0), 2) AS spend,
        COALESCE(SUM(orders), 0) AS orders,
        ROUND(COALESCE(SUM(sales), 0), 2) AS sales,
        COALESCE(SUM(clicks), 0) AS clicks,
        COALESCE(SUM(impressions), 0) AS impressions
      FROM ad_daily_metrics
      WHERE ${allMetrics.sql}
      GROUP BY report_type
      ORDER BY report_type
    `).all(...allMetrics.params) as any[];
    dbReport = {
      databaseReady: true,
      availableReportTypes,
      canonical: canonical.selection,
      totals: {
        canonical: businessMetricSummaryForExport(canonicalSql, allMetrics.params),
        actionable: businessMetricSummaryForExport(actionableMetrics.sql, actionableMetrics.params),
        breakdown: businessMetricSummaryForExport(breakdownMetrics.sql, breakdownMetrics.params),
      },
      byReportType: byReportType.map((row) => ({
        reportType: row.reportType || 'unknown',
        rows: Number(row.rows || 0),
        spend: roundMoney(row.spend),
        orders: Number(row.orders || 0),
        sales: roundMoney(row.sales),
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
      })),
    };
    if (canonical.selection.warning) blockers.add(canonical.selection.warning);
    if (dbReport.totals.canonical.rows === 0) blockers.add('DB canonical 汇总行数为 0，不能证明广告总盘口径。');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    scope: pipeline.scope,
    sourceBatchIds,
    dbPath: mainRuntimeContext.DB_PATH,
    collection: {
      status: pipeline.collection.status,
      realReportFileCount: pipeline.collection.fileAudit.realReportFileCount,
      importedRowCount: pipeline.collection.fileAudit.importedRowCount,
      missingReportLabels: pipeline.collection.fileAudit.missingReportLabels,
      manifestPath: pipeline.collection.fileAudit.manifestPath,
      downloadDir: pipeline.collection.fileAudit.downloadDir,
    },
    realReportFiles: pipeline.collection.realReportFiles.map((file: any) => ({
      reportType: file.reportType,
      displayName: file.displayName,
      filePath: file.filePath,
      fileSizeBytes: file.fileSizeBytes,
      importedRows: file.importedRows,
      fileHash: file.fileHash,
      status: file.status,
    })),
    quant: {
      summarySource: pipeline.quant.summarySource,
      canonicalRows: pipeline.quant.canonicalRows,
      actionableRows: pipeline.quant.actionableRows,
      breakdownRows: pipeline.quant.breakdownRows,
      totalSpend: roundMoney(pipeline.quant.totalSpend),
      totalSales: roundMoney(pipeline.quant.totalSales),
      totalOrders: Number(pipeline.quant.totalOrders || 0),
      totalClicks: Number(pipeline.quant.totalClicks || 0),
      acos: pipeline.quant.acos,
    },
    db: dbReport,
    blockers: Array.from(blockers).filter(Boolean),
  };

  fs.mkdirSync(mainRuntimeContext.EXPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `data-reconciliation-${safeFileSegment(scope.dateFrom)}_${safeFileSegment(scope.dateTo)}_${safeFileSegment(scope.storeName)}_${safeFileSegment(scope.marketplaceCode)}_${stamp}`;
  const jsonPath = path.join(mainRuntimeContext.EXPORTS_DIR, `${baseName}.json`);
  const markdownPath = path.join(mainRuntimeContext.EXPORTS_DIR, `${baseName}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, buildDataReconciliationMarkdown(report), 'utf8');
  return {
    success: true,
    jsonPath,
    markdownPath,
    canonical: dbReport.totals.canonical,
    canonicalSource: dbReport.canonical.summarySource,
    blockers: report.blockers,
  };
}

export function handleExportDataReconciliationArtifacts(input: unknown) {
  const result = handleExportDataReconciliation(input);
  const store = currentArtifactStore();
  const jsonArtifact = issueRendererArtifact(store.storeId, result.jsonPath, 'export-file', '数据对账 JSON');
  const markdownArtifact = issueRendererArtifact(store.storeId, result.markdownPath, 'export-file', '数据对账 Markdown');
  if (!jsonArtifact || !markdownArtifact) {
    throw new Error('数据对账已导出，但受控工件登记失败。');
  }
  return rendererPayload({
    success: result.success,
    jsonArtifactId: jsonArtifact.artifactId,
    jsonDisplayName: jsonArtifact.displayName,
    markdownArtifactId: markdownArtifact.artifactId,
    markdownDisplayName: markdownArtifact.displayName,
    canonical: result.canonical,
    canonicalSource: result.canonicalSource,
    blockers: result.blockers.map((item: unknown) => rendererSafeDetail(item) || ''),
  });
}
