import * as XLSX from 'xlsx';
import { rejectReport, type ReportResourceLimits } from './report-resource-policy';

export function checkReportCoordinate(value: string, limits: ReportResourceLimits): { r: number; c: number } {
  const match = /^\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})$/.exec(value);
  if (!match) rejectReport('sheet-coordinate', 'REPORT_ARCHIVE_INVALID');
  let column = 0;
  for (const char of match[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (row > limits.maxRows || column > limits.maxColumns) rejectReport('sheet-coordinate');
  return { r: row, c: column };
}
export function checkReportRange(value: string, limits: ReportResourceLimits): void {
  const parts = value.split(':');
  if (parts.length > 2) rejectReport('sheet-range', 'REPORT_ARCHIVE_INVALID');
  const start = checkReportCoordinate(parts[0], limits), end = checkReportCoordinate(parts[1] ?? parts[0], limits);
  if (end.r < start.r || end.c < start.c) rejectReport('sheet-range', 'REPORT_ARCHIVE_INVALID');
  if ((end.r - start.r + 1) * (end.c - start.c + 1) > limits.maxRangeCells) rejectReport('sheet-range');
}
export function checkReportSheet(sheet: XLSX.WorkSheet | undefined, limits: ReportResourceLimits): void {
  if (!sheet || typeof sheet !== 'object') rejectReport('sheet-missing', 'REPORT_ARCHIVE_INVALID');
  for (const field of ['!ref', '!fullref']) if (sheet[field]) checkReportRange(String(sheet[field]), limits);
  let cells = 0, textBytes = 0;
  const inspect = (cell: XLSX.CellObject | undefined, address: string) => {
    if (!cell) return;
    checkReportCoordinate(address, limits);
    if (++cells > limits.maxCells) rejectReport('sheet-cells');
    for (const value of [cell.v, cell.w, cell.f, cell.z]) if (typeof value === 'string') {
      if (value.length > limits.maxCellTextChars) rejectReport('cell-text');
      textBytes += Buffer.byteLength(value, 'utf8');
      if (textBytes > limits.maxTextBytes) rejectReport('sheet-text');
    }
  };
  const dense = sheet['!data'] as XLSX.CellObject[][] | undefined;
  if (dense) {
    if (dense.length > limits.maxRows) rejectReport('sheet-rows');
    for (let row = 0; row < dense.length; row++) {
      if (!dense[row]) continue;
      if (dense[row].length > limits.maxColumns) rejectReport('sheet-columns');
      for (let column = 0; column < dense[row].length; column++) inspect(dense[row][column], XLSX.utils.encode_cell({ r: row, c: column }));
    }
  }
  for (const key of Object.keys(sheet)) if (!key.startsWith('!')) inspect(sheet[key] as XLSX.CellObject, key);
}
