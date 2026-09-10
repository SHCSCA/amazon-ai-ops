/**
 * V1.6 Domain Repositories
 *
 * Combined repository for all V1.6 domain models:
 * - MissionRepository (v16_missions)
 * - DecisionRepository (decisions_v16 + decision_history_v16)
 * - MissionGrantRepository (mission_grants_v16 + grant_lifecycle_events)
 * - ExecutionRepository (execution_slots + execution_batches + reconciliation_cases)
 * - ExperimentRepository (experiments_v16 + experiment_snapshots_v16)
 * - MemoryRepository (causal_events_v16)
 *
 * @module v16-domain-repositories
 */

import type Database from 'better-sqlite3';

// ─── Mission Repository ──────────────────────────────────────────────────

export interface MissionRow {
  mission_id: string;
  store_id: string;
  mission_name: string;
  description: string | null;
  product_ids: string;
  report_snapshot_id: string | null;
  observation_window_start: string | null;
  observation_window_end: string | null;
  policy_version_id: string | null;
  policy_revision: string | null;
  // Phase 5: Context binding fields
  session_generation: number | null;
  context_snapshot: string | null;
  stage: string;
  status: string;
  revision: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  last_modified_by: string | null;
  reason: string | null;
  metadata: string | null;
}

export class MissionRepository {
  constructor(private readonly db: Database.Database) {}

  create(mission: Omit<MissionRow, 'revision' | 'updated_at'>): MissionRow {
    const now = new Date().toISOString();
    const row: MissionRow = {
      ...mission,
      revision: 1,
      updated_at: now,
    };
    this.db.prepare(`
      INSERT INTO v16_missions (
        mission_id, store_id, mission_name, description,
        product_ids, report_snapshot_id, observation_window_start, observation_window_end,
        policy_version_id, policy_revision,
        session_generation, context_snapshot,
        stage, status, revision,
        created_at, updated_at, started_at, completed_at,
        created_by, last_modified_by, reason, metadata
      ) VALUES (
        @mission_id, @store_id, @mission_name, @description,
        @product_ids, @report_snapshot_id, @observation_window_start, @observation_window_end,
        @policy_version_id, @policy_revision,
        @session_generation, @context_snapshot,
        @stage, @status, @revision,
        @created_at, @updated_at, @started_at, @completed_at,
        @created_by, @last_modified_by, @reason, @metadata
      )
    `).run(row);
    return row;
  }

  findById(missionId: string): MissionRow | null {
    return this.db.prepare(`SELECT * FROM v16_missions WHERE mission_id = ?`).get(missionId) as MissionRow | null;
  }

  findByStoreId(storeId: string, limit = 50): MissionRow[] {
    return this.db.prepare(`
      SELECT * FROM v16_missions
      WHERE store_id = ?
      ORDER BY updated_at DESC, mission_id
      LIMIT ?
    `).all(storeId, limit) as MissionRow[];
  }

  findByStatus(storeId: string, status: string): MissionRow[] {
    return this.db.prepare(`
      SELECT * FROM v16_missions
      WHERE store_id = ? AND status = ?
      ORDER BY updated_at DESC
    `).all(storeId, status) as MissionRow[];
  }

