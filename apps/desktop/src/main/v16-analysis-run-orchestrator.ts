/**
 * V1.6 Analysis Run Orchestrator
 *
 * Coordinates the end-to-end analysis pipeline:
 * Mission -> AnalysisRun -> Decision -> Memory
 *
 * One orchestrator instance owns:
 * - AnalysisRunsService (lifecycle, fingerprint, reuse)
 * - MissionService (mission stage advancement)
 * - DecisionService (proposal creation)
 * - MemoryService (causal event recording)
 *
 * Lifecycle:
 * 1. validateMissionAndReport — check mission is at FACT/ANALYSIS stage and report snapshot is bound
 * 2. startRun (analysis runs service) — pending -> analyzing
 * 3. advanceMissionStage — fact -> analysis
 * 4. simulateAnalysis — placeholder hook for AI/rule pipeline (real impl TBD)
 * 5. proposeDecisions — create Decision rows from analysis proposals
 * 6. completeRun + advanceMissionStage — analysis -> decision
 * 7. appendMemoryCausalEvent — record analysis_completed to Memory
 *
 * @module v16-analysis-run-orchestrator
 */

import type {
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  AnalysisRunsService,
  AnalysisRunsServiceError,
  computeFingerprint,
} from './analysis-runs-service';
import { MissionService, MissionServiceError } from './v16-mission-service';
import { DecisionService, DecisionServiceError } from './v16-decision-service';
import { MemoryService } from './v16-memory-service';

export class OrchestratorError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'STORE_MISMATCH'
      | 'MISSION_NOT_FOUND'
      | 'MISSION_NOT_READY'
      | 'RUN_REUSE'
      | 'ANALYSIS_FAILED'
      | 'NO_PROPOSALS'
      | 'UPSTREAM_ERROR',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

export interface OrchestrateAnalysisInput {
  storeContext: StoreContextEnvelope;
  missionId: string;
  reportSnapshotId: string;
  productId: string;
  policyRevision?: string;
  modelRevision?: string;
  reason?: string;
}

export interface AnalysisProposal {
  actionType: string;
  entityType: string;
  entityId: string;
  currentValue?: string;
  targetValue?: string;
  changeReason?: string;
}

export interface OrchestratorAnalysisHook {
  /**
   * External pipeline (AI/rule) that converts input + report snapshot into proposals.
   * Returns empty array on no-op, throws on unrecoverable error.
   */
  generateProposals(input: {
    storeId: string;
    missionId: string;
    productId: string;
    reportSnapshotId: string;
  }): Promise<AnalysisProposal[]>;
}

export interface OrchestrateAnalysisResult {
  runId: string;
  fingerprint: string;
  reused: boolean;
  proposalCount: number;
  decisionIds: string[];
  missionAdvanced: boolean;
}

/**
 * Default no-op hook — returns empty proposals. Real implementations
 * (AI strategy, rule engine) are injected at construction.
 */
const defaultAnalysisHook: OrchestratorAnalysisHook = {
  async generateProposals() {
    return [];
  },
};

/**
 * AnalysisRunOrchestrator — Mission + AnalysisRuns + Decision + Memory coordination.
 */
export class AnalysisRunOrchestrator {
  constructor(
    private readonly analysisRuns: AnalysisRunsService,
    private readonly missions: MissionService,
    private readonly decisions: DecisionService,
    private readonly memory: MemoryService,
    private readonly hook: OrchestratorAnalysisHook = defaultAnalysisHook,
  ) {}

