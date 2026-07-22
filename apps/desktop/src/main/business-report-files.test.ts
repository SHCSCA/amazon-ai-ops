import { describe, expect, it } from 'vitest';
import { resolveBusinessReportImportState } from './business-report-files';

describe('resolveBusinessReportImportState', () => {
  it('preserves a durable successful zero-row import receipt', () => {
    expect(resolveBusinessReportImportState({
      fileStatus: 'downloaded',
      indexedStatus: 'imported',
      countedMetricRows: 0,
    })).toEqual({ importedRows: 0, status: 'imported' });
  });

  it('does not trust an unindexed zero-row imported claim from a raw file', () => {
    expect(resolveBusinessReportImportState({
      fileStatus: 'imported',
      countedMetricRows: 0,
    })).toEqual({ importedRows: 0, status: 'downloaded' });
  });

  it('keeps an indexed import failure fail-closed even if stale metric rows exist', () => {
    expect(resolveBusinessReportImportState({
      fileStatus: 'downloaded',
      indexedStatus: 'import_failed',
      countedMetricRows: 3,
    })).toEqual({ importedRows: 0, status: 'import_failed' });
  });
});
