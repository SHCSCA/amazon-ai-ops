import { describe, expect, it } from 'vitest';
import { normalizeDomainTimestamp } from './mission-domain';

describe('canonical domain timestamps', () => {
  it.each(['2026-02-30T00:00:00Z', '2026-04-31T12:00:00Z', '2025-02-29T00:00:00Z', '2026-07-22',
    '2026-07-22T12:00:00', '07/22/2026 12:00:00', '2026-07-22T24:00:00Z', '2026-07-22T12:60:00Z',
    '2026-07-22T12:00:60Z', '2026-07-22T12:00:00+14:30', '2026-07-22T12:00:00.1234Z'])('rejects invalid or ambiguous timestamp %s', timestamp => {
    expect(() => normalizeDomainTimestamp(timestamp, 'testTime')).toThrow(TypeError);
  });
  it.each([
    ['2024-02-29T12:30:00Z', '2024-02-29T12:30:00.000Z'],
    ['2026-07-22T12:00:00-07:00', '2026-07-22T19:00:00.000Z'],
    ['2026-07-22T12:00:00.1+08:00', '2026-07-22T04:00:00.100Z'],
  ])('normalizes the valid instant %s into canonical UTC', (timestamp, expected) => {
    expect(normalizeDomainTimestamp(timestamp, 'testTime')).toBe(expected);
  });
});
