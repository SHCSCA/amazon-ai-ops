/**
 * Analysis Runs Service
 *
 * Business logic layer for Analysis Run lifecycle management.
 * Wraps AnalysisRunsRepository with store-scoped validation,
 * stage transitions, fingerprint computation, and reuse detection.
 *
 * @module analysis-runs-service
 */

import type {
  AnalysisRunRecord,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type { AnalysisRunsRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/analysis-runs-repo';

/**
 * Analysis run stages (following Mission 6-phase model)
 */
export type AnalysisRunStage =
  | 'fact'      // Report data gathered
  | 'analysis'  // AI/rule analysis running
  | 'decision'  // Recommendations generated
  | 'action'    // Actions submitted
  | 'readback'  // Execution verified
  | 'effect';   // Outcome observed

/**
 * Stage to status mapping for UI display
 */
export const STAGE_TO_STATUS: Record<AnalysisRunStage, AnalysisRunRecord['status']> = {
  fact: 'analyzing',
  analysis: 'analyzing',
  decision: 'completed',
  action: 'completed',
  readback: 'completed',
  effect: 'completed',
};

/**
 * Service errors
 */
export class AnalysisRunsServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'STORE_MISMATCH' | 'RUN_NOT_FOUND' | 'INVALID_TRANSITION' | 'REUSE_DETECTED' | 'SERVICE_ERROR',
    public readonly runId?: string
  ) {
    super(message);
    this.name = 'AnalysisRunsServiceError';
  }
}

/**
 * Fingerprint input for duplicate detection
 */
export interface RunFingerprintInput {
  storeId: string;
  productId: string;
  reportSnapshotId: string;
  missionId?: string;
  policyRevision?: string;
  modelRevision?: string;
}

/**
 * Create fingerprint from input (stable hash)
 */