  update(missionId: string, updates: Partial<MissionRow>): MissionRow | null {
    const fields = Object.entries(updates)
      .filter(([key]) => key !== 'mission_id' && key !== 'created_at')
      .map(([key]) => `${key} = @${key}`)
      .join(', ');

    if (!fields) return this.findById(missionId);

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE v16_missions SET ${fields}, updated_at = @updatedAt
      WHERE mission_id = @mission_id
    `).run({ ...updates, updatedAt: now, mission_id: missionId });

    return this.findById(missionId);
  }
}

// ─── Decision Repository ──────────────────────────────────────────────────

export interface DecisionRow {
  decision_id: string;
  store_id: string;
  marketplace: string;
  currency: string;
  mission_id: string;
  mission_revision: number;
  analysis_run_id: string;
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

export class DecisionRepository {
  constructor(private readonly db: Database.Database) {}

  create(decision: Omit<DecisionRow, 'revision' | 'updated_at'>): DecisionRow {
    const now = new Date().toISOString();
    const row: DecisionRow = {
      ...decision,
      revision: 1,
      updated_at: now,
    };
    this.db.prepare(`
      INSERT INTO decisions_v16 (
        decision_id, store_id, marketplace, currency,
        mission_id, mission_revision, analysis_run_id, batch_id, recommendation_id,
        action_type, entity_type, entity_id, current_value, target_value, change_reason,
        status, issuer, revision,
        approved_at, approved_by, rejection_reason,
        superseded_by, supersedes,
        executed_at, execution_evidence,
        verified_at, verification_result,
        created_at, updated_at, metadata
      ) VALUES (
        @decision_id, @store_id, @marketplace, @currency,
        @mission_id, @mission_revision, @analysis_run_id, @batch_id, @recommendation_id,
        @action_type, @entity_type, @entity_id, @current_value, @target_value, @change_reason,
        @status, @issuer, @revision,
        @approved_at, @approved_by, @rejection_reason,
        @superseded_by, @supersedes,
        @executed_at, @execution_evidence,
        @verified_at, @verification_result,
        @created_at, @updated_at, @metadata
      )
    `).run(row);
    return row;
  }

  findById(decisionId: string): DecisionRow | null {
    return this.db.prepare(`SELECT * FROM decisions_v16 WHERE decision_id = ?`).get(decisionId) as DecisionRow | null;
  }

  findByStoreId(storeId: string, limit = 50): DecisionRow[] {
    return this.db.prepare(`
      SELECT * FROM decisions_v16
      WHERE store_id = ?
      ORDER BY updated_at DESC, decision_id
      LIMIT ?
    `).all(storeId, limit) as DecisionRow[];
  }

  findByMissionId(missionId: string): DecisionRow[] {
    return this.db.prepare(`
      SELECT * FROM decisions_v16
      WHERE mission_id = ?
      ORDER BY created_at DESC
    `).all(missionId) as DecisionRow[];
  }

  findByAnalysisRunId(analysisRunId: string): DecisionRow[] {
    return this.db.prepare(`
      SELECT * FROM decisions_v16
      WHERE analysis_run_id = ?
      ORDER BY created_at DESC
    `).all(analysisRunId) as DecisionRow[];
  }

  findByBatchId(batchId: string): DecisionRow[] {
    return this.db.prepare(`
      SELECT * FROM decisions_v16
      WHERE batch_id = ?
      ORDER BY created_at DESC
    `).all(batchId) as DecisionRow[];
  }

  findByStatus(storeId: string, status: string): DecisionRow[] {
    return this.db.prepare(`
      SELECT * FROM decisions_v16
      WHERE store_id = ? AND status = ?
      ORDER BY updated_at DESC
    `).all(storeId, status) as DecisionRow[];
  }

  update(decisionId: string, updates: Partial<DecisionRow>): DecisionRow | null {
    const fields = Object.entries(updates)
      .filter(([key]) => key !== 'decision_id' && key !== 'created_at')
      .map(([key]) => `${key} = @${key}`)
      .join(', ');

    if (!fields) return this.findById(decisionId);

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE decisions_v16 SET ${fields}, updated_at = @updatedAt
      WHERE decision_id = @decision_id
    `).run({ ...updates, updatedAt: now, decision_id: decisionId });