  /**
   * Run end-to-end analysis against the current store/mission.
   */
  async orchestrate(input: OrchestrateAnalysisInput): Promise<OrchestrateAnalysisResult> {
    const storeId = String(input.storeContext.storeId);

    // 1. Validate mission and report snapshot
    const mission = this.missions.getMission({
      storeContext: input.storeContext,
      missionId: input.missionId,
    });
    if (!mission) {
      throw new OrchestratorError('Mission not found', 'MISSION_NOT_FOUND');
    }
    if (mission.status === 'completed' || mission.status === 'archived') {
      throw new OrchestratorError(
        `Mission is terminal (${mission.status})`,
        'MISSION_NOT_READY',
      );
    }
    if (!input.reportSnapshotId?.trim()) {
      throw new OrchestratorError('reportSnapshotId is required', 'MISSION_NOT_READY');
    }

    // 2. Compute fingerprint for reuse detection
    const fingerprint = computeFingerprint({
      storeId,
      productId: input.productId,
      reportSnapshotId: input.reportSnapshotId,
      missionId: input.missionId,
      policyRevision: input.policyRevision,
      modelRevision: input.modelRevision,
    });

    const reusedRun = this.analysisRuns.findReusedRun({
      storeContext: input.storeContext,
      fingerprint,
    });
    if (reusedRun) {
      // Return existing run summary, do not re-emit decisions.
      return {
        runId: reusedRun.runId,
        fingerprint,
        reused: true,
        proposalCount: reusedRun.recommendationsCount,
        decisionIds: [],
        missionAdvanced: false,
      };
    }

    // 3. Create analysis run (may throw on duplicate)
    let run;
    try {
      run = this.analysisRuns.createRun({
        storeContext: input.storeContext,
        reportSnapshotId: input.reportSnapshotId,
        missionId: input.missionId,
        productId: input.productId,
        policyRevision: input.policyRevision,
        modelRevision: input.modelRevision,
        metadata: { reason: input.reason ?? null },
      });
    } catch (err) {
      if (err instanceof AnalysisRunsServiceError && err.code === 'REUSE_DETECTED') {
        const existing = err.runId ? this.analysisRuns.getRun({
          storeContext: input.storeContext,
          runId: err.runId,
        }) : null;
        return {
          runId: err.runId ?? '',
          fingerprint,
          reused: true,
          proposalCount: existing?.recommendationsCount ?? 0,
          decisionIds: [],
          missionAdvanced: false,
        };
      }
      throw new OrchestratorError(
        `Failed to create analysis run: ${err instanceof Error ? err.message : String(err)}`,
        'UPSTREAM_ERROR',
        err,
      );
    }

    // 4. Start run
    this.analysisRuns.startRun({
      storeContext: input.storeContext,
      runId: run.runId,
    });

    // 5. Advance mission fact -> analysis (no-op if already past)
    let missionAdvanced = false;
    try {
      if (mission.stage === 'fact') {
        this.missions.advanceStage({
          storeContext: input.storeContext,
          missionId: input.missionId,
          targetStage: 'analysis',
          reason: input.reason ?? 'Analysis started',
        });
        missionAdvanced = true;
      }
    } catch (err) {
      if (!(err instanceof MissionServiceError)) throw err;
    }

    // 6. Emit analysis_started memory event
    this.memory.append({
      storeContext: input.storeContext,
      stage: 'analysis',
      analysisRunId: run.runId,
      missionId: input.missionId,
      eventType: 'analysis_started',
      businessDate: new Date().toISOString().slice(0, 10),
      sessionGeneration: 1,
      proofHash: fingerprint,
      summary: `Analysis started for mission ${input.missionId}`,
      status: 'observed',
    });

    // 7. Run external analysis hook
    let proposals: AnalysisProposal[];
    try {
      proposals = await this.hook.generateProposals({
        storeId,
        missionId: input.missionId,
        productId: input.productId,
        reportSnapshotId: input.reportSnapshotId,
      });
    } catch (err) {
      // Mark run failed, advance mission to blocked
      this.analysisRuns.failRun({
        storeContext: input.storeContext,
        runId: run.runId,
        reason: err instanceof Error ? err.message : String(err),
      });
      try {
        this.missions.advanceStage({
          storeContext: input.storeContext,
          missionId: input.missionId,
          targetStage: 'blocked',
          reason: `Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      } catch { /* ignore */ }
      throw new OrchestratorError(
        `Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
        'ANALYSIS_FAILED',
        err,
      );
    }

    if (proposals.length === 0) {
      this.analysisRuns.completeRun({
        storeContext: input.storeContext,
        runId: run.runId,
        recommendationsCount: 0,
      });
      try {
        this.missions.advanceStage({
          storeContext: input.storeContext,
          missionId: input.missionId,
          targetStage: 'decision',
        });
      } catch { /* ignore */ }
      return {
        runId: run.runId,
        fingerprint,
        reused: false,
        proposalCount: 0,
        decisionIds: [],
        missionAdvanced: true,
      };
    }

    // 8. Propose decisions
    const decisionIds: string[] = [];
    for (const p of proposals) {
      try {
        const decision = this.decisions.propose({
          storeContext: input.storeContext,
          missionId: input.missionId,
          missionRevision: mission.revision,
          batchId: run.runId,
          recommendationId: `${run.runId}:${p.entityId}`,
          actionType: p.actionType,
          entityType: p.entityType,
          entityId: p.entityId,
          currentValue: p.currentValue,
          targetValue: p.targetValue,
          changeReason: p.changeReason,
        });
        decisionIds.push(decision.decision_id);
      } catch (err) {
        if (!(err instanceof DecisionServiceError)) throw err;
      }
    }

    // 9. Complete run + advance mission
    this.analysisRuns.completeRun({
      storeContext: input.storeContext,
      runId: run.runId,
      recommendationsCount: decisionIds.length,
    });
    try {
      this.missions.advanceStage({
        storeContext: input.storeContext,
        missionId: input.missionId,
        targetStage: 'decision',
      });
    } catch { /* ignore */ }

    // 10. Emit analysis_completed memory event
    this.memory.append({
      storeContext: input.storeContext,
      stage: 'decision',
      analysisRunId: run.runId,
      missionId: input.missionId,
      eventType: 'analysis_completed',
      businessDate: new Date().toISOString().slice(0, 10),
      sessionGeneration: 1,
      proofHash: fingerprint,
      summary: `Analysis completed: ${decisionIds.length} proposals`,
      details: { proposalCount: decisionIds.length, decisionIds },
      status: 'observed',
    });

    return {
      runId: run.runId,
      fingerprint,
      reused: false,
      proposalCount: decisionIds.length,
      decisionIds,
      missionAdvanced: true,
    };
  }
}
