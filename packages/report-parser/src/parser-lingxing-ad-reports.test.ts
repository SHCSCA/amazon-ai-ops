import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ReportParser } from './parser';

function parseRows(
  rows: Array<Record<string, unknown>>,
  options: { reportType?: string } = {},
) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  return (new ReportParser() as any).parseSheet(
    worksheet,
    'AAO_20260501_20260525_search_term.xlsx',
    options,
  );
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

  it('ignores a paused all-zero Lingxing campaign placeholder without renumbering source rows', () => {
    const result = parseRows([
      {
        '店铺名称': '',
        '国家': '',
        '类型': 'SP',
        '广告组合': 'Dormant portfolio',
        '广告活动': 'Dormant campaign',
        '有效状态': 'paused',
        '日期': '',
        '曝光量': '--',
        '点击': '--',
        'CPC-本币': 0,
        '花费-本币': '--',
        '广告销售额-本币': '--',
        '广告订单': '--',
        'ACoS': '0%',
        'CVR': '0%',
      },
      {
        '店铺名称': 'JF-US',
        '国家': 'US',
        '类型': 'SP',
        '广告组合': 'Active portfolio',
        '广告活动': 'Active campaign',
        '有效状态': 'enabled',
        '日期': '2026-08-17',
        '曝光量': 20,
        '点击': 2,
        'CPC-本币': 1.5,
        '花费-本币': 3,
        '广告销售额-本币': 30,
        '广告订单': 1,
        'ACoS': '10%',
        'CVR': '50%',
      },
    ], { reportType: 'campaign' });

    expect(result).toMatchObject({
      success: true,
      schemaValid: true,
      totalRows: 2,
      validation: {
        valid: true,
        validCount: 1,
        invalidCount: 0,
      },
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      campaignName: 'Active campaign',
      date: '2026-08-17',
      sourceRow: 3,
      reportType: 'campaign',
    });
  });

  it.each([
    ['a non-zero metric', { '曝光量': 1 }],
    ['an invalid metric', { '花费-本币': 'abc' }],
  ])('keeps a blank-date paused row fail-closed when it contains %s', (_label, metricOverride) => {
    const result = parseRows([{
      '店铺名称': '',
      '国家': '',
      '广告活动': 'Dormant campaign',
      '有效状态': 'paused',
      '日期': '',
      '曝光量': 0,
      '点击': 0,
      'CPC-本币': 0,
      '花费-本币': 0,
      '广告销售额-本币': 0,
      '广告订单': 0,
      'ACoS': '0%',
      'CVR': '0%',
      ...metricOverride,
    }], { reportType: 'campaign' });

    expect(result.success).toBe(false);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.invalidCount).toBe(1);
    expect(result.data).toHaveLength(0);
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
        searchTerm: '',
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
        searchTerm: '',
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

  it('imports Lingxing product expressions from a generic targeting column for any US store alias', () => {
    const result = parseRows([
      {
        '店铺名称': 'NOVA-US',
        '国家': 'US',
        '广告活动': 'Campaign A',
        '广告组': 'Ad Group A',
        '投放': '商品:"B0ABCDEF12"',
        '日期': '2026-08-22',
        '曝光量': 20,
        '点击': 2,
        '花费-本币': 3.12,
        '广告订单': 1,
        '广告销售额-本币': 49.99,
      },
    ], { reportType: 'product_targeting' });

    expect(result).toMatchObject({
      success: true,
      schemaValid: true,
      totalRows: 1,
      validation: { valid: true },
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      storeName: 'NOVA-US',
      marketplaceCode: 'US',
      targeting: '商品:"B0ABCDEF12"',
      reportType: 'product_targeting',
    });
  });

  it('reads independent row and cost control totals from provider-owned raw workbook cells', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-control-totals-'));
    const filePath = path.join(dir, 'product-targeting.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['店铺名称', '广告活动', '广告组', '投放', '日期', '曝光量', '花费-本币'],
      ['NOVA-US', 'Campaign A', 'Ad Group A', '商品:"B0ABCDEF12"', '2026-08-21', 20, '3.1200'],
      ['NOVA-US', 'Campaign A', 'Ad Group A', '商品:"B0ZYXWVU98"', '2026-08-22', 10, '1.5600'],
    ]), 'sheet1');
    XLSX.writeFile(workbook, filePath);

    try {
      expect(ReportParser.readLingxingRawReportControlTotals(filePath, {
        dateStart: '2026-08-09',
        dateEnd: '2026-08-22',
      })).toEqual({ expectedRows: 2, expectedCost: 4.68 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('distinguishes a schema-valid zero-row report from an empty or unrelated file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-zero-row-report-'));
    const validPath = path.join(dir, 'keyword-empty.csv');
    const invalidPath = path.join(dir, 'unrelated-empty.csv');
    fs.writeFileSync(
      validPath,
      '日期,广告活动,广告组,关键词,展现量,点击量,花费-本币,广告订单,广告销售额-本币\n',
      'utf8',
    );
    fs.writeFileSync(invalidPath, '备注,负责人\n', 'utf8');

    try {
      const valid = new ReportParser().autoParse(validPath, { reportType: 'keyword' });
      const invalid = new ReportParser().autoParse(invalidPath, { reportType: 'keyword' });

      expect(valid).toMatchObject({
        success: true,
        schemaValid: true,
        totalRows: 0,
        data: [],
      });
      expect(valid.headers).toContain('日期');
      expect(invalid).toMatchObject({
        success: false,
        schemaValid: false,
        totalRows: 0,
        data: [],
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['abc', '2026-05-25', 'cost'],
    ['12USD', '2026-05-25', 'cost'],
    ['12.3.4', '2026-05-25', 'cost'],
    ['1$2', '2026-05-25', 'cost'],
    ['1,2,3', '2026-05-25', 'cost'],
    ['12 34', '2026-05-25', 'cost'],
    ['3.12', '2026-13-40', 'date'],
  ])('rejects invalid metric/date values instead of coercing them to zero: %s / %s', (
    cost,
    date,
    expectedField,
  ) => {
    const result = parseRows([{
      '店铺名称': 'FT-US',
      '广告活动': 'Campaign A',
      '广告组': 'Ad Group A',
      '关键词': 'smart lock',
      '日期': date,
      '曝光量': '20',
      '点击': '2',
      '花费-本币': cost,
      '广告销售额-本币': '49.99',
      '广告订单': '1',
    }]);

    expect(result.success).toBe(false);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: expectedField }),
    ]));
    expect(result.data).toHaveLength(0);
  });

  it('accepts a boundary currency marker and correctly grouped thousands', () => {
    const result = parseRows([{
      '店铺名称': 'FT-US',
      '广告活动': 'Campaign A',
      '广告组': 'Ad Group A',
      '关键词': 'smart lock',
      '日期': '2026-05-25',
      '曝光量': '1,234',
      '点击': '2',
      '花费-本币': '$1,234.50',
      '广告销售额-本币': '$2,000.00',
      '广告订单': '1',
    }], { reportType: 'keyword' });

    expect(result.success).toBe(true);
    expect(result.data[0]).toMatchObject({
      impressions: 1234,
      cost: 1234.5,
      sales: 2000,
      reportType: 'keyword',
    });
  });

  it('parses a real-like auto-targeting report whose generic targeting column has bounded provider values', () => {
    const result = parseRows([
      {
        '店铺名称': 'NOVA-US',
        '国家': 'US',
        '广告活动': 'Campaign A',
        '广告组': 'Ad Group A',
        '投放': '紧密匹配',
        '日期': '2026-08-19',
        '曝光量': '20',
        '点击': '2',
        '花费-本币': '3.12',
        '广告订单': '1',
        '广告销售额-本币': '49.99',
      },
      {
        '店铺名称': 'NOVA-US',
        '国家': 'US',
        '广告活动': 'Campaign A',
        '广告组': 'Ad Group A',
        '投放': '宽泛匹配',
        '日期': '2026-08-19',
        '曝光量': '10',
        '点击': '1',
        '花费-本币': '1.56',
        '广告订单': '0',
        '广告销售额-本币': '0',
      },
    ], { reportType: 'auto_targeting' });

    expect(result).toMatchObject({
      success: true,
      schemaValid: true,
      totalRows: 2,
    });
    expect(result.data).toHaveLength(2);
    expect(result.data.map((row: { targeting: string; reportType?: string }) => ({
      targeting: row.targeting,
      reportType: row.reportType,
    }))).toEqual([
      { targeting: '紧密匹配', reportType: 'auto_targeting' },
      { targeting: '宽泛匹配', reportType: 'auto_targeting' },
    ]);
  });

  it.each([
    ['an ASIN', 'B0ABCDEF12'],
    ['an unknown label', '自定义商品集合'],
  ])('rejects declared auto targeting when the generic targeting column contains %s', (_label, targeting) => {
    const result = parseRows([{
      '店铺名称': 'NOVA-US',
      '国家': 'US',
      '广告活动': 'Campaign A',
      '广告组': 'Ad Group A',
      '投放': targeting,
      '日期': '2026-08-19',
      '曝光量': '20',
      '点击': '2',
      '花费-本币': '3.12',
      '广告订单': '1',
      '广告销售额-本币': '49.99',
    }], { reportType: 'auto_targeting' });

    expect(result).toMatchObject({ success: false, schemaValid: false });
    expect(result.data).toHaveLength(0);
  });

  it.each([false, true])(
    'rejects a filename-declared keyword report whose %s-row columns identify search terms',
    (withDataRow) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-wrong-report-type-'));
      const filePath = path.join(dir, 'keyword_2026-05-01_2026-05-25.csv');
      const lines = [
        '日期,广告活动,广告组,用户搜索词,展现量,点击量,花费,订单,销售额',
      ];
      if (withDataRow) {
        lines.push('2026-05-25,Campaign A,Ad Group A,smart lock,20,2,3.12,1,49.99');
      }
      fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

      try {
        const result = new ReportParser().autoParse(filePath, { reportType: 'keyword' });
        expect(result).toMatchObject({ success: false, schemaValid: false });
        expect(result.data).toHaveLength(0);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
