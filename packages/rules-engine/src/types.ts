import type { AdDailyMetrics, RiskLevel, AdActionType } from '@amazon-ai-ops/shared-types';

export interface RuleConfig {
  // 广告规则
  targetAcos: number;           // 目标 ACOS (如 0.25)
  targetTacos: number;           // 目标 TACOS
  maxCpc: number;               // 最大 CPC
  minCpc: number;               // 最小 CPC
  noOrderClickThreshold: number; // 无点击阈值（次）
  highAcosThreshold: number;    // 高 ACOS 阈值
  minSpend: number;             // 最低样本花费
  lowPerformanceDays: number;   // 低效果天数阈值
  
  // 否词规则
  maxDailyNegativeWords: number;  // 单日最大否词数
  maxBatchNegativeWords: number;  // 单批最大否词数
  coreWordWhitelist: string[];    // 核心词白名单
  brandWordWhitelist: string[];  // 品牌词白名单
  
  // bid 调整规则
  bidAdjustPercent: number;      // bid 调整幅度 (如 0.1 = 10%)
  maxBidIncrement: number;      // bid 最大增幅
  maxBidDecrement: number;      // bid 最大降幅
  
  // 开关
  enableAutoPause: boolean;      // 自动暂停开关
  enableAutoLowerBid: boolean;  // 自动降 bid 开关
  enableAutoAddNegative: boolean; // 自动否词开关
}

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  targetAcos: 0.25,
  targetTacos: 0.15,
  maxCpc: 5.0,
  minCpc: 0.02,
  noOrderClickThreshold: 30,
  highAcosThreshold: 0.40,
  minSpend: 10,
  lowPerformanceDays: 7,
  maxDailyNegativeWords: 50,
  maxBatchNegativeWords: 20,
  coreWordWhitelist: [],
  brandWordWhitelist: [],
  bidAdjustPercent: 0.1,
  maxBidIncrement: 0.5,
  maxBidDecrement: 0.2,
  enableAutoPause: false,
  enableAutoLowerBid: true,
  enableAutoAddNegative: true,
};

export interface RuleResult {
  triggered: boolean;
  actionType?: AdActionType;
  recommendedValue?: string;
  reason: string;
  confidence: number;  // 0-1
  evidence: RuleEvidence;
}

export interface RuleEvidence {
  metric: string;
  currentValue: number;
  threshold: number;
  unit?: string;
}

export interface RecommendationInput {
  metrics: AdDailyMetrics;
  config: RuleConfig;
  productMargin?: number;  // 产品利润率
  productAcos?: number;    // 产品目标 ACOS
}
