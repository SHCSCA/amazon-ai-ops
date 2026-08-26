import {
  ANALYSIS_REQUIRED_REPORT_TYPES,
  missionControlContextKey,
  type AnalysisEvidencePackageRecord,
  type AnalysisProposalSnapshotRecord,
  type AuthorizeAnalysisProposalBatchRequest,
  type AuthorizeAnalysisProposalBatchResult,
  type MissionAnalysisProjection,
  type RunMissionAnalysisRequest,
  type RunMissionAnalysisResult,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';

export interface AnalysisAuthorityRendererApi {
  runMissionAnalysis(input: RunMissionAnalysisRequest): Promise<RunMissionAnalysisResult>;
  getMissionProjection(context: StoreContextEnvelope, missionId: string): Promise<MissionAnalysisProjection>;
  authorizeProposalBatch(input: AuthorizeAnalysisProposalBatchRequest): Promise<AuthorizeAnalysisProposalBatchResult>;
}

export function assertAnalysisProjectionBelongsToContext(
  context: StoreContextEnvelope,
  missionId: string,
  projection: MissionAnalysisProjection,
): void {
  missionControlContextKey(context);
  const storeId = String(context.storeId);
  const evidenceIds = new Set(projection.evidencePackages.map((row) => row.id));
  const actionBatchIds = new Set(projection.actionBatches.map((row) => row.id));
  const proposalIds = new Set(projection.proposals.map((row) => row.id));
  const wrongScope = projection.evidencePackages.some((row) => (
    String(row.storeId) !== storeId || row.missionId !== missionId
    || row.marketplace !== 'US' || row.currency !== 'USD'
  )) || projection.actionBatches.some((row) => (
    String(row.storeId) !== storeId || row.missionId !== missionId
    || !evidenceIds.has(row.evidencePackageId)
  )) || projection.proposals.some((row) => (
    String(row.storeId) !== storeId || row.missionId !== missionId
    || row.marketplace !== 'US' || row.currency !== 'USD'
    || !evidenceIds.has(row.evidencePackageId) || !actionBatchIds.has(row.actionBatchId)
  )) || projection.decisionLinks.some((row) => (
    String(row.storeId) !== storeId || !proposalIds.has(row.proposalId)
  ));
  if (wrongScope) {
    throw new Error('分析 Authority 返回了跨店铺、错误 Mission 或断裂 lineage 的投影。');
  }
}

export function readAnalysisAuthorityWindowApi(
  target: unknown = typeof window === 'undefined' ? undefined : window,
): AnalysisAuthorityRendererApi | null {
  const candidate = (target as {
    electronAPI?: { analysisAuthority?: Partial<AnalysisAuthorityRendererApi> };
  } | null)?.electronAPI?.analysisAuthority;
  if (!candidate
    || typeof candidate.runMissionAnalysis !== 'function'
    || typeof candidate.getMissionProjection !== 'function'
    || typeof candidate.authorizeProposalBatch !== 'function') return null;
  return candidate as AnalysisAuthorityRendererApi;
}

/** Explicit browser-preview adapter; never installed outside the preview gate. */
export function createPreviewAnalysisAuthorityApi(): AnalysisAuthorityRendererApi {
  const projections = new Map<string, MissionAnalysisProjection>();
  const projectionFor = (context: StoreContextEnvelope, missionId: string) => {
    const key = `${missionControlContextKey(context)}:${missionId}`;
    const existing = projections.get(key);
    if (existing) return existing;
    const seeded = seedProjection(context, missionId);
    projections.set(key, seeded);
    return seeded;
  };
  return Object.freeze({
    async runMissionAnalysis(input: RunMissionAnalysisRequest): Promise<RunMissionAnalysisResult> {
      const projection = projectionFor(input.context, input.missionId);
      return {
        evidencePackage: projection.evidencePackages[0],
        proposals: projection.proposals,
        generatedRecommendations: projection.proposals.length,
        skippedUnsupportedRecommendations: 0,
        ai: {
          configured: true,
          invoked: true,
          modelRevision: 'preview-model:ad_strategy_diagnosis_v1',
          source: 'ai' as const,
          detail: '开发预览：规则与 AI 已完成结构化建议演示。',
        },
      };
    },
    async getMissionProjection(context: StoreContextEnvelope, missionId: string): Promise<MissionAnalysisProjection> {
      return structuredClone(projectionFor(context, missionId));
    },
    async authorizeProposalBatch(input: AuthorizeAnalysisProposalBatchRequest): Promise<AuthorizeAnalysisProposalBatchResult> {
      const projection = projectionFor(input.context, input.missionId);
      const ids = projection.proposals.map((proposal) => proposal.id);
      if (input.proposalIds.length !== ids.length || ids.some((id) => !input.proposalIds.includes(id))) {
        return {
          mode: 'manual_approval',
          proposalIds: [...input.proposalIds],
          decisionIds: projection.decisionLinks.map((link) => link.decisionId),
          authorized: false,
          blockers: ['开发预览也要求整批授权，不能只选一部分建议。'],
        };
      }
      const issuedAt = new Date().toISOString();
      return {
        mode: 'manual_approval',
        proposalIds: ids,
        decisionIds: projection.decisionLinks.map((link) => link.decisionId),
        authorized: true,
        blockers: [],
        grant: {
          id: `preview-grant:${input.missionId}`,
          storeId: input.context.storeId,
          marketplace: 'US',
          currency: 'USD',
          missionId: input.missionId,
          missionRevision: 1,
          decisionIds: projection.decisionLinks.map((link) => link.decisionId),
          actionRevision: 1,
          allowedActionTypes: ['set_keyword_bid'],
          allowedAdEntityIds: projection.proposals.map((proposal) => proposal.adEntityId!),
          maxChangePct: 10,
          totalImpactBudget: 0.35,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          policyVersionId: projection.proposals[0].policyVersionId,
          policyRevision: 1,
          requiredEvidence: [
            'page_identity', 'before_screenshot', 'after_screenshot',
            'reload_screenshot', 'readback_value',
          ],
          stopConditions: [
            { code: 'identity_drift', detail: '对象漂移立即停止' },
            { code: 'expected_before_mismatch', detail: '当前值不一致立即停止' },
            { code: 'unknown_result', detail: 'UNKNOWN 人工对账' },
            { code: 'data_stale', detail: '过期数据停止' },
            { code: 'impact_budget_exhausted', detail: '预算耗尽停止' },
            { code: 'kill_switch', detail: '急停立即停止' },
          ],
          issuer: { type: 'human', actorId: 'preview-operator' },
          issuedAt,
          createdSessionGeneration: input.context.sessionGeneration,
        },
      };
    },
  });
}

function seedProjection(
  context: StoreContextEnvelope,
  missionId: string,
): MissionAnalysisProjection {
  const storeToken = String(context.storeId).replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'store';
  const evidenceId = `analysis-evidence:${storeToken}:${missionId}`;
  const dataBatchId = `BATCH-${String(context.storeId)}-${context.businessDate.replaceAll('-', '')}`;
  const fileHash = 'a'.repeat(64);
  const evidence: AnalysisEvidencePackageRecord = {
    id: evidenceId,
    storeId: context.storeId,
    marketplace: 'US',
    currency: 'USD',
    missionId,
    dataBatchId,
    importRunId: `preview-import:${storeToken}`,
    dateFrom: new Date(Date.parse(`${context.businessDate}T00:00:00.000Z`) - 21 * 86400000).toISOString().slice(0, 10),
    dateTo: context.businessDate,
    reportTypes: [...ANALYSIS_REQUIRED_REPORT_TYPES],
    sources: ANALYSIS_REQUIRED_REPORT_TYPES.map((reportType, index) => ({
      reportType,
      fileHash: index === 0 ? fileHash : index.toString(16).padStart(64, String(index % 10)),
      fileSizeBytes: 2048 + index,
      importedRows: 80 + index,
      metricRows: reportType === 'keyword' ? 16 : 8,
      firstSourceRow: 2,
      lastSourceRow: 81 + index,
    })),
    metricRowCount: 72,
    reconciliationHash: 'b'.repeat(64),
    ruleRevision: 'c'.repeat(64),
    modelRevision: 'preview-model:ad_strategy_diagnosis_v1',
    packageHash: 'd'.repeat(64),
    importedAt: `${context.businessDate}T15:10:00.000Z`,
    freshUntil: new Date(Date.parse(`${context.businessDate}T15:10:00.000Z`) + 48 * 3600000).toISOString(),
    sealedAt: `${context.businessDate}T15:12:00.000Z`,
    createdSessionGeneration: context.sessionGeneration,
  };
  const actionBatchId = `analysis-action-batch:${storeToken}:${missionId}`;
  const proposals: AnalysisProposalSnapshotRecord[] = [
    ['door lock', 'opaque-keyword-1', 120, 102, 0.91],
    ['smart lock', 'opaque-keyword-2', 95, 85, 0.86],
  ].map(([name, entityId, currentBid, proposedBid, confidence], index) => ({
    id: `analysis-proposal:${storeToken}:${missionId}:${index + 1}`,
    storeId: context.storeId,
    marketplace: 'US',
    currency: 'USD',
    missionId,
    missionRevision: 1,
    evidencePackageId: evidence.id,
    evidencePackageHash: evidence.packageHash,
    dataBatchId,
    policyVersionId: `POLICY-${String(context.storeId)}-ACTIVE`,
    policyRevision: 1,
    ruleRevision: evidence.ruleRevision,
    modelRevision: evidence.modelRevision,
    actionBatchId,
    actionRevision: 1,
    legacyRecommendationId: index + 1,
    actionType: 'set_keyword_bid',
    entityType: 'keyword',
    entityName: String(name),
    campaignName: 'US Exact Core',
    adGroupName: 'Core terms',
    adEntityAuthorityId: `verified-ad-entity:${storeToken}:${index + 1}`,
    adEntityId: String(entityId),
    adEntityRevision: 1,
    currentBidCents: Number(currentBid),
    proposedBidCents: Number(proposedBid),
    changePct: (Number(proposedBid) - Number(currentBid)) / Number(currentBid) * 100,
    confidence: Number(confidence),
    source: 'rule_ai',
    explanation: '规则命中浪费阈值，AI 对降低竞价方向与保护订单守护栏保持一致。',
    authorization: {
      human: { eligible: true, blockers: [] },
      policy: { eligible: true, blockers: [] },
    },
    validUntil: evidence.freshUntil,
    createdAt: evidence.sealedAt,
    createdSessionGeneration: context.sessionGeneration,
  }));
  return {
    evidencePackages: [evidence],
    actionBatches: [{
      id: actionBatchId,
      storeId: context.storeId,
      missionId,
      missionRevision: 1,
      evidencePackageId: evidence.id,
      ruleRevision: evidence.ruleRevision,
      modelRevision: evidence.modelRevision,
      actionRevision: 1,
      createdAt: evidence.sealedAt,
      createdSessionGeneration: context.sessionGeneration,
    }],
    proposals,
    decisionLinks: proposals.map((proposal, index) => ({
      id: `proposal-decision-link:${storeToken}:${index + 1}`,
      storeId: context.storeId,
      proposalId: proposal.id,
      decisionId: `DEC-${String(context.storeId)}-${index + 1}`,
      createdAt: evidence.sealedAt,
    })),
  };
}
