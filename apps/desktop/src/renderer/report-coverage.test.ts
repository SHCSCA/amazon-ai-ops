import { describe, expect, it } from 'vitest';
import { realReportCoverageCount, hasRealReportCoverage } from './report-coverage';

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
});