    return this.findById(decisionId);
  }

  appendHistory(entry: {
    entry_id: string;
    decision_id: string;
    from_status: string;
    to_status: string;
    timestamp: string;
    reason?: string;
    triggered_by: 'system' | 'operator';
    metadata?: string;
  }): void {
    this.db.prepare(`
      INSERT INTO decision_history_v16 (
        entry_id, decision_id, from_status, to_status, timestamp, reason, triggered_by, metadata
      ) VALUES (
        @entry_id, @decision_id, @from_status, @to_status, @timestamp, @reason, @triggered_by, @metadata
      )
    `).run({
      ...entry,
      reason: entry.reason ?? null,
      metadata: entry.metadata ?? null,
    });
  }

  getHistory(decisionId: string): Array<{
    entry_id: string;
    decision_id: string;
    from_status: string;
    to_status: string;
    timestamp: string;
    reason: string | null;
    triggered_by: string;
    metadata: string | null;
  }> {
    return this.db.prepare(`
      SELECT * FROM decision_history_v16
      WHERE decision_id = ?
      ORDER BY timestamp ASC
    `).all(decisionId) as Array<{
      entry_id: string;
      decision_id: string;
      from_status: string;
      to_status: string;
      timestamp: string;
      reason: string | null;
      triggered_by: string;
      metadata: string | null;
    }>;
  }

  /**
   * Atomically transition a decision's status and append a history entry.
   * Returns the updated row or null if decision not found.
   */
  transitionStatus(
    decisionId: string,
    newStatus: string,
    entryId: string,
    triggeredBy: 'system' | 'operator',
    reason?: string,
    metadata?: Record<string, unknown>,
  ): DecisionRow | null {
    const current = this.findById(decisionId);
    if (!current) return null;

    const fromStatus = current.status;
    const timestamp = new Date().toISOString();
    const now = timestamp;

    return this.db.transaction(() => {
      // Update decision status
      this.db.prepare(`
        UPDATE decisions_v16
        SET status = @status, updated_at = @updatedAt, revision = revision + 1
        WHERE decision_id = @decisionId
      `).run({ status: newStatus, updatedAt: now, decisionId });

      // Append history entry
      this.db.prepare(`
        INSERT INTO decision_history_v16 (
          entry_id, decision_id, from_status, to_status, timestamp, reason, triggered_by, metadata
        ) VALUES (
          @entry_id, @decision_id, @from_status, @to_status, @timestamp, @reason, @triggered_by, @metadata
        )
      `).run({
        entry_id: entryId,
        decision_id: decisionId,
        from_status: fromStatus,
        to_status: newStatus,
        timestamp,
        reason: reason ?? null,
        triggered_by: triggeredBy,
        metadata: metadata ? JSON.stringify(metadata) : null,
      });

      return this.findById(decisionId);
    })();
  }

  /**
   * Get aggregated decision statistics for a store.
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
    recentRows: DecisionRow[];
  } {
    const rows = this.findByStoreId(storeId, 1000);

    const byEntityType: Record<string, number> = {};
    const byActionType: Record<string, number> = {};
    let proposedCount = 0, needsApprovalCount = 0, approvedCount = 0,
        rejectedCount = 0, blockedCount = 0, supersededCount = 0,
        executedCount = 0, verifiedCount = 0;

    for (const row of rows) {
      switch (row.status) {
        case 'proposed': proposedCount++; break;
        case 'needs_approval': needsApprovalCount++; break;
        case 'approved': approvedCount++; break;
        case 'rejected': rejectedCount++; break;
        case 'blocked': blockedCount++; break;
        case 'superseded': supersededCount++; break;
        case 'executed': executedCount++; break;
        case 'verified': verifiedCount++; break;
      }
      byEntityType[row.entity_type] = (byEntityType[row.entity_type] ?? 0) + 1;
      byActionType[row.action_type] = (byActionType[row.action_type] ?? 0) + 1;
    }

    const recentRows = rows.slice(0, recentLimit);

    return {
      storeId,
      totalCount: rows.length,
      proposedCount,
      needsApprovalCount,
      approvedCount,
      rejectedCount,
      blockedCount,
      supersededCount,
      executedCount,
      verifiedCount,
      byEntityType,
      byActionType,
      recentRows,
    };
  }
}

// ─── Mission Grant Repository ─────────────────────────────────────────────

export interface MissionGrantRow {
  grant_id: string;
  store_id: string;
  mission_id: string;
  mission_revision: number;
  decision_ids: string;
  issuer: string;
  issued_at: string;
  expires_at: string | null;
  issued_by: string;
  scope_json: string;
  limits_json: string;
  evidence_json: string;
  // Phase 5: Context binding fields
  session_generation: number | null;
  context_snapshot: string | null;
  ads_account_id: string | null;
  status: string;
  used_slots: number;
  consumed_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revocation_reason: string | null;
  created_at: string;
  updated_at: string;
  reason: string;
  metadata: string | null;
}

export class MissionGrantRepository {
  constructor(private readonly db: Database.Database) {}

  create(grant: MissionGrantRow): MissionGrantRow {
    this.db.prepare(`
      INSERT INTO mission_grants_v16 (
        grant_id, store_id, mission_id, mission_revision, decision_ids,
        issuer, issued_at, expires_at, issued_by,
        scope_json, limits_json, evidence_json,
        session_generation, context_snapshot, ads_account_id,
        status, used_slots, consumed_at, revoked_at, revoked_by, revocation_reason,
        created_at, updated_at, reason, metadata
      ) VALUES (
        @grant_id, @store_id, @mission_id, @mission_revision, @decision_ids,
        @issuer, @issued_at, @expires_at, @issued_by,
        @scope_json, @limits_json, @evidence_json,
        @session_generation, @context_snapshot, @ads_account_id,
        @status, @used_slots, @consumed_at, @revoked_at, @revoked_by, @revocation_reason,
        @created_at, @updated_at, @reason, @metadata
      )
    `).run(grant);
    return grant;
  }

  findById(grantId: string): MissionGrantRow | null {
    return this.db.prepare(`SELECT * FROM mission_grants_v16 WHERE grant_id = ?`).get(grantId) as MissionGrantRow | null;
  }

  findByStoreId(storeId: string, limit = 50): MissionGrantRow[] {
    return this.db.prepare(`
      SELECT * FROM mission_grants_v16
      WHERE store_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(storeId, limit) as MissionGrantRow[];
  }

  findActiveByStore(storeId: string): MissionGrantRow[] {
    return this.db.prepare(`
      SELECT * FROM mission_grants_v16
      WHERE store_id = ? AND status IN ('active', 'partially_consumed')
      ORDER BY updated_at DESC
    `).all(storeId) as MissionGrantRow[];
  }

  update(grantId: string, updates: Partial<MissionGrantRow>): MissionGrantRow | null {
    const fields = Object.entries(updates)
      .filter(([key]) => key !== 'grant_id' && key !== 'created_at')
      .map(([key]) => `${key} = @${key}`)
      .join(', ');

    if (!fields) return this.findById(grantId);

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE mission_grants_v16 SET ${fields}, updated_at = @updatedAt
      WHERE grant_id = @grant_id
    `).run({ ...updates, updatedAt: now, grant_id: grantId });

    return this.findById(grantId);
  }

  appendLifecycleEvent(event: {
    event_id: string;
    grant_id: string;
    event_type: string;
    timestamp: string;
    slot_index?: number;
    execution_id?: string;
    metadata?: string;
  }): void {
    this.db.prepare(`
      INSERT INTO grant_lifecycle_events (
        event_id, grant_id, event_type, timestamp, slot_index, execution_id, metadata
      ) VALUES (
        @event_id, @grant_id, @event_type, @timestamp, @slot_index, @execution_id, @metadata
      )
    `).run({
      ...event,
      slot_index: event.slot_index ?? null,
      execution_id: event.execution_id ?? null,
      metadata: event.metadata ?? null,
    });
  }

  getLifecycleEvents(grantId: string): Array<{
    event_id: string;
    grant_id: string;
    event_type: string;
    timestamp: string;
    slot_index: number | null;
    execution_id: string | null;
    metadata: string | null;
  }> {
    return this.db.prepare(`
      SELECT * FROM grant_lifecycle_events
      WHERE grant_id = ?
      ORDER BY timestamp ASC
    `).all(grantId) as Array<{
      event_id: string;
      grant_id: string;
      event_type: string;
      timestamp: string;
      slot_index: number | null;
      execution_id: string | null;
      metadata: string | null;
    }>;
  }
}

// ─── Execution Repository ─────────────────────────────────────────────────

export interface ExecutionSlotRow {
  slot_id: string;
  grant_id: string;
  decision_id: string;
  batch_id: string;
  store_id: string;
  intent_json: string;
  status: string;
  expected_before: string;
  expected_after: string;
  expected_change_percent: number | null;
  before_evidence_path: string | null;
  after_evidence_path: string | null;
  reload_evidence_path: string | null;
  readback_before_value: string | null;
  readback_after_value: string | null;
  readback_reload_value: string | null;
  verified_at: string | null;
  verification_result: string | null;
  reconciliation_case_id: string | null;
  reconciliation_outcome: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}

export interface ExecutionBatchRow {
  batch_id: string;
  grant_id: string;
  mission_id: string;
  store_id: string;
  slot_ids: string;
  status: string;
  pending_count: number;
  submitted_count: number;
  verified_count: number;
  failed_count: number;
  unknown_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export class ExecutionRepository {
  constructor(private readonly db: Database.Database) {}

  // Slot methods
  createSlot(slot: ExecutionSlotRow): ExecutionSlotRow {
    this.db.prepare(`
      INSERT INTO execution_slots (
        slot_id, grant_id, decision_id, batch_id, store_id,
        intent_json, status,
        expected_before, expected_after, expected_change_percent,
        before_evidence_path, after_evidence_path, reload_evidence_path,
        readback_before_value, readback_after_value, readback_reload_value,
        verified_at, verification_result,
        reconciliation_case_id, reconciliation_outcome,
        created_at, updated_at, submitted_at
      ) VALUES (
        @slot_id, @grant_id, @decision_id, @batch_id, @store_id,
        @intent_json, @status,
        @expected_before, @expected_after, @expected_change_percent,
        @before_evidence_path, @after_evidence_path, @reload_evidence_path,
        @readback_before_value, @readback_after_value, @readback_reload_value,
        @verified_at, @verification_result,
        @reconciliation_case_id, @reconciliation_outcome,
        @created_at, @updated_at, @submitted_at
      )
    `).run(slot);
    return slot;
  }

  findSlotById(slotId: string): ExecutionSlotRow | null {
    return this.db.prepare(`SELECT * FROM execution_slots WHERE slot_id = ?`).get(slotId) as ExecutionSlotRow | null;
  }

  findSlotsByBatchId(batchId: string): ExecutionSlotRow[] {
    return this.db.prepare(`SELECT * FROM execution_slots WHERE batch_id = ?`).all(batchId) as ExecutionSlotRow[];
  }

  updateSlot(slotId: string, updates: Partial<ExecutionSlotRow>): ExecutionSlotRow | null {
    const fields = Object.entries(updates)
      .filter(([key]) => key !== 'slot_id' && key !== 'created_at')
      .map(([key]) => `${key} = @${key}`)
      .join(', ');

    if (!fields) return this.findSlotById(slotId);

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE execution_slots SET ${fields}, updated_at = @updatedAt
      WHERE slot_id = @slot_id
    `).run({ ...updates, updatedAt: now, slot_id: slotId });

    return this.findSlotById(slotId);
  }

  // Batch methods
  createBatch(batch: ExecutionBatchRow): ExecutionBatchRow {
    this.db.prepare(`
      INSERT INTO execution_batches (
        batch_id, grant_id, mission_id, store_id,
        slot_ids, status,
        pending_count, submitted_count, verified_count, failed_count, unknown_count,
        created_at, updated_at, completed_at
      ) VALUES (
        @batch_id, @grant_id, @mission_id, @store_id,
        @slot_ids, @status,
        @pending_count, @submitted_count, @verified_count, @failed_count, @unknown_count,
        @created_at, @updated_at, @completed_at
      )
    `).run(batch);
    return batch;
  }

  findBatchById(batchId: string): ExecutionBatchRow | null {
    return this.db.prepare(`SELECT * FROM execution_batches WHERE batch_id = ?`).get(batchId) as ExecutionBatchRow | null;
  }

  findBatchesByStore(storeId: string, limit = 50): ExecutionBatchRow[] {
    return this.db.prepare(`
      SELECT * FROM execution_batches
      WHERE store_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(storeId, limit) as ExecutionBatchRow[];
  }

  updateBatch(batchId: string, updates: Partial<ExecutionBatchRow>): ExecutionBatchRow | null {
    const fields = Object.entries(updates)
      .filter(([key]) => key !== 'batch_id' && key !== 'created_at')
      .map(([key]) => `${key} = @${key}`)
      .join(', ');

    if (!fields) return this.findBatchById(batchId);

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE execution_batches SET ${fields}, updated_at = @updatedAt
      WHERE batch_id = @batch_id
    `).run({ ...updates, updatedAt: now, batch_id: batchId });

    return this.findBatchById(batchId);
  }

  findBatchesByGrant(grantId: string): ExecutionBatchRow[] {
    return this.db.prepare(`
      SELECT * FROM execution_batches
      WHERE grant_id = ?
      ORDER BY created_at DESC
    `).all(grantId) as ExecutionBatchRow[];
  }

  findBatchesByMission(missionId: string): ExecutionBatchRow[] {
    return this.db.prepare(`
      SELECT * FROM execution_batches
      WHERE mission_id = ?
      ORDER BY created_at DESC
    `).all(missionId) as ExecutionBatchRow[];
  }

  // Reconciliation case methods
  createReconciliationCase(rc: {
    case_id: string;
    slot_id: string;
    batch_id: string;
    store_id: string;
    created_at: string;
    observation_1_timestamp?: string;
    observation_1_value?: string;
    observation_2_timestamp?: string;
    observation_2_value?: string;
    outcome?: string;
    resolved_at?: string;
    resolution_notes?: string;
  }): void {
    this.db.prepare(`
      INSERT INTO reconciliation_cases (
        case_id, slot_id, batch_id, store_id, created_at,
        observation_1_timestamp, observation_1_value,
        observation_2_timestamp, observation_2_value,
        outcome, resolved_at, resolution_notes
      ) VALUES (
        @case_id, @slot_id, @batch_id, @store_id, @created_at,
        @observation_1_timestamp, @observation_1_value,
        @observation_2_timestamp, @observation_2_value,
        @outcome, @resolved_at, @resolution_notes
      )
    `).run({
      case_id: rc.case_id,
      slot_id: rc.slot_id,
      batch_id: rc.batch_id,
      store_id: rc.store_id,
      created_at: rc.created_at,
      observation_1_timestamp: rc.observation_1_timestamp ?? null,
      observation_1_value: rc.observation_1_value ?? null,
      observation_2_timestamp: rc.observation_2_timestamp ?? null,
      observation_2_value: rc.observation_2_value ?? null,
      outcome: rc.outcome ?? null,
      resolved_at: rc.resolved_at ?? null,
      resolution_notes: rc.resolution_notes ?? null,
    });
  }

  findReconciliationCaseBySlot(slotId: string): {
    case_id: string;
    slot_id: string;
    batch_id: string;
    store_id: string;
    created_at: string;
    observation_1_timestamp: string | null;
    observation_1_value: string | null;
    observation_2_timestamp: string | null;
    observation_2_value: string | null;
    outcome: string | null;
    resolved_at: string | null;
    resolution_notes: string | null;
  } | null {
    return this.db.prepare(`
      SELECT * FROM reconciliation_cases WHERE slot_id = ?
    `).get(slotId) as {
      case_id: string;
      slot_id: string;
      batch_id: string;
      store_id: string;
      created_at: string;
      observation_1_timestamp: string | null;
      observation_1_value: string | null;
      observation_2_timestamp: string | null;
      observation_2_value: string | null;
      outcome: string | null;
      resolved_at: string | null;
      resolution_notes: string | null;
    } | null;
  }

  findReconciliationCasesByBatch(batchId: string): Array<{
    case_id: string;
    slot_id: string;
    batch_id: string;
    store_id: string;
    created_at: string;
    observation_1_timestamp: string | null;
    observation_1_value: string | null;
    observation_2_timestamp: string | null;
    observation_2_value: string | null;
    outcome: string | null;
    resolved_at: string | null;
    resolution_notes: string | null;
  }> {
    return this.db.prepare(`
      SELECT * FROM reconciliation_cases
      WHERE batch_id = ?
      ORDER BY created_at DESC
    `).all(batchId) as Array<{
      case_id: string;
      slot_id: string;
      batch_id: string;
      store_id: string;
      created_at: string;
      observation_1_timestamp: string | null;
      observation_1_value: string | null;
      observation_2_timestamp: string | null;
      observation_2_value: string | null;
      outcome: string | null;
      resolved_at: string | null;
      resolution_notes: string | null;
    }>;
  }

  updateReconciliationCase(caseId: string, updates: {
    observation_1_timestamp?: string;
    observation_1_value?: string;
    observation_2_timestamp?: string;
    observation_2_value?: string;
    outcome?: string;
    resolved_at?: string;
    resolution_notes?: string;
  }): void {
    const fields = Object.entries(updates)
      .map(([key]) => `${key} = @${key}`)
      .join(', ');

    if (!fields) return;

    this.db.prepare(`
      UPDATE reconciliation_cases SET ${fields}
      WHERE case_id = @case_id
    `).run({ ...updates, case_id: caseId });
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
    const batches = this.findBatchesByStore(storeId, 1000);

    let runningCount = 0,
        completedCount = 0,
        stoppedCount = 0;

    let totalSlots = 0,
        pendingSlots = 0,
        submittedSlots = 0,
        verifiedSlots = 0,
        failedSlots = 0,
        unknownSlots = 0;

    for (const batch of batches) {
      switch (batch.status) {
        case 'running':
          runningCount++;
          break;
        case 'completed':
          completedCount++;
          break;
        case 'stopped_invalidated':
        case 'stopped_unknown':
          stoppedCount++;
          break;
      }

      const slotCount = JSON.parse(batch.slot_ids).length;
      totalSlots += slotCount;
      pendingSlots += batch.pending_count;
      submittedSlots += batch.submitted_count;
      verifiedSlots += batch.verified_count;
      failedSlots += batch.failed_count;
      unknownSlots += batch.unknown_count;
    }

    return {
      totalBatches: batches.length,
      runningCount,
      completedCount,
      stoppedCount,
      totalSlots,
      pendingSlots,
      submittedSlots,
      verifiedSlots,
      failedSlots,
      unknownSlots,
    };
  }
}

// ─── Experiment Repository ────────────────────────────────────────────────

export interface ExperimentRow {
  experiment_id: string;
  store_id: string;
  mission_id: string | null;
  decision_id: string | null;
  name: string;
  description: string | null;
  hypothesis_json: string;
  product_ids: string;
  entity_ids: string;
  baseline_snapshot_id: string | null;
  observation_window_start: string | null;
  observation_window_end: string | null;
  observation_snapshots: string;
  guardrails_json: string;
  conclusion_id: string | null;
  guardrails_triggered: string;
  status: string;
  revision: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  metadata: string | null;
}

export class ExperimentRepository {
  constructor(private readonly db: Database.Database) {}

  create(experiment: Omit<ExperimentRow, 'revision' | 'updated_at'>): ExperimentRow {
    const now = new Date().toISOString();
    const row: ExperimentRow = {
      ...experiment,
      revision: 1,
      updated_at: now,
    };
    this.db.prepare(`
      INSERT INTO experiments_v16 (
        experiment_id, store_id, mission_id, decision_id,
        name, description, hypothesis_json,
        product_ids, entity_ids,
        baseline_snapshot_id, observation_window_start, observation_window_end,
        observation_snapshots, guardrails_json, conclusion_id, guardrails_triggered,
        status, revision,
        created_at, updated_at, started_at, completed_at, metadata
      ) VALUES (
        @experiment_id, @store_id, @mission_id, @decision_id,
        @name, @description, @hypothesis_json,
        @product_ids, @entity_ids,
        @baseline_snapshot_id, @observation_window_start, @observation_window_end,
        @observation_snapshots, @guardrails_json, @conclusion_id, @guardrails_triggered,
        @status, @revision,
        @created_at, @updated_at, @started_at, @completed_at, @metadata
      )
    `).run(row);
    return row;
  }

  findById(experimentId: string): ExperimentRow | null {
    return this.db.prepare(`SELECT * FROM experiments_v16 WHERE experiment_id = ?`).get(experimentId) as ExperimentRow | null;
  }

  findByStoreId(storeId: string, limit = 50): ExperimentRow[] {
    return this.db.prepare(`
      SELECT * FROM experiments_v16
      WHERE store_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(storeId, limit) as ExperimentRow[];
  }

  update(experimentId: string, updates: Partial<ExperimentRow>): ExperimentRow | null {
    const fields = Object.entries(updates)
      .filter(([key]) => key !== 'experiment_id' && key !== 'created_at')
      .map(([key]) => `${key} = @${key}`)
      .join(', ');

    if (!fields) return this.findById(experimentId);

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE experiments_v16 SET ${fields}, updated_at = @updatedAt
      WHERE experiment_id = @experiment_id
    `).run({ ...updates, updatedAt: now, experiment_id: experimentId });

    return this.findById(experimentId);
  }
}

// ─── Causal Memory Repository ─────────────────────────────────────────────

export interface CausalEventRow {
  event_id: string;
  store_id: string;
  stage: string;
  mission_id: string | null;
  decision_id: string | null;
  grant_id: string | null;
  execution_id: string | null;
  experiment_id: string | null;
  analysis_run_id: string | null;
  entity_id: string | null;
  product_id: string | null;
  business_date: string;
  event_type: string;
  session_generation: number;
  proof_hash: string;
  evidence_refs_json: string;
  summary: string;
  details_json: string | null;
  status: string;
  memory_digest: string | null;
  created_at: string;
  correction_of: string | null;
  corrected_by: string | null;
  metadata: string | null;
}

export class MemoryRepository {
  constructor(private readonly db: Database.Database) {}

  append(event: CausalEventRow): CausalEventRow {
    this.db.prepare(`
      INSERT INTO causal_events_v16 (
        event_id, store_id, stage,
        mission_id, decision_id, grant_id, execution_id, experiment_id, analysis_run_id,
        entity_id, product_id, business_date, event_type, session_generation,
        proof_hash, evidence_refs_json,
        summary, details_json, status, memory_digest,
        created_at, correction_of, corrected_by, metadata
      ) VALUES (
        @event_id, @store_id, @stage,
        @mission_id, @decision_id, @grant_id, @execution_id, @experiment_id, @analysis_run_id,
        @entity_id, @product_id, @business_date, @event_type, @session_generation,
        @proof_hash, @evidence_refs_json,
        @summary, @details_json, @status, @memory_digest,
        @created_at, @correction_of, @corrected_by, @metadata
      )
    `).run(event);
    return event;
  }

  findByStore(storeId: string, limit = 100): CausalEventRow[] {
    return this.db.prepare(`
      SELECT * FROM causal_events_v16
      WHERE store_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(storeId, limit) as CausalEventRow[];
  }

  findTrustedByStore(storeId: string, limit = 100): CausalEventRow[] {
    return this.db.prepare(`
      SELECT * FROM causal_events_v16
      WHERE store_id = ? AND status = 'trusted' AND stage IN ('readback', 'effect')
      ORDER BY created_at DESC
      LIMIT ?
    `).all(storeId, limit) as CausalEventRow[];
  }

  countByStore(storeId: string): number {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM causal_events_v16 WHERE store_id = ?
    `).get(storeId) as { count: number };
    return result.count;
  }
}

// ─── Policy Version Repository (Phase 6) ─────────────────────────────────

export interface PolicyVersionRow {
  readonly policy_version_id: string;
  readonly store_id: string;
  readonly mode: string;
  readonly status: string;
  readonly revision: number;
  readonly scope_json: string;
  readonly limits_json: string;
  readonly window_json: string;
  readonly evidence_json: string;
  readonly stops_json: string;
  readonly created_at: string;
  readonly enabled_at: string | null;
  readonly disabled_at: string | null;
  readonly enabled_by: string | null;
  readonly reason: string;
  readonly supersedes_policy_version_id: string | null;
}

export interface ModeChangeLogRow {
  readonly audit_id: string;
  readonly store_id: string;
  readonly from_mode: string | null;
  readonly to_mode: string;
  readonly authority_mode_revision_before: number;
  readonly authority_mode_revision_after: number;
  readonly previous_policy_version_id: string | null;
  readonly active_policy_version_id: string | null;
  readonly reason: string;
  readonly actor: string;
  readonly changed_at: string;
  readonly context_snapshot_json: string;
}

export interface AuthorityInvalidationRow {
  readonly invalidation_id: string;
  readonly store_id: string;
  readonly authority_mode_revision: number;
  readonly invalidates_grant_ids_json: string;
  readonly invalidates_batch_ids_json: string;
  readonly invalidates_slot_ids_json: string;
  readonly reason: string;
  readonly created_at: string;
  readonly terminal: number;
}

export class PolicyVersionRepository {
  constructor(private readonly db: Database.Database) {}

  upsertPolicyVersion(row: PolicyVersionRow): PolicyVersionRow {
    this.db.prepare(`
      INSERT INTO policy_versions_v16 (
        policy_version_id, store_id, mode, status, revision,
        scope_json, limits_json, window_json, evidence_json, stops_json,
        created_at, enabled_at, disabled_at, enabled_by, reason, supersedes_policy_version_id
      ) VALUES (
        @policy_version_id, @store_id, @mode, @status, @revision,
        @scope_json, @limits_json, @window_json, @evidence_json, @stops_json,
        @created_at, @enabled_at, @disabled_at, @enabled_by, @reason, @supersedes_policy_version_id
      )
      ON CONFLICT(policy_version_id) DO UPDATE SET
        status = excluded.status,
        enabled_at = excluded.enabled_at,
        disabled_at = excluded.disabled_at,
        enabled_by = excluded.enabled_by,
        reason = excluded.reason
    `).run({
      policy_version_id: row.policy_version_id,
      store_id: row.store_id,
      mode: row.mode,
      status: row.status,
      revision: row.revision,
      scope_json: row.scope_json,
      limits_json: row.limits_json,
      window_json: row.window_json,
      evidence_json: row.evidence_json,
      stops_json: row.stops_json,
      created_at: row.created_at,
      enabled_at: row.enabled_at ?? null,
      disabled_at: row.disabled_at ?? null,
      enabled_by: row.enabled_by ?? null,
      reason: row.reason,
      supersedes_policy_version_id: row.supersedes_policy_version_id ?? null,
    });
    return row;
  }

  findById(policyVersionId: string): PolicyVersionRow | null {
    const row = this.db.prepare(
      `SELECT * FROM policy_versions_v16 WHERE policy_version_id = ?`,
    ).get(policyVersionId);
    return (row as PolicyVersionRow | undefined) ?? null;
  }

  findByStore(storeId: string, limit = 50): PolicyVersionRow[] {
    return this.db.prepare(`
      SELECT * FROM policy_versions_v16
      WHERE store_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(storeId, limit) as PolicyVersionRow[];
  }

  findEnabledByStore(storeId: string): PolicyVersionRow | null {
    const row = this.db.prepare(`
      SELECT * FROM policy_versions_v16
      WHERE store_id = ? AND status = 'enabled'
      ORDER BY revision DESC
      LIMIT 1
    `).get(storeId);
    return (row as PolicyVersionRow | undefined) ?? null;
  }

  insertModeChangeLog(row: ModeChangeLogRow): ModeChangeLogRow {
    this.db.prepare(`
      INSERT INTO mode_change_log_v16 (
        audit_id, store_id, from_mode, to_mode,
        authority_mode_revision_before, authority_mode_revision_after,
        previous_policy_version_id, active_policy_version_id,
        reason, actor, changed_at, context_snapshot_json
      ) VALUES (
        @audit_id, @store_id, @from_mode, @to_mode,
        @authority_mode_revision_before, @authority_mode_revision_after,
        @previous_policy_version_id, @active_policy_version_id,
        @reason, @actor, @changed_at, @context_snapshot_json
      )
    `).run({
      audit_id: row.audit_id,
      store_id: row.store_id,
      from_mode: row.from_mode ?? null,
      to_mode: row.to_mode,
      authority_mode_revision_before: row.authority_mode_revision_before,
      authority_mode_revision_after: row.authority_mode_revision_after,
      previous_policy_version_id: row.previous_policy_version_id ?? null,
      active_policy_version_id: row.active_policy_version_id ?? null,
      reason: row.reason,
      actor: row.actor,
      changed_at: row.changed_at,
      context_snapshot_json: row.context_snapshot_json,
    });
    return row;
  }

  getModeChangeLog(storeId: string): ModeChangeLogRow[] {
    return this.db.prepare(`
      SELECT * FROM mode_change_log_v16
      WHERE store_id = ?
      ORDER BY changed_at ASC
    `).all(storeId) as ModeChangeLogRow[];
  }

  insertAuthorityInvalidation(row: AuthorityInvalidationRow): AuthorityInvalidationRow {
    this.db.prepare(`
      INSERT INTO authority_invalidation_v16 (
        invalidation_id, store_id, authority_mode_revision,
        invalidates_grant_ids_json, invalidates_batch_ids_json, invalidates_slot_ids_json,
        reason, created_at, terminal
      ) VALUES (
        @invalidation_id, @store_id, @authority_mode_revision,
        @invalidates_grant_ids_json, @invalidates_batch_ids_json, @invalidates_slot_ids_json,
        @reason, @created_at, @terminal
      )
    `).run({
      invalidation_id: row.invalidation_id,
      store_id: row.store_id,
      authority_mode_revision: row.authority_mode_revision,
      invalidates_grant_ids_json: row.invalidates_grant_ids_json,
      invalidates_batch_ids_json: row.invalidates_batch_ids_json,
      invalidates_slot_ids_json: row.invalidates_slot_ids_json,
      reason: row.reason,
      created_at: row.created_at,
      terminal: row.terminal,
    });
    return row;
  }

  getAuthorityInvalidations(storeId: string): AuthorityInvalidationRow[] {
    return this.db.prepare(`
      SELECT * FROM authority_invalidation_v16
      WHERE store_id = ?
      ORDER BY created_at ASC
    `).all(storeId) as AuthorityInvalidationRow[];
  }

  /**
   * Get the current authority mode revision for a store.
   * Falls back to 0 (uninitialised) if no audit rows exist.
   */
  getCurrentAuthorityRevision(storeId: string): number {
    const row = this.db.prepare(`
      SELECT authority_mode_revision_after
      FROM mode_change_log_v16
      WHERE store_id = ?
      ORDER BY changed_at DESC
      LIMIT 1
    `).get(storeId) as { authority_mode_revision_after: number } | undefined;
    return row?.authority_mode_revision_after ?? 0;
  }
}
