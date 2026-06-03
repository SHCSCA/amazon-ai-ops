import type { KeywordCoverage, ListingContent, ListingSection } from '@amazon-ai-ops/shared-types';

function includesKeyword(text: string | undefined, keyword: string): boolean {
  if (!text) return false;
  return text.toLowerCase().includes(keyword.toLowerCase());
}

export function analyzeKeywordCoverage(listing: ListingContent, keywords: string[]): KeywordCoverage[] {
  return keywords.map((keyword) => {
    const sections: ListingSection[] = [];
    if (includesKeyword(listing.title, keyword)) sections.push('title');
    if (listing.bullets.some((bullet) => includesKeyword(bullet, keyword))) sections.push('bullet');
    if (includesKeyword(listing.aPlus, keyword)) sections.push('a_plus');
    if (includesKeyword(listing.imageCopy, keyword)) sections.push('image_copy');
    if (includesKeyword(listing.backendTerms, keyword)) sections.push('backend_terms');

    const strength = Math.min(100, sections.length * 20 + (sections.includes('title') ? 30 : 0));
    return {
      normalizedKeyword: keyword,
      covered: sections.length > 0,
      sections,
      strength,
    };
  });
}
