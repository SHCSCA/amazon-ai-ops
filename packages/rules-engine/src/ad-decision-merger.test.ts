import { describe, expect, it } from 'vitest';
import { mergeAdDecisions } from './ad-decision-merger';

const identity = { storeId: 'ISOLATED-1', storeName: 'FIXTURE', marketplaceCode: 'US', asin: 'B000000001', batchId: 'B1', kind: 'report_object' as const, sourceFile: 'fixture.csv', sourceRow: 2, metricDate: '2026-10-27', dateFrom: '2026-10-27', dateTo: '2026-10-27', campaignName: 'C1', adGroupName: 'A1', matchType: 'exact' };

describe('mergeAdDecisions', () => {
  it('marks matching rule and AI candidates as aligned and raises confidence within a safe cap', () => {
    const result = mergeAdDecisions({
      ruleCandidates: [
        {
          identity,
          entityType: 'search_term',
          entityName: 'smart lock outdoor',
          actionType: 'lower_bid',
          recommendedValue: '-12%',
          reason: 'No-order spend exceeds threshold.',
          confidence: 0.72,
        },
      ],
      aiCandidates: [
        {
          identity,
          entityType: 'search_term',
          entityName: 'smart lock outdoor',
          actionType: 'lower_bid',
          recommendedValue: '-12%',
          reason: 'Coupon did not convert enough traffic.',
          confidence: 0.78,
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      agreement: 'aligned',
      source: 'rule_ai',
      entityType: 'search_term',
      entityName: 'smart lock outdoor',
      actionType: 'lower_bid',
      recommendedValue: '-12%',
      requiresReview: false,
    });
    expect(result[0].confidence).toBe(0.85);
    expect(result[0].reasons).toEqual([
      'Rule: No-order spend exceeds threshold.',
      'AI: Coupon did not convert enough traffic.',
    ]);
  });

  it('marks same-entity different-action candidates as conflict requiring manual review', () => {
    const result = mergeAdDecisions({
      ruleCandidates: [
        {
          identity,
          entityType: 'target',
          entityName: 'smart lock',
          actionType: 'lower_bid',
          reason: 'ACOS is above high threshold.',
          confidence: 0.7,
        },
      ],
      aiCandidates: [
        {
          identity,
          entityType: 'target',
          entityName: 'smart lock',
          actionType: 'raise_bid',
          reason: 'Launch stage needs more traffic.',
          confidence: 0.68,
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      agreement: 'conflict',
      source: 'rule_ai',
      entityType: 'target',
      entityName: 'smart lock',
      actionType: 'lower_bid',
      requiresReview: true,
    });
    expect(result[0].riskWarnings).toContain('Rule and AI recommend different actions for the same target.');
  });

  it('keeps AI-only candidates as insights that require review before execution', () => {
    const result = mergeAdDecisions({
      ruleCandidates: [],
      aiCandidates: [
        {
          entityType: 'campaign',
          entityName: 'SP broad',
          actionType: 'raise_budget',
          reason: 'Stable low ACOS and inventory is healthy.',
          confidence: 0.66,
        },
      ],
    });

    expect(result).toEqual([
      {
        aiCandidateIndex: 0,
        identity: undefined,
        agreement: 'ai_only',
        source: 'ai',
        entityType: 'campaign',
        entityName: 'SP broad',
        actionType: 'raise_budget',
        recommendedValue: undefined,
        confidence: 0.66,
        reasons: ['AI: Stable low ACOS and inventory is healthy.'],
        riskWarnings: ['AI-only candidate; rule confirmation is missing.'],
        requiresReview: true,
      },
    ]);
  });

  it('preserves rule-only approval-policy path without AI matching', () => {
    const result = mergeAdDecisions({
      ruleCandidates: [
        {
          entityType: 'target',
          entityName: 'B00TEST',
          actionType: 'pause',
          reason: 'Spend exceeded minimum with zero orders.',
          confidence: 0.8,
        },
      ],
      aiCandidates: [],
    });

    expect(result).toEqual([
      {
        ruleCandidateIndex: 0,
        identity: undefined,
        agreement: 'rule_only',
        source: 'rule',
        entityType: 'target',
        entityName: 'B00TEST',
        actionType: 'pause',
        recommendedValue: undefined,
        confidence: 0.8,
        reasons: ['Rule: Spend exceeded minimum with zero orders.'],
        riskWarnings: ['Rule-only candidate; AI confirmation is missing.'],
        requiresReview: false,
      },
    ]);
  });
});


describe('mergeAdDecisions parameter agreement', () => {
  function mergeValues(ruleValue?: string, aiValue?: string) {
    const candidate = {
      identity,
      entityType: 'target',
      entityName: 'ISOLATED_FIXTURE value target',
      actionType: 'lower_bid',
      reason: 'ISOLATED_FIXTURE',
      confidence: 0.72,
    };
    return mergeAdDecisions({
      ruleCandidates: [{ ...candidate, recommendedValue: ruleValue }],
      aiCandidates: [{ ...candidate, recommendedValue: aiValue, confidence: 0.78 }],
    })[0];
  }

  const conflictingValues: Array<[string, string | undefined, string | undefined]> = [
    ['different absolute bids', '1.62', '1.44'],
    ['different bids inside the existing safety limit', '1.62', '1.71'],
    ['different decimal formatting', '1.62', '1.620'],
    ['leading zero', '1.62', '01.62'],
    ['scientific notation', '1.62', '1.62e0'],
    ['currency prefix', '1.62', '$1.62'],
    ['currency suffix', '1.62', '1.62 USD'],
    ['unit case', '1.62 USD', '1.62 usd'],
    ['percentage versus absolute amount', '1.62', '1.62%'],
    ['invalid numeric suffix', '1.62', '1.62garbage'],
    ['internal whitespace', '1.62', '1 .62'],
    ['missing AI value', '1.62', undefined],
    ['missing rule value', undefined, '1.62'],
    ['blank AI value', '1.62', ' \t '],
    ['blank rule value', ' \t ', '1.62'],
    ['case-sensitive text parameter', 'Exact', 'exact'],
  ];
  for (const [name, ruleValue, aiValue] of conflictingValues) {
    it(`requires review without an alignment confidence boost for ${name}`, () => {
      expect(mergeValues(ruleValue, aiValue)).toMatchObject({
        agreement: 'conflict',
        source: 'rule_ai',
        actionType: 'lower_bid',
        recommendedValue: ruleValue,
        confidence: 0.78,
        requiresReview: true,
        riskWarnings: ['Rule and AI recommend different parameter values for the same action and target.'],
      });
    });
  }

  const matchingValues: Array<[string, string | undefined, string | undefined]> = [
    ['identical specified values', '1.62', '1.62'],
    ['outer whitespace only', ' 1.62\t', '\n1.62 '],
    ['both absent values', undefined, undefined],
    ['blank and absent values', ' \n', undefined],
  ];
  for (const [name, ruleValue, aiValue] of matchingValues) {
    it(`preserves comparison-only alignment for ${name}`, () => {
      expect(mergeValues(ruleValue, aiValue)).toMatchObject({
        agreement: 'aligned',
        recommendedValue: aiValue ?? ruleValue,
        confidence: 0.85,
        requiresReview: false,
        riskWarnings: [],
      });
    });
  }
});


describe('mergeAdDecisions scoped identity', () => {
  const candidate = { identity, entityType: 'target', entityName: 'same', actionType: 'lower_bid', recommendedValue: '1.62', reason: 'ISOLATED', confidence: 0.72 };
  for (const field of ['storeId', 'batchId', 'sourceFile', 'campaignName', 'adGroupName', 'matchType'] as const) {
    it(`does not merge same names across ${field}`, () => {
      const decisions = mergeAdDecisions({ ruleCandidates: [candidate], aiCandidates: [{ ...candidate, identity: { ...identity, [field]: 'different' } }] });
      expect(decisions).toHaveLength(2);
      expect(decisions.every((decision) => decision.requiresReview)).toBe(true);
    });
  }
  it('does not infer missing IDs from unique names', () => {
    const missing = { ...candidate, identity: undefined };
    const decisions = mergeAdDecisions({ ruleCandidates: [missing], aiCandidates: [missing] });
    expect(decisions).toHaveLength(2);
    expect(decisions.every((decision) => decision.requiresReview)).toBe(true);
  });
  it('does not greedily consume AI when multiple rules share identity', () => {
    const decisions = mergeAdDecisions({ ruleCandidates: [candidate, candidate], aiCandidates: [candidate] });
    expect(decisions).toHaveLength(3);
    expect(decisions.every((decision) => decision.requiresReview)).toBe(true);
  });
});
