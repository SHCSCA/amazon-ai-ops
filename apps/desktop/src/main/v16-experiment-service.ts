/**
 * V1.6 Experiment Service
 * 
 * Manages operating experiments with isolation and causal tracking.
 */

import type {
  ExperimentRecord,
  ExperimentVariant,
  ExperimentStatus,
} from '@amazon-ai-ops/shared-types';
import { validateExperimentRecord } from '@amazon-ai-ops/shared-types';

export interface ExperimentRepository {
  findById(experimentId: string): Promise<ExperimentRecord | null>;
  findByStore(storeId: string): Promise<ExperimentRecord[]>;
  create(record: ExperimentRecord): Promise<void>;
  update(record: ExperimentRecord): Promise<void>;
}

export class ExperimentServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ExperimentServiceError';
  }
}

export interface CreateExperimentInput {
  experimentId: string;
  storeId: string;
  missionId: string;
  name: string;
  description?: string;
  hypothesis: string;
  variants: ExperimentVariant[];
  startDate: string;
  endDate: string;
  marketplace: 'US';
  currency: 'USD';
}

export interface ActivateExperimentInput {
  experimentId: string;
  activatedBy: string;
}

export interface CompleteExperimentInput {
  experimentId: string;
  completedBy: string;
  outcome: 'success' | 'failure' | 'inconclusive';
  learnings?: string;
}

export interface TerminateExperimentInput {
  experimentId: string;
  terminatedBy: string;
  reason: string;
}

export class ExperimentService {
  constructor(private readonly repo: ExperimentRepository) {}

  async createExperiment(input: CreateExperimentInput): Promise<ExperimentRecord> {
    const now = new Date().toISOString();
    const record: ExperimentRecord = {
      experimentId: input.experimentId,
      storeId: input.storeId,
      missionId: input.missionId,
      name: input.name,
      description: input.description,
      hypothesis: {
        statement: input.hypothesis,
        expectedEffect: input.description || input.hypothesis,
      },
      productIds: [],
      entityIds: [],
      observationSnapshots: [],
      guardrails: [],
      guardrailsTriggered: [],
      variants: input.variants,
      status: 'draft',
      startDate: input.startDate,
      endDate: input.endDate,
      marketplace: input.marketplace,
      currency: input.currency,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };

    try {
      validateExperimentRecord(record);
    } catch (err) {
      throw new ExperimentServiceError(
        err instanceof Error ? err.message : 'Validation failed',
        'VALIDATION_ERROR'
      );
    }

    await this.repo.create(record);
    return record;
  }

  async activateExperiment(input: ActivateExperimentInput): Promise<ExperimentRecord> {
    const experiment = await this.repo.findById(input.experimentId);
    if (!experiment) {
      throw new ExperimentServiceError('Experiment not found', 'NOT_FOUND');
    }

    if (experiment.status !== 'draft') {
      throw new ExperimentServiceError(
        `Cannot activate experiment in ${experiment.status} status`,
        'INVALID_TRANSITION'
      );
    }

    const now = new Date().toISOString();
    const updatedAt = now > experiment.createdAt ? now : new Date(new Date(experiment.createdAt).getTime() + 1).toISOString();

    const updated: ExperimentRecord = {
      ...experiment,
      status: 'active',
      activatedBy: input.activatedBy,
      activatedAt: now,
      revision: experiment.revision + 1,
      updatedAt,
    };

    validateExperimentRecord(updated);
    await this.repo.update(updated);
    return updated;
  }

  async completeExperiment(input: CompleteExperimentInput): Promise<ExperimentRecord> {
    const experiment = await this.repo.findById(input.experimentId);
    if (!experiment) {
      throw new ExperimentServiceError('Experiment not found', 'NOT_FOUND');
    }

    if (experiment.status !== 'active') {
      throw new ExperimentServiceError(
        `Cannot complete experiment in ${experiment.status} status`,
        'INVALID_TRANSITION'
      );
    }

    const now = new Date().toISOString();
    const updatedAt = now > experiment.createdAt ? now : new Date(new Date(experiment.createdAt).getTime() + 1).toISOString();

    const updated: ExperimentRecord = {
      ...experiment,
      status: 'completed',
      completedBy: input.completedBy,
      completedAt: now,
      outcome: input.outcome,
      learnings: input.learnings,
      revision: experiment.revision + 1,
      updatedAt,
    };

    validateExperimentRecord(updated);
    await this.repo.update(updated);
    return updated;
  }

  async terminateExperiment(input: TerminateExperimentInput): Promise<ExperimentRecord> {
    const experiment = await this.repo.findById(input.experimentId);
    if (!experiment) {
      throw new ExperimentServiceError('Experiment not found', 'NOT_FOUND');
    }

    if (experiment.status === 'completed' || experiment.status === 'terminated') {
      throw new ExperimentServiceError(
        `Cannot terminate experiment in ${experiment.status} status`,
        'INVALID_TRANSITION'
      );
    }

    const now = new Date().toISOString();
    const updatedAt = now > experiment.createdAt ? now : new Date(new Date(experiment.createdAt).getTime() + 1).toISOString();

    const updated: ExperimentRecord = {
      ...experiment,
      status: 'terminated',
      terminatedBy: input.terminatedBy,
      terminatedAt: now,
      terminationReason: input.reason,
      revision: experiment.revision + 1,
      updatedAt,
    };

    validateExperimentRecord(updated);
    await this.repo.update(updated);
    return updated;
  }

  async getExperimentsByStore(storeId: string): Promise<ExperimentRecord[]> {
    return this.repo.findByStore(storeId);
  }

  async getExperimentById(experimentId: string): Promise<ExperimentRecord | null> {
    return this.repo.findById(experimentId);
  }
}
