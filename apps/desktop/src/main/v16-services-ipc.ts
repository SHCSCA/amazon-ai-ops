/**
 * V1.6 Services IPC Handlers
 *
 * Service-level IPC layer over the new V1.6 services:
 * - DecisionService (approve/reject/supersede/execute/verify)
 * - MissionGrantService (issue/reserve/release/revoke/invalidate/residual)
 * - ExecutionService (preflight/submit-intent/readback/verify/batches)
 * - ExperimentService (create/start/snapshot/conclude)
 * - MemoryService (append/correct/promote/list/export)
 *
 * This complements v16-domain-ipc.ts which exposes repository-level CRUD.
 *
 * @module v16-services-ipc
 */

import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { DecisionService } from './v16-decision-service';
import { MissionGrantService } from './v16-mission-grant-service';
import { ExecutionService } from './v16-execution-service';
import { ExperimentService } from './v16-experiment-service';
import { MemoryService } from './v16-memory-service';

export const V16_SERVICE_CHANNELS = {
  // Decision service
  DECISION_PROPOSE: 'v16svc:decision:propose',
  DECISION_GET: 'v16svc:decision:get',
  DECISION_LIST: 'v16svc:decision:list',
  DECISION_APPROVE: 'v16svc:decision:approve',
  DECISION_REJECT: 'v16svc:decision:reject',
  DECISION_SUPERSEDE: 'v16svc:decision:supersede',
  DECISION_RECORD_EXECUTION: 'v16svc:decision:record-execution',
  DECISION_RECORD_VERIFICATION: 'v16svc:decision:record-verification',
  DECISION_HISTORY: 'v16svc:decision:history',

  // MissionGrant service
  GRANT_ISSUE: 'v16svc:grant:issue',
  GRANT_GET: 'v16svc:grant:get',
  GRANT_LIST: 'v16svc:grant:list',
  GRANT_RESERVE_SLOT: 'v16svc:grant:reserve-slot',
  GRANT_RELEASE_SLOT: 'v16svc:grant:release-slot',
  GRANT_REVOKE: 'v16svc:grant:revoke',
  GRANT_INVALIDATE: 'v16svc:grant:invalidate',
  GRANT_RESIDUAL: 'v16svc:grant:residual',
  GRANT_EVENTS: 'v16svc:grant:events',

  // Execution service
  EXECUTION_PREFLIGHT: 'v16svc:execution:preflight',
  EXECUTION_CREATE_BATCH: 'v16svc:execution:create-batch',
  EXECUTION_RECORD_INTENT: 'v16svc:execution:record-submit-intent',
  EXECUTION_RECORD_READBACK: 'v16svc:execution:record-readback',
  EXECUTION_FINALIZE: 'v16svc:execution:finalize',
  EXECUTION_GET_SLOT: 'v16svc:execution:get-slot',
  EXECUTION_GET_BATCH: 'v16svc:execution:get-batch',
  EXECUTION_LIST_BATCHES: 'v16svc:execution:list-batches',
  EXECUTION_LIST_SLOTS: 'v16svc:execution:list-slots',

  // Experiment service
  EXPERIMENT_CREATE: 'v16svc:experiment:create',
  EXPERIMENT_GET: 'v16svc:experiment:get',
  EXPERIMENT_LIST: 'v16svc:experiment:list',
  EXPERIMENT_START: 'v16svc:experiment:start',
  EXPERIMENT_PAUSE: 'v16svc:experiment:pause',
  EXPERIMENT_BLOCK: 'v16svc:experiment:block',
  EXPERIMENT_RECORD_SNAPSHOT: 'v16svc:experiment:record-snapshot',
  EXPERIMENT_COMPLETE: 'v16svc:experiment:complete',
  EXPERIMENT_ARCHIVE: 'v16svc:experiment:archive',

  // Memory service
  MEMORY_APPEND: 'v16svc:memory:append',
  MEMORY_CORRECT: 'v16svc:memory:correct',
  MEMORY_PROMOTE: 'v16svc:memory:promote',
  MEMORY_LIST: 'v16svc:memory:list',
  MEMORY_SEARCH_ENTITY: 'v16svc:memory:search-entity',
  MEMORY_SEARCH_PRODUCT: 'v16svc:memory:search-product',
  MEMORY_COUNT_TRUSTED: 'v16svc:memory:count-trusted',
  MEMORY_EXPORT: 'v16svc:memory:export',
} as const;

