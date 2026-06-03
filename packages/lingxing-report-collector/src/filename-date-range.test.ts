import { describe, expect, it } from 'vitest';
import { analyzeFilenameDateRange, filenameContainsDateRange, filenameDateRangeAnalysisSummary } from './filename-date-range';

describe('filename date range analysis', () => {
  it('passes when a filename contains selected ISO date tokens', () => {
    const analysis = analyzeFilenameDateRange('keyword_2026-05-01_2026-05-31.xlsx', '2026-05-01', '2026-05-31');

    expect(analysis).toMatchObject({
      validInputDates: true,
      startToken: '20260501',
      endToken: '20260531',
      hasStartToken: true,
      hasEndToken: true,
      missing: [],
    });
    expect(filenameContainsDateRange(analysis.filename, analysis.dateStart, analysis.dateEnd)).toBe(true);
    expect(filenameDateRangeAnalysisSummary(analysis)).toBe('filename contains start=20260501 and end=20260531');
  });

  it('passes when a filename uses compact date tokens', () => {
    expect(filenameContainsDateRange('keyword_20260501_20260531.xlsx', '2026-05-01', '2026-05-31')).toBe(true);
  });

  it('reports which selected date token is absent from a filename', () => {
    const analysis = analyzeFilenameDateRange('keyword_20260501.xlsx', '2026-05-01', '2026-05-31');

    expect(analysis.hasStartToken).toBe(true);
    expect(analysis.hasEndToken).toBe(false);
    expect(analysis.missing).toEqual(['dateEnd']);
    expect(filenameDateRangeAnalysisSummary(analysis)).toContain('missing dateEnd');
    expect(filenameDateRangeAnalysisSummary(analysis)).toContain('normalized filename=20260501');
  });

  it('reports invalid selected date inputs before trusting filename tokens', () => {
    const analysis = analyzeFilenameDateRange('keyword_20260501_20260531.xlsx', '', '2026-05-31');

    expect(analysis.validInputDates).toBe(false);
    expect(analysis.missing).toEqual(['dateInput']);
    expect(filenameContainsDateRange(analysis.filename, analysis.dateStart, analysis.dateEnd)).toBe(false);
    expect(filenameDateRangeAnalysisSummary(analysis)).toBe('invalid date input:  to 2026-05-31');
  });
});
