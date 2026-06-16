import type { AIProvider } from './provider';

export type AdLifecycleStage =
  | 'cold_start'
  | 'keyword_exploration'
  | 'stable_conversion'
  | 'scaling'
  | 'profit_harvesting'
  | 'clearance'
  | 'declining_repair'
  | 'unknown';

export interface AdStrategyDiagnosisInput {
  scope: {
    dateFrom: string;
    dateTo: string;
    storeName: string;
    marketplaceCode: string;
    asin?: string;
    batchId?: string;
    currency: 'USD';
  };
  metrics: AdStrategyMetric[];
  productContexts?: ProductStrategyContext[];
  adObjectTimelines: AdStrategyTimeline[];
  operationEvents: OperationEventContext[];
  currentRuleConfig: RuleThresholdConfig;
  ruleCandidates: RuleCandidateContext[];
}

export interface ProductStrategyContext {
  asin: string;
  parentAsin?: string;
  msku?: string;
  sku?: string;
  title?: string;
  productStage?: string;
  status?: string;
  cost?: {
    purchaseCost?: number;
    firstLegCost?: number;
    fbaFee?: number;
    referralFeeRate?: number;
    storageFee?: number;
    otherCost?: number;
    minPrice?: number;
    targetNetMargin?: number;
    targetAcos?: number;
    targetTacos?: number;
  };
}

export interface AdStrategyMetric {
  date?: string;
  portfolioName?: string;
  campaignName?: string;
  adGroupName?: string;
  asin?: string;
  searchTerm?: string;
  targeting?: string;
  impressions?: number;
  clicks?: number;
  cost?: number;
  orders?: number;
  sales?: number;
  acos?: number | null;
  cpc?: number | null;
  cvr?: number | null;
}

export interface AdStrategyTimeline {
  objectType: 'search_term' | 'target' | 'ad_group' | 'campaign';
  objectName: string;
  asin?: string;
  campaignName?: string;
  adGroupName?: string;
  dateFrom: string;
  dateTo: string;
  daysActive: number;
  lifecycleStage: AdLifecycleStage;
  status: 'healthy' | 'watch' | 'waste' | 'scale' | 'blocked';
  totals: {
    clicks: number;
    cost: number;
    orders: number;
    sales: number;
    acos: number;
    cvr: number;
    currency: 'USD';
  };
  thresholdSuggestion: RuleThresholdConfig & {
    scaleAcosThreshold?: number;
    bidAdjustPercent?: number;
    maxBidDecrement?: number;
    maxBidIncrement?: number;
  };
  trend: {
    spend: string;
    sales: string;
  };
  reasons: string[];
}

export interface OperationEventContext {
  eventDate: string;
  eventType: string;
  title: string;
  impactExpectation?: string;
  asin?: string;
  campaignName?: string;
  adGroupName?: string;
  notes?: string;
}

export interface RuleThresholdConfig {
  targetAcos: number;
  highAcosThreshold: number;
  noOrderClickThreshold: number;
  minSpend: number;
}

export interface RuleCandidateContext {
  entityType?: string;
  entityName?: string;
  actionType?: string;
  reason?: string;
  confidence?: number;
}

export interface ThresholdSuggestion {
  value: number;
  reason: string;
}

export interface AiAdCandidate {
  entityType: string;
  entityName: string;
  actionType: string;
  recommendedValue?: string;
  reason: string;
  confidence: number;
}

export interface AdStrategyDiagnosisOutput {
  lifecycleStage: AdLifecycleStage;
  summary: string;
  mainProblems: string[];
  thresholdSuggestions: {
    targetAcos: ThresholdSuggestion;
    highAcosThreshold: ThresholdSuggestion;
    noOrderClickThreshold: ThresholdSuggestion;
    minSpend: ThresholdSuggestion;
  };
  aiCandidates: AiAdCandidate[];
  riskWarnings: string[];
  source: 'ai' | 'rule';
  aiFallbackReason?: string;
}

const VALID_STAGES = new Set<AdLifecycleStage>([
  'cold_start',
  'keyword_exploration',
  'stable_conversion',
  'scaling',
  'profit_harvesting',
  'clearance',
  'declining_repair',
  'unknown',
]);

export class AdStrategyDiagnoser {
  constructor(private readonly provider: AIProvider) {}

  async diagnose(input: AdStrategyDiagnosisInput): Promise<AdStrategyDiagnosisOutput> {
    try {
      const response = await this.provider.chat(
        [
          {
            role: 'system',
            content:
              'You are a senior Amazon Ads strategist. Diagnose the product advertising lifecycle stage, quantitative thresholds, and safe candidate actions. Return strict JSON only. Never execute ads.',
          },
          {
            role: 'user',
            content: this.buildPrompt(input),
          },
        ],
        { temperature: 0.2 },
      );

      if (!response.success) {
        return this.fallback(input, response.error || 'AI provider returned an unsuccessful response');
      }

      return this.normalizeOutput(parseJsonObject(response.content || ''), input);
    } catch (error) {
      return this.fallback(input, error instanceof Error ? error.message : String(error));
    }
  }

