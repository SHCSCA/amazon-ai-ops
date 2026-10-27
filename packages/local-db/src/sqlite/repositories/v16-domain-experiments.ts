// 各领域仓储保留各自原数据库连接与事务边界。
import type Database from 'better-sqlite3';

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
    constructor(private readonly db: Database.Database) { }
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
        if (!fields)
            return this.findById(experimentId);
        const now = new Date().toISOString();
        this.db.prepare(`
      UPDATE experiments_v16 SET ${fields}, updated_at = @updatedAt
      WHERE experiment_id = @experiment_id
    `).run({ ...updates, updatedAt: now, experiment_id: experimentId });
        return this.findById(experimentId);
    }
}
