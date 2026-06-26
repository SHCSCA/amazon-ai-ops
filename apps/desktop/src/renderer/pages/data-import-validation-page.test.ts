import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  buildDataImportTableFeedback,
  dataImportTableFeedbackClass,
  dataImportTableSortHandler,
  nextDataImportSort,
  sortDataImportReportRows,
  type DataImportReportRow,
} from './data-import-validation-page';

function row(overrides: Partial<DataImportReportRow>): DataImportReportRow {
  return {
    type: 'campaign',
    label: '广告活动报告',
    fileName: '',
    filePath: '',
    fileHash: '',
    fileSizeBytes: 0,
    importedRows: 0,
    status: 'missing',
    importError: '',
    statusDisplay: {
      label: '缺少真实文件',
      detail: '当前范围还没有这类 Lingxing 原始报表文件。',
      tone: 'blocked',
    },
    ...overrides,
  };
}

describe('data import report table sorting', () => {
  it('sorts report rows without mutating the original order', () => {
    const rows = [
      row({ label: '关键词报告', importedRows: 300, fileSizeBytes: 1200, status: 'imported' }),
      row({ label: '广告活动报告', importedRows: 120, fileSizeBytes: 500, status: 'downloaded' }),
      row({ label: '用户搜索词报告', importedRows: 700, fileSizeBytes: 2000, status: 'imported' }),
    ];

    expect(sortDataImportReportRows(rows, { key: 'rows', direction: 'desc' }).map((item) => item.label)).toEqual([
      '用户搜索词报告',
      '关键词报告',
      '广告活动报告',
    ]);
    expect(rows.map((item) => item.label)).toEqual(['关键词报告', '广告活动报告', '用户搜索词报告']);
  });

  it('uses ascending order for text columns and descending order for numeric columns when switching headers', () => {
    expect(nextDataImportSort(null, 'label')).toEqual({ key: 'label', direction: 'asc' });
    expect(nextDataImportSort(null, 'hash')).toEqual({ key: 'hash', direction: 'asc' });
    expect(nextDataImportSort({ key: 'label', direction: 'asc' }, 'label')).toEqual({ key: 'label', direction: 'desc' });
    expect(nextDataImportSort({ key: 'label', direction: 'desc' }, 'rows')).toEqual({ key: 'rows', direction: 'desc' });
    expect(nextDataImportSort({ key: 'rows', direction: 'desc' }, 'size')).toEqual({ key: 'size', direction: 'desc' });
    expect(nextDataImportSort({ key: 'size', direction: 'desc' }, 'status')).toEqual({ key: 'status', direction: 'asc' });
  });

  it('sorts local SHA-256 checksums as a first-class verification column', () => {
    const rows = [
      row({ label: '关键词报告', fileHash: 'ff00deadcafe' }),
      row({ label: '广告活动报告', fileHash: '11aa99887766' }),
      row({ label: '用户搜索词报告', fileHash: '' }),
    ];

    expect(sortDataImportReportRows(rows, { key: 'hash', direction: 'asc' }).map((item) => item.label)).toEqual([
      '用户搜索词报告',
      '广告活动报告',
      '关键词报告',
    ]);
  });
});

describe('data import table micro-feedback', () => {
  it('summarizes the active sort and current import coverage', () => {
    expect(buildDataImportTableFeedback({
      importedRows: 2416,
      realReportCount: 8,
      sortDirection: 'desc',
      sortLabel: '入库行数',
      totalCount: 8,
    })).toBe('按入库行数降序展示 8 类报表；真实报表 8/8，已入库 2416 行。');

    expect(buildDataImportTableFeedback({
      importedRows: 0,
      realReportCount: 2,
      sortDirection: null,
      sortLabel: '',
      totalCount: 8,
    })).toBe('按默认报表顺序展示 8 类报表；真实报表 2/8，已入库 0 行。');
  });

  it('marks the table shell only during the 100ms sort refresh', () => {
    expect(dataImportTableFeedbackClass({ refreshing: false, locked: false })).toBe('data-import-table-shell');
    expect(dataImportTableFeedbackClass({ refreshing: true, locked: false })).toContain('data-import-table-refreshing');
    expect(dataImportTableFeedbackClass({ refreshing: false, locked: true })).toContain('data-import-table-locked');
  });

  it('locks sorting while an import is writing metrics into SQLite', () => {
    const sortSpy = vi.fn();

    expect(dataImportTableSortHandler({ locked: true, onSort: sortSpy })).toBeUndefined();

    const handler = dataImportTableSortHandler({ locked: false, onSort: sortSpy });
    expect(handler).toBeTypeOf('function');
    handler?.('hash');
    expect(sortSpy).toHaveBeenCalledWith('hash');
  });

  it('keeps the 100ms sorting feedback and aria-live contract wired', () => {
    const source = readFileSync(new URL('./data-import-validation-page.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('data-import-table-feedback');
    expect(source).toContain('dataImportTableSortHandler');
    expect(source).toContain('data-import-table-lock');
    expect(source).toContain("header: 'SHA-256'");
    expect(source).toContain('shortDataImportHash');
    expect(source).toContain('setTableRefreshing');
    expect(styles).toContain('.data-import-table-refreshing');
    expect(styles).toContain('.data-import-table-locked');
    expect(styles).toContain('@keyframes data-import-table-refresh');
    expect(styles).toMatch(/animation:\s*data-import-table-refresh 100ms/);
    expect(styles).toContain('filter: blur(1px)');
  });
});
