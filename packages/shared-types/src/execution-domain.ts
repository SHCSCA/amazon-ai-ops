/**
 * Execution Domain Model
 *
 * Represents a single execution action - the safe execution contract.
 * Execution goes through preflight → submit → readback → verification.
 *
 * @module execution-domain
 */

import type { GrantStatus } from './mission-grant-domain';

/**
 * Execution slot status
 */
export type SlotStatus =
  | 'pending'                    // Created, not yet submitted
  | 'preflight_blocked'          // Preflight check failed
  | 'submit_intent_recorded'     // Intent to submit recorded
  | 'submitted'                  // Actually submitted to Ads
  | 'verified'                   // Successfully verified
  | 'failed'                     // Execution failed
  | 'unknown';                   // Unknown outcome (UNKNOWN is terminal)

/**
 * Batch status
 */
export type BatchStatus =
  | 'running'                    // Running, some slots pending
  | 'completed'                  // All slots verified or failed
  | 'stopped_invalidated'        // Stopped due to invalidation
  | 'stopped_unknown';           // Stopped due to UNKNOWN (terminal)

/**
 * Execution intent - what we're trying to do
 */
export interface ExecutionIntent {
  readonly grantId: string;
  readonly decisionId: string;
  readonly actionType: string;
  readonly entityId: string;
  readonly targetValue: string;
  readonly idempotencyKey: string;
  readonly submitTimestamp?: string;
}

/**
 * Execution slot - single action execution
 */
export interface ExecutionSlot {
  readonly slotId: string;
  readonly grantId: string;
  readonly decisionId: string;
  readonly batchId: string;

  // Action details
  readonly intent: ExecutionIntent;
  readonly status: SlotStatus;

  // Expected values
  readonly expectedBefore: string;
  readonly expectedAfter: string;
  readonly expectedChangePercent?: number;

  // Evidence paths (before/after/reload screenshots)
  readonly beforeEvidencePath?: string;
  readonly afterEvidencePath?: string;
  readonly reloadEvidencePath?: string;

  // Value readback
  readonly readbackBeforeValue?: string;
  readonly readbackAfterValue?: string;
  readonly readbackReloadValue?: string;

  // Verification
  readonly verifiedAt?: string;
  readonly verificationResult?: 'success' | 'failure' | 'unknown';

  // UNKNOWN reconciliation
  readonly reconciliationCaseId?: string;
  readonly reconciliationOutcome?: ReconciliationOutcome;

  // Timestamps
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly submittedAt?: string;
}

/**
 * Execution batch - group of slots
 */
export interface ExecutionBatch {
  readonly batchId: string;
  readonly grantId: string;
  readonly missionId: string;
  readonly storeId: string;

  // Slots
  readonly slotIds: string[];
  readonly status: BatchStatus;

  // Progress
  readonly pendingCount: number;
  readonly submittedCount: number;
  readonly verifiedCount: number;
  readonly failedCount: number;
  readonly unknownCount: number;

  // Timestamps
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

/**
 * Reconciliation case for UNKNOWN outcomes
 */
export interface ReconciliationCase {
  readonly caseId: string;
  readonly slotId: string;
  readonly batchId: string;
  readonly createdAt: string;

  // Observation slots
  readonly observation1Timestamp?: string;
  readonly observation1Value?: string;
  readonly observation2Timestamp?: string;
  readonly observation2Value?: string;

