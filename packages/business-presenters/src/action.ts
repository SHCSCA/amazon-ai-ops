import { normalizeToken } from './normalize-token';

/**
 * Action-type taxonomy for ads execution. The keys normalize the multiple
 * upstream aliases (e.g. `bid_change` and `adjust_keyword_bid` both fold to
 * the same label). Action-type labels are read by `localizeAction`, which
 * also considers entityType for the auto / product targeting bid variants.
 */
export type ActionTypeToken =
  | 'keyword_bid_adjustment'
  | 'bid_change'
  | 'adjust_keyword_bid'
  | 'budget_change'
  | 'placement_adjustment'
  | 'pause'
  | 'negative_exact'
  | 'negative_phrase';

const ACTION_LABELS: Readonly<Record<ActionTypeToken, string>> = Object.freeze({
  keyword_bid_adjustment: '调整关键词竞价',
  bid_change: '调整关键词竞价',
  adjust_keyword_bid: '调整关键词竞价',
  budget_change: '调整日预算',
  placement_adjustment: '调整广告位系数',
  pause: '暂停投放',
  negative_exact: '添加否定精准',
  negative_phrase: '添加否定词组',
});

/**
 * Localize an action token to its Chinese label.
 *
 * The two bid-change aliases resolve to a target-aware label when paired
 * with an auto_targeting or product_targeting entity. Unknown tokens
 * fall back to the upstream `fallback` string, or "人工复核" when none
 * is provided — that last fallback matches the existing renderer copy.
 */
export function localizeAction(
  value: unknown,
  fallback?: unknown,
  entityType?: unknown,
): string {
  const actionType = normalizeToken(value) as ActionTypeToken | '';
  const normalizedEntityType = normalizeToken(entityType);
  if (actionType === 'bid_change' || actionType === 'adjust_keyword_bid') {
    if (normalizedEntityType === 'auto_targeting') return '调整自动投放竞价';
    if (normalizedEntityType === 'product_targeting') return '调整商品投放竞价';
  }
  if (!actionType) return String(fallback ?? '人工复核');
  return ACTION_LABELS[actionType] ?? String(fallback ?? '人工复核');
}

export const ACTION_LABEL_TABLE: Readonly<Record<ActionTypeToken, string>> = ACTION_LABELS;
