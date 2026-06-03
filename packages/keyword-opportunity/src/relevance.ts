export function isKeywordRelevant(keyword: string, listingText: string): boolean {
  const terms = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  const text = listingText.toLowerCase();
  if (terms.length === 0) return false;
  return terms.some((term) => text.includes(term));
}