  private buildPrompt(input: AdStrategyDiagnosisInput): string {
    const payload = {
      scope: input.scope,
      currency: 'USD',
      productContexts: input.productContexts || [],
      currentRuleConfig: input.currentRuleConfig,
      adObjectTimelines: input.adObjectTimelines.slice(0, 40),
      metricsSample: input.metrics.slice(0, 80),
      operationEvents: input.operationEvents,
      ruleCandidates: input.ruleCandidates.slice(0, 80),
      requiredOutput: {
        lifecycleStage:
          'cold_start | keyword_exploration | stable_conversion | scaling | profit_harvesting | clearance | declining_repair | unknown',
        summary: 'short business diagnosis',
        mainProblems: ['problem codes'],
        thresholdSuggestions: {
          targetAcos: { value: 'number', reason: 'why' },
          highAcosThreshold: { value: 'number', reason: 'why' },
          noOrderClickThreshold: { value: 'number', reason: 'why' },
          minSpend: { value: 'number', reason: 'why' },
        },
        aiCandidates: [
          {
            entityType: 'keyword | search_term | target | campaign | ad_group | product',
            entityName: 'business entity name',
            actionType: 'lower_bid | raise_bid | pause | add_negative | harvest | observe',
            recommendedValue: 'optional target value or percentage',
            reason: 'evidence-based reason',
            confidence: '0..1',
          },
        ],
        riskWarnings: ['manual review warnings'],
      },
    };

    return [
      'Analyze the following Amazon Ads operating scope.',
      'All money must use the USD currency format.',
      'Use product stage, cost structure, target margin, target ACOS, and target TACOS when suggesting thresholds.',
      'Use operator events such as coupons, promotions, BD, price changes, and listing changes when interpreting performance.',
      'Suggest quantitative thresholds for this product stage. Do not execute ads.',
      'Return only one JSON object matching requiredOutput.',
      JSON.stringify(payload, null, 2),
    ].join('\n\n');
  }

  private normalizeOutput(raw: unknown, input: AdStrategyDiagnosisInput): AdStrategyDiagnosisOutput {
    if (!isRecord(raw)) {
      return this.fallback(input, 'AI response was not a JSON object');
    }

    const lifecycleStage = String(raw.lifecycleStage || 'unknown') as AdLifecycleStage;
    const thresholdSuggestions = isRecord(raw.thresholdSuggestions) ? raw.thresholdSuggestions : {};

    return {
      lifecycleStage: VALID_STAGES.has(lifecycleStage) ? lifecycleStage : 'unknown',
      summary: stringOrDefault(raw.summary, 'AI diagnosis returned no summary.'),
      mainProblems: stringArray(raw.mainProblems),
      thresholdSuggestions: {
        targetAcos: normalizeThreshold(thresholdSuggestions.targetAcos, input.currentRuleConfig.targetAcos),
        highAcosThreshold: normalizeThreshold(
          thresholdSuggestions.highAcosThreshold,
          input.currentRuleConfig.highAcosThreshold,
        ),
        noOrderClickThreshold: normalizeThreshold(
          thresholdSuggestions.noOrderClickThreshold,
          input.currentRuleConfig.noOrderClickThreshold,
        ),
        minSpend: normalizeThreshold(thresholdSuggestions.minSpend, input.currentRuleConfig.minSpend),
      },
      aiCandidates: normalizeCandidates(raw.aiCandidates),
      riskWarnings: stringArray(raw.riskWarnings),
      source: 'ai',
    };
  }

  private fallback(input: AdStrategyDiagnosisInput, reason: string): AdStrategyDiagnosisOutput {
    return {
      lifecycleStage: 'unknown',
      summary: 'AI diagnosis unavailable; using deterministic rules only.',
      mainProblems: [],
      thresholdSuggestions: {
        targetAcos: {
          value: input.currentRuleConfig.targetAcos,
          reason: 'Current rule configuration fallback.',
        },
        highAcosThreshold: {
          value: input.currentRuleConfig.highAcosThreshold,
          reason: 'Current rule configuration fallback.',
        },
        noOrderClickThreshold: {
          value: input.currentRuleConfig.noOrderClickThreshold,
          reason: 'Current rule configuration fallback.',
        },
        minSpend: {
          value: input.currentRuleConfig.minSpend,
          reason: 'Current rule configuration fallback.',
        },
      },
      aiCandidates: [],
      riskWarnings: ['AI unavailable'],
      source: 'rule',
      aiFallbackReason: reason,
    };
  }
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(withoutFence);
}

function normalizeThreshold(value: unknown, fallbackValue: number): ThresholdSuggestion {
  if (!isRecord(value)) {
    return { value: fallbackValue, reason: 'Current rule configuration fallback.' };
  }
  const numericValue = Number(value.value);
  return {
    value: Number.isFinite(numericValue) ? numericValue : fallbackValue,
    reason: stringOrDefault(value.reason, 'AI did not provide a threshold reason.'),
  };
}

function normalizeCandidates(value: unknown): AiAdCandidate[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(isRecord)
    .map((candidate) => {
      const confidence = Number(candidate.confidence);
      return {
        entityType: stringOrDefault(candidate.entityType, 'unknown'),
        entityName: stringOrDefault(candidate.entityName, 'unknown'),
        actionType: stringOrDefault(candidate.actionType, 'observe'),
        recommendedValue:
          typeof candidate.recommendedValue === 'string' ? candidate.recommendedValue : undefined,
        reason: stringOrDefault(candidate.reason, 'AI did not provide a reason.'),
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      };
    });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringOrDefault(value: unknown, fallbackValue: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallbackValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
