const ABSOLUTE_WORDS = ['best', 'number one', 'guaranteed', '100%', '永久', '第一', '最强'];
const MEDICAL_WORDS = ['cure', 'treat', '治疗', '治愈', '医疗'];

export interface KeywordRiskResult {
  riskFlags: string[];
}

export function checkKeywordRisk(keyword: string, brandWhitelist: string[] = []): KeywordRiskResult {
  const normalized = keyword.toLowerCase();
  const riskFlags: string[] = [];

  if (ABSOLUTE_WORDS.some((word) => normalized.includes(word.toLowerCase()))) {
    riskFlags.push('absolute_claim');
  }
  if (MEDICAL_WORDS.some((word) => normalized.includes(word.toLowerCase()))) {
    riskFlags.push('medical_claim');
  }
  if (brandWhitelist.length > 0 && brandWhitelist.every((brand) => !normalized.includes(brand.toLowerCase()))) {
    const maybeBrand = keyword.split(/\s+/).find((part) => /^[A-Z][A-Za-z0-9-]{2,}$/.test(part));
    if (maybeBrand) riskFlags.push('possible_competitor_brand');
  }

  return { riskFlags };
}
