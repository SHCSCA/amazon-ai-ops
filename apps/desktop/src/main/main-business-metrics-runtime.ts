import { normalizeAdMetricMatchType, mapBusinessAdMetricRow } from './business-metric-projection';
import { AdQuantifier, buildAdMetricObjectIdentity } from '@amazon-ai-ops/rules-engine';
import { adMetricCanonicalWhere } from '@amazon-ai-ops/local-db/src/sqlite/ad-metric-grain';
import { LINGXING_AD_REPORTS } from '@amazon-ai-ops/lingxing-report-collector';
import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import { assertFormalBusinessWorkflowReady, type FormalBusinessWorkflow } from './formal-business-data-gate';
import { assertRuntimeAnalysisWindow, assertRuntimeConfigStore } from './store-runtime-analysis-config';
import { businessMetricsWhere, loadAvailableBusinessMetricReportTypes, metricSourceFileCandidates, normalizeBusinessUiScope, readBusinessMetricSummary } from './main-business-scope-runtime';
import { currentStoreRuntimeAnalysisConfig } from './main-store-access-runtime';
import { handleGetBusinessUiDataPipeline } from './main-business-pipeline-runtime';
import type { BusinessMetricSource, NormalizedBusinessUiScope } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export function loadBusinessQuantSummary(scope: NormalizedBusinessUiScope, realReportFileCount: number, source?: BusinessMetricSource) {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) {
    return {
      hasImportedMetrics: false,
      importedRows: 0,
      canonicalRows: 0,
      actionableRows: 0,
      breakdownRows: 0,
      summarySource: 'blocked',
      summaryWarning: undefined,
      totalSpend: 0,
      totalSales: 0,
      totalOrders: 0,
      totalClicks: 0,
      totalImpressions: 0,
      acos: 0,
      cvr: 0,
      cpc: 0,
      wastedSpend: null,
      highRiskCount: 0,
      adObjectTimelines: [],
      diagnostics: [],
      blockers: ['本地数据库不可用，无法读取广告量化指标。'],
    };
  }

  const allMetrics = businessMetricsWhere(scope, source, 'all');
  const actionableMetrics = businessMetricsWhere(scope, source, 'actionable');
  const breakdownMetrics = businessMetricsWhere(scope, source, 'breakdown');
  const allSummary = readBusinessMetricSummary(allMetrics.sql, allMetrics.params);
  const actionableSummary = readBusinessMetricSummary(actionableMetrics.sql, actionableMetrics.params);
  const breakdownSummary = readBusinessMetricSummary(breakdownMetrics.sql, breakdownMetrics.params);
  const canonical = adMetricCanonicalWhere(
    loadAvailableBusinessMetricReportTypes(allMetrics.sql, allMetrics.params),
  );
  const canonicalSelection = canonical.selection;
  const canonicalSql = `${allMetrics.sql} AND ${canonical.whereSql}`;
  const canonicalSummary = readBusinessMetricSummary(canonicalSql, allMetrics.params);

  const importedRows = Number(allSummary?.importedRows || 0);
  const actionableRows = Number(actionableSummary?.importedRows || 0);
  const breakdownRows = Number(breakdownSummary?.importedRows || 0);
  const canonicalRows = Number(canonicalSummary?.importedRows || 0);
  const summary = canonicalRows > 0 ? canonicalSummary : undefined;
  const summarySource = canonicalRows > 0 ? canonicalSelection.summarySource : 'none';
  const totalSpend = Number(summary?.totalSpend || 0);
  const totalSales = Number(summary?.totalSales || 0);
  const totalOrders = Number(summary?.totalOrders || 0);
  const totalClicks = Number(summary?.totalClicks || 0);
  const totalImpressions = Number(summary?.totalImpressions || 0);
  const acos = totalSales > 0 ? totalSpend / totalSales : 0;
  const cvr = totalClicks > 0 ? totalOrders / totalClicks : 0;
  const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;

  const rows = actionableRows > 0
    ? mainRuntimeContext.state.db.prepare(`
      SELECT
        COALESCE(portfolio_name, '') AS portfolioName,
        COALESCE(campaign_name, '') AS campaignName,
        COALESCE(ad_group_name, '') AS adGroupName,
        COALESCE(asin, '') AS asin,
        COALESCE(report_type, '') AS reportType,
        COALESCE(NULLIF(search_term, ''), NULLIF(targeting, ''), NULLIF(match_type, ''), '-') AS objectName,
        COALESCE(NULLIF(search_term, ''), '') AS searchTerm,
        COALESCE(NULLIF(targeting, ''), '') AS targeting,
        COALESCE(NULLIF(match_type, ''), '') AS matchType,
        MAX(date) AS metricDate,
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(cost), 0) AS spend,
        COALESCE(SUM(sales), 0) AS sales,
        COALESCE(SUM(orders), 0) AS orders,
        COALESCE(SUM(clicks), 0) AS clicks
      FROM ad_daily_metrics
      WHERE ${actionableMetrics.sql}
      GROUP BY portfolio_name, campaign_name, ad_group_name, asin, report_type, objectName
      ORDER BY spend DESC, clicks DESC
      LIMIT 50
    `).all(...actionableMetrics.params) as Array<{
      portfolioName?: string;
      campaignName?: string;
      adGroupName?: string;
      asin?: string;
      reportType?: string;
      objectName?: string;
      searchTerm?: string;
      targeting?: string;
      matchType?: string;
      metricDate?: string;
      impressions?: number;
      spend?: number;
      sales?: number;
      orders?: number;
      clicks?: number;
    }>
    : [];

  const runtimeConfig = currentStoreRuntimeAnalysisConfig();
  assertRuntimeConfigStore(runtimeConfig, scope.storeId);
  assertRuntimeAnalysisWindow(runtimeConfig, scope.dateFrom, scope.dateTo);
  const quantifier = new AdQuantifier(runtimeConfig.ruleConfig);
  const timelineMetrics = actionableRows > 0
    ? mainRuntimeContext.state.db.prepare(`
      SELECT *
      FROM ad_daily_metrics
      WHERE ${actionableMetrics.sql}
      ORDER BY date ASC, campaign_name, ad_group_name, source_row
      LIMIT 3000
    `).all(...actionableMetrics.params).map(mapBusinessAdMetricRow)
    : [];
  const adObjectTimelines = quantifier.quantifyTimeline(timelineMetrics)
    .slice(0, 20)
    .map((timeline) => ({
      objectKey: timeline.objectKey,
      objectType: timeline.objectType,
      objectName: timeline.objectName,
      asin: timeline.asin || undefined,
      campaignName: timeline.campaignName || undefined,
      adGroupName: timeline.adGroupName || undefined,
      dateFrom: timeline.dateFrom,
      dateTo: timeline.dateTo,
      daysActive: timeline.daysActive,
      lifecycleStage: timeline.lifecycleStage,
      quantStatus: timeline.status,
      recommendedAction: timeline.recommendedAction,
      recommendedValue: timeline.recommendedValue,
      trend: timeline.trend,
      totals: timeline.totals,
      thresholds: timeline.thresholdSuggestion,
      reasons: timeline.reasons,
      reviewRequired: timeline.reviewRequired,
    }));
  const diagnostics = rows.map((row) => {
    const spend = Number(row.spend || 0);
    const sales = Number(row.sales || 0);
    const orders = Number(row.orders || 0);
    const clicks = Number(row.clicks || 0);
    const impressions = Number(row.impressions || 0);
    const rowAcos = sales > 0 ? spend / sales : 0;
    const rowCvr = clicks > 0 ? orders / clicks : 0;
    const rowCpc = clicks > 0 ? spend / clicks : 0;
    const metric: AdDailyMetrics = {
      date: row.metricDate || scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: row.asin || '',
      msku: '',
      campaignName: row.campaignName || '',
      adGroupName: row.adGroupName || '',
      targeting: row.targeting || '',
      searchTerm: row.searchTerm || (String(row.reportType || '').includes('search') ? row.objectName || '' : ''),
      matchType: normalizeAdMetricMatchType(row.matchType),
      impressions,
      clicks,
      cost: spend,
      orders,
      sales,
      acos: rowAcos,
      cpc: rowCpc,
      cvr: rowCvr,
      sourceFile: '',
      reportType: row.reportType || '',
    };
    const quant = quantifier.quantify(metric);
    const identity = buildAdMetricObjectIdentity(metric);
    return {
      portfolioName: row.portfolioName || undefined,
      campaignName: row.campaignName || undefined,
      adGroupName: row.adGroupName || undefined,
      asin: row.asin || undefined,
      objectKey: identity.key,
      objectType: identity.objectType,
      objectName: identity.objectName,
      spend,
      sales,
      orders,
      clicks,
      acos: rowAcos,
      cvr: rowCvr,
      cpc: rowCpc,
      quantStatus: quant.status,
      lifecycleStage: quant.lifecycleStage,
      severity: quant.severity,
      recommendedAction: quant.recommendedAction,
      recommendedValue: quant.recommendedValue,
      thresholds: quant.thresholds,
      diagnosis: quant.status === 'waste'
        ? '浪费风险'
        : quant.status === 'scale'
          ? '可扩量候选'
          : quant.status === 'watch'
            ? '观察复核'
            : quant.status === 'blocked'
              ? '样本不足'
              : '健康',
      suggestedDirection: quant.recommendedAction
        ? `${quant.recommendedAction}${quant.recommendedValue ? ` -> ${quant.recommendedValue}` : ''}`
        : quant.reasons[0],
    };
  });

  const blockers: string[] = [];
  if (realReportFileCount === 0) blockers.push('当前范围还没有可量化的真实广告数据');
  if (importedRows === 0) blockers.push('没有真实报表文件和导入指标，本页不生成建议。');
  if (importedRows > 0 && actionableRows === 0) blockers.push('当前范围只有广告活动/广告组/广告位等分解报表，没有关键词、投放或搜索词等可生成建议的行动报表。');
  if (canonicalSelection.warning) blockers.push(canonicalSelection.warning);

  return {
    hasImportedMetrics: actionableRows > 0,
    importedRows,
    canonicalRows,
    actionableRows,
    breakdownRows,
    summarySource,
    summaryWarning: canonicalSelection.warning,
    totalSpend,
    totalSales,
    totalOrders,
    totalClicks,
    totalImpressions,
    acos,
    cvr,
    cpc,
    wastedSpend: importedRows > 0 ? diagnostics.filter((row) => row.sales <= 0).reduce((sum, row) => sum + row.spend, 0) : null,
    highRiskCount: diagnostics.filter((row) => row.quantStatus === 'waste' || row.severity === 'high').length,
    adObjectTimelines,
    diagnostics,
    blockers,
  };
}

