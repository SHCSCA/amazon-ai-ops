/**
 * V1.6 Mission Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { MissionRepository, MissionRow } from '@amazon-ai-ops/local-db/src/sqlite/repositories/v16-domain-repositories';
import { MissionService, MissionServiceError } from './v16-mission-service';

type MockRepo = Pick<MissionRepository, 'create' | 'findById' | 'findByStoreId' | 'findByStatus' | 'update'>;

describe('V16MissionService', () => {
  let service: MissionService;
  let repo: MockRepo;

  const storeContext: StoreContextEnvelope = {
    storeId: 'store-a',
    marketplace: 'US',
    currency: 'USD',
    businessDate: '2026-09-03',
    sessionGeneration: 1,
  };

  const baseMission: MissionRow = {
    mission_id: 'mission-1',
    store_id: 'store-a',
    mission_name: 'Test mission',
    description: null,
    product_ids: '["product-1"]',
    report_snapshot_id: 'snapshot-1',
    observation_window_start: null,
    observation_window_end: null,
    policy_version_id: null,
    policy_revision: null,
    stage: 'fact',
    status: 'draft',
    revision: 1,
    created_at: '2026-09-03T10:00:00Z',
    updated_at: '2026-09-03T10:00:00Z',
    started_at: null,
    completed_at: null,
    created_by: 'operator',
    last_modified_by: null,
    reason: null,
    metadata: null,
  };

  beforeEach(() => {
    repo = {
      create: vi.fn(),
      findById: vi.fn(),
      findByStoreId: vi.fn(),
      findByStatus: vi.fn(),
      update: vi.fn(),
    };
    service = new MissionService(repo as unknown as MissionRepository);
  });

  describe('createMission', () => {
    it('creates a new mission with store context', () => {
      repo.create.mockImplementation((m) => m as MissionRow);

      const result = service.createMission({
        storeContext,
        name: 'Test',
        productIds: ['product-1'],
        reportSnapshotId: 'snapshot-1',
      });

      expect(result.mission_id).toMatch(/^mission_/);
      expect(result.store_id).toBe('store-a');
      expect(result.status).toBe('draft');
      expect(result.stage).toBe('fact');
      expect(result.product_ids).toBe('["product-1"]');
    });
  });

  describe('getMission', () => {
    it('returns mission when found in same store', () => {
      repo.findById.mockReturnValue(baseMission);

      const result = service.getMission({ storeContext, missionId: 'mission-1' });

      expect(result).toEqual(baseMission);
    });

    it('returns null when mission not found', () => {
      repo.findById.mockReturnValue(null);

      expect(service.getMission({ storeContext, missionId: 'missing' })).toBeNull();
    });

    it('throws STORE_MISMATCH for different store', () => {
      repo.findById.mockReturnValue({ ...baseMission, store_id: 'store-b' });

      expect(() => service.getMission({ storeContext, missionId: 'mission-1' }))
        .toThrow(MissionServiceError);
    });
  });

  describe('listMissions', () => {
    it('returns missions for store', () => {
      repo.findByStoreId.mockReturnValue([baseMission]);

      const result = service.listMissions({ storeContext });

      expect(result).toHaveLength(1);
    });

    it('filters by status', () => {
      repo.findByStatus.mockReturnValue([baseMission]);

      service.listMissions({ storeContext, status: 'active' });

      expect(repo.findByStatus).toHaveBeenCalledWith('store-a', 'active');
    });
  });

  describe('startMission', () => {
    it('starts a draft mission', () => {
      repo.findById.mockReturnValue(baseMission);
      repo.update.mockReturnValue({ ...baseMission, status: 'active' });

      const result = service.startMission({ storeContext, missionId: 'mission-1' });

      expect(result?.status).toBe('active');
    });

    it('throws INVALID_TRANSITION for already active mission', () => {
      repo.findById.mockReturnValue({ ...baseMission, status: 'active' });

      expect(() => service.startMission({ storeContext, missionId: 'mission-1' }))
        .toThrow(MissionServiceError);
    });
  });

  describe('pauseMission', () => {
    it('pauses active mission', () => {
      repo.findById.mockReturnValue({ ...baseMission, status: 'active' });
      repo.update.mockReturnValue({ ...baseMission, status: 'paused' });

      const result = service.pauseMission({ storeContext, missionId: 'mission-1' });

      expect(result?.status).toBe('paused');
    });

    it('throws INVALID_TRANSITION for non-active mission', () => {
      repo.findById.mockReturnValue(baseMission);

      expect(() => service.pauseMission({ storeContext, missionId: 'mission-1' }))
        .toThrow(MissionServiceError);
    });
  });

  describe('blockMission', () => {
    it('blocks active mission with reason', () => {
      repo.findById.mockReturnValue({ ...baseMission, status: 'active' });
      repo.update.mockReturnValue({ ...baseMission, status: 'blocked', reason: 'incomplete data' });

      const result = service.blockMission({
        storeContext,
        missionId: 'mission-1',
        reason: 'incomplete data',
      });

      expect(result?.status).toBe('blocked');
      expect(result?.reason).toBe('incomplete data');
    });

    it('throws TERMINAL_STATE for completed mission', () => {
      repo.findById.mockReturnValue({ ...baseMission, status: 'completed' });

      expect(() => service.blockMission({ storeContext, missionId: 'mission-1', reason: 'x' }))
        .toThrow(MissionServiceError);
    });
  });

  describe('completeMission', () => {
    it('completes active mission', () => {
      repo.findById.mockReturnValue({ ...baseMission, status: 'active' });
      repo.update.mockReturnValue({ ...baseMission, status: 'completed', stage: 'effect' });

      const result = service.completeMission({ storeContext, missionId: 'mission-1' });

      expect(result?.status).toBe('completed');
      expect(result?.stage).toBe('effect');
    });

    it('throws TERMINAL_STATE for already completed mission', () => {
      repo.findById.mockReturnValue({ ...baseMission, status: 'completed' });

      expect(() => service.completeMission({ storeContext, missionId: 'mission-1' }))
        .toThrow(MissionServiceError);
    });
  });

  describe('advanceStage', () => {
    it('advances from fact to analysis', () => {
      repo.findById.mockReturnValue(baseMission);
      repo.update.mockReturnValue({ ...baseMission, stage: 'analysis' });

      const result = service.advanceStage({
        storeContext,
        missionId: 'mission-1',
        targetStage: 'analysis',
      });

      expect(result?.stage).toBe('analysis');
    });

    it('denies invalid transitions', () => {
      repo.findById.mockReturnValue({ ...baseMission, stage: 'fact' });

      expect(() => service.advanceStage({
        storeContext,
        missionId: 'mission-1',
        targetStage: 'decision', // skip analysis
      })).toThrow(MissionServiceError);
    });

    it('blocks can transition from any non-terminal stage', () => {
      repo.findById.mockReturnValue({ ...baseMission, stage: 'analysis', status: 'active' });
      repo.update.mockReturnValue({ ...baseMission, stage: 'blocked', status: 'blocked', reason: 'gate failure' });

      const result = service.advanceStage({
        storeContext,
        missionId: 'mission-1',
        targetStage: 'blocked',
        reason: 'gate failure',
      });

      expect(result?.stage).toBe('blocked');
      expect(result?.status).toBe('blocked');
    });

    it('denies transition from completed mission', () => {
      repo.findById.mockReturnValue({ ...baseMission, status: 'completed' });

      expect(() => service.advanceStage({
        storeContext,
        missionId: 'mission-1',
        targetStage: 'analysis',
      })).toThrow(MissionServiceError);
    });

    it('completes when advancing to effect stage', () => {
      repo.findById.mockReturnValue({ ...baseMission, stage: 'readback', status: 'active' });
      repo.update.mockReturnValue({ ...baseMission, stage: 'effect', status: 'completed', completed_at: '2026-09-03T11:00:00Z' });

      const result = service.advanceStage({
        storeContext,
        missionId: 'mission-1',
        targetStage: 'effect',
      });

      expect(result?.status).toBe('completed');
      expect(result?.stage).toBe('effect');
    });
  });

  describe('archiveMission', () => {
    it('archives any mission', () => {
      repo.findById.mockReturnValue(baseMission);
      repo.update.mockReturnValue({ ...baseMission, status: 'archived' });

      const result = service.archiveMission({ storeContext, missionId: 'mission-1' });

      expect(result?.status).toBe('archived');
    });
  });
});
