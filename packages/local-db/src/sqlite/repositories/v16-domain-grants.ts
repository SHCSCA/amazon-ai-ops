// 各领域仓储保留各自原数据库连接与事务边界。
import type Database from 'better-sqlite3';

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
    constructor(private readonly db: Database.Database) { }
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
        if (!fields)
            return this.findById(grantId);
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
