import type {
  BindRecommendationWritableTargetRequest,
  ResolveRecommendationReviewRequest,
  WritableAdEntityType,
} from '@amazon-ai-ops/shared-types';
import type {
  OperationScope,
  RecommendationView,
} from '../types';
import {
  approvalBlockers,
  approvalMissing,
  buildApprovalDecisionPayload,
  buildRecommendationDecisionRequest,
} from './approval-page';
import {
  type DecisionSubmission,
  type DecisionsReviewFormState,
  type DecisionsWritableTargetFormInput,
} from "./decisions-contracts";

export function buildDecisionsDecisionRequest(input: {
  decision: DecisionSubmission;
  approverName: string;
  approvalNote: string;
  currentBatchId?: string;
  row: RecommendationView;
  scope: Pick<OperationScope, 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode' | 'asin'>;
}) {
  const decision = buildApprovalDecisionPayload({
    decision: input.decision,
    approverName: input.approverName,
    approvalNote: input.approvalNote,
    currentBatchId: input.currentBatchId,
    selected: input.row,
    scope: input.scope,
  });
  return buildRecommendationDecisionRequest(input.row, decision);
}

export function createDecisionsReviewFormState(
  row?: RecommendationView | null,
): DecisionsReviewFormState {
  const entityType = ['keyword', 'auto_targeting', 'product_targeting'].includes(String(row?.entityType || ''))
    ? row?.entityType as WritableAdEntityType
    : '';
  const evidenceSourceFiles = row?.evidence?.sourceFiles || [];
  const matchingSourceFile = evidenceSourceFiles.length === 1 ? evidenceSourceFiles[0] : '';
  return {
    reviewedBy: '',
    rationale: '',
    entityType,
    // 建议实体标识可能来自派生数据，不得自动填充权限对象标识。
    entityId: '',
    sourceFile: matchingSourceFile,
    // 可写对象可能来自不同报表行，必须显式输入，不得继承建议的来源行。
    sourceRow: '',
    identitySource: 'ads_ui',
    identityProofPath: '',
    verificationNote: '',
  };
}

export function buildDecisionsReviewRequest(input: {
  row: RecommendationView;
  scope: Pick<OperationScope, 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode' | 'asin'>;
  currentBatchId?: string;
  form: DecisionsReviewFormState;
}): ResolveRecommendationReviewRequest {
  const trim = (value: unknown) => String(value ?? '').trim();
  return {
    recommendationId: input.row.id,
    expectedRevision: input.row.revision,
    scope: {
      dateFrom: trim(input.scope.dateFrom),
      dateTo: trim(input.scope.dateTo),
      storeName: trim(input.scope.storeName),
      marketplaceCode: trim(input.scope.marketplaceCode),
      asin: trim(input.scope.asin),
      batchId: trim(input.currentBatchId),
    },
    review: {
      reviewedBy: trim(input.form.reviewedBy),
      rationale: trim(input.form.rationale),
      writableTarget: {
        entityType: input.form.entityType as WritableAdEntityType,
        entityId: trim(input.form.entityId),
        sourceFile: trim(input.form.sourceFile),
        sourceRow: Number(input.form.sourceRow),
        identitySource: input.form.identitySource as 'ads_ui' | 'ads_api',
        identityProofPath: trim(input.form.identityProofPath),
        verificationNote: trim(input.form.verificationNote),
      },
    },
  };
}

export function buildDecisionsTargetBindingRequest(input: {
  row: RecommendationView;
  scope: Pick<OperationScope, 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode' | 'asin'>;
  currentBatchId?: string;
  form: DecisionsReviewFormState;
}): BindRecommendationWritableTargetRequest {
  const trim = (value: unknown) => String(value ?? '').trim();
  return {
    recommendationId: input.row.id,
    expectedRevision: input.row.revision,
    scope: {
      dateFrom: trim(input.scope.dateFrom),
      dateTo: trim(input.scope.dateTo),
      storeName: trim(input.scope.storeName),
      marketplaceCode: trim(input.scope.marketplaceCode),
      asin: trim(input.scope.asin),
      batchId: trim(input.currentBatchId),
    },
    binding: {
      boundBy: trim(input.form.reviewedBy),
      note: trim(input.form.rationale),
      writableTarget: {
        entityType: input.form.entityType as WritableAdEntityType,
        entityId: trim(input.form.entityId),
        sourceFile: trim(input.form.sourceFile),
        sourceRow: Number(input.form.sourceRow),
        identitySource: input.form.identitySource as 'ads_ui' | 'ads_api',
        identityProofPath: trim(input.form.identityProofPath),
        verificationNote: trim(input.form.verificationNote),
      },
    },
  };
}

