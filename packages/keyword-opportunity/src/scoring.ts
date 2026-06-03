import type { KeywordMetric, KeywordOpportunity, ListingSection } from '@amazon-ai-ops/shared-types';
import { checkKeywordRisk } from './risk-checker';

export interface ScoreKeywordOptions {
  brandWhitelist?: string[];
  coveredSections?: ListingSection[];
}

export function scoreKeywordOpportunity(metric: KeywordMetric, options: ScoreKeywordOptions = {}): KeywordOpportunity {
  const conversionScore = metric.orders > 0 ? Math.min(40, metric.orders * 8 + metric.cvr * 100) : 0;
  const efficiencyScore = metric.sales > 0 && metric.acos <= 0.35 ? 30 : metric.clicks >= 10 && metric.orders === 0 ? -20 : 10;
  const trafficScore = Math.min(20, metric.clicks * 1.5 + metric.impressions / 1000);
  const coveragePenalty = options.coveredSections && options.coveredSections.length > 0 ? 20 : 0;
  const risk = checkKeywordRisk(metric.rawKeyword, options.brandWhitelist);
  const riskPenalty = risk.riskFlags.length * 10;
  const score = Math.max(0, Math.min(100, conversionScore + efficiencyScore + trafficScore - coveragePenalty - riskPenalty));

  return {
    asin: metric.asin,
    normalizedKeyword: metric.normalizedKeyword,
    opportunityLevel: score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low',
    score,
    evidence: `clicks=${metric.clicks}, orders=${metric.orders}, sales=${metric.sales}, acos=${metric.acos.toFixed(2)}`,
    riskFlags: risk.riskFlags,
    recommendedSections: score >= 70 ? ['title', 'bullet'] : score >= 40 ? ['bullet', 'backend_terms'] : ['backend_terms'],
    status: 'pending',
  };
}
