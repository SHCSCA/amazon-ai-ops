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
  productHistoryLedgers?: AdProductHistoryLedgerContext[];
  adObjectTimelines: AdStrategyTimeline[];
  operationEvents: OperationEventContext[];
  currentRuleConfig: RuleThresholdConfig;
  ruleCandidates: RuleCandidateContext[];
  evidencePack?: AiEvidenceItem[];
}

export interface AdProductHistoryLedgerContext {
  asin: string;
  storeName: string;
  marketplaceCode: string;
  dateFrom: string;
  dateTo: string;
  activeDays: number;
  firstMetricDate?: string;
  lastMetricDate?: string;
  inferredStage: string;
  stageReasons: string[];
  totals: {
    impressions: number;
    clicks: number;
    cost: number;
    orders: number;
    sales: number;
    acos: number;
    cpc: number;
    cvr: number;
    currency: 'USD';
  };
  recentDaily: Array<{
    date: string;
    clicks: number;
    cost: number;
    orders: number;
    sales: number;
    acos: number;
    cvr: number;
    currency: 'USD';
  }>;
  events: Array<{
    eventDate: string;
    eventType: string;
    title: string;
    impactExpectation?: string;
  }>;
  product?: {
    productStage?: string;
    targetAcos?: number;
    targetTacos?: number;
    targetNetMargin?: number;
    minPrice?: number;
  };
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

export type AiEvidenceType =
  | 'metric'
  | 'timeline'
  | 'operation_event'
  | 'product_context'
  | 'rule_candidate';

export interface AiEvidenceItem {
  evidenceId: string;
  type: AiEvidenceType;
  label: string;
  dateRange?: string;
  batchId?: string;
  reportType?: string;
  sourceFile?: string;
  sourceRow?: number;
  storeName?: string;
  marketplaceCode?: string;
  asin?: string;
  portfolioName?: string;
  campaignName?: string;
  adGroupName?: string;
  entityType?: string;
  entityName?: string;
  metrics?: {
    impressions?: number;
    clicks?: number;
    cost?: number;
    orders?: number;
    sales?: number;
    acos?: number;
    cpc?: number;
    cvr?: number;
    currency: 'USD';
  };
  event?: {
    eventDate?: string;
    eventType?: string;
    title?: string;
    impactExpectation?: string;
  };
  product?: {
    productStage?: string;
    targetAcos?: number;
    targetTacos?: number;
    targetNetMargin?: number;
    minPrice?: number;
  };
  timeline?: {
    activeDays?: number;
    firstMetricDate?: string;
    lastMetricDate?: string;
    inferredStage?: string;
    stageReasons?: string[];
    recentDaily?: Array<{
      date: string;
      clicks?: number;
      cost?: number;
      orders?: number;
      sales?: number;
      acos?: number;
      cvr?: number;
      currency: 'USD';
    }>;
  };
}

export interface ThresholdSuggestion {
  value: number;
  reason: string;
  evidenceRefs?: string[];
  requiresReview?: boolean;
  reviewReasons?: string[];
}

export interface AiReasonedDecision {
  entityType: string;
  entityName: string;
  actionType: string;
  recommendedValue?: string;
  reason: string;
  reasoningSteps: string[];
  evidenceRefs: string[];
  riskWarnings: string[];
  confidence: number;
}

export type AiAdCandidate = AiReasonedDecision;

export type AiEvidenceSufficiencyLevel = 'none' | 'low' | 'medium' | 'high';

export interface AiEvidenceSufficiency {
  level: AiEvidenceSufficiencyLevel;
  metricEvidenceCount: number;
  sampleDays: number;
  totalClicks: number;
  totalCost: number;
  totalOrders: number;
  canUseForFormalActions: boolean;
  blockers: string[];
  warnings: string[];
}

export interface AdStrategyDiagnosisOutput {
  schemaVersion: 'ad_strategy_diagnosis_v1';
  evidenceSufficiency: AiEvidenceSufficiency;
  lifecycleStage: AdLifecycleStage;
  lifecycleStageReason: string;
  lifecycleStageEvidenceRefs: string[];
  lifecycleStageRequiresReview?: boolean;
  lifecycleStageInvalidReasons?: string[];
  summary: string;
  mainProblems: string[];
  thresholdSuggestions: {
    targetAcos: ThresholdSuggestion;
    highAcosThreshold: ThresholdSuggestion;
    noOrderClickThreshold: ThresholdSuggestion;
    minSpend: ThresholdSuggestion;
  };
  aiCandidates: AiReasonedDecision[];
  insightOnlyCandidates: AiReasonedDecision[];
  riskWarnings: string[];
  source: 'ai' | 'rule';
  aiFallbackReason?: string;
}

export interface AdStrategyDiagnoserOptions {
  persona?: string;
  outputLanguage?: string;
  maxTokens?: number;
}

const DEFAULT_OUTPUT_LANGUAGE = '简体中文';
const DEFAULT_PERSONA = [
  '你是中文亚马逊广告运营顾问，擅长用真实广告数据、产品阶段、成本结构和运营事件做量化诊断。',
  '你只输出可人工复核的建议，不执行广告动作，不夸大数据结论。',
].join('');
const FORMAL_AD_ACTION_SCHEMA = 'lower_bid | raise_bid | pause_target | resume_target | add_negative_exact | add_negative_phrase | add_negative_broad | adjust_campaign_budget | create_campaign | archive_campaign';
const MIN_FORMAL_AI_CONFIDENCE = 0.6;
const STRUCTURED_DIAGNOSIS_TOKEN_FLOOR = 8192;
const AI_JSON_FORMAT_FALLBACK_REASON = 'AI 输出格式未通过校验，当前使用规则引擎兜底。';

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
  constructor(
    private readonly provider: AIProvider,
    private readonly options: AdStrategyDiagnoserOptions = {},
  ) {}

