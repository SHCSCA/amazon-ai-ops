/**
 * V1.6 Mission Service
 *
 * Business logic for Mission lifecycle management.
 * Handles creation, stage transitions, status changes, and archive/restore.
 *
 * @module v16-mission-service
 */

import type { StoreContextEnvelope, MissionStage, MissionStatus } from '@amazon-ai-ops/shared-types';
import type { MissionRepository, MissionRow } from '@amazon-ai-ops/local-db/src/sqlite/repositories/v16-domain-repositories';

/**
 * Valid stage transitions
 */
const VALID_STAGE_TRANSITIONS: Record<MissionStage, MissionStage[]> = {
  fact: ['analysis'],
  analysis: ['decision', 'blocked'],
  decision: ['action', 'blocked'],
  action: ['readback', 'blocked'],
  readback: ['effect', 'blocked'],
  effect: [], // Terminal stage
};

/**
 * Check if a stage transition is valid
 */
function isValidStageTransition(from: MissionStage, to: MissionStage): boolean {
  return VALID_STAGE_TRANSITIONS[from]?.includes(to) ?? false;
}

export class MissionServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'STORE_MISMATCH' | 'MISSION_NOT_FOUND' | 'INVALID_TRANSITION' | 'STAGE_TRANSITION_DENIED' | 'REVISION_CONFLICT' | 'TERMINAL_STATE',
  ) {
    super(message);
    this.name = 'MissionServiceError';
  }
}

export interface CreateMissionInput {
  storeContext: StoreContextEnvelope;
  name: string;
  description?: string;
  productIds: string[];
  reportSnapshotId?: string;
  observationWindowStart?: string;
  observationWindowEnd?: string;
  policyVersionId?: string;
  policyRevision?: string;
  reason?: string;
}

function validateStoreContext(mission: MissionRow, storeContext: StoreContextEnvelope): void {
  if (mission.store_id !== String(storeContext.storeId)) {
    throw new MissionServiceError('Cannot operate on mission from different store', 'STORE_MISMATCH');
  }
}

function isTerminalStatus(status: MissionStatus): boolean {
  return status === 'completed' || status === 'archived';
}

export class MissionService {
  constructor(private readonly repo: MissionRepository) {}

