import { describe, expect, it } from 'vitest';
import type { KeywordOpportunity, ListingContent } from '@amazon-ai-ops/shared-types';
import { buildListingSuggestion, buildListingSuggestions } from './rewrite';

const listing: ListingContent = {
  asin: 'B001',
  title: 'Stainless insulated mug',
  bullets: ['Keeps drinks cold'],
};

function opportunity(overrides: Partial<KeywordOpportunity>): KeywordOpportunity {
  return {
    normalizedKeyword: 'competitor cure claim',
    opportunityLevel: 'high',
    score: 95,
    evidence: 'High search volume with conversion opportunity',
    riskFlags: [],
    recommendedSections: ['title'],
    status: 'pending',
    ...overrides,
  };
}

describe('buildListingSuggestion', () => {
  it('does not generate a listing suggestion for high opportunity blocked keywords', () => {
    const blocked = opportunity({
      riskFlags: ['medical_claim'],
    });

    expect(buildListingSuggestion(listing, blocked)).toBeNull();
    expect(buildListingSuggestions(listing, [blocked])).toEqual([]);
  });
});
