import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { ReportParser } from './parser';

function parseRows(rows: Array<Record<string, unknown>>) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  return (new ReportParser() as any).parseSheet(worksheet, 'AAO_20260501_20260525_search_term.xlsx', {});
}

describe('ReportParser Lingxing ad report rows', () => {
  it('keeps executable search-term rows even when the report has no ASIN column', () => {
    const result = parseRows([
      {
        '店铺名称': 'FT-US',
        '国家': 'US',
        '广告组合': 'D6-20260518',
        '广告活动': 'D6-精准-首轮投测词 - 5/18/2026',
        '广告组': 'D6-手动精准-卧室核心长尾 - 5/18/2026',
        '关键词': 'keypad door lock with handle',
        '用户搜索词': 'keypad door lock with handle',
        '匹配方式': '精准匹配',
        '日期': '2026-05-25',
        '曝光量': '20',
        '点击': '2',
        'CPC-本币': '1.56',
        '花费-本币': '3.12',
        '广告销售额-本币': '49.99',
        '广告订单': '1',
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      date: '2026-05-25',
      storeName: 'FT-US',
      marketplaceCode: 'US',
      campaignName: 'D6-精准-首轮投测词 - 5/18/2026',
      adGroupName: 'D6-手动精准-卧室核心长尾 - 5/18/2026',
      targeting: 'keypad door lock with handle',
      searchTerm: 'keypad door lock with handle',
      impressions: 20,
      clicks: 2,
      cost: 3.12,
      orders: 1,
      sales: 49.99,
      asin: '',
    });
  });
});
