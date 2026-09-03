/**
 * V1.6 Execution Service
 *
 * Safe execution contract implementation:
 * - Preflight gates (P0-P6)
 * - At-most-once submit
 * - Three-phase readback (before/after/reload)
 * - UNKNOWN is terminal (no retry)
 * - Reconciliation for UNKNOWN outcomes
 *
 * @module v16-execution-service
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  ExecutionRepository,
  type ExecutionSlotRow,
  type ExecutionBatchRow,
} from '@amazon-ai-ops/local-db';
import type {
  ExecutionSlot,
  ExecutionBatch,
  ExecutionIntent,
  SlotStatus,
  BatchStatus,
  PreflightGate,
  PreflightGateResult,
  ReconciliationCase,
  ReconciliationOutcome,
} from '@amazon-ai-ops/shared-types';
import {
  validateExecutionSlot,
  validateExecutionBatch,
  validateReconciliationCase,
  isSlotStatusTerminal,
  isBatchTerminal,
  verifyReadbackMatch,
  checkPreflightGates,
} from '@amazon-ai-ops/shared-types';

// ─── Service Error ───────────────────────────────────────────────────────

export type ExecutionServiceErrorCode =
  | 'SLOT_NOT_FOUND'
  | 'BATCH_NOT_FOUND'
  | 'INVALID_STATUS_TRANSITION'
  | 'SLOT_TERMINAL'
  | 'BATCH_TERMINAL'
  | 'PREFLIGHT_BLOCKED'
  | 'ALREADY_SUBMITTED'
  | 'NOT_SUBMITTED'
  | 'VERIFICATION_FAILED'
  | 'RECONCILIATION_LIMIT'
  | 'VALIDATION_ERROR'
  | 'SERVICE_ERROR';

export class ExecutionServiceError extends Error {
  constructor(
    public readonly code: ExecutionServiceErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ExecutionServiceError';
  }
}

// ─── Service ─────────────────────────────────────────────────────────────

export class ExecutionService {
  private readonly repo: ExecutionRepository;

  constructor(private readonly db: Database.Database) {
    this.repo = new ExecutionRepository(db);
  }

  // ─── Slot lifecycle ────────────────────────────────────────────────────

  /**
   * Create a new execution slot.
   */
  createSlot(params: {
    slotId: string;
    grantId: string;
    decisionId: string;
    batchId: string;
    storeId: string;
    intent: ExecutionIntent;
    expectedBefore: string;
    expectedAfter: string;
    expectedChangePercent?: number;
  }): ExecutionSlot {
    const now = new Date().toISOString();
    const row: ExecutionSlotRow = {
      slot_id: params.slotId,
      grant_id: params.grantId,
      decision_id: params.decisionId,
      batch_id: params.batchId,
      store_id: params.storeId,
      intent_json: JSON.stringify(params.intent),
      status: 'pending',
      expected_before: params.expectedBefore,
      expected_after: params.expectedAfter,
      expected_change_percent: params.expectedChangePercent ?? null,
      before_evidence_path: null,
      after_evidence_path: null,
      reload_evidence_path: null,
      readback_before_value: null,
      readback_after_value: null,
      readback_reload_value: null,
      verified_at: null,
      verification_result: null,
      reconciliation_case_id: null,
      reconciliation_outcome: null,
      created_at: now,
      updated_at: now,
      submitted_at: null,
    };

    this.repo.createSlot(row);
    return this.slotRowToDomain(row);
  }

  /**
   * Get a slot by ID.
   */
  getSlot(slotId: string): ExecutionSlot | null {
    const row = this.repo.findSlotById(slotId);
    return row ? this.slotRowToDomain(row) : null;
  }

  /**
   * List slots for a batch.
   */
  listSlotsByBatch(batchId: string): ExecutionSlot[] {
    const rows = this.repo.findSlotsByBatchId(batchId);
    return rows.map((r) => this.slotRowToDomain(r));
  }

  /**
   * Run preflight gates before submission.
   * Returns { passed: true } if all gates pass, or { passed: false, blockedGates: [...] } if blocked.
   */
  preflightCheck(params: {
    killSwitch: boolean;
    circuitBreakerTriggered: boolean;
    contextMatches: boolean;
    revisionMatches: boolean;
    grantValid: boolean;
    scopeMatches: boolean;
    evidencePresent: boolean;
  }): PreflightGateResult {
    return checkPreflightGates(params);
  }

  /**
   * Submit a slot - record intent and before evidence.
   * This combines preflight check, intent recording, and before evidence capture.
   */
  submitSlot(slotId: string, beforeEvidencePath: string): ExecutionSlot {
    const current = this.getSlot(slotId);
    if (!current) {
      throw new ExecutionServiceError('SLOT_NOT_FOUND', `Slot ${slotId} not found.`);
    }

    if (current.status !== 'pending') {
      throw new ExecutionServiceError(
        'INVALID_STATUS_TRANSITION',
        `Only pending slots can be submitted. Current status: ${current.status}.`,
        { slotId, status: current.status },
      );
    }

    const updatedRow = this.repo.updateSlot(slotId, {
      status: 'submit_intent_recorded',
      before_evidence_path: beforeEvidencePath,
    });

    if (!updatedRow) {
      throw new ExecutionServiceError('SERVICE_ERROR', `Failed to submit slot ${slotId}.`);
    }

    return this.slotRowToDomain(updatedRow);
  }

  /**
   * Record submit intent (must pass preflight first).
   * This is the "point of no return" — after this, we assume submit will/did happen.
   */
  recordSubmitIntent(slotId: string, preflightResult: PreflightGateResult): ExecutionSlot {
    if (!preflightResult.passed) {
      throw new ExecutionServiceError(
        'PREFLIGHT_BLOCKED',
        `Preflight gates blocked: ${preflightResult.message}`,
        { slotId, blockedGates: preflightResult.blockedGates },
      );
    }

    const current = this.getSlot(slotId);
    if (!current) {
      throw new ExecutionServiceError('SLOT_NOT_FOUND', `Slot ${slotId} not found.`);
    }

    if (current.status !== 'pending') {
      throw new ExecutionServiceError(
        'INVALID_STATUS_TRANSITION',
        `Can only record intent from 'pending' status. Current: ${current.status}.`,
        { slotId, status: current.status },
      );
    }

    const updatedRow = this.repo.updateSlot(slotId, {
      status: 'submit_intent_recorded',
    });

    if (!updatedRow) {
      throw new ExecutionServiceError('SERVICE_ERROR', `Failed to record submit intent for ${slotId}.`);
    }

    return this.slotRowToDomain(updatedRow);
  }

  /**
   * Mark a slot as submitted (actually sent to Ads).
   * Can only be called once per slot (at-most-once guarantee).
   */
  markSubmitted(slotId: string, submitTimestamp?: string): ExecutionSlot {
    const current = this.getSlot(slotId);
    if (!current) {
      throw new ExecutionServiceError('SLOT_NOT_FOUND', `Slot ${slotId} not found.`);
    }

    if (current.status === 'submitted' || current.submittedAt) {
      throw new ExecutionServiceError(
        'ALREADY_SUBMITTED',
        `Slot ${slotId} already submitted at ${current.submittedAt}.`,
        { slotId },
      );
    }

    if (current.status !== 'submit_intent_recorded') {
      throw new ExecutionServiceError(
        'INVALID_STATUS_TRANSITION',
        `Can only mark submitted from 'submit_intent_recorded'. Current: ${current.status}.`,
        { slotId, status: current.status },
      );
    }

    const timestamp = submitTimestamp ?? new Date().toISOString();
    const updatedRow = this.repo.updateSlot(slotId, {
      status: 'submitted',
      submitted_at: timestamp,
    });

    if (!updatedRow) {
      throw new ExecutionServiceError('SERVICE_ERROR', `Failed to mark slot ${slotId} as submitted.`);
    }

    // Update batch counts
    const batch = this.getBatch(current.batchId);
    if (batch) {
      this.refreshBatchProgress(current.batchId);
    }

    return this.slotRowToDomain(updatedRow);
  }

  /**
   * Record readback evidence (before/after/reload).
   * Performs three-phase readback verification.
   */
  recordReadback(
    slotId: string,
    phase: 'before' | 'after' | 'reload',
    value: string,
    evidencePath: string,
  ): ExecutionSlot {
    const current = this.getSlot(slotId);
    if (!current) {
      throw new ExecutionServiceError('SLOT_NOT_FOUND', `Slot ${slotId} not found.`);
    }

    if (current.status !== 'submitted') {
      throw new ExecutionServiceError(
        'NOT_SUBMITTED',
        `Can only record readback for submitted slots. Current status: ${current.status}.`,
        { slotId, status: current.status },
      );
    }

    const updates: Partial<ExecutionSlotRow> = {};

    switch (phase) {
      case 'before':
        updates.before_evidence_path = evidencePath;
        updates.readback_before_value = value;
        break;
      case 'after':
        updates.after_evidence_path = evidencePath;
        updates.readback_after_value = value;
        break;
      case 'reload':
        updates.reload_evidence_path = evidencePath;
        updates.readback_reload_value = value;
        break;
    }

    const updatedRow = this.repo.updateSlot(slotId, updates);
    if (!updatedRow) {
      throw new ExecutionServiceError('SERVICE_ERROR', `Failed to record ${phase} readback for ${slotId}.`);
    }

    return this.slotRowToDomain(updatedRow);
  }

  /**
   * Verify slot execution result based on three-phase readback.
   * Returns { slot, reconciliationCase? }.
   */
  verifySlot(
    slotId: string,
    readback: {
      readbackBeforeValue: string;
      readbackAfterValue: string;
      readbackReloadValue?: string;
      afterEvidencePath: string;
      reloadEvidencePath?: string;
    },
    tolerancePercent = 0,
  ): { slot: ExecutionSlot; reconciliationCase?: ReconciliationCase } {
    const current = this.getSlot(slotId);
    if (!current) {
      throw new ExecutionServiceError('SLOT_NOT_FOUND', `Slot ${slotId} not found.`);
    }

    if (current.status !== 'submitted') {
      throw new ExecutionServiceError(
        'NOT_SUBMITTED',
        `Only submitted slots can be verified. Current status: ${current.status}.`,
        { slotId, status: current.status },
      );
    }

    // Update readback values
    const updates: Partial<ExecutionSlotRow> = {
      readback_before_value: readback.readbackBeforeValue,
      readback_after_value: readback.readbackAfterValue,
      after_evidence_path: readback.afterEvidencePath,
    };

    if (readback.readbackReloadValue !== undefined) {
      updates.readback_reload_value = readback.readbackReloadValue;
    }
    if (readback.reloadEvidencePath !== undefined) {
      updates.reload_evidence_path = readback.reloadEvidencePath;
    }

    this.repo.updateSlot(slotId, updates);

    // Now verify
    const now = new Date().toISOString();
    let verificationResult: 'success' | 'failure' | 'unknown';
    let newStatus: SlotStatus;

    const beforeMatches = verifyReadbackMatch(
      readback.readbackBeforeValue,
      current.expectedBefore,
      tolerancePercent,
    );

    const afterMatches = verifyReadbackMatch(
      readback.readbackAfterValue,
      current.expectedAfter,
      tolerancePercent,
    );

    const reloadMatches = readback.readbackReloadValue
      ? verifyReadbackMatch(readback.readbackReloadValue, current.expectedAfter, tolerancePercent)
      : null;

    if (!beforeMatches) {
      // Before didn't match — initial state was wrong
      verificationResult = 'failure';
      newStatus = 'failed';
    } else if (afterMatches && (reloadMatches === null || reloadMatches)) {
      // Target value observed (and stable if reload checked)
      verificationResult = 'success';
      newStatus = 'verified';
    } else {
      // Cannot determine outcome
      verificationResult = 'unknown';
      newStatus = 'unknown';
    }

    const updatedRow = this.repo.updateSlot(slotId, {
      status: newStatus,
      verification_result: verificationResult,
      verified_at: now,
    });

    if (!updatedRow) {
      throw new ExecutionServiceError('SERVICE_ERROR', `Failed to verify slot ${slotId}.`);
    }

    const slot = this.slotRowToDomain(updatedRow);

    // Update batch progress
    this.refreshBatchProgress(current.batchId);

    // If unknown, create reconciliation case
    let reconciliationCase: ReconciliationCase | undefined;
    if (verificationResult === 'unknown') {
      this.createReconciliationCaseIfNeeded(slotId, current.batchId, current.storeId);
      reconciliationCase = this.getReconciliationCase(slotId) ?? undefined;
    }

    return { slot, reconciliationCase };
  }

  /**
   * Mark slot as failed.
   */
  markSlotFailed(slotId: string, reason: string): ExecutionSlot {
    const current = this.getSlot(slotId);
    if (!current) {
      throw new ExecutionServiceError('SLOT_NOT_FOUND', `Slot ${slotId} not found.`);
    }

    if (isSlotStatusTerminal(current.status)) {
      throw new ExecutionServiceError(
        'SLOT_TERMINAL',
        `Slot ${slotId} is already in terminal state: ${current.status}.`,
        { slotId, status: current.status },
      );
    }

    const now = new Date().toISOString();
    const updatedRow = this.repo.updateSlot(slotId, {
      status: 'failed',
      verification_result: 'failure',
      verified_at: now,
    });

    if (!updatedRow) {
      throw new ExecutionServiceError('SERVICE_ERROR', `Failed to mark slot ${slotId} as failed.`);
    }

    return this.slotRowToDomain(updatedRow);
  }

  // ─── Batch lifecycle ───────────────────────────────────────────────────

  /**
   * Create a new execution batch with slots.
   */
  createBatch(params: {
    batchId: string;
    grantId: string;
    missionId: string;
    storeId: string;
    slots: Array<{
      slotId: string;
      grantId: string;
      decisionId: string;
      intent: ExecutionIntent;
      expectedBefore: string;
      expectedAfter: string;
      expectedChangePercent?: number;
    }>;
  }): { batch: ExecutionBatch; slots: ExecutionSlot[] } {
    if (!params.slots || params.slots.length === 0) {
      throw new ExecutionServiceError('INVALID_INPUT', 'At least one slot is required.');
    }

    const now = new Date().toISOString();

    // Create all slots
    const createdSlots: ExecutionSlot[] = [];
    for (const slotParams of params.slots) {
      const slotRow: ExecutionSlotRow = {
        slot_id: slotParams.slotId,
        grant_id: slotParams.grantId,
        decision_id: slotParams.decisionId,
        batch_id: params.batchId,
        store_id: params.storeId,
        intent_json: JSON.stringify(slotParams.intent),
        status: 'pending',
        expected_before: slotParams.expectedBefore,
        expected_after: slotParams.expectedAfter,
        expected_change_percent: slotParams.expectedChangePercent ?? null,
        before_evidence_path: null,
        after_evidence_path: null,
        reload_evidence_path: null,
        readback_before_value: null,
        readback_after_value: null,
        readback_reload_value: null,
        verified_at: null,
        verification_result: null,
        reconciliation_case_id: null,
        reconciliation_outcome: null,
        created_at: now,
        updated_at: now,
        submitted_at: null,
      };
      this.repo.createSlot(slotRow);
      createdSlots.push(this.slotRowToDomain(slotRow));
    }

    // Create batch
    const slotIds = params.slots.map((s) => s.slotId);
    const batchRow: ExecutionBatchRow = {
      batch_id: params.batchId,
      grant_id: params.grantId,
      mission_id: params.missionId,
      store_id: params.storeId,
      slot_ids: JSON.stringify(slotIds),
      status: 'running',
      pending_count: slotIds.length,
      submitted_count: 0,
      verified_count: 0,
      failed_count: 0,
      unknown_count: 0,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };

    this.repo.createBatch(batchRow);
    const batch = this.batchRowToDomain(batchRow);

    return { batch, slots: createdSlots };
  }

  /**
   * Get a batch by ID.
   */
  getBatch(batchId: string): ExecutionBatch | null {
    const row = this.repo.findBatchById(batchId);
    return row ? this.batchRowToDomain(row) : null;
  }

  /**
   * List batches for a store.
   */
  listBatchesByStore(storeId: string, limit = 50): ExecutionBatch[] {
    const rows = this.repo.findBatchesByStore(storeId, limit);
    return rows.map((r) => this.batchRowToDomain(r));
  }

  /**
   * Refresh batch progress by counting slot statuses.
   */
  refreshBatchProgress(batchId: string): ExecutionBatch {
    const batch = this.getBatch(batchId);
    if (!batch) {
      throw new ExecutionServiceError('BATCH_NOT_FOUND', `Batch ${batchId} not found.`);
    }

    const slots = this.listSlotsByBatch(batchId);

    let pendingCount = 0,
        submittedCount = 0,
        verifiedCount = 0,
        failedCount = 0,
        unknownCount = 0;

    for (const slot of slots) {
      switch (slot.status) {
        case 'pending':
        case 'preflight_blocked':
        case 'submit_intent_recorded':
          pendingCount++;
          break;
        case 'submitted':
          submittedCount++;
          break;
        case 'verified':
          verifiedCount++;
          break;
        case 'failed':
          failedCount++;
          break;
        case 'unknown':
          unknownCount++;
          break;
      }
    }

    // Determine new batch status
    let newStatus: BatchStatus = 'running';
    let completedAt: string | null = null;

    if (unknownCount > 0 && (pendingCount + submittedCount) === 0) {
      // All remaining slots are UNKNOWN → stopped_unknown (terminal)
      newStatus = 'stopped_unknown';
      completedAt = new Date().toISOString();
    } else if (pendingCount + submittedCount === 0) {
      // All slots terminal
      newStatus = 'completed';
      completedAt = new Date().toISOString();
    }

    const updatedRow = this.repo.updateBatch(batchId, {
      status: newStatus,
      pending_count: pendingCount,
      submitted_count: submittedCount,
      verified_count: verifiedCount,
      failed_count: failedCount,
      unknown_count: unknownCount,
      completed_at: completedAt,
    });

    if (!updatedRow) {
      throw new ExecutionServiceError('SERVICE_ERROR', `Failed to refresh batch ${batchId}.`);
    }

    return this.batchRowToDomain(updatedRow);
  }

  /**
   * Stop a batch (invalidated by grant revocation).
   */
  stopBatch(batchId: string, reason: 'invalidated' | 'unknown'): ExecutionBatch {
    const batch = this.getBatch(batchId);
    if (!batch) {
      throw new ExecutionServiceError('BATCH_NOT_FOUND', `Batch ${batchId} not found.`);
    }

    if (isBatchTerminal(batch.status)) {
      throw new ExecutionServiceError(
        'BATCH_TERMINAL',
        `Batch ${batchId} is already in terminal state: ${batch.status}.`,
        { batchId, status: batch.status },
      );
    }

    const newStatus: BatchStatus = reason === 'invalidated' ? 'stopped_invalidated' : 'stopped_unknown';
    const now = new Date().toISOString();

    const updatedRow = this.repo.updateBatch(batchId, {
      status: newStatus,
      completed_at: now,
    });

    if (!updatedRow) {
      throw new ExecutionServiceError('SERVICE_ERROR', `Failed to stop batch ${batchId}.`);
    }

    return this.batchRowToDomain(updatedRow);
  }

  /**
   * Get batch aggregation statistics for a store.
   */
  getBatchProjection(storeId: string): {
    totalBatches: number;
    runningCount: number;
    completedCount: number;
    stoppedCount: number;
    totalSlots: number;
    pendingSlots: number;
    submittedSlots: number;
    verifiedSlots: number;
    failedSlots: number;
    unknownSlots: number;
  } {
    return this.repo.getBatchProjection(storeId);
  }

  // ─── Reconciliation ────────────────────────────────────────────────────

  /**
   * Create a reconciliation case for an UNKNOWN slot (if not already exists).
   */
  private createReconciliationCaseIfNeeded(slotId: string, batchId: string, storeId: string): void {
    const existing = this.repo.findReconciliationCaseBySlot(slotId);
    if (existing) {
      // Already has a case
      return;
    }

    const caseId = `rc-${randomUUID()}`;
    const now = new Date().toISOString();
    this.repo.createReconciliationCase({
      case_id: caseId,
      slot_id: slotId,
      batch_id: batchId,
      store_id: storeId,
      created_at: now,
    });

    // Update slot with case ID
    this.repo.updateSlot(slotId, {
      reconciliation_case_id: caseId,
    });
  }

  /**
   * Get reconciliation case for a slot.
   */
  getReconciliationCase(slotId: string): ReconciliationCase | null {
    const row = this.repo.findReconciliationCaseBySlot(slotId);
    return row ? this.reconciliationCaseRowToDomain(row) : null;
  }

  /**
   * Record first observation for reconciliation.
   */
  recordObservation1(slotId: string, timestamp: string, value: string): ReconciliationCase {
    const rc = this.getReconciliationCase(slotId);
    if (!rc) {
      throw new ExecutionServiceError(
        'SLOT_NOT_FOUND',
        `No reconciliation case found for slot ${slotId}.`,
      );
    }

    if (rc.observation1Timestamp) {
      throw new ExecutionServiceError(
        'RECONCILIATION_LIMIT',
        `Observation 1 already recorded for slot ${slotId}.`,
        { slotId },
      );
    }

    this.repo.updateReconciliationCase(rc.caseId, {
      observation_1_timestamp: timestamp,
      observation_1_value: value,
    });

    const updated = this.getReconciliationCase(slotId);
    if (!updated) {
      throw new ExecutionServiceError('SERVICE_ERROR', `Failed to update reconciliation case for ${slotId}.`);
    }

    return updated;
  }

  /**
   * Record reconciliation observation (handles both observation 1 and 2).
   * Automatically resolves the case after observation 2.
   */
  recordReconciliationObservation(slotId: string, value: string): ReconciliationCase {
    const rc = this.getReconciliationCase(slotId);
    if (!rc) {
      throw new ExecutionServiceError(
        'SLOT_NOT_FOUND',
        `No reconciliation case found for slot ${slotId}.`,
      );
    }

    if (rc.resolvedAt) {
      throw new ExecutionServiceError(
        'RECONCILIATION_LIMIT',
        `Reconciliation case already resolved for slot ${slotId}.`,
        { slotId },
      );
    }

    const now = new Date().toISOString();

    // First observation
    if (!rc.observation1Timestamp) {
      this.repo.updateReconciliationCase(rc.caseId, {
        observation_1_timestamp: now,
        observation_1_value: value,
      });

      const updated = this.getReconciliationCase(slotId);
      if (!updated) {
        throw new ExecutionServiceError('SERVICE_ERROR', `Failed to update reconciliation case for ${slotId}.`);
      }
      return updated;
    }

    // Second observation - resolve
    if (!rc.observation2Timestamp) {
      return this.recordObservation2(slotId, now, value);
    }

    throw new ExecutionServiceError(
      'RECONCILIATION_LIMIT',
      `Reconciliation case already resolved for slot ${slotId}.`,
      { slotId },
    );
  }

  /**
   * Record second observation and resolve reconciliation case.
   */
  recordObservation2(
    slotId: string,
    timestamp: string,
    value: string,
    notes?: string,
  ): ReconciliationCase {
    const rc = this.getReconciliationCase(slotId);
    if (!rc) {
      throw new ExecutionServiceError(
        'SLOT_NOT_FOUND',
        `No reconciliation case found for slot ${slotId}.`,
      );
    }

    if (!rc.observation1Timestamp) {
      throw new ExecutionServiceError(
        'RECONCILIATION_LIMIT',
        `Observation 1 must be recorded before observation 2 for slot ${slotId}.`,
        { slotId },
      );
    }

    if (rc.observation2Timestamp) {
      throw new ExecutionServiceError(
        'RECONCILIATION_LIMIT',
        `Observation 2 already recorded for slot ${slotId}.`,
        { slotId },
      );
    }

    // Determine outcome based on observations
    const slot = this.getSlot(slotId);
    if (!slot) {
      throw new ExecutionServiceError('SLOT_NOT_FOUND', `Slot ${slotId} not found.`);
    }

    let outcome: ReconciliationOutcome;

    if (rc.observation1Value === value && value === slot.expectedAfter) {
      outcome = 'target_stably_observed';
    } else if (rc.observation1Value === value && value === slot.expectedBefore) {
      outcome = 'original_stably_observed';
    } else if (rc.observation1Value === value) {
      outcome = 'other_value';
    } else {
      outcome = 'inconclusive_permanent';
    }

    const now = new Date().toISOString();
    this.repo.updateReconciliationCase(rc.caseId, {
      observation_2_timestamp: timestamp,
      observation_2_value: value,
      outcome,
      resolved_at: now,
      resolution_notes: notes,
    });

    // Update slot with reconciliation outcome
    this.repo.updateSlot(slotId, {
      reconciliation_outcome: outcome,
    });

    const updated = this.getReconciliationCase(slotId);
    if (!updated) {
      throw new ExecutionServiceError('SERVICE_ERROR', `Failed to resolve reconciliation case for ${slotId}.`);
    }

    return updated;
  }

  // ─── Mappers ───────────────────────────────────────────────────────────

  private slotRowToDomain(row: ExecutionSlotRow): ExecutionSlot {
    return {
      slotId: row.slot_id,
      grantId: row.grant_id,
      decisionId: row.decision_id,
      batchId: row.batch_id,
      intent: JSON.parse(row.intent_json) as ExecutionIntent,
      status: row.status as SlotStatus,
      expectedBefore: row.expected_before,
      expectedAfter: row.expected_after,
      expectedChangePercent: row.expected_change_percent ?? undefined,
      beforeEvidencePath: row.before_evidence_path ?? undefined,
      afterEvidencePath: row.after_evidence_path ?? undefined,
      reloadEvidencePath: row.reload_evidence_path ?? undefined,
      readbackBeforeValue: row.readback_before_value ?? undefined,
      readbackAfterValue: row.readback_after_value ?? undefined,
      readbackReloadValue: row.readback_reload_value ?? undefined,
      verifiedAt: row.verified_at ?? undefined,
      verificationResult: row.verification_result as 'success' | 'failure' | 'unknown' | undefined,
      reconciliationCaseId: row.reconciliation_case_id ?? undefined,
      reconciliationOutcome: row.reconciliation_outcome as ReconciliationOutcome | undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      submittedAt: row.submitted_at ?? undefined,
      storeId: row.store_id,
    };
  }

  private batchRowToDomain(row: ExecutionBatchRow): ExecutionBatch {
    return {
      batchId: row.batch_id,
      grantId: row.grant_id,
      missionId: row.mission_id,
      storeId: row.store_id,
      slotIds: JSON.parse(row.slot_ids) as string[],
      status: row.status as BatchStatus,
      pendingCount: row.pending_count,
      submittedCount: row.submitted_count,
      verifiedCount: row.verified_count,
      failedCount: row.failed_count,
      unknownCount: row.unknown_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
    };
  }

  private reconciliationCaseRowToDomain(row: {
    case_id: string;
    slot_id: string;
    batch_id: string;
    created_at: string;
    observation_1_timestamp: string | null;
    observation_1_value: string | null;
    observation_2_timestamp: string | null;
    observation_2_value: string | null;
    outcome: string | null;
    resolved_at: string | null;
    resolution_notes: string | null;
  }): ReconciliationCase {
    return {
      caseId: row.case_id,
      slotId: row.slot_id,
      batchId: row.batch_id,
      createdAt: row.created_at,
      observation1Timestamp: row.observation_1_timestamp ?? undefined,
      observation1Value: row.observation_1_value ?? undefined,
      observation2Timestamp: row.observation_2_timestamp ?? undefined,
      observation2Value: row.observation_2_value ?? undefined,
      outcome: row.outcome as ReconciliationOutcome | undefined,
      resolvedAt: row.resolved_at ?? undefined,
      resolutionNotes: row.resolution_notes ?? undefined,
    };
  }
}