export function loadBusinessRecommendationMetrics(scope: NormalizedBusinessUiScope, source: BusinessMetricSource, limit: number): AdDailyMetrics[] {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) return [];
  const { sql, params } = businessMetricsWhere(scope, source);
  const rows = mainRuntimeContext.state.db.prepare(`
    SELECT *
    FROM ad_daily_metrics
    WHERE ${sql}
    ORDER BY date DESC, created_at DESC
    LIMIT ?
  `).all(...params, limit) as any[];
  return rows.map(mapBusinessAdMetricRow);
}

export function loadBusinessCanonicalMetrics(scope: NormalizedBusinessUiScope, source: BusinessMetricSource, limit: number): AdDailyMetrics[] {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) return [];
  const allMetrics = businessMetricsWhere(scope, source, 'all');
  const canonical = adMetricCanonicalWhere(
    loadAvailableBusinessMetricReportTypes(allMetrics.sql, allMetrics.params),
  );
  if (canonical.selection.reportTypes.length === 0) return [];
  const rows = mainRuntimeContext.state.db.prepare(`
    SELECT *
    FROM ad_daily_metrics
    WHERE ${allMetrics.sql}
      AND ${canonical.whereSql}
    ORDER BY date ASC, created_at DESC
    LIMIT ?
  `).all(...allMetrics.params, limit) as any[];
  return rows.map(mapBusinessAdMetricRow);
}

