import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { ReportParser } from './parser';

function workbookBytes(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['date', 'asin', 'cost'], ['2026-10-01', 'B000000001', 1], ['2026-10-02', 'B000000001', 2],
  ]), 'Report');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
}

describe('报表统一资源预算', () => {
  it('在解析前拒绝超出输入字节预算的正常工作簿', () => {
    const parser = new ReportParser({ limits: { maxInputBytes: 64 } });
    expect(() => parser.parseExcelBytes(workbookBytes(), 'isolated.xlsx')).toThrow(/REPORT_RESOURCE_LIMIT/);
  });
  it('拒绝超过行预算的整份工作簿而不截断成功', () => {
    const parser = new ReportParser({ limits: { maxRows: 2 } });
    expect(() => parser.parseExcelBytes(workbookBytes(), 'isolated.xlsx')).toThrow(/REPORT_RESOURCE_LIMIT/);
  });
  it('在转换前拒绝超过矩形单元格预算的工作表', () => {
    const parser = new ReportParser({ limits: { maxRangeCells: 4 } });
    expect(() => parser.parseExcelBytes(workbookBytes(), 'isolated.xlsx')).toThrow(/REPORT_RESOURCE_LIMIT/);
  });
});
