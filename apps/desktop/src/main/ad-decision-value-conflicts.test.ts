import { reportIdentityFixture } from './ad-decision-identity.test-support';
import { describe, expect, it, vi } from 'vitest';
import type { AdStrategyDiagnosisOutput } from '@amazon-ai-ops/ai-adapter';
import {
  applyRecommendationDecision,
  getExecutableValueBlockers,
  getRecommendationApprovalBlockers,
  mergeAdDecisions,
} from '@amazon-ai-ops/rules-engine';
import { annotateRecommendationsWithStrategy } from './ad-recommendation-ai-context';
import { TEST_EVIDENCE_SUFFICIENCY, recommendation, evidenceItem } from './ad-recommendation-ai.test-support';

const diagnosis: AdStrategyDiagnosisOutput = {
  schemaVersion: 'ad_strategy_diagnosis_v1',
  evidenceSufficiency: TEST_EVIDENCE_SUFFICIENCY,
  lifecycleStage: 'stable_conversion',
  lifecycleStageReason: 'ISOLATED_FIXTURE',
  lifecycleStageEvidenceRefs: [],
  summary: 'ISOLATED_FIXTURE',
  mainProblems: [],
  thresholdSuggestions: {
    targetAcos: { value: 0.25, reason: 'ISOLATED_FIXTURE' },
    highAcosThreshold: { value: 0.4, reason: 'ISOLATED_FIXTURE' },
    noOrderClickThreshold: { value: 30, reason: 'ISOLATED_FIXTURE' },
    minSpend: { value: 10, reason: 'ISOLATED_FIXTURE' },
  },
  aiCandidates: [],
  insightOnlyCandidates: [],
  riskWarnings: [],
  source: 'ai',
};

function annotateMergedValues(ruleValue: string, aiValue?: string) {
  const fixture = reportIdentityFixture(recommendation({
    entityType: 'target',
    entityName: 'ISOLATED_FIXTURE value target',
    actionType: 'lower_bid',
    currentValue: '1.80',
    recommendedValue: ruleValue,
    reason: 'ISOLATED_FIXTURE',
    confidence: 0.72,
  }));
  const original = fixture.recommendation;
  const ai = { ...original, recommendedValue: aiValue, confidence: 0.78, evidenceRefs: ['metric_1'], reasoningSteps: [], riskWarnings: [] };
  const decisions = mergeAdDecisions({
    ruleCandidates: [{ ...original, identity: fixture.identity }],
    aiCandidates: [{ ...ai, identity: fixture.identity }],
  });
  const [annotated] = annotateRecommendationsWithStrategy({
    recommendations: [original],
    diagnosis: { ...diagnosis, aiCandidates: [ai] },
    identityScope: fixture.scope,
    identityMetrics: [fixture.metric],
    evidencePack: [fixture.evidence],
    decisions,
    operationEventCount: 0,
  });
  return { original, decisions, annotated };
}

describe('merged value conflicts reach the existing approval guards', () => {
  it.each(['1.44', '1.71', undefined, '-10%', '1.620'])(
    'retains the rule value and blocks approval for AI value %s',
    (aiValue) => {
      const { original, annotated } = annotateMergedValues('1.62', aiValue);
      expect(annotated).toMatchObject({
        status: 'needs_review',
        recommendedValue: '1.62',
        confidence: 0.78,
        evidence: { decisionAgreement: 'conflict', decisionRequiresReview: true },
      });
      const blockers = getRecommendationApprovalBlockers({ ...annotated, status: 'pending' });
      expect(blockers).toContain('AI/规则冲突');
      expect(blockers).toContain('AI/规则合并标记需复核');
      const persist = vi.fn();
      expect(() => applyRecommendationDecision({
        recommendation: annotated,
        targetStatus: 'approved',
        decision: { approvedBy: 'ISOLATED_FIXTURE' },
        persist,
      })).toThrow('needs_review');
      expect(persist).not.toHaveBeenCalled();
      expect(original.status).toBe('pending');
    },
  );

  it('does not treat both-missing lower_bid comparison alignment as executable approval', () => {
    const { decisions, annotated } = annotateMergedValues('', undefined);
    expect(decisions[0].agreement).toBe('aligned');
    expect(getExecutableValueBlockers(annotated)).toContain('出价建议值必须是可执行的正数金额');
    const persist = vi.fn();
    expect(() => applyRecommendationDecision({
      recommendation: annotated,
      targetStatus: 'approved',
      decision: { approvedBy: 'ISOLATED_FIXTURE' },
      persist,
    })).toThrow('出价建议值必须是可执行的正数金额');
    expect(persist).not.toHaveBeenCalled();
  });
});

function duplicateRecommendations() {
  return ['1.62', '1.71'].map((recommendedValue, index) => {
    const row = recommendation({
      entityType: 'target',
      entityName: 'ISOLATED_FIXTURE value target',
      entityId: `ISOLATED_FIXTURE_${index}`,
      actionType: 'lower_bid',
      currentValue: '1.80',
      recommendedValue,
      reason: 'ISOLATED_FIXTURE',
      confidence: 0.72,
    });
    return { ...row, evidence: { ...row.evidence, campaignName: `ISOLATED_FIXTURE campaign ${index}` } };
  });
}

