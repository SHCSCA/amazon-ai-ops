import { describe, expect, it } from 'vitest';
import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import { AdRules } from './ad-rules';
import { DEFAULT_RULE_CONFIG } from './types';

describe('AdRules', () => {
  it('uses USD in no-conversion spend reasons', () => {
    const rules = new AdRules(DEFAULT_RULE_CONFIG);

    const result = rules.checkNoConversion({
      config: DEFAULT_RULE_CONFIG,
      metrics: {
        clicks: 31,
        orders: 0,
        cost: 21.56,
        searchTerm: 'irrelevant search term',
      } as AdDailyMetrics,
    });

    expect(result.triggered).toBe(true);
    expect(result.reason).toContain('USD 21.56');
    expect(result.reason).not.toMatch(/¥|RMB|CNY|人民币|元/);
  });
});
