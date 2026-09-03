/**
 * V1.6 Decision Service
 *
 * Business logic layer for Decision domain.
 * Handles approval/rejection, supersession, status transitions with validation.
 *
 * @module v16-decision-service
 */

import type { Database } from 'better-sqlite3';
import {
  type DecisionRecord,
  type CreateDecisionInput,
  type DecisionStatus,
  validateCreateDecisionInput,
  validateDecisionRecord,
  isValidStatusTransition,
  buildDecisionRecord,
  buildHistoryEntry,
  decisionRowToRecord,
  decisionRecordToRow,
  isDecisionTerminal,
} from '@amazon-ai-ops/shared-types';
import { DecisionRepository } from '@amazon-ai-ops/local-db';
import { randomUUID } from 'node:crypto';

// ─── Error handling ──────────────────────────────────────────────────────

export class DecisionServiceError extends Error {
  constructor(
    public readonly code: DecisionErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DecisionServiceError';
  }
}

export type DecisionErrorCode =
  | 'DECISION_NOT_FOUND'
  | 'INVALID_STATUS_TRANSITION'
  | 'DECISION_TERMINAL'
  | 'STORE_MISMATCH'
  | 'REVISION_CONFLICT'
  | 'MISSING_REASON'
  | 'ALREADY_SUPERSEDED'
  | 'VALIDATION_ERROR'
  | 'SERVICE_ERROR';

// ─── Service ─────────────────────────────────────────────────────────────

export class DecisionService {
  private readonly repo: DecisionRepository;

  constructor(private readonly db: Database) {
    this.repo = new DecisionRepository(db);
  }

  /**
   * Create a new decision from recommendation output.
   */
  createDecision(input: CreateDecisionInput): DecisionRecord {
    try {
      validateCreateDecisionInput(input);
    } catch (error) {
      throw new DecisionServiceError(
        'VALIDATION_ERROR',
        `Invalid decision input: ${errorMessage(error)}`,
        { input },
      );
    }

    const decisionId = `dec-${randomUUID()}`;
    const now = new Date().toISOString();

    const record = buildDecisionRecord(input, decisionId, now);
    validateDecisionRecord(record);

    const row = decisionRecordToRow(record);
    this.repo.create(row);

    return record;
  }

  /**
   * Get a decision by ID.
   */
  getDecision(decisionId: string): DecisionRecord | null {
    const row = this.repo.findById(decisionId);
    return row ? decisionRowToRecord(row) : null;
  }

  /**
   * List decisions for a store.
   */
  listDecisions(storeId: string, limit = 50): DecisionRecord[] {
    const rows = this.repo.findByStoreId(storeId, limit);
    return rows.map(decisionRowToRecord);
  }

  /**
   * List decisions by status.
   */
  listByStatus(storeId: string, status: DecisionStatus): DecisionRecord[] {
    const rows = this.repo.findByStatus(storeId, status);
    return rows.map(decisionRowToRecord);
  }

  /**
   * List decisions for an analysis run.
   */
  listByAnalysisRun(analysisRunId: string): DecisionRecord[] {
    const rows = this.repo.findByAnalysisRunId(analysisRunId);
    return rows.map(decisionRowToRecord);
  }

  /**
   * List decisions for a mission.
   */
  listByMission(missionId: string): DecisionRecord[] {
    const rows = this.repo.findByMissionId(missionId);
    return rows.map(decisionRowToRecord);
  }

