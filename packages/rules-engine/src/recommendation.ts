import type { AdDailyMetrics, ActionRecommendation, RiskLevel } from '@amazon-ai-ops/shared-types';
import { AdQuantifier, type QuantifiedAdMetric } from './quantification';
import { RiskEvaluator } from './risk-evaluator';
import type { RuleConfig, RuleResult } from './types';

export interface GenerateOptions {
  storeName: string;
  marketplaceCode: string;
  config: RuleConfig;
  taskId: string;
}

export class RecommendationGenerator {
  private adQuantifier: AdQuantifier;
  private riskEvaluator: RiskEvaluator;

  constructor(config: RuleConfig) {
    this.adQuantifier = new AdQuantifier(config);
    this.riskEvaluator = new RiskEvaluator(config);
  }

  /**
   * 为单条广告数据生成建议
   */
  generateFromMetrics(metrics: AdDailyMetrics, options: GenerateOptions): ActionRecommendation | null {
    const quant = this.adQuantifier.quantify(metrics);
    if (!quant.recommendedAction) {
      return null;
    }

    const ruleResult = quantToRuleResult(quant);
    
    // 评估风险
    const currentBid = parseFloat(metrics.cpc.toString());
    const risk = this.riskEvaluator.evaluate(ruleResult, currentBid);

    // 构建证据对象
    const evidence = {
      date: metrics.date,
      portfolioName: metrics.portfolioName,
      campaignName: metrics.campaignName,
      adGroupName: metrics.adGroupName,
      asin: metrics.asin,
      targeting: metrics.targeting,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      cost: metrics.cost,
      orders: metrics.orders,
      sales: metrics.sales,
      acos: metrics.acos,
      cpc: metrics.cpc,
      cvr: metrics.cvr,
      searchTerm: metrics.searchTerm,
      matchType: metrics.matchType,
      quantStatus: quant.status,
      quantLifecycleStage: quant.lifecycleStage,
      quantSeverity: quant.severity,
      quantReasons: quant.reasons,
      quantThresholds: quant.thresholds,
      quantReviewRequired: quant.reviewRequired,
      sourceRow: metrics.sourceRow,
    };

    return {
      id: undefined,
      taskId: options.taskId,
      storeName: metrics.storeName || options.storeName,
      marketplaceCode: metrics.marketplaceCode || options.marketplaceCode,
      asin: metrics.asin,
      msku: metrics.msku,
      entityType: metrics.searchTerm ? 'search_term' : 'target',
      entityId: `${metrics.campaignName}_${metrics.adGroupName}_${metrics.searchTerm || metrics.targeting}`,
      entityName: metrics.searchTerm || metrics.targeting,
      actionType: ruleResult.actionType!,
      currentValue: currentBid.toFixed(2),
      recommendedValue: ruleResult.recommendedValue || '',
      reason: ruleResult.reason,
      evidence,
      confidence: Math.max(ruleResult.confidence, quant.confidence),
      riskLevel: risk.riskLevel,
      status: quant.reviewRequired ? 'needs_review' : 'pending',
    };
  }

  /**
   * 批量生成建议
   */
  generateBatch(metricsList: AdDailyMetrics[], options: GenerateOptions): ActionRecommendation[] {
    const recommendations: ActionRecommendation[] = [];
    
    for (const metrics of metricsList) {
      const rec = this.generateFromMetrics(metrics, options);
      if (rec) {
        recommendations.push(rec);
      }
    }

    return recommendations;
  }

  /**
   * 更新配置并重建规则实例
   */
  updateConfig(config: RuleConfig): void {
    this.adQuantifier = new AdQuantifier(config);
    this.riskEvaluator = new RiskEvaluator(config);
  }
}

function quantToRuleResult(quant: QuantifiedAdMetric): RuleResult {
  return {
    triggered: true,
    actionType: quant.recommendedAction,
    recommendedValue: quant.recommendedValue,
    reason: quant.reasons.join('；'),
    confidence: quant.confidence,
    evidence: {
      metric: quant.status,
      currentValue: Number(quant.metric.cost || 0),
      threshold: quant.thresholds.minSpend,
      unit: 'USD',
    },
  };
}
