import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import type { RuleConfig } from '@amazon-ai-ops/rules-engine';
import { lowerBidValue, raiseBidValue } from '@amazon-ai-ops/rules-engine/src/quantification';

export type RecommendationBidObservation = NonNullable<ActionRecommendation['evidence']['bidObservation']>;

// A report CPC describes historical spend; only a live observation supplies a bid.
export async function applyCurrentKeywordBids(
  recommendations: ActionRecommendation[],
  read: (recommendation: ActionRecommendation) => Promise<RecommendationBidObservation>,
  config: RuleConfig,
  recalculateRuleValue: boolean,
): Promise<ActionRecommendation[]> {
  const result: ActionRecommendation[] = [];
  for (const recommendation of recommendations) {
    if (recommendation.actionType !== 'lower_bid' && recommendation.actionType !== 'raise_bid') {
      result.push(recommendation);
      continue;
    }
    const directSearchTermTarget = recommendation.evidence.reportType === 'user_search_term'
      && recommendation.entityName?.trim()
      && recommendation.evidence.targeting?.trim() === recommendation.entityName.trim()
      && recommendation.evidence.matchType?.trim();
    if (recommendation.evidence.reportType !== 'keyword' && !directSearchTermTarget) {
      throw new Error('竞价建议缺少关键词报表身份，不能将历史 CPC 当成当前竞价。');
    }
    const observation = await read(recommendation);
    if (!Number.isSafeInteger(observation.bidCents) || observation.bidCents <= 0) {
      throw new Error('当前 Ads 竞价无效，未生成可执行建议。');
    }
    const bid = observation.bidCents / 100;
    result.push({
      ...recommendation,
      currentValue: bid.toFixed(2),
      recommendedValue: recalculateRuleValue
        ? (recommendation.actionType === 'lower_bid' ? lowerBidValue(bid, config) : raiseBidValue(bid, config))
        : recommendation.recommendedValue,
      evidence: { ...recommendation.evidence, currentValueSource: 'ads_ui', bidObservation: observation },
    });
  }
  return result;
}
