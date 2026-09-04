/**
 * Analysis Runs IPC Handlers
 *
 * Bridges Renderer requests to Main process through AnalysisRunsService,
 * which enforces store-scoped validation, fingerprint reuse detection,
 * and stage state-machine transitions.
 *
 * @module analysis-runs-ipc
 */

import type {
  AnalysisRunRecord,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { AnalysisRunsService } from './analysis-runs-service';

/**
 * IPC channel names for Analysis Runs operations
 */
export const ANALYSIS_RUNS_CHANNELS = {
  CREATE: 'analysis-runs:create',
  UPDATE: 'analysis-runs:update',
  QUERY: 'analysis-runs:query',
  LIST: 'analysis-runs:list',
} as const;

/**
 * IPC registrar interface (mirrors trackedIpcRegistrar)
 */
interface AnalysisRunsIpcRegistrar {
  handle(channel: string, listener: (event: unknown, request?: unknown) => unknown): void;
}

/**
 * Error codes surfaced by AnalysisRunsService through IPC
 */
export type AnalysisRunsIpcErrorCode =
  | 'STORE_MISMATCH'
  | 'RUN_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'REUSE_DETECTED'
  | 'SERVICE_ERROR';

// ─── Request / Response types ────────────────────────────────────────────────────

export interface CreateRunRequest {
  storeContext: StoreContextEnvelope;
  input: {
    reportSnapshotId: string;
    missionId?: string;
    productId?: string;
    policyRevision?: string;
    modelRevision?: string;
    metadata?: AnalysisRunRecord['metadata'];
  };
}

export interface CreateRunResponse {
  success: boolean;
  run?: AnalysisRunRecord;
  error?: { code: string; message: string };
}

export interface UpdateRunRequest {
  storeContext: StoreContextEnvelope;
  input: {
    runId: string;
    status?: AnalysisRunRecord['status'];
    recommendationsCount?: number;
    blockedReason?: string | null;
    completedAt?: string;
  };
}

export interface UpdateRunResponse {
  success: boolean;
  run?: AnalysisRunRecord;
  error?: { code: string; message: string };
}

export interface QueryRunRequest {
  storeContext: StoreContextEnvelope;
  input: { runId: string };
}

export interface QueryRunResponse {
  success: boolean;
  run?: AnalysisRunRecord | null;
  error?: { code: string; message: string };
}

export interface ListRunsRequest {
  storeContext: StoreContextEnvelope;
  input: {
    missionId?: string;
    status?: AnalysisRunRecord['status'];
    limit?: number;
  };
}

export interface ListRunsResponse {
  success: boolean;
  runs?: AnalysisRunRecord[];
  error?: { code: string; message: string };
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────────

/**
 * Register all Analysis Runs IPC handlers.
 * All operations go through AnalysisRunsService to enforce store-scoped
 * authority, fingerprint reuse guard, and stage transitions.
 *
 * @param registrar - IPC registrar (trackedIpcRegistrar)
 * @param service - AnalysisRunsService instance (created from AnalysisRunsRepository)
 */
export function registerAnalysisRunsIpcHandlers(
  registrar: AnalysisRunsIpcRegistrar,
  service: AnalysisRunsService,
): void {

  // CREATE
  registrar.handle(ANALYSIS_RUNS_CHANNELS.CREATE, (_event, raw?: CreateRunRequest): CreateRunResponse => {
    try {
      if (!raw?.storeContext || !raw?.input) {
        return { success: false, error: { code: 'SERVICE_ERROR', message: 'Missing storeContext or input.' } };
      }
      const { storeContext, input } = raw;
      const run = service.createRun({
        storeContext,
        reportSnapshotId: input.reportSnapshotId,
        missionId: input.missionId,
        productId: input.productId,
        policyRevision: input.policyRevision,
        modelRevision: input.modelRevision,
        metadata: input.metadata,
      });
      return { success: true, run };
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : String(error);
      return { success: false, error: { code, message: code } };
    }
  });

  // UPDATE — maps to updateStage / completeRun / failRun / blockRun
  registrar.handle(ANALYSIS_RUNS_CHANNELS.UPDATE, (_event, raw?: UpdateRunRequest): UpdateRunResponse => {
    try {
      if (!raw?.storeContext || !raw?.input) {
        return { success: false, error: { code: 'SERVICE_ERROR', message: 'Missing storeContext or input.' } };
      }
      const { storeContext, input } = raw;

      if (input.status === 'completed') {
        const run = service.completeRun({
          storeContext,
          runId: input.runId,
          recommendationsCount: input.recommendationsCount ?? 0,
        });
        return { success: true, run };
      }
      if (input.status === 'failed') {
        const run = service.failRun({
          storeContext,
          runId: input.runId,
          reason: input.blockedReason ?? 'Unknown failure',
        });
        return { success: true, run };
      }
      if (input.status === 'blocked') {
        const run = service.blockRun({
          storeContext,
          runId: input.runId,
          reason: input.blockedReason ?? 'Blocked',
        });
        return { success: true, run };
      }

      // Generic stage update
      const run = service.updateStage({
        storeContext,
        runId: input.runId,
        status: input.status,
        recommendationsCount: input.recommendationsCount,
        blockedReason: input.blockedReason,
        completedAt: input.completedAt,
      });
      return { success: true, run };
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : String(error);
      return { success: false, error: { code, message: code } };
    }
  });

  // QUERY
  registrar.handle(ANALYSIS_RUNS_CHANNELS.QUERY, (_event, raw?: QueryRunRequest): QueryRunResponse => {
    try {
      if (!raw?.storeContext || !raw?.input) {
        return { success: false, error: { code: 'SERVICE_ERROR', message: 'Missing storeContext or input.' } };
      }
      const { storeContext, input } = raw;
      const run = service.getRun({ storeContext, runId: input.runId });
      return { success: true, run: run ?? null };
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : String(error);
      return { success: false, error: { code, message: code } };
    }
  });

  // LIST
  registrar.handle(ANALYSIS_RUNS_CHANNELS.LIST, (_event, raw?: ListRunsRequest): ListRunsResponse => {
    try {
      if (!raw?.storeContext) {
        return { success: false, error: { code: 'SERVICE_ERROR', message: 'Missing storeContext.' } };
      }
      const { storeContext, input = {} } = raw;
      const runs = service.listRuns({
        storeContext,
        missionId: input.missionId,
        status: input.status,
        limit: input.limit,
      });
      return { success: true, runs };
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : String(error);
      return { success: false, error: { code, message: code } };
    }
  });
}
