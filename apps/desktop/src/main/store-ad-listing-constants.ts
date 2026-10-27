import { type LingxingReportType } from '@amazon-ai-ops/shared-types';
import { type StoreScopedAdObjectKind } from "./store-ad-listing-contracts";

export const SQL_NOW = "strftime('%Y-%m-%d %H:%M:%f', 'now')";

export const IDENTITY_HINT_KEYS = new Set([
  'storeName',
  'store_name',
  'marketplace',
  'marketplaceCode',
  'marketplace_code',
  'currency',
]);

export const AD_OBJECT_LIST_KEYS = new Set([
  ...IDENTITY_HINT_KEYS,
  'kind',
  'dateFrom',
  'dateTo',
  'asin',
  'query',
  'limit',
]);

export const KEYWORD_FACT_LIST_KEYS = new Set([...IDENTITY_HINT_KEYS, 'asin', 'query', 'limit']);

export const LISTING_LIST_KEYS = new Set([...IDENTITY_HINT_KEYS, 'asin', 'query', 'limit']);

export const LISTING_LOOKUP_KEYS = new Set([...IDENTITY_HINT_KEYS, 'id', 'asin']);

export const LISTING_EDITABLE_KEYS = [
  'asin',
  'title',
  'bullets',
  'description',
  'aPlus',
  'a_plus',
  'imageCopy',
  'image_copy',
  'backendTerms',
  'backend_terms',
  'source',
  'versionLabel',
  'version_label',
  'changeSummary',
  'change_summary',
] as const;

export const LISTING_CREATE_KEYS = new Set([...IDENTITY_HINT_KEYS, ...LISTING_EDITABLE_KEYS]);

export const LISTING_PATCH_KEYS = new Set([...IDENTITY_HINT_KEYS, ...LISTING_EDITABLE_KEYS]);

export const LISTING_UPDATE_KEYS = new Set(['id', 'expectedRevision', 'patch']);

export const LISTING_DELETE_KEYS = new Set(['id', 'expectedRevision']);

export const LISTING_VERSION_LIST_KEYS = new Set([
  ...IDENTITY_HINT_KEYS,
  'listingContentId',
  'asin',
  'limit',
  'offset',
]);

export const AD_OBJECT_SHAPES: Record<StoreScopedAdObjectKind, {
  reportTypes: readonly LingxingReportType[];
  nameExpression: string;
  campaignExpression: string;
  adGroupExpression: string;
  matchTypeExpression: string;
  groupBy: string[];
  searchExpressions: string[];
}> = {
  campaign: {
    reportTypes: ['campaign'],
    nameExpression: 'campaign_name',
    campaignExpression: 'campaign_name',
    adGroupExpression: 'NULL',
    matchTypeExpression: 'NULL',
    groupBy: ['campaign_name'],
    searchExpressions: ['campaign_name'],
  },
  ad_group: {
    reportTypes: ['ad_group'],
    nameExpression: 'ad_group_name',
    campaignExpression: 'campaign_name',
    adGroupExpression: 'ad_group_name',
    matchTypeExpression: 'NULL',
    groupBy: ['campaign_name', 'ad_group_name'],
    searchExpressions: ['campaign_name', 'ad_group_name'],
  },
  target: {
    reportTypes: ['keyword', 'product_targeting', 'auto_targeting'],
    nameExpression: 'targeting',
    campaignExpression: 'campaign_name',
    adGroupExpression: 'ad_group_name',
    matchTypeExpression: `CASE
      WHEN report_type = 'keyword'
      THEN NULLIF(lower(trim(match_type)), '')
      ELSE NULL
    END`,
    groupBy: [
      'report_type',
      'campaign_name',
      'ad_group_name',
      'targeting',
      `CASE
        WHEN report_type = 'keyword'
        THEN NULLIF(lower(trim(match_type)), '')
        ELSE NULL
      END`,
    ],
    searchExpressions: ['campaign_name', 'ad_group_name', 'targeting', 'match_type'],
  },
  search_term: {
    reportTypes: ['user_search_term'],
    nameExpression: 'search_term',
    campaignExpression: 'campaign_name',
    adGroupExpression: 'ad_group_name',
    matchTypeExpression: 'NULL',
    groupBy: ['campaign_name', 'ad_group_name', 'search_term'],
    searchExpressions: ['campaign_name', 'ad_group_name', 'search_term'],
  },
};

export const PRODUCTION_REPORT_TYPES: readonly LingxingReportType[] = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
];

export const PRODUCTION_REPORT_TYPE_SET = new Set<string>(PRODUCTION_REPORT_TYPES);