  createMission(input: CreateMissionInput): MissionRow {
    const now = new Date().toISOString();
    const missionId = `mission_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    return this.repo.create({
      mission_id: missionId,
      store_id: String(input.storeContext.storeId),
      mission_name: input.name,
      description: input.description ?? null,
      product_ids: JSON.stringify(input.productIds),
      report_snapshot_id: input.reportSnapshotId ?? null,
      observation_window_start: input.observationWindowStart ?? null,
      observation_window_end: input.observationWindowEnd ?? null,
      policy_version_id: input.policyVersionId ?? null,
      policy_revision: input.policyRevision ?? null,
      stage: 'fact',
      status: 'draft',
      created_at: now,
      started_at: null,
      completed_at: null,
      created_by: 'operator',
      last_modified_by: null,
      reason: input.reason ?? null,
      metadata: null,
    });
  }

  getMission(params: {
    storeContext: StoreContextEnvelope;
    missionId: string;
  }): MissionRow | null {
    const mission = this.repo.findById(params.missionId);
    if (!mission) return null;
    validateStoreContext(mission, params.storeContext);
    return mission;
  }

  listMissions(params: {
    storeContext: StoreContextEnvelope;
    status?: MissionStatus;
    limit?: number;
  }): MissionRow[] {
    const storeId = String(params.storeContext.storeId);
    if (params.status) {
      return this.repo.findByStatus(storeId, params.status);
    }
    return this.repo.findByStoreId(storeId, params.limit ?? 50);
  }

  startMission(params: {
    storeContext: StoreContextEnvelope;
    missionId: string;
  }): MissionRow | null {
    const mission = this.getMission({ storeContext: params.storeContext, missionId: params.missionId });
    if (!mission) return null;

    if (mission.status !== 'draft' && mission.status !== 'paused') {
      throw new MissionServiceError(
        `Cannot start mission in status ${mission.status}`,
        'INVALID_TRANSITION'
      );
    }

    const now = new Date().toISOString();
    return this.repo.update(params.missionId, {
      status: 'active',
      started_at: now,
      last_modified_by: 'operator',
    });
  }

  pauseMission(params: {
    storeContext: StoreContextEnvelope;
    missionId: string;
    reason?: string;
  }): MissionRow | null {
    const mission = this.getMission({ storeContext: params.storeContext, missionId: params.missionId });
    if (!mission) return null;

    if (mission.status !== 'active') {
      throw new MissionServiceError(
        `Cannot pause mission in status ${mission.status}`,
        'INVALID_TRANSITION'
      );
    }

    return this.repo.update(params.missionId, {
      status: 'paused',
      reason: params.reason ?? null,
      last_modified_by: 'operator',
    });
  }

  blockMission(params: {
    storeContext: StoreContextEnvelope;
    missionId: string;
    reason: string;
  }): MissionRow | null {
    const mission = this.getMission({ storeContext: params.storeContext, missionId: params.missionId });
    if (!mission) return null;

    if (isTerminalStatus(mission.status as MissionStatus)) {
      throw new MissionServiceError(
        `Cannot block terminal mission in status ${mission.status}`,
        'TERMINAL_STATE'
      );
    }

    return this.repo.update(params.missionId, {
      status: 'blocked',
      reason: params.reason,
      last_modified_by: 'operator',
    });
  }

  completeMission(params: {
    storeContext: StoreContextEnvelope;
    missionId: string;
  }): MissionRow | null {
    const mission = this.getMission({ storeContext: params.storeContext, missionId: params.missionId });
    if (!mission) return null;

    if (mission.status === 'completed' || mission.status === 'archived') {
      throw new MissionServiceError(
        `Mission already in terminal status ${mission.status}`,
        'TERMINAL_STATE'
      );
    }

    const now = new Date().toISOString();
    return this.repo.update(params.missionId, {
      status: 'completed',
      stage: 'effect',
      completed_at: now,
      last_modified_by: 'operator',
    });
  }

  archiveMission(params: {
    storeContext: StoreContextEnvelope;
    missionId: string;
  }): MissionRow | null {
    const mission = this.getMission({ storeContext: params.storeContext, missionId: params.missionId });
    if (!mission) return null;

    return this.repo.update(params.missionId, {
      status: 'archived',
      last_modified_by: 'operator',
    });
  }

  /**
   * Advance the mission stage. Only valid forward transitions allowed.
   * Blocked transitions allowed from non-terminal stages.
   */
  advanceStage(params: {
    storeContext: StoreContextEnvelope;
    missionId: string;
    targetStage: MissionStage;
    reason?: string;
  }): MissionRow | null {
    const mission = this.getMission({ storeContext: params.storeContext, missionId: params.missionId });
    if (!mission) return null;

    const currentStage = mission.stage as MissionStage;

    if (isTerminalStatus(mission.status as MissionStatus)) {
      throw new MissionServiceError(
        `Cannot advance stage on terminal mission (${mission.status})`,
        'TERMINAL_STATE'
      );
    }

    if (!isValidStageTransition(currentStage, params.targetStage)) {
      throw new MissionServiceError(
        `Invalid stage transition: ${currentStage} -> ${params.targetStage}`,
        'STAGE_TRANSITION_DENIED'
      );
    }

    const updates: Partial<MissionRow> = {
      stage: params.targetStage,
      last_modified_by: 'operator',
    };

    if (params.targetStage === 'blocked' && params.reason) {
      updates.status = 'blocked';
      updates.reason = params.reason;
    }

    if (params.targetStage === 'effect') {
      updates.status = 'completed';
      updates.completed_at = new Date().toISOString();
    }

    return this.repo.update(params.missionId, updates);
  }
}