  async diagnose(input: AdStrategyDiagnosisInput): Promise<AdStrategyDiagnosisOutput> {
    try {
      const response = await this.provider.chat(
        [
          {
            role: 'system',
            content: [
              this.persona(),
              `所有自然语言字段必须使用${this.outputLanguage()}。`,
              '你必须只返回一个 JSON 对象，不要输出 Markdown、解释段落或代码块。',
              'JSON 需要诊断产品广告阶段、动态量化阈值和安全候选动作；不要执行广告动作。',
              '金额必须使用 USD，不得使用人民币、RMB、CNY、¥ 或“元”。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: this.buildPrompt(input),
          },
        ],
        { temperature: 0.2, responseFormat: 'json_object', maxTokens: this.maxTokens() },
      );

      if (!response.success) {
        return this.fallback(input, response.error ? `AI 服务调用失败：${response.error}` : 'AI 服务调用失败，当前使用规则引擎兜底。');
      }

      return this.normalizeOutput(await this.parseOrRepairJson(response.content || '', input), input);
    } catch (error) {
      if (isJsonParseFailure(error)) {
        return this.fallback(input, AI_JSON_FORMAT_FALLBACK_REASON);
      }
      return this.fallback(input, error instanceof Error ? error.message : String(error));
    }
  }

  private async parseOrRepairJson(content: string, input: AdStrategyDiagnosisInput): Promise<unknown> {
    try {
      return parseJsonObject(content);
    } catch (error) {
      if (!isJsonParseFailure(error)) throw error;
      const repairResponse = await this.provider.chat(
        [
          {
            role: 'system',
            content: [
              this.persona(),
              `所有自然语言字段必须使用${this.outputLanguage()}。`,
              '你是 JSON 修复器。不要重新分析业务，不要添加新证据，不要编造字段。',
              '把用户提供的内容修复为一个合法 JSON 对象。',
              '只返回 JSON 对象，不要 Markdown、解释段落或代码块。',
              'schemaVersion 必须是 ad_strategy_diagnosis_v1。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              '请把以下 AI 输出修复为一个合法 JSON 对象。',
              '必须保留原有业务含义；缺失字段按空数组或当前规则兜底结构补齐。',
              '目标 schema：',
              JSON.stringify(this.requiredOutputSkeleton(input), null, 2),
              '待修复内容：',
              content,
            ].join('\n\n'),
          },
        ],
        { temperature: 0, responseFormat: 'json_object', maxTokens: this.maxTokens() },
      );

      if (!repairResponse.success) {
        throw new AiJsonParseError(AI_JSON_FORMAT_FALLBACK_REASON);
      }

      try {
        return parseJsonObject(repairResponse.content || '');
      } catch {
        throw new AiJsonParseError(AI_JSON_FORMAT_FALLBACK_REASON);
      }
    }
  }

  private buildPrompt(input: AdStrategyDiagnosisInput): string {
    const evidenceSufficiency = assessAdEvidenceSufficiency(input);
    const payload = {
      scope: input.scope,
      currency: 'USD',
      evidenceSufficiency,
      productContexts: input.productContexts || [],
      productHistoryLedgers: input.productHistoryLedgers || [],
      currentRuleConfig: input.currentRuleConfig,
      adObjectTimelines: input.adObjectTimelines.slice(0, 40),
      metricsSample: input.metrics.slice(0, 80),
      operationEvents: input.operationEvents,
      ruleCandidates: input.ruleCandidates.slice(0, 80),
      evidencePack: (input.evidencePack || []).slice(0, 160),
      requiredOutput: this.requiredOutputSkeleton(input),
    };

    return [
      '请分析以下 Amazon Ads 运营范围。',
      '所有金额必须使用 USD 货币格式。',
      '给出阈值时必须结合产品阶段、成本结构、目标净利率、目标 ACOS 和目标 TACOS。',
      '解释表现时必须参考运营事件，例如 Coupon、Promotion、BD、大促、价格变动和 Listing 变更。',
      '请为当前产品阶段给出量化阈值建议和候选动作；不要执行广告。',
      '你只能引用 input.evidencePack 中存在的 evidenceId。',
      '判断产品阶段和动态阈值时必须优先引用 type 为 timeline 的 evidenceId。',
      'timeline:* 证据代表产品日级广告历史和运营事件叠加，是阶段判断、动态阈值和趋势解释的优先证据。',
      '所有动作、阶段判断、阈值原因必须附带 evidenceRefs。',
      '不能编造 sourceFile、sourceRow、batchId；这些字段只能来自 evidencePack。',
      '缺少证据时进入 insightOnlyCandidates，不要放入 aiCandidates。',
      '证据充分性不足时，动作必须进入 insightOnlyCandidates，不要放入 aiCandidates。',
      `aiCandidates.actionType 只能使用正式动作：${FORMAL_AD_ACTION_SCHEMA}。`,
      '不属于以上正式动作的判断，例如 observe、harvest 或泛化 add_negative，必须进入 insightOnlyCandidates，不要放入 aiCandidates。',
      `aiCandidates.confidence 必须大于等于 ${MIN_FORMAL_AI_CONFIDENCE}。`,
      `低于 ${MIN_FORMAL_AI_CONFIDENCE} 的 AI 判断必须进入 insightOnlyCandidates，不要放入 aiCandidates。`,
      'aiCandidates 必须至少引用一条 type 为 metric 且带 sourceFile/sourceRow 的 evidenceId；只有 operation_event、product_context 或 rule_candidate 不能支撑正式动作。',
      'aiCandidates 中 lower_bid、raise_bid 和 adjust_campaign_budget 的 recommendedValue 必须是可直接录入 Ads UI 的绝对数字金额，例如 1.26；不得使用 -10%、降低10%、10% 等相对值。',
      '如果只能给相对比例或方向判断，必须进入 insightOnlyCandidates，不要放入 aiCandidates。',
      '产品阶段判断不能只引用 operation_event；至少需要 metric、timeline 或 product_context 之一支撑，否则阶段判断需要人工复核。',
      'schemaVersion 必须是 ad_strategy_diagnosis_v1。',
      `自然语言输出必须使用${this.outputLanguage()}，字段结构必须严格匹配 requiredOutput。`,
      '只返回一个 JSON 对象。',
      JSON.stringify(payload, null, 2),
    ].join('\n\n');
  }

  private requiredOutputSkeleton(input: AdStrategyDiagnosisInput) {
    const evidenceIds = (input.evidencePack || []).map((item) => item.evidenceId).filter(Boolean);
    const lifecycleRefs = evidenceIds.slice(0, 2);
    const candidateRefs = evidenceIds.slice(0, 3);
    return {
      schemaVersion: 'ad_strategy_diagnosis_v1',
      lifecycleStage: 'unknown',
      lifecycleStageReason: '当前证据不足时用 unknown，并说明需要人工复核；有证据时写清阶段判断原因。',
      lifecycleStageEvidenceRefs: lifecycleRefs,
      summary: '用简体中文输出当前范围的广告诊断摘要。',
      mainProblems: ['INSUFFICIENT_DATA'],
      thresholdSuggestions: {
        targetAcos: {
          value: input.currentRuleConfig.targetAcos,
          reason: '结合产品阶段、利润目标和当前真实广告表现解释目标 ACOS。',
          evidenceRefs: lifecycleRefs,
        },
        highAcosThreshold: {
          value: input.currentRuleConfig.highAcosThreshold,
          reason: '解释高风险 ACOS 阈值为什么适合当前产品阶段。',
          evidenceRefs: lifecycleRefs,
        },
        noOrderClickThreshold: {
          value: input.currentRuleConfig.noOrderClickThreshold,
          reason: '解释无订单点击门槛如何匹配当前样本量。',
          evidenceRefs: lifecycleRefs,
        },
        minSpend: {
          value: input.currentRuleConfig.minSpend,
          reason: '解释最低花费门槛如何避免小样本误判。',
          evidenceRefs: lifecycleRefs,
        },
      },
      aiCandidates: [
        {
          entityType: 'search_term',
          entityName: '示例搜索词，必须替换为当前 evidencePack 中的真实对象名称',
          actionType: 'lower_bid',
          recommendedValue: '1.26',
          reason: '用简体中文说明为什么这个正式动作可进入审批。',
          reasoningSteps: ['引用真实指标证据说明点击、花费、订单和 ACOS 关系。'],
          evidenceRefs: candidateRefs,
          riskWarnings: ['执行前仍需人工审批和 ERP 回读。'],
          confidence: 0.72,
        },
      ],
      insightOnlyCandidates: [
        {
          entityType: 'search_term',
          entityName: '示例搜索词，证据不足或只有方向判断时放这里',
          actionType: 'analysis_only',
          recommendedValue: '',
          reason: '用简体中文说明为什么当前只能作为洞察，不能进入正式动作。',
          reasoningSteps: ['说明缺少哪些 evidenceRefs、sourceFile/sourceRow 或绝对数值。'],
          evidenceRefs: lifecycleRefs,
          riskWarnings: ['证据不足，不能自动进入审批。'],
          confidence: 0.52,
        },
      ],
      riskWarnings: ['列出当前诊断需要人工复核的风险。'],
    };
  }

  private normalizeOutput(raw: unknown, input: AdStrategyDiagnosisInput): AdStrategyDiagnosisOutput {
    if (!isRecord(raw)) {
      return this.fallback(input, 'AI 输出不是可识别的结构化 JSON 对象。');
    }
    if (raw.schemaVersion !== 'ad_strategy_diagnosis_v1') {
      return this.fallback(input, `AI 输出 schemaVersion 错误：${String(raw.schemaVersion || 'missing')}`);
    }

    const lifecycleStage = String(raw.lifecycleStage || 'unknown') as AdLifecycleStage;
    const thresholdSuggestions = isRecord(raw.thresholdSuggestions) ? raw.thresholdSuggestions : {};
    const output: AdStrategyDiagnosisOutput = {
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidenceSufficiency: assessAdEvidenceSufficiency(input),
      lifecycleStage: VALID_STAGES.has(lifecycleStage) ? lifecycleStage : 'unknown',
      lifecycleStageReason: stringOrDefault(raw.lifecycleStageReason, ''),
      lifecycleStageEvidenceRefs: stringArray(raw.lifecycleStageEvidenceRefs),
      summary: stringOrDefault(raw.summary, 'AI 诊断未返回摘要。'),
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
      insightOnlyCandidates: normalizeCandidates(raw.insightOnlyCandidates),
      riskWarnings: stringArray(raw.riskWarnings),
      source: 'ai',
    };

    if (requiresCjkLanguage(this.outputLanguage()) && hasNonChineseNaturalLanguage(output)) {
      return this.fallback(input, `AI 返回的自然语言字段不是${this.outputLanguage()}。`);
    }

    return normalizeOutputEvidenceRefs(output, input);
  }

  private fallback(input: AdStrategyDiagnosisInput, reason: string): AdStrategyDiagnosisOutput {
    return {
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidenceSufficiency: assessAdEvidenceSufficiency(input),
      lifecycleStage: 'unknown',
      lifecycleStageReason: 'AI 诊断不可用，不能判断产品广告阶段。',
      lifecycleStageEvidenceRefs: [],
      summary: 'AI 诊断不可用，当前使用规则引擎兜底。',
      mainProblems: [],
      thresholdSuggestions: {
        targetAcos: {
          value: input.currentRuleConfig.targetAcos,
          reason: '当前规则配置兜底。',
        },
        highAcosThreshold: {
          value: input.currentRuleConfig.highAcosThreshold,
          reason: '当前规则配置兜底。',
        },
        noOrderClickThreshold: {
          value: input.currentRuleConfig.noOrderClickThreshold,
          reason: '当前规则配置兜底。',
        },
        minSpend: {
          value: input.currentRuleConfig.minSpend,
          reason: '当前规则配置兜底。',
        },
      },
      aiCandidates: [],
      insightOnlyCandidates: [],
      riskWarnings: ['AI 不可用，必须人工复核规则建议。'],
      source: 'rule',
      aiFallbackReason: reason,
    };
  }

  private persona(): string {
    return this.options.persona?.trim() || DEFAULT_PERSONA;
  }

  private outputLanguage(): string {
    return this.options.outputLanguage?.trim() || DEFAULT_OUTPUT_LANGUAGE;
  }

  private maxTokens(): number {
    const parsed = Number(this.options.maxTokens);
    if (!Number.isFinite(parsed)) return STRUCTURED_DIAGNOSIS_TOKEN_FLOOR;
    return Math.max(STRUCTURED_DIAGNOSIS_TOKEN_FLOOR, Math.trunc(parsed));
  }
}

class AiJsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiJsonParseError';
  }
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch (error) {
    const extracted = withoutFence.match(/\{[\s\S]*\}/)?.[0];
    if (!extracted) {
      throw new AiJsonParseError(error instanceof Error ? error.message : 'AI response was not valid JSON');
    }
    try {
      return JSON.parse(extracted);
    } catch (innerError) {
      throw new AiJsonParseError(innerError instanceof Error ? innerError.message : 'AI response was not valid JSON');
    }
  }
}

