import type { KeywordOpportunity, ListingSection } from '@amazon-ai-ops/shared-types';

const BLOCKING_RISK_FLAGS = new Set([
  'possible_competitor_brand',
  'medical_claim',
  'absolute_claim',
  'trademark_risk',
  'false_claim',
]);

export function isBlockedForListing(opportunity: KeywordOpportunity): boolean {
  return opportunity.riskFlags.some((flag) => BLOCKING_RISK_FLAGS.has(flag));
}

export function recommendListingSection(opportunity: KeywordOpportunity): ListingSection {
  if (opportunity.opportunityLevel === 'high') return opportunity.recommendedSections[0] ?? 'title';
  if (opportunity.opportunityLevel === 'medium') return 'bullet';
  return 'backend_terms';
}
