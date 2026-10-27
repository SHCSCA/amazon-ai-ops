import { normalizeBusinessDate } from './store';

export function normalizeVerifiedDomainTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be an ISO timestamp`);
  const normalized = value.trim();
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/);
  if (!match) throw new TypeError(`${label} must be an ISO timestamp with a timezone`);
  try { normalizeBusinessDate(match[1]); }
  catch { throw new TypeError(`${label} must contain a valid calendar date`); }
  const offset = match[6];
  if (offset !== 'Z' && offset.slice(1, 3) === '14' && offset.slice(4) !== '00') {
    throw new TypeError(`${label} timezone offset exceeds the supported clock range`);
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be a valid ISO timestamp`);
  return new Date(parsed).toISOString();
}