export function computeFingerprint(input: RunFingerprintInput): string {
  const canonical = JSON.stringify({
    storeId: input.storeId,
    productId: input.productId,
    reportSnapshotId: input.reportSnapshotId,
    missionId: input.missionId ?? null,
    policyRevision: input.policyRevision ?? null,
    modelRevision: input.modelRevision ?? null,
  });

  // Simple hash for fingerprint
  let hash = 0;
  for (let i = 0; i < canonical.length; i++) {
    const char = canonical.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}

/**
 * Validate store context matches run's store
 */
function validateStoreContext(
  repo: AnalysisRunsRepository,
  runId: string,
  storeContext: StoreContextEnvelope
): AnalysisRunRecord {
  const run = repo.findById(runId);
  if (!run) {
    throw new AnalysisRunsServiceError(`Run ${runId} not found`, 'RUN_NOT_FOUND', runId);
  }
  const contextStoreId = String(storeContext.storeId);
  if (run.storeId !== contextStoreId) {
    throw new AnalysisRunsServiceError(
      `Cannot operate on run from different store: ${run.storeId} vs ${contextStoreId}`,
      'STORE_MISMATCH',
      runId
    );
  }
  return run;
}

/**
 * Analysis Runs Service
 */
export class AnalysisRunsService {
  constructor(private readonly repo: AnalysisRunsRepository) {}

  /**
   * Create a new analysis run, checking for fingerprint reuse
   */
  createRun(params: {
    storeContext: StoreContextEnvelope;
    reportSnapshotId: string;
    missionId?: string;
    productId?: string;
    policyRevision?: string;
    modelRevision?: string;
    metadata?: AnalysisRunRecord['metadata'];
  }): AnalysisRunRecord {
    const storeId = String(params.storeContext.storeId);
    const now = new Date().toISOString();

    // Check for fingerprint reuse
    const fingerprint = computeFingerprint({
      storeId,
      productId: params.productId ?? 'unknown',
      reportSnapshotId: params.reportSnapshotId,
      missionId: params.missionId,
      policyRevision: params.policyRevision,
      modelRevision: params.modelRevision,
    });

    // Find existing runs with same fingerprint
    const existingRuns = this.repo.findByStoreId(storeId, 100);
    const reusedRun = existingRuns.find(r => {
      if (!r.metadata?.fingerprint) return false;
      return r.metadata.fingerprint === fingerprint;
    });

    if (reusedRun) {
      throw new AnalysisRunsServiceError(
        `Duplicate analysis run detected. Same input was analyzed at ${reusedRun.createdAt}`,
        'REUSE_DETECTED',
        reusedRun.runId
      );
    }

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const newRun: Omit<AnalysisRunRecord, 'createdAt' | 'updatedAt'> = {
      runId,
      storeId,
      marketplace: 'US',
      currency: 'USD',
      missionId: params.missionId,
      reportSnapshotId: params.reportSnapshotId,
      status: 'pending',
      recommendationsCount: 0,
      metadata: {
        ...params.metadata,
        fingerprint,
        productId: params.productId,
        policyRevision: params.policyRevision,
        modelRevision: params.modelRevision,
      },
    };

    return this.repo.create(newRun);
  }

  /**
   * Start analysis run (transition from pending to analyzing)
   */
  startRun(params: {
    storeContext: StoreContextEnvelope;
    runId: string;
  }): AnalysisRunRecord {
    const run = validateStoreContext(this.repo, params.runId, params.storeContext);

    if (run.status !== 'pending') {
      throw new AnalysisRunsServiceError(
        `Cannot start run in status ${run.status}`,
        'INVALID_TRANSITION',
        params.runId
      );
    }

    return this.repo.update(params.runId, {
      status: 'analyzing',
      startedAt: new Date().toISOString(),
    });
  }

  /**
   * Update run stage and metadata
   */
  updateStage(params: {
    storeContext: StoreContextEnvelope;
    runId: string;
    status?: AnalysisRunRecord['status'];
    recommendationsCount?: number;
    blockedReason?: string | null;
    completedAt?: string;
  }): AnalysisRunRecord {
    validateStoreContext(this.repo, params.runId, params.storeContext);

    const updates: Parameters<typeof this.repo.update>[1] = {};
    if (params.status !== undefined) updates.status = params.status;
    if (params.recommendationsCount !== undefined) {
      updates.recommendationsCount = params.recommendationsCount;
    }
    if (params.blockedReason !== undefined) {
      updates.blockedReason = params.blockedReason || undefined;
    }
    if (params.completedAt !== undefined) {
      updates.completedAt = params.completedAt;
    }

    const updated = this.repo.update(params.runId, updates);
    if (!updated) {
      throw new AnalysisRunsServiceError(
        `Failed to update run ${params.runId}`,
        'SERVICE_ERROR',
        params.runId
      );
    }
    return updated;
  }

  /**
   * Complete analysis run successfully
   */
  completeRun(params: {
    storeContext: StoreContextEnvelope;
    runId: string;
    recommendationsCount: number;
  }): AnalysisRunRecord {
    return this.updateStage({
      storeContext: params.storeContext,
      runId: params.runId,
      status: 'completed',
      recommendationsCount: params.recommendationsCount,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Fail analysis run with reason
   */
  failRun(params: {
    storeContext: StoreContextEnvelope;
    runId: string;
    reason: string;
  }): AnalysisRunRecord {
    return this.updateStage({
      storeContext: params.storeContext,
      runId: params.runId,
      status: 'failed',
      blockedReason: params.reason,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Block analysis run with reason
   */
  blockRun(params: {
    storeContext: StoreContextEnvelope;
    runId: string;
    reason: string;
  }): AnalysisRunRecord {
    return this.updateStage({
      storeContext: params.storeContext,
      runId: params.runId,
      status: 'blocked',
      blockedReason: params.reason,
    });
  }

  /**
   * Get a specific run by ID
   */
  getRun(params: {
    storeContext: StoreContextEnvelope;
    runId: string;
  }): AnalysisRunRecord | null {
    const run = this.repo.findById(params.runId);
    if (!run) return null;

    const contextStoreId = String(params.storeContext.storeId);
    if (run.storeId !== contextStoreId) {
      throw new AnalysisRunsServiceError(
        'Cannot access run from different store',
        'STORE_MISMATCH',
        params.runId
      );
    }
    return run;
  }

  /**
   * List runs for current store
   */
  listRuns(params: {
    storeContext: StoreContextEnvelope;
    missionId?: string;
    status?: AnalysisRunRecord['status'];
    limit?: number;
  }): AnalysisRunRecord[] {
    const storeId = String(params.storeContext.storeId);
    let runs = this.repo.findByStoreId(storeId, params.limit ?? 50);

    // Filter by missionId
    if (params.missionId) {
      const byMission = this.repo.findByMissionId(params.missionId);
      const missionRunIds = new Set(byMission.map(r => r.runId));
      runs = runs.filter(r => missionRunIds.has(r.runId));
    }

    // Filter by status
    if (params.status) {
      runs = runs.filter(r => r.status === params.status);
    }

    return runs;
  }

  /**
   * Get reuse information for a fingerprint
   */
  findReusedRun(params: {
    storeContext: StoreContextEnvelope;
    fingerprint: string;
  }): AnalysisRunRecord | null {
    const storeId = String(params.storeContext.storeId);
    const runs = this.repo.findByStoreId(storeId, 100);
    return runs.find(r => r.metadata?.fingerprint === params.fingerprint) ?? null;
  }
}
