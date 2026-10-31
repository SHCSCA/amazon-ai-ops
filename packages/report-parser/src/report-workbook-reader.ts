import * as fs from 'node:fs';
import * as path from 'node:path';
import * as XLSX from 'xlsx';
import { expandReportZip } from './report-zip-content';
import { checkReportOoxml } from './report-ooxml-budget';
import { checkReportRange, checkReportSheet } from './report-sheet-budget';
import { inspectReportText, reportTextRows } from './report-text-budget';
import { assertLegacyXlsBudget } from './report-xls-budget';
import { buildNormalizedReportZip } from './report-normalized-zip';
import { checkReportInput, rejectReport, reportResourceBoundary, resolveReportResourceLimits, type ReportResourceOptions } from './report-resource-policy';

export function readBoundedReportFileBytes(filePath: string, resource: ReportResourceOptions = {}): Uint8Array {
  return reportResourceBoundary(resource, () => {
    const limits = resolveReportResourceLimits(resource.limits), fd = fs.openSync(filePath, 'r');
    let failed = false, primaryError: unknown;
    try {
      const before = fs.fstatSync(fd);
      if (!before.isFile() || before.size < 1 || before.size > limits.maxInputBytes) rejectReport('file-size');
      const bytes = Buffer.alloc(before.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = fs.readSync(fd, bytes, length, bytes.length - length, length);
        if (!read) break;
        length += read;
      }
      const after = fs.fstatSync(fd);
      if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
        || before.dev !== after.dev || before.ino !== after.ino) rejectReport('file-changed', 'REPORT_SOURCE_CHANGED');
      return bytes.subarray(0, length);
    } catch (error) { failed = true; primaryError = error; throw error; }
    finally {
      try { fs.closeSync(fd); }
      catch (closeError) {
        if (!failed) throw closeError;
        const failure = new AggregateError([primaryError, closeError], primaryError instanceof Error ? primaryError.message : 'REPORT_SOURCE_READ_FAILED', { cause: primaryError });
        throw failure;
      }
    }
  });
}
export function readReportWorkbookBytes(
  input: Uint8Array, sourceName: string, options: Pick<XLSX.ParsingOptions, 'cellNF' | 'cellDates' | 'raw'> = {},
  resource: ReportResourceOptions = {},
): XLSX.WorkBook {
  return reportResourceBoundary(resource, () => {
    const limits = resolveReportResourceLimits(resource.limits);
    checkReportInput(input, limits);
    const bytes = Buffer.from(input), extension = path.extname(sourceName).toLowerCase();
    const zip = bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;
    const legacy = bytes.length >= 8 && (bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
      || (bytes.readUInt16LE(0) === 0x0809 && bytes.readUInt16LE(2) === 16
        && bytes.readUInt16LE(4) === 0x0600 && bytes.readUInt16LE(6) === 5));
    if ((extension === '.xlsx' && !zip) || (extension === '.xls' && zip)
      || (['.csv', '.tsv', '.txt'].includes(extension) && (zip || legacy))) rejectReport('format-mismatch', 'REPORT_FORMAT_UNSUPPORTED');
    let workbook: XLSX.WorkBook;
    const safeOptions = { cellNF: options.cellNF, cellDates: options.cellDates, raw: options.raw,
      sheets: 0, sheetRows: limits.maxRows + 1, dense: false };
    if (zip) {
      const content = expandReportZip(bytes, limits);
      checkReportOoxml(content, limits);
      const normalized = buildNormalizedReportZip(content, limits);
      content.clear();
      workbook = XLSX.read(normalized, { ...safeOptions, type: 'buffer' });
    } else if (legacy || extension === '.xls') {
      assertLegacyXlsBudget(bytes, limits);
      workbook = XLSX.read(bytes, { ...safeOptions, type: 'buffer' });
    } else {
      if (extension === '.xlsx') rejectReport('xlsx-signature', 'REPORT_FORMAT_UNSUPPORTED');
      const text = inspectReportText(bytes, sourceName, limits);
      // 文本只按已预算的分隔值解析，禁止 SheetJS 再嗅探 XML/HTML 等其它格式。
      workbook = { SheetNames: ['Sheet1'], Sheets: { Sheet1: XLSX.utils.aoa_to_sheet(reportTextRows(text, sourceName)) } };
    }
    if (!workbook.SheetNames.length || workbook.SheetNames.length > limits.maxSheets) rejectReport('workbook-sheets');
    checkReportSheet(workbook.Sheets[workbook.SheetNames[0]], limits);
    return workbook;
  });
}
export function reportSheetRows<T>(sheet: XLSX.WorkSheet, options: XLSX.Sheet2JSONOpts = {}, resource: ReportResourceOptions = {}): T[] {
  return reportResourceBoundary(resource, () => {
    const limits = resolveReportResourceLimits(resource.limits);
    checkReportSheet(sheet, limits);
    if (typeof options.range === 'string') checkReportRange(options.range, limits);
    else if (typeof options.range === 'number' && (!Number.isSafeInteger(options.range) || options.range < 0 || options.range >= limits.maxRows)) rejectReport('row-range');
    else if (options.range && typeof options.range === 'object') checkReportRange(XLSX.utils.encode_range(options.range), limits);
    return XLSX.utils.sheet_to_json<T>(sheet, options);
  });
}
export function readReportHeaderRowsBytes(bytes: Uint8Array, sourceName: string, resource: ReportResourceOptions = {}): unknown[][] {
  const workbook = readReportWorkbookBytes(bytes, sourceName, { raw: false }, resource);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const original = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  return reportSheetRows<unknown[]>(sheet, { header: 1, defval: '', raw: false, blankrows: false,
    range: { s: original.s, e: { r: Math.min(original.e.r, original.s.r + 11), c: Math.min(original.e.c, original.s.c + 79) } } }, resource);
}

export function firstReportDataRow(sheet: XLSX.WorkSheet, resource: ReportResourceOptions = {}): Record<string, unknown> | undefined {
  checkReportSheet(sheet, resolveReportResourceLimits(resource.limits));
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  let first = Infinity;
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    const cell = sheet[key] as XLSX.CellObject, address = XLSX.utils.decode_cell(key);
    if (address.r <= range.s.r || address.r > range.e.r || address.c < range.s.c || address.c > range.e.c
      || cell?.t === 'e' || cell?.v === null || cell?.v === undefined || !String(cell.v).trim()) continue;
    first = Math.min(first, address.r);
  }
  if (!Number.isFinite(first)) return undefined;
  // 整表已验预算，Listing 只转换表头和首个非空数据行，避免展开无用行。
  const selected: XLSX.WorkSheet = { '!ref': XLSX.utils.encode_range({ s: range.s, e: { r: range.s.r + 1, c: range.e.c } }) };
  for (let column = range.s.c; column <= range.e.c; column++) {
    for (const [from, to] of [[range.s.r, range.s.r], [first, range.s.r + 1]]) {
      const value = sheet[XLSX.utils.encode_cell({ r: from, c: column })];
      if (value) selected[XLSX.utils.encode_cell({ r: to, c: column })] = value;
    }
  }
  return reportSheetRows<Record<string, unknown>>(selected, { defval: '' }, resource)[0];
}
