import { assertRendererPayloadIsPathFree } from './main-artifact-registry';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import {
  AnalysisAuthorityRepository,
  AnalysisAuthorityRepositoryError,
  MissionDomainRepository,
  RecommendationRepository,
  type AnalysisCausalMemoryItem,
} from '@amazon-ai-ops/local-db';
import {
  type ActionRecommendation,
  type AnalysisEvidencePackageRecord,
  type AnalysisProposalSnapshotRecord,
  type AuthorizeAnalysisProposalBatchRequest,
  type AuthorizeAnalysisProposalBatchResult,
  type MissionGrantRecord,
  type MissionAnalysisProjection,
  type PolicyVersionRules,
  type RunMissionAnalysisRequest,
  type RunMissionAnalysisResult,
  type StoreContextEnvelope,
  type VerifiedAdEntityAuthorityRecord,
  type WritableAdTargetEvidence,
} from '@amazon-ai-ops/shared-types';
import type { StoreCoordinator } from './store-coordinator';
import { createAnalysisRunsRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/analysis-runs-repo';
import type { AnalysisRunRecord } from '@amazon-ai-ops/shared-types';
import { assertCurrentWritableAdTargetAuthority } from './writable-ad-target-resolution';

export interface RecommendationGenerationResultForAnalysis {
  generated: number;
  metrics: number;
  skippedDuplicates: number;
  refreshedDuplicates: number;
  recommendationCandidates: number;
  recommendationIds: number[];
  aiExplanation: {
    configured: boolean;
    invoked: boolean;
    reason: string;
    model?: string;
    strategyDiagnosis?: { source?: 'ai' | 'rule' };
  };
  scope: {
    storeId: string;
    storeName: string;
    marketplaceCode: string;
    dateFrom: string;
    dateTo: string;
    asin?: string;
    batchId?: string;
  };
}

export interface AnalysisRecommendationGenerationScope {
  missionId?: string;
  storeContext: StoreContextEnvelope;
  dateFrom: string;
  dateTo: string;
  storeName: string;
  marketplaceCode: 'US';
  asin?: string;
  batchId: string;
  /** Main-only, product-scoped and proof-backed prior outcomes. */
  causalMemory: readonly AnalysisCausalMemoryItem[];
  /** Stable digest over normalized causal-memory business content and proofs. */
  memoryDigest: string;
  /** Cancels Main/provider work when the bounded analysis run is no longer authoritative. */
  signal: AbortSignal;
}

/**
 * One immutable analysis-run authority captured before evidence sealing.
 *
 * Main must bind `generateRecommendations` to the exact runtime/rule/AI
 * snapshot represented by these revisions. Keeping the closure and revisions
 * together prevents a long AI await from re-reading mutable global settings.
 */
export interface CapturedAnalysisGenerationAuthority {
  readonly ruleRevision: string;
  readonly modelRevision: string;
  readonly generateRecommendations: (
    scope: AnalysisRecommendationGenerationScope,
  ) => Promise<RecommendationGenerationResultForAnalysis>;
}

export interface AnalysisAuthorityServiceOptions {
  db: Database.Database;
  repository: AnalysisAuthorityRepository;
  missionRepository: MissionDomainRepository;
  recommendationRepository: RecommendationRepository;
  storeCoordinator: Pick<StoreCoordinator, 'assertActiveStoreContext'>;
  generateRecommendations: CapturedAnalysisGenerationAuthority['generateRecommendations'];
  /**
   * Preferred production boundary. The legacy generator remains temporarily
   * available so Main can be migrated without weakening authorization-time
   * current-revision checks.
   */
  captureGenerationAuthority?: () => CapturedAnalysisGenerationAuthority;
  currentRuleRevision: () => string;
  currentModelRevision: () => string;
  allowedProofRoots: (context: StoreContextEnvelope) => readonly string[];
  onAutomaticGrantIssued?: (
    context: StoreContextEnvelope,
    grant: MissionGrantRecord,
  ) => void;
  /** Main-only deadline for one recommendation-generation attempt. */
  generationTimeoutMs?: number | undefined;
  now?: () => Date;
}

const ANALYSIS_EVIDENCE_FRESHNESS_HOURS = 48;
const ANALYSIS_ACTION_CONTRACT_VERSION = 'keyword-bid-cents/v16-1';
const MAX_IDENTITY_PROOF_BYTES = 16 * 1024 * 1024;
export const DEFAULT_ANALYSIS_GENERATION_TIMEOUT_MS = 120_000;
const MAX_ANALYSIS_GENERATION_TIMEOUT_MS = 15 * 60_000;

/** Main-only orchestrator for sealed analysis, Decision creation and grants. */
export class AnalysisAuthorityService {
  private readonly activeRuns = new Set<string>();
  private readonly pendingMissions = new Set<string>();
  private readonly analysisRuns: ReturnType<typeof createAnalysisRunsRepository>;
  private readonly db: Database.Database;
  private readonly repository: AnalysisAuthorityRepository;
  private readonly missionRepository: MissionDomainRepository;
  private readonly recommendationRepository: RecommendationRepository;
  private readonly storeCoordinator: AnalysisAuthorityServiceOptions['storeCoordinator'];
  private readonly generateRecommendations: AnalysisAuthorityServiceOptions['generateRecommendations'];
  private readonly captureGenerationAuthority: () => CapturedAnalysisGenerationAuthority;
  private readonly currentRuleRevision: AnalysisAuthorityServiceOptions['currentRuleRevision'];
  private readonly currentModelRevision: AnalysisAuthorityServiceOptions['currentModelRevision'];
  private readonly allowedProofRoots: AnalysisAuthorityServiceOptions['allowedProofRoots'];
  private readonly onAutomaticGrantIssued?: AnalysisAuthorityServiceOptions['onAutomaticGrantIssued'];
  private readonly generationTimeoutMs: number;
  private readonly now: () => Date;

  constructor(options: AnalysisAuthorityServiceOptions) {
    this.db = options.db;
    this.analysisRuns = createAnalysisRunsRepository(options.db);
    this.repository = options.repository;
    this.missionRepository = options.missionRepository;
    this.recommendationRepository = options.recommendationRepository;
    this.storeCoordinator = options.storeCoordinator;
    this.generateRecommendations = options.generateRecommendations;
    this.captureGenerationAuthority = options.captureGenerationAuthority ?? (() => ({
      ruleRevision: options.currentRuleRevision(),
      modelRevision: options.currentModelRevision(),
      generateRecommendations: this.generateRecommendations,
    }));
    this.currentRuleRevision = options.currentRuleRevision;
    this.currentModelRevision = options.currentModelRevision;
    this.allowedProofRoots = options.allowedProofRoots;
    this.onAutomaticGrantIssued = options.onAutomaticGrantIssued;
    this.generationTimeoutMs = validatedAnalysisGenerationTimeout(
      options.generationTimeoutMs ?? DEFAULT_ANALYSIS_GENERATION_TIMEOUT_MS,
    );
    this.now = options.now ?? (() => new Date());
  }

  async runMissionAnalysis(request: RunMissionAnalysisRequest): Promise<RunMissionAnalysisResult> {
    const context = this.assertContext(request.context);
    const key = JSON.stringify([context, request.missionId]);
    if (this.pendingMissions.has(key)) throw new Error('本任务正在分析，请等待当前运行完成后再试。');
    this.pendingMissions.add(key);
    try { return await this.performMissionAnalysis(request); }
    finally { this.pendingMissions.delete(key); }
  }

  private async performMissionAnalysis(request: RunMissionAnalysisRequest): Promise<RunMissionAnalysisResult> {
    const context = this.assertContext(request.context);
    const mission = this.missionRepository.getMission(context, requiredId(request.missionId, 'missionId'));
    if (!mission) throw new Error('Mission analysis blocked: Mission was not found in the active store.');
    this.missionRepository.assertMissionMayCreateAuthority(context, mission.id);
    if (mission.status !== 'active') throw new Error('Mission analysis blocked: Mission must be active.');
    if (mission.phase === 'action' || mission.phase === 'readback' || mission.phase === 'effect') {
      throw new Error(
        '运营任务已进入执行、回读或效果评估阶段，不能在原任务上重新分析；为保护已有授权、执行回读与实验证据，请新建运营任务后再运行分析。',
      );
    }
    const batch = this.db.prepare(`
      SELECT marketplace_code AS marketplaceCode,
             date_start AS dateFrom, date_end AS dateTo
      FROM lingxing_report_batches WHERE store_id = ? AND id = ? AND status = 'completed'
    `).get(context.storeId, mission.dataBatchId) as {
      marketplaceCode: string;
      dateFrom: string;
      dateTo: string;
    } | undefined;
    if (!batch || batch.marketplaceCode !== 'US') {
      throw new Error('Mission analysis blocked: completed US Lingxing data batch is unavailable.');
    }
    if ((request.dateFrom && request.dateFrom !== batch.dateFrom)
      || (request.dateTo && request.dateTo !== batch.dateTo)) {
      throw new Error('Mission analysis blocked: scope must equal the Mission data-batch date range.');
    }
    const dateFrom = batch.dateFrom;
    const dateTo = batch.dateTo;
    const store = this.db.prepare(`
      SELECT display_name AS displayName, marketplace, status
      FROM stores
      WHERE store_id = ?
    `).get(context.storeId) as {
      displayName: string;
      marketplace: string;
      status: string;
    } | undefined;
    if (!store || store.status !== 'active' || store.marketplace !== 'US' || !store.displayName.trim()) {
      throw new Error('Mission analysis blocked: active logical US store authority is unavailable.');
    }
    const asin = mission.productId?.toUpperCase();
    const memorySnapshot = this.captureAnalysisCausalMemory(context, mission.productId);
    const capturedAuthority = this.captureGenerationAuthority();
    if (!capturedAuthority || typeof capturedAuthority.generateRecommendations !== 'function') {
      throw new TypeError('captured analysis generation authority is invalid');
    }
    const generationAuthority = Object.freeze({
      ruleRevision: sha256Text(capturedAuthority.ruleRevision, 'ruleRevision'),
      modelRevision: effectiveModelRevision(
        requiredText(capturedAuthority.modelRevision, 'modelRevision'),
        memorySnapshot.memoryDigest,
        memorySnapshot.items.length,
      ),
      generateRecommendations: capturedAuthority.generateRecommendations,
    });
    const { ruleRevision, modelRevision } = generationAuthority;
    const policyVersion = this.missionRepository.getPolicyVersion(context, mission.policyVersionId);
    const policyRuntime = this.missionRepository.getPolicyRuntime(context);
    const fingerprint = (missionRevision: number, evidenceHash: string) => createHash('sha256').update(JSON.stringify({
      actionContractVersion: ANALYSIS_ACTION_CONTRACT_VERSION,
      context, missionId: mission.id, missionRevision, productId: asin, dateFrom, dateTo,
      evidenceHash, ruleRevision, modelRevision, policyVersion, policyRuntime,
      memoryDigest: memorySnapshot.memoryDigest,
    })).digest('hex');
    const analysisRunId = compactId('analysis-run', {
      missionId: mission.id,
      attempt: randomUUID(),
    });
    this.missionRepository.appendCausalEvent(context, {
      id: compactId('analysis-run-event', [analysisRunId, 'started']),
      stage: 'ANALYSIS',
      eventType: 'analysis_run_started',
      entityType: 'analysis_run',
      entityId: analysisRunId,
      missionId: mission.id,
      title: '分析已开始',
      signal: `正在分析 ${dateFrom} 至 ${dateTo} 的当前店铺数据；完成或失败后会保留可追溯结果。`,
      status: 'running',
      source: 'analysis-authority',
      actorId: 'analysis-agent',
    });
    let analysisCompleted = false;
    try {
    const evidencePackage = this.repository.sealEvidencePackage(context, {
      missionId: mission.id,
      dateFrom,
      dateTo,
      asin,
      freshnessWindowHours: ANALYSIS_EVIDENCE_FRESHNESS_HOURS,
      ruleRevision,
      modelRevision,
    });

    if (Date.parse(evidencePackage.freshUntil) <= this.now().getTime()) throw new Error('分析数据已过期，请重新采集并导入当前完整报表。');
    const inputFingerprint = fingerprint(mission.revision, evidencePackage.packageHash);
    const previous = this.analysisRuns.findByMissionId(mission.id).find(run => run.storeId === context.storeId
      && run.status === 'completed' && run.metadata?.provenance === 'analysis-authority/v16'
      && run.metadata.fingerprint === inputFingerprint);
    const cachedGeneration = previous?.metadata?.generation as RecommendationGenerationResultForAnalysis | undefined;
    const generationIsCurrent = cachedGeneration && previous?.metadata?.recommendationFingerprint === this.recommendationFingerprint(context, cachedGeneration.recommendationIds);
    this.analysisRuns.create({ runId: analysisRunId, storeId: context.storeId, marketplace: 'US', currency: 'USD',
      missionId: mission.id, reportSnapshotId: evidencePackage.importRunId, status: 'analyzing', recommendationsCount: 0,
      startedAt: this.now().toISOString(), metadata: { provenance: 'analysis-authority/v16', storeContext: context,
        missionRevision: mission.revision, policyRevision: policyVersion?.revision, fingerprint: inputFingerprint,
        evidencePackageId: evidencePackage.id, evidencePackageHash: evidencePackage.packageHash,
        productId: asin, dateFrom, dateTo, ruleRevision, modelRevision } });
    this.activeRuns.add(analysisRunId);

    const generation = generationIsCurrent ? { ...cachedGeneration, generated: 0, refreshedDuplicates: 0, skippedDuplicates: cachedGeneration.recommendationIds.length } : await generateRecommendationsWithinDeadline(generationAuthority.generateRecommendations, {
      missionId: mission.id,
      storeContext: context,
      dateFrom,
      dateTo,
      storeName: store.displayName,
      marketplaceCode: 'US',
      asin,
      batchId: mission.dataBatchId,
      causalMemory: memorySnapshot.items,
      memoryDigest: memorySnapshot.memoryDigest,
    }, this.generationTimeoutMs);
    this.assertContext(context);
    if (generation.scope.storeId !== context.storeId
      || generation.scope.batchId !== mission.dataBatchId
      || generation.scope.marketplaceCode !== 'US'
      || generation.scope.storeName !== store.displayName
      || generation.scope.dateFrom !== dateFrom
      || generation.scope.dateTo !== dateTo
      || normalizedOptionalText(generation.scope.asin) !== normalizedOptionalText(asin)) {
      throw new Error('Mission analysis blocked: recommendation generation returned another store or data batch.');
    }

    const recommendations = generation.recommendationIds
      .map((id) => this.recommendationRepository.findByIdForStore(context.storeId, id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const actionFingerprint = compactId('analysis-action-fingerprint', {
      actionContractVersion: ANALYSIS_ACTION_CONTRACT_VERSION,
      memoryDigest: memorySnapshot.memoryDigest,
      recommendations: recommendations
        .map((row) => ({
          id: row.id,
          revision: row.revision ?? 0,
          actionType: row.actionType,
          entityType: row.entityType,
          entityName: row.entityName,
          currentValue: row.currentValue,
          recommendedValue: row.recommendedValue,
          campaignName: row.evidence?.campaignName,
          adGroupName: row.evidence?.adGroupName,
          matchType: row.evidence?.matchType,
          writableAdEntityId: row.evidence?.writableTarget?.entityId,
          writableVerifiedAt: row.evidence?.writableTarget?.verifiedAt,
        }))
        .sort((left, right) => Number(left.id ?? 0) - Number(right.id ?? 0)),
    });
    const finalizeAnalysis = this.db.transaction(() => {
      this.assertContext(context);
      const currentRuntime = this.missionRepository.getPolicyRuntime(context);
      const currentPolicy = this.missionRepository.getPolicyVersion(context, mission.policyVersionId);
      if (currentRuntime.revision !== policyRuntime.revision
        || currentPolicy?.revision !== policyVersion?.revision || currentPolicy?.status !== policyVersion?.status) {
        throw new Error('执行模式或策略在分析期间已变化，请按当前策略重新运行分析。');
      }
      const finalMemorySnapshot = this.captureAnalysisCausalMemory(context, mission.productId);
      if (finalMemorySnapshot.memoryDigest !== memorySnapshot.memoryDigest) {
        throw new Error('Trusted causal memory changed while Mission analysis was running.');
      }
      const currentMission = this.missionRepository.getMission(context, mission.id);
      if (!currentMission
        || currentMission.status !== 'active'
        || currentMission.revision !== mission.revision) {
        throw new Error('Mission changed while its analysis was running.');
      }

      const actionBatchIdForRevision = (missionRevision: number) => compactId('analysis-action-batch', {
        evidencePackageHash: evidencePackage.packageHash,
        missionRevision,
        actionFingerprint,
      });
      const latestActionBatch = this.repository.getLatestActionBatch(context, currentMission.id);
      const canReuseLatestActionBatch = Boolean(
        latestActionBatch
        && latestActionBatch.missionRevision === currentMission.revision
        && latestActionBatch.id === actionBatchIdForRevision(latestActionBatch.missionRevision),
      );
      // The first completed analysis and every changed action fingerprint bump
      // Mission revision in this same IMMEDIATE transaction before a new batch
      // is sealed. Thus every grant issued for the previous revision becomes
      // stale atomically. Only the exact latest fingerprint may be reused.
      const progressedMission = currentMission.phase === 'fact'
        || currentMission.phase === 'analysis'
        || !canReuseLatestActionBatch
        ? this.missionRepository.transitionMission(context, {
            id: currentMission.id,
            expectedRevision: currentMission.revision,
            status: 'active',
            phase: 'decision',
            reason: latestActionBatch ? 'analysis_action_fingerprint_changed' : 'analysis_completed',
            actorId: 'analysis-agent',
          })
        : currentMission;
      const actionBatchId = actionBatchIdForRevision(progressedMission.revision);
      const actionBatch = this.repository.createActionBatch(context, {
        id: actionBatchId,
        missionId: progressedMission.id,
        evidencePackageId: evidencePackage.id,
        expectedMissionRevision: progressedMission.revision,
      });

      const proposals: AnalysisProposalSnapshotRecord[] = [];
      let skippedUnsupportedRecommendations = 0;
      for (const recommendation of recommendations) {
        const authority = this.materializeWritableAuthority(context, evidencePackage, recommendation);
        try {
          const proposal = this.repository.createProposalSnapshot(context, {
            id: compactId('analysis-proposal', {
              actionBatchId: actionBatch.id,
              recommendationId: recommendation.id,
              recommendationRevision: recommendation.revision ?? 0,
            }),
            missionId: progressedMission.id,
            evidencePackageId: evidencePackage.id,
            actionBatchId: actionBatch.id,
            legacyRecommendationId: recommendation.id!,
            adEntityAuthorityId: authority?.authorityId,
            validUntil: proposalValidUntil(
              this.now(),
              evidencePackage.freshUntil,
              progressedMission.observationEndsAt,
            ),
          });
          this.ensureDecisionForProposal(context, proposal);
          proposals.push(proposal);
        } catch (error) {
          if (error instanceof AnalysisAuthorityRepositoryError && error.code === 'UNSUPPORTED_ACTION') {
            skippedUnsupportedRecommendations += 1;
            continue;
          }
          throw error;
        }
      }
      if (latestActionBatch && !canReuseLatestActionBatch) {
        this.supersedePriorOpenDecisions(context, progressedMission.id, proposals);
      }
      this.appendAnalysisCheckpointOnce(
        context,
        progressedMission.id,
        actionBatch.id,
        'FACT',
        '8 类领星事实已封存',
        evidencePackage.reportTypes.length,
      );
      this.appendAnalysisCheckpointOnce(
        context,
        progressedMission.id,
        actionBatch.id,
        'ANALYSIS',
        `分析完成，形成 ${proposals.length} 条可复核建议`,
        proposals.length,
      );
      const sourceLabel = generation.aiExplanation.invoked
        && generation.aiExplanation.strategyDiagnosis?.source === 'ai'
        ? '规则与 AI 一致'
        : '规则分析';
      const run = this.analysisRuns.findById(analysisRunId)!;
      this.analysisRuns.update(analysisRunId, { status: 'completed', completedAt: this.now().toISOString(), recommendationsCount: proposals.length,
        metadata: { ...run.metadata, missionRevision: progressedMission.revision,
          fingerprint: fingerprint(progressedMission.revision, evidencePackage.packageHash), actionBatchId: actionBatch.id,
          reusedFromRunId: generationIsCurrent ? previous?.runId : undefined,
          generation, recommendationFingerprint: this.recommendationFingerprint(context, generation.recommendationIds),
          proposalsGenerated: proposals.length, skippedUnsupportedCount: skippedUnsupportedRecommendations,
          recommendationSummary: { candidates: generation.recommendationCandidates, created: generation.generated, refreshed: generation.refreshedDuplicates, reused: generation.skippedDuplicates },
          aiSummary: { configured: generation.aiExplanation.configured, invoked: generation.aiExplanation.invoked,
            source: generation.aiExplanation.invoked && generation.aiExplanation.strategyDiagnosis?.source === 'ai' ? 'ai' : 'rule_fallback', detail: safeAiAnalysisDetail(generation.aiExplanation) },
        } });
      this.missionRepository.appendCausalEvent(context, {
        id: compactId('analysis-run-event', [analysisRunId, 'completed']),
        stage: 'ANALYSIS',
        eventType: 'analysis_run_completed',
        entityType: 'analysis_run',
        entityId: analysisRunId,
        missionId: progressedMission.id,
        title: '分析已完成',
        signal: `形成 ${proposals.length} 条可复核建议；${sourceLabel}；新建 ${generation.generated} 条，刷新 ${generation.refreshedDuplicates} 条，复用已有 ${generation.skippedDuplicates} 条。`,
        observedEffect: `分析结果已绑定当前任务的证据包与建议批次。`,
        status: 'completed',
        source: 'analysis-authority',
        actorId: 'analysis-agent',
      });
      return { proposals, skippedUnsupportedRecommendations };
    });
    const { proposals, skippedUnsupportedRecommendations } = finalizeAnalysis.immediate();
    analysisCompleted = true;
    this.assertContext(context);
    const result: RunMissionAnalysisResult = {
      evidencePackage,
      proposals,
      generatedRecommendations: generation.recommendationIds.length,
      skippedUnsupportedRecommendations,
      recommendationSummary: {
        candidates: generation.recommendationCandidates,
        created: generation.generated,
        refreshed: generation.refreshedDuplicates,
        reused: generation.skippedDuplicates,
      },
      ai: {
        configured: generation.aiExplanation.configured,
        invoked: generation.aiExplanation.invoked,
        modelRevision,
        source: generation.aiExplanation.invoked && generation.aiExplanation.strategyDiagnosis?.source === 'ai'
          ? 'ai'
          : 'rule_fallback',
        detail: safeAiAnalysisDetail(generation.aiExplanation),
      },
    };
    if (proposals.length > 0
      && policyRuntime.autonomyMode === 'policy_auto') {
      result.automaticAuthorization = this.authorizeProposalBatch({
        context,
        missionId: mission.id,
        proposalIds: proposals.map((proposal) => proposal.id),
      }, 'policy_auto');
      if (result.automaticAuthorization.authorized && result.automaticAuthorization.grant) {
        this.onAutomaticGrantIssued?.(context, result.automaticAuthorization.grant);
      }
    }
    return result;
    } catch (error) {
      if (!analysisCompleted) {
        this.appendAnalysisFailureReceiptBestEffort(context, mission.id, analysisRunId, error);
        try {
          this.assertContext(context);
          this.analysisRuns.update(analysisRunId, { status: 'failed', completedAt: this.now().toISOString(), blockedReason: analysisRunFailureOperatorReason(error) });
        } catch { /* The original store/session receipt remains interrupted and read-only. */ }
      }
      throw error;
    } finally {
      this.activeRuns.delete(analysisRunId);
    }
  }

  private recommendationFingerprint(context: StoreContextEnvelope, ids: readonly number[]): string {
    return createHash('sha256').update(JSON.stringify(ids.map(id => this.recommendationRepository.findByIdForStore(context.storeId, id) ?? null))).digest('hex');
  }

  listAnalysisRuns(contextInput: StoreContextEnvelope, input: { missionId?: string; status?: AnalysisRunRecord['status']; limit?: number } = {}): AnalysisRunRecord[] {
    const context = this.assertContext(contextInput);
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('分析记录数量必须在 1 至 200 之间。');
    if (input.status && !['pending', 'analyzing', 'completed', 'failed', 'blocked'].includes(input.status)) throw new Error('分析记录状态无效。');
    const missionId = input.missionId === undefined ? undefined : requiredId(input.missionId, 'missionId');
    return this.db.transaction(() => {
      const result: AnalysisRunRecord[] = [];
      // ponytail: bounded pages scan historical statuses; index effective status if measured history latency exceeds budget.
      for (let offset = 0; result.length < limit; offset += 200) {
        const rows = this.analysisRuns.findByStoreId(context.storeId, 200, offset);
        for (const row of rows) {
          if (missionId && row.missionId !== missionId) continue;
          const run = this.projectAnalysisRun(context, row);
          if (!input.status || run.status === input.status) result.push(run);
          if (result.length === limit) break;
        }
        if (rows.length < 200) break;
      }
      return result;
    })();
  }

  getAnalysisRun(contextInput: StoreContextEnvelope, runId: string): AnalysisRunRecord | null {
    const context = this.assertContext(contextInput);
    const run = this.analysisRuns.findById(requiredId(runId, 'runId'));
    return run?.storeId === context.storeId ? this.projectAnalysisRun(context, run) : null;
  }

  private projectAnalysisRun(context: StoreContextEnvelope, run: AnalysisRunRecord): AnalysisRunRecord {
    const allowed = ['storeContext', 'missionRevision', 'policyRevision', 'fingerprint', 'evidencePackageId', 'evidencePackageHash', 'actionBatchId', 'reusedFromRunId', 'provenance', 'productId', 'dateFrom', 'dateTo', 'ruleRevision', 'modelRevision', 'proposalsGenerated', 'skippedUnsupportedCount', 'aiSummary', 'recommendationSummary'] as const;
    const metadata = Object.fromEntries(allowed.flatMap(key => {
      const value = run.metadata?.[key];
      if (value === undefined) return [];
      try { assertRendererPayloadIsPathFree({ [key]: value }); return [[key, value]]; }
      catch { return []; } // Retain unsafe legacy metadata in Main, while history stays readable.
    })) as NonNullable<AnalysisRunRecord['metadata']>;
    let blockedReason = run.blockedReason;
    try { assertRendererPayloadIsPathFree(blockedReason); }
    catch { blockedReason = analysisRunFailureOperatorReason(new Error(blockedReason)); }
    const interrupted = ['pending', 'analyzing'].includes(run.status) && (!this.activeRuns.has(run.runId)
      || JSON.stringify(metadata.storeContext) !== JSON.stringify(context));
    return { ...run, status: interrupted ? 'blocked' : run.status,
      blockedReason: interrupted ? '上次分析已中断；刷新当前店铺后重新运行分析。' : blockedReason,
      metadata: { ...metadata, historicalOnly: metadata.provenance !== 'analysis-authority/v16' } };
  }

  private appendAnalysisFailureReceiptBestEffort(
    context: StoreContextEnvelope,
    missionId: string,
    analysisRunId: string,
    error: unknown,
  ): void {
    try {
      this.missionRepository.appendCausalEvent(context, {
        id: compactId('analysis-run-event', [analysisRunId, 'failed']),
        stage: 'ANALYSIS',
        eventType: 'analysis_run_failed',
        entityType: 'analysis_run',
        entityId: analysisRunId,
        missionId,
        title: '分析未完成',
        signal: analysisRunFailureOperatorReason(error),
        status: 'failed',
        source: 'analysis-authority',
        actorId: 'analysis-agent',
      });
    } catch {
      // Store/session authority may have changed while analysis was awaiting AI.
      // Preserve the original failure; the orphaned started receipt is shown as
      // interrupted on the next load instead of fabricating a terminal state.
    }
  }

  private appendAnalysisCheckpointOnce(
    context: StoreContextEnvelope,
    missionId: string,
    actionBatchId: string,
    stage: 'FACT' | 'ANALYSIS',
    title: string,
    evidenceCount: number,
  ): void {
    const id = compactId('analysis-checkpoint', [missionId, actionBatchId, stage]);
    const exists = this.missionRepository.listMissionCheckpoints(context, missionId)
      .some((checkpoint) => checkpoint.id === id);
    if (exists) return;
    this.missionRepository.appendMissionCheckpoint(context, {
      id,
      missionId,
      stage,
      title,
      status: 'completed',
      evidenceCount,
      actorId: 'analysis-agent',
    });
  }

  getMissionAnalysisProjection(
    contextInput: StoreContextEnvelope,
    missionIdInput: string,
  ): MissionAnalysisProjection {
    const context = this.assertContext(contextInput);
    const missionId = requiredId(missionIdInput, 'missionId');
    const projection = {
      evidencePackages: this.repository.listEvidencePackages(context, missionId),
      actionBatches: this.repository.listActionBatches(context, missionId),
      proposals: this.repository.listProposalSnapshots(context, missionId),
      decisionLinks: this.repository.listProposalDecisionLinks(context, missionId),
    };
    this.assertContext(context);
    return projection;
  }

  authorizeProposalBatch(
    request: AuthorizeAnalysisProposalBatchRequest,
    requiredMode?: AuthorizeAnalysisProposalBatchResult['mode'],
  ): AuthorizeAnalysisProposalBatchResult {
    const context = this.assertContext(request.context);
    const missionId = requiredId(request.missionId, 'missionId');
    const selectedIds = uniqueNonEmptyIds(request.proposalIds, 'proposalIds');
    const authorize = this.db.transaction((): AuthorizeAnalysisProposalBatchResult => {
      // Every authority read, optional batch approval and immutable grant write
      // happens under one IMMEDIATE transaction. A failed grant insert rolls
      // back all Decision transitions instead of leaving partial approval.
      this.assertContext(context);
      const runtime = this.missionRepository.getPolicyRuntime(context);
      const mode = runtime.autonomyMode;
      if (requiredMode && mode !== requiredMode) {
        return blockedResult(
          requiredMode,
          selectedIds,
          [],
          '策略运行模式已变化；自动授权未降级为人工授权。',
        );
      }
      const mission = this.missionRepository.getMission(context, missionId);
      if (!mission) return blockedResult(mode, selectedIds, [], 'Mission 不存在或不属于当前店铺。');
      if (mission.status !== 'active') {
        return blockedResult(mode, selectedIds, [], 'Mission 必须处于 active 才能签发执行授权。');
      }

      const selected = selectedIds.map((id) => this.repository.getProposalSnapshot(context, id));
      if (selected.some((row) => !row)) {
        return blockedResult(mode, selectedIds, [], '选择中包含不存在或跨店铺的建议快照。');
      }
      const proposals = selected as AnalysisProposalSnapshotRecord[];
      const actionBatchIds = new Set(proposals.map((row) => row.actionBatchId));
      if (actionBatchIds.size !== 1 || proposals.some((row) => row.missionId !== mission.id)) {
        return blockedResult(mode, selectedIds, [], '一次授权必须来自同一个 Mission 动作批次。');
      }
      const actionBatchId = proposals[0].actionBatchId;
      const latestBatch = this.repository.getLatestActionBatch(context, mission.id);
      if (!latestBatch || latestBatch.id !== actionBatchId
        || latestBatch.actionRevision !== proposals[0].actionRevision) {
        return blockedResult(mode, selectedIds, [], '只能授权当前 Mission 的最新分析动作批次。');
      }
      if (latestBatch.missionRevision !== mission.revision
        || proposals.some((proposal) => proposal.missionRevision !== mission.revision)) {
        return blockedResult(mode, selectedIds, [], 'Mission 已修订；旧分析建议必须重新运行后才能授权。');
      }
      try { this.missionRepository.assertWriteAuthority(context, latestBatch.authority); }
      catch { return blockedResult(mode, selectedIds, [], '动作批次的店铺、会话或授权模式版本已变化；请重新分析。'); }
      const currentRuleRevision = sha256Text(this.currentRuleRevision(), 'ruleRevision');
      const currentMemory = this.captureAnalysisCausalMemory(context, mission.productId);
      const currentModelRevision = effectiveModelRevision(
        requiredText(this.currentModelRevision(), 'modelRevision'),
        currentMemory.memoryDigest,
        currentMemory.items.length,
      );
      if (latestBatch.ruleRevision !== currentRuleRevision
        || proposals.some((proposal) => proposal.ruleRevision !== currentRuleRevision)) {
        return blockedResult(mode, selectedIds, [], '当前规则 revision 已变化；必须重新分析。');
      }
      if (latestBatch.modelRevision !== currentModelRevision
        || proposals.some((proposal) => proposal.modelRevision !== currentModelRevision)) {
        return blockedResult(mode, selectedIds, [], '当前 AI 模型 revision 已变化；必须重新分析。');
      }
      const completeBatch = this.repository.listProposalSnapshots(context, mission.id)
        .filter((row) => row.actionBatchId === actionBatchId);
      if (!sameSet(selectedIds, completeBatch.map((row) => row.id))) {
        return blockedResult(mode, selectedIds, [], '必须整批授权，不能只批准动作批次的一部分。');
      }

      const links = this.repository.listProposalDecisionLinks(context, mission.id)
        .filter((link) => selectedIds.includes(link.proposalId));
      const decisionByProposal = new Map(links.map((link) => [link.proposalId, link.decisionId]));
      const decisionIds = proposals
        .map((proposal) => decisionByProposal.get(proposal.id))
        .filter(Boolean) as string[];
      const blockers: string[] = [];
      if (decisionIds.length !== proposals.length) blockers.push('至少一个建议缺少不可变 Decision 关联。');
      const now = this.now().getTime();
      const evidenceById = new Map<string, AnalysisEvidencePackageRecord>();
      for (const proposal of proposals) {
        const eligibility = mode === 'policy_auto' ? proposal.authorization.policy : proposal.authorization.human;
        if (!eligibility.eligible) blockers.push(`${proposal.entityName}: ${eligibility.blockers.join(', ')}`);
        if (proposal.entityType !== 'keyword' || proposal.actionType !== 'set_keyword_bid') {
          blockers.push(`${proposal.entityName}: V1 仅允许关键词竞价动作。`);
        }
        if (Date.parse(proposal.validUntil) <= now) blockers.push(`${proposal.entityName}: 建议已过期。`);
        const evidence = this.repository.getEvidencePackage(context, proposal.evidencePackageId);
        if (!evidence
          || evidence.packageHash !== proposal.evidencePackageHash
          || evidence.dataBatchId !== mission.dataBatchId
          || Date.parse(evidence.freshUntil) <= now) {
          blockers.push(`${proposal.entityName}: 证据包不存在、已变化或已过期。`);
        } else {
          evidenceById.set(evidence.id, evidence);
        }
        if (!proposal.adEntityId || !proposal.adEntityRevision) {
          blockers.push(`${proposal.entityName}: 缺少稳定 Ads 实体。`);
        } else {
          const latest = this.repository.getLatestVerifiedAdEntityById(context, proposal.adEntityId);
          if (!latest || latest.entityRevision !== proposal.adEntityRevision
            || latest.entityType !== 'keyword') {
            blockers.push(`${proposal.entityName}: Ads 实体身份 revision 或类型已变化。`);
          }
        }
      }

      const policyVersion = this.missionRepository.getPolicyVersion(context, mission.policyVersionId);
      if (!policyVersion || policyVersion.revision !== proposals[0].policyRevision
        || proposals.some((proposal) => proposal.policyVersionId !== policyVersion.id
          || proposal.policyRevision !== policyVersion.revision)) {
        blockers.push('Mission 策略版本或 revision 已变化。');
      }
      const allowedAdEntityIds = proposals.map((proposal) => proposal.adEntityId!).filter(Boolean);
      if (policyVersion && allowedAdEntityIds.length > 0) {
        try {
          const effectivePolicyVersion = this.missionRepository.resolveEffectivePolicyVersion(context, {
            allowedActionTypes: ['set_keyword_bid'],
            allowedAdEntityIds,
            at: new Date(now).toISOString(),
          });
          if (effectivePolicyVersion.id !== policyVersion.id) {
            blockers.push('当前运营任务策略不是这些广告对象数字最小的优先匹配；请重新运行分析。');
          }
        } catch (error) {
          const reason = error instanceof Error && error.message.trim()
            ? error.message.trim()
            : '请检查策略对象范围与优先级。';
          blockers.push(`策略优先级无法唯一确定：${reason}`);
        }
      }
      if (mode === 'policy_auto' && (
        runtime.killSwitch
        || runtime.circuitBreakerState !== 'closed'
        || !runtime.activePolicyVersionId
      )) {
        blockers.push('策略自动模式被 kill switch、熔断器或未武装的策略运行时阻断。');
      }
      if (new Set(allowedAdEntityIds).size !== allowedAdEntityIds.length) {
        blockers.push('同一动作批次包含重复 Ads 实体，必须重新分析去重。');
      }
      const maxChangePct = Math.max(...proposals.map((proposal) => Math.abs(proposal.changePct)));
      const totalImpactBudget = proposals.reduce(
        (total, proposal) => total + Math.abs(proposal.currentBidCents - proposal.proposedBidCents) / 100,
        0,
      );
      const rules = policyVersion?.rules as PolicyVersionRules | undefined;
      if (!rules || maxChangePct > Number(rules.maxChangePct)
        || totalImpactBudget > Number(rules.totalImpactBudget)) {
        blockers.push('动作批次超过当前不可变策略的变化或影响预算。');
      }

      const decisions = decisionIds.map((id) => this.missionRepository.getDecision(context, id));
      if (decisions.some((row) => !row)) {
        blockers.push('Decision 已被删除或不属于当前店铺。');
      } else {
        for (const decision of decisions) {
          if (decision && !['proposed', 'needs_approval', 'approved'].includes(decision.status)) {
            blockers.push(`Decision ${decision.id} 当前状态 ${decision.status} 不可整批授权。`);
          }
          if (!decision) continue;
          try { this.missionRepository.assertWriteAuthority(context, decision.authority); }
          catch { blockers.push(`${decision.title}：判断不属于当前店铺、会话和授权模式版本，请重新分析。`); }
          if (mode === 'manual_approval' && decision.status !== 'approved') {
            blockers.push(`${decision.title}：请先在待审批中逐条批准并填写业务原因，再整批签发授权。`);
          }
          if (decision.status === 'approved') {
            const approval = this.missionRepository.listDecisionHistory(context, decision.id)
              .find(event => event.eventType === 'approved' && event.decisionRevision === decision.revision);
            if (!approval?.reason?.trim() || approval.actorId !== (mode === 'manual_approval' ? 'operator' : 'policy-engine')) {
              blockers.push(`${decision.title}：缺少当前授权路径的判断和业务原因，禁止混合人工与策略授权。`);
            }
          }
        }
      }
      if (blockers.length > 0 || !policyVersion || !rules) {
        return blockedResult(mode, selectedIds, decisionIds, ...blockers);
      }

      const existing = this.missionRepository.listMissionGrants(context, mission.id)
        .find((grant) => grant.actionRevision === latestBatch.actionRevision);
      if (existing) {
        try { this.missionRepository.assertWriteAuthority(context, existing.authority); }
        catch { return blockedResult(mode, selectedIds, decisionIds, '历史授权不属于当前授权模式版本，请重新分析。'); }
        const existingMode = existing.issuer.type === 'policy' ? 'policy_auto' : 'manual_approval';
        const terminal = this.missionRepository.getMissionGrantTerminalEvent(context, existing.id);
        if (terminal || Date.parse(existing.expiresAt) <= now) {
          return blockedResult(
            existingMode,
            selectedIds,
            decisionIds,
            terminal
              ? `该动作批次授权已进入终态：${terminal.eventType}。`
              : '该动作批次授权已经过期。',
          );
        }
        return {
          mode: existingMode,
          grant: existing,
          decisionIds,
          proposalIds: selectedIds,
          authorized: true,
          blockers: [],
        };
      }

      try { this.missionRepository.assertPolicyUsage(context, policyVersion.id, allowedAdEntityIds); }
      catch (error) { return blockedResult(mode, selectedIds, decisionIds, error instanceof Error ? error.message : '策略额度校验未完成，请重试。'); }

      for (const decision of decisions) {
        if (mode !== 'policy_auto' || !decision || decision.status === 'approved') continue;
        this.missionRepository.resolveDecision(context, {
          id: decision.id,
          expectedRevision: decision.revision,
          status: 'approved',
          reason: `当前策略已核验完整批次 ${proposals.length} 条关键词降价；本条从 ${decision.currentValue} USD 降至 ${decision.recommendedValue} USD，符合对象、证据、窗口及预算限制。`,
          actorId: 'policy-engine',
        });
      }
      const evidenceExpiry = Math.min(...[...evidenceById.values()].map((evidence) => Date.parse(evidence.freshUntil)));
      const expiresAt = new Date(Math.min(
        evidenceExpiry,
        policyVersion.validUntil ? Date.parse(policyVersion.validUntil) : Infinity,
        ...proposals.map((proposal) => Date.parse(proposal.validUntil)),
      )).toISOString();
      const grant = this.missionRepository.issueMissionGrant(context, {
        id: compactId('mission-grant', { storeId: context.storeId, actionBatchId }),
        missionId: mission.id,
        missionRevision: mission.revision,
        decisionIds,
        actionRevision: latestBatch.actionRevision,
        allowedActionTypes: ['set_keyword_bid'],
        allowedAdEntityIds,
        maxChangePct,
        totalImpactBudget,
        expiresAt,
        policyVersionId: policyVersion.id,
        policyRevision: policyVersion.revision,
        requiredEvidence: rules.requiredEvidence,
        stopConditions: rules.stopConditions,
        issuer: mode === 'policy_auto'
          ? { type: 'policy', actorId: 'policy-engine' }
          : { type: 'human', actorId: 'operator' },
      });
      this.assertContext(context);
      return {
        mode,
        grant,
        decisionIds,
        proposalIds: selectedIds,
        authorized: true,
        blockers: [],
      };
    });
    return authorize.immediate();
  }

  private materializeWritableAuthority(
    context: StoreContextEnvelope,
    evidencePackage: AnalysisEvidencePackageRecord,
    recommendation: ActionRecommendation,
  ): VerifiedAdEntityAuthorityRecord | undefined {
    const target = recommendation.evidence?.writableTarget;
    if (!target) return undefined;
    try {
      const allowedSourceFiles = (this.db.prepare(`
        SELECT file_path AS filePath
        FROM report_import_file_snapshots
        WHERE store_id = ? AND run_id = ? AND batch_id = ?
      `).all(context.storeId, evidencePackage.importRunId, evidencePackage.dataBatchId) as Array<{ filePath: string }>)
        .map((row) => row.filePath);
      const scope = {
        dateFrom: evidencePackage.dateFrom,
        dateTo: evidencePackage.dateTo,
        storeName: recommendation.storeName,
        marketplaceCode: 'US',
        asin: recommendation.asin,
        batchId: evidencePackage.dataBatchId,
      };
      const canonical = assertCurrentWritableAdTargetAuthority(this.db, {
        storeId: context.storeId,
        scope,
        target,
        allowedSourceFiles,
        syntheticRecommendationEntityId: recommendation.entityId,
      });
      const snapshot = this.findSnapshotForTarget(context, evidencePackage, canonical);
      const proofPath = path.resolve(canonical.identityProofPath);
      if (!fs.existsSync(proofPath)) return undefined;
      const realProofPath = fs.realpathSync.native(proofPath);
      const proofStat = fs.statSync(realProofPath);
      if (!proofStat.isFile() || proofStat.size <= 0 || proofStat.size > MAX_IDENTITY_PROOF_BYTES) return undefined;
      const allowedRoots = this.allowedProofRoots(context)
        .filter((root) => fs.existsSync(path.resolve(root)))
        .map((root) => fs.realpathSync.native(path.resolve(root)));
      if (!allowedRoots.some((root) => isPathWithinRoot(realProofPath, root))) return undefined;
      const proofSha256 = createHash('sha256').update(fs.readFileSync(realProofPath)).digest('hex');
      const authorityId = compactId('verified-ad-entity', {
        storeId: context.storeId,
        adEntityId: canonical.entityId,
        evidencePackageId: evidencePackage.id,
        sourceFileHash: snapshot.fileHash,
        sourceRow: canonical.sourceRow,
        proofSha256,
      });
      return this.repository.registerVerifiedAdEntity(context, {
        authorityId,
        evidencePackageId: evidencePackage.id,
        adEntityId: canonical.entityId,
        entityType: canonical.entityType,
        entityName: canonical.entityName,
        campaignName: canonical.campaignName,
        adGroupName: canonical.adGroupName,
        sourceReportType: canonical.entityType,
        sourceFileHash: snapshot.fileHash,
        sourceRow: canonical.sourceRow,
        identitySource: canonical.identitySource,
        proofSha256,
        verifiedBy: canonical.verifiedBy,
        verifiedAt: canonical.verifiedAt,
      });
    } catch {
      // A recommendation may remain visible as blocked. Failure to materialize
      // an opaque Ads identity is never converted into an authorization.
      return undefined;
    }
  }

  private captureAnalysisCausalMemory(
    context: StoreContextEnvelope,
    productId: string | undefined,
  ): { items: readonly AnalysisCausalMemoryItem[]; memoryDigest: string } {
    const items = this.missionRepository.listAnalysisCausalMemory(context, {
      productId: String(productId ?? '').trim(),
      limit: 40,
    }).map((item) => Object.freeze({
      ...item,
      proofs: Object.freeze(item.proofs.map((proof) => Object.freeze({ ...proof }))),
    }));
    return Object.freeze({
      items: Object.freeze(items),
      memoryDigest: analysisCausalMemoryDigest(items),
    });
  }

  private findSnapshotForTarget(
    context: StoreContextEnvelope,
    evidencePackage: AnalysisEvidencePackageRecord,
    target: WritableAdTargetEvidence,
  ): { fileHash: string } {
    const candidates = this.db.prepare(`
      SELECT file_path AS filePath, file_hash AS fileHash
      FROM report_import_file_snapshots
      WHERE store_id = ? AND run_id = ? AND batch_id = ? AND report_type = ?
    `).all(
      context.storeId,
      evidencePackage.importRunId,
      evidencePackage.dataBatchId,
      target.entityType,
    ) as Array<{ filePath: string; fileHash: string }>;
    const expected = normalizedPath(target.sourceFile);
    const matches = candidates.filter((row) => normalizedPath(row.filePath) === expected);
    if (matches.length !== 1 || !/^[a-f0-9]{64}$/i.test(matches[0].fileHash)) {
      throw new Error('Writable Ads target source snapshot is not unique.');
    }
    return { fileHash: matches[0].fileHash.toLowerCase() };
  }

  private ensureDecisionForProposal(
    context: StoreContextEnvelope,
    proposal: AnalysisProposalSnapshotRecord,
  ): void {
    const decisionId = compactId('analysis-decision', { proposalId: proposal.id });
    let decision = this.missionRepository.getDecision(context, decisionId);
    if (!decision) {
      decision = this.missionRepository.createDecision(context, {
        id: decisionId,
        missionId: proposal.missionId,
        dataBatchId: proposal.dataBatchId,
        policyVersionId: proposal.policyVersionId,
        policyRevision: proposal.policyRevision,
        actionRevision: proposal.actionRevision,
        title: `${proposal.entityName} 竞价调整`,
        rationale: proposal.explanation,
        recommendation: `USD ${(proposal.currentBidCents / 100).toFixed(2)} → ${(proposal.proposedBidCents / 100).toFixed(2)}`,
        facts: [
          `evidence-package:${proposal.evidencePackageHash}`,
          `rule-revision:${proposal.ruleRevision}`,
          `model-revision:${proposal.modelRevision}`,
          `proposal-source:${proposal.source}`,
        ],
        alternatives: ['保持当前竞价并继续观察', '暂停该投放对象并人工复核'],
        expectedEffect: '在订单守护栏内降低无效广告花费。',
        validUntil: proposal.validUntil,
        actionType: proposal.actionType,
        adEntityId: proposal.adEntityId,
        currentValue: proposal.currentBidCents / 100,
        recommendedValue: proposal.proposedBidCents / 100,
        confidence: proposal.confidence,
        status: proposal.authorization.human.eligible ? 'needs_approval' : 'blocked',
        actorId: 'analysis-engine',
      });
    }
    this.repository.linkProposalDecision(context, {
      id: compactId('proposal-decision-link', { proposalId: proposal.id, decisionId: decision.id }),
      proposalId: proposal.id,
      decisionId: decision.id,
    });
  }

  private supersedePriorOpenDecisions(
    context: StoreContextEnvelope,
    missionId: string,
    currentProposals: readonly AnalysisProposalSnapshotRecord[],
  ): void {
    const currentDecisionIds = new Set(currentProposals.map((proposal) => (
      compactId('analysis-decision', { proposalId: proposal.id })
    )));
    const analysisDecisionIds = new Set(
      this.repository.listProposalDecisionLinks(context, missionId)
        .map((link) => link.decisionId),
    );

    for (const decision of this.missionRepository.listDecisions(context, { missionId })) {
      if (currentDecisionIds.has(decision.id)
        || !analysisDecisionIds.has(decision.id)
        || !['proposed', 'needs_approval', 'blocked'].includes(decision.status)) {
        continue;
      }
      this.missionRepository.resolveDecision(context, {
        id: decision.id,
        expectedRevision: decision.revision,
        status: 'superseded',
        reason: '新分析批次已发布当前建议；旧分析批次的开放决策仅保留为历史。',
        actorId: 'analysis-agent',
      });
    }
  }

  private assertContext(contextInput: StoreContextEnvelope): StoreContextEnvelope {
    return this.storeCoordinator.assertActiveStoreContext(contextInput);
  }
}

function blockedResult(
  mode: AuthorizeAnalysisProposalBatchResult['mode'],
  proposalIds: readonly string[],
  decisionIds: readonly string[],
  ...blockers: string[]
): AuthorizeAnalysisProposalBatchResult {
  return {
    mode,
    proposalIds,
    decisionIds,
    authorized: false,
    blockers: [...new Set(blockers.filter(Boolean))],
  };
}

function proposalValidUntil(now: Date, evidenceFreshUntil: string, missionObservationEnd: string): string {
  const twentyFourHours = now.getTime() + 24 * 60 * 60 * 1000;
  const candidate = Math.min(twentyFourHours, Date.parse(evidenceFreshUntil), Date.parse(missionObservationEnd));
  if (!Number.isFinite(candidate) || candidate <= now.getTime()) {
    throw new Error('Mission analysis blocked: no future proposal validity window remains.');
  }
  return new Date(candidate).toISOString();
}

function uniqueNonEmptyIds(value: readonly string[], field: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  const ids = value.map((id) => requiredId(id, field));
  const unique = [...new Set(ids)];
  if (unique.length === 0 || unique.length !== ids.length) {
    throw new TypeError(`${field} must be non-empty and contain unique ids.`);
  }
  return unique;
}

function requiredId(value: unknown, field: string): string {
  const normalized = requiredText(value, field);
  if (normalized.length > 180) throw new TypeError(`${field} is too long.`);
  return normalized;
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${field} is required.`);
  return normalized;
}

function sha256Text(value: unknown, field: string): string {
  const normalized = requiredText(value, field).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new TypeError(`${field} must be SHA-256.`);
  return normalized;
}

function compactId(prefix: string, payload: unknown): string {
  return `${prefix}:${createHash('sha256').update(stableJson(payload)).digest('hex').slice(0, 32)}`;
}

function analysisCausalMemoryDigest(items: readonly AnalysisCausalMemoryItem[]): string {
  const normalized = items.map((item) => ({
    stage: item.stage,
    eventType: normalizedMemoryText(item.eventType),
    entityType: normalizedMemoryText(item.entityType),
    entityId: normalizedMemoryText(item.entityId),
    title: normalizedMemoryText(item.title),
    observedEffect: normalizedMemoryText(item.observedEffect),
    status: normalizedMemoryText(item.status).toLowerCase(),
    source: normalizedMemoryText(item.source),
    businessDate: normalizedMemoryText(item.businessDate),
    proofs: item.proofs.map((proof) => ({
      evidenceType: normalizedMemoryText(proof.evidenceType),
      evidenceRef: normalizedMemoryText(proof.evidenceRef),
      sha256: normalizedMemoryText(proof.sha256).toLowerCase(),
    })).sort(compareStableValues),
  })).sort(compareStableValues);
  return createHash('sha256').update(stableJson(normalized)).digest('hex');
}

function effectiveModelRevision(
  baseModelRevision: string,
  memoryDigest: string,
  memoryCount: number,
): string {
  return memoryCount === 0
    ? baseModelRevision
    : `${baseModelRevision}|causal-memory:${memoryDigest}`;
}

function normalizedMemoryText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function compareStableValues(left: unknown, right: unknown): number {
  const leftJson = stableJson(left);
  const rightJson = stableJson(right);
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}

export function analysisRunFailureOperatorReason(error: unknown): string {
  if (error instanceof AnalysisGenerationTimeoutError) {
    return 'AI 分析等待超时，已安全停止且未生成建议；请检查网络、AI Key 与模型设置后重新运行分析。';
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/\b(ai|provider|model|recommendation|generation|rule|policy)\b/i.test(message)) {
    return '分析服务或策略生成未完成；请检查 AI 与策略配置后重试。';
  }
  if (/batch|evidence|report|import|lingxing|metric/i.test(message)) {
    return '当前任务的数据证据不完整或已变化；请先完成 8 类报表采集与导入，再重新分析。';
  }
  if (/store|mission|context|session|scope|changed|店铺|任务|上下文|会话|已变化/i.test(message)) {
    return '分析期间店铺、任务或会话已变化；请刷新当前店铺并重新运行分析。';
  }
  return '分析未完成；请刷新当前店铺确认数据与策略状态后重试。';
}

class AnalysisGenerationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `AI 分析在 ${formatAnalysisTimeout(timeoutMs)} 内未完成，已安全停止且未生成建议；`
      + '请检查网络、AI Key 与模型设置后重试。',
    );
    this.name = 'AnalysisGenerationTimeoutError';
  }
}

function validatedAnalysisGenerationTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ANALYSIS_GENERATION_TIMEOUT_MS) {
    throw new RangeError(
      `generationTimeoutMs must be an integer between 1 and ${MAX_ANALYSIS_GENERATION_TIMEOUT_MS}`,
    );
  }
  return value;
}

async function generateRecommendationsWithinDeadline(
  generateRecommendations: CapturedAnalysisGenerationAuthority['generateRecommendations'],
  scope: Omit<AnalysisRecommendationGenerationScope, 'signal'>,
  timeoutMs: number,
): Promise<RecommendationGenerationResultForAnalysis> {
  const controller = new AbortController();
  const timeoutError = new AnalysisGenerationTimeoutError(timeoutMs);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  const generation = Promise.resolve().then(() => generateRecommendations({
    ...scope,
    signal: controller.signal,
  }));
  try {
    return await Promise.race([generation, timeout]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

function formatAnalysisTimeout(timeoutMs: number): string {
  if (timeoutMs >= 1_000 && timeoutMs % 1_000 === 0) return `${timeoutMs / 1_000} 秒`;
  return `${timeoutMs} 毫秒`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function normalizedPath(value: string): string {
  const resolved = path.resolve(value);
  const canonical = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
  return canonical.replace(/\\/g, '/').toLowerCase();
}

function isPathWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizedOptionalText(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function safeAiAnalysisDetail(
  explanation: RecommendationGenerationResultForAnalysis['aiExplanation'],
): string {
  if (explanation.invoked && explanation.strategyDiagnosis?.source === 'ai') {
    return 'AI 已完成结构化诊断；建议仍受规则、批次授权与真实回读安全门约束。';
  }
  if (!explanation.configured) {
    return 'AI 未配置；本次仅保留规则降级结果，不能进入执行授权。';
  }
  return 'AI 本次未完成；仅保留规则降级结果，不能进入执行授权。';
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}