  /**
   * Approve a decision.
   * Requires non-empty reason and expected revision for optimistic concurrency.
   */
  approveDecision(
    decisionId: string,
    approvedBy: string,
    reason: string,
    expectedRevision: number,
  ): DecisionRecord {
    if (!reason.trim()) {
      throw new DecisionServiceError(
        'MISSING_REASON',
        'Approval reason is required.',
        { decisionId, approvedBy },
      );
    }

    const current = this.getDecision(decisionId);
    if (!current) {
      throw new DecisionServiceError('DECISION_NOT_FOUND', `Decision ${decisionId} not found.`);
    }

    if (current.revision !== expectedRevision) {
      throw new DecisionServiceError(
        'REVISION_CONFLICT',
        `Decision revision mismatch: expected ${expectedRevision}, got ${current.revision}.`,
        { decisionId, expectedRevision, actualRevision: current.revision },
      );
    }

    if (isDecisionTerminal(current)) {
      throw new DecisionServiceError(
        'DECISION_TERMINAL',
        `Decision ${decisionId} is already in terminal state: ${current.status}.`,
        { decisionId, status: current.status },
      );
    }

    if (!isValidStatusTransition(current.status, 'approved')) {
      throw new DecisionServiceError(
        'INVALID_STATUS_TRANSITION',
        `Cannot approve decision from status: ${current.status}.`,
        { decisionId, fromStatus: current.status },
      );
    }

    const now = new Date().toISOString();
    const entryId = `hist-${randomUUID()}`;

    const updatedRow = this.repo.transitionStatus(
      decisionId,
      'approved',
      entryId,
      'operator',
      reason,
    );

    if (!updatedRow) {
      throw new DecisionServiceError('SERVICE_ERROR', `Failed to approve decision ${decisionId}.`);
    }

    // Update approval metadata
    const finalRow = this.repo.update(decisionId, {
      approved_at: now,
      approved_by: approvedBy,
    });

    return finalRow ? decisionRowToRecord(finalRow) : decisionRowToRecord(updatedRow);
  }

  /**
   * Reject a decision.
   * Requires non-empty reason and expected revision.
   */
  rejectDecision(
    decisionId: string,
    rejectedBy: string,
    reason: string,
    expectedRevision: number,
  ): DecisionRecord {
    if (!reason.trim()) {
      throw new DecisionServiceError(
        'MISSING_REASON',
        'Rejection reason is required.',
        { decisionId, rejectedBy },
      );
    }

    const current = this.getDecision(decisionId);
    if (!current) {
      throw new DecisionServiceError('DECISION_NOT_FOUND', `Decision ${decisionId} not found.`);
    }

    if (current.revision !== expectedRevision) {
      throw new DecisionServiceError(
        'REVISION_CONFLICT',
        `Decision revision mismatch: expected ${expectedRevision}, got ${current.revision}.`,
        { decisionId, expectedRevision, actualRevision: current.revision },
      );
    }

    if (isDecisionTerminal(current)) {
      throw new DecisionServiceError(
        'DECISION_TERMINAL',
        `Decision ${decisionId} is already in terminal state: ${current.status}.`,
        { decisionId, status: current.status },
      );
    }

    if (!isValidStatusTransition(current.status, 'rejected')) {
      throw new DecisionServiceError(
        'INVALID_STATUS_TRANSITION',
        `Cannot reject decision from status: ${current.status}.`,
        { decisionId, fromStatus: current.status },
      );
    }

    const entryId = `hist-${randomUUID()}`;

    const updatedRow = this.repo.transitionStatus(
      decisionId,
      'rejected',
      entryId,
      'operator',
      reason,
    );

    if (!updatedRow) {
      throw new DecisionServiceError('SERVICE_ERROR', `Failed to reject decision ${decisionId}.`);
    }

    // Update rejection metadata
    const finalRow = this.repo.update(decisionId, {
      rejection_reason: reason,
    });

    return finalRow ? decisionRowToRecord(finalRow) : decisionRowToRecord(updatedRow);
  }

