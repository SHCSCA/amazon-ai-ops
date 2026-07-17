import type { AdActionType, AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import type { RuleConfig } from './types';

export type AdQuantStatus = 'healthy' | 'watch' | 'waste' | 'scale' | 'blocked';
export type AdLifecycleStage =
  | 'cold_start'
  | 'keyword_exploration'
  | 'stable_conversion'
  | 'scaling'
  | 'profit_harvesting'
  | 'declining_repair'
  | 'unknown';

export interface QuantifiedAdMetric {
  metric: AdDailyMetrics;
  status: AdQuantStatus;
  lifecycleStage: AdLifecycleStage;
  recommendedAction?: AdActionType;
  recommendedValue?: string;
  reasons: string[];
  thresholds: {
    targetAcos: number;
    highAcosThreshold: number;
    noOrderClickThreshold: number;
    minSpend: number;
    scaleAcosThreshold: number;
    bidAdjustPercent: number;
    maxBidDecrement: number;
    maxBidIncrement: number;
  };
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  reviewRequired: boolean;
}

export interface QuantifyOptions {
  minSpend?: number;
  lifecycleStage?: AdLifecycleStage;
}

export interface DailyAdTimeline {
  objectKey: string;
  objectType: 'search_term' | 'target' | 'ad_group' | 'campaign';
  objectName: string;
  asin: string;
  campaignName: string;
  adGroupName: string;
  dateFrom: string;
  dateTo: string;
  daysActive: number;
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
  lifecycleStage: AdLifecycleStage;
  status: AdQuantStatus;
  recommendedAction?: AdActionType;
  recommendedValue?: string;
  thresholdSuggestion: QuantifiedAdMetric['thresholds'];
  trend: {
    spend: 'up' | 'down' | 'flat' | 'insufficient';
    sales: 'up' | 'down' | 'flat' | 'insufficient';
  };
  daily: QuantifiedAdMetric[];
  reasons: string[];
  reviewRequired: boolean;
}

export interface AdMetricObjectIdentity {
  key: string;
  objectType: DailyAdTimeline['objectType'];
  objectName: string;
}

export class AdQuantifier {
  constructor(private config: RuleConfig) {}

  quantify(metric: AdDailyMetrics, options: QuantifyOptions = {}): QuantifiedAdMetric {
    const thresholds = this.thresholds(options);
    const lifecycleStage = options.lifecycleStage || inferLifecycleStage(metric, thresholds);
    const term = metric.searchTerm || metric.targeting || '';
    const whitelisted = matchesWhitelist(term, this.config);
    const spend = numberOrZero(metric.cost);
    const sales = numberOrZero(metric.sales);
    const clicks = numberOrZero(metric.clicks);
    const orders = numberOrZero(metric.orders);
    const acos = sales > 0 ? spend / sales : numberOrZero(metric.acos);
    const cvr = clicks > 0 ? orders / clicks : numberOrZero(metric.cvr);
    const cpc = numberOrZero(metric.cpc);
    const reasons: string[] = [];

    if (spend <= 0 && clicks <= 0) {
      return buildQuant(metric, thresholds, lifecycleStage, 'blocked', undefined, undefined, [
        '没有花费和点击，样本不足，暂不生成动作。',
      ], 'low', 0.35, true);
    }

    if (whitelisted) {
      return buildQuant(metric, thresholds, lifecycleStage, 'watch', undefined, undefined, [
        '命中核心词或品牌词白名单，禁止自动否定或降价。',
      ], 'medium', 0.55, true);
    }

    if (clicks >= thresholds.noOrderClickThreshold && orders === 0 && spend >= thresholds.minSpend) {
      const action = spend > thresholds.minSpend * 1.5 ? 'add_negative_exact' : 'lower_bid';
      reasons.push(`点击 ${clicks} 次无订单，花费 USD ${spend.toFixed(2)} 已超过最小样本 USD ${thresholds.minSpend.toFixed(2)}。`);
      return buildQuant(
        metric,
        thresholds,
        lifecycleStage,
        'waste',
        action,
        action === 'lower_bid' ? lowerBidValue(cpc, this.config) : term,
        reasons,
        spend > thresholds.minSpend * 2 ? 'high' : 'medium',
        0.86,
        action !== 'lower_bid',
      );
    }

    if (orders > 0 && acos >= thresholds.highAcosThreshold && spend >= thresholds.minSpend) {
      reasons.push(`ACOS ${(acos * 100).toFixed(1)}% 高于高风险阈值 ${(thresholds.highAcosThreshold * 100).toFixed(1)}%。`);
      return buildQuant(
        metric,
        thresholds,
        lifecycleStage,
        'waste',
        'lower_bid',
        lowerBidValue(cpc, this.config),
        reasons,
        acos >= thresholds.highAcosThreshold * 1.5 ? 'high' : 'medium',
        0.78,
        false,
      );
    }

    if (orders > 0 && acos > 0 && acos <= thresholds.scaleAcosThreshold && cvr >= 0.08 && clicks >= 10) {
      reasons.push(`ACOS ${(acos * 100).toFixed(1)}% 低于扩量阈值 ${(thresholds.scaleAcosThreshold * 100).toFixed(1)}%，CVR ${(cvr * 100).toFixed(1)}%。`);
      return buildQuant(
        metric,
        thresholds,
        lifecycleStage,
        'scale',
        'raise_bid',
        raiseBidValue(cpc, this.config),
        reasons,
        'medium',
        0.7,
        true,
      );
    }

    if (spend >= thresholds.minSpend || clicks >= Math.ceil(thresholds.noOrderClickThreshold * 0.5)) {
      reasons.push('已有一定样本，但未达到明确调整阈值。');
      return buildQuant(metric, thresholds, lifecycleStage, 'watch', undefined, undefined, reasons, 'low', 0.5, true);
    }

    return buildQuant(metric, thresholds, lifecycleStage, 'healthy', undefined, undefined, [
      '当前样本未显示明显浪费或扩量机会。',
    ], 'low', 0.45, false);
  }

  quantifyBatch(metrics: AdDailyMetrics[], options: QuantifyOptions = {}): QuantifiedAdMetric[] {
    return metrics.map((metric) => this.quantify(metric, options));
  }

  quantifyTimeline(metrics: AdDailyMetrics[], options: QuantifyOptions = {}): DailyAdTimeline[] {
    const grouped = groupMetricsByAdObject(metrics);
    const timelines: DailyAdTimeline[] = [];
    for (const group of grouped.values()) {
      const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
      const thresholds = this.thresholds(options);
      const lifecycleStage = options.lifecycleStage || inferTimelineLifecycleStage(sorted, thresholds);
      const aggregate = aggregateTimelineMetric(sorted);
      const aggregateQuant = this.quantify(aggregate, { ...options, lifecycleStage });
      const identity = buildAdMetricObjectIdentity(sorted[0]);
      const daily = sorted.map((metric) => this.quantify(metric, { ...options, lifecycleStage }));
      timelines.push({
        objectKey: identity.key,
        objectType: identity.objectType,
        objectName: identity.objectName,
        asin: aggregate.asin,
        campaignName: aggregate.campaignName,
        adGroupName: aggregate.adGroupName,
        dateFrom: sorted[0].date,
        dateTo: sorted[sorted.length - 1].date,
        daysActive: new Set(sorted.map((metric) => metric.date)).size,
        totals: {
          impressions: aggregate.impressions,
          clicks: aggregate.clicks,
          cost: aggregate.cost,
          orders: aggregate.orders,
          sales: aggregate.sales,
          acos: aggregate.acos,
          cpc: aggregate.cpc,
          cvr: aggregate.cvr,
          currency: 'USD',
        },
        lifecycleStage,
        status: aggregateQuant.status,
        recommendedAction: aggregateQuant.recommendedAction,
        recommendedValue: aggregateQuant.recommendedValue,
        thresholdSuggestion: aggregateQuant.thresholds,
        trend: inferTimelineTrend(sorted),
        daily,
        reasons: aggregateQuant.reasons,
        reviewRequired: requiresTimelineReview(aggregateQuant, daily),
      });
    }
    return timelines.sort((a, b) => {
      const severityRank = { waste: 0, scale: 1, watch: 2, blocked: 3, healthy: 4 } as Record<AdQuantStatus, number>;
      return severityRank[a.status] - severityRank[b.status] || b.totals.cost - a.totals.cost;
    });
  }

  updateConfig(config: RuleConfig): void {
    this.config = config;
  }

  private thresholds(options: QuantifyOptions) {
    const targetAcos = numberOrFallback(this.config.targetAcos, 0.25);
    const highAcosThreshold = Math.max(numberOrFallback(this.config.highAcosThreshold, 0.4), targetAcos * 1.5);
    return {
      targetAcos,
      highAcosThreshold,
      noOrderClickThreshold: Math.max(1, Math.round(numberOrFallback(this.config.noOrderClickThreshold, 30))),
      minSpend: Math.max(1, numberOrFallback(options.minSpend, numberOrFallback(this.config.minSpend, 10))),
      scaleAcosThreshold: Math.max(0.01, targetAcos * 0.65),
      bidAdjustPercent: numberOrFallback(this.config.bidAdjustPercent, 0.1),
      maxBidDecrement: numberOrFallback(this.config.maxBidDecrement, 0.2),
      maxBidIncrement: numberOrFallback(this.config.maxBidIncrement, 0.5),
    };
  }
}

function buildQuant(
  metric: AdDailyMetrics,
  thresholds: QuantifiedAdMetric['thresholds'],
  lifecycleStage: AdLifecycleStage,
  status: AdQuantStatus,
  recommendedAction: AdActionType | undefined,
  recommendedValue: string | undefined,
  reasons: string[],
  severity: QuantifiedAdMetric['severity'],
  confidence: number,
  reviewRequired: boolean,
): QuantifiedAdMetric {
  return {
    metric,
    status,
    lifecycleStage,
    recommendedAction,
    recommendedValue,
    reasons,
    thresholds,
    severity,
    confidence,
    reviewRequired,
  };
}

function requiresTimelineReview(
  aggregate: QuantifiedAdMetric,
  daily: QuantifiedAdMetric[],
): boolean {
  if (aggregate.reviewRequired) return true;

  // A no-action daily watch/blocked state is context, not a competing decision.
  // Keep review fail-closed whenever a daily sample proposes an executable action
  // that itself requires review or conflicts with the aggregate action.
  return daily.some((item) => item.recommendedAction !== undefined && (
    item.reviewRequired || item.recommendedAction !== aggregate.recommendedAction
  ));
}

function inferLifecycleStage(metric: AdDailyMetrics, thresholds: QuantifiedAdMetric['thresholds']): AdLifecycleStage {
  const clicks = numberOrZero(metric.clicks);
  const orders = numberOrZero(metric.orders);
  const spend = numberOrZero(metric.cost);
  const sales = numberOrZero(metric.sales);
  const acos = sales > 0 ? spend / sales : numberOrZero(metric.acos);
  if (clicks < Math.ceil(thresholds.noOrderClickThreshold * 0.35) && orders === 0) return 'cold_start';
  if (orders === 0 && clicks >= Math.ceil(thresholds.noOrderClickThreshold * 0.35)) return 'keyword_exploration';
  if (orders > 0 && acos > 0 && acos <= thresholds.scaleAcosThreshold) return 'scaling';
  if (orders > 0 && acos > thresholds.highAcosThreshold) return 'declining_repair';
  if (orders > 0) return 'stable_conversion';
  return 'unknown';
}

function inferTimelineLifecycleStage(metrics: AdDailyMetrics[], thresholds: QuantifiedAdMetric['thresholds']): AdLifecycleStage {
  const aggregate = aggregateTimelineMetric(metrics);
  const daysActive = new Set(metrics.map((metric) => metric.date)).size;
  const recent = metrics.slice(-Math.min(3, metrics.length));
  const recentClicks = recent.reduce((sum, metric) => sum + numberOrZero(metric.clicks), 0);
  const recentOrders = recent.reduce((sum, metric) => sum + numberOrZero(metric.orders), 0);
  const recentCost = recent.reduce((sum, metric) => sum + numberOrZero(metric.cost), 0);
  const acos = aggregate.sales > 0 ? aggregate.cost / aggregate.sales : numberOrZero(aggregate.acos);

  if (daysActive <= 3 && aggregate.orders === 0 && aggregate.clicks < thresholds.noOrderClickThreshold) return 'cold_start';
  if (aggregate.orders === 0 && aggregate.clicks >= Math.ceil(thresholds.noOrderClickThreshold * 0.35)) return 'keyword_exploration';
  if (recentOrders === 0 && recentClicks >= thresholds.noOrderClickThreshold && recentCost >= thresholds.minSpend) return 'declining_repair';
  if (aggregate.orders > 0 && acos > 0 && acos <= thresholds.scaleAcosThreshold) return 'scaling';
  if (aggregate.orders > 0 && acos > thresholds.highAcosThreshold) return 'declining_repair';
  if (aggregate.orders >= 3 && acos > 0 && acos <= thresholds.targetAcos) return 'profit_harvesting';
  if (aggregate.orders > 0) return 'stable_conversion';
  return 'unknown';
}

function aggregateTimelineMetric(metrics: AdDailyMetrics[]): AdDailyMetrics {
  const first = metrics[0];
  const last = metrics[metrics.length - 1];
  const impressions = metrics.reduce((sum, metric) => sum + numberOrZero(metric.impressions), 0);
  const clicks = metrics.reduce((sum, metric) => sum + numberOrZero(metric.clicks), 0);
  const cost = metrics.reduce((sum, metric) => sum + numberOrZero(metric.cost), 0);
  const orders = metrics.reduce((sum, metric) => sum + numberOrZero(metric.orders), 0);
  const sales = metrics.reduce((sum, metric) => sum + numberOrZero(metric.sales), 0);
  return {
    ...first,
    date: last.date,
    impressions,
    clicks,
    cost,
    orders,
    sales,
    currency: 'USD',
    acos: sales > 0 ? cost / sales : 0,
    cpc: clicks > 0 ? cost / clicks : 0,
    cvr: clicks > 0 ? orders / clicks : 0,
  };
}

function groupMetricsByAdObject(metrics: AdDailyMetrics[]): Map<string, AdDailyMetrics[]> {
  const groups = new Map<string, AdDailyMetrics[]>();
  for (const metric of metrics) {
    const identity = buildAdMetricObjectIdentity(metric);
    const group = groups.get(identity.key) ?? [];
    group.push(metric);
    groups.set(identity.key, group);
  }
  return groups;
}

export function buildAdMetricObjectIdentity(metric: AdDailyMetrics): AdMetricObjectIdentity {
  const searchTerm = (metric.searchTerm || '').trim();
  const targeting = (metric.targeting || '').trim();
  const adGroupName = (metric.adGroupName || '').trim();
  const campaignName = (metric.campaignName || '').trim();
  const objectType: DailyAdTimeline['objectType'] = searchTerm
    ? 'search_term'
    : targeting
      ? 'target'
      : adGroupName
        ? 'ad_group'
        : 'campaign';
  const objectName = searchTerm || targeting || adGroupName || campaignName || 'unknown';
  const reportIdentity = String(metric.reportType || '').trim().toLowerCase()
    || String(metric.sourceFile || '').trim().replace(/\\/g, '/').toLowerCase()
    || 'unknown-report';
  const key = [
    (metric.asin || '').toUpperCase(),
    campaignName.toLowerCase(),
    adGroupName.toLowerCase(),
    reportIdentity,
    objectType,
    objectName.toLowerCase(),
  ].join('|');
  return { key, objectType, objectName };
}

function inferTimelineTrend(metrics: AdDailyMetrics[]): DailyAdTimeline['trend'] {
  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 4) return { spend: 'insufficient', sales: 'insufficient' };
  const midpoint = Math.floor(sorted.length / 2);
  const previous = sorted.slice(0, midpoint);
  const recent = sorted.slice(midpoint);
  return {
    spend: compareTrend(sumMetric(previous, 'cost'), sumMetric(recent, 'cost')),
    sales: compareTrend(sumMetric(previous, 'sales'), sumMetric(recent, 'sales')),
  };
}