function isJsonParseFailure(error: unknown): boolean {
  return error instanceof AiJsonParseError
    || error instanceof SyntaxError
    || (error instanceof Error && /JSON|Unexpected|position|token|unterminated|Expected/i.test(error.message));
}

function normalizeThreshold(value: unknown, fallbackValue: number): ThresholdSuggestion {
  if (!isRecord(value)) {
    return { value: fallbackValue, reason: '当前规则配置兜底。', evidenceRefs: [] };
  }
  const numericValue = Number(value.value);
  return {
    value: Number.isFinite(numericValue) ? numericValue : fallbackValue,
    reason: stringOrDefault(value.reason, 'AI 未提供阈值原因。'),
    evidenceRefs: stringArray(value.evidenceRefs),
  };
}

function normalizeCandidates(value: unknown): AiReasonedDecision[] {
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
        reason: stringOrDefault(candidate.reason, 'AI 未提供原因。'),
        reasoningSteps: stringArray(candidate.reasoningSteps),
        evidenceRefs: stringArray(candidate.evidenceRefs),
        riskWarnings: stringArray(candidate.riskWarnings),
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      };
    });
}

function normalizeOutputEvidenceRefs(
  output: AdStrategyDiagnosisOutput,
  input: AdStrategyDiagnosisInput,
): AdStrategyDiagnosisOutput {
  const evidencePack = input.evidencePack || [];
  if (!evidencePack.length) return output;

  const evidenceIds = new Set(evidencePack.map((item) => item.evidenceId));
  const withRefs = {
    ...output,
    lifecycleStageEvidenceRefs: ensureEvidenceRefs(
      output.lifecycleStageEvidenceRefs,
      evidencePack,
      evidenceIds,
      ['timeline', 'metric', 'product_context'],
    ),
    thresholdSuggestions: {
      targetAcos: {
        ...output.thresholdSuggestions.targetAcos,
        evidenceRefs: ensureEvidenceRefs(
          output.thresholdSuggestions.targetAcos.evidenceRefs || [],
          evidencePack,
          evidenceIds,
          ['product_context', 'timeline', 'metric'],
        ),
      },
      highAcosThreshold: {
        ...output.thresholdSuggestions.highAcosThreshold,
        evidenceRefs: ensureEvidenceRefs(
          output.thresholdSuggestions.highAcosThreshold.evidenceRefs || [],
          evidencePack,
          evidenceIds,
          ['timeline', 'metric'],
        ),
      },
      noOrderClickThreshold: {
        ...output.thresholdSuggestions.noOrderClickThreshold,
        evidenceRefs: ensureEvidenceRefs(
          output.thresholdSuggestions.noOrderClickThreshold.evidenceRefs || [],
          evidencePack,
          evidenceIds,
          ['timeline', 'metric'],
        ),
      },
      minSpend: {
        ...output.thresholdSuggestions.minSpend,
        evidenceRefs: ensureEvidenceRefs(
          output.thresholdSuggestions.minSpend.evidenceRefs || [],
          evidencePack,
          evidenceIds,
          ['timeline', 'metric'],
        ),
      },
    },
    aiCandidates: output.aiCandidates.map((candidate) => ({
      ...candidate,
      evidenceRefs: normalizeCandidateEvidenceRefs(candidate, evidencePack, evidenceIds),
    })),
    insightOnlyCandidates: output.insightOnlyCandidates.map((candidate) => ({
      ...candidate,
      evidenceRefs: filterExistingEvidenceRefs(candidate.evidenceRefs, evidenceIds),
    })),
  };

  return withRefs;
}

