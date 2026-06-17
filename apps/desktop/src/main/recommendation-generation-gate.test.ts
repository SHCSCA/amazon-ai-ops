import { describe, expect, it } from 'vitest';
import { assertRecommendationMetricsLoaded, filterFormalRecommendationMetrics } from './recommendation-generation-gate';

describe('recommendation generation gate', () => {
  it('blocks recommendation generation when real files exist but no scoped daily metrics can be loaded', () => {
    expect(() => assertRecommendationMetricsLoaded({
      metricsLength: 0,
      realReportFileCount: 8,
      sourceFileCount: 8,
      sourceRowCount: 0,
      importedRows: 1694,
    })).toThrow(/当前范围缺少可绑定的日级广告指标/);
  });

  it('allows recommendation generation when scoped daily metrics are loaded', () => {
    expect(() => assertRecommendationMetricsLoaded({
      metricsLength: 12,
      realReportFileCount: 8,
      sourceFileCount: 8,
      sourceRowCount: 12,
      sourceFileRowCount: 12,
      asinBoundCount: 12,
      importedRows: 1694,
    })).not.toThrow();
  });

  it('blocks formal recommendation generation when scoped metrics cannot be bound to product ASINs', () => {
    expect(() => assertRecommendationMetricsLoaded({
      metricsLength: 12,
      realReportFileCount: 8,
      requiredReportCount: 8,
      sourceFileCount: 8,
      sourceRowCount: 12,
      sourceFileRowCount: 12,
      asinBoundCount: 11,
      importedRows: 1694,
    })).toThrow(/缺少可绑定产品 ASIN/);
  });

  it('allows formal recommendation generation when the current scope provides the product ASIN binding', () => {
    expect(() => assertRecommendationMetricsLoaded({
      metricsLength: 12,
      realReportFileCount: 8,
      requiredReportCount: 8,
      sourceFileCount: 8,
      sourceRowCount: 12,
      sourceFileRowCount: 12,
      asinBoundCount: 0,
      scopeAsin: 'B0TESTASIN',
      importedRows: 1694,
    })).not.toThrow();
  });

  it('blocks recommendation generation when metrics exist without current real report files', () => {
    expect(() => assertRecommendationMetricsLoaded({
      metricsLength: 12,
      realReportFileCount: 0,
      sourceFileCount: 8,
      sourceRowCount: 12,
      sourceFileRowCount: 12,
      importedRows: 1694,
    })).toThrow(/当前范围缺少真实广告报表/);
  });

  it('blocks recommendation generation when metrics exist but cannot be traced to source files', () => {
    expect(() => assertRecommendationMetricsLoaded({
      metricsLength: 12,
      realReportFileCount: 8,
      sourceFileCount: 0,
      sourceRowCount: 12,
      sourceFileRowCount: 0,
      importedRows: 1694,
    })).toThrow(/缺少可回查 source_file/);
  });

  it('blocks recommendation generation when loaded metrics do not all have source rows', () => {
    expect(() => assertRecommendationMetricsLoaded({
      metricsLength: 12,
      realReportFileCount: 8,
      sourceFileCount: 8,
      sourceRowCount: 11,
      sourceFileRowCount: 11,
      importedRows: 1694,
    })).toThrow(/缺少可回查 source_row/);
  });

  it('blocks recommendation generation when some metrics have a row number but no source file', () => {
    expect(() => assertRecommendationMetricsLoaded({
      metricsLength: 12,
      realReportFileCount: 8,
      sourceFileCount: 8,
      sourceRowCount: 12,
      sourceFileRowCount: 11,
      importedRows: 1694,
    })).toThrow(/缺少同时可回查 source_file 和 source_row 的指标行/);
  });

  it('blocks formal recommendation generation until the required 8 real report files are present', () => {
    expect(() => assertRecommendationMetricsLoaded({
      metricsLength: 12,
      realReportFileCount: 4,
      requiredReportCount: 8,
      sourceFileCount: 4,
      sourceRowCount: 12,
      sourceFileRowCount: 12,
      importedRows: 512,
    })).toThrow(/当前范围只找到 4\/8 类真实广告报表/);
  });

  it('allows diagnosis-only AI analysis with partial real report coverage when metrics remain traceable', () => {
    expect(() => assertRecommendationMetricsLoaded({
      metricsLength: 12,
      realReportFileCount: 4,
      requiredReportCount: 8,
      requireFullReportCoverage: false,
      sourceFileCount: 4,
      sourceRowCount: 12,
      sourceFileRowCount: 12,
      importedRows: 512,
    })).not.toThrow();
  });

  it('filters out unbound metrics before formal recommendation generation when scope ASIN is not selected', () => {
    const metrics = filterFormalRecommendationMetrics([
      { asin: 'B0AAA', date: '2026-06-11', storeName: 'FT-US-US', marketplaceCode: 'US' } as any,
      { asin: '', date: '2026-06-11', storeName: 'FT-US-US', marketplaceCode: 'US' } as any,
      { date: '2026-06-11', storeName: 'FT-US-US', marketplaceCode: 'US' } as any,
    ]);

    expect(metrics).toHaveLength(1);
    expect(metrics[0].asin).toBe('B0AAA');
  });

  it('keeps traceable metrics when the current scope explicitly supplies the ASIN binding', () => {
    const metrics = filterFormalRecommendationMetrics([
      { asin: '', date: '2026-06-11', storeName: 'FT-US-US', marketplaceCode: 'US' } as any,
    ], 'B0SCOPE');

    expect(metrics).toHaveLength(1);
  });
});
