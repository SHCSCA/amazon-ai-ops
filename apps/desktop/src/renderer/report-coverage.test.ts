import { describe, expect, it } from 'vitest';
import {
  hasFormalReportCoverage,
  hasRealReportCoverage,
  importedReportTypeCoverageCount,
  realReportCoverageCount,
} from './report-coverage';

describe('report coverage helpers', () => {
  it('prefers audited unique report-type coverage over raw file count', () => {
    const collection = {
      fileAudit: { realReportFileCount: 4 },
      realReportFiles: Array.from({ length: 8 }, (_, index) => ({ id: `file_${index}` })),
    };

    expect(realReportCoverageCount(collection)).toBe(4);
    expect(hasRealReportCoverage(collection)).toBe(true);
  });

  it('falls back to raw file count only when audit coverage is missing', () => {
    const collection = {
      realReportFiles: [{ id: 'file_1' }, { id: 'file_2' }],
    };

    expect(realReportCoverageCount(collection)).toBe(2);
  });

  it('keeps file coverage separate from per-type SQLite import coverage', () => {
    const collection = {
      fileAudit: { realReportFileCount: 8 },
      reportOptions: Array.from({ length: 8 }, (_, index) => ({
        type: `report-${index}`,
        realFileAvailable: true,
        importedRows: index < 5 ? 12 : 0,
      })),
    };

    expect(realReportCoverageCount(collection)).toBe(8);
    expect(importedReportTypeCoverageCount(collection)).toBe(5);
    expect(hasFormalReportCoverage(collection)).toBe(false);

    const fullyImported = {
      ...collection,
      reportOptions: collection.reportOptions.map((report) => ({ ...report, importedRows: 12 })),
    };
    expect(importedReportTypeCoverageCount(fullyImported)).toBe(8);
    expect(hasFormalReportCoverage(fullyImported)).toBe(true);
  });

  it('counts a persisted imported receipt even when a valid report has zero business rows', () => {
    const emptyButImported = {
      fileAudit: { realReportFileCount: 8 },
      reportOptions: Array.from({ length: 8 }, (_, index) => ({
        type: `report-${index}`,
        status: 'imported',
        realFileAvailable: true,
        importedRows: 0,
      })),
    };

    expect(importedReportTypeCoverageCount(emptyButImported)).toBe(8);
    expect(hasFormalReportCoverage(emptyButImported)).toBe(true);
  });
});
