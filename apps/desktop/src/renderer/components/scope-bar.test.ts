import { describe, expect, it } from 'vitest';
import { formatBatchOption } from './scope-bar';

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
});
