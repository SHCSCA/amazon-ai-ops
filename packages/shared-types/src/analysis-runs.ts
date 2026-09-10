import type { StoreContextEnvelope, StoreId, UsCurrency, UsMarketplace } from './store';
import type { RunMissionAnalysisResult } from './analysis-authority';
import type { V16Request, V16Result } from './v16-api';

/**
 * Analysis Run domain contracts.
 *
 * An Analysis Run is a first-class object that represents one complete analysis
 * execution for a specific store, mission, and 8/8 report snapshot. It tracks
 * the lifecycle from creation through fact verification, analysis, recommendation
 * generation, and completion or blocking.
 */

export type AnalysisRunStatus =
  | 'pending'
  | 'analyzing'
  | 'completed'
  | 'failed'
  | 'blocked';

export interface AnalysisRunRecord {
  runId: string;
  storeId: StoreId;
  marketplace: UsMarketplace;
  currency: UsCurrency;
  missionId?: string;
  reportSnapshotId: string;
  status: AnalysisRunStatus;
  recommendationsCount: number;
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  metadata?: AnalysisRunMetadata;
}

export interface AnalysisRunMetadata {
  storeContext?: StoreContextEnvelope;
  missionRevision?: number;
  policyRevision?: number;
  fingerprint?: string;
  evidencePackageId?: string;
  evidencePackageHash?: string;
  actionBatchId?: string;
  reusedFromRunId?: string;
  provenance?: 'analysis-authority/v16';
  historicalOnly?: boolean;
  /** Product ASIN if this run is scoped to a single product. */
  productId?: string;
  /** Date range for the analysis. */
  dateFrom?: string;
  dateTo?: string;
  /** Rule revision used for this analysis. */
  ruleRevision?: string;
  /** AI model revision used for this analysis. */
  modelRevision?: string;
  /** Number of proposals generated. */
  proposalsGenerated?: number;
  /** Number of recommendations skipped due to unsupported types. */
  skippedUnsupportedCount?: number;
  /** AI invocation summary. */
  aiSummary?: {
    configured: boolean;
    invoked: boolean;
    source: 'ai' | 'rule_fallback';
    detail: string;
  };
  /** Recommendation generation summary. */
  recommendationSummary?: {
    candidates: number;
    created: number;
    refreshed: number;
    reused: number;
  };
  /** Error details if status is 'failed'. */
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
  [key: string]: unknown;
}

export interface AnalysisRunsApi {
  create(request: V16Request<{ missionId: string }>): Promise<V16Result<RunMissionAnalysisResult>>;
  query(request: V16Request<{ runId: string }>): Promise<V16Result<AnalysisRunRecord | null>>;
  list(request: V16Request<{ missionId?: string; status?: AnalysisRunStatus; limit?: number }>): Promise<V16Result<AnalysisRunRecord[]>>;
}

