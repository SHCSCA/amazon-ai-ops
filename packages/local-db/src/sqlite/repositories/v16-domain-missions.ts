// 各领域仓储保留各自原数据库连接与事务边界。
import type Database from 'better-sqlite3';

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
    constructor(private readonly db: Database.Database) { }
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
        if (!fields)
            return this.findById(missionId);
        const now = new Date().toISOString();
        this.db.prepare(`
      UPDATE v16_missions SET ${fields}, updated_at = @updatedAt
      WHERE mission_id = @mission_id
    `).run({ ...updates, updatedAt: now, mission_id: missionId });
        return this.findById(missionId);
    }
}
