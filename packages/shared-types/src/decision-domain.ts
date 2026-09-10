/**
 * Decision Domain Model
 *
 * Represents a decision record - the immutable audit trail for recommendations.
 * A decision is created from a recommendation after analysis and must go through
 * approval before execution.
 *
 * Design invariants:
 * - Every Decision must belong to exactly one AnalysisRun (analysisRunId)
 * - Every AnalysisRun belongs to exactly one Mission (missionId)
 * - Status transitions are append-only history (DecisionHistoryEntry)
 * - Superseded decisions are not deleted, only flagged
 *
 * @module decision-domain
 */

import type { StoreId, UsCurrency, UsMarketplace } from './store';

/**
 * Decision status lifecycle
 */
export type DecisionStatus =
  | 'proposed'         // Created from recommendation, awaiting review
  | 'needs_approval'   // Flagged for human review
  | 'approved'         // Human or policy approved
  | 'rejected'         // Human or policy rejected
  | 'blocked'          // Blocked by a gate (e.g., incomplete data)
  | 'superseded'       // Replaced by a newer decision for same entity
  | 'executed'         // Action submitted to Ads
  | 'verified';        // Execution verified through readback

/**
 * Decision issuer type
 */
export type DecisionIssuer = 'human_operator' | 'policy_runtime';

/**
 * Decision record schema.
 *
 * Provenance chain: Decision → AnalysisRun → Mission
 */
export interface DecisionRecord {
  readonly decisionId: string;
  readonly storeId: StoreId;
  readonly marketplace: UsMarketplace;
  readonly currency: UsCurrency;

  // Provenance chain
  readonly missionId: string;
  readonly missionRevision: number;
  readonly analysisRunId: string;         // Links to the analysis run that produced the recommendation
  readonly batchId: string;
  readonly recommendationId: string;     // Original recommendation ID (v1.5 system)

  // Action details
  readonly actionType: string;           // e.g., 'adjust_keyword_bid'
  readonly entityType: string;            // e.g., 'keyword', 'campaign'
  readonly entityId: string;             // The target entity
  readonly currentValue?: string;         // Before action
  readonly targetValue?: string;          // Proposed change
  readonly changeReason?: string;         // AI explanation

  // Lifecycle
  readonly status: DecisionStatus;
  readonly issuer: DecisionIssuer;
  readonly revision: number;

  // Approval
  readonly approvedAt?: string;
  readonly approvedBy?: string;
  readonly rejectionReason?: string;

  // Supersession chain
  readonly supersededBy?: string;         // ID of the decision that replaced this
  readonly supersedes?: string;          // ID of the decision this replaced

  // Execution
  readonly executedAt?: string;
  readonly executionEvidence?: string;   // Path to evidence folder

  // Verification
  readonly verifiedAt?: string;
  readonly verificationResult?: 'success' | 'failure' | 'unknown';

  // Timestamps
  readonly createdAt: string;
  readonly updatedAt: string;

  // Metadata
  readonly metadata?: Record<string, unknown>;
}

/**
 * Decision history entry (append-only)
 */
export interface DecisionHistoryEntry {
  readonly entryId: string;
  readonly decisionId: string;
  readonly fromStatus: DecisionStatus;
  readonly toStatus: DecisionStatus;
  readonly timestamp: string;
  readonly reason?: string;
  readonly triggeredBy: 'system' | 'operator';
  readonly metadata?: Record<string, unknown>;
}

/**
 * Decision creation input
 */
export interface CreateDecisionInput {
  storeId: StoreId;
  marketplace: UsMarketplace;
  currency: UsCurrency;
  missionId: string;
  missionRevision: number;
  analysisRunId: string;
  batchId: string;
  recommendationId: string;
  actionType: string;
  entityType: string;
  entityId: string;
  currentValue?: string;
  targetValue?: string;
  changeReason?: string;
}

/**
 * Status transition labels
 */
