/**
 * Ad-object quantification states used by the ad-quant summary tile
 * and the object focus filter chips. The five states intentionally
 * go from healthy at one extreme through watch and waste in the
 * middle to scale and blocked at the other.
 */
export type QuantStatusToken = 'healthy' | 'watch' | 'waste' | 'scale' | 'blocked';

const QUANT_STATUS_LABELS: Readonly<Record<QuantStatusToken, string>> = Object.freeze({
  healthy: '健康',
  watch: '观察',
  waste: '浪费风险',
  scale: '可扩量',
  blocked: '样本不足',
});

/**
 * Localize an ad-object quantification token to its Chinese label.
 *
 * Empty / unknown inputs return `样本不足` so cells stay non-blank
 * for not-yet-quantified objects.
 */
export function localizeQuantStatus(value: unknown): string {
  if (value == null || value === '') return '样本不足';
  const token = String(value).trim().toLowerCase() as QuantStatusToken;
  return QUANT_STATUS_LABELS[token] ?? '样本不足';
}

export const QUANT_STATUS_LABEL_TABLE: Readonly<Record<QuantStatusToken, string>>
  = QUANT_STATUS_LABELS;
