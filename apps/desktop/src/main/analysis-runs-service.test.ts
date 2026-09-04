/**
 * Analysis Runs Service Tests
 *
 * Tests business logic for Analysis Run lifecycle management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnalysisRunRecord, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { AnalysisRunsRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/analysis-runs-repo';
import {
  AnalysisRunsService,
  AnalysisRunsServiceError,
  computeFingerprint,
} from './analysis-runs-service';

type MockRepo = Pick<
  AnalysisRunsRepository,
  'create' | 'update' | 'findById' | 'findByStoreId' | 'findByMissionId'
>;

describe('AnalysisRunsService', () => {
  let service: AnalysisRunsService;
  let repo: MockRepo;

  const storeContext: StoreContextEnvelope = {
    storeId: 'store-a',
    marketplace: 'US',
    currency: 'USD',
    businessDate: '2026-09-03',
    sessionGeneration: 1,
  };

  const mockRun: AnalysisRunRecord = {
    runId: 'run_1',
    storeId: 'store-a',
    marketplace: 'US',
    currency: 'USD',
    reportSnapshotId: 'snapshot-1',
    status: 'pending',
    recommendationsCount: 0,
    createdAt: '2026-09-03T10:00:00Z',
    updatedAt: '2026-09-03T10:00:00Z',
  };

  beforeEach(() => {
    repo = {
      create: vi.fn(),
      update: vi.fn(),
      findById: vi.fn(),
      findByStoreId: vi.fn(),
      findByMissionId: vi.fn(),
    };
    service = new AnalysisRunsService(repo as unknown as AnalysisRunsRepository);
  });

  describe('computeFingerprint', () => {
    it('produces same fingerprint for identical inputs', () => {
      const input = {
        storeId: 'store-a',
        productId: 'product-1',
        reportSnapshotId: 'snapshot-1',
      };
      const fp1 = computeFingerprint(input);
      const fp2 = computeFingerprint(input);
      expect(fp1).toBe(fp2);
      expect(fp1).toMatch(/^fp_[a-z0-9]+$/);
    });

    it('produces different fingerprint for different inputs', () => {
      const fp1 = computeFingerprint({
        storeId: 'store-a',
        productId: 'product-1',
        reportSnapshotId: 'snapshot-1',
      });
      const fp2 = computeFingerprint({
        storeId: 'store-a',
        productId: 'product-2',
        reportSnapshotId: 'snapshot-1',
      });
      expect(fp1).not.toBe(fp2);
    });

    it('ignores undefined optional fields', () => {
      const fp1 = computeFingerprint({
        storeId: 'store-a',
        productId: 'product-1',
        reportSnapshotId: 'snapshot-1',
      });
      const fp2 = computeFingerprint({
        storeId: 'store-a',
        productId: 'product-1',
        reportSnapshotId: 'snapshot-1',
        missionId: undefined,
        policyRevision: undefined,
        modelRevision: undefined,
      });
      expect(fp1).toBe(fp2);
    });
  });

  describe('createRun', () => {
    it('creates a new run with fingerprint', () => {
      repo.findByStoreId.mockReturnValue([]);
      repo.create.mockImplementation((run) => ({ ...run, createdAt: '2026-09-03T10:00:00Z', updatedAt: '2026-09-03T10:00:00Z' }) as AnalysisRunRecord);

      const result = service.createRun({
        storeContext,
        reportSnapshotId: 'snapshot-1',
        productId: 'product-1',
        missionId: 'mission-1',
      });

      expect(result.runId).toMatch(/^run_/);
      expect(result.missionId).toBe('mission-1');
      expect(result.metadata?.fingerprint).toMatch(/^fp_/);
      expect(result.metadata?.productId).toBe('product-1');
      expect(repo.create).toHaveBeenCalled();
    });

    it('throws REUSE_DETECTED for duplicate fingerprint', () => {
      // Compute the actual fingerprint for these inputs
      const fingerprint = computeFingerprint({
        storeId: 'store-a',
        productId: 'product-1',
        reportSnapshotId: 'snapshot-1',
      });
      const existingRun = {
        ...mockRun,
        metadata: { fingerprint },
      };
      repo.findByStoreId.mockReturnValue([existingRun]);

      expect(() => service.createRun({
        storeContext,
        reportSnapshotId: 'snapshot-1',
        productId: 'product-1',
      })).toThrow(AnalysisRunsServiceError);

      try {
        service.createRun({
          storeContext,
          reportSnapshotId: 'snapshot-1',
          productId: 'product-1',
        });
      } catch (e) {
        expect((e as AnalysisRunsServiceError).code).toBe('REUSE_DETECTED');
      }
    });

    it('creates run without missionId', () => {
      repo.findByStoreId.mockReturnValue([]);
      repo.create.mockReturnValue({ ...mockRun, runId: 'run_new' });

      const result = service.createRun({
        storeContext,
        reportSnapshotId: 'snapshot-1',
      });

      expect(result.runId).toBe('run_new');
      expect(result.missionId).toBeUndefined();
    });
  });

  describe('startRun', () => {
    it('transitions pending run to analyzing', () => {
      repo.findById.mockReturnValue(mockRun);
      const startedRun = { ...mockRun, status: 'analyzing' as const, startedAt: '2026-09-03T10:05:00Z' };
      repo.update.mockReturnValue(startedRun);

      const result = service.startRun({ storeContext, runId: 'run_1' });

      expect(result.status).toBe('analyzing');
      expect(result.startedAt).toBeDefined();
    });

    it('throws INVALID_TRANSITION for non-pending run', () => {
      repo.findById.mockReturnValue({ ...mockRun, status: 'analyzing' as const });

      expect(() => service.startRun({ storeContext, runId: 'run_1' }))
        .toThrow(AnalysisRunsServiceError);

      try {
        service.startRun({ storeContext, runId: 'run_1' });
      } catch (e) {
        expect((e as AnalysisRunsServiceError).code).toBe('INVALID_TRANSITION');
      }
    });

    it('throws RUN_NOT_FOUND for missing run', () => {
      repo.findById.mockReturnValue(null);

      expect(() => service.startRun({ storeContext, runId: 'nonexistent' }))
        .toThrow(AnalysisRunsServiceError);
    });

    it('throws STORE_MISMATCH for different store', () => {
      repo.findById.mockReturnValue({ ...mockRun, storeId: 'store-b' });

      expect(() => service.startRun({ storeContext, runId: 'run_1' }))
        .toThrow(AnalysisRunsServiceError);
    });
  });

  describe('updateStage', () => {
    it('updates run with new status and metadata', () => {
      repo.findById.mockReturnValue(mockRun);
      const updated = { ...mockRun, status: 'analyzing' as const, recommendationsCount: 5 };
      repo.update.mockReturnValue(updated);

      const result = service.updateStage({
        storeContext,
        runId: 'run_1',
        status: 'analyzing',
        recommendationsCount: 5,
      });

      expect(result.status).toBe('analyzing');
      expect(result.recommendationsCount).toBe(5);
    });

    it('updates blockedReason', () => {
      repo.findById.mockReturnValue(mockRun);
      const blocked = { ...mockRun, status: 'blocked' as const, blockedReason: 'Missing data' };
      repo.update.mockReturnValue(blocked);

      const result = service.updateStage({
        storeContext,
        runId: 'run_1',
        status: 'blocked',
        blockedReason: 'Missing data',
      });

      expect(result.blockedReason).toBe('Missing data');
    });
  });

  describe('completeRun', () => {
    it('marks run as completed with recommendations count', () => {
      repo.findById.mockReturnValue(mockRun);
      const completed = {
        ...mockRun,
        status: 'completed' as const,
        recommendationsCount: 10,
        completedAt: '2026-09-03T10:30:00Z',
      };
      repo.update.mockReturnValue(completed);

      const result = service.completeRun({
        storeContext,
        runId: 'run_1',
        recommendationsCount: 10,
      });

      expect(result.status).toBe('completed');
      expect(result.recommendationsCount).toBe(10);
      expect(result.completedAt).toBeDefined();
    });
  });

  describe('failRun', () => {
    it('marks run as failed with reason', () => {
      repo.findById.mockReturnValue(mockRun);
      const failed = {
        ...mockRun,
        status: 'failed' as const,
        blockedReason: 'AI provider timeout',
        completedAt: '2026-09-03T10:30:00Z',
      };
      repo.update.mockReturnValue(failed);

      const result = service.failRun({
        storeContext,
        runId: 'run_1',
        reason: 'AI provider timeout',
      });

      expect(result.status).toBe('failed');
      expect(result.blockedReason).toBe('AI provider timeout');
    });
  });

  describe('blockRun', () => {
    it('marks run as blocked with reason', () => {
      repo.findById.mockReturnValue(mockRun);
      const blocked = { ...mockRun, status: 'blocked' as const, blockedReason: '7/8 reports' };
      repo.update.mockReturnValue(blocked);

      const result = service.blockRun({
        storeContext,
        runId: 'run_1',
        reason: '7/8 reports',
      });

      expect(result.status).toBe('blocked');
      expect(result.blockedReason).toBe('7/8 reports');
    });
  });

  describe('getRun', () => {
    it('returns run when found in same store', () => {
      repo.findById.mockReturnValue(mockRun);

      const result = service.getRun({ storeContext, runId: 'run_1' });

      expect(result).toEqual(mockRun);
    });

    it('returns null when run not found', () => {
      repo.findById.mockReturnValue(null);

      const result = service.getRun({ storeContext, runId: 'nonexistent' });

      expect(result).toBeNull();
    });

    it('throws STORE_MISMATCH for different store', () => {
      repo.findById.mockReturnValue({ ...mockRun, storeId: 'store-b' });

      expect(() => service.getRun({ storeContext, runId: 'run_1' }))
        .toThrow(AnalysisRunsServiceError);
    });
  });

  describe('listRuns', () => {
    it('returns runs for current store', () => {
      const runs = [mockRun, { ...mockRun, runId: 'run_2' }];
      repo.findByStoreId.mockReturnValue(runs);

      const result = service.listRuns({ storeContext });

      expect(result).toHaveLength(2);
    });

    it('filters by missionId', () => {
      const runInMission = { ...mockRun, runId: 'run_2', missionId: 'mission-1' };
      repo.findByStoreId.mockReturnValue([mockRun, runInMission]);
      repo.findByMissionId.mockReturnValue([runInMission]);

      const result = service.listRuns({ storeContext, missionId: 'mission-1' });

      expect(result).toHaveLength(1);
      expect(result[0].missionId).toBe('mission-1');
    });

    it('filters by status', () => {
      const completed = { ...mockRun, runId: 'run_2', status: 'completed' as const };
      repo.findByStoreId.mockReturnValue([mockRun, completed]);

      const result = service.listRuns({ storeContext, status: 'completed' });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('completed');
    });

    it('respects limit parameter', () => {
      repo.findByStoreId.mockReturnValue([mockRun]);

      service.listRuns({ storeContext, limit: 10 });

      expect(repo.findByStoreId).toHaveBeenCalledWith('store-a', 10);
    });

    it('defaults limit to 50', () => {
      repo.findByStoreId.mockReturnValue([]);

      service.listRuns({ storeContext });

      expect(repo.findByStoreId).toHaveBeenCalledWith('store-a', 50);
    });
  });

  describe('findReusedRun', () => {
    it('returns run with matching fingerprint', () => {
      const reusedRun = { ...mockRun, metadata: { fingerprint: 'fp_abc123' } };
      repo.findByStoreId.mockReturnValue([reusedRun]);

      const result = service.findReusedRun({
        storeContext,
        fingerprint: 'fp_abc123',
      });

      expect(result).toEqual(reusedRun);
    });

    it('returns null when no matching fingerprint', () => {
      repo.findByStoreId.mockReturnValue([mockRun]);

      const result = service.findReusedRun({
        storeContext,
        fingerprint: 'fp_nonexistent',
      });

      expect(result).toBeNull();
    });
  });
});
