import { describe, expect, it } from 'vitest';
import { buildScopeSummaryFacts, formatBatchOption } from './scope-bar';

describe('formatBatchOption', () => {
  it('describes batch coverage by report type and imported metric rows', () => {
    expect(formatBatchOption({
      id: 'batch_20260612',
      status: 'completed',
      dateStart: '2026-06-01',
      dateEnd: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      totalFileRecords: 8,
      realReportFileCount: 8,
      importedRowCount: 96,
      missingReportLabels: [],
    })).toBe('batch_20260612 · 8/8 类真实报表 · 96 行已导入');
  });

  it('does not leak undefined when batch counters are missing', () => {
    const label = formatBatchOption({
      id: 'batch_incomplete',
      status: 'completed',
      dateStart: '2026-06-01',
      dateEnd: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      totalFileRecords: undefined,
      realReportFileCount: undefined,
      importedRowCount: undefined,
      missingReportLabels: [],
    } as any);

    expect(label).toBe('batch_incomplete · 报表覆盖待校验 · 指标待校验');
    expect(label).not.toContain('undefined');
  });

  it('separates report type coverage from duplicate file count', () => {
    expect(formatBatchOption({
      id: 'batch_duplicate_files',
      status: 'completed',
      dateStart: '2026-06-01',
      dateEnd: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      totalFileRecords: 16,
      realReportFileCount: 16,
      importedRowCount: 120,
      missingReportLabels: [],
    } as any)).toBe('batch_duplicate_files · 8/8 类真实报表 · 16 个文件 · 120 行已导入');
  });
});

describe('buildScopeSummaryFacts', () => {
  it('keeps the always-visible scope bar to four compact facts', () => {
    expect(buildScopeSummaryFacts({
      batchId: 'batch_20260612',
      batchModeLabel: '自动使用当前范围最新完整批次',
      reportCoverage: '8/8 类真实报表',
      importedRows: '96 行',
      asin: 'B0TESTASIN',
    })).toEqual([
      { label: '批次', value: 'batch_20260612', title: '自动使用当前范围最新完整批次' },
      { label: '报表', value: '8/8 类真实报表' },
      { label: '指标', value: '96 行' },
      { label: 'ASIN', value: 'B0TESTASIN' },
    ]);
  });

  it('uses short placeholders instead of long guidance when no batch or ASIN is selected', () => {
    expect(buildScopeSummaryFacts({
      batchModeLabel: '自动匹配当前范围',
      reportCoverage: '暂无匹配批次',
      importedRows: '0 行',
    }).map((fact) => fact.value)).toEqual(['自动匹配', '暂无匹配批次', '0 行', '全部产品']);
  });
});