export const STATUS_LABELS: Record<DecisionStatus, string> = {
  proposed: '已提议',
  needs_approval: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
  blocked: '已阻断',
  superseded: '已替代',
  executed: '已执行',
  verified: '已验证',
};

/**
 * Valid status transitions
 */
export const VALID_STATUS_TRANSITIONS: Partial<Record<DecisionStatus, DecisionStatus[]>> = {
  proposed: ['needs_approval', 'blocked', 'superseded'],
  needs_approval: ['approved', 'rejected', 'blocked', 'superseded'],
  approved: ['executed', 'superseded'],
  rejected: ['superseded'],
  executed: ['verified'],
  verified: [], // Terminal state
  blocked: ['proposed', 'needs_approval'], // Can retry
  superseded: [], // Terminal state
};

/**
 * Check if a status transition is valid
 */
export function isValidStatusTransition(
  from: DecisionStatus,
  to: DecisionStatus
): boolean {
  return VALID_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get action type labels for display
 */
export const ACTION_TYPE_LABELS: Record<string, string> = {
  'adjust_keyword_bid': '调整关键词竞价',
  'pause_keyword': '暂停关键词',
  'resume_keyword': '恢复关键词',
  'adjust_campaign_budget': '调整活动预算',
  'adjust_ad_group_budget': '调整广告组预算',
  'pause_campaign': '暂停活动',
  'resume_campaign': '恢复活动',
  'add_negative_keyword': '添加否定关键词',
  'remove_negative_keyword': '移除否定关键词',
  'adjust_product_target': '调整商品投放',
};

/**
 * Get entity type labels for display
 */
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  keyword: '关键词',
  campaign: '活动',
  ad_group: '广告组',
  product_target: '商品投放',
  negative_keyword: '否定关键词',
};