type ChannelName = typeof V16_SERVICE_CHANNELS[keyof typeof V16_SERVICE_CHANNELS];

export interface V16Services {
  decisions: DecisionService;
  grants: MissionGrantService;
  execution: ExecutionService;
  experiments: ExperimentService;
  memory: MemoryService;
}

export interface V16ServicesIpcRegistrar {
  handle(channel: string, listener: (event: unknown, request?: unknown) => Promise<unknown> | unknown): void;
}

function ok<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}

function fail(err: unknown): { success: false; error: string; code?: string } {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
  return { success: false, error: message, code };
}

function needCtx(req: unknown): StoreContextEnvelope {
  const r = req as { storeContext?: StoreContextEnvelope } | null;
  if (!r?.storeContext?.storeId) {
    throw new Error('Missing storeContext.storeId');
  }
  return r.storeContext;
}

/**
 * Register service-level IPC handlers.
 */
export function registerV16ServicesIpc(
  registrar: V16ServicesIpcRegistrar,
  services: V16Services,
): void {
  const safe = <T>(handler: () => T) => {
    try {
      const result = handler();
      if (result instanceof Promise) {
        return result.then(ok).catch(fail);
      }
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  };

  // ── Decision ─────────────────────────────────────────────────────
  registrar.handle(V16_SERVICE_CHANNELS.DECISION_PROPOSE, (_e, req) => safe(() => {
    const r = req as Parameters<DecisionService['propose']>[0];
    return services.decisions.propose(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.DECISION_GET, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; decisionId: string };
    return services.decisions.getDecision({ storeContext: r.storeContext, decisionId: r.decisionId });
  }));
  registrar.handle(V16_SERVICE_CHANNELS.DECISION_LIST, (_e, req) => safe(() => {
    const r = req as Parameters<DecisionService['listDecisions']>[0];
    return services.decisions.listDecisions(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.DECISION_APPROVE, (_e, req) => safe(() => {
    const r = req as Parameters<DecisionService['approve']>[0];
    return services.decisions.approve(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.DECISION_REJECT, (_e, req) => safe(() => {
    const r = req as Parameters<DecisionService['reject']>[0];
    return services.decisions.reject(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.DECISION_SUPERSEDE, (_e, req) => safe(() => {
    const r = req as Parameters<DecisionService['supersede']>[0];
    return services.decisions.supersede(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.DECISION_RECORD_EXECUTION, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; decisionId: string; executionEvidence: string };
    return services.decisions.recordExecution(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.DECISION_RECORD_VERIFICATION, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; decisionId: string; result: 'success' | 'failure' | 'unknown' };
    return services.decisions.recordVerification(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.DECISION_HISTORY, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; decisionId: string };
    return services.decisions.getHistory({ storeContext: r.storeContext, decisionId: r.decisionId });
  }));

  // ── Grant ────────────────────────────────────────────────────────
  registrar.handle(V16_SERVICE_CHANNELS.GRANT_ISSUE, (_e, req) => safe(() => {
    const r = req as Parameters<MissionGrantService['issue']>[0];
    return services.grants.issue(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.GRANT_GET, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; grantId: string };
    return services.grants.getGrant(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.GRANT_LIST, (_e, req) => safe(() => {
    const r = req as Parameters<MissionGrantService['listGrants']>[0];
    return services.grants.listGrants(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.GRANT_RESERVE_SLOT, (_e, req) => safe(() => {
    const r = req as Parameters<MissionGrantService['reserveSlot']>[0];
    return services.grants.reserveSlot(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.GRANT_RELEASE_SLOT, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; grantId: string; slotIndex: number; reason: string };
    return services.grants.releaseSlot(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.GRANT_REVOKE, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; grantId: string; revokedBy: string; reason: string };
    return services.grants.revoke(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.GRANT_INVALIDATE, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; grantId: string; reason: string };
    return services.grants.invalidate(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.GRANT_RESIDUAL, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; grantId: string };
    return services.grants.deriveResidualAuthority(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.GRANT_EVENTS, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; grantId: string };
    return services.grants.getLifecycleEvents(r);
  }));

  // ── Execution ────────────────────────────────────────────────────
  registrar.handle(V16_SERVICE_CHANNELS.EXECUTION_PREFLIGHT, (_e, req) => safe(() => {
    const r = req as Parameters<ExecutionService['preflight']>[0];
    return services.execution.preflight(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.EXECUTION_CREATE_BATCH, (_e, req) => safe(() => {
    const r = req as Parameters<ExecutionService['createBatch']>[0];
    return services.execution.createBatch(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.EXECUTION_RECORD_INTENT, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; slotId: string };
    return services.execution.recordSubmitIntent(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.EXECUTION_RECORD_READBACK, (_e, req) => safe(() => {
    const r = req as Parameters<ExecutionService['recordReadback']>[0];
    return services.execution.recordReadback(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.EXECUTION_FINALIZE, (_e, req) => safe(() => {
    const r = req as Parameters<ExecutionService['finalizeVerification']>[0];
    return services.execution.finalizeVerification(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.EXECUTION_GET_SLOT, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; slotId: string };
    return services.execution.getSlot(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.EXECUTION_GET_BATCH, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; batchId: string };
    return services.execution.getBatch(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.EXECUTION_LIST_BATCHES, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; limit?: number };
    return services.execution.listBatches(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.EXECUTION_LIST_SLOTS, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; batchId: string };
    return services.execution.listSlotsByBatch(r);
  }));

  // ── Experiment ───────────────────────────────────────────────────
  registrar.handle(V16_SERVICE_CHANNELS.EXPERIMENT_CREATE, (_e, req) => safe(() => {
    const r = req as Parameters<ExperimentService['create']>[0];
    return services.experiments.create(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.EXPERIMENT_GET, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; experimentId: string };
    return services.experiments.getExperimentRecord(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.EXPERIMENT_LIST, (_e, req) => safe(() => {
    const r = req as Parameters<ExperimentService['listExperiments']>[0];
    return services.experiments.listExperiments(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.EXPERIMENT_START, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; experimentId: string };
    return services.experiments.start(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.EXPERIMENT_PAUSE, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; experimentId: string; reason?: string };
    return services.experiments.pause(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.EXPERIMENT_BLOCK, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; experimentId: string; guardrailId: string; reason: string };
    return services.experiments.block(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.EXPERIMENT_RECORD_SNAPSHOT, (_e, req) => safe(() => {
    const r = req as Parameters<ExperimentService['recordSnapshot']>[0];
    return services.experiments.recordSnapshot(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.EXPERIMENT_COMPLETE, async (_e, req) => {
    try {
      const r = req as Parameters<ExperimentService['complete']>[0];
      const result = await services.experiments.complete(r);
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  });
  registrar.handle(V16_SERVICE_CHANNELS.EXPERIMENT_ARCHIVE, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; experimentId: string };
    return services.experiments.archive(r);
  }));

  // ── Memory ───────────────────────────────────────────────────────
  registrar.handle(V16_SERVICE_CHANNELS.MEMORY_APPEND, (_e, req) => safe(() => {
    const r = req as Parameters<MemoryService['append']>[0];
    return services.memory.append(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.MEMORY_CORRECT, (_e, req) => safe(() => {
    const r = req as Parameters<MemoryService['correct']>[0];
    return services.memory.correct(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.MEMORY_PROMOTE, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; eventId: string };
    return services.memory.promoteToTrusted(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.MEMORY_LIST, (_e, req) => safe(() => {
    const r = req as Parameters<MemoryService['list']>[0];
    return services.memory.list(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.MEMORY_SEARCH_ENTITY, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; entityId: string };
    return services.memory.searchByEntity(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.MEMORY_SEARCH_PRODUCT, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope; productId: string };
    return services.memory.searchByProduct(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.MEMORY_COUNT_TRUSTED, (_e, req) => safe(() => {
    const r = req as { storeContext: StoreContextEnvelope };
    return services.memory.countTrusted(r);
  }));
  registrar.handle(V16_SERVICE_CHANNELS.MEMORY_EXPORT, (_e, req) => safe(() => {
    const r = req as Parameters<MemoryService['exportMemory']>[0];
    return services.memory.exportMemory(r);
  }));
}
