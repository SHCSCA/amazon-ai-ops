// 各领域仓储保留各自原数据库连接与事务边界。
import type Database from 'better-sqlite3';

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
    constructor(private readonly db: Database.Database) { }
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
        if (!fields)
            return this.findSlotById(slotId);
        const now = new Date().toISOString();
        this.db.prepare(`
      UPDATE execution_slots SET ${fields}, updated_at = @updatedAt
      WHERE slot_id = @slot_id
    `).run({ ...updates, updatedAt: now, slot_id: slotId });
        return this.findSlotById(slotId);
    }
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
        if (!fields)
            return this.findBatchById(batchId);
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
        if (!fields)
            return;
        this.db.prepare(`
      UPDATE reconciliation_cases SET ${fields}
      WHERE case_id = @case_id
    `).run({ ...updates, case_id: caseId });
    }
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
        let runningCount = 0, completedCount = 0, stoppedCount = 0;
        let totalSlots = 0, pendingSlots = 0, submittedSlots = 0, verifiedSlots = 0, failedSlots = 0, unknownSlots = 0;
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
