import type {
  AiEvidenceItem,
  ProductStrategyContext,
} from '@amazon-ai-ops/ai-adapter';
import type {
  ActionRecommendation,
  AdDailyMetrics,
  CreateOperationEventInput,
  OperationEvent,
} from '@amazon-ai-ops/shared-types';
import type { AdProductHistoryLedger } from './ad-product-history-ledger';

export interface AdAiEvidenceScope {
  dateFrom: string;
  dateTo: string;
  storeName: string;
  marketplaceCode: string;
  asin?: string;
  batchId?: string;
}

export interface BuildAdAiEvidencePackInput {
  scope: AdAiEvidenceScope;
  metrics: AdDailyMetrics[];
  operationEvents: Array<CreateOperationEventInput | OperationEvent>;
  productContexts: ProductStrategyContext[];
  ruleRecommendations: ActionRecommendation[];
  productHistoryLedgers?: AdProductHistoryLedger[];
}

export function buildAdAiEvidencePack(input: BuildAdAiEvidencePackInput): AiEvidenceItem[] {
  const evidence: AiEvidenceItem[] = [];

  for (const metric of input.metrics.filter((item) => metricInScope(item, input.scope)).slice(0, 120)) {
    evidence.push(metricEvidence(input.scope, metric));
  }

  for (const event of input.operationEvents.filter((item) => eventInScope(item, input.scope)).slice(0, 80)) {
    evidence.push(eventEvidence(input.scope, event));
  }

  for (const product of input.productContexts.filter((item) => productInScope(item, input.scope)).slice(0, 40)) {
    evidence.push(productEvidence(input.scope, product));
  }

  for (const ledger of (input.productHistoryLedgers || []).filter((item) => productHistoryInScope(item, input.scope)).slice(0, 40)) {
    evidence.push(timelineEvidence(input.scope, ledger));
  }

  for (const recommendation of input.ruleRecommendations.filter((item) => recommendationInScope(item, input.scope)).slice(0, 80)) {
    evidence.push(ruleEvidence(input.scope, recommendation));
  }

  return evidence;
}

export function summarizeAiEvidencePack(evidencePack: AiEvidenceItem[]) {
  return {
    total: evidencePack.length,
    metric: evidencePack.filter((item) => item.type === 'metric').length,
    timeline: evidencePack.filter((item) => item.type === 'timeline').length,
    operationEvent: evidencePack.filter((item) => item.type === 'operation_event').length,
    productContext: evidencePack.filter((item) => item.type === 'product_context').length,
    ruleCandidate: evidencePack.filter((item) => item.type === 'rule_candidate').length,
  };
}

function metricEvidence(scope: AdAiEvidenceScope, metric: AdDailyMetrics): AiEvidenceItem {
  const entity = metric.searchTerm || metric.targeting || metric.adGroupName || metric.campaignName || metric.asin || 'unknown';
  const entityType = metric.searchTerm ? 'search_term' : metric.targeting ? 'target' : metric.adGroupName ? 'ad_group' : 'campaign';
  const batchId = metric.batchId || scope.batchId || 'no_batch';
  const reportType = metric.reportType || 'unknown_report';
  return {
    evidenceId: [
      'metric',
      safe(batchId),
      safe(reportType),
      safe(metric.date || scope.dateFrom),
      safe(entityType),
      stableHash([
        metric.storeName,
        metric.marketplaceCode,
        metric.campaignName,
        metric.adGroupName,
        metric.asin,
        entity,
        metric.sourceFile,
        metric.sourceRow,
      ].join('|')),
    ].join(':'),
    type: 'metric',
    label: `${entityType} ${entity} / ${metric.date || scope.dateFrom}`,
    dateRange: metric.date ? `${metric.date}~${metric.date}` : `${scope.dateFrom}~${scope.dateTo}`,
    batchId,
    reportType,
    sourceFile: metric.sourceFile,
    sourceRow: metric.sourceRow,
    storeName: metric.storeName || scope.storeName,
    marketplaceCode: metric.marketplaceCode || scope.marketplaceCode,
    asin: metric.asin || scope.asin,
    portfolioName: metric.portfolioName,
    campaignName: metric.campaignName,
    adGroupName: metric.adGroupName,
    entityType,
    entityName: entity,
    metrics: {
      impressions: metric.impressions,
      clicks: metric.clicks,
      cost: metric.cost,
      orders: metric.orders,
      sales: metric.sales,
      acos: metric.acos,
      cpc: metric.cpc,
      cvr: metric.cvr,
      currency: 'USD',
    },
  };
}