function ensureEvidenceRefs(
  refs: string[],
  evidencePack: AiEvidenceItem[],
  evidenceIds: Set<string>,
  preferredTypes: AiEvidenceType[],
): string[] {
  const existingRefs = filterExistingEvidenceRefs(refs, evidenceIds);
  if (existingRefs.length > 0) return existingRefs;
  for (const type of preferredTypes) {
    const refsForType = evidencePack
      .filter((item) => item.type === type)
      .map((item) => item.evidenceId)
      .slice(0, 3);
    if (refsForType.length > 0) return refsForType;
  }
  return [];
}

function normalizeCandidateEvidenceRefs(
  candidate: AiReasonedDecision,
  evidencePack: AiEvidenceItem[],
  evidenceIds: Set<string>,
): string[] {
  const existingRefs = filterExistingEvidenceRefs(candidate.evidenceRefs, evidenceIds);
  const existingMetricRefs = existingRefs.filter((ref) => {
    const evidence = evidencePack.find((item) => item.evidenceId === ref);
    return evidence?.type === 'metric'
      && evidenceHasReportTrace(evidence)
      && evidenceMatchesCandidate(evidence, candidate);
  });
  if (existingMetricRefs.length > 0) return existingRefs;

  const matchingMetricRefs = evidencePack
    .filter((item) => item.type === 'metric' && evidenceHasReportTrace(item) && evidenceMatchesCandidate(item, candidate))
    .map((item) => item.evidenceId)
    .slice(0, 3);
  return uniqueStrings([...matchingMetricRefs, ...existingRefs]).slice(0, 5);
}

