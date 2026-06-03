import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { describe, expect, test } from 'vitest';
import { keywordMetricDiagnosticsToCsv, parseKeywordMetrics, parseKeywordMetricsWithDiagnostics } from './keyword-metrics';

function writeWorkbook(rows: Record<string, unknown>[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-keywords-'));
  const filePath = path.join(dir, 'search-term-report.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'SearchTerms');
  XLSX.writeFile(workbook, filePath);
  return filePath;
}

describe('parseKeywordMetrics', () => {
  test('maps search term report rows into keyword metrics', () => {
    const filePath = writeWorkbook([
      {
        ASIN: 'B012345678',
        'Search Term': ' Stainless Garlic Press ',
        Impressions: 1000,
        Clicks: 50,
        Spend: 25,
        Orders: 5,
        Sales: 125,
      },
    ]);

    const metrics = parseKeywordMetrics(filePath, { source: 'search_term' });

    expect(metrics).toEqual([
      expect.objectContaining({
        asin: 'B012345678',
        rawKeyword: 'Stainless Garlic Press',
        normalizedKeyword: 'stainless garlic press',
        source: 'search_term',
        impressions: 1000,
        clicks: 50,
        cost: 25,
        orders: 5,
        sales: 125,
        acos: 0.2,
        cvr: 0.1,
        sourceRow: 2,
      }),
    ]);
  });

  test('uses caller-provided field mappings', () => {
    const filePath = writeWorkbook([
      {
        Product: 'B012345678',
        QueryText: 'compact garlic mincer',
        Views: 900,
        Taps: 45,
        SpendAmount: 18,
        PurchaseCount: 3,
        Revenue: 90,
      },
    ]);

    const metrics = parseKeywordMetrics(filePath, {
      source: 'sqp',
      fieldMapping: {
        asin: ['Product'],
        rawKeyword: ['QueryText'],
        impressions: ['Views'],
        clicks: ['Taps'],
        cost: ['SpendAmount'],
        orders: ['PurchaseCount'],
        sales: ['Revenue'],
      },
    });

    expect(metrics[0]).toEqual(expect.objectContaining({
      asin: 'B012345678',
      rawKeyword: 'compact garlic mincer',
      normalizedKeyword: 'compact garlic mincer',
      source: 'sqp',
      impressions: 900,
      clicks: 45,
      cost: 18,
      orders: 3,
      sales: 90,
    }));
  });

  test('fails when the critical keyword column is missing', () => {
    const filePath = writeWorkbook([
      {
        ASIN: 'B012345678',
        Impressions: 1000,
        Clicks: 50,
      },
    ]);

    expect(() => parseKeywordMetrics(filePath, { source: 'search_term' }))
      .toThrow('缺少关键字段 rawKeyword');
  });

  test('fails the import when more than five percent of rows are invalid', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      'Search Term': index < 18 ? `keyword ${index}` : '',
      Impressions: 100,
      Clicks: 10,
      Spend: 5,
      Orders: 1,
      Sales: 20,
    }));
    const filePath = writeWorkbook(rows);

    expect(() => parseKeywordMetrics(filePath, { source: 'search_term' }))
      .toThrow('超过 5.00% 阈值');
  });

  test('keeps importing when invalid rows are at the five percent threshold', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      'Search Term': index < 19 ? `keyword ${index}` : '',
      Impressions: 100,
      Clicks: 10,
      Spend: 5,
      Orders: 1,
      Sales: 20,
    }));
    const filePath = writeWorkbook(rows);

    const result = parseKeywordMetricsWithDiagnostics(filePath, { source: 'search_term' });

    expect(result.metrics).toHaveLength(19);
    expect(result.diagnostics.invalidRows).toBe(1);
    expect(result.diagnostics.invalidRowRatio).toBe(0.05);
    expect(result.diagnostics.errors[0]).toEqual(expect.objectContaining({
      row: 21,
      field: 'rawKeyword',
    }));
  });

  test('treats uncleanable core numeric cells as invalid rows', () => {
    const filePath = writeWorkbook([
      {
        'Search Term': 'garlic press',
        Impressions: 'not a number',
        Clicks: 10,
        Spend: 5,
        Orders: 1,
        Sales: 20,
      },
      ...Array.from({ length: 19 }, (_, index) => ({
        'Search Term': `keyword ${index}`,
        Impressions: 100,
        Clicks: 10,
        Spend: 5,
        Orders: 1,
        Sales: 20,
      })),
    ]);

    const result = parseKeywordMetricsWithDiagnostics(filePath, { source: 'search_term' });

    expect(result.metrics).toHaveLength(19);
    expect(result.diagnostics.invalidRows).toBe(1);
    expect(result.diagnostics.errors[0]).toEqual(expect.objectContaining({
      row: 2,
      field: 'impressions',
      severity: 'error',
    }));
  });

  test('treats symbol-only core numeric cells as invalid rows after cleaning', () => {
    const filePath = writeWorkbook([
      {
        'Search Term': 'garlic press',
        Impressions: '$',
        Clicks: 10,
        Spend: 5,
        Orders: 1,
        Sales: 20,
      },
      ...Array.from({ length: 19 }, (_, index) => ({
        'Search Term': `keyword ${index}`,
        Impressions: 100,
        Clicks: 10,
        Spend: 5,
        Orders: 1,
        Sales: 20,
      })),
    ]);

    const result = parseKeywordMetricsWithDiagnostics(filePath, { source: 'search_term' });

    expect(result.metrics).toHaveLength(19);
    expect(result.diagnostics.invalidRows).toBe(1);
    expect(result.diagnostics.errors[0]).toEqual(expect.objectContaining({
      row: 2,
      field: 'impressions',
      value: '$',
    }));
  });

  test('keeps warnings for missing optional fields and unparseable numeric cells', () => {
    const filePath = writeWorkbook([
      {
        'Search Term': 'garlic press',
        Impressions: 100,
        Clicks: 10,
        Spend: 5,
        Orders: 1,
        Sales: '￥1，234.56',
        ACOS: 'not a number',
      },
      {
        'Search Term': 'steel mincer',
        Impressions: 100,
        Clicks: '',
        Spend: 5,
        Orders: 1,
        Sales: 20,
      },
    ]);

    const result = parseKeywordMetricsWithDiagnostics(filePath, { source: 'search_term' });

    expect(result.metrics).toHaveLength(2);
    expect(result.metrics[0].impressions).toBe(100);
    expect(result.diagnostics).toEqual(expect.objectContaining({
      totalRows: 2,
      parsedRows: 2,
      invalidRows: 0,
      invalidRowRatio: 0,
    }));
    expect(result.metrics[0].sales).toBe(1234.56);
    expect(result.diagnostics.warnings.map((warning) => warning.field)).toEqual(expect.arrayContaining([
      'clicks',
      'acos',
    ]));
  });

  test('does not warn about missing SQP cost or ACOS columns', () => {
    const filePath = writeWorkbook([
      {
        'Search Query': 'compact garlic mincer',
        Impressions: 900,
        Clicks: 45,
        Purchases: 3,
        Sales: 90,
      },
    ]);

    const result = parseKeywordMetricsWithDiagnostics(filePath, { source: 'sqp' });

    expect(result.metrics[0]).toEqual(expect.objectContaining({
      source: 'sqp',
      cost: 0,
      acos: 0,
    }));
    expect(result.diagnostics.warnings.map((warning) => warning.field)).not.toContain('cost');
    expect(result.diagnostics.warnings.map((warning) => warning.field)).not.toContain('acos');
    expect(result.diagnostics.warnings.map((warning) => warning.field)).toContain('cvr');
  });

  test('exports parse diagnostics as formula-safe CSV', () => {
    const csv = keywordMetricDiagnosticsToCsv({
      totalRows: 2,
      parsedRows: 1,
      invalidRows: 1,
      invalidRowRatio: 0.5,
      errors: [{
        row: 2,
        field: 'rawKeyword',
        severity: 'error',
        message: '=bad formula',
        value: '+bad value',
      }],
      warnings: [{
        row: 0,
        field: 'clicks',
        severity: 'warning',
        message: '\t=hidden formula',
      }],
    });

    expect(csv).toContain('severity,row,field,message,value');
    expect(csv).toContain('"\'=bad formula"');
    expect(csv).toContain(`"'+bad value"`);
    expect(csv).toContain('"warning","0","clicks","\'\t=hidden formula",""');
  });
});