  /**
   * Supersede a decision with a new one.
   * Only affects decisions in non-terminal, non-approved/rejected states.
   * Approved/rejected decisions cannot be superseded (history is immutable).
   */
  supersedeDecision(
    oldDecisionId: string,
    newDecisionInput: CreateDecisionInput,
    reason: string,
  ): { old: DecisionRecord; new: DecisionRecord } {
    if (!reason.trim()) {
      throw new DecisionServiceError(
        'MISSING_REASON',
        'Supersession reason is required.',
        { oldDecisionId },
      );
    }

    const current = this.getDecision(oldDecisionId);
    if (!current) {
      throw new DecisionServiceError('DECISION_NOT_FOUND', `Decision ${oldDecisionId} not found.`);
    }

    // Cannot supersede approved or rejected decisions (history is immutable)
    if (current.status === 'approved' || current.status === 'rejected') {
      throw new DecisionServiceError(
        'ALREADY_SUPERSEDED',
        `Cannot supersede ${current.status} decision: history is immutable.`,
        { oldDecisionId, status: current.status },
      );
    }

    // Cannot supersede terminal decisions
    if (isDecisionTerminal(current)) {
      throw new DecisionServiceError(
        'DECISION_TERMINAL',
        `Decision ${oldDecisionId} is already in terminal state: ${current.status}.`,
        { oldDecisionId, status: current.status },
      );
    }

    if (!isValidStatusTransition(current.status, 'superseded')) {
      throw new DecisionServiceError(
        'INVALID_STATUS_TRANSITION',
        `Cannot supersede decision from status: ${current.status}.`,
        { oldDecisionId, fromStatus: current.status },
      );
    }

    // Create new decision
    const newDecisionId = `dec-${randomUUID()}`;
    const now = new Date().toISOString();
    const newRecord = buildDecisionRecord(newDecisionInput, newDecisionId, now);
    
    // Link supersession chain
    const newRecordWithSupersedes: DecisionRecord = {
      ...newRecord,
      supersedes: oldDecisionId,
    };

    validateDecisionRecord(newRecordWithSupersedes);

    // Atomic transaction: mark old as superseded + create new
    return this.db.transaction(() => {
      // Mark old decision as superseded
      const entryId = `hist-${randomUUID()}`;
      const oldRow = this.repo.transitionStatus(
        oldDecisionId,
        'superseded',
        entryId,
        'system',
        reason,
      );

      if (!oldRow) {
        throw new DecisionServiceError('SERVICE_ERROR', `Failed to supersede decision ${oldDecisionId}.`);
      }

      // Update superseded_by link
      this.repo.update(oldDecisionId, {
        superseded_by: newDecisionId,
      });

      // Create new decision
      const newRow = decisionRecordToRow(newRecordWithSupersedes);
      this.repo.create(newRow);

      const oldUpdated = this.repo.findById(oldDecisionId);
      const newCreated = this.repo.findById(newDecisionId);

      if (!oldUpdated || !newCreated) {
        throw new DecisionServiceError('SERVICE_ERROR', 'Supersession transaction incomplete.');
      }

      return {
        old: decisionRowToRecord(oldUpdated),
        new: decisionRowToRecord(newCreated),
      };
    })();
  }

  /**
   * Transition a decision to a new status.
   * Generic status transition with validation.
   */
  transitionStatus(
    decisionId: string,
    newStatus: DecisionStatus,
    triggeredBy: 'system' | 'operator',
    reason?: string,
  ): DecisionRecord {
    const current = this.getDecision(decisionId);
    if (!current) {
      throw new DecisionServiceError('DECISION_NOT_FOUND', `Decision ${decisionId} not found.`);
    }

    if (isDecisionTerminal(current)) {
      throw new DecisionServiceError(
        'DECISION_TERMINAL',
        `Decision ${decisionId} is already in terminal state: ${current.status}.`,
        { decisionId, status: current.status },
      );
    }

    if (!isValidStatusTransition(current.status, newStatus)) {
      throw new DecisionServiceError(
        'INVALID_STATUS_TRANSITION',
        `Invalid transition from ${current.status} to ${newStatus}.`,
        { decisionId, fromStatus: current.status, toStatus: newStatus },
      );
    }

    const entryId = `hist-${randomUUID()}`;
    const updatedRow = this.repo.transitionStatus(
      decisionId,
      newStatus,
      entryId,
      triggeredBy,
      reason,
    );

    if (!updatedRow) {
      throw new DecisionServiceError('SERVICE_ERROR', `Failed to transition decision ${decisionId}.`);
    }

    return decisionRowToRecord(updatedRow);
  }

