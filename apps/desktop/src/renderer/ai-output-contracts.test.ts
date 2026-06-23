import { describe, expect, it } from 'vitest';
import {
  aiContractPrimaryCopy,
  aiOutputContracts,
  aiOutputContractTags,
  hasRawJsonPrimaryCopy,
} from './ai-output-contracts';

describe('AI output contracts', () => {
  it('lists the fixed contracts consumed by the app', () => {
    expect(aiOutputContracts.map((contract) => contract.version)).toEqual([
      'ad_strategy_diagnosis_v1',
      'ad_action_reason_v1',
      'listing_rewrite_v1',
    ]);
  });

  it('shows operator-facing tags instead of asking users to reason about raw JSON', () => {
    expect(aiOutputContractTags().map((tag) => tag.label)).toEqual([
      '广告诊断 v1',
      '广告解释 v1',
      'Listing 草案 v1',
      '异常回退规则',
    ]);
    expect(hasRawJsonPrimaryCopy(aiContractPrimaryCopy())).toBe(false);
  });
});
