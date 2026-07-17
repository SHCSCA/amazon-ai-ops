import type {
  ActionRecommendation,
  AdReadbackAuthorityRecord,
  AdReadbackAuthorityScope,
  ExportAdReadbackEvidenceRequest,
  WritableAdTargetEvidence,
} from '@amazon-ai-ops/shared-types';
import {
  getRecommendationWritableTargetOwnershipBlockers,
  type RecommendationMetricSourceAuthority,
} from './recommendation-writable-target-policy';
import type { AdReadbackEvidenceInput } from './ad-readback-evidence';

export type ExportAuthorizedAdReadbackEvidenceRequest = ExportAdReadbackEvidenceRequest;
export type { AdReadbackAuthorityScope } from '@amazon-ai-ops/shared-types';

export interface BuildAuthorizedAdReadbackEvidenceInput {
  request: ExportAdReadbackEvidenceRequest;
  recommendation: ActionRecommendation | undefined;
  resolvedScope: AdReadbackAuthorityScope;
  allowedSourceFiles: string[];
  sourceAuthority: RecommendationMetricSourceAuthority;
}

export interface AssertCurrentAdReadbackEvidenceAuthorityInput {
  evidence: Record<string, any>;
  recommendation: ActionRecommendation | undefined;
  resolvedScope: AdReadbackAuthorityScope;
  allowedSourceFiles: string[];
  sourceAuthority: RecommendationMetricSourceAuthority;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizedText(value: unknown): string {
  return text(value).toLowerCase();
}

function normalizedAsin(value: unknown): string {
  return text(value).toUpperCase();
}

function normalizedPath(value: unknown): string {
  return text(value).replace(/\\/g, '/').toLowerCase();
}

function objectOrEmpty(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function canonicalDatabaseTimestamp(value: unknown): string {
  const raw = text(value);
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const timestamp = Date.parse(sqliteUtc);
  if (!raw || !Number.isFinite(timestamp)) {
    throw new Error('结果核对被阻断：当前建议的数据库更新时间无效，无法建立可复核权威记录。');
  }
  return new Date(timestamp).toISOString();
}

function sameScope(left: AdReadbackAuthorityScope, right: AdReadbackAuthorityScope): boolean {
  return text(left.dateFrom) === text(right.dateFrom)
    && text(left.dateTo) === text(right.dateTo)
    && normalizedText(left.storeName) === normalizedText(right.storeName)
    && normalizedText(left.marketplaceCode) === normalizedText(right.marketplaceCode)
    && normalizedAsin(left.asin) === normalizedAsin(right.asin)
    && text(left.batchId) === text(right.batchId);
}

function sameApprovalScope(value: unknown, scope: AdReadbackAuthorityScope): boolean {
  const approvalScope = objectOrEmpty(value);
  return text(approvalScope.dateFrom) === text(scope.dateFrom)
    && text(approvalScope.dateTo) === text(scope.dateTo)
    && normalizedText(approvalScope.storeName) === normalizedText(scope.storeName)
    && normalizedText(approvalScope.marketplaceCode) === normalizedText(scope.marketplaceCode)
    && normalizedAsin(approvalScope.asin) === normalizedAsin(scope.asin);
}

function samePathSet(left: string[], right: string[]): boolean {
  const normalizedLeft = Array.from(new Set(left.map(normalizedPath))).sort();
  const normalizedRight = Array.from(new Set(right.map(normalizedPath))).sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function assertSourceFilesAllowed(sourceFiles: string[], allowedSourceFiles: string[]): void {
  if (!sourceFiles.length) {
    throw new Error('结果核对被阻断：已批准建议缺少真实来源文件。');
  }
  const allowed = new Set(allowedSourceFiles.map(normalizedPath).filter(Boolean));
  if (!allowed.size || sourceFiles.some((filePath) => !allowed.has(normalizedPath(filePath)))) {
    throw new Error('结果核对被阻断：来源文件不属于当前数据批次，请刷新范围后重试。');
  }
}

const WRITABLE_AD_ENTITY_TYPES = new Set(['keyword', 'auto_targeting', 'product_targeting']);

function requireVerifiedWritableTarget(
  recommendation: ActionRecommendation,
  allowedSourceFiles: string[],
  sourceAuthority: RecommendationMetricSourceAuthority,
): {
  entityType: string;
  entityId: string;
  entityName: string;
  campaignName: string;
  adGroupName: string;
  metricDate: string;
  identityProofPath: string;
} {
  const evidence = recommendation.evidence || {};
  const writableTarget = objectOrEmpty(evidence.writableTarget);
  const entityType = normalizedText(writableTarget.entityType);
  const entityId = text(writableTarget.entityId);
  const entityName = text(writableTarget.entityName);
  const campaignName = text(writableTarget.campaignName);
  const adGroupName = text(writableTarget.adGroupName);
  const metricDate = text(writableTarget.metricDate);
  const sourceFile = text(writableTarget.sourceFile);
  const targetSourceRow = positiveInteger(writableTarget.sourceRow);
  const verifiedAt = Date.parse(text(writableTarget.verifiedAt));
  const sourceFileSet = new Set(allowedSourceFiles.map(normalizedPath));

  if (
    !WRITABLE_AD_ENTITY_TYPES.has(entityType)
    || !entityId
    || normalizedText(entityId) === normalizedText(recommendation.entityId)
    || !entityName
    || !campaignName
    || !adGroupName
    || !metricDate
    || !sourceFile
    || !sourceFileSet.has(normalizedPath(sourceFile))
    || targetSourceRow === null
    || !text(writableTarget.verifiedBy)
    || !['ads_ui', 'ads_api'].includes(normalizedText(writableTarget.identitySource))
    || !Number.isFinite(verifiedAt)
    || !text(writableTarget.verificationNote)
    || !text(writableTarget.identityProofPath)
    || normalizedText(campaignName) !== normalizedText(evidence.campaignName)
    || normalizedText(adGroupName) !== normalizedText(evidence.adGroupName)
  ) {
    throw new Error('结果核对被阻断：建议缺少经人工核验且可追溯的 Ads 可写对象，请先完成专门复核。');
  }

  const ownershipBlockers = getRecommendationWritableTargetOwnershipBlockers(
    recommendation,
    writableTarget as unknown as WritableAdTargetEvidence,
    sourceAuthority,
  );
  if (ownershipBlockers.length > 0) {
    throw new Error(`结果核对被阻断：Ads 可写对象不属于当前建议：${ownershipBlockers.join('、')}。`);
  }

  return {
    entityType,
    entityId,
    entityName,
    campaignName,
    adGroupName,
    metricDate,
    identityProofPath: text(writableTarget.identityProofPath),
  };
}

function sameWritableTarget(leftValue: unknown, rightValue: unknown): boolean {
  const left = objectOrEmpty(leftValue);
  const right = objectOrEmpty(rightValue);
  return normalizedText(left.entityType) === normalizedText(right.entityType)
    && text(left.entityId) === text(right.entityId)
    && normalizedText(left.entityName) === normalizedText(right.entityName)
    && normalizedText(left.campaignName) === normalizedText(right.campaignName)
    && normalizedText(left.adGroupName) === normalizedText(right.adGroupName)
    && text(left.metricDate) === text(right.metricDate)
    && normalizedPath(left.sourceFile) === normalizedPath(right.sourceFile)
    && positiveInteger(left.sourceRow) === positiveInteger(right.sourceRow)
    && normalizedText(left.identitySource) === normalizedText(right.identitySource)
    && text(left.verifiedBy) === text(right.verifiedBy)
    && sameTimestamp(left.verifiedAt, right.verifiedAt)
    && text(left.verificationNote) === text(right.verificationNote)
    && normalizedPath(left.identityProofPath) === normalizedPath(right.identityProofPath);
}

function assertApprovedQuantReviewResolution(input: {
  recommendation: ActionRecommendation;
  resolvedScope: AdReadbackAuthorityScope;
  sourceFiles: string[];
  sourceRow: number | null;
  approvalDecidedAt: unknown;
}): void {
  const evidence = input.recommendation.evidence || {};
  if (evidence.quantReviewRequired !== true) return;

  const resolution = objectOrEmpty(evidence.reviewResolution);
  const metricSource = objectOrEmpty(resolution.metricSource);
  const resolvedBlockers = Array.isArray(resolution.resolvedBlockers)
    ? resolution.resolvedBlockers.map(text).filter(Boolean)
    : [];
  const fromRevision = nonNegativeInteger(resolution.fromRevision);
  const resolvedRevision = nonNegativeInteger(resolution.resolvedRevision);
  const reviewedAt = Date.parse(text(resolution.reviewedAt));
  const approvedAt = Date.parse(text(input.approvalDecidedAt));
  const valid = Number(resolution.schemaVersion) === 1
    && resolution.fromStatus === 'needs_review'
    && fromRevision !== null
    && resolvedRevision !== null
    && resolvedRevision === fromRevision + 1
    && resolvedRevision + 1 === (input.recommendation.revision ?? 0)
    && resolvedBlockers.length === 1
    && resolvedBlockers[0] === 'quant_review_required'
    && Boolean(text(resolution.reviewedBy))
    && Boolean(text(resolution.rationale))
    && Number.isFinite(reviewedAt)
    && Number.isFinite(approvedAt)
    && reviewedAt <= approvedAt
    && sameScope(objectOrEmpty(resolution.scope) as AdReadbackAuthorityScope, input.resolvedScope)
    && text(metricSource.batchId) === text(evidence.batchId)
    && samePathSet(stringArray(metricSource.sourceFiles), input.sourceFiles)
    && positiveInteger(metricSource.sourceRow) === input.sourceRow
    && sameWritableTarget(resolution.writableTarget, evidence.writableTarget);
  if (!valid) {
    throw new Error('结果核对被阻断：规则量化建议缺少与批准前版本一致的人工复核记录。');
  }
}

function authoritativeScopeCopy(scope: AdReadbackAuthorityScope): AdReadbackAuthorityScope {
  return {
    dateFrom: text(scope.dateFrom),
    dateTo: text(scope.dateTo),
    storeName: text(scope.storeName),
    marketplaceCode: text(scope.marketplaceCode),
    asin: text(scope.asin),
    batchId: text(scope.batchId),
  };
}

function approvalScopeText(scope: AdReadbackAuthorityScope): string {
  return [
    scope.storeName,
    scope.marketplaceCode,
    scope.asin,
    `${scope.dateFrom}~${scope.dateTo}`,
    scope.batchId,
  ].filter(Boolean).join(' / ');
}

export function buildAuthorizedAdReadbackEvidenceInput(
  input: BuildAuthorizedAdReadbackEvidenceInput,
): AdReadbackEvidenceInput {
  const recommendationId = positiveInteger(input.request?.recommendationId);
  if (!recommendationId) {
    throw new Error('结果核对被阻断：缺少有效 recommendationId，请刷新已批准动作。');
  }
  const expectedRevision = nonNegativeInteger(input.request?.expectedRevision);
  if (expectedRevision === null) {
    throw new Error('结果核对被阻断：缺少有效建议版本，请刷新已批准动作。');
  }

  const recommendation = input.recommendation;
  if (!recommendation || recommendation.id !== recommendationId) {
    throw new Error('结果核对被阻断：已批准建议不存在，请刷新后重试。');
  }
  if (recommendation.status !== 'approved') {
    throw new Error(`结果核对被阻断：建议当前状态 ${recommendation.status} 不能导出回读证据。`);
  }
  if ((recommendation.revision ?? 0) !== expectedRevision) {
    throw new Error('结果核对状态冲突：建议版本已变化，请刷新后重试。');
  }
  const recommendationCheckedAt = canonicalDatabaseTimestamp(recommendation.updatedAt);

  const resolvedScope = authoritativeScopeCopy(input.resolvedScope);
  if (!sameScope(input.request.scope, resolvedScope)) {
    throw new Error('结果核对被阻断：请求与当前运行范围不一致，请刷新后重试。');
  }
  if (
    normalizedText(recommendation.storeName) !== normalizedText(resolvedScope.storeName)
    || normalizedText(recommendation.marketplaceCode) !== normalizedText(resolvedScope.marketplaceCode)
    || normalizedAsin(recommendation.asin || recommendation.evidence?.asin) !== normalizedAsin(resolvedScope.asin)
    || text(recommendation.evidence?.batchId) !== resolvedScope.batchId
  ) {
    throw new Error('结果核对被阻断：建议与当前运行范围不一致，请刷新后重试。');
  }

  const evidence = recommendation.evidence || {};
  const approvalDecision = objectOrEmpty(evidence.approvalDecision);
  const sourceFiles = stringArray(evidence.sourceFiles);
  const approvalSourceFiles = stringArray(approvalDecision.sourceFiles);
  const sourceRow = positiveInteger(evidence.sourceRow);
  if (
    approvalDecision.decision !== 'approved'
    || !text(approvalDecision.approvedBy)
    || !text(approvalDecision.decidedAt)
    || text(approvalDecision.batchId) !== resolvedScope.batchId
    || text(approvalDecision.sourceBatchId) !== resolvedScope.batchId
    || text(approvalDecision.metricDate) !== text(evidence.date)
    || positiveInteger(approvalDecision.sourceRow) !== sourceRow
    || !samePathSet(approvalSourceFiles, sourceFiles)
    || !sameApprovalScope(approvalDecision.scope, resolvedScope)
  ) {
    throw new Error('结果核对被阻断：批准记录与当前建议的批次或范围不一致，请重新审批。');
  }
  assertSourceFilesAllowed(sourceFiles, input.allowedSourceFiles);

  if (recommendation.actionType !== 'lower_bid') {
    throw new Error('结果核对被阻断：首个真实回读仅允许有界的降低竞价动作。');
  }
  const writableTarget = requireVerifiedWritableTarget(
    recommendation,
    input.allowedSourceFiles,
    input.sourceAuthority,
  );
  assertApprovedQuantReviewResolution({
    recommendation,
    resolvedScope,
    sourceFiles,
    sourceRow,
    approvalDecidedAt: approvalDecision.decidedAt,
  });

  const riskLevel = normalizedText(recommendation.riskLevel);
  if (riskLevel === 'high' || riskLevel === 'forbidden' || riskLevel.includes('forbidden')) {
    throw new Error('结果核对被阻断：高风险或禁止执行建议不能进入普通回读导出。');
  }

  const operatorEvidence = input.request.operatorEvidence || {};
  const operatorApproval = objectOrEmpty(operatorEvidence.approval);
  const operatorRisk = objectOrEmpty(operatorEvidence.risk);

  return {
    authority: {
      recommendationId,
      recommendationRevision: expectedRevision,
      recommendationStatusAtExport: 'approved',
      dateFrom: resolvedScope.dateFrom,
      dateTo: resolvedScope.dateTo,
      storeName: resolvedScope.storeName,
      marketplaceCode: resolvedScope.marketplaceCode,
      asin: resolvedScope.asin,
      batchId: resolvedScope.batchId,
      checkedAt: recommendationCheckedAt,
    } satisfies AdReadbackAuthorityRecord,
    target: {
      storeName: recommendation.storeName,
      marketplaceCode: recommendation.marketplaceCode,
      portfolioName: text(evidence.portfolioName),
      asin: recommendation.asin || text(evidence.asin),
      metricDate: writableTarget.metricDate,
      campaignName: writableTarget.campaignName,
      adGroupName: writableTarget.adGroupName,
      entityType: writableTarget.entityType,
      entityId: writableTarget.entityId,
      entityName: writableTarget.entityName,
      identityProofPath: writableTarget.identityProofPath,
      actionType: recommendation.actionType,
    },
    source: {
      recommendationId: String(recommendationId),
      recommendationRevision: expectedRevision,
      batchId: resolvedScope.batchId,
      metricDate: text(evidence.date),
      sourceRow,
      sourceFiles,
      explanationSource: evidence.explanationSource,
      aiModel: evidence.aiModel,
      entityType: recommendation.entityType,
      currentValue: recommendation.currentValue,
      recommendedValue: recommendation.recommendedValue,
      decisionAgreement: evidence.decisionAgreement,
      decisionSource: evidence.decisionSource,
      decisionReasons: evidence.decisionReasons,
      decisionRiskWarnings: evidence.decisionRiskWarnings,
      aiStrategySource: evidence.aiStrategySource,
      aiLifecycleStage: evidence.aiLifecycleStage,
      aiStrategySummary: evidence.aiStrategySummary,
      aiStrategyFallbackReason: evidence.aiStrategyFallbackReason,
      aiActionFallbackReason: evidence.aiActionFallbackReason,
      aiMainProblems: evidence.aiMainProblems,
      aiThresholdSuggestions: evidence.aiThresholdSuggestions,
      aiStrategyRiskWarnings: evidence.aiStrategyRiskWarnings,
      quantStatus: evidence.quantStatus,
      quantLifecycleStage: evidence.quantLifecycleStage,
      quantReasons: evidence.quantReasons,
      quantThresholds: evidence.quantThresholds,
      quantReviewRequired: evidence.quantReviewRequired,
      operationEventCount: evidence.operationEventCount,
      productContextCount: evidence.productContextCount,
      productStage: evidence.productStage,
      productTargetAcos: evidence.productTargetAcos,
      productTargetTacos: evidence.productTargetTacos,
      productTargetNetMargin: evidence.productTargetNetMargin,
      productMinPrice: evidence.productMinPrice,
    },
    approval: {
      operatorConfirmed: operatorApproval.operatorConfirmed === true,
      realWriteApproved: operatorApproval.realWriteApproved === true,
      scope: approvalScopeText(resolvedScope),
      confirmedAt: text(approvalDecision.decidedAt),
      approverName: text(approvalDecision.approvedBy),
      note: text(approvalDecision.note),
      approvalArtifactPath: text(operatorApproval.approvalArtifactPath),
    },
    risk: {
      allowedByPolicy: operatorRisk.allowedByPolicy === true,
      rationale: recommendation.reason,
    },
    before: objectOrEmpty(operatorEvidence.before),
    after: objectOrEmpty(operatorEvidence.after),
    readback: objectOrEmpty(operatorEvidence.readback),
    execution: objectOrEmpty(operatorEvidence.execution),
  };
}

function sameText(left: unknown, right: unknown): boolean {
  return text(left) === text(right);
}

function sameNormalizedText(left: unknown, right: unknown): boolean {
  return normalizedText(left) === normalizedText(right);
}

function sameTimestamp(left: unknown, right: unknown): boolean {
  const leftTimestamp = Date.parse(text(left));
  const rightTimestamp = Date.parse(text(right));
  return Number.isFinite(leftTimestamp)
    && Number.isFinite(rightTimestamp)
    && leftTimestamp === rightTimestamp;
}

function authoritySensitiveFieldsMatch(
  evidence: Record<string, any>,
  canonical: AdReadbackEvidenceInput,
): boolean {
  const actualAuthority = objectOrEmpty(evidence.authority);
  const expectedAuthority = objectOrEmpty(canonical.authority);
  const authorityMatches = positiveInteger(actualAuthority.recommendationId) === positiveInteger(expectedAuthority.recommendationId)
    && Number(actualAuthority.recommendationRevision) === Number(expectedAuthority.recommendationRevision)
    && sameText(actualAuthority.recommendationStatusAtExport, expectedAuthority.recommendationStatusAtExport)
    && sameText(actualAuthority.dateFrom, expectedAuthority.dateFrom)
    && sameText(actualAuthority.dateTo, expectedAuthority.dateTo)
    && sameNormalizedText(actualAuthority.storeName, expectedAuthority.storeName)
    && sameNormalizedText(actualAuthority.marketplaceCode, expectedAuthority.marketplaceCode)
    && normalizedAsin(actualAuthority.asin) === normalizedAsin(expectedAuthority.asin)
    && sameText(actualAuthority.batchId, expectedAuthority.batchId)
    && sameTimestamp(actualAuthority.checkedAt, expectedAuthority.checkedAt);

  const actualTarget = objectOrEmpty(evidence.target);
  const expectedTarget = objectOrEmpty(canonical.target);
  const targetMatches = sameNormalizedText(actualTarget.storeName, expectedTarget.storeName)
    && sameNormalizedText(actualTarget.marketplaceCode, expectedTarget.marketplaceCode)
    && normalizedAsin(actualTarget.asin) === normalizedAsin(expectedTarget.asin)
    && sameText(actualTarget.portfolioName, expectedTarget.portfolioName)
    && sameText(actualTarget.metricDate, expectedTarget.metricDate)
    && sameText(actualTarget.campaignName, expectedTarget.campaignName)
    && sameText(actualTarget.adGroupName, expectedTarget.adGroupName)
    && sameText(actualTarget.entityType, expectedTarget.entityType)
    && sameText(actualTarget.entityId, expectedTarget.entityId)
    && sameText(actualTarget.entityName, expectedTarget.entityName)
    && sameText(actualTarget.identityProofPath, expectedTarget.identityProofPath)
    && sameText(actualTarget.actionType, expectedTarget.actionType);

  const actualSource = objectOrEmpty(evidence.source);
  const expectedSource = objectOrEmpty(canonical.source);
  const sourceMatches = sameText(actualSource.recommendationId, expectedSource.recommendationId)
    && Number(actualSource.recommendationRevision) === Number(expectedSource.recommendationRevision)
    && sameText(actualSource.batchId, expectedSource.batchId)
    && sameText(actualSource.metricDate, expectedSource.metricDate)
    && positiveInteger(actualSource.sourceRow) === positiveInteger(expectedSource.sourceRow)
    && samePathSet(stringArray(actualSource.sourceFiles), stringArray(expectedSource.sourceFiles))
    && sameText(actualSource.entityType, expectedSource.entityType)
    && sameText(actualSource.currentValue, expectedSource.currentValue)
    && sameText(actualSource.recommendedValue, expectedSource.recommendedValue);

  const actualApproval = objectOrEmpty(evidence.approval);
  const expectedApproval = objectOrEmpty(canonical.approval);
  const approvalMatches = sameText(actualApproval.approverName, expectedApproval.approverName)
    && sameText(actualApproval.confirmedAt, expectedApproval.confirmedAt)
    && sameText(actualApproval.note, expectedApproval.note)
    && sameText(actualApproval.scope, expectedApproval.scope);

  return authorityMatches
    && targetMatches
    && sourceMatches
    && approvalMatches
    && sameText(evidence.risk?.rationale, canonical.risk?.rationale);
}

export function assertCurrentAdReadbackEvidenceAuthority(
  input: AssertCurrentAdReadbackEvidenceAuthorityInput,
): AdReadbackAuthorityRecord {
  const authority = objectOrEmpty(input.evidence?.authority);
  const canonical = buildAuthorizedAdReadbackEvidenceInput({
    request: {
      recommendationId: Number(authority.recommendationId),
      expectedRevision: Number(authority.recommendationRevision),
      scope: {
        dateFrom: text(authority.dateFrom),
        dateTo: text(authority.dateTo),
        storeName: text(authority.storeName),
        marketplaceCode: text(authority.marketplaceCode),
        asin: text(authority.asin),
        batchId: text(authority.batchId),
      },
      operatorEvidence: {
        approval: objectOrEmpty(input.evidence.approval),
        risk: objectOrEmpty(input.evidence.risk),
        before: objectOrEmpty(input.evidence.before),
        after: objectOrEmpty(input.evidence.after),
        readback: objectOrEmpty(input.evidence.readback),
        execution: objectOrEmpty(input.evidence.execution),
      },
    },
    recommendation: input.recommendation,
    resolvedScope: input.resolvedScope,
    allowedSourceFiles: input.allowedSourceFiles,
    sourceAuthority: input.sourceAuthority,
  });

  if (!authoritySensitiveFieldsMatch(input.evidence, canonical)) {
    throw new Error('结果核对被阻断：证据中的数据库权威字段已被修改，请重新导出。');
  }
  return canonical.authority as AdReadbackAuthorityRecord;
}