function eventEvidence(
  scope: AdAiEvidenceScope,
  event: CreateOperationEventInput | OperationEvent,
): AiEvidenceItem {
  const eventId = typeof (event as OperationEvent).id === 'number'
    ? String((event as OperationEvent).id)
    : stableHash([
        event.eventDate,
        event.storeName,
        event.marketplaceCode,
        event.asin,
        event.campaignName,
        event.adGroupName,
        event.eventType,
        event.title,
      ].join('|'));
  return {
    evidenceId: `event:${safe(eventId)}`,
    type: 'operation_event',
    label: `${event.eventDate} / ${event.eventType} / ${event.title}`,
    dateRange: `${event.eventDate}~${event.eventDate}`,
    storeName: event.storeName || scope.storeName,
    marketplaceCode: event.marketplaceCode || scope.marketplaceCode,
    asin: event.asin || scope.asin,
    campaignName: event.campaignName,
    adGroupName: event.adGroupName,
    entityType: 'operation_event',
    entityName: event.title,
    event: {
      eventDate: event.eventDate,
      eventType: event.eventType,
      title: event.title,
      impactExpectation: event.impactExpectation,
    },
  };
}

function productEvidence(scope: AdAiEvidenceScope, product: ProductStrategyContext): AiEvidenceItem {
  return {
    evidenceId: `product:${safe(scope.storeName)}:${safe(scope.marketplaceCode)}:${safe(product.asin)}`,
    type: 'product_context',
    label: `${product.asin} / ${product.productStage || 'unknown_stage'}`,
    dateRange: `${scope.dateFrom}~${scope.dateTo}`,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: product.asin,
    entityType: 'product',
    entityName: product.asin,
    product: {
      productStage: product.productStage,
      targetAcos: product.cost?.targetAcos,
      targetTacos: product.cost?.targetTacos,
      targetNetMargin: product.cost?.targetNetMargin,
      minPrice: product.cost?.minPrice,
    },
  };
}

function timelineEvidence(scope: AdAiEvidenceScope, ledger: AdProductHistoryLedger): AiEvidenceItem {
  const batchId = scope.batchId || 'no_batch';
  return {
    evidenceId: `timeline:${safe(batchId)}:product:${safe(ledger.asin)}`,
    type: 'timeline',
    label: `product ${ledger.asin} / ${ledger.inferredStage || 'unknown_stage'} / ${ledger.activeDays} days`,
    dateRange: `${ledger.dateFrom}~${ledger.dateTo}`,
    batchId,
    storeName: ledger.storeName || scope.storeName,
    marketplaceCode: ledger.marketplaceCode || scope.marketplaceCode,
    asin: ledger.asin || scope.asin,
    entityType: 'product',
    entityName: ledger.asin,
    metrics: {
      impressions: ledger.totals.impressions,
      clicks: ledger.totals.clicks,
      cost: ledger.totals.cost,
      orders: ledger.totals.orders,
      sales: ledger.totals.sales,
      acos: ledger.totals.acos,
      cpc: ledger.totals.cpc,
      cvr: ledger.totals.cvr,
      currency: 'USD',
    },
    product: ledger.product,
    timeline: {
      activeDays: ledger.activeDays,
      firstMetricDate: ledger.firstMetricDate,
      lastMetricDate: ledger.lastMetricDate,
      inferredStage: ledger.inferredStage,
      stageReasons: ledger.stageReasons,
      recentDaily: ledger.daily.slice(-14).map((day) => ({
        date: day.date,
        clicks: day.clicks,
        cost: day.cost,
        orders: day.orders,
        sales: day.sales,
        acos: day.acos,
        cvr: day.cvr,
        currency: day.currency,
      })),
    },
  };
}