export interface CreateAnalysisRunInput {
  runId: string;
  missionId?: string;
  reportSnapshotId: string;
  productId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface UpdateAnalysisRunInput {
  runId: string;
  status?: AnalysisRunStatus;
  recommendationsCount?: number;
  blockedReason?: string | null;
  startedAt?: string;
  completedAt?: string;
  metadata?: AnalysisRunMetadata;
}

export interface AnalysisRunProjection {
  runs: AnalysisRunRecord[];
  totalCount: number;
  completedCount: number;
  failedCount: number;
  blockedCount: number;
}

export function validateAnalysisRunRecord(value: AnalysisRunRecord): void {
  requiredText(value.runId, 'analysisRun.runId');
  requiredText(value.storeId, 'analysisRun.storeId');
  if (value.marketplace !== 'US' || value.currency !== 'USD') {
    throw new TypeError('Analysis run is limited to US marketplace and USD.');
  }
  if (value.missionId !== undefined) {
    requiredText(value.missionId, 'analysisRun.missionId');
  }
  requiredText(value.reportSnapshotId, 'analysisRun.reportSnapshotId');
  if (!['pending', 'analyzing', 'completed', 'failed', 'blocked'].includes(value.status)) {
    throw new TypeError('Unsupported analysis run status.');
  }
  nonNegativeInteger(value.recommendationsCount, 'analysisRun.recommendationsCount');
  if (value.blockedReason !== undefined) {
    requiredText(value.blockedReason, 'analysisRun.blockedReason');
  }
  requiredTimestamp(value.createdAt, 'analysisRun.createdAt');
  requiredTimestamp(value.updatedAt, 'analysisRun.updatedAt');
  if (value.startedAt !== undefined) {
    requiredTimestamp(value.startedAt, 'analysisRun.startedAt');
  }
  if (value.completedAt !== undefined) {
    requiredTimestamp(value.completedAt, 'analysisRun.completedAt');
  }
  if (value.metadata !== undefined) {
    validateAnalysisRunMetadata(value.metadata);
  }
}

export function validateAnalysisRunMetadata(value?: AnalysisRunMetadata): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Analysis run metadata must be an object.');
  }
  if (value.productId !== undefined) {
    requiredText(value.productId, 'metadata.productId');
  }
  if (value.dateFrom !== undefined) {
    requiredDate(value.dateFrom, 'metadata.dateFrom');
  }
  if (value.dateTo !== undefined) {
    requiredDate(value.dateTo, 'metadata.dateTo');
  }
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    throw new TypeError('Analysis run date range is inverted.');
  }
  if (value.ruleRevision !== undefined) {
    requiredText(value.ruleRevision, 'metadata.ruleRevision');
  }
  if (value.modelRevision !== undefined) {
    requiredText(value.modelRevision, 'metadata.modelRevision');
  }
  if (value.proposalsGenerated !== undefined) {
    nonNegativeInteger(value.proposalsGenerated, 'metadata.proposalsGenerated');
  }
  if (value.skippedUnsupportedCount !== undefined) {
    nonNegativeInteger(value.skippedUnsupportedCount, 'metadata.skippedUnsupportedCount');
  }
  if (value.aiSummary !== undefined) {
    validateAiSummary(value.aiSummary);
  }
  if (value.recommendationSummary !== undefined) {
    validateRecommendationSummary(value.recommendationSummary);
  }
  if (value.error !== undefined) {
    validateErrorDetails(value.error);
  }
}

function validateAiSummary(value: AnalysisRunMetadata['aiSummary']): void {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('AI summary must be an object.');
  }
  if (typeof value.configured !== 'boolean') {
    throw new TypeError('AI summary configured must be a boolean.');
  }
  if (typeof value.invoked !== 'boolean') {
    throw new TypeError('AI summary invoked must be a boolean.');
  }
  if (value.source !== 'ai' && value.source !== 'rule_fallback') {
    throw new TypeError('AI summary source must be "ai" or "rule_fallback".');
  }
  requiredText(value.detail, 'aiSummary.detail');
}

function validateRecommendationSummary(value: AnalysisRunMetadata['recommendationSummary']): void {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Recommendation summary must be an object.');
  }
  nonNegativeInteger(value.candidates, 'recommendationSummary.candidates');
  nonNegativeInteger(value.created, 'recommendationSummary.created');
  nonNegativeInteger(value.refreshed, 'recommendationSummary.refreshed');
  nonNegativeInteger(value.reused, 'recommendationSummary.reused');
}

function validateErrorDetails(value: AnalysisRunMetadata['error']): void {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Error details must be an object.');
  }
  requiredText(value.code, 'error.code');
  requiredText(value.message, 'error.message');
  if (value.stack !== undefined) {
    requiredText(value.stack, 'error.stack');
  }
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${field} is required.`);
  return normalized;
}

function requiredDate(value: unknown, field: string): void {
  const normalized = requiredText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00.000Z`))) {
    throw new TypeError(`${field} must be YYYY-MM-DD.`);
  }
}

function requiredTimestamp(value: unknown, field: string): void {
  const normalized = requiredText(value, field);
  if (Number.isNaN(Date.parse(normalized))) throw new TypeError(`${field} must be an ISO timestamp.`);
}

function nonNegativeInteger(value: unknown, field: string): void {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new TypeError(`${field} must be finite.`);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`${field} must be a non-negative integer.`);
  }
}
