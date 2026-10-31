import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportParser, parseReportBytes, readRawControlTotalsBytes } from './parser';
import { parseKeywordMetrics, parseKeywordMetricsBytes, parseKeywordMetricsWithDiagnostics } from './keyword-metrics';
import { parseListingContent, parseListingContentBytes } from './listing-content';
import { observeOwnerConfirmedFamily, type OwnerConfirmedFamilyScope } from './family-observation';
import { readBoundedReportFileBytes, readReportHeaderRowsBytes } from './report-workbook-reader';
import { normalWorkbook } from './report-resource.test-fixture';

vi.mock('xlsx', async importOriginal => {
  const actual = await importOriginal<typeof import('xlsx')>();
  return { ...actual, read: vi.fn(actual.read), utils: { ...actual.utils, sheet_to_json: vi.fn(actual.utils.sheet_to_json) } };
});
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readSync: vi.fn(actual.readSync), closeSync: vi.fn(actual.closeSync) };
});
const window = { dateStart: '2026-10-01', dateEnd: '2026-10-02' };
const resource = { limits: { maxInputBytes: 1 } };
const directories: string[] = [];
beforeEach(() => { vi.mocked(XLSX.read).mockClear(); vi.mocked(XLSX.utils.sheet_to_json).mockClear(); });
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== path.resolve(os.tmpdir())) throw new Error('拒绝清理非隔离测试目录。');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
function unchanged(): void {
  expect(XLSX.read).not.toHaveBeenCalled(); expect(XLSX.utils.sheet_to_json).not.toHaveBeenCalled();
}
describe('所有纯字节入口共用解析前预算', () => {
  it('纯字节接口拒绝映射目录，不能让解析进程读取路径', () => {
    const bytes = normalWorkbook();
    expect(() => parseKeywordMetricsBytes(bytes, 'isolated.xlsx', { fieldMappingsDir: '/unavailable' })).toThrow(/REPORT_PARSE_OPTIONS_INVALID/);
    expect(() => parseListingContentBytes(bytes, 'isolated.xlsx', { fieldMappingsDir: '/unavailable' })).toThrow(/REPORT_PARSE_OPTIONS_INVALID/);
    unchanged();
  });
  it.each([
    ['canonical', (bytes: Uint8Array) => parseReportBytes(bytes, 'isolated.xlsx', {}, resource)],
    ['control totals', (bytes: Uint8Array) => readRawControlTotalsBytes(bytes, 'isolated.xlsx', window, resource)],
    ['keyword', (bytes: Uint8Array) => parseKeywordMetricsBytes(bytes, 'isolated.xlsx', {}, resource)],
    ['listing', (bytes: Uint8Array) => parseListingContentBytes(bytes, 'isolated.xlsx', {}, resource)],
    ['collector headers', (bytes: Uint8Array) => readReportHeaderRowsBytes(bytes, 'isolated.xlsx', resource)],
  ] as const)('%s 不能绕过同一字节预算', (_name, parse) => {
    expect(() => parse(normalWorkbook())).toThrow(/REPORT_RESOURCE_LIMIT/); unchanged();
  });
  it('family 对相同已确认摘要仍必须先过资源门', () => {
    const bytes = normalWorkbook(), sha256 = createHash('sha256').update(bytes).digest('hex');
    const scope: OwnerConfirmedFamilyScope = { schemaVersion: 1, provenanceLabel: 'user_confirmed_scope',
      familyLabel: 'isolated', confirmationReference: 'isolated', storeName: 'isolated', marketplaceCode: 'US',
      dateFrom: window.dateStart, dateTo: window.dateEnd,
      files: [{ sha256, reportType: 'campaign', dateFrom: window.dateStart, dateTo: window.dateEnd }] };
    expect(() => observeOwnerConfirmedFamily(scope, [{ bytes, reportType: 'campaign' }], resource)).toThrow(/REPORT_RESOURCE_LIMIT/);
    unchanged();
  });
});
describe('同步兼容入口也不能绕过资源门', () => {
  it('读取与关闭同时失败时保留首错和关闭次错', () => {
    const directory = fs.mkdtempSync(path.join(path.resolve(os.tmpdir()), 'isolated-report-resource-')); directories.push(directory);
    const file = path.join(directory, 'isolated.xlsx'); fs.writeFileSync(file, normalWorkbook());
    const primary = new Error('isolated read failure'), secondary = new Error('isolated close failure');
    const readSpy = vi.mocked(fs.readSync), closeSpy = vi.mocked(fs.closeSync);
    const actualRead = readSpy.getMockImplementation()!, actualClose = closeSpy.getMockImplementation()!;
    let descriptor: number | undefined;
    readSpy.mockImplementation(() => { throw primary; });
    closeSpy.mockImplementation(fd => { descriptor = fd; throw secondary; });
    try {
      let failure: any;
      try { readBoundedReportFileBytes(file); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(AggregateError);
      expect(failure.cause).toBe(primary); expect(failure.errors).toEqual([primary, secondary]); unchanged();
    } finally {
      readSpy.mockImplementation(actualRead); closeSpy.mockImplementation(actualClose);
      if (descriptor !== undefined) actualClose(descriptor);
    }
  });
  it.each([
    ['parseExcel', (file: string) => new ReportParser(resource).parseExcel(file)],
    ['autoParse', (file: string) => new ReportParser(resource).autoParse(file)],
    ['parseCSV', (file: string) => new ReportParser(resource).parseCSV(file)],
    ['raw control totals', (file: string) => ReportParser.readLingxingRawReportControlTotals(file, window, resource)],
    ['keyword', (file: string) => parseKeywordMetrics(file, {}, resource)],
    ['keyword diagnostics', (file: string) => parseKeywordMetricsWithDiagnostics(file, {}, resource)],
    ['listing', (file: string) => parseListingContent(file, {}, resource)],
  ] as const)('%s 在读取分配前限长', (_name, parse) => {
    const directory = fs.mkdtempSync(path.join(path.resolve(os.tmpdir()), 'isolated-report-resource-')); directories.push(directory);
    const file = path.join(directory, 'isolated.xlsx'); fs.writeFileSync(file, normalWorkbook());
    expect(() => parse(file)).toThrow(/REPORT_RESOURCE_LIMIT/); unchanged();
  });
});
