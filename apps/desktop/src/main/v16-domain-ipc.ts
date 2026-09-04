/**
 * V1.6 Domain IPC Handlers
 *
 * Registers IPC handlers for all V1.6 domain models:
 * - Mission
 * - Decision
 * - MissionGrant
 * - Execution
 * - Experiment
 * - Memory
 *
 * @module v16-domain-ipc
 */

import { ipcMain } from 'electron';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { MissionRepository, DecisionRepository, MissionGrantRepository, ExecutionRepository, ExperimentRepository, MemoryRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/v16-domain-repositories';

// ─── IPC Channels ───────────────────────────────────────────────────────────────

export const V16_CHANNELS = {
  // Mission
  MISSION_CREATE: 'v16:mission:create',
  MISSION_GET: 'v16:mission:get',
  MISSION_LIST: 'v16:mission:list',
  MISSION_START: 'v16:mission:start',
  MISSION_PAUSE: 'v16:mission:pause',
  MISSION_BLOCK: 'v16:mission:block',
  MISSION_COMPLETE: 'v16:mission:complete',
  MISSION_ARCHIVE: 'v16:mission:archive',
  MISSION_ADVANCE_STAGE: 'v16:mission:advance-stage',

  // Decision
  DECISION_CREATE: 'v16:decision:create',
  DECISION_GET: 'v16:decision:get',
  DECISION_LIST: 'v16:decision:list',
  DECISION_UPDATE: 'v16:decision:update',
  DECISION_HISTORY: 'v16:decision:history',

  // Grant
  GRANT_CREATE: 'v16:grant:create',
  GRANT_GET: 'v16:grant:get',
  GRANT_LIST: 'v16:grant:list',
  GRANT_UPDATE: 'v16:grant:update',

  // Execution
  EXECUTION_SLOT_CREATE: 'v16:execution:slot-create',
  EXECUTION_SLOT_UPDATE: 'v16:execution:slot-update',
  EXECUTION_BATCH_CREATE: 'v16:execution:batch-create',
  EXECUTION_BATCH_GET: 'v16:execution:batch-get',

  // Experiment
  EXPERIMENT_CREATE: 'v16:experiment:create',
  EXPERIMENT_GET: 'v16:experiment:get',
  EXPERIMENT_LIST: 'v16:experiment:list',
  EXPERIMENT_UPDATE: 'v16:experiment:update',

  // Memory
  MEMORY_APPEND: 'v16:memory:append',
  MEMORY_LIST: 'v16:memory:list',
  MEMORY_TRUSTED: 'v16:memory:trusted',
  MEMORY_COUNT: 'v16:memory:count',
} as const;

type ChannelName = typeof V16_CHANNELS[keyof typeof V16_CHANNELS];

// ─── IPC Registrar ────────────────────────────────────────────────────────────────

interface V16IpcRegistrar {
  handle(channel: string, listener: (event: unknown, request?: unknown) => unknown): void;
}

function toIpcResponse<T>(data: T, error?: string): { success: boolean; data?: T; error?: string } {
  return error
    ? { success: false, error }
    : { success: true, data };
}

// ─── Repository type for IPC ────────────────────────────────────────────────

interface V16Repositories {
  mission: MissionRepository;
  decision: DecisionRepository;
  grant: MissionGrantRepository;
  execution: ExecutionRepository;
  experiment: ExperimentRepository;
  memory: MemoryRepository;
}

// ─── Register all V16 IPC handlers ──────────────────────────────────────────

export function registerV16DomainIpcHandlers(
  registrar: V16IpcRegistrar,
  repos: V16Repositories
): void {
  // ── Mission handlers ──────────────────────────────────────────────
  registrar.handle(V16_CHANNELS.MISSION_CREATE, (_event, raw?: { storeContext: StoreContextEnvelope; name: string; productIds: string[] }) => {
    try {
      if (!raw?.storeContext || !raw?.name || !raw?.productIds) {
        return toIpcResponse(null, 'Missing required fields');
      }
      const mission = repos.mission.create({
        mission_id: `mission_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        store_id: String(raw.storeContext.storeId),
        mission_name: raw.name,
        description: null,
        product_ids: JSON.stringify(raw.productIds),
        report_snapshot_id: null,
        observation_window_start: null,
        observation_window_end: null,
        policy_version_id: null,
        policy_revision: null,
        stage: 'fact',
        status: 'draft',
        created_at: new Date().toISOString(),
        started_at: null,
        completed_at: null,
        created_by: 'operator',
        last_modified_by: null,
        reason: null,
        metadata: null,
      });
      return toIpcResponse(mission);
    } catch (e) {
      return toIpcResponse(null, e instanceof Error ? e.message : String(e));
    }
  });

  registrar.handle(V16_CHANNELS.MISSION_GET, (_event, raw?: { storeContext: StoreContextEnvelope; missionId: string }) => {
    try {
      if (!raw?.storeContext || !raw?.missionId) {
        return toIpcResponse(null, 'Missing required fields');
      }
      const mission = repos.mission.findById(raw.missionId);
      if (!mission) return toIpcResponse(null, 'Mission not found');
      if (mission.store_id !== String(raw.storeContext.storeId)) {
        return toIpcResponse(null, 'Store mismatch');
      }
      return toIpcResponse(mission);
    } catch (e) {
      return toIpcResponse(null, e instanceof Error ? e.message : String(e));
    }
  });

  registrar.handle(V16_CHANNELS.MISSION_LIST, (_event, raw?: { storeContext: StoreContextEnvelope; status?: string; limit?: number }) => {
    try {
      if (!raw?.storeContext) {
        return toIpcResponse(null, 'Missing storeContext');
      }
      const storeId = String(raw.storeContext.storeId);
      const missions = raw.status
        ? repos.mission.findByStatus(storeId, raw.status)
        : repos.mission.findByStoreId(storeId, raw.limit ?? 50);
      return toIpcResponse(missions);
    } catch (e) {
      return toIpcResponse(null, e instanceof Error ? e.message : String(e));
    }
  });

  registrar.handle(V16_CHANNELS.MISSION_START, (_event, raw?: { storeContext: StoreContextEnvelope; missionId: string }) => {
    try {
      if (!raw?.storeContext || !raw?.missionId) {
        return toIpcResponse(null, 'Missing required fields');
      }
      const mission = repos.mission.findById(raw.missionId);
      if (!mission) return toIpcResponse(null, 'Mission not found');
      if (mission.store_id !== String(raw.storeContext.storeId)) {
        return toIpcResponse(null, 'Store mismatch');
      }
      if (mission.status !== 'draft' && mission.status !== 'paused') {
        return toIpcResponse(null, `Cannot start mission in status ${mission.status}`);
      }
      const updated = repos.mission.update(raw.missionId, {
        status: 'active',
        started_at: new Date().toISOString(),
        last_modified_by: 'operator',
      });
      return toIpcResponse(updated);
    } catch (e) {
      return toIpcResponse(null, e instanceof Error ? e.message : String(e));
    }
  });

  registrar.handle(V16_CHANNELS.MISSION_COMPLETE, (_event, raw?: { storeContext: StoreContextEnvelope; missionId: string }) => {
    try {
      if (!raw?.storeContext || !raw?.missionId) {
        return toIpcResponse(null, 'Missing required fields');
      }
      const mission = repos.mission.findById(raw.missionId);
      if (!mission) return toIpcResponse(null, 'Mission not found');
      if (mission.store_id !== String(raw.storeContext.storeId)) {
        return toIpcResponse(null, 'Store mismatch');
      }
      const updated = repos.mission.update(raw.missionId, {
        status: 'completed',
        stage: 'effect',
        completed_at: new Date().toISOString(),
        last_modified_by: 'operator',
      });
      return toIpcResponse(updated);
    } catch (e) {
      return toIpcResponse(null, e instanceof Error ? e.message : String(e));
    }
  });

  // Pause mission
  registrar.handle(V16_CHANNELS.MISSION_PAUSE, (_event, raw?: { storeContext: StoreContextEnvelope; missionId: string }) => {
    try {
      if (!raw?.storeContext || !raw?.missionId) return toIpcResponse(null, 'Missing required fields');
      const mission = repos.mission.findById(raw.missionId);
      if (!mission) return toIpcResponse(null, 'Mission not found');
      if (mission.store_id !== String(raw.storeContext.storeId)) return toIpcResponse(null, 'Store mismatch');
      if (mission.status !== 'active') return toIpcResponse(null, `Cannot pause mission in status ${mission.status}`);
      const updated = repos.mission.update(raw.missionId, { status: 'paused', last_modified_by: 'operator' });
      return toIpcResponse(updated);
    } catch (e) { return toIpcResponse(null, e instanceof Error ? e.message : String(e)); }
  });

  // Block mission
  registrar.handle(V16_CHANNELS.MISSION_BLOCK, (_event, raw?: { storeContext: StoreContextEnvelope; missionId: string; reason?: string }) => {
    try {
      if (!raw?.storeContext || !raw?.missionId) return toIpcResponse(null, 'Missing required fields');
      const mission = repos.mission.findById(raw.missionId);
      if (!mission) return toIpcResponse(null, 'Mission not found');
      if (mission.store_id !== String(raw.storeContext.storeId)) return toIpcResponse(null, 'Store mismatch');
      const isTerminal = mission.status === 'completed' || mission.status === 'archived';
      if (isTerminal) return toIpcResponse(null, `Cannot block terminal mission (${mission.status})`);
      const updated = repos.mission.update(raw.missionId, { status: 'blocked', reason: raw.reason ?? null });
      return toIpcResponse(updated);
    } catch (e) { return toIpcResponse(null, e instanceof Error ? e.message : String(e)); }
  });

  // Archive mission
  registrar.handle(V16_CHANNELS.MISSION_ARCHIVE, (_event, raw?: { storeContext: StoreContextEnvelope; missionId: string }) => {
    try {
      if (!raw?.storeContext || !raw?.missionId) return toIpcResponse(null, 'Missing required fields');
      const mission = repos.mission.findById(raw.missionId);
      if (!mission) return toIpcResponse(null, 'Mission not found');
      if (mission.store_id !== String(raw.storeContext.storeId)) return toIpcResponse(null, 'Store mismatch');
      const updated = repos.mission.update(raw.missionId, { status: 'archived', last_modified_by: 'operator' });
      return toIpcResponse(updated);
    } catch (e) { return toIpcResponse(null, e instanceof Error ? e.message : String(e)); }
  });

  // Advance mission stage
  registrar.handle(V16_CHANNELS.MISSION_ADVANCE_STAGE, (_event, raw?: { storeContext: StoreContextEnvelope; missionId: string; targetStage: string }) => {
    try {
      if (!raw?.storeContext || !raw?.missionId || !raw?.targetStage) return toIpcResponse(null, 'Missing required fields');
      const mission = repos.mission.findById(raw.missionId);
      if (!mission) return toIpcResponse(null, 'Mission not found');
      if (mission.store_id !== String(raw.storeContext.storeId)) return toIpcResponse(null, 'Store mismatch');
      const stageOrder = ['fact', 'analysis', 'decision', 'action', 'readback', 'effect'];
      const currentIdx = stageOrder.indexOf(mission.stage);
      const targetIdx = stageOrder.indexOf(raw.targetStage);
      if (targetIdx < 0) return toIpcResponse(null, `Invalid stage: ${raw.targetStage}`);
      // Only allow one step forward or blocked
      const isBlocked = raw.targetStage === 'blocked';
      if (!isBlocked && targetIdx !== currentIdx + 1) {
        return toIpcResponse(null, `Cannot advance from ${mission.stage} to ${raw.targetStage}`);
      }
      const isTerminal = mission.status === 'completed' || mission.status === 'archived';
      if (isTerminal) return toIpcResponse(null, `Cannot advance terminal mission (${mission.status})`);
      const updates: Record<string, string | null> = { stage: raw.targetStage };
      if (raw.targetStage === 'effect') {
        updates.status = 'completed';
        updates.completed_at = new Date().toISOString();
      }
      const updated = repos.mission.update(raw.missionId, { ...updates, last_modified_by: 'operator' });
      return toIpcResponse(updated);
    } catch (e) { return toIpcResponse(null, e instanceof Error ? e.message : String(e)); }
  });

  // ── Decision handlers ──────────────────────────────────────────────
  registrar.handle(V16_CHANNELS.DECISION_CREATE, (_event, raw?: { storeContext: StoreContextEnvelope; decision: Record<string, unknown> }) => {
    try {
      if (!raw?.storeContext || !raw?.decision) return toIpcResponse(null, 'Missing required fields');
      const now = new Date().toISOString();
      const decision = repos.decision.create({
        decision_id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        store_id: String(raw.storeContext.storeId),
        mission_id: String(raw.decision.missionId),
        mission_revision: Number(raw.decision.missionRevision) || 1,
        batch_id: String(raw.decision.batchId),
        recommendation_id: String(raw.decision.recommendationId),
        action_type: String(raw.decision.actionType),
        entity_type: String(raw.decision.entityType),
        entity_id: String(raw.decision.entityId),
        current_value: String(raw.decision.currentValue ?? ''),
        target_value: String(raw.decision.targetValue ?? ''),
        change_reason: String(raw.decision.changeReason ?? ''),
        status: 'proposed',
        issuer: 'human_operator',
        approved_at: null, approved_by: null, rejection_reason: null,
        superseded_by: null, supersedes: null,
        executed_at: null, execution_evidence: null,
        verified_at: null, verification_result: null,
        created_at: now, metadata: null,
      });
      return toIpcResponse(decision);
    } catch (e) { return toIpcResponse(null, e instanceof Error ? e.message : String(e)); }
  });

  registrar.handle(V16_CHANNELS.DECISION_LIST, (_event, raw?: { storeContext: StoreContextEnvelope; missionId?: string; status?: string }) => {
    try {
      if (!raw?.storeContext) return toIpcResponse(null, 'Missing storeContext');
      const storeId = String(raw.storeContext.storeId);
      if (raw.missionId) return toIpcResponse(repos.decision.findByMissionId(raw.missionId));
      if (raw.status) return toIpcResponse(repos.decision.findByStatus(storeId, raw.status));
      return toIpcResponse(repos.decision.findByStoreId(storeId));
    } catch (e) { return toIpcResponse(null, e instanceof Error ? e.message : String(e)); }
  });

  // ── Memory handlers ──────────────────────────────────────────────
  registrar.handle(V16_CHANNELS.MEMORY_APPEND, (_event, raw?: { storeContext: StoreContextEnvelope; event: Record<string, unknown> }) => {
    try {
      if (!raw?.storeContext || !raw?.event) return toIpcResponse(null, 'Missing required fields');
      const now = new Date().toISOString();
      const evt = repos.memory.append({
        event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        store_id: String(raw.storeContext.storeId),
        stage: String(raw.event.stage),
        mission_id: raw.event.missionId ? String(raw.event.missionId) : null,
        decision_id: raw.event.decisionId ? String(raw.event.decisionId) : null,
        grant_id: raw.event.grantId ? String(raw.event.grantId) : null,
        execution_id: raw.event.executionId ? String(raw.event.executionId) : null,
        experiment_id: raw.event.experimentId ? String(raw.event.experimentId) : null,
        analysis_run_id: raw.event.analysisRunId ? String(raw.event.analysisRunId) : null,
        entity_id: raw.event.entityId ? String(raw.event.entityId) : null,
        product_id: raw.event.productId ? String(raw.event.productId) : null,
        business_date: String(raw.event.businessDate),
        event_type: String(raw.event.eventType),
        session_generation: Number(raw.storeContext.sessionGeneration),
        proof_hash: String(raw.event.proofHash),
        evidence_refs_json: JSON.stringify(raw.event.evidenceRefs ?? []),
        summary: String(raw.event.summary),
        details_json: raw.event.details ? JSON.stringify(raw.event.details) : null,
        status: String(raw.event.status ?? 'observed'),
        memory_digest: raw.event.memoryDigest ? String(raw.event.memoryDigest) : null,
        created_at: now,
        correction_of: null, corrected_by: null, metadata: null,
      });
      return toIpcResponse(evt);
    } catch (e) { return toIpcResponse(null, e instanceof Error ? e.message : String(e)); }
  });

  registrar.handle(V16_CHANNELS.MEMORY_LIST, (_event, raw?: { storeContext: StoreContextEnvelope; limit?: number }) => {
    try {
      if (!raw?.storeContext) return toIpcResponse(null, 'Missing storeContext');
      return toIpcResponse(repos.memory.findByStore(String(raw.storeContext.storeId), raw.limit ?? 100));
    } catch (e) { return toIpcResponse(null, e instanceof Error ? e.message : String(e)); }
  });

  registrar.handle(V16_CHANNELS.MEMORY_TRUSTED, (_event, raw?: { storeContext: StoreContextEnvelope; limit?: number }) => {
    try {
      if (!raw?.storeContext) return toIpcResponse(null, 'Missing storeContext');
      return toIpcResponse(repos.memory.findTrustedByStore(String(raw.storeContext.storeId), raw.limit ?? 100));
    } catch (e) { return toIpcResponse(null, e instanceof Error ? e.message : String(e)); }
  });

  registrar.handle(V16_CHANNELS.MEMORY_COUNT, (_event, raw?: { storeContext: StoreContextEnvelope }) => {
    try {
      if (!raw?.storeContext) return toIpcResponse(null, 'Missing storeContext');
      return toIpcResponse({ count: repos.memory.countByStore(String(raw.storeContext.storeId)) });
    } catch (e) { return toIpcResponse(null, e instanceof Error ? e.message : String(e)); }
  });
}

/**
 * Unregister all V16 domain IPC handlers
 */
export function unregisterV16DomainIpcHandlers(): void {
  for (const channel of Object.values(V16_CHANNELS)) {
    ipcRenderer.removeHandler(channel);
  }
}
