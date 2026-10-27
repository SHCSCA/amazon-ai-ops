import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type DataImportSortKey, type DataImportReportRow, type DataImportSortState } from './import-validation-contracts';
import { reportFileExtension } from './import-validation-presentation';

export const DATA_IMPORT_TEXT_SORT_KEYS = new Set<DataImportSortKey>(['label', 'file', 'ext', 'hash', 'status']);

export function dataImportSortValue(row: DataImportReportRow, key: DataImportSortKey): string | number {
  if (key === 'file') return (row.fileName || '').toLowerCase();
  if (key === 'ext') return reportFileExtension(row.fileName, row.fileExtension);
  if (key === 'size') return Number(row.fileSizeBytes || 0);
  if (key === 'hash') return (row.fileHash || '').toLowerCase();
  if (key === 'rows') return Number(row.importedRows || 0);
  if (key === 'status') return `${row.statusDisplay.label || ''} ${row.status || ''}`.toLowerCase();
  return (row.label || '').toLowerCase();
}

export function nextDataImportSort(current: DataImportSortState | null, key: DataImportSortKey): DataImportSortState {
  if (current?.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: DATA_IMPORT_TEXT_SORT_KEYS.has(key) ? 'asc' : 'desc' };
}

export function sortDataImportReportRows(rows: DataImportReportRow[], sort: DataImportSortState | null): DataImportReportRow[] {
  if (!sort) return rows;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = dataImportSortValue(left.row, sort.key);
      const rightValue = dataImportSortValue(right.row, sort.key);
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        const diff = leftValue - rightValue;
        if (diff !== 0) return sort.direction === 'asc' ? diff : -diff;
        return left.index - right.index;
      }
      const diff = String(leftValue).localeCompare(String(rightValue), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
      if (diff !== 0) return sort.direction === 'asc' ? diff : -diff;
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

export function dataImportSortLabel(key: DataImportSortKey): string {
  const labels: Record<DataImportSortKey, string> = {
    label: '报表',
    file: '文件',
    ext: '类型',
    size: '大小',
    hash: 'SHA-256',
    rows: '入库行数',
    status: '状态',
  };
  return labels[key];
}

export function dataImportTableSortHandler(input: {
  locked: boolean;
  onSort: (key: string) => void;
}): ((key: string) => void) | undefined {
  return input.locked ? undefined : input.onSort;
}