function sumMetric(metrics: AdDailyMetrics[], key: 'cost' | 'sales'): number {
  return metrics.reduce((sum, metric) => sum + numberOrZero(metric[key]), 0);
}

function compareTrend(previous: number, recent: number): 'up' | 'down' | 'flat' {
  if (previous <= 0 && recent <= 0) return 'flat';
  if (previous <= 0 && recent > 0) return 'up';
  const change = (recent - previous) / previous;
  if (change > 0.15) return 'up';
  if (change < -0.15) return 'down';
  return 'flat';
}

function lowerBidValue(cpc: number, config: RuleConfig): string {
  const reduction = Math.min(numberOrFallback(config.bidAdjustPercent, 0.1), numberOrFallback(config.maxBidDecrement, 0.2));
  return Math.max(numberOrFallback(config.minCpc, 0.02), cpc * (1 - reduction)).toFixed(2);
}

function raiseBidValue(cpc: number, config: RuleConfig): string {
  const increase = Math.min(numberOrFallback(config.bidAdjustPercent, 0.1), numberOrFallback(config.maxBidIncrement, 0.5));
  return Math.min(numberOrFallback(config.maxCpc, 5), cpc * (1 + increase)).toFixed(2);
}

function matchesWhitelist(term: string, config: RuleConfig): boolean {
  const normalized = term.toLowerCase();
  return [...config.coreWordWhitelist, ...config.brandWordWhitelist]
    .filter(Boolean)
    .some((word) => normalized.includes(word.toLowerCase()));
}

function numberOrZero(value: unknown): number {
  return numberOrFallback(value, 0);
}

function numberOrFallback(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
