// 各领域仓储保留各自原数据库连接与事务边界。
import type Database from 'better-sqlite3';

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
    constructor(private readonly db: Database.Database) { }
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
    `).get(storeId) as {
            count: number;
        };
        return result.count;
    }
}
