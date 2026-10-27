import { appendAnalysisFailureReceiptBestEffort, appendAnalysisCheckpointOnce } from './analysis-service-ledger';
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
  type AnalysisAuthorizationBlocker,
  type AnalysisAuthorizationBlockerCode,
  type AnalysisEvidencePackageRecord,
  type AnalysisProposalSnapshotRecord,
  type AuthorizeAnalysisProposalBatchRequest,
  type AuthorizeAnalysisProposalBatchResult,
  type MissionGrantRecord,
  type MissionAnalysisRunProjection,
  type MissionAnalysisProjection,
  type PolicyVersionRules,
  type RunMissionAnalysisRequest,
  type RunMissionAnalysisResult,
  type StoreContextEnvelope,
  type VerifiedAdEntityAuthorityRecord,
  type WritableAdTargetEvidence,
} from '@amazon-ai-ops/shared-types';
import { createAnalysisRunsRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/analysis-runs-repo';
import type { AnalysisRunRecord } from '@amazon-ai-ops/shared-types';
import { assertCurrentWritableAdTargetAuthority } from './writable-ad-target-resolution';
import {
  analysisBlocker,
  analysisErrorCode,
  uniqueAnalysisBlockers,
} from './analysis-authority-blockers';
import {
  type AnalysisAuthorityServiceOptions, type CapturedAnalysisGenerationAuthority, type RecommendationGenerationResultForAnalysis,
} from './analysis-service-contracts';
import {
  validatedAnalysisGenerationTimeout, DEFAULT_ANALYSIS_GENERATION_TIMEOUT_MS, generateRecommendationsWithinDeadline,
} from './analysis-service-generation';
import {
  requiredId, sha256Text, effectiveModelRevision,
  requiredText, ANALYSIS_ACTION_CONTRACT_VERSION, compactId,
  ANALYSIS_EVIDENCE_FRESHNESS_HOURS, normalizedOptionalText, proposalValidUntil,
  safeAiAnalysisDetail, analysisRunFailureOperatorReason, uniqueNonEmptyIds,
  blockedResult, policyUsageAuthorizationBlocker, sameSet, MAX_IDENTITY_PROOF_BYTES,
  isPathWithinRoot, analysisCausalMemoryDigest, normalizedPath,
} from './analysis-service-values';
import {
  projectMissionAnalysisRun,
} from './analysis-service-projections';
import { projectAnalysisRunForRenderer } from './analysis-service-projections';

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
  private readonly onAnalysisRunCompleted?: AnalysisAuthorityServiceOptions['onAnalysisRunCompleted'];
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
    this.onAnalysisRunCompleted = options.onAnalysisRunCompleted;
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
      analysisRun: {
        status: 'done',
        missionId: mission.id,
        evidencePackageId: evidencePackage.id,
      },
    };
    this.onAnalysisRunCompleted?.(result.analysisRun);
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
        this.onAnalysisRunCompleted?.({
          status: 'retryable',
          missionId: mission.id,
          blockerCodes: [analysisErrorCode(error)],
        });
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
    return projectAnalysisRunForRenderer(context, run, this.activeRuns);
  }

  private appendAnalysisFailureReceiptBestEffort(
    context: StoreContextEnvelope,
  missionId: string,
  analysisRunId: string,
  error: unknown
  ): void {
    appendAnalysisFailureReceiptBestEffort(this.missionRepository, context, missionId, analysisRunId, error);
  }

  private appendAnalysisCheckpointOnce(
    context: StoreContextEnvelope,
  missionId: string,
  actionBatchId: string,
  stage: 'FACT' | 'ANALYSIS',
  title: string,
  evidenceCount: number
  ): void {
    appendAnalysisCheckpointOnce(this.missionRepository, context, missionId, actionBatchId, stage, title, evidenceCount);
  }

  getMissionAnalysisProjection(
    contextInput: StoreContextEnvelope,
    missionIdInput: string,
  ): MissionAnalysisProjection {
    const context = this.assertContext(contextInput);
    const missionId = requiredId(missionIdInput, 'missionId');
    const projection: MissionAnalysisProjection = {
      evidencePackages: this.repository.listEvidencePackages(context, missionId),
      actionBatches: this.repository.listActionBatches(context, missionId),
      proposals: this.repository.listProposalSnapshots(context, missionId),
      decisionLinks: this.repository.listProposalDecisionLinks(context, missionId),
    };
    const latestRun = this.analysisRuns.findByMissionId(missionId)
      .find((run) => run.storeId === context.storeId);
    if (latestRun) {
      projection.analysisRun = projectMissionAnalysisRun(latestRun, missionId);
    }
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
          analysisBlocker('AUTONOMY_MODE_CHANGED', '策略运行模式已变化；自动授权未降级为人工授权。'),
        );
      }
      const mission = this.missionRepository.getMission(context, missionId);
      if (!mission) return blockedResult(mode, selectedIds, [], analysisBlocker('MISSION_NOT_FOUND', 'Mission 不存在或不属于当前店铺。'));
      if (mission.status !== 'active') {
        return blockedResult(mode, selectedIds, [], analysisBlocker('MISSION_NOT_ACTIVE', 'Mission 必须处于 active 才能签发执行授权。'));
      }

      const selected = selectedIds.map((id) => this.repository.getProposalSnapshot(context, id));
      if (selected.some((row) => !row)) {
        return blockedResult(mode, selectedIds, [], analysisBlocker('PROPOSAL_NOT_FOUND', '选择中包含不存在或跨店铺的建议快照。'));
      }
      const proposals = selected as AnalysisProposalSnapshotRecord[];
      const actionBatchIds = new Set(proposals.map((row) => row.actionBatchId));
      if (actionBatchIds.size !== 1 || proposals.some((row) => row.missionId !== mission.id)) {
        return blockedResult(mode, selectedIds, [], analysisBlocker('BATCH_MISMATCH', '一次授权必须来自同一个 Mission 动作批次。'));
      }
      const actionBatchId = proposals[0].actionBatchId;
      const latestBatch = this.repository.getLatestActionBatch(context, mission.id);
      if (!latestBatch || latestBatch.id !== actionBatchId
        || latestBatch.actionRevision !== proposals[0].actionRevision) {
        return blockedResult(mode, selectedIds, [], analysisBlocker('STALE_ACTION_BATCH', '只能授权当前 Mission 的最新分析动作批次。'));
      }
      if (latestBatch.missionRevision !== mission.revision
        || proposals.some((proposal) => proposal.missionRevision !== mission.revision)) {
        return blockedResult(mode, selectedIds, [], analysisBlocker('STALE_MISSION_REVISION', 'Mission 已修订；旧分析建议必须重新运行后才能授权。'));
      }
      try { this.missionRepository.assertWriteAuthority(context, latestBatch.authority); }
      catch { return blockedResult(mode, selectedIds, [], analysisBlocker('AUTONOMY_MODE_CHANGED', '动作批次的店铺、会话或授权模式版本已变化；请重新分析。')); }
      const currentRuleRevision = sha256Text(this.currentRuleRevision(), 'ruleRevision');
      const currentMemory = this.captureAnalysisCausalMemory(context, mission.productId);
      const currentModelRevision = effectiveModelRevision(
        requiredText(this.currentModelRevision(), 'modelRevision'),
        currentMemory.memoryDigest,
        currentMemory.items.length,
      );
      if (latestBatch.ruleRevision !== currentRuleRevision
        || proposals.some((proposal) => proposal.ruleRevision !== currentRuleRevision)) {
        return blockedResult(mode, selectedIds, [], analysisBlocker('RULE_REVISION_MISMATCH', '当前规则 revision 已变化；必须重新分析。'));
      }
      if (latestBatch.modelRevision !== currentModelRevision
        || proposals.some((proposal) => proposal.modelRevision !== currentModelRevision)) {
        return blockedResult(mode, selectedIds, [], analysisBlocker('MODEL_REVISION_MISMATCH', '当前 AI 模型 revision 已变化；必须重新分析。'));
      }
      const completeBatch = this.repository.listProposalSnapshots(context, mission.id)
        .filter((row) => row.actionBatchId === actionBatchId);
      if (!sameSet(selectedIds, completeBatch.map((row) => row.id))) {
        return blockedResult(mode, selectedIds, [], analysisBlocker('INCOMPLETE_BATCH', '必须整批授权，不能只批准动作批次的一部分。'));
      }

      const links = this.repository.listProposalDecisionLinks(context, mission.id)
        .filter((link) => selectedIds.includes(link.proposalId));
      const decisionByProposal = new Map(links.map((link) => [link.proposalId, link.decisionId]));
      const decisionIds = proposals
        .map((proposal) => decisionByProposal.get(proposal.id))
        .filter(Boolean) as string[];
      const blockers: AnalysisAuthorizationBlocker[] = [];
      if (decisionIds.length !== proposals.length) blockers.push(analysisBlocker('MISSING_DECISION_LINK', '至少一个建议缺少不可变 Decision 关联。'));
      const now = this.now().getTime();
      const evidenceById = new Map<string, AnalysisEvidencePackageRecord>();
      for (const proposal of proposals) {
        const eligibility = mode === 'policy_auto' ? proposal.authorization.policy : proposal.authorization.human;
        if (!eligibility.eligible) blockers.push(...eligibility.blockers.map(code => analysisBlocker(code, `${proposal.entityName}：当前证据或策略不满足该授权路径，请核对建议中的条件。`)));
        if (proposal.entityType !== 'keyword' || proposal.actionType !== 'set_keyword_bid') {
          blockers.push(analysisBlocker('UNSUPPORTED_ACTION', `${proposal.entityName}: V1 仅允许关键词竞价动作。`));
        }
        if (Date.parse(proposal.validUntil) <= now) blockers.push(analysisBlocker('PROPOSAL_EXPIRED', `${proposal.entityName}: 建议已过期。`));
        const evidence = this.repository.getEvidencePackage(context, proposal.evidencePackageId);
        if (!evidence
          || evidence.packageHash !== proposal.evidencePackageHash
          || evidence.dataBatchId !== mission.dataBatchId
          || Date.parse(evidence.freshUntil) <= now) {
          blockers.push(analysisBlocker('EVIDENCE_STALE', `${proposal.entityName}: 证据包不存在、已变化或已过期。`));
        } else {
          evidenceById.set(evidence.id, evidence);
        }
        if (!proposal.adEntityId || !proposal.adEntityRevision) {
          blockers.push(analysisBlocker('MISSING_STABLE_AD_ENTITY', `${proposal.entityName}: 缺少稳定 Ads 实体。`));
        } else {
          const latest = this.repository.getLatestVerifiedAdEntityById(context, proposal.adEntityId);
          if (!latest || latest.entityRevision !== proposal.adEntityRevision
            || latest.entityType !== 'keyword') {
            blockers.push(analysisBlocker('STALE_AD_ENTITY_REVISION', `${proposal.entityName}: Ads 实体身份 revision 或类型已变化。`));
          }
        }
      }

      const policyVersion = this.missionRepository.getPolicyVersion(context, mission.policyVersionId);
      if (!policyVersion || policyVersion.revision !== proposals[0].policyRevision
        || proposals.some((proposal) => proposal.policyVersionId !== policyVersion.id
          || proposal.policyRevision !== policyVersion.revision)) {
        blockers.push(analysisBlocker('POLICY_REVISION_MISMATCH', 'Mission 策略版本或 revision 已变化。'));
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
            blockers.push(analysisBlocker('POLICY_PRIORITY_MISMATCH', '当前运营任务策略不是这些广告对象数字最小的优先匹配；请重新运行分析。'));
          }
        } catch (error) {
          const reason = error instanceof Error && error.message.trim()
            ? error.message.trim()
            : '请检查策略对象范围与优先级。';
          blockers.push(analysisBlocker('POLICY_PRIORITY_MISMATCH', `策略优先级无法唯一确定：${reason}`));
        }
      }
      if (mode === 'policy_auto' && (
        runtime.killSwitch
        || runtime.circuitBreakerState !== 'closed'
        || !runtime.activePolicyVersionId
      )) {
        blockers.push(analysisBlocker('POLICY_RUNTIME_BLOCKED', '策略自动模式被 kill switch、熔断器或未武装的策略运行时阻断。'));
      }
      if (new Set(allowedAdEntityIds).size !== allowedAdEntityIds.length) {
        blockers.push(analysisBlocker('DUPLICATE_AD_ENTITY', '同一动作批次包含重复 Ads 实体，必须重新分析去重。'));
      }
      const maxChangePct = Math.max(...proposals.map((proposal) => Math.abs(proposal.changePct)));
      const totalImpactBudget = proposals.reduce(
        (total, proposal) => total + Math.abs(proposal.currentBidCents - proposal.proposedBidCents) / 100,
        0,
      );
      const rules = policyVersion?.rules as PolicyVersionRules | undefined;
      if (!rules || maxChangePct > Number(rules.maxChangePct)
        || totalImpactBudget > Number(rules.totalImpactBudget)) {
        blockers.push(analysisBlocker('CHANGE_LIMIT_EXCEEDED', '动作批次超过当前不可变策略的变化或影响预算。'));
      }

      const decisions = decisionIds.map((id) => this.missionRepository.getDecision(context, id));
      if (decisions.some((row) => !row)) {
        blockers.push(analysisBlocker('DECISION_NOT_FOUND', 'Decision 已被删除或不属于当前店铺。'));
      } else {
        for (const decision of decisions) {
          if (decision && !['proposed', 'needs_approval', 'approved'].includes(decision.status)) {
            blockers.push(analysisBlocker('DECISION_NOT_AUTHORIZABLE', `Decision ${decision.id} 当前状态 ${decision.status} 不可整批授权。`));
          }
          if (!decision) continue;
          try { this.missionRepository.assertWriteAuthority(context, decision.authority); }
          catch { blockers.push(analysisBlocker('AUTONOMY_MODE_CHANGED', `${decision.title}：判断不属于当前店铺、会话和授权模式版本，请重新分析。`)); }
          if (mode === 'manual_approval' && decision.status !== 'approved') {
            blockers.push(analysisBlocker('DECISION_NOT_AUTHORIZABLE', `${decision.title}：请先在待审批中逐条批准并填写业务原因，再整批签发授权。`));
          }
          if (decision.status === 'approved') {
            const approval = this.missionRepository.listDecisionHistory(context, decision.id)
              .find(event => event.eventType === 'approved' && event.decisionRevision === decision.revision);
            if (!approval?.reason?.trim() || approval.actorId !== (mode === 'manual_approval' ? 'operator' : 'policy-engine')) {
              blockers.push(analysisBlocker('DECISION_NOT_AUTHORIZABLE', `${decision.title}：缺少当前授权路径的判断和业务原因，禁止混合人工与策略授权。`));
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
        catch { return blockedResult(mode, selectedIds, decisionIds, analysisBlocker('AUTONOMY_MODE_CHANGED', '历史授权不属于当前授权模式版本，请重新分析。')); }
        const existingMode = existing.issuer.type === 'policy' ? 'policy_auto' : 'manual_approval';
        const terminal = this.missionRepository.getMissionGrantTerminalEvent(context, existing.id);
        if (terminal || Date.parse(existing.expiresAt) <= now) {
          return blockedResult(
            existingMode,
            selectedIds,
            decisionIds,
            terminal
              ? analysisBlocker('GRANT_TERMINAL', `该动作批次授权已进入终态：${terminal.eventType}。`)
              : analysisBlocker('GRANT_EXPIRED', '该动作批次授权已经过期。'),
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
      catch (error) { return blockedResult(mode, selectedIds, decisionIds, policyUsageAuthorizationBlocker(error)); }

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

export { type RecommendationGenerationResultForAnalysis, type AnalysisRecommendationGenerationScope, type CapturedAnalysisGenerationAuthority, type AnalysisAuthorityServiceOptions } from './analysis-service-contracts';

export { analysisRunFailureOperatorReason } from './analysis-service-values';

export { DEFAULT_ANALYSIS_GENERATION_TIMEOUT_MS } from './analysis-service-generation';
