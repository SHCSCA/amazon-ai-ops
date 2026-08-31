/**
 * Eight standard Amazon ad report types used by the data-collection workbench.
 * The tokens match the upstream `reportType` string on each report artifact.
 */
export type CollectionReportType =
  | 'campaign'
  | 'ad_group'
  | 'placement'
  | 'advertised_product'
  | 'auto_targeting'
  | 'keyword'
  | 'product_targeting'
  | 'user_search_term';

const COLLECTION_REPORT_LABELS: Readonly<Record<CollectionReportType, string>> = Object.freeze({
  campaign: '广告活动报告',
  ad_group: '广告组报告',
  placement: '广告位报告',
  advertised_product: '广告商品报告',
  auto_targeting: '自动投放报告',
  keyword: '关键词报告',
  product_targeting: '商品投放报告',
  user_search_term: '用户搜索词报告',
});

/**
 * Localize an eight-type ad-report token to its operator-facing Chinese
 * label. Unknown / empty values fall back to `未知报表类型` so cells stay
 * non-blank even when an upstream catalog omits a row.
 */
export function localizeCollectionReportType(value: unknown): string {
  if (value == null || value === '') return '未知报表类型';
  const token = String(value).trim().toLowerCase() as CollectionReportType;
  return COLLECTION_REPORT_LABELS[token] ?? '未知报表类型';
}

export const COLLECTION_REPORT_LABEL_TABLE: Readonly<Record<CollectionReportType, string>>
  = COLLECTION_REPORT_LABELS;