function expectAmbiguousBindingBlocked(
  recommendations: ReturnType<typeof duplicateRecommendations>,
  decisions: ReturnType<typeof mergeAdDecisions>,
) {
  const annotated = annotateRecommendationsWithStrategy({ recommendations, decisions, diagnosis, operationEventCount: 0 });
  for (const [index, item] of annotated.entries()) {
    expect(item).toMatchObject({
      status: 'needs_review',
      recommendedValue: recommendations[index].recommendedValue,
      confidence: recommendations[index].confidence,
      evidence: {
        decisionAgreement: undefined,
        decisionSource: undefined,
        decisionReasons: undefined,
        aiEvidenceRefs: undefined,
        decisionRequiresReview: true,
        decisionRiskWarnings: ['对象身份缺失、冲突或非一对一，无法安全匹配规则/AI 决策，必须人工复核。'],
      },
    });
    expect(getRecommendationApprovalBlockers({ ...item, status: 'pending' })).toContain('AI/规则合并标记需复核');
    const persist = vi.fn();
    expect(() => applyRecommendationDecision({
      recommendation: item,
      targetStatus: 'approved',
      decision: { approvedBy: 'ISOLATED_FIXTURE' },
      persist,
    })).toThrow('needs_review');
    expect(persist).not.toHaveBeenCalled();
    expect(recommendations[index].status).toBe('pending');
  }
}

describe('ambiguous recommendation decision bindings fail closed', () => {
  it('does not let the first aligned decision mask a second cross-campaign value conflict', () => {
    const rows = duplicateRecommendations();
    const decisions = mergeAdDecisions({
      ruleCandidates: rows,
      aiCandidates: [{ ...rows[0], confidence: 0.78 }, { ...rows[1], recommendedValue: '1.44', confidence: 0.78 }],
    });
    expect(decisions.map(item => item.agreement)).toEqual(['rule_only', 'rule_only', 'ai_only', 'ai_only']);
    expectAmbiguousBindingBlocked(rows, decisions);
  });

  it('does not borrow an aligned decision for a second rule-only row', () => {
    const rows = duplicateRecommendations();
    const decisions = mergeAdDecisions({ ruleCandidates: rows, aiCandidates: [rows[0]] });
    expect(decisions.map(item => item.agreement)).toEqual(['rule_only', 'rule_only', 'ai_only']);
    expectAmbiguousBindingBlocked(rows, decisions);
  });

  it('blocks one decision shared by normalized duplicate recommendation keys', () => {
    const rows = duplicateRecommendations();
    rows[1] = { ...rows[1], entityName: ` ${rows[1].entityName.toUpperCase()} ` };
    const decisions = mergeAdDecisions({ ruleCandidates: [rows[0]], aiCandidates: [rows[0]] });
    expectAmbiguousBindingBlocked(rows, decisions);
  });

  it('blocks multiple matching decisions for one recommendation', () => {
    const rows = duplicateRecommendations().slice(0, 1);
    const decisions = mergeAdDecisions({ ruleCandidates: rows, aiCandidates: [rows[0], { ...rows[0], recommendedValue: '1.71' }] });
    expectAmbiguousBindingBlocked(rows, decisions);
  });

  it('does not let duplicate rule-only decisions override each other', () => {
    const rows = duplicateRecommendations();
    expectAmbiguousBindingBlocked(rows, mergeAdDecisions({ ruleCandidates: rows, aiCandidates: [] }));
  });

  it.each([[true, false], [false, true], [true, true]])(
    'is order independent when reverseRows=%s and reverseDecisions=%s',
    (reverseRows, reverseDecisions) => {
      const rows = duplicateRecommendations();
      const decisions = mergeAdDecisions({
        ruleCandidates: rows,
        aiCandidates: [rows[0], { ...rows[1], recommendedValue: '1.44' }],
      });
      expectAmbiguousBindingBlocked(reverseRows ? [...rows].reverse() : rows, reverseDecisions ? [...decisions].reverse() : decisions);
    },
  );

  it.each(['actionType', 'entityType'] as const)(
    'preserves unique matching for same-name recommendations with distinct %s',
    (distinction) => {
      const rows = duplicateRecommendations();
      rows[1] = distinction === 'actionType'
        ? { ...rows[1], actionType: 'raise_bid', recommendedValue: '1.98' }
        : { ...rows[1], entityType: 'search_term' };
      const fixtures = rows.map((row, index) => reportIdentityFixture(row, evidenceItem({ sourceFile: 'ISOLATED_FIXTURE.csv', sourceRow: index + 1, evidenceId: `metric_${index}` })));
      const candidates = fixtures.map((fixture) => ({ ...fixture.recommendation, identity: fixture.identity }));
      const aiCandidates = candidates.map((row, index) => ({ ...row, confidence: 0.78, evidenceRefs: [fixtures[index].evidence.evidenceId], reasoningSteps: [], riskWarnings: [] }));
      const decisions = mergeAdDecisions({ ruleCandidates: candidates, aiCandidates });
      const annotated = annotateRecommendationsWithStrategy({ recommendations: fixtures.map((item) => item.recommendation), decisions,
        diagnosis: { ...diagnosis, aiCandidates }, identityScope: fixtures[0].scope,
        identityMetrics: fixtures.map((item) => item.metric), evidencePack: fixtures.map((item) => item.evidence), operationEventCount: 0 });
      for (const [index, item] of annotated.entries()) {
        expect(item.status).toBe('pending');
        expect(item.recommendedValue).toBe(rows[index].recommendedValue);
        expect(item.confidence).toBe(0.85);
        expect(item.evidence.decisionAgreement).toBe('aligned');
        expect(item.evidence.decisionRequiresReview).toBe(false);
      }
    },
  );
});
