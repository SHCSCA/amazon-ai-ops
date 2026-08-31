import { money } from './format-money';
import { localizeMatchType } from './match-type';
import { localizeObjectType } from './object-type';
import { normalizeToken } from './normalize-token';
import { percent } from './format-percent';

/**
 * The internal display name for an ad object (campaign, ad group, keyword,
 * search term, target). Strips the leading "关键词 / 搜索词 / 广告组"
 * prefixes that the upstream data sometimes prepends and removes the
 * trailing `· matchType` decoration that appears in some fixtures.
 */
export function businessObjectName(
  item: { objectName?: unknown; keyword?: unknown; title?: unknown; objectType?: unknown },
  typeField: 'objectType' | 'entityType' = 'objectType',
): string {
  const objectType = normalizeToken(item[typeField]);
  let label = String(item.objectName ?? item.keyword ?? item.title ?? '未命名对象').trim();
  if (objectType === 'keyword') label = label.replace(/^关键词\s*/i, '');
  if (objectType === 'search_term') label = label.replace(/^搜索词\s*/i, '');
  if (objectType === 'ad_group') label = label.replace(/^广告组\s*/i, '');
  return label.replace(
    /\s*·\s*(exact|phrase|broad|close[-_ ]match|loose[-_ ]match|substitutes|complements|product[-_ ]targeting)$/i,
    '',
  );
}

/**
 * The targeting-type label for an object. For `product_targeting` we always
 * show "商品投放". For `auto_targeting` we surface the match-type label when
 * known, falling back to "自动投放" when the upstream is missing a sub-mode.
 * For `keyword` and `search_term` we surface the match-type label directly.
 * Everything else returns "不适用" so cells stay aligned.
 */
export function targetingTypeLabel(
  item: { matchType?: unknown; objectName?: unknown; [key: string]: unknown },
  typeField: string,
): string {
  const objectType = normalizeToken(item[typeField]);
  if (objectType === 'product_targeting') return '商品投放';
  if (objectType === 'auto_targeting') {
    const localized = localizeMatchType(item.matchType ?? item.objectName);
    return localized === '其他投放方式' || localized === '不适用' ? '自动投放' : localized;
  }
  if (objectType === 'keyword' || objectType === 'search_term') {
    return localizeMatchType(item.matchType);
  }
  return '不适用';
}

/**
 * Format the `before` / `after` value pair on a recommendation. Currency
 * units are localized via `money`, percent units via `percent`, and
 * unknown units fall back to the raw string. Null or NaN values render
 * as "—" so empty cells stay aligned.
 */
export function formattedChangeValue(
  value: unknown,
  item: { actionType?: unknown; unit?: unknown; currency?: unknown } = {},
): string {
  const actionType = normalizeToken(item.actionType);
  const unit = normalizeToken(item.unit);
  if (actionType === 'placement_adjustment' || unit === 'percent' || unit === 'percentage' || unit === 'pct') {
    return percent(value);
  }
  if (
    unit === 'currency'
    || actionType === 'keyword_bid_adjustment'
    || actionType === 'bid_change'
    || actionType === 'adjust_keyword_bid'
    || actionType === 'budget_change'
  ) {
    return money(value, typeof item.currency === 'string' ? item.currency : 'USD');
  }
  if (value === null || value === undefined) return '—';
  return String(value);
}

export { localizeObjectType };