function filterExistingEvidenceRefs(refs: string[], evidenceIds: Set<string>): string[] {
  return uniqueStrings(refs.filter((ref) => evidenceIds.has(ref)));
}

function evidenceMatchesCandidate(evidence: AiEvidenceItem, candidate: AiReasonedDecision): boolean {
  const candidateEntity = normalizeEvidenceKey(candidate.entityName);
  if (!candidateEntity) return false;
  const evidenceNames = [
    evidence.entityName,
    evidence.campaignName,
    evidence.adGroupName,
    evidence.asin,
  ].map((value) => normalizeEvidenceKey(value || ''));
  if (!evidenceNames.includes(candidateEntity)) return false;

  const candidateType = normalizeEvidenceType(candidate.entityType);
  const evidenceType = normalizeEvidenceType(evidence.entityType || '');
  return !candidateType || !evidenceType || candidateType === evidenceType
    || (candidateType === 'target' && evidenceType === 'search_term')
    || (candidateType === 'search_term' && evidenceType === 'target')
    || (candidateType === 'target' && evidenceType === 'keyword')
    || (candidateType === 'keyword' && evidenceType === 'target');
}

function normalizeEvidenceType(value: string): string {
  const normalized = normalizeEvidenceKey(value);
  if (normalized === 'adgroup') return 'ad_group';
  if (normalized === 'keyword') return 'target';
  return normalized;
}

