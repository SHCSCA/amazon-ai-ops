/**
 * Recommendation agreement states between the rule engine and the AI
 * diagnosis. The four labels intentionally mirror the upstream
 * `decisions-page` agreement axis so the appraisal queue can sort
 * rows by confidence without re-implementing the lookup.
 */
export type AgreementToken = 'aligned' | 'rule_only' | 'ai_only' | 'conflict';

const AGREEMENT_LABELS: Readonly<Record<AgreementToken, string>> = Object.freeze({
  aligned: '规则+AI 一致',
  rule_only: '规则独立建议',
  ai_only: 'AI 独立洞察',
  conflict: '规则/AI 冲突',
});

/**
 * Localize a recommendation agreement token.
 *
 * Empty / unknown inputs return `未知一致性` so the bound text stays
 * readable even when an upstream pipeline omits the agreement axis.
 */
export function localizeAgreement(value: unknown): string {
  if (value == null || value === '') return '未知一致性';
  const token = String(value).trim().toLowerCase() as AgreementToken;
  return AGREEMENT_LABELS[token] ?? String(value);
}

export const AGREEMENT_LABEL_TABLE: Readonly<Record<AgreementToken, string>> = AGREEMENT_LABELS;
