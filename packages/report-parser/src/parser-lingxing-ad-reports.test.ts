import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
      currency: 'USD',
      sourceRow: 2,
    });
  });

  it('parses UTF-8 Chinese CSV headers and keeps caller-provided report type for localized filenames', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-report-parser-'));
    const filePath = path.join(dir, '领星广告数据_2026-05-01_2026-05-25.csv');
    fs.writeFileSync(
      filePath,
      [
        '日期,店铺名称,国家,广告活动,广告组,关键词,匹配方式,展现量,点击量,花费-本币,广告订单,广告销售额-本币',
        '2026-05-01,FT-US-US,US,Campaign A,Ad Group A,smart lock,exact,100,10,12.50,1,30.00',
        '2026-05-02,FT-US-US,US,Campaign A,Ad Group A,keypad lock,phrase,80,8,8.25,0,0',
      ].join('\n'),
      'utf8',
    );

    try {
      const result = new ReportParser().autoParse(filePath, { reportType: 'keyword' });

      expect(result.success).toBe(true);
      expect(result.headers).toContain('日期');
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toMatchObject({
        date: '2026-05-01',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        campaignName: 'Campaign A',
        adGroupName: 'Ad Group A',
        targeting: 'smart lock',
        searchTerm: 'smart lock',
        impressions: 100,
        clicks: 10,
        cost: 12.5,
        orders: 1,
        sales: 30,
        currency: 'USD',
        sourceRow: 2,
        reportType: 'keyword',
      });
      expect(result.data[1]).toMatchObject({
        date: '2026-05-02',
        targeting: 'keypad lock',
        cost: 8.25,
        orders: 0,
        sales: 0,
        sourceRow: 3,
        reportType: 'keyword',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
