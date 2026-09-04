import { describe, it, expect } from 'vitest';
import {
  validateAnalysisRunRecord,
  validateAnalysisRunMetadata,
  type AnalysisRunRecord,
  type AnalysisRunMetadata,
} from './analysis-runs';

describe('analysis-runs types', () => {
  describe('validateAnalysisRunRecord', () => {
    const validRun: AnalysisRunRecord = {
      runId: 'run-001',
      storeId: 'store-001',
      marketplace: 'US',
      currency: 'USD',
      reportSnapshotId: 'snapshot-001',
      status: 'completed',
      recommendationsCount: 5,
      createdAt: '2026-09-03T00:00:00Z',
      updatedAt: '2026-09-03T01:00:00Z',
    };

    it('should validate a valid analysis run', () => {
      expect(() => validateAnalysisRunRecord(validRun)).not.toThrow();
    });

    it('should require runId', () => {
      const invalid = { ...validRun, runId: '' };
      expect(() => validateAnalysisRunRecord(invalid as AnalysisRunRecord)).toThrow('runId is required');
    });

    it('should require storeId', () => {
      const invalid = { ...validRun, storeId: '' };
      expect(() => validateAnalysisRunRecord(invalid as AnalysisRunRecord)).toThrow('storeId is required');
    });

    it('should require reportSnapshotId', () => {
      const invalid = { ...validRun, reportSnapshotId: '' };
      expect(() => validateAnalysisRunRecord(invalid as AnalysisRunRecord)).toThrow('reportSnapshotId is required');
    });

    it('should validate marketplace is US', () => {
      const invalid = { ...validRun, marketplace: 'UK' as 'US' };
      expect(() => validateAnalysisRunRecord(invalid)).toThrow('US marketplace');
    });

    it('should validate currency is USD', () => {
      const invalid = { ...validRun, currency: 'EUR' as 'USD' };
      expect(() => validateAnalysisRunRecord(invalid)).toThrow('USD');
    });

    it('should validate status values', () => {
      const validStatuses = ['pending', 'analyzing', 'completed', 'failed', 'blocked'];
      validStatuses.forEach((status) => {
        const run = { ...validRun, status: status as AnalysisRunRecord['status'] };
        expect(() => validateAnalysisRunRecord(run)).not.toThrow();
      });

      const invalid = { ...validRun, status: 'invalid' as AnalysisRunRecord['status'] };
      expect(() => validateAnalysisRunRecord(invalid)).toThrow('status');
    });

    it('should validate recommendationsCount is non-negative', () => {
      const valid = { ...validRun, recommendationsCount: 0 };
      expect(() => validateAnalysisRunRecord(valid)).not.toThrow();

      const invalid = { ...validRun, recommendationsCount: -1 };
      expect(() => validateAnalysisRunRecord(invalid)).toThrow('non-negative');
    });

    it('should validate timestamps', () => {
      const invalidCreatedAt = { ...validRun, createdAt: 'invalid' };
      expect(() => validateAnalysisRunRecord(invalidCreatedAt)).toThrow('timestamp');

      const invalidUpdatedAt = { ...validRun, updatedAt: 'invalid' };
      expect(() => validateAnalysisRunRecord(invalidUpdatedAt)).toThrow('timestamp');
    });

    it('should validate optional missionId', () => {
      const withMission = { ...validRun, missionId: 'mission-001' };
      expect(() => validateAnalysisRunRecord(withMission)).not.toThrow();

      const emptyMission = { ...validRun, missionId: '' };
      expect(() => validateAnalysisRunRecord(emptyMission)).toThrow('missionId is required');
    });

    it('should validate optional blockedReason', () => {
      const withReason = { ...validRun, status: 'blocked' as const, blockedReason: 'Missing data' };
      expect(() => validateAnalysisRunRecord(withReason)).not.toThrow();

      const emptyReason = { ...validRun, status: 'blocked' as const, blockedReason: '' };
      expect(() => validateAnalysisRunRecord(emptyReason)).toThrow('blockedReason is required');
    });
  });

  describe('validateAnalysisRunMetadata', () => {
    const validMetadata: AnalysisRunMetadata = {
      productId: 'B001',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-03',
      ruleRevision: 'abc123',
      modelRevision: 'v1.0',
      proposalsGenerated: 10,
      skippedUnsupportedCount: 2,
    };

    it('should validate valid metadata', () => {
      expect(() => validateAnalysisRunMetadata(validMetadata)).not.toThrow();
    });

    it('should validate date format', () => {
      const invalidFrom = { ...validMetadata, dateFrom: '2026-13-01' };
      expect(() => validateAnalysisRunMetadata(invalidFrom)).toThrow('YYYY-MM-DD');

      const invalidTo = { ...validMetadata, dateTo: 'invalid' };
      expect(() => validateAnalysisRunMetadata(invalidTo)).toThrow('YYYY-MM-DD');
    });

    it('should validate date range order', () => {
      const inverted = { ...validMetadata, dateFrom: '2026-09-05', dateTo: '2026-09-01' };
      expect(() => validateAnalysisRunMetadata(inverted)).toThrow('inverted');
    });

    it('should validate counts are non-negative', () => {
      const invalidProposals = { ...validMetadata, proposalsGenerated: -1 };
      expect(() => validateAnalysisRunMetadata(invalidProposals)).toThrow('non-negative');

      const invalidSkipped = { ...validMetadata, skippedUnsupportedCount: -1 };
      expect(() => validateAnalysisRunMetadata(invalidSkipped)).toThrow('non-negative');
    });

    it('should validate AI summary', () => {
      const validAi: AnalysisRunMetadata = {
        ...validMetadata,
        aiSummary: {
          configured: true,
          invoked: true,
          source: 'ai',
          detail: 'Used GPT-4',
        },
      };
      expect(() => validateAnalysisRunMetadata(validAi)).not.toThrow();

      const invalidSource = {
        ...validMetadata,
        aiSummary: {
          configured: true,
          invoked: true,
          source: 'invalid' as 'ai',
          detail: 'test',
        },
      };
      expect(() => validateAnalysisRunMetadata(invalidSource)).toThrow('source');
    });

    it('should validate recommendation summary', () => {
      const validSummary: AnalysisRunMetadata = {
        ...validMetadata,
        recommendationSummary: {
          candidates: 10,
          created: 5,
          refreshed: 3,
          reused: 2,
        },
      };
      expect(() => validateAnalysisRunMetadata(validSummary)).not.toThrow();

      const invalidCount = {
        ...validMetadata,
        recommendationSummary: {
          candidates: -1,
          created: 5,
          refreshed: 3,
          reused: 2,
        },
      };
      expect(() => validateAnalysisRunMetadata(invalidCount)).toThrow('non-negative');
    });

    it('should validate error details', () => {
      const validError: AnalysisRunMetadata = {
        ...validMetadata,
        error: {
          code: 'MISSING_DATA',
          message: 'Required data not found',
          stack: 'Error stack trace',
        },
      };
      expect(() => validateAnalysisRunMetadata(validError)).not.toThrow();

      const missingCode = {
        ...validMetadata,
        error: {
          code: '',
          message: 'test',
        },
      };
      expect(() => validateAnalysisRunMetadata(missingCode)).toThrow('code is required');
    });

    it('should allow empty metadata', () => {
      expect(() => validateAnalysisRunMetadata()).not.toThrow();
    });
  });

  describe('AnalysisRunRecord type completeness', () => {
    it('should include all required fields', () => {
      const run: AnalysisRunRecord = {
        runId: 'run-001',
        storeId: 'store-001',
        marketplace: 'US',
        currency: 'USD',
        reportSnapshotId: 'snapshot-001',
        status: 'pending',
        recommendationsCount: 0,
        createdAt: '2026-09-03T00:00:00Z',
        updatedAt: '2026-09-03T00:00:00Z',
      };

      expect(run.runId).toBe('run-001');
      expect(run.status).toBe('pending');
    });

    it('should support all status values', () => {
      const statuses: AnalysisRunRecord['status'][] = [
        'pending',
        'analyzing',
        'completed',
        'failed',
        'blocked',
      ];

      statuses.forEach((status) => {
        const run: Partial<AnalysisRunRecord> = { status };
        expect(run.status).toBe(status);
      });
    });

    it('should support optional fields', () => {
      const fullRun: AnalysisRunRecord = {
        runId: 'run-001',
        storeId: 'store-001',
        marketplace: 'US',
        currency: 'USD',
        missionId: 'mission-001',
        reportSnapshotId: 'snapshot-001',
        status: 'completed',
        recommendationsCount: 5,
        blockedReason: 'Test reason',
        createdAt: '2026-09-03T00:00:00Z',
        updatedAt: '2026-09-03T01:00:00Z',
        startedAt: '2026-09-03T00:05:00Z',
        completedAt: '2026-09-03T01:00:00Z',
        metadata: {
          productId: 'B001',
          dateFrom: '2026-09-01',
          dateTo: '2026-09-03',
        },
      };

      expect(fullRun.missionId).toBe('mission-001');
      expect(fullRun.metadata?.productId).toBe('B001');
    });
  });
});
