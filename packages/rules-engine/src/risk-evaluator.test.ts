import { describe, expect, it } from 'vitest';
import { RiskEvaluator } from './risk-evaluator';
import { DEFAULT_RULE_CONFIG } from './types';

describe('RiskEvaluator', () => {
  it('uses USD in bid boundary warnings', () => {
    const evaluator = new RiskEvaluator({
      ...DEFAULT_RULE_CONFIG,
      minCpc: 0.5,
    });

    const result = evaluator.evaluate({
      triggered: true,
      actionType: 'lower_bid',
      recommendedValue: '0.30',
      reason: 'Lower bid',
      confidence: 0.8,
      evidence: { metric: 'acos', currentValue: 0.5, threshold: 0.4 },
    }, 1.0);

    expect(result.warnings.join('\n')).toContain('USD 0.30');
    expect(result.warnings.join('\n')).not.toMatch(/¥|RMB|CNY|人民币|元/);
  });
});
