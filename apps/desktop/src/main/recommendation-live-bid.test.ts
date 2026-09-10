import { expect, it } from 'vitest';
import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import { DEFAULT_RULE_CONFIG } from '@amazon-ai-ops/rules-engine';
import { applyCurrentKeywordBids, type RecommendationBidObservation } from './recommendation-live-bid';
import { resolveLingxingKeywordTargetRows } from './lingxing-ads-sso';

it('uses the uniquely observed bid instead of CPC and still rejects a stale execution bid', async () => {
  const rows = [{ headers: ['广告活动', '匹配类型', '关键词', '广告组', '竞价'],
    cellTexts: ['Campaign', '精准', 'cupping massager', 'Group', '$1.80'],
    keywordIds: ['kw-1'], adGroupIds: ['group-1'], adGroupNames: ['Group'], bidValues: ['$1.80'] }];
  const target = { campaignName: 'Campaign', adGroupName: 'Group', entityName: 'cupping massager', matchType: 'exact' };
  const identity = resolveLingxingKeywordTargetRows(rows, { ...target, currentBidCents: 'read_current' });
  expect(identity.bidCents).toBe(180);
  expect(() => resolveLingxingKeywordTargetRows(rows, { ...target, currentBidCents: 260 })).toThrow('当前竞价已变化');
  expect(() => resolveLingxingKeywordTargetRows([...rows, { ...rows[0], keywordIds: ['kw-2'] }], {
    ...target, currentBidCents: 'read_current',
  })).toThrow('无法唯一定位');
  const rec = { actionType: 'lower_bid', currentValue: '2.60', recommendedValue: '2.34',
    evidence: { reportType: 'keyword', cpc: 2.6 } } as ActionRecommendation;
  const observation = { ...identity, observedAt: '2026-09-10T01:00:00Z' } as RecommendationBidObservation;
  const [result] = await applyCurrentKeywordBids([rec], async () => observation, DEFAULT_RULE_CONFIG, true);
  expect(result).toMatchObject({ currentValue: '1.80', recommendedValue: '1.62', evidence: { cpc: 2.6, currentValueSource: 'ads_ui' } });
  expect(rec.currentValue).toBe('2.60');
  const search = { ...rec, entityName: 'cupping massager', evidence: { ...rec.evidence,
    reportType: 'user_search_term', targeting: 'cupping massager', matchType: 'exact' } };
  expect((await applyCurrentKeywordBids([search], async () => observation, DEFAULT_RULE_CONFIG, true))[0].currentValue).toBe('1.80');
  await expect(applyCurrentKeywordBids([{ ...search, entityName: 'cupping massager electric' }], async () => observation,
    DEFAULT_RULE_CONFIG, true)).rejects.toThrow('缺少关键词报表身份');
  const [aiResult] = await applyCurrentKeywordBids([rec], async () => observation, DEFAULT_RULE_CONFIG, false);
  expect(aiResult.recommendedValue).toBe('2.34'); // Never clip or reinterpret an AI action to manufacture eligibility.
  await expect(applyCurrentKeywordBids([rec], async () => { throw new Error('Ads disconnected'); }, DEFAULT_RULE_CONFIG, true)).rejects.toThrow('Ads disconnected');
});