// ─── Validation helpers ──────────────────────────────────────────────────

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${field} is required.`);
  return normalized;
}

function requiredTimestamp(value: unknown, field: string): void {
  requiredText(value, field);
  if (Number.isNaN(Date.parse(String(value)))) {
    throw new TypeError(`${field} must be an ISO timestamp.`);
  }
}

function optionalTimestamp(value: unknown, field: string): void {
  if (value === undefined || value === null) return;
  requiredTimestamp(value, field);
}

function nonNegativeInteger(value: unknown, field: string): void {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new TypeError(`${field} must be finite.`);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`${field} must be a non-negative integer.`);
  }
}

// ─── Validation functions ───────────────────────────────────────────────

const VALID_STATUSES = new Set<DecisionStatus>([
  'proposed', 'needs_approval', 'approved', 'rejected',
  'blocked', 'superseded', 'executed', 'verified',
]);

const VALID_ISSUERS = new Set<DecisionIssuer>(['human_operator', 'policy_runtime']);

const VALID_VERIFICATION_RESULTS = new Set(['success', 'failure', 'unknown']);

/**
 * Validate a DecisionRecord.
 * Throws TypeError on validation failure.
 */
export function validateDecisionRecord(value: DecisionRecord): void {
  requiredText(value.decisionId, 'decision.decisionId');
  requiredText(value.storeId, 'decision.storeId');
  requiredText(value.marketplace, 'decision.marketplace');
  if (value.marketplace !== 'US') {
    throw new TypeError('Decision is limited to US marketplace.');
  }
  requiredText(value.currency, 'decision.currency');
  if (value.currency !== 'USD') {
    throw new TypeError('Decision is limited to USD currency.');
  }
  requiredText(value.missionId, 'decision.missionId');
  nonNegativeInteger(value.missionRevision, 'decision.missionRevision');
  requiredText(value.analysisRunId, 'decision.analysisRunId');
  requiredText(value.batchId, 'decision.batchId');
  requiredText(value.recommendationId, 'decision.recommendationId');
  requiredText(value.actionType, 'decision.actionType');
  requiredText(value.entityType, 'decision.entityType');
  requiredText(value.entityId, 'decision.entityId');

  if (!VALID_STATUSES.has(value.status)) {
    throw new TypeError(`Unsupported decision status: ${value.status}.`);
  }
  if (!VALID_ISSUERS.has(value.issuer)) {
    throw new TypeError(`Unsupported decision issuer: ${value.issuer}.`);
  }
  nonNegativeInteger(value.revision, 'decision.revision');

  optionalTimestamp(value.approvedAt, 'decision.approvedAt');
  optionalTimestamp(value.executedAt, 'decision.executedAt');
  optionalTimestamp(value.verifiedAt, 'decision.verifiedAt');

  if (value.verificationResult !== undefined && !VALID_VERIFICATION_RESULTS.has(value.verificationResult)) {
    throw new TypeError(`Unsupported verification result: ${value.verificationResult}.`);
  }

  requiredTimestamp(value.createdAt, 'decision.createdAt');
  requiredTimestamp(value.updatedAt, 'decision.updatedAt');

  if (value.createdAt > value.updatedAt) {
    throw new TypeError('decision.createdAt must not be after decision.updatedAt.');
  }
}

/**
 * Validate a CreateDecisionInput.
 * Throws TypeError on validation failure.
 */
export function validateCreateDecisionInput(value: CreateDecisionInput): void {
  requiredText(value.storeId, 'createDecision.storeId');
  requiredText(value.marketplace, 'createDecision.marketplace');
  if (value.marketplace !== 'US') {
    throw new TypeError('Decision is limited to US marketplace.');
  }
  requiredText(value.currency, 'createDecision.currency');
  if (value.currency !== 'USD') {
    throw new TypeError('Decision is limited to USD currency.');
  }
  requiredText(value.missionId, 'createDecision.missionId');
  nonNegativeInteger(value.missionRevision, 'createDecision.missionRevision');
  requiredText(value.analysisRunId, 'createDecision.analysisRunId');
  requiredText(value.batchId, 'createDecision.batchId');
  requiredText(value.recommendationId, 'createDecision.recommendationId');
  requiredText(value.actionType, 'createDecision.actionType');
  requiredText(value.entityType, 'createDecision.entityType');
  requiredText(value.entityId, 'createDecision.entityId');
}

// ─── Decision projection ─────────────────────────────────────────────────

/**
 * Aggregated decision statistics for a store.
 */
export interface DecisionProjection {
  storeId: StoreId;
  totalCount: number;
  proposedCount: number;
  needsApprovalCount: number;
  approvedCount: number;
  rejectedCount: number;
  blockedCount: number;
  supersededCount: number;
  executedCount: number;
  verifiedCount: number;
  byEntityType: Record<string, number>;
  byActionType: Record<string, number>;
  recentDecisions: DecisionRecord[];
}

// ─── Status transition result ────────────────────────────────────────────

/**
 * Result of an atomic status transition.
 */
export interface StatusTransitionResult {
  readonly decision: DecisionRecord;
  readonly historyEntry: DecisionHistoryEntry;
}

// ─── Domain-to-persistence mappers ──────────────────────────────────────

export interface DecisionRow {
  decision_id: string;
  store_id: string;
  marketplace?: string;
  currency?: string;
  mission_id: string;
  mission_revision: number;
  analysis_run_id?: string | null;
  batch_id: string;
  recommendation_id: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  current_value: string | null;
  target_value: string | null;
  change_reason: string | null;
  status: string;
  issuer: string;
  revision: number;
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  superseded_by: string | null;
  supersedes: string | null;
  executed_at: string | null;
  execution_evidence: string | null;
  verified_at: string | null;
  verification_result: string | null;
  created_at: string;
  updated_at: string;
  metadata: string | null;
}

/**
 * Convert a DecisionRow (SQLite) to a DecisionRecord (domain model).
 */
export function decisionRowToRecord(row: DecisionRow): DecisionRecord {
  return {
    decisionId: row.decision_id,
    storeId: row.store_id as StoreId,
    marketplace: (row.marketplace ?? 'US') as UsMarketplace,
    currency: (row.currency ?? 'USD') as UsCurrency,
    missionId: row.mission_id,
    missionRevision: row.mission_revision,
    analysisRunId: row.analysis_run_id ?? '',
    batchId: row.batch_id,
    recommendationId: row.recommendation_id,
    actionType: row.action_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    currentValue: row.current_value ?? undefined,
    targetValue: row.target_value ?? undefined,
    changeReason: row.change_reason ?? undefined,
    status: row.status as DecisionStatus,
    issuer: row.issuer as DecisionIssuer,
    revision: row.revision,
    approvedAt: row.approved_at ?? undefined,
    approvedBy: row.approved_by ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    supersededBy: row.superseded_by ?? undefined,
    supersedes: row.supersedes ?? undefined,
    executedAt: row.executed_at ?? undefined,
    executionEvidence: row.execution_evidence ?? undefined,
    verifiedAt: row.verified_at ?? undefined,
    verificationResult: row.verification_result as 'success' | 'failure' | 'unknown' | undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

/**
 * Convert a DecisionRecord (domain model) to a row-ready plain object.
 */
export function decisionRecordToRow(record: DecisionRecord): DecisionRow {
  return {
    decision_id: record.decisionId,
    store_id: record.storeId,
    marketplace: record.marketplace,
    currency: record.currency,
    mission_id: record.missionId,
    mission_revision: record.missionRevision,
    analysis_run_id: record.analysisRunId || null,
    batch_id: record.batchId,
    recommendation_id: record.recommendationId,
    action_type: record.actionType,
    entity_type: record.entityType,
    entity_id: record.entityId,
    current_value: record.currentValue ?? null,
    target_value: record.targetValue ?? null,
    change_reason: record.changeReason ?? null,
    status: record.status,
    issuer: record.issuer,
    revision: record.revision,
    approved_at: record.approvedAt ?? null,
    approved_by: record.approvedBy ?? null,
    rejection_reason: record.rejectionReason ?? null,
    superseded_by: record.supersededBy ?? null,
    supersedes: record.supersedes ?? null,
    executed_at: record.executedAt ?? null,
    execution_evidence: record.executionEvidence ?? null,
    verified_at: record.verifiedAt ?? null,
    verification_result: record.verificationResult ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    metadata: record.metadata ? JSON.stringify(record.metadata) : null,
  };
}

/**
 * Build a DecisionRecord from a CreateDecisionInput + generated IDs.
 */
export function buildDecisionRecord(
  input: CreateDecisionInput,
  decisionId: string,
  now: string,
): DecisionRecord {
  return {
    decisionId,
    storeId: input.storeId,
    marketplace: input.marketplace,
    currency: input.currency,
    missionId: input.missionId,
    missionRevision: input.missionRevision,
    analysisRunId: input.analysisRunId,
    batchId: input.batchId,
    recommendationId: input.recommendationId,
    actionType: input.actionType,
    entityType: input.entityType,
    entityId: input.entityId,
    currentValue: input.currentValue,
    targetValue: input.targetValue,
    changeReason: input.changeReason,
    status: 'proposed',
    issuer: 'human_operator',
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Build a DecisionHistoryEntry for a status transition.
 */
export function buildHistoryEntry(
  decisionId: string,
  entryId: string,
  fromStatus: DecisionStatus,
  toStatus: DecisionStatus,
  triggeredBy: 'system' | 'operator',
  reason?: string,
): DecisionHistoryEntry {
  return {
    entryId,
    decisionId,
    fromStatus,
    toStatus,
    timestamp: new Date().toISOString(),
    reason,
    triggeredBy,
  };
}

/**
 * Check if a DecisionRecord represents a terminal (non-transitional) state.
 */
export function isDecisionTerminal(record: DecisionRecord): boolean {
  return ['verified', 'superseded'].includes(record.status);
}

/**
 * Get a short provenance summary for display/debugging.
 */
export function getDecisionProvenanceChain(record: DecisionRecord): string {
  return `${record.missionId}@r${record.missionRevision} → ${record.analysisRunId} → ${record.decisionId}`;
}
