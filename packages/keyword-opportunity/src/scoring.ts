import type { KeywordMetric, KeywordOpportunity, ListingSection } from '@amazon-ai-ops/shared-types';
import { checkKeywordRisk } from './risk-checker';

export interface ScoreKeywordOptions {
  brandWhitelist?: string[];
  coveredSections?: ListingSection[];
}

export function scoreKeywordOpportunity(metric: KeywordMetric, options: ScoreKeywordOptions = {}): KeywordOpportunity {
  const acos = metric.sales > 0 ? metric.cost / metric.sales : metric.acos;
  const cvr = metric.clicks > 0 ? metric.orders / metric.clicks : metric.cvr;
  const conversionScore = metric.orders > 0 ? Math.min(40, metric.orders * 8 + cvr * 100) : 0;
  const efficiencyScore = metric.sales > 0 && acos <= 0.35 ? 30 : metric.clicks >= 10 && metric.orders === 0 ? -20 : 10;
  const trafficScore = Math.min(20, metric.clicks * 1.5 + metric.impressions / 1000);
  const coveragePenalty = options.coveredSections && options.coveredSections.length > 0 ? 20 : 0;
  const risk = checkKeywordRisk(metric.rawKeyword, options.brandWhitelist);
  const riskPenalty = risk.riskFlags.length * 10;
  const score = Math.max(0, Math.min(100, conversionScore + efficiencyScore + trafficScore - coveragePenalty - riskPenalty));
  const evidenceParts = [
    ['clicks', String(metric.clicks)],
    ['orders', String(metric.orders)],
    ['impressions', String(metric.impressions)],
    ['cost', String(metric.cost)],
    ['sales', String(metric.sales)],
    ['acos', acos.toFixed(2)],
    ['cvr', cvr.toFixed(2)],
    ['source', metric.source],
    ['source_file', metric.sourceFile || ''],
    ['source_row', metric.sourceRow === undefined ? '' : String(metric.sourceRow)],
    ['coverage_sections', options.coveredSections?.join('|') || ''],
    ['coverage_penalty', String(coveragePenalty)],
    ['risk_penalty', String(riskPenalty)],
  ];

  return {
    asin: metric.asin,
    normalizedKeyword: metric.normalizedKeyword,
    opportunityLevel: score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low',
    score,
    evidence: evidenceParts.map(([key, value]) => `${key}=${value}`).join(', '),
    riskFlags: risk.riskFlags,
    recommendedSections: score >= 70 ? ['title', 'bullet'] : score >= 40 ? ['bullet', 'backend_terms'] : ['backend_terms'],
    status: 'pending',
  };
}
