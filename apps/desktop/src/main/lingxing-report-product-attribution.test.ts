import { describe, expect, it } from 'vitest';
import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import { attachUniqueProductContext } from './lingxing-report-product-attribution';

const metric: AdDailyMetrics = {
  date: '2026-10-01', storeName: 'ISOLATED', marketplaceCode: 'US', asin: 'B000000001', msku: 'sku',
  campaignName: 'campaign', adGroupName: 'group', targeting: '', searchTerm: 'query', matchType: 'exact',
  impressions: 100, clicks: 10, cost: 5, orders: 1, sales: 20, acos: 0.25, cpc: 0.5, cvr: 0.1,
  sourceFile: 'ISOLATED.csv', sourceRow: 2,
};

describe('原生 ASIN 与辅助归属隔离', () => {
  it('在跨日期名称回填之前记录原生缺失，保持既有辅助归属', () => {
    const absent = { ...metric, asin: '', msku: '', date: '2026-10-02' };
    const rows = attachUniqueProductContext([metric, absent]);
    expect(rows[0]!.sourceAsin).toBe(metric.asin);
    expect(rows[1]!.sourceAsin).toBe('');
    expect(rows[1]!.asin).toBe(metric.asin);
    expect(rows[1]!.msku).toBe(metric.msku);
    expect(absent.asin).toBe('');
    expect('sourceAsin' in absent).toBe(false);
  });
  it('没有唯一归属时保留原生缺失，不伪造 ASIN', () => {
    const rows = attachUniqueProductContext([metric, { ...metric, asin: 'B000000002' }, { ...metric, asin: '' }]);
    expect(rows[2]!.asin).toBe('');
    expect(rows[2]!.sourceAsin).toBe('');
  });
  it('重复计算不把已推断 ASIN 升级为原生来源', () => {
    const first = attachUniqueProductContext([metric, { ...metric, asin: '', date: '2026-10-02' }]);
    const second = attachUniqueProductContext(first);
    expect(second).toEqual(first);
    expect(second[1]!.sourceAsin).toBe('');
    expect(second[1]!.asin).toBe(metric.asin);
  });
});