  // Resolution
  readonly outcome?: ReconciliationOutcome;
  readonly resolvedAt?: string;
  readonly resolutionNotes?: string;
}

/**
 * Reconciliation outcomes
 */
export type ReconciliationOutcome =
  | 'target_stably_observed'    // Target value was applied and persists
  | 'original_stably_observed'  // Original value still in effect
  | 'other_value'               // A different value observed
  | 'inconclusive_permanent';   // Cannot determine (permanent unknown)

/**
 * Preflight gate result
 */
export interface PreflightGateResult {
  readonly passed: boolean;
  readonly blockedGates: PreflightGate[];
  readonly message?: string;
}

/**
 * Preflight gates (P0-P6)
 */
export type PreflightGate =
  | 'P0_KILL_SWITCH'           // Kill switch is on
  | 'P1_CIRCUIT_BREAKER'       // Circuit breaker triggered
  | 'P2_CONTEXT_MISMATCH'      // Store/product/session mismatch
  | 'P3_REVISION_MISMATCH'     // Policy/mission revision changed
  | 'P4_GRANT_INVALID'         // Grant expired/consumed/revoked
  | 'P5_SCOPE_MISMATCH'        // Entity not in grant scope
  | 'P6_EVIDENCE_REQUIRED';    // Required evidence missing

/**
 * Preflight gate labels
 */
export const PREFLIGHT_GATE_LABELS: Record<PreflightGate, string> = {
  P0_KILL_SWITCH: '总开关已关闭',
  P1_CIRCUIT_BREAKER: '熔断器已触发',
  P2_CONTEXT_MISMATCH: '上下文不匹配',
  P3_REVISION_MISMATCH: '版本已变更',
  P4_GRANT_INVALID: '授权已失效',
  P5_SCOPE_MISMATCH: '对象不在授权范围内',
  P6_EVIDENCE_REQUIRED: '缺少必要证据',
};

/**
 * Slot status labels
 */
export const SLOT_STATUS_LABELS: Record<SlotStatus, string> = {
  pending: '等待提交',
  preflight_blocked: '预检阻断',
  submit_intent_recorded: '意图已记录',
  submitted: '已提交',
  verified: '已验证',
  failed: '执行失败',
  unknown: '结果未知',
};

/**
 * Batch status labels
 */
export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  running: '执行中',
  completed: '已完成',
  stopped_invalidated: '已停止(失效)',
  stopped_unknown: '已停止(未知)',
};

/**
 * Reconciliation outcome labels
 */
export const RECONCILIATION_OUTCOME_LABELS: Record<ReconciliationOutcome, string> = {
  target_stably_observed: '目标值已稳定',
  original_stably_observed: '原值仍有效',
  other_value: '观察到其他值',
  inconclusive_permanent: '无法确定(永久未知)',
};

/**
 * Check if a slot status is terminal
 */
export function isSlotStatusTerminal(status: SlotStatus): boolean {
  return ['verified', 'failed', 'unknown'].includes(status);
}

/**
 * Check if a batch is terminal
 */
export function isBatchTerminal(status: BatchStatus): boolean {
  return ['completed', 'stopped_invalidated', 'stopped_unknown'].includes(status);
}

/**
 * Verify readback value matches expected
 */
export function verifyReadbackMatch(
  readbackValue: string,
  expectedValue: string,
  tolerancePercent: number = 0
): boolean {
  // Try numeric comparison first
  const readbackNum = parseFloat(readbackValue);
  const expectedNum = parseFloat(expectedValue);

  if (!isNaN(readbackNum) && !isNaN(expectedNum)) {
    if (tolerancePercent > 0) {
      const diff = Math.abs(readbackNum - expectedNum);
      const tolerance = expectedNum * (tolerancePercent / 100);
      return diff <= tolerance;
    }
    return readbackNum === expectedNum;
  }

  // Fall back to string comparison
  return readbackValue === expectedValue;
}

/**
 * Validate execution slot
 */
export function validateExecutionSlot(slot: ExecutionSlot): void {
  if (!slot.slotId || slot.slotId.trim() === '') {
    throw new Error('Slot ID is required');
  }
  if (!slot.grantId || slot.grantId.trim() === '') {
    throw new Error('Grant ID is required');
  }
  if (!slot.decisionId || slot.decisionId.trim() === '') {
    throw new Error('Decision ID is required');
  }
  if (!slot.batchId || slot.batchId.trim() === '') {
    throw new Error('Batch ID is required');
  }
  if (!slot.intent) {
    throw new Error('Intent is required');
  }
  if (!slot.status) {
    throw new Error('Status is required');
  }
  if (!slot.expectedBefore) {
    throw new Error('Expected before value is required');
  }
  if (!slot.expectedAfter) {
    throw new Error('Expected after value is required');
  }
  if (!slot.createdAt) {
    throw new Error('Created timestamp is required');
  }
  if (!slot.updatedAt) {
    throw new Error('Updated timestamp is required');
  }

  // Validate timestamps
  const created = new Date(slot.createdAt).getTime();
  const updated = new Date(slot.updatedAt).getTime();
  if (isNaN(created) || isNaN(updated)) {
    throw new Error('Invalid timestamp format');
  }
  if (updated < created) {
    throw new Error('Updated timestamp cannot be before created timestamp');
  }
}

/**
 * Validate execution batch
 */
