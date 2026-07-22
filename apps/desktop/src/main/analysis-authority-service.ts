import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import {
  AnalysisAuthorityRepository,
  AnalysisAuthorityRepositoryError,
  MissionDomainRepository,
  RecommendationRepository,
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

export interface AnalysisAuthorityServiceOptions {
  db: Database.Database;
  repository: AnalysisAuthorityRepository;
  missionRepository: MissionDomainRepository;
  recommendationRepository: RecommendationRepository;
  storeCoordinator: Pick<StoreCoordinator, 'assertActiveStoreContext'>;
  generateRecommendations: (scope: {
    dateFrom: string;
    dateTo: string;
    storeName: string;
    marketplaceCode: 'US';
    asin?: string;
    batchId: string;
  }) => Promise<RecommendationGenerationResultForAnalysis>;
  currentRuleRevision: () => string;
  currentModelRevision: () => string;
  allowedProofRoots: (context: StoreContextEnvelope) => readonly string[];
  onAutomaticGrantIssued?: (
    context: StoreContextEnvelope,
    grant: MissionGrantRecord,
  ) => void;
  now?: () => Date;
}

const ANALYSIS_EVIDENCE_FRESHNESS_HOURS = 48;
const MAX_IDENTITY_PROOF_BYTES = 16 * 1024 * 1024;

/** Main-only orchestrator for sealed analysis, Decision creation and grants. */
export class AnalysisAuthorityService {
  private readonly db: Database.Database;
  private readonly repository: AnalysisAuthorityRepository;
  private readonly missionRepository: MissionDomainRepository;
  private readonly recommendationRepository: RecommendationRepository;
  private readonly storeCoordinator: AnalysisAuthorityServiceOptions['storeCoordinator'];
  private readonly generateRecommendations: AnalysisAuthorityServiceOptions['generateRecommendations'];
  private readonly currentRuleRevision: AnalysisAuthorityServiceOptions['currentRuleRevision'];
  private readonly currentModelRevision: AnalysisAuthorityServiceOptions['currentModelRevision'];
  private readonly allowedProofRoots: AnalysisAuthorityServiceOptions['allowedProofRoots'];
  private readonly onAutomaticGrantIssued?: AnalysisAuthorityServiceOptions['onAutomaticGrantIssued'];
  private readonly now: () => Date;

  constructor(options: AnalysisAuthorityServiceOptions) {
    this.db = options.db;
    this.repository = options.repository;
    this.missionRepository = options.missionRepository;
    this.recommendationRepository = options.recommendationRepository;
    this.storeCoordinator = options.storeCoordinator;
    this.generateRecommendations = options.generateRecommendations;
    this.currentRuleRevision = options.currentRuleRevision;
    this.currentModelRevision = options.currentModelRevision;
    this.allowedProofRoots = options.allowedProofRoots;
    this.onAutomaticGrantIssued = options.onAutomaticGrantIssued;
    this.now = options.now ?? (() => new Date());
  }

  async runMissionAnalysis(request: RunMissionAnalysisRequest): Promise<RunMissionAnalysisResult> {
    const context = this.assertContext(request.context);
    const mission = this.missionRepository.getMission(context, requiredId(request.missionId, 'missionId'));
    if (!mission) throw new Error('Mission analysis blocked: Mission was not found in the active store.');
    if (mission.status !== 'active') throw new Error('Mission analysis blocked: Mission must be active.');
    const batch = this.db.prepare(`
      SELECT store_name AS storeName, marketplace_code AS marketplaceCode,
             date_start AS dateFrom, date_end AS dateTo
      FROM lingxing_report_batches WHERE store_id = ? AND id = ? AND status = 'completed'
    `).get(context.storeId, mission.dataBatchId) as {
      storeName: string;
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
    const asin = mission.productId?.toUpperCase();
    const ruleRevision = sha256Text(this.currentRuleRevision(), 'ruleRevision');
    const modelRevision = requiredText(this.currentModelRevision(), 'modelRevision');
    const evidencePackage = this.repository.sealEvidencePackage(context, {
      missionId: mission.id,
      dateFrom,
      dateTo,
      asin,
      freshnessWindowHours: ANALYSIS_EVIDENCE_FRESHNESS_HOURS,
      ruleRevision,
      modelRevision,
    });

    const generation = await this.generateRecommendations({
      dateFrom,
      dateTo,
      storeName: batch.storeName,
      marketplaceCode: 'US',
      asin,
      batchId: mission.dataBatchId,
    });
    this.assertContext(context);
    if (generation.scope.storeId !== context.storeId
      || generation.scope.batchId !== mission.dataBatchId
      || generation.scope.marketplaceCode !== 'US'
      || generation.scope.storeName !== batch.storeName
      || generation.scope.dateFrom !== dateFrom
      || generation.scope.dateTo !== dateTo
      || normalizedOptionalText(generation.scope.asin) !== normalizedOptionalText(asin)) {
      throw new Error('Mission analysis blocked: recommendation generation returned another store or data batch.');
    }

    const recommendations = generation.recommendationIds
      .map((id) => this.recommendationRepository.findByIdForStore(context.storeId, id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const actionBatchId = compactId('analysis-action-batch', {
      evidencePackageHash: evidencePackage.packageHash,
      missionRevision: mission.revision,
      recommendations: recommendations.map((row) => ({
        id: row.id,
        revision: row.revision ?? 0,
        writableAdEntityId: row.evidence?.writableTarget?.entityId,
        writableVerifiedAt: row.evidence?.writableTarget?.verifiedAt,
      })),
    });
    const actionBatch = this.repository.createActionBatch(context, {
      id: actionBatchId,
      missionId: mission.id,
      evidencePackageId: evidencePackage.id,
      expectedMissionRevision: mission.revision,
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
          missionId: mission.id,
          evidencePackageId: evidencePackage.id,
          actionBatchId: actionBatch.id,
          legacyRecommendationId: recommendation.id!,
          adEntityAuthorityId: authority?.authorityId,
          validUntil: proposalValidUntil(this.now(), evidencePackage.freshUntil, mission.observationEndsAt),
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
    this.assertContext(context);
    const result: RunMissionAnalysisResult = {
      evidencePackage,
      proposals,
      generatedRecommendations: generation.recommendationIds.length,
      skippedUnsupportedRecommendations,
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
      && this.missionRepository.getPolicyRuntime(context).autonomyMode === 'policy_auto') {
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
      const currentRuleRevision = sha256Text(this.currentRuleRevision(), 'ruleRevision');
      const currentModelRevision = requiredText(this.currentModelRevision(), 'modelRevision');
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
      if (mode === 'policy_auto' && (
        runtime.killSwitch
        || runtime.circuitBreakerState !== 'closed'
        || runtime.activePolicyVersionId !== policyVersion?.id
      )) {
        blockers.push('策略自动模式被 kill switch、熔断器或活动策略版本阻断。');
      }
      const allowedAdEntityIds = proposals.map((proposal) => proposal.adEntityId!).filter(Boolean);
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
        }
      }
      if (blockers.length > 0 || !policyVersion || !rules) {
        return blockedResult(mode, selectedIds, decisionIds, ...blockers);
      }

      const existing = this.missionRepository.listMissionGrants(context, mission.id)
        .find((grant) => grant.actionRevision === latestBatch.actionRevision);
      if (existing) {
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

      const rateLimits = normalizePolicyRateLimits(rules);
      if (!rateLimits) {
        return blockedResult(
          mode,
          selectedIds,
          decisionIds,
          '当前策略版本缺少有效的每日动作数、冷却期或执行窗口；请新建并启用完整策略版本。',
        );
      }
      if (rateLimits.executionWindow.timeZone !== context.businessTimezone) {
        return blockedResult(
          mode,
          selectedIds,
          decisionIds,
          '策略执行窗口时区与当前店铺业务时区不一致；请新建并启用正确的店铺策略版本。',
        );
      }
      const localNow = localPolicyClock(new Date(now), rateLimits.executionWindow.timeZone);
      const windowStart = wallClockMinutes(rateLimits.executionWindow.start);
      const windowEnd = wallClockMinutes(rateLimits.executionWindow.end);
      if (!rateLimits.executionWindow.daysOfWeek.includes(localNow.dayOfWeek)
        || localNow.minuteOfDay < windowStart
        || localNow.minuteOfDay >= windowEnd) {
        return blockedResult(
          mode,
          selectedIds,
          decisionIds,
          `当前不在策略执行窗口内（${rateLimits.executionWindow.timeZone} ${rateLimits.executionWindow.start}-${rateLimits.executionWindow.end}）。`,
        );
      }
      const priorGrantRows = this.db.prepare(`
        SELECT id, allowed_ad_entity_ids_json AS allowedAdEntityIdsJson, issued_at AS issuedAt
        FROM mission_grants
        WHERE store_id = ?
      `).all(context.storeId) as Array<{
        id: string;
        allowedAdEntityIdsJson: string;
        issuedAt: string;
      }>;
      const priorGrants = priorGrantRows.map((row) => ({
        ...row,
        allowedAdEntityIds: parseGrantEntityIds(row.allowedAdEntityIdsJson),
      }));
      const authorizedToday = priorGrants
        .filter((row) => localPolicyClock(new Date(row.issuedAt), rateLimits.executionWindow.timeZone).businessDate === localNow.businessDate)
        .reduce((total, row) => total + row.allowedAdEntityIds.length, 0);
      if (authorizedToday + proposals.length > rateLimits.maxDailyActionCount) {
        return blockedResult(
          mode,
          selectedIds,
          decisionIds,
          `策略单日动作数将超限：已授权 ${authorizedToday}，本批 ${proposals.length}，上限 ${rateLimits.maxDailyActionCount}。`,
        );
      }
      if (rateLimits.cooldownMinutes > 0) {
        const cooldownCutoff = now - (rateLimits.cooldownMinutes * 60_000);
        const targetIds = new Set(allowedAdEntityIds);
        const cooling = priorGrants.find((row) => (
          Date.parse(row.issuedAt) > cooldownCutoff
          && row.allowedAdEntityIds.some((entityId) => targetIds.has(entityId))
        ));
        if (cooling) {
          return blockedResult(
            mode,
            selectedIds,
            decisionIds,
            `至少一个关键词仍在 ${rateLimits.cooldownMinutes} 分钟冷却期内；最近授权 ${cooling.id}。`,
          );
        }
      }

      for (const decision of decisions) {
        if (!decision || decision.status === 'approved') continue;
        this.missionRepository.resolveDecision(context, {
          id: decision.id,
          expectedRevision: decision.revision,
          status: 'approved',
          reason: mode === 'policy_auto'
            ? 'policy_auto exact proposal batch authorization'
            : 'operator exact proposal batch authorization',
          actorId: mode === 'policy_auto' ? 'policy-engine' : 'operator',
        });
      }
      const evidenceExpiry = Math.min(...[...evidenceById.values()].map((evidence) => Date.parse(evidence.freshUntil)));
      const expiresAt = new Date(Math.min(
        evidenceExpiry,
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

function normalizePolicyRateLimits(rules: PolicyVersionRules): Pick<
  PolicyVersionRules,
  'maxDailyActionCount' | 'cooldownMinutes' | 'executionWindow'
> | undefined {
  const { maxDailyActionCount, cooldownMinutes, executionWindow } = rules;
  if (!Number.isSafeInteger(maxDailyActionCount) || maxDailyActionCount <= 0
    || !Number.isSafeInteger(cooldownMinutes) || cooldownMinutes < 0
    || !executionWindow || typeof executionWindow !== 'object') {
    return undefined;
  }
  const { timeZone, daysOfWeek, start, end } = executionWindow;
  if (typeof timeZone !== 'string' || !timeZone.trim()
    || !Array.isArray(daysOfWeek) || daysOfWeek.length === 0
    || daysOfWeek.some((day) => !Number.isSafeInteger(day) || day < 0 || day > 6)
    || typeof start !== 'string' || typeof end !== 'string'
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end)
    || wallClockMinutes(start) >= wallClockMinutes(end)) {
    return undefined;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    return undefined;
  }
  return {
    maxDailyActionCount,
    cooldownMinutes,
    executionWindow: { timeZone, daysOfWeek: [...daysOfWeek], start, end },
  };
}

function wallClockMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours * 60) + minutes;
}

function localPolicyClock(date: Date, timeZone: string): {
  businessDate: string;
  dayOfWeek: number;
  minuteOfDay: number;
} {
  if (!Number.isFinite(date.getTime())) throw new Error('MissionGrant issued_at is invalid.');
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => (
    parts.find((item) => item.type === type)?.value ?? ''
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
  const hours = Number(part('hour'));
  const minutes = Number(part('minute'));
  if (weekday < 0 || !Number.isSafeInteger(hours) || !Number.isSafeInteger(minutes)) {
    throw new Error('Policy execution-window clock could not be resolved.');
  }
  return {
    businessDate: `${part('year')}-${part('month')}-${part('day')}`,
    dayOfWeek: weekday,
    minuteOfDay: (hours * 60) + minutes,
  };
}

function parseGrantEntityIds(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Stored MissionGrant entity allowlist is invalid.');
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('Stored MissionGrant entity allowlist is invalid.');
  }
  return parsed.map((item) => item.trim());
}
