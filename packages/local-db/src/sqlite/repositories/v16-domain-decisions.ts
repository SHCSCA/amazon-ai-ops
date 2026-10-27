// 各领域仓储保留各自原数据库连接与事务边界。
import type Database from 'better-sqlite3';

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
    constructor(private readonly db: Database.Database) { }
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
        if (!fields)
            return this.findById(decisionId);
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
    transitionStatus(decisionId: string, newStatus: string, entryId: string, triggeredBy: 'system' | 'operator', reason?: string, metadata?: Record<string, unknown>): DecisionRow | null {
        const current = this.findById(decisionId);
        if (!current)
            return null;
        const fromStatus = current.status;
        const timestamp = new Date().toISOString();
        const now = timestamp;
        return this.db.transaction(() => {
            this.db.prepare(`
        UPDATE decisions_v16
        SET status = @status, updated_at = @updatedAt, revision = revision + 1
        WHERE decision_id = @decisionId
      `).run({ status: newStatus, updatedAt: now, decisionId });
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
        let proposedCount = 0, needsApprovalCount = 0, approvedCount = 0, rejectedCount = 0, blockedCount = 0, supersededCount = 0, executedCount = 0, verifiedCount = 0;
        for (const row of rows) {
            switch (row.status) {
                case 'proposed':
                    proposedCount++;
                    break;
                case 'needs_approval':
                    needsApprovalCount++;
                    break;
                case 'approved':
                    approvedCount++;
                    break;
                case 'rejected':
                    rejectedCount++;
                    break;
                case 'blocked':
                    blockedCount++;
                    break;
                case 'superseded':
                    supersededCount++;
                    break;
                case 'executed':
                    executedCount++;
                    break;
                case 'verified':
                    verifiedCount++;
                    break;
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