export function validateExecutionBatch(batch: ExecutionBatch): void {
  if (!batch.batchId || batch.batchId.trim() === '') {
    throw new Error('Batch ID is required');
  }
  if (!batch.grantId || batch.grantId.trim() === '') {
    throw new Error('Grant ID is required');
  }
  if (!batch.missionId || batch.missionId.trim() === '') {
    throw new Error('Mission ID is required');
  }
  if (!batch.storeId || batch.storeId.trim() === '') {
    throw new Error('Store ID is required');
  }
  if (!batch.status) {
    throw new Error('Status is required');
  }
  if (!Array.isArray(batch.slotIds)) {
    throw new Error('Slot IDs must be an array');
  }
  if (!batch.createdAt) {
    throw new Error('Created timestamp is required');
  }
  if (!batch.updatedAt) {
    throw new Error('Updated timestamp is required');
  }

  // Validate timestamps
  const created = new Date(batch.createdAt).getTime();
  const updated = new Date(batch.updatedAt).getTime();
  if (isNaN(created) || isNaN(updated)) {
    throw new Error('Invalid timestamp format');
  }
  if (updated < created) {
    throw new Error('Updated timestamp cannot be before created timestamp');
  }

  // Validate counts
  const totalSlots = batch.pendingCount + batch.submittedCount + batch.verifiedCount + batch.failedCount + batch.unknownCount;
  if (totalSlots !== batch.slotIds.length) {
    throw new Error('Slot counts do not match slot IDs array length');
  }
}

/**
 * Validate reconciliation case
 */
export function validateReconciliationCase(rc: ReconciliationCase): void {
  if (!rc.caseId || rc.caseId.trim() === '') {
    throw new Error('Case ID is required');
  }
  if (!rc.slotId || rc.slotId.trim() === '') {
    throw new Error('Slot ID is required');
  }
  if (!rc.batchId || rc.batchId.trim() === '') {
    throw new Error('Batch ID is required');
  }
  if (!rc.createdAt) {
    throw new Error('Created timestamp is required');
  }

  const created = new Date(rc.createdAt).getTime();
  if (isNaN(created)) {
    throw new Error('Invalid created timestamp format');
  }
}

/**
 * Build execution slot
 */
