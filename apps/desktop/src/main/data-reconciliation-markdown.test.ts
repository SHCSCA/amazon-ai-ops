import { describe, expect, it } from 'vitest';
import { buildDataReconciliationMarkdown } from './data-reconciliation-markdown';

describe('data reconciliation rendering', () => {
  it('keeps canonical totals separate from per-report facts and readiness', () => {
    const result = buildDataReconciliationMarkdown({ generatedAt: '2026-10-16T00:00:00Z',
      scope: { dateFrom: '2026-10-01', dateTo: '2026-10-07', storeName: '示例', marketplaceCode: 'US' },
      sourceBatchIds: ['batch-1'], db: { totals: { canonical: { rows: 7, spend: 12, sales: 34 } },
        byReportType: [{ reportType: 'keyword', rows: 7, spend: 12, orders: 1, sales: 34 }] }, blockers: ['缺少真实执行'] });
    expect(result).toContain('Spend: 12 USD');
    expect(result).toContain('keyword: 7 rows');
    expect(result).toContain('缺少真实执行');
    expect(result).toContain('Do not add campaign/ad_group/placement/advertised_product totals');
    expect(result).toContain('final readiness manifest');
  });
});