  /**
   * Mark a decision as executed.
   */
  markExecuted(decisionId: string, executionEvidence: string): DecisionRecord {
    const current = this.getDecision(decisionId);
    if (!current) {
      throw new DecisionServiceError('DECISION_NOT_FOUND', `Decision ${decisionId} not found.`);
    }

    if (current.status !== 'approved') {
      throw new DecisionServiceError(
        'INVALID_STATUS_TRANSITION',
        `Only approved decisions can be executed. Current status: ${current.status}.`,
        { decisionId, status: current.status },
      );
    }

    const now = new Date().toISOString();
    const entryId = `hist-${randomUUID()}`;

    const updatedRow = this.repo.transitionStatus(
      decisionId,
      'executed',
      entryId,
      'system',
      'Execution submitted to Ads',
    );

    if (!updatedRow) {
      throw new DecisionServiceError('SERVICE_ERROR', `Failed to mark decision ${decisionId} as executed.`);
    }

    // Update execution metadata
    const finalRow = this.repo.update(decisionId, {
      executed_at: now,
      execution_evidence: executionEvidence,
    });

    return finalRow ? decisionRowToRecord(finalRow) : decisionRowToRecord(updatedRow);
  }

  /**
   * Mark a decision as verified with readback result.
   */
  markVerified(
    decisionId: string,
    verificationResult: 'success' | 'failure' | 'unknown',
  ): DecisionRecord {
    const current = this.getDecision(decisionId);
    if (!current) {
      throw new DecisionServiceError('DECISION_NOT_FOUND', `Decision ${decisionId} not found.`);
    }

    if (current.status !== 'executed') {
      throw new DecisionServiceError(
        'INVALID_STATUS_TRANSITION',
        `Only executed decisions can be verified. Current status: ${current.status}.`,
        { decisionId, status: current.status },
      );
    }

    const now = new Date().toISOString();
    const entryId = `hist-${randomUUID()}`;

    const updatedRow = this.repo.transitionStatus(
      decisionId,
      'verified',
      entryId,
      'system',
      `Verification result: ${verificationResult}`,
    );

    if (!updatedRow) {
      throw new DecisionServiceError('SERVICE_ERROR', `Failed to verify decision ${decisionId}.`);
    }

    // Update verification metadata
    const finalRow = this.repo.update(decisionId, {
      verified_at: now,
      verification_result: verificationResult,
    });

    return finalRow ? decisionRowToRecord(finalRow) : decisionRowToRecord(updatedRow);
  }

  /**
   * Get decision history.
   */
  getHistory(decisionId: string): Array<{
    entryId: string;
    decisionId: string;
    fromStatus: string;
    toStatus: string;
    timestamp: string;
    reason?: string;
    triggeredBy: 'system' | 'operator';
    metadata?: Record<string, unknown>;
  }> {
    const rows = this.repo.getHistory(decisionId);
    return rows.map((row) => ({
      entryId: row.entry_id,
      decisionId: row.decision_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      timestamp: row.timestamp,
      reason: row.reason ?? undefined,
      triggeredBy: row.triggered_by as 'system' | 'operator',
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  /**
   * Get aggregated statistics for a store.
   */
  getProjection(storeId: string, recentLimit = 20): {
    storeId: string;
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
  } {
    const projection = this.repo.getProjection(storeId, recentLimit);
    return {
      ...projection,
      recentDecisions: projection.recentRows.map(decisionRowToRecord),
    };
  }
}

// ─── Helper ──────────────────────────────────────────────────────────────

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}