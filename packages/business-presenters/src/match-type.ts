import { normalizeToken } from './normalize-token';

/**
 * Match-type taxonomy for Amazon ads. The set is intentionally exhaustive for
 * the four primary keyword match types plus auto / product targeting and the
 * two close-match variants used by the analysis layer.
 */
export type MatchTypeToken =
  | 'exact'
  | 'phrase'
  | 'broad'
  | 'close_match'
  | 'close-match'
  | 'auto'
  | 'auto_targeting'
  | 'product'
  | 'product_targeting'
  | 'targeting_expression'
  | 'substitutes'
  | 'complements'
  | 'loose_match'
  | 'loose-match';

const MATCH_TYPE_LABELS: Readonly<Record<MatchTypeToken, string>> = Object.freeze({
  exact: '精准匹配',
  phrase: '词组匹配',
  broad: '广泛匹配',
  close_match: '紧密匹配',
  'close-match': '紧密匹配',
  auto: '自动投放',
  auto_targeting: '自动投放',
  product: '商品投放',
  product_targeting: '商品投放',
  targeting_expression: '商品投放',
  substitutes: '替代商品',
  complements: '关联商品',
  loose_match: '宽泛匹配',
  'loose-match': '宽泛匹配',
});

/**
 * Localize a match-type token to the operator-facing Chinese label.
 *
 * - Empty / null inputs return "不适用" so empty cells render explicitly.
 * - Unknown tokens return "其他投放方式" rather than falling back silently,
 *   so an unmapped token surfaces as something the operator can flag.
 * - Tries the snake_case normalized form first (via {@link normalizeToken}),
 *   then falls back to the raw trimmed lowercase token so callers passing
 *   hyphen forms like `close-match` still get a stable label.
 */
export function localizeMatchType(value: unknown): string {
  if (value == null || value === '') return '不适用';
  const normalized = normalizeToken(value) as MatchTypeToken;
  if (normalized && MATCH_TYPE_LABELS[normalized]) return MATCH_TYPE_LABELS[normalized];
  const raw = String(value).trim().toLowerCase() as MatchTypeToken;
  if (raw && MATCH_TYPE_LABELS[raw]) return MATCH_TYPE_LABELS[raw];
  return '其他投放方式';
}

export const MATCH_TYPE_LABEL_TABLE: Readonly<Record<MatchTypeToken, string>> = MATCH_TYPE_LABELS;
