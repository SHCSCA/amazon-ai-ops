/**
 * V1.6 Experiment Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ExperimentService,
  ExperimentServiceError,
  type ExperimentRepository,
  type CreateExperimentInput,
} from './v16-experiment-service';
import type { ExperimentRecord } from '@amazon-ai-ops/shared-types';

describe('ExperimentService', () => {
  let service: ExperimentService;
  let mockRepo: ExperimentRepository;

  beforeEach(() => {
    mockRepo = {
      findById: vi.fn(),
      findByStore: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };
    service = new ExperimentService(mockRepo);
  });

  describe('createExperiment', () => {
    it('creates a valid experiment in draft status', async () => {
      const input: CreateExperimentInput = {
        experimentId: 'exp-001',
        storeId: 'jf-us',
        missionId: 'mission-001',
        name: 'Bid Increase Test',
        description: 'Testing bid increase impact on conversion',
        hypothesis: 'Increasing bids will improve conversion',
        variants: [
          { variantId: 'v1', name: 'Control', allocation: 0.5 },
          { variantId: 'v2', name: 'Treatment', allocation: 0.5 },
        ],
        startDate: '2026-09-10',
        endDate: '2026-09-20',
        marketplace: 'US',
        currency: 'USD',
      };

      const result = await service.createExperiment(input);

      expect(result.experimentId).toBe('exp-001');
      expect(result.status).toBe('draft');
      expect(result.revision).toBe(1);
      expect(result.variants).toHaveLength(2);
      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        experimentId: 'exp-001',
        storeId: 'jf-us',
        status: 'draft',
      }));
    });

    it('rejects invalid experiment data', async () => {
      const input: CreateExperimentInput = {
        experimentId: '',
        storeId: 'jf-us',
        missionId: 'mission-001',
        name: 'Test',
        hypothesis: 'Test',
        variants: [],
        startDate: '2026-09-10',
        endDate: '2026-09-20',
        marketplace: 'US',
        currency: 'USD',
      };

      await expect(service.createExperiment(input)).rejects.toThrow(ExperimentServiceError);
    });
  });

  describe('activateExperiment', () => {
    it('transitions draft to active', async () => {
      const existing: ExperimentRecord = {
        experimentId: 'exp-001',
        storeId: 'jf-us',
        missionId: 'mission-001',
        name: 'Test Experiment',
        hypothesis: { statement: 'Test hypothesis', expectedEffect: 'Positive impact' },
        productIds: [],
        entityIds: [],
        observationSnapshots: [],
        guardrails: [],
        guardrailsTriggered: [],
        variants: [{ variantId: 'v1', name: 'Control', allocation: 1.0 }],
        status: 'draft',
        startDate: '2026-09-10',
        endDate: '2026-09-20',
        marketplace: 'US',
        currency: 'USD',
        revision: 1,
        createdAt: '2026-09-03T10:00:00Z',
        updatedAt: '2026-09-03T10:00:00Z',
      };

      (mockRepo.findById as any).mockResolvedValue(existing);

      const result = await service.activateExperiment({
        experimentId: 'exp-001',
        activatedBy: 'operator-001',
      });

      expect(result.status).toBe('active');
      expect(result.activatedBy).toBe('operator-001');
      expect(result.activatedAt).toBeDefined();
      expect(result.revision).toBe(2);
      expect(mockRepo.update).toHaveBeenCalled();
    });

    it('rejects activation from non-draft status', async () => {
      const existing: ExperimentRecord = {
        experimentId: 'exp-001',
        storeId: 'jf-us',
        missionId: 'mission-001',
        name: 'Test Experiment',
        hypothesis: { statement: 'Test', expectedEffect: 'Impact' },
        productIds: [],
        entityIds: [],
        observationSnapshots: [],
        guardrails: [],
        guardrailsTriggered: [],
        variants: [],
        status: 'active',
        startDate: '2026-09-10',
        endDate: '2026-09-20',
        marketplace: 'US',
        currency: 'USD',
        revision: 1,
        createdAt: '2026-09-03T10:00:00Z',
        updatedAt: '2026-09-03T10:00:00Z',
      };

      (mockRepo.findById as any).mockResolvedValue(existing);

      await expect(
        service.activateExperiment({ experimentId: 'exp-001', activatedBy: 'op' })
      ).rejects.toThrow('Cannot activate experiment in active status');
    });
  });

  describe('completeExperiment', () => {
    it('transitions active to completed with outcome', async () => {
      const existing: ExperimentRecord = {
        experimentId: 'exp-001',
        storeId: 'jf-us',
        missionId: 'mission-001',
        name: 'Test Experiment',
        hypothesis: { statement: 'Test', expectedEffect: 'Impact' },
        productIds: [],
        entityIds: [],
        observationSnapshots: [],
        guardrails: [],
        guardrailsTriggered: [],
        variants: [],
        status: 'active',
        startDate: '2026-09-10',
        endDate: '2026-09-20',
        marketplace: 'US',
        currency: 'USD',
        activatedBy: 'op',
        activatedAt: '2026-09-10T00:00:00Z',
        revision: 2,
        createdAt: '2026-09-03T10:00:00Z',
        updatedAt: '2026-09-10T00:00:00Z',
      };

      (mockRepo.findById as any).mockResolvedValue(existing);

      const result = await service.completeExperiment({
        experimentId: 'exp-001',
        completedBy: 'operator-001',
        outcome: 'success',
        learnings: 'Treatment improved conversion by 15%',
      });

      expect(result.status).toBe('completed');
      expect(result.completedBy).toBe('operator-001');
      expect(result.outcome).toBe('success');
      expect(result.learnings).toBe('Treatment improved conversion by 15%');
      expect(result.revision).toBe(3);
    });

    it('rejects completion from non-active status', async () => {
      const existing: ExperimentRecord = {
        experimentId: 'exp-001',
        storeId: 'jf-us',
        missionId: 'mission-001',
        name: 'Test Experiment',
        hypothesis: { statement: 'Test', expectedEffect: 'Impact' },
        productIds: [],
        entityIds: [],
        observationSnapshots: [],
        guardrails: [],
        guardrailsTriggered: [],
        variants: [],
        status: 'draft',
        startDate: '2026-09-10',
        endDate: '2026-09-20',
        marketplace: 'US',
        currency: 'USD',
        revision: 1,
        createdAt: '2026-09-03T10:00:00Z',
        updatedAt: '2026-09-03T10:00:00Z',
      };

      (mockRepo.findById as any).mockResolvedValue(existing);

      await expect(
        service.completeExperiment({
          experimentId: 'exp-001',
          completedBy: 'op',
          outcome: 'success',
        })
      ).rejects.toThrow('Cannot complete experiment in draft status');
    });
  });

  describe('terminateExperiment', () => {
    it('terminates draft or active experiment', async () => {
      const existing: ExperimentRecord = {
        experimentId: 'exp-001',
        storeId: 'jf-us',
        missionId: 'mission-001',
        name: 'Test Experiment',
        hypothesis: { statement: 'Test', expectedEffect: 'Impact' },
        productIds: [],
        entityIds: [],
        observationSnapshots: [],
        guardrails: [],
        guardrailsTriggered: [],
        variants: [],
        status: 'active',
        startDate: '2026-09-10',
        endDate: '2026-09-20',
        marketplace: 'US',
        currency: 'USD',
        activatedBy: 'op',
        activatedAt: '2026-09-10T00:00:00Z',
        revision: 2,
        createdAt: '2026-09-03T10:00:00Z',
        updatedAt: '2026-09-10T00:00:00Z',
      };

      (mockRepo.findById as any).mockResolvedValue(existing);

      const result = await service.terminateExperiment({
        experimentId: 'exp-001',
        terminatedBy: 'operator-001',
        reason: 'Business priority changed',
      });

      expect(result.status).toBe('terminated');
      expect(result.terminatedBy).toBe('operator-001');
      expect(result.terminationReason).toBe('Business priority changed');
      expect(result.revision).toBe(3);
    });

    it('rejects termination of completed experiment', async () => {
      const existing: ExperimentRecord = {
        experimentId: 'exp-001',
        storeId: 'jf-us',
        missionId: 'mission-001',
        name: 'Test Experiment',
        hypothesis: { statement: 'Test', expectedEffect: 'Impact' },
        productIds: [],
        entityIds: [],
        observationSnapshots: [],
        guardrails: [],
        guardrailsTriggered: [],
        variants: [],
        status: 'completed',
        startDate: '2026-09-10',
        endDate: '2026-09-20',
        marketplace: 'US',
        currency: 'USD',
        activatedBy: 'op',
        activatedAt: '2026-09-10T00:00:00Z',
        completedBy: 'op',
        completedAt: '2026-09-20T00:00:00Z',
        outcome: 'success',
        revision: 3,
        createdAt: '2026-09-03T10:00:00Z',
        updatedAt: '2026-09-20T00:00:00Z',
      };

      (mockRepo.findById as any).mockResolvedValue(existing);

      await expect(
        service.terminateExperiment({
          experimentId: 'exp-001',
          terminatedBy: 'op',
          reason: 'test',
        })
      ).rejects.toThrow('Cannot terminate experiment in completed status');
    });
  });

  describe('queries', () => {
    it('gets experiments by store', async () => {
      const experiments: ExperimentRecord[] = [
        {
          experimentId: 'exp-001',
          storeId: 'jf-us',
          missionId: 'mission-001',
          name: 'Test Experiment',
          hypothesis: { statement: 'Test 1', expectedEffect: 'Impact' },
          productIds: [],
          entityIds: [],
          observationSnapshots: [],
          guardrails: [],
          guardrailsTriggered: [],
          variants: [],
          status: 'active',
          startDate: '2026-09-10',
          endDate: '2026-09-20',
          marketplace: 'US',
          currency: 'USD',
          revision: 1,
          createdAt: '2026-09-03T10:00:00Z',
          updatedAt: '2026-09-03T10:00:00Z',
        },
      ];

      (mockRepo.findByStore as any).mockResolvedValue(experiments);

      const result = await service.getExperimentsByStore('jf-us');

      expect(result).toHaveLength(1);
      expect(result[0].experimentId).toBe('exp-001');
      expect(mockRepo.findByStore).toHaveBeenCalledWith('jf-us');
    });

    it('gets experiment by id', async () => {
      const experiment: ExperimentRecord = {
        experimentId: 'exp-001',
        storeId: 'jf-us',
        missionId: 'mission-001',
        name: 'Test Experiment',
        hypothesis: { statement: 'Test', expectedEffect: 'Impact' },
        productIds: [],
        entityIds: [],
        observationSnapshots: [],
        guardrails: [],
        guardrailsTriggered: [],
        variants: [],
        status: 'draft',
        startDate: '2026-09-10',
        endDate: '2026-09-20',
        marketplace: 'US',
        currency: 'USD',
        revision: 1,
        createdAt: '2026-09-03T10:00:00Z',
        updatedAt: '2026-09-03T10:00:00Z',
      };

      (mockRepo.findById as any).mockResolvedValue(experiment);

      const result = await service.getExperimentById('exp-001');

      expect(result).toBeDefined();
      expect(result?.experimentId).toBe('exp-001');
    });
  });
});
