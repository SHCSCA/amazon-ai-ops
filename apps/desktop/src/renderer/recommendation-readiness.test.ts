import { describe, expect, it } from 'vitest';
import { buildRecommendationGateIssues, resolveRecommendationBatchId } from './recommendation-readiness';

describe('buildRecommendationGateIssues', () => {
  it('blocks formal recommendations when the current scope has only partial real report coverage', () => {
    const issues = buildRecommendationGateIssues({
      requiredReportCount: 8,
      realReportFileCount: 4,
      realReportFilesLength: 4,
      importedReportTypeCount: 4,
      importedRowCount: 512,
      quantImportedRows: 512,
      hasImportedMetrics: true,
      currentBatchId: 'batch_partial',
      collectionBlockers: [],
      quantBlockers: [],
    });

    expect(issues).toContain('当前范围只完成 4/8 类真实广告报表，需补齐 8 类后才能生成正式建议');
    expect(issues).toContain('当前范围只完成 4/8 类逐类入库，需补齐 8 类后才能生成正式建议');
  });

  it('blocks formal recommendations when files are complete but only some report types are imported', () => {
    const issues = buildRecommendationGateIssues({
      requiredReportCount: 8,
      realReportFileCount: 8,
      realReportFilesLength: 8,
      importedReportTypeCount: 5,
      importedRowCount: 1879,
      quantImportedRows: 1879,
      hasImportedMetrics: true,
      currentBatchId: 'batch_partial_import',
      collectionBlockers: [],
      quantBlockers: [],
    });

    expect(issues).toContain('当前范围只完成 5/8 类逐类入库，需补齐 8 类后才能生成正式建议');
  });

  it('allows recommendation generation when full report coverage and imported metrics are present', () => {
    expect(buildRecommendationGateIssues({
      requiredReportCount: 8,
      realReportFileCount: 8,
      realReportFilesLength: 8,
      importedReportTypeCount: 8,
      importedRowCount: 1694,
      quantImportedRows: 1694,
      hasImportedMetrics: true,
      currentBatchId: 'batch_full',
      collectionBlockers: [],
      quantBlockers: [],
    })).toEqual([]);
  });

  it('uses source batch ids as the current batch fallback when latest batch is not populated', () => {
    expect(resolveRecommendationBatchId({
      scopeBatchId: '',
      latestBatchId: '',
      sourceBatchIds: ['batch_from_source'],
    })).toBe('batch_from_source');
  });
});
