import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';

export interface RecommendationMetricsGateInput {
  metricsLength: number;
  realReportFileCount: number;
  requiredReportCount?: number;
  requireFullReportCoverage?: boolean;
  sourceFileCount: number;
  sourceRowCount: number;
  sourceFileRowCount?: number;
  asinBoundCount?: number;
  scopeAsin?: string;
  importedRows: number;
}

export function filterFormalRecommendationMetrics(metrics: AdDailyMetrics[], scopeAsin?: string): AdDailyMetrics[] {
  if (String(scopeAsin || '').trim()) {
    return metrics;
  }
  return metrics.filter((metric) => String(metric.asin || '').trim().length > 0);
}

export function assertRecommendationMetricsLoaded(input: RecommendationMetricsGateInput): void {
  const requiredReportCount = Math.max(0, Number(input.requiredReportCount || 0));
  const requireFullReportCoverage = input.requireFullReportCoverage !== false;
  if (
    requireFullReportCoverage
    && requiredReportCount > 0
    && input.realReportFileCount > 0
    && input.realReportFileCount < requiredReportCount
  ) {
    throw new Error(
      `生成优化建议被阻断：当前范围只找到 ${input.realReportFileCount}/${requiredReportCount} 类真实广告报表，不能生成正式 AI+规则建议。请先补齐当前范围 8 类 Lingxing 广告报表并导入 DB。`,
    );
  }

  if (input.metricsLength > 0) {
    if (input.realReportFileCount <= 0) {
      throw new Error(
        '生成优化建议被阻断：当前范围缺少真实广告报表文件，不能仅凭历史 DB 指标生成正式建议。请先完成当前范围数据采集或导入本地 xlsx/xls/csv。',
      );
    }
    if (input.importedRows <= 0) {
      throw new Error(
        '生成优化建议被阻断：当前范围缺少导入后的日级广告指标，不能运行 AI+规则建议。请先完成数据导入。',
      );
    }
    if (input.sourceFileCount <= 0) {
      throw new Error(
        '生成优化建议被阻断：当前范围指标缺少可回查 source_file，不能生成正式建议。请回到数据导入与校验页重新导入真实报表。',
      );
    }
    if (input.sourceRowCount < input.metricsLength) {
      throw new Error(
        '生成优化建议被阻断：当前范围指标缺少可回查 source_row，不能生成正式建议。请重新导入真实报表，确保每条日级指标保留原始表格行号。',
      );
    }
    if (Number(input.sourceFileRowCount ?? input.metricsLength) < input.metricsLength) {
      throw new Error(
        '生成优化建议被阻断：当前范围指标缺少同时可回查 source_file 和 source_row 的指标行，不能生成正式建议。请重新导入真实报表，确保每条日级指标都能回到原始表格文件和行号。',
      );
    }
    if (!String(input.scopeAsin || '').trim() && Number(input.asinBoundCount ?? input.metricsLength) < input.metricsLength) {
      throw new Error(
        '生成优化建议被阻断：当前范围指标缺少可绑定产品 ASIN，不能生成正式建议。请按 ASIN 设置当前操作范围，或重新导入包含 ASIN 的真实报表指标。',
      );
    }
    return;
  }

  if (input.realReportFileCount > 0 && input.importedRows > 0 && input.sourceFileCount > 0) {
    throw new Error(
      '生成优化建议被阻断：当前范围缺少可绑定的日级广告指标。请回到数据导入与校验页，确认真实报表 source_file、批次、店铺、站点和日期范围与 DB 指标一致。',
    );
  }

  throw new Error(
    '生成优化建议被阻断：当前范围缺少真实广告报表或导入后的日级广告指标，不能运行 AI+规则建议。请先完成数据采集和导入。',
  );
}