function normalizeEvidenceKey(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function requiresCjkLanguage(language: string): boolean {
  return /中文|简体|繁体|繁體|Chinese/i.test(language);
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function hasInvalidCjkText(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed) && !containsCjk(trimmed);
}

function hasNonChineseNaturalLanguage(output: AdStrategyDiagnosisOutput): boolean {
  const texts = [
    output.lifecycleStageReason,
    output.summary,
    ...Object.values(output.thresholdSuggestions).map((item) => item.reason),
    ...output.riskWarnings,
    ...output.aiCandidates.flatMap((item) => [
      item.reason,
      ...item.reasoningSteps,
      ...item.riskWarnings,
    ]),
    ...output.insightOnlyCandidates.flatMap((item) => [
      item.reason,
      ...item.reasoningSteps,
      ...item.riskWarnings,
    ]),
  ];
  return texts.some(hasInvalidCjkText);
}

export function assessAdEvidenceSufficiency(input: AdStrategyDiagnosisInput): AiEvidenceSufficiency {
  const metricEvidence = (input.evidencePack || []).filter((item) => item.type === 'metric' && item.metrics);
  const metricRows = metricEvidence.length > 0
    ? metricEvidence.map((item) => ({
        date: item.dateRange?.split('~')[0],
        clicks: item.metrics?.clicks,
        cost: item.metrics?.cost,
        orders: item.metrics?.orders,
        hasReportTrace: evidenceHasReportTrace(item),
        hasProductBinding: Boolean(String(item.asin || input.scope.asin || '').trim()),
      }))
    : input.metrics.map((item) => ({
        date: item.date,
        clicks: item.clicks,
        cost: item.cost,
        orders: item.orders,
        hasReportTrace: false,
        hasProductBinding: Boolean(String(item.asin || input.scope.asin || '').trim()),
      }));

  const sampleDays = new Set(metricRows.map((item) => item.date).filter(Boolean)).size;
  const totalClicks = sumNumbers(metricRows.map((item) => item.clicks));
  const totalCost = sumNumbers(metricRows.map((item) => item.cost));
  const totalOrders = sumNumbers(metricRows.map((item) => item.orders));
  const metricEvidenceCount = metricRows.length;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const minSpend = Math.max(0, Number(input.currentRuleConfig.minSpend || 0));
  const actionClickFloor = Math.max(10, Math.min(30, Number(input.currentRuleConfig.noOrderClickThreshold || 30)));

  if (metricEvidenceCount === 0) {
    blockers.push('当前范围没有可引用的真实日级指标证据。');
  }
  if (metricEvidenceCount > 0 && !metricRows.some((item) => item.hasReportTrace)) {
    blockers.push('当前范围指标证据缺少真实广告报表 sourceFile/sourceRow，不能用于正式 AI 动作。');
  }
  if (metricEvidenceCount > 0 && metricRows.some((item) => !item.hasProductBinding)) {
    blockers.push('当前范围指标证据缺少产品 ASIN，不能用于正式 AI 动作。');
  }
  if (metricEvidenceCount > 0 && totalCost < minSpend) {
    blockers.push(`累计花费低于最低样本门槛 ${minSpend.toFixed(2)} USD。`);
  }
  if (metricEvidenceCount > 0 && totalClicks < actionClickFloor && totalOrders === 0) {
    blockers.push(`点击样本不足，低于正式 AI 动作门槛 ${actionClickFloor} 次。`);
  }
  if (metricEvidenceCount > 0 && sampleDays < 3) {
    warnings.push('当前样本覆盖天数少于 3 天，阶段判断需要人工复核。');
  }

  const level: AiEvidenceSufficiencyLevel = metricEvidenceCount === 0
    ? 'none'
    : blockers.length > 0
      ? 'low'
      : sampleDays >= 7 || totalOrders >= 3 || totalClicks >= actionClickFloor
        ? 'high'
        : 'medium';

  return {
    level,
    metricEvidenceCount,
    sampleDays,
    totalClicks,
    totalCost,
    totalOrders,
    canUseForFormalActions: blockers.length === 0,
    blockers,
    warnings,
  };
}

function evidenceHasReportTrace(evidence: AiEvidenceItem): boolean {
  const sourceFile = String(evidence.sourceFile || '').trim().toLowerCase().split(/[?#]/)[0];
  const sourceRow = Number(evidence.sourceRow);
  return /\.(xlsx|xls|csv)$/.test(sourceFile) && Number.isFinite(sourceRow) && sourceRow > 0;
}

function sumNumbers(values: Array<number | null | undefined>): number {
  const total = values.reduce<number>((sum, value) => {
    const numeric = Number(value);
    return sum + (Number.isFinite(numeric) ? numeric : 0);
  }, 0);
  return Number(total.toFixed(4));
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
