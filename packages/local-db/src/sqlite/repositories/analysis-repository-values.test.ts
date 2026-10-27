import { describe, expect, it } from 'vitest';
import { AnalysisAuthorityRepositoryError } from './analysis-authority-repo';
import { dateOf, timestampOf } from './analysis-repository-values';

describe('analysis authority business-date input', () => {
  it.each(['2026-02-30', '2026-02-29', '2026-04-31', '2026-13-01', '2026-10-00'])(
    'rejects the impossible calendar date %s without normalizing it into another day', value => {
      try { dateOf(value, 'dateFrom'); throw new Error('invalid date accepted'); }
      catch (error) {
        expect(error).toBeInstanceOf(AnalysisAuthorityRepositoryError);
        expect(error).toMatchObject({ code: 'INVALID_INPUT' });
      }
    },
  );

  it.each(['2024-02-29', '2026-10-16'])('preserves the valid date %s', value => {
    expect(dateOf(value, 'dateTo')).toBe(value);
  });

  it.each(['2026-02-30T00:00:00Z', '2026-10-16', '2026-10-16T12:00:00', '2026-10-16T24:00:00Z'])(
    'rejects invalid or ambiguous authority timestamp %s', value => {
      expect(() => timestampOf(value, 'verifiedAt')).toThrow(AnalysisAuthorityRepositoryError);
    },
  );

  it('normalizes a valid timezone offset through the shared domain clock contract', () => {
    expect(timestampOf('2026-10-16T21:00:00+08:00', 'verifiedAt')).toBe('2026-10-16T13:00:00.000Z');
  });
});
