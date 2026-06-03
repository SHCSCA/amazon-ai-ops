import { describe, expect, it } from 'vitest';
import type { ListingSuggestion } from '@amazon-ai-ops/shared-types';
import { buildRuleBasedListingDrafts } from './draft';

function suggestion(overrides: Partial<ListingSuggestion>): ListingSuggestion {
  return {
    asin: 'B001',
    keyword: 'compact garlic mincer',
    section: 'bullet',
    currentText: 'Durable stainless steel garlic press.',
    suggestedText: 'Durable stainless steel garlic press for compact garlic mincer prep.',
    evidence: 'clicks=40, orders=5',
    riskWarnings: [],
    status: 'pending',
    ...overrides,
  };
}

describe('buildRuleBasedListingDrafts', () => {
  it('groups accepted-safe suggestions by listing section into reviewable drafts', () => {
    const drafts = buildRuleBasedListingDrafts([
      suggestion({ keyword: 'compact garlic mincer' }),
      suggestion({
        keyword: 'easy clean garlic tool',
        suggestedText: 'Durable stainless steel garlic press for compact garlic mincer prep. Easy clean garlic tool.',
      }),
      suggestion({
        keyword: 'rival brand press',
        riskWarnings: ['possible_competitor_brand'],
      }),
    ], { appVersion: '1.5.0' });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toEqual(expect.objectContaining({
      asin: 'B001',
      section: 'bullet',
      source: 'rule',
      status: 'pending',
      appVersion: '1.5.0',
      keywords: ['compact garlic mincer', 'easy clean garlic tool'],
    }));
    expect(drafts[0].draftedText.toLowerCase()).toContain('easy clean garlic tool');
    expect(drafts[0].draftedText.toLowerCase()).not.toContain('rival brand press');
  });
});
