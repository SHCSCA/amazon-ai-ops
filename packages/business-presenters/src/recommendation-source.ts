/**
 * Recommendation origin tokens emitted by the merged
 * rule-engine + AI-adapter pipeline. `rule_ai` indicates both sources
 * produced the same value, while `rule` and `ai` indicate a single
 * source owns the row.
 */
export type RecommendationSourceToken = 'rule_ai' | 'rule' | 'ai';

const RECOMMENDATION_SOURCE_LABELS: Readonly<Record<RecommendationSourceToken, string>> = Object.freeze({
  rule_ai: '规则+AI 合并',
  rule: '规则',
  ai: 'AI',
});

/**
 * Localize a recommendation origin token.
 *
 * Empty / unknown inputs return `未知来源` so cells stay non-blank.
 */
export function localizeRecommendationSource(value: unknown): string {
  if (value == null || value === '') return '未知来源';
  const token = String(value).trim().toLowerCase() as RecommendationSourceToken;
  return RECOMMENDATION_SOURCE_LABELS[token] ?? String(value);
}

export const RECOMMENDATION_SOURCE_LABEL_TABLE: Readonly<Record<RecommendationSourceToken, string>>
  = RECOMMENDATION_SOURCE_LABELS;
