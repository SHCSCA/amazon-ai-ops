import { describe, expect, it } from 'vitest';
import { businessDayEnd } from './mission-domain-repo';
describe('Experiment business-day boundaries', () => {
  it.each([
    ['2026-03-07', '2026-03-08T08:00:00.000Z'],
    ['2026-03-08', '2026-03-09T07:00:00.000Z'],
    ['2026-10-31', '2026-11-01T07:00:00.000Z'],
    ['2026-11-01', '2026-11-02T08:00:00.000Z'],
  ])('ends %s at the actual Los Angeles midnight %s', (date, expected) => {
    expect(businessDayEnd(date, 'America/Los_Angeles')).toBe(expected);
  });
});
