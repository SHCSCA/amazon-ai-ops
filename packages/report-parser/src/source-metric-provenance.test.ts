import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { AD_SOURCE_METRIC_BITS, AD_SOURCE_METRIC_MASK_ALL } from '@amazon-ai-ops/shared-types';
import { sourceMetricMaskForRow } from './validators';
import { sourceMetricMaskForWorksheetRow } from './source-metric-provenance';
import { ReportParser } from './parser';

describe('原始指标单元格来源', () => {
  it('区分缺失、显式零和有效本币数字', () => {
    expect(sourceMetricMaskForRow({ impressions: 0, clicks: '0', cost: '$0.00', orders: 0, sales: '1,234.50' })).toBe(AD_SOURCE_METRIC_MASK_ALL);
    expect(sourceMetricMaskForRow({ impressions: '', clicks: null, cost: undefined, orders: ' ', sales: '\t' })).toBe(0);
    expect(sourceMetricMaskForRow({ cost: '$1.00' })).toBe(AD_SOURCE_METRIC_BITS.cost);
  });
  it.each([NaN, Infinity, -1, true, '1$2', '1,2,3', '12 34', '10%', '¥10', '￥10'])('不认证非法来源 %s', (value) => {
    expect(sourceMetricMaskForRow({ impressions: value, clicks: value, cost: value, orders: value, sales: value })).toBe(0);
  });
  it('计数来源拒绝币种标记', () => {
    expect(sourceMetricMaskForRow({ impressions: '$10', clicks: '$0', orders: '$1', cost: '$1', sales: '$0' })).toBe(20);
  });
  it('计数字段只接受安全整数', () => {
    expect(sourceMetricMaskForRow({ impressions: 0.5, clicks: Number.MAX_SAFE_INTEGER + 1, orders: -0.5, cost: 0.5, sales: 0.5 })).toBe(20);
  });
  it('真实 Sheet 解析在默认零之前保留位图', () => {
    const sheet = XLSX.utils.json_to_sheet([{ date: '2026-10-01', storeName: 'isolated', campaignName: 'isolated', asin: 'B000000001', impressions: '', clicks: 0, cost: '$0.00', orders: '', sales: 12 }]);
    const parsed = (new ReportParser() as any).parseSheet(sheet, 'isolated.xlsx', {});
    expect(parsed.success).toBe(true);
    expect(parsed.data[0]).toMatchObject({ impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 12, sourceMetricMask: 22 });
  });
});


describe('原始 worksheet 单位与物理行', () => {
  it.each(['0%', '€0.00', '¥0.00', '£0.00', 'yyyy-mm-dd', '0.00"kg"'])('不认证格式 %s', (z) => {
    const sheet = XLSX.utils.aoa_to_sheet([['cost'], [1]]);
    sheet.A2.z = z;
    expect(sourceMetricMaskForWorksheetRow({ cost: 1 }, sheet, 2)).toBe(0);
  });
  it('公式缓存不冒充原始数值', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['cost'], [1]]);
    sheet.A2.f = '1+0';
    expect(sourceMetricMaskForWorksheetRow({ cost: 1 }, sheet, 2)).toBe(0);
  });
  it('中间空白行不改变真实来源行号', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['date', 'storeName', 'campaignName', 'asin', 'impressions', 'clicks', 'cost', 'orders', 'sales'],
      ['2026-10-01', 'isolated', 'isolated', 'B000000001', 1, 1, 1, 1, 1], [],
      ['2026-10-02', 'isolated', 'isolated', 'B000000001', 1, 1, 1, 1, 1],
    ]);
    sheet.G4.z = '0%';
    const parsed = (new ReportParser() as any).parseSheet(sheet, 'isolated.xlsx', {});
    expect(parsed.data.map((row: any) => row.sourceRow)).toEqual([2, 4]);
    expect(parsed.data.map((row: any) => row.sourceMetricMask)).toEqual([31, 27]);
  });
});


describe('文件解析保留来源格式和物理行', () => {
  it('XLSX 实际读取保留百分比格式且不改变日期', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-metric-source-'));
    try {
      const sheet = XLSX.utils.aoa_to_sheet([
        ['date', 'storeName', 'campaignName', 'asin', 'impressions', 'clicks', 'cost', 'orders', 'sales'],
        ['2026-10-01', 'isolated', 'isolated', 'B000000001', 1, 1, 1, 1, 1],
      ]);
      sheet.G2.z = '0%';
      const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Report');
      const file = path.join(dir, 'isolated.xlsx'); fs.writeFileSync(file, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
      const parsed = new ReportParser().parseExcel(file);
      expect(parsed.success).toBe(true);
      expect(parsed.data[0]).toMatchObject({ sourceRow: 2, sourceMetricMask: 27, date: '2026-10-01' });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('CSV 空行和空列不压缩来源行号', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-metric-source-'));
    try {
      const file = path.join(dir, 'isolated.csv');
      fs.writeFileSync(file, [
        'date,storeName,campaignName,asin,impressions,clicks,cost,orders,sales,',
        '2026-10-01,isolated,isolated,B000000001,1,1,1,1,1,', '',
        '2026-10-02,isolated,isolated,B000000001,1,1,0,1,1,',
      ].join('\n'));
      const parsed = new ReportParser().parseCSV(file);
      expect(parsed.success).toBe(true);
      expect(parsed.data.map(row => [row.sourceRow, row.sourceMetricMask])).toEqual([[2, 31], [4, 31]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