export function getBusinessRecommendationGate(input: unknown, workflow: FormalBusinessWorkflow): {
  scope: NormalizedBusinessUiScope;
  pipeline: ReturnType<typeof handleGetBusinessUiDataPipeline>;
  metricSource: BusinessMetricSource;
} {
  const mainRuntimeContext = getMainRuntimeContext();
  const scope = normalizeBusinessUiScope(input);
  const pipeline = handleGetBusinessUiDataPipeline(scope);
  const batchId = pipeline.collection.latestBatch?.id;
  const realReportBatchIds = Array.from(new Set(
    pipeline.collection.realReportFiles
      .map((file) => file.batchId || batchId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  ));
  assertFormalBusinessWorkflowReady({
    workflow,
    requiredReportTypes: LINGXING_AD_REPORTS.map((report) => report.type),
    realReportFiles: pipeline.collection.realReportFiles,
    collectionJob: realReportBatchIds.length === 1
      ? mainRuntimeContext.state.lingxingImportRepo?.getCollectionJobForStore(scope.storeId, realReportBatchIds[0]!)
      : undefined,
  });
  if (!pipeline.quant.hasImportedMetrics || pipeline.quant.importedRows <= 0) {
    throw new Error('正式业务分析被阻断：当前范围没有由真实报表导入的广告指标行。');
  }
  const batchIds = realReportBatchIds.length
    ? realReportBatchIds
    : (pipeline.collection.sourceBatchIds?.length ? pipeline.collection.sourceBatchIds : (batchId ? [batchId] : []));
  const sourceFiles = pipeline.collection.realReportFiles.flatMap((file) => metricSourceFileCandidates(file.filePath));
  if (batchIds.length === 0 || sourceFiles.length === 0) {
    throw new Error('生成优化建议被阻断：缺少可绑定的当前数据批次或真实报表 source_file。');
  }
  return {
    scope: { ...scope, batchId },
    pipeline,
    metricSource: { batchId, batchIds, sourceFiles },
  };
}
