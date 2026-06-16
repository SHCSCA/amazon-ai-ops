export const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export function formatUsd(value: unknown): string {
  const numeric = Number(value);
  return usdFormatter.format(Number.isFinite(numeric) ? numeric : 0);
}

export function formatPercent(value: unknown): string {
  const numeric = Number(value);
  return `${(Number.isFinite(numeric) ? numeric : 0).toFixed(1)}%`;
}

export function compactPath(value?: string): string {
  if (!value) return '-';
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.length <= 3 ? value : `...\\${parts.slice(-3).join('\\')}`;
}
