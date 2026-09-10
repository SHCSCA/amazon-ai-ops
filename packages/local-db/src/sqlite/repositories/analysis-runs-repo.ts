import type Database from 'better-sqlite3';
import {
  type AnalysisRunRecord,
  type AnalysisRunMetadata,
  validateAnalysisRunRecord,
  validateAnalysisRunMetadata,
} from '@amazon-ai-ops/shared-types';

export interface AnalysisRunsRepository {
  create(run: Omit<AnalysisRunRecord, 'createdAt' | 'updatedAt'>): AnalysisRunRecord;
  update(
    runId: string,
    updates: Partial<Omit<AnalysisRunRecord, 'runId' | 'createdAt'>>
  ): AnalysisRunRecord | null;
  findById(runId: string): AnalysisRunRecord | null;
  findByStoreId(storeId: string, limit?: number, offset?: number): AnalysisRunRecord[];
  findByMissionId(missionId: string): AnalysisRunRecord[];
  findLatestByStore(storeId: string): AnalysisRunRecord | null;
  deleteById(runId: string): boolean;
}

export function createAnalysisRunsRepository(db: Database.Database): AnalysisRunsRepository {
  function rowToRecord(row: any): AnalysisRunRecord {
    const record: AnalysisRunRecord = {
      runId: row.run_id,
      storeId: row.store_id,
      marketplace: row.marketplace,
      currency: row.currency,
      reportSnapshotId: row.report_snapshot_id,
      status: row.status,
      recommendationsCount: row.recommendations_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    if (row.mission_id) {
      record.missionId = row.mission_id;
    }
    if (row.blocked_reason) {
      record.blockedReason = row.blocked_reason;
    }
    if (row.started_at) {
      record.startedAt = row.started_at;
    }
    if (row.completed_at) {
      record.completedAt = row.completed_at;
    }
    if (row.metadata) {
      record.metadata = JSON.parse(row.metadata);
    }

    validateAnalysisRunRecord(record);
    return record;
  }

  function create(run: Omit<AnalysisRunRecord, 'createdAt' | 'updatedAt'>): AnalysisRunRecord {
    const now = new Date().toISOString();
    validateAnalysisRunRecord({ ...run, createdAt: now, updatedAt: now });
    const store = db.prepare('SELECT marketplace, currency FROM stores WHERE store_id = ?').get(run.storeId) as { marketplace: string; currency: string } | undefined;
    if (!store || store.marketplace !== run.marketplace || store.currency !== run.currency) throw new Error('Analysis run store identity mismatch.');
    const metadata = run.metadata ? JSON.stringify(run.metadata) : null;

    if (run.metadata) {
      validateAnalysisRunMetadata(run.metadata);
    }

    const stmt = db.prepare(`
      INSERT INTO analysis_runs (
        run_id, store_id, mission_id,
        report_snapshot_id, status, recommendations_count,
        blocked_reason, started_at, completed_at, metadata,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      run.runId,
      run.storeId,
      run.missionId || null,
      run.reportSnapshotId,
      run.status,
      run.recommendationsCount,
      run.blockedReason || null,
      run.startedAt || null,
      run.completedAt || null,
      metadata,
      now,
      now
    );

    const created: AnalysisRunRecord = {
      ...run,
      createdAt: now,
      updatedAt: now,
    };

    validateAnalysisRunRecord(created);
    return created;
  }

  function update(
    runId: string,
    updates: Partial<Omit<AnalysisRunRecord, 'runId' | 'createdAt'>>
  ): AnalysisRunRecord | null {
    const existing = findById(runId);
    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    validateAnalysisRunRecord({ ...existing, ...updates, updatedAt: now });
    const metadata =
      updates.metadata !== undefined ? JSON.stringify(updates.metadata) : undefined;

    if (updates.metadata) {
      validateAnalysisRunMetadata(updates.metadata);
    }

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.recommendationsCount !== undefined) {
      fields.push('recommendations_count = ?');
      values.push(updates.recommendationsCount);
    }
    if (updates.blockedReason !== undefined) {
      fields.push('blocked_reason = ?');
      values.push(updates.blockedReason || null);
    }
    if (updates.startedAt !== undefined) {
      fields.push('started_at = ?');
      values.push(updates.startedAt || null);
    }
    if (updates.completedAt !== undefined) {
      fields.push('completed_at = ?');
      values.push(updates.completedAt || null);
    }
    if (metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(metadata);
    }

    fields.push('updated_at = ?');
    values.push(now);

    values.push(runId);

    const stmt = db.prepare(`
      UPDATE analysis_runs
      SET ${fields.join(', ')}
      WHERE run_id = ?
    `);

    stmt.run(...values);
    return findById(runId);
  }

  function findById(runId: string): AnalysisRunRecord | null {
    const stmt = db.prepare(`
      SELECT runs.*, stores.marketplace, stores.currency FROM analysis_runs AS runs
      JOIN stores ON stores.store_id = runs.store_id WHERE run_id = ?
    `);
    const row = stmt.get(runId);
    return row ? rowToRecord(row) : null;
  }

  function findByStoreId(storeId: string, limit = 50, offset = 0): AnalysisRunRecord[] {
    const stmt = db.prepare(`
      SELECT runs.*, stores.marketplace, stores.currency FROM analysis_runs AS runs
      JOIN stores ON stores.store_id = runs.store_id WHERE runs.store_id = ?
      ORDER BY runs.created_at DESC, run_id DESC
      LIMIT ? OFFSET ?
    `);
    const rows = stmt.all(storeId, limit, offset);
    return rows.map(rowToRecord);
  }

  function findByMissionId(missionId: string): AnalysisRunRecord[] {
    const stmt = db.prepare(`
      SELECT runs.*, stores.marketplace, stores.currency FROM analysis_runs AS runs
      JOIN stores ON stores.store_id = runs.store_id WHERE mission_id = ?
      ORDER BY runs.created_at DESC, run_id DESC
    `);
    const rows = stmt.all(missionId);
    return rows.map(rowToRecord);
  }

  function findLatestByStore(storeId: string): AnalysisRunRecord | null {
    const stmt = db.prepare(`
      SELECT runs.*, stores.marketplace, stores.currency FROM analysis_runs AS runs
      JOIN stores ON stores.store_id = runs.store_id WHERE runs.store_id = ?
      ORDER BY runs.created_at DESC, run_id DESC
      LIMIT 1
    `);
    const row = stmt.get(storeId);
    return row ? rowToRecord(row) : null;
  }

  function deleteById(runId: string): boolean {
    const stmt = db.prepare('DELETE FROM analysis_runs WHERE run_id = ?');
    const info = stmt.run(runId);
    return info.changes > 0;
  }

  return {
    create,
    update,
    findById,
    findByStoreId,
    findByMissionId,
    findLatestByStore,
    deleteById,
  };
}
