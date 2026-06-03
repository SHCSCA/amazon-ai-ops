import type { LingxingReportDefinition } from '@amazon-ai-ops/shared-types';

export const LINGXING_AD_REPORTS: LingxingReportDefinition[] = [
  { type: 'campaign', displayName: '广告活动报告', expectedFilenameKeyword: 'campaign' },
  { type: 'ad_group', displayName: '广告组报告', expectedFilenameKeyword: 'ad_group' },
  { type: 'placement', displayName: '广告位报告', expectedFilenameKeyword: 'placement' },
  { type: 'advertised_product', displayName: '广告（推广的商品）报告', expectedFilenameKeyword: 'advertised_product' },
  { type: 'auto_targeting', displayName: '自动投放报告', expectedFilenameKeyword: 'auto_targeting' },
  { type: 'keyword', displayName: '关键词报告', expectedFilenameKeyword: 'keyword' },
  { type: 'product_targeting', displayName: '商品投放报告', expectedFilenameKeyword: 'product_targeting' },
  { type: 'user_search_term', displayName: '用户搜索词报告', expectedFilenameKeyword: 'search_term' },
];
