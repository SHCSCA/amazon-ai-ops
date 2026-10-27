import type { KeywordOpportunityView } from '../types';
import {
  type KeywordOpportunitySortKey,
  type KeywordOpportunitySortState,
} from "./keyword-opportunities-contracts";

export const keywordTextSortKeys = new Set<KeywordOpportunitySortKey>([
  'asin',
  'portfolioName',
  'campaignName',
  'adGroupName',
  'keyword',
  'coverageStatus',
  'recommendedPlacement',
]);

export const opportunityLevelRank: Record<KeywordOpportunityView['opportunityLevel'], number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export const keywordSortKeys = new Set<KeywordOpportunitySortKey>([
  'asin',
  'portfolioName',
  'campaignName',
  'adGroupName',
  'keyword',
  'coverageStatus',
  'clicks',
  'orders',
  'spend',
  'sales',
  'acos',
  'opportunityLevel',
  'recommendedPlacement',
]);

export const keywordOpportunitySortLabels: Record<KeywordOpportunitySortKey, string> = {
  asin: 'ASIN',
  portfolioName: '广告组合',
  campaignName: '广告活动',
  adGroupName: '广告组',
  keyword: '关键词',
  coverageStatus: '覆盖状态',
  clicks: '点击',
  orders: '订单',
  spend: '花费',
  sales: '销售',
  acos: 'ACOS',
  opportunityLevel: '机会等级',
  recommendedPlacement: '建议位置',
};

export function isKeywordOpportunitySortKey(key: string): key is KeywordOpportunitySortKey {
  return keywordSortKeys.has(key as KeywordOpportunitySortKey);
}

export function sortValue(row: KeywordOpportunityView, key: KeywordOpportunitySortKey): string | number {
  if (key === 'opportunityLevel') return opportunityLevelRank[row.opportunityLevel] ?? 0;
  const value = row[key];
  if (typeof value === 'number') return value;
  return String(value || '').toLowerCase();
}

export function sortKeywordOpportunities(
  rows: KeywordOpportunityView[],
  sort: KeywordOpportunitySortState,
): KeywordOpportunityView[] {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = sortValue(left.row, sort.key);
      const rightValue = sortValue(right.row, sort.key);
      let compared = 0;
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        compared = leftValue - rightValue;
      } else {
        compared = String(leftValue).localeCompare(String(rightValue), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
      }
      if (compared !== 0) return compared * direction;
      const tieBreaker = left.row.keyword.localeCompare(right.row.keyword, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
      return tieBreaker || left.index - right.index;
    })
    .map((item) => item.row);
}

export function nextKeywordOpportunitySort(
  current: KeywordOpportunitySortState,
  nextKey: KeywordOpportunitySortKey,
): KeywordOpportunitySortState {
  if (current.key === nextKey) {
    return { key: nextKey, direction: current.direction === 'desc' ? 'asc' : 'desc' };
  }
  return { key: nextKey, direction: keywordTextSortKeys.has(nextKey) ? 'asc' : 'desc' };
}

export function keywordOpportunitySortLabel(key: KeywordOpportunitySortKey): string {
  return keywordOpportunitySortLabels[key] || key;
}
