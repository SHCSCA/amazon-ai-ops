import { describe, expect, it } from 'vitest';
import { mergeAdDecisions } from './ad-decision-merger';

describe('mergeAdDecisions', () => {
  it('marks matching rule and AI candidates as aligned and raises confidence within a safe cap', () => {
    const result = mergeAdDecisions({
      ruleCandidates: [
        {
          entityType: 'search_term',
          entityName: 'smart lock outdoor',
          actionType: 'lower_bid',
          reason: 'No-order spend exceeds threshold.',
          confidence: 0.72,
        },
      ],
      aiCandidates: [
        {
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
          entityType: 'keyword',
          entityName: 'smart lock',
          actionType: 'lower_bid',
          reason: 'ACOS is above high threshold.',
          confidence: 0.7,
        },
      ],
      aiCandidates: [
        {
          entityType: 'keyword',
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
      entityType: 'keyword',
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

  it('keeps rule-only candidates executable by approval policy but labels missing AI confirmation', () => {
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
