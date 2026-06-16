import type { AdDailyMetrics, AdActionType } from '@amazon-ai-ops/shared-types';
import type { RuleConfig, RuleResult, RuleEvidence, RecommendationInput } from './types';

export class AdRules {
  constructor(private config: RuleConfig) {}

  /**
   * 高 ACOS 识别规则
   * 触发条件：ACOS 超过目标 ACOS 的 1.5 倍
   */
  checkHighAcos(input: RecommendationInput): RuleResult {
    const { metrics, config, productAcos } = input;
    const targetAcos = productAcos ?? config.targetAcos;
    const threshold = targetAcos * 1.5;
    
    if (metrics.acos <= threshold || metrics.cost < 1) {
      return { triggered: false, reason: 'ACOS not exceeded threshold', confidence: 0, evidence: { metric: 'acos', currentValue: metrics.acos, threshold } };
    }

    // ACOS 超过目标但有转化（不是完全无效）
    if (metrics.orders > 0 && metrics.cost > 0) {
      const severity = metrics.acos > threshold * 2 ? 'high' : 'medium';
      const bidReduction = Math.min(config.bidAdjustPercent, config.maxBidDecrement);
      const newBid = metrics.cpc * (1 - bidReduction);
      
      return {
        triggered: true,
        actionType: 'lower_bid',
        recommendedValue: newBid.toFixed(2),
        reason: `ACOS ${(metrics.acos * 100).toFixed(1)}% 超过目标 ${(threshold * 100).toFixed(1)}%，建议降 bid ${(bidReduction * 100).toFixed(0)}%`,
        confidence: 0.85,
        evidence: { metric: 'acos', currentValue: metrics.acos, threshold, unit: '%' },
      };
    }

    return { triggered: false, reason: 'No orders, suggest adding negative instead', confidence: 0, evidence: { metric: 'acos', currentValue: metrics.acos, threshold } };
  }

  /**
   * 无转化点击规则
   * 触发条件：点击数超过阈值但无订单
   */
  checkNoConversion(input: RecommendationInput): RuleResult {
    const { metrics, config } = input;
    
    if (metrics.clicks >= config.noOrderClickThreshold && metrics.orders === 0 && metrics.cost > 5) {
      const isHighSpend = metrics.cost > 20;
      const reason = `点击 ${metrics.clicks} 次无转化，花费 USD ${metrics.cost.toFixed(2)}，建议添加否定`;
      
      return {
        triggered: true,
        actionType: 'add_negative_exact',
        recommendedValue: metrics.searchTerm || metrics.targeting,
        reason,
        confidence: 0.9,
        evidence: { metric: 'clicks', currentValue: metrics.clicks, threshold: config.noOrderClickThreshold },
      };
    }
    
    return { triggered: false, reason: 'Has orders or clicks below threshold', confidence: 0, evidence: { metric: 'clicks', currentValue: metrics.clicks, threshold: config.noOrderClickThreshold } };
  }

  /**
   * 低 ACOS 高转化识别（可加词）
   */
  checkLowAcosHighConversion(input: RecommendationInput): RuleResult {
    const { metrics, config, productAcos } = input;
    const targetAcos = productAcos ?? config.targetAcos;
    
    if (metrics.acos < targetAcos * 0.6 && metrics.cvr > 0.1 && metrics.clicks >= 10) {
      return {
        triggered: true,
        actionType: 'raise_bid',
        recommendedValue: (metrics.cpc * 1.2).toFixed(2),
        reason: `ACOS ${(metrics.acos * 100).toFixed(1)}% 远低于目标，加价扩量可能带来更多订单`,
        confidence: 0.7,
        evidence: { metric: 'acos', currentValue: metrics.acos, threshold: targetAcos * 0.6, unit: '%' },
      };
    }
    
    return { triggered: false, reason: 'ACOS not low enough or CVR not high enough', confidence: 0, evidence: { metric: 'acos', currentValue: metrics.acos, threshold: targetAcos * 0.6 } };
  }

  /**
   * 极低点击规则
   * 触发条件：展现量大但点击极少（可能是匹配问题）
   */
  checkLowClickRate(input: RecommendationInput): RuleResult {
    const { metrics } = input;
    
    if (metrics.impressions >= 1000 && metrics.clicks <= 2 && metrics.orders === 0) {
      return {
        triggered: true,
        actionType: 'add_negative_exact',
        recommendedValue: metrics.searchTerm || metrics.targeting,
        reason: `展现 ${metrics.impressions} 次但仅点击 ${metrics.clicks} 次，无转化，建议添加否定`,
        confidence: 0.8,
        evidence: { metric: 'ctr', currentValue: metrics.clicks / metrics.impressions, threshold: 0.005, unit: '%' },
      };
    }
    
    return { triggered: false, reason: 'CTR not low enough', confidence: 0, evidence: { metric: 'clicks', currentValue: metrics.clicks, threshold: 2 } };
  }

  /**
   * 白名单检查
   */
  isWhitelisted(searchTerm: string): boolean {
    const term = searchTerm.toLowerCase();
    return this.config.coreWordWhitelist.some(w => term.includes(w.toLowerCase()))
        || this.config.brandWordWhitelist.some(w => term.includes(w.toLowerCase()));
  }

  /**
   * 检查所有广告规则
   */
  evaluateAll(input: RecommendationInput): RuleResult[] {
    const results: RuleResult[] = [];
    
    // 跳过白名单词
    const term = input.metrics.searchTerm || input.metrics.targeting;
    if (term && this.isWhitelisted(term)) {
      return results;
    }

    // 按优先级检查
    const rules = [
      this.checkNoConversion.bind(this),
      this.checkHighAcos.bind(this),
      this.checkLowClickRate.bind(this),
      this.checkLowAcosHighConversion.bind(this),
    ];

    for (const rule of rules) {
      const result = rule(input);
      if (result.triggered) {
        results.push(result);
        break; // 只触发一条最优先的规则
      }
    }

    return results;
  }
}
