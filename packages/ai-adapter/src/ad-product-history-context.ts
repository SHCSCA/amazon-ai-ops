import type { AdStrategyDiagnosisInput, AiEvidenceItem } from './ad-strategy-diagnosis';
import { sanitizeObservedProductLedger } from './ad-product-observed-ledger';
export type { AdProductObservedLedger, AdProductObservedMetricField } from './ad-product-observed-ledger';
import type { AdProductObservedLedger } from './ad-product-observed-ledger';

export interface AdProductHistoryQuality {
  observedLedger?: AdProductObservedLedger;
  status: 'unavailable';
  coverage: 'unverified';
  reason: string;
  dateFrom: string;
  dateTo: string;
  observedDates: string[];
  observedRowCount: number;
  unboundAsinRowCount: number;
  omittedSourceRowCount: number;
  canonicalObservation?: {
    storeId: string;
    status: 'unverified';
    source: 'canonical_report_rows';
    rowLimitExceeded: boolean;
    sourceBound: boolean;
    scopeValid: boolean;
    productUniverse: 'explicit_scope' | 'observed_only';
    omittedProductCount: number;
    omittedProductDayCount: number;
    excludedReportRowCount: number;
    nativeAsinProvenance: 'unknown';
    coverageProof: 'absent';
    replacementProof: 'absent';
    days: Array<{
      asin: string;
      date: string;
      status: 'partial' | 'missing' | 'ambiguous';
      observedRowCount: number;
      reportTypes: string[];
      duplicateSourceRowCount: number;
      missingSourceIdentityRowCount: number;
      observedZeroRowCount: number;
    }>;
  };
  sources: Array<{
    date: string;
    asin?: string;
    reportType?: string;
    batchId?: string;
    sourceFile: string;
    sourceRow?: number;
  }>;
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


export function prepareUnverifiedProductHistory(input: AdStrategyDiagnosisInput): {
  quality: AdProductHistoryQuality;
  evidencePack: AiEvidenceItem[];
} {
  const quality: AdProductHistoryQuality = {
    dateFrom: input.scope.dateFrom,
    dateTo: input.scope.dateTo,
    observedDates: Array.from(new Set(input.metrics.map((metric) => metric.date).filter((date): date is string => Boolean(date)))).sort(),
    observedRowCount: input.metrics.length,
    unboundAsinRowCount: input.metrics.filter((metric) => !String(metric.asin || '').trim()).length,
    omittedSourceRowCount: input.metrics.length,
    sources: [],
    ...input.productHistoryQuality,
    observedLedger: sanitizeObservedProductLedger(input.productHistoryQuality?.observedLedger, input.scope),
    status: 'unavailable',
    coverage: 'unverified',
    reason: input.productHistoryQuality?.reason || '缺少已核验的逐产品日来源，产品汇总不可用；阶段、阈值与 AI 动作需人工复核。',
  };
  return {
    quality,
    evidencePack: (input.evidencePack || []).map((item) => item.type !== 'timeline' ? item : {
      ...item,
      label: '产品广告历史汇总不可用 · 需复核来源覆盖',
      metrics: undefined,
      timeline: { inferredStage: 'unknown', stageReasons: [quality.reason], productHistoryQuality: quality },
    }),
  };
}
