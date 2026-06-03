import type { KeywordOpportunity, ListingContent, ListingSuggestion } from '@amazon-ai-ops/shared-types';
import { isBlockedForListing, recommendListingSection } from './section-recommender';

export interface BuildListingSuggestionOptions {
  appVersion?: string;
}

export function buildListingSuggestion(
  listing: ListingContent,
  opportunity: KeywordOpportunity,
  options: BuildListingSuggestionOptions = {},
): ListingSuggestion | null {
  if (isBlockedForListing(opportunity)) {
    return null;
  }

  const section = recommendListingSection(opportunity);
  const currentText =
    section === 'title'
      ? listing.title
      : section === 'bullet'
        ? listing.bullets[0]
        : section === 'a_plus'
          ? listing.aPlus
          : section === 'image_copy'
            ? listing.imageCopy
            : listing.backendTerms;

  const suffix = ` ${opportunity.normalizedKeyword}`.trim();
  const suggestedText = currentText && !currentText.toLowerCase().includes(opportunity.normalizedKeyword)
    ? `${currentText} ${suffix}`.trim()
    : currentText || suffix;

  return {
    appVersion: options.appVersion,
    asin: listing.asin,
    keyword: opportunity.normalizedKeyword,
    section,
    currentText,
    suggestedText,
    evidence: opportunity.evidence,
    riskWarnings: opportunity.riskFlags,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
}

export function buildListingSuggestions(
  listing: ListingContent,
  opportunities: KeywordOpportunity[],
  options: BuildListingSuggestionOptions = {},
): ListingSuggestion[] {
  return opportunities
    .map((opportunity) => buildListingSuggestion(listing, opportunity, options))
    .filter((suggestion): suggestion is ListingSuggestion => suggestion !== null);
}
