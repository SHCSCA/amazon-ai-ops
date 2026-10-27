export function normalizeLogicalDomainIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string identifier`);
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(normalized)) {
    throw new TypeError(`${label} must be a logical identifier and must not be a path`);
  }
  return normalized;
}
