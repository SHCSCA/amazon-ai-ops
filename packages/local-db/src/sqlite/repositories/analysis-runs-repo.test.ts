import { normalizeStoreId } from '@amazon-ai-ops/shared-types';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createAnalysisRunsRepository } from './analysis-runs-repo';
import type { AnalysisRunRecord } from '@amazon-ai-ops/shared-types';

describe('AnalysisRunsRepository', () => {
  let db: Database.Database;
  let repo: ReturnType<typeof createAnalysisRunsRepository>;

  beforeEach(() => {
    db = new Database(':memory:');
    
    db.exec(`
      CREATE TABLE stores (store_id TEXT PRIMARY KEY, marketplace TEXT NOT NULL, currency TEXT NOT NULL);
      INSERT INTO stores VALUES ('store-001', 'US', 'USD'), ('store-002', 'US', 'USD');
      CREATE TABLE analysis_runs (
        run_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        mission_id TEXT,
        report_snapshot_id TEXT NOT NULL,
        status TEXT NOT NULL,
        recommendations_count INTEGER NOT NULL DEFAULT 0,
        blocked_reason TEXT,
        started_at TEXT,
        completed_at TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      
      CREATE INDEX idx_analysis_runs_store ON analysis_runs(store_id);
      CREATE INDEX idx_analysis_runs_mission ON analysis_runs(mission_id);
      CREATE INDEX idx_analysis_runs_status ON analysis_runs(status);
    `);

    repo = createAnalysisRunsRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('should create a new analysis run', () => {
      const run: Omit<AnalysisRunRecord, 'createdAt' | 'updatedAt'> = {
        runId: 'run-001',
        storeId: normalizeStoreId('store-001'),
        marketplace: 'US',
        currency: 'USD',
        reportSnapshotId: 'snapshot-001',
        status: 'pending',
        recommendationsCount: 0,
      };

      const created = repo.create(run);

      expect(created.runId).toBe('run-001');
      expect(created.storeId).toBe('store-001');
      expect(created.status).toBe('pending');
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBeDefined();
    });

    it('should create run with optional fields', () => {
      const run: Omit<AnalysisRunRecord, 'createdAt' | 'updatedAt'> = {
        runId: 'run-002',
        storeId: normalizeStoreId('store-001'),
        marketplace: 'US',
        currency: 'USD',
        missionId: 'mission-001',
        reportSnapshotId: 'snapshot-001',
        status: 'analyzing',
        recommendationsCount: 5,
        startedAt: '2026-09-03T00:00:00Z',
        metadata: {
          productId: 'B001',
          dateFrom: '2026-09-01',
          dateTo: '2026-09-03',
        },
      };

      const created = repo.create(run);

      expect(created.missionId).toBe('mission-001');
      expect(created.startedAt).toBe('2026-09-03T00:00:00Z');
      expect(created.metadata?.productId).toBe('B001');
    });

    it('should validate run before creation', () => {
      const invalid = {
        runId: '',
        storeId: normalizeStoreId('store-001'),
        marketplace: 'US',
        currency: 'USD',
        reportSnapshotId: 'snapshot-001',
        status: 'pending',
        recommendationsCount: 0,
      } as any;

      expect(() => repo.create(invalid)).toThrow('runId is required');
    });
  });

  describe('update', () => {
    beforeEach(() => {
      repo.create({
        runId: 'run-001',
        storeId: normalizeStoreId('store-001'),
        marketplace: 'US',
        currency: 'USD',
        reportSnapshotId: 'snapshot-001',
        status: 'pending',
        recommendationsCount: 0,
      });
    });

    it('should update run status', () => {
      const updated = repo.update('run-001', { status: 'analyzing' });

      expect(updated).toBeDefined();
      expect(updated?.status).toBe('analyzing');
    });

    it('should update multiple fields', () => {
      const updated = repo.update('run-001', {
        status: 'completed',
        recommendationsCount: 10,
        completedAt: '2026-09-03T01:00:00Z',
      });

      expect(updated?.status).toBe('completed');
      expect(updated?.recommendationsCount).toBe(10);
      expect(updated?.completedAt).toBe('2026-09-03T01:00:00Z');
    });

    it('should update metadata', () => {
      const updated = repo.update('run-001', {
        metadata: {
          productId: 'B001',
          dateFrom: '2026-09-01',
          dateTo: '2026-09-03',
        },
      });

      expect(updated?.metadata?.productId).toBe('B001');
    });

    it('should return null for non-existent run', () => {
      const updated = repo.update('non-existent', { status: 'analyzing' });

      expect(updated).toBeNull();
    });

    it('should update updatedAt timestamp', async () => {
      const before = repo.findById('run-001');
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const updated = repo.update('run-001', { status: 'analyzing' });

      expect(updated?.updatedAt).not.toBe(before?.updatedAt);
    });
  });

  describe('findById', () => {
    it('should find existing run', () => {
      repo.create({
        runId: 'run-001',
        storeId: normalizeStoreId('store-001'),
        marketplace: 'US',
        currency: 'USD',
        reportSnapshotId: 'snapshot-001',
        status: 'pending',
        recommendationsCount: 0,
      });

      const found = repo.findById('run-001');

      expect(found).toBeDefined();
      expect(found?.runId).toBe('run-001');
    });

    it('should return null for non-existent run', () => {
      const found = repo.findById('non-existent');

      expect(found).toBeNull();
    });
  });

  describe('findByStoreId', () => {
    beforeEach(async () => {
      repo.create({
        runId: 'run-001',
        storeId: normalizeStoreId('store-001'),
        marketplace: 'US',
        currency: 'USD',
        reportSnapshotId: 'snapshot-001',
        status: 'pending',
        recommendationsCount: 0,
      });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      repo.create({
        runId: 'run-002',
        storeId: normalizeStoreId('store-001'),
        marketplace: 'US',
        currency: 'USD',
        reportSnapshotId: 'snapshot-002',
        status: 'completed',
        recommendationsCount: 5,
      });
      repo.create({
        runId: 'run-003',
        storeId: normalizeStoreId('store-002'),
        marketplace: 'US',
        currency: 'USD',
        reportSnapshotId: 'snapshot-003',
        status: 'pending',
        recommendationsCount: 0,
      });
    });

    it('should find runs by store ID', () => {
      const runs = repo.findByStoreId('store-001');

      expect(runs).toHaveLength(2);
      expect(runs[0].storeId).toBe('store-001');
      expect(runs[1].storeId).toBe('store-001');
    });

    it('should order by created_at DESC', () => {
      const runs = repo.findByStoreId('store-001');

      expect(runs[0].runId).toBe('run-002');
      expect(runs[1].runId).toBe('run-001');
    });

    it('should respect limit', () => {
      const runs = repo.findByStoreId('store-001', 1);

      expect(runs).toHaveLength(1);
    });

    it('should return empty array for non-existent store', () => {
      const runs = repo.findByStoreId('non-existent');

      expect(runs).toEqual([]);
    });
  });

  describe('findByMissionId', () => {
    beforeEach(() => {
      repo.create({
        runId: 'run-001',
        storeId: normalizeStoreId('store-001'),
        marketplace: 'US',
        currency: 'USD',
        missionId: 'mission-001',
        reportSnapshotId: 'snapshot-001',
        status: 'pending',
        recommendationsCount: 0,
      });
      repo.create({
        runId: 'run-002',
        storeId: normalizeStoreId('store-001'),
        marketplace: 'US',
        currency: 'USD',
        missionId: 'mission-001',
        reportSnapshotId: 'snapshot-002',
        status: 'completed',
        recommendationsCount: 5,
      });
    });

    it('should find runs by mission ID', () => {
      const runs = repo.findByMissionId('mission-001');

      expect(runs).toHaveLength(2);
      expect(runs[0].missionId).toBe('mission-001');
      expect(runs[1].missionId).toBe('mission-001');
    });

    it('should return empty array for non-existent mission', () => {
      const runs = repo.findByMissionId('non-existent');

      expect(runs).toEqual([]);
    });
  });

  describe('findLatestByStore', () => {
    beforeEach(async () => {
      repo.create({
        runId: 'run-001',
        storeId: normalizeStoreId('store-001'),
        marketplace: 'US',
        currency: 'USD',
        reportSnapshotId: 'snapshot-001',
        status: 'pending',
        recommendationsCount: 0,
      });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      repo.create({
        runId: 'run-002',
        storeId: normalizeStoreId('store-001'),
        marketplace: 'US',
        currency: 'USD',
        reportSnapshotId: 'snapshot-002',
        status: 'completed',
        recommendationsCount: 5,
      });
    });

    it('should find latest run for store', () => {
      const latest = repo.findLatestByStore('store-001');

      expect(latest).toBeDefined();
      expect(latest?.runId).toBe('run-002');
    });

    it('should return null for non-existent store', () => {
      const latest = repo.findLatestByStore('non-existent');

      expect(latest).toBeNull();
    });
  });

  describe('deleteById', () => {
    beforeEach(() => {
      repo.create({
        runId: 'run-001',
        storeId: normalizeStoreId('store-001'),
        marketplace: 'US',
        currency: 'USD',
        reportSnapshotId: 'snapshot-001',
        status: 'pending',
        recommendationsCount: 0,
      });
    });

    it('should delete existing run', () => {
      const deleted = repo.deleteById('run-001');

      expect(deleted).toBe(true);
      expect(repo.findById('run-001')).toBeNull();
    });

    it('should return false for non-existent run', () => {
      const deleted = repo.deleteById('non-existent');

      expect(deleted).toBe(false);
    });
  });

  describe('metadata serialization', () => {
    it('should serialize and deserialize metadata correctly', () => {
      const run = repo.create({
        runId: 'run-001',
        storeId: normalizeStoreId('store-001'),
        marketplace: 'US',
        currency: 'USD',
        reportSnapshotId: 'snapshot-001',
        status: 'pending',
        recommendationsCount: 0,
        metadata: {
          productId: 'B001',
          dateFrom: '2026-09-01',
          dateTo: '2026-09-03',
          proposalsGenerated: 10,
        },
      });

      const found = repo.findById('run-001');

      expect(found?.metadata).toEqual({
        productId: 'B001',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-03',
        proposalsGenerated: 10,
      });
    });

    it('should handle undefined metadata', () => {
      const run = repo.create({
        runId: 'run-001',
        storeId: normalizeStoreId('store-001'),
        marketplace: 'US',
        currency: 'USD',
        reportSnapshotId: 'snapshot-001',
        status: 'pending',
        recommendationsCount: 0,
      });

      const found = repo.findById('run-001');

      expect(found?.metadata).toBeUndefined();
    });
  });
});