export function buildExecutionSlot(params: {
  slotId: string;
  grantId: string;
  decisionId: string;
  batchId: string;
  intent: ExecutionIntent;
  expectedBefore: string;
  expectedAfter: string;
  expectedChangePercent?: number;
}): ExecutionSlot {
  const now = new Date().toISOString();
  return {
    slotId: params.slotId,
    grantId: params.grantId,
    decisionId: params.decisionId,
    batchId: params.batchId,
    intent: params.intent,
    status: 'pending',
    expectedBefore: params.expectedBefore,
    expectedAfter: params.expectedAfter,
    expectedChangePercent: params.expectedChangePercent,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Build execution batch
 */
export function buildExecutionBatch(params: {
  batchId: string;
  grantId: string;
  missionId: string;
  storeId: string;
  slotIds: string[];
}): ExecutionBatch {
  const now = new Date().toISOString();
  return {
    batchId: params.batchId,
    grantId: params.grantId,
    missionId: params.missionId,
    storeId: params.storeId,
    slotIds: params.slotIds,
    status: 'running',
    pendingCount: params.slotIds.length,
    submittedCount: 0,
    verifiedCount: 0,
    failedCount: 0,
    unknownCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Build reconciliation case
 */
export function buildReconciliationCase(params: {
  caseId: string;
  slotId: string;
  batchId: string;
}): ReconciliationCase {
  const now = new Date().toISOString();
  return {
    caseId: params.caseId,
    slotId: params.slotId,
    batchId: params.batchId,
    createdAt: now,
  };
}

/**
 * Check if preflight gates pass
 */
export function checkPreflightGates(params: {
  killSwitch: boolean;
  circuitBreakerTriggered: boolean;
  contextMatches: boolean;
  revisionMatches: boolean;
  grantValid: boolean;
  scopeMatches: boolean;
  evidencePresent: boolean;
}): PreflightGateResult {
  const blockedGates: PreflightGate[] = [];

  if (params.killSwitch) blockedGates.push('P0_KILL_SWITCH');
  if (params.circuitBreakerTriggered) blockedGates.push('P1_CIRCUIT_BREAKER');
  if (!params.contextMatches) blockedGates.push('P2_CONTEXT_MISMATCH');
  if (!params.revisionMatches) blockedGates.push('P3_REVISION_MISMATCH');
  if (!params.grantValid) blockedGates.push('P4_GRANT_INVALID');
  if (!params.scopeMatches) blockedGates.push('P5_SCOPE_MISMATCH');
  if (!params.evidencePresent) blockedGates.push('P6_EVIDENCE_REQUIRED');

  const passed = blockedGates.length === 0;
  const message = passed
    ? '所有预检门禁通过'
    : `预检阻断: ${blockedGates.map((g) => PREFLIGHT_GATE_LABELS[g]).join(', ')}`;

  return {
    passed,
    blockedGates,
    message,
  };
}

// ============================================================================
// V1.6 Execution Record Types
// ============================================================================

/**
 * V1.6 Execution status
 */
export type ExecutionStatus =
  | 'reserved'      // Grant slot reserved
  | 'submitted'     // Action submitted to Ads
  | 'verified'      // Readback verified
  | 'failed';       // Execution failed

/**
 * V1.6 Execution evidence
 */
export interface ExecutionEvidence {
  readonly screenshotPaths?: string[];
  readonly timestamp?: string;
  readonly readbackValues?: Record<string, string>;
  readonly notes?: string;
}

/**
 * V1.6 Execution record
 */
export interface ExecutionRecord {
  readonly executionId: string;
  readonly storeId: string;
  readonly grantId: string;
  readonly slotIndex: number;

  // Entity details
  readonly entityId: string;
  readonly entityType: 'campaign' | 'ad_group' | 'keyword' | 'product_targeting';
  readonly actionType: string;
  readonly actionPayload: Record<string, unknown>;

  // Session binding
  readonly sessionGeneration: number;
  readonly adsAccountId: string;

  // Status
  readonly status: ExecutionStatus;
  readonly revision: number;

  // Execution lifecycle
  readonly submittedBy?: string;
  readonly submittedAt?: string;
  readonly beforeEvidence?: ExecutionEvidence;

  readonly verifiedBy?: string;
  readonly verifiedAt?: string;
  readonly afterEvidence?: ExecutionEvidence;

  readonly failureReason?: string;

  // Timestamps
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Validate V1.6 execution record
 */
export function validateExecutionRecord(record: ExecutionRecord): void {
  if (!record.executionId || record.executionId.trim() === '') {
    throw new Error('Execution ID is required');
  }
  if (!record.storeId || record.storeId.trim() === '') {
    throw new Error('Store ID is required');
  }
  if (!record.grantId || record.grantId.trim() === '') {
    throw new Error('Grant ID is required');
  }
  if (typeof record.slotIndex !== 'number' || record.slotIndex < 0) {
    throw new Error('Slot index must be non-negative number');
  }
  if (!record.entityId || record.entityId.trim() === '') {
    throw new Error('Entity ID is required');
  }
  if (!['campaign', 'ad_group', 'keyword', 'product_targeting'].includes(record.entityType)) {
    throw new Error('Invalid entity type');
  }
  if (!record.actionType || record.actionType.trim() === '') {
    throw new Error('Action type is required');
  }
  if (typeof record.sessionGeneration !== 'number' || record.sessionGeneration < 0) {
    throw new Error('Session generation must be non-negative number');
  }
  if (!record.adsAccountId || record.adsAccountId.trim() === '') {
    throw new Error('Ads account ID is required');
  }
  if (!['reserved', 'submitted', 'verified', 'failed'].includes(record.status)) {
    throw new Error('Invalid execution status');
  }
  if (typeof record.revision !== 'number' || record.revision < 1) {
    throw new Error('Revision must be positive number');
  }
  if (!record.createdAt || !record.updatedAt) {
    throw new Error('Timestamps are required');
  }

  // Status-specific validations
  if (record.status === 'submitted' || record.status === 'verified') {
    if (!record.submittedBy || !record.submittedAt) {
      throw new Error('Submitted executions must have submittedBy and submittedAt');
    }
  }
  if (record.status === 'verified') {
    if (!record.verifiedBy || !record.verifiedAt) {
      throw new Error('Verified executions must have verifiedBy and verifiedAt');
    }
  }

  // Timestamp ordering
  try {
    const created = new Date(record.createdAt).getTime();
    const updated = new Date(record.updatedAt).getTime();
    if (isNaN(created) || isNaN(updated)) {
      throw new Error('Invalid timestamp format');
    }
    if (created > updated) {
      throw new Error('createdAt cannot be after updatedAt');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Invalid timestamp')) {
      throw err;
    }
    if (err instanceof Error && err.message.includes('createdAt cannot be after')) {
      throw err;
    }
    throw new Error('Invalid timestamp format');
  }
}