export function decisionsWritableTargetFormBlockers(input: DecisionsWritableTargetFormInput): string[] {
  const blockers: string[] = [];
  const trim = (value: unknown) => String(value ?? '').trim();
  const normalizePath = (value: unknown) => trim(value).replace(/\\/g, '/').toLowerCase();
  const supportedTypes = new Set<WritableAdEntityType>(['keyword', 'auto_targeting', 'product_targeting']);
  const batchId = trim(input.currentBatchId);
  const evidenceBatchId = trim(input.row.evidence?.batchId);
  const asin = trim(input.scope.asin).toUpperCase();
  const evidenceAsin = trim(input.row.evidence?.asin).toUpperCase();
  const allowedFiles = new Set((input.allowedSourceFiles || []).map(normalizePath).filter(Boolean));

  if (
    !trim(input.scope.dateFrom)
    || !trim(input.scope.dateTo)
    || !trim(input.scope.storeName)
    || !trim(input.scope.marketplaceCode)
    || !asin
    || !batchId
    || batchId !== evidenceBatchId
    || (evidenceAsin && evidenceAsin !== asin)
  ) {
    blockers.push('建议与当前锁定范围或批次不一致');
  }
  if (!Number.isInteger(input.row.revision) || input.row.revision < 0) {
    blockers.push('缺少当前建议版本');
  }
  const evidenceSourceFiles = input.row.evidence?.sourceFiles || [];
  if (
    evidenceSourceFiles.length === 0
    || evidenceSourceFiles.some((sourceRef) => !allowedFiles.has(normalizePath(sourceRef)))
  ) {
    blockers.push('建议来源证据不属于当前锁定批次');
    blockers.push('建议来源未能与不透明报表工件对应（旧路径证据已阻断）');
  }
  const evidenceSourceRow = Number(input.row.evidence?.sourceRow);
  if (!Number.isInteger(evidenceSourceRow) || evidenceSourceRow <= 0) {
    blockers.push('建议缺少可追溯的原始来源行');
  }
  if (!trim(input.form.reviewedBy)) blockers.push('缺少复核人');
  if (!trim(input.form.rationale)) blockers.push('缺少复核依据');

  if (!input.form.entityType || !supportedTypes.has(input.form.entityType)) {
    blockers.push('缺少可写 Ads 对象类型');
  }
  const entityId = trim(input.form.entityId);
  if (!entityId) blockers.push('缺少可写 Ads 对象 ID');
  if (entityId && input.row.entityId && entityId.toLowerCase() === trim(input.row.entityId).toLowerCase()) {
    blockers.push('可写对象 ID 仍是建议生成用的合成标识，无法唯一定位 Ads 对象');
  }

  const sourceFile = normalizePath(input.form.sourceFile);
  if (!sourceFile || !allowedFiles.has(sourceFile)) {
    blockers.push('可写对象来源文件不属于当前锁定批次');
    blockers.push('可写对象来源未能与不透明报表工件对应');
  }
  const sourceRow = Number(input.form.sourceRow);
  if (!Number.isInteger(sourceRow) || sourceRow <= 0) blockers.push('缺少唯一来源行');
  if (!['ads_ui', 'ads_api'].includes(input.form.identitySource)) blockers.push('缺少 Ads 身份核验来源');
  if (!trim(input.form.identityProofPath)) blockers.push('缺少 Ads 身份核验证据路径');
  if (!trim(input.form.verificationNote)) blockers.push('缺少 Ads 身份核验说明');
  return blockers;
}

export function decisionsReviewBlockers(input: {
  row: RecommendationView;
  scope: Pick<OperationScope, 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode' | 'asin'>;
  currentBatchId?: string;
  allowedSourceFiles?: string[];
  form: DecisionsReviewFormState;
}): string[] {
  const blockers = decisionsWritableTargetFormBlockers(input);
  if (input.row.status !== 'needs_review') blockers.push('当前建议不在需复核状态');
  if (input.row.actionType !== 'lower_bid' || input.row.evidence?.quantReviewRequired !== true) {
    blockers.push('当前仅支持规则量化触发的降低竞价复核');
  }
  return Array.from(new Set(blockers));
}

export function decisionsTargetBindingBlockers(input: DecisionsWritableTargetFormInput): string[] {
  const blockers = decisionsWritableTargetFormBlockers(input);
  if (input.row.status !== 'pending') blockers.push('当前建议不在待审批状态');
  if (input.row.actionType !== 'lower_bid') blockers.push('当前入口仅支持降低竞价建议');
  if (input.row.evidence?.quantReviewRequired === true) {
    blockers.push('需量化复核的建议必须先走受控复核');
  }
  if (input.row.evidence?.writableTarget || input.row.evidence?.writableTargetBinding) {
    blockers.push('当前建议已存在 Ads 可写对象或绑定审计');
  }
  blockers.push(
    ...approvalMissing(
      input.row,
      input.scope,
      input.currentBatchId,
      input.allowedSourceFiles,
    ).filter((label) => label !== 'Ads 可写对象'),
    ...approvalBlockers(input.row),
  );
  return Array.from(new Set(blockers));
}
