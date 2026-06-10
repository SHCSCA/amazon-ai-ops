import type { AdDailyMetrics, ActionRecommendation, RiskLevel } from '@amazon-ai-ops/shared-types';
import { AdRules } from './ad-rules';
import { RiskEvaluator } from './risk-evaluator';
import type { RuleConfig, RuleResult } from './types';

export interface GenerateOptions {
  storeName: string;
  marketplaceCode: string;
  config: RuleConfig;
  taskId: string;
}

export class RecommendationGenerator {
  private adRules: AdRules;
  private riskEvaluator: RiskEvaluator;

  constructor(config: RuleConfig) {
    this.adRules = new AdRules(config);
    this.riskEvaluator = new RiskEvaluator(config);
  }

  /**
   * 为单条广告数据生成建议
   */
  generateFromMetrics(metrics: AdDailyMetrics, options: GenerateOptions): ActionRecommendation | null {
    const input = {
      metrics,
      config: options.config,
    };

    // 执行所有规则
    const results = this.adRules.evaluateAll(input);
    
    if (results.length === 0) {
      return null;
    }

    // 取第一条触发的规则
    const ruleResult = results[0];
    
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
      confidence: ruleResult.confidence,
      riskLevel: risk.riskLevel,
      status: 'pending',
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
    this.adRules = new AdRules(config);
    this.riskEvaluator = new RiskEvaluator(config);
  }
}