function ruleEvidence(scope: AdAiEvidenceScope, recommendation: ActionRecommendation): AiEvidenceItem {
  return {
    evidenceId: [
      'rule',
      safe(recommendation.taskId || 'no_task'),
      safe(recommendation.entityType),
      stableHash([
        recommendation.storeName,
        recommendation.marketplaceCode,
        recommendation.asin,
        recommendation.entityType,
        recommendation.entityName,
        recommendation.actionType,
      ].join('|')),
    ].join(':'),
    type: 'rule_candidate',
    label: `${recommendation.actionType} / ${recommendation.entityType} / ${recommendation.entityName}`,
    dateRange: `${scope.dateFrom}~${scope.dateTo}`,
    batchId: recommendation.evidence?.batchId || scope.batchId,
    sourceFile: recommendation.evidence?.sourceFiles?.[0],
    sourceRow: recommendation.evidence?.sourceRow,
    storeName: recommendation.storeName || scope.storeName,
    marketplaceCode: recommendation.marketplaceCode || scope.marketplaceCode,
    asin: recommendation.asin || scope.asin,
    portfolioName: recommendation.evidence?.portfolioName,
    campaignName: recommendation.evidence?.campaignName,
    adGroupName: recommendation.evidence?.adGroupName,
    entityType: recommendation.entityType,
    entityName: recommendation.entityName,
    metrics: {
      impressions: recommendation.evidence?.impressions,
      clicks: recommendation.evidence?.clicks,
      cost: recommendation.evidence?.cost,
      orders: recommendation.evidence?.orders,
      sales: recommendation.evidence?.sales,
      acos: recommendation.evidence?.acos,
      cpc: recommendation.evidence?.cpc,
      cvr: recommendation.evidence?.cvr,
      currency: 'USD',
    },
  };
}

function metricInScope(metric: AdDailyMetrics, scope: AdAiEvidenceScope): boolean {
  if (metric.date < scope.dateFrom || metric.date > scope.dateTo) return false;
  if (metric.storeName && metric.storeName !== scope.storeName) return false;
  if (metric.marketplaceCode && metric.marketplaceCode !== scope.marketplaceCode) return false;
  if (scope.asin && metric.asin && metric.asin.toUpperCase() !== scope.asin.toUpperCase()) return false;
  if (scope.batchId && metric.batchId !== scope.batchId) return false;
  return true;
}

function eventInScope(event: CreateOperationEventInput | OperationEvent, scope: AdAiEvidenceScope): boolean {
  if (event.eventDate < scope.dateFrom || event.eventDate > scope.dateTo) return false;
  if (event.storeName && event.storeName !== scope.storeName) return false;
  if (event.marketplaceCode && event.marketplaceCode !== scope.marketplaceCode) return false;
  if (scope.asin && event.asin && event.asin.toUpperCase() !== scope.asin.toUpperCase()) return false;
  return true;
}

function productInScope(product: ProductStrategyContext, scope: AdAiEvidenceScope): boolean {
  return !scope.asin || product.asin.toUpperCase() === scope.asin.toUpperCase();
}

function productHistoryInScope(ledger: AdProductHistoryLedger, scope: AdAiEvidenceScope): boolean {
  if (ledger.dateTo < scope.dateFrom || ledger.dateFrom > scope.dateTo) return false;
  if (ledger.storeName && ledger.storeName !== scope.storeName) return false;
  if (ledger.marketplaceCode && ledger.marketplaceCode !== scope.marketplaceCode) return false;
  return !scope.asin || ledger.asin.toUpperCase() === scope.asin.toUpperCase();
}

function recommendationInScope(recommendation: ActionRecommendation, scope: AdAiEvidenceScope): boolean {
  if (recommendation.storeName && recommendation.storeName !== scope.storeName) return false;
  if (recommendation.marketplaceCode && recommendation.marketplaceCode !== scope.marketplaceCode) return false;
  if (scope.asin && recommendation.asin && recommendation.asin.toUpperCase() !== scope.asin.toUpperCase()) return false;
  if (scope.batchId && recommendation.evidence?.batchId !== scope.batchId) return false;
  if (recommendation.evidence?.date && (
    recommendation.evidence.date < scope.dateFrom || recommendation.evidence.date > scope.dateTo
  )) return false;
  return true;
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) + value.charCodeAt(index);
    hash >>>= 0;
  }
  return hash.toString(36);
}

function safe(value: unknown): string {
  return String(value || 'none')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 80) || 'none';
}
