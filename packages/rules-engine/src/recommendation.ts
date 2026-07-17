import type { AdDailyMetrics, ActionRecommendation, RiskLevel } from '@amazon-ai-ops/shared-types';
import { AdQuantifier, type DailyAdTimeline, type QuantifiedAdMetric } from './quantification';
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
      batchId: metrics.batchId,
      reportType: metrics.reportType,
      sourceFile: metrics.sourceFile,
      sourceFiles: metrics.sourceFile ? [metrics.sourceFile] : undefined,
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

  generateTimelineBatch(metricsList: AdDailyMetrics[], options: GenerateOptions): ActionRecommendation[] {
    const recommendations: ActionRecommendation[] = [];

    for (const timeline of this.adQuantifier.quantifyTimeline(metricsList)) {
      const rec = this.generateFromTimeline(timeline, options);
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

  private generateFromTimeline(timeline: DailyAdTimeline, options: GenerateOptions): ActionRecommendation | null {
    if (!timeline.recommendedAction) {
      return null;
    }

    const ruleResult = timelineToRuleResult(timeline);
    const currentBid = timeline.totals.cpc;
    const risk = this.riskEvaluator.evaluate(ruleResult, currentBid);
    const sourceMetrics = timeline.daily.map((item) => item.metric);
    const latestMetric = [...sourceMetrics]
      .filter((metric) => Number.isFinite(Number(metric.sourceRow)) && Number(metric.sourceRow) > 0)
      .sort((a, b) => a.date.localeCompare(b.date) || Number(a.sourceRow || 0) - Number(b.sourceRow || 0))
      .at(-1) || sourceMetrics.at(-1);
    const firstMetric = sourceMetrics[0];
    const sourceFiles = Array.from(new Set(sourceMetrics
      .map((metric) => metric.sourceFile)
      .filter((file): file is string => Boolean(file && file.trim()))));
    const dateRange = timeline.dateFrom === timeline.dateTo
      ? timeline.dateTo
      : `${timeline.dateFrom} ~ ${timeline.dateTo}`;

    const evidence = {
      date: dateRange,
      portfolioName: latestMetric?.portfolioName || firstMetric?.portfolioName,
      campaignName: timeline.campaignName,
      adGroupName: timeline.adGroupName,
      asin: timeline.asin,
      targeting: timeline.objectType === 'target' ? timeline.objectName : latestMetric?.targeting,
      searchTerm: timeline.objectType === 'search_term' ? timeline.objectName : latestMetric?.searchTerm,
      matchType: latestMetric?.matchType,
      impressions: timeline.totals.impressions,
      clicks: timeline.totals.clicks,
      cost: timeline.totals.cost,
      orders: timeline.totals.orders,
      sales: timeline.totals.sales,
      acos: roundMetric(timeline.totals.acos, 6),
      cpc: roundMetric(timeline.totals.cpc, 4),
      cvr: roundMetric(timeline.totals.cvr, 6),
      quantStatus: timeline.status,
      quantLifecycleStage: timeline.lifecycleStage,
      quantSeverity: timeline.daily.find((item) => item.recommendedAction === timeline.recommendedAction)?.severity,
      quantReasons: timeline.reasons,
      quantThresholds: timeline.thresholdSuggestion,
      quantReviewRequired: timeline.reviewRequired,
      batchId: latestMetric?.batchId || firstMetric?.batchId,
      reportType: latestMetric?.reportType || firstMetric?.reportType,
      sourceFile: latestMetric?.sourceFile || firstMetric?.sourceFile,
      sourceFiles: sourceFiles.length ? sourceFiles : undefined,
      sourceRow: latestMetric?.sourceRow,
      currency: 'USD' as const,
    };

    return {
      id: undefined,
      taskId: options.taskId,
      storeName: firstMetric?.storeName || options.storeName,
      marketplaceCode: firstMetric?.marketplaceCode || options.marketplaceCode,
      asin: timeline.asin,
      msku: latestMetric?.msku || firstMetric?.msku || '',
      entityType: timeline.objectType,
      entityId: `${timeline.campaignName}_${timeline.adGroupName}_${timeline.objectName}`,
      entityName: timeline.objectName,
      actionType: ruleResult.actionType!,
      currentValue: currentBid.toFixed(2),
      recommendedValue: ruleResult.recommendedValue || '',
      reason: ruleResult.reason,
      evidence,
      confidence: Math.max(ruleResult.confidence, timeline.daily.find((item) => item.recommendedAction === timeline.recommendedAction)?.confidence || 0),
      riskLevel: risk.riskLevel,
      status: timeline.reviewRequired ? 'needs_review' : 'pending',
    };
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

function timelineToRuleResult(timeline: DailyAdTimeline): RuleResult {
  return {
    triggered: true,
    actionType: timeline.recommendedAction,
    recommendedValue: timeline.recommendedValue,
    reason: timeline.reasons.join('；'),
    confidence: 0.82,
    evidence: {
      metric: timeline.status,
      currentValue: Number(timeline.totals.cost || 0),
      threshold: timeline.thresholdSuggestion.minSpend,
      unit: 'USD',
    },
  };
}

function roundMetric(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}
