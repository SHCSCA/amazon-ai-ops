import { localizeMatchType } from './match-type';
import { normalizeToken } from './normalize-token';

/**
 * Object-level taxonomy for the ads workspace. These are the grain labels
 * the operator sees in tables, paths, and route titles.
 */
export type ObjectTypeToken =
  | 'campaign'
  | 'ad_group'
  | 'placement'
  | 'keyword'
  | 'product_targeting'
  | 'auto_targeting'
  | 'search_term';

const OBJECT_TYPE_LABELS: Readonly<Record<ObjectTypeToken, string>> = Object.freeze({
  campaign: '广告活动',
  ad_group: '广告组',
  placement: '广告位',
  keyword: '关键词',
  product_targeting: '商品投放',
  auto_targeting: '自动投放',
  search_term: '搜索词',
});

/**
 * Localize an object-type token to its Chinese label. Returns "其他对象"
 * for unknown tokens and "其他对象" is also the fallback when the token
 * is empty, which keeps dense tables aligned.
 */
export function localizeObjectType(value: unknown): string {
  const normalized = normalizeToken(value) as ObjectTypeToken | '';
  if (!normalized) return '其他对象';
  return OBJECT_TYPE_LABELS[normalized] ?? '其他对象';
}

export const OBJECT_TYPE_LABEL_TABLE: Readonly<Record<ObjectTypeToken, string>> = OBJECT_TYPE_LABELS;
