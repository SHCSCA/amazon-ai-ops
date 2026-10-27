import {
  describe,
  expect,
  it,
} from 'vitest';
import { createBrowserPreviewElectronApi } from '../dev-preview-api';
import type { RecommendationView } from '../types';
import {
  buildDecisionsDecisionRequest,
  buildDecisionsReviewRequest,
  buildDecisionsTargetBindingRequest,
  decisionEligibilitySummary,
  decisionsSharedApprovalPolicyBlockers,
  decisionsReviewBlockers,
  decisionsTargetBindingBlockers,
  isConfirmedDecisionsReviewResolution,
  isConfirmedDecisionsTargetBinding,
} from './decisions-page';
import {
  recommendation,
  eligibilityContext,
} from "./decisions-page.test-fixtures";

describe('decision safety summaries', () => {
  it('builds a locked pending target-binding request without turning it into an approval', () => {
    const row = recommendation('pending', { id: 303, revision: 12 });
    delete row.evidence?.writableTarget;

    expect(buildDecisionsTargetBindingRequest({
      row,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
      currentBatchId: 'batch-20260714',
      form: {
        reviewedBy: ' Alice ',
        rationale: ' Current Ads row verified. ',
        entityType: 'keyword',
        entityId: ' amzn-keyword-303 ',
        sourceFile: ' D:/reports/keyword.csv ',
        sourceRow: '18',
        identitySource: 'ads_ui',
        identityProofPath: ' D:/proof/keyword.png ',
        verificationNote: ' Matched campaign, ad group, and keyword ID. ',
      },
    })).toEqual({
      recommendationId: 303,
      expectedRevision: 12,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
        batchId: 'batch-20260714',
      },
      binding: {
        boundBy: 'Alice',
        note: 'Current Ads row verified.',
        writableTarget: {
          entityType: 'keyword',
          entityId: 'amzn-keyword-303',
          sourceFile: 'D:/reports/keyword.csv',
          sourceRow: 18,
          identitySource: 'ads_ui',
          identityProofPath: 'D:/proof/keyword.png',
          verificationNote: 'Matched campaign, ad group, and keyword ID.',
        },
      },
    });
  });

  it('allows only an otherwise approvable unbound pending lower-bid row into target binding', () => {
    const row = recommendation('pending', { entityId: 'synthetic-keyword-row' });
    delete row.evidence?.writableTarget;
    const base = {
      row,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
      currentBatchId: 'batch-20260714',
      allowedSourceFiles: ['D:/reports/keyword.csv', 'D:/reports/keyword.xlsx'],
      form: {
        reviewedBy: 'Alice',
        rationale: 'Current Ads row verified.',
        entityType: 'keyword' as const,
        entityId: 'amzn-keyword-303',
        sourceFile: 'D:/reports/keyword.csv',
        sourceRow: '18',
        identitySource: 'ads_ui' as const,
        identityProofPath: 'D:/proof/keyword.png',
        verificationNote: 'Matched campaign, ad group, and keyword ID.',
      },
    };

    expect(decisionsTargetBindingBlockers(base)).toEqual([]);
    expect(decisionsTargetBindingBlockers({
      ...base,
      row: { ...row, evidence: { ...row.evidence, quantReviewRequired: true } },
    })).toContain('需量化复核的建议必须先走受控复核');
    expect(decisionsTargetBindingBlockers({
      ...base,
      row: recommendation('pending'),
    })).toContain('当前建议已存在 Ads 可写对象或绑定审计');
  });

  it('recognizes target-binding success only after the reloaded revision and audit both match', () => {
    const row = recommendation('pending', { id: 303, revision: 13 });
    const target = row.evidence!.writableTarget!;
    const request = buildDecisionsTargetBindingRequest({
      row: { ...row, revision: 12 },
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
      currentBatchId: 'batch-20260714',
      form: {
        reviewedBy: 'Alice',
        rationale: 'Verified.',
        entityType: 'keyword',
        entityId: 'amzn-keyword-101',
        sourceFile: 'D:/reports/keyword.xlsx',
        sourceRow: '18',
        identitySource: 'ads_ui',
        identityProofPath: 'D:/proof/keyword-101.png',
        verificationNote: 'Matched the editable keyword row.',
      },
    });
    row.evidence = {
      ...row.evidence,
      writableTargetBinding: {
        schemaVersion: 1,
        fromRevision: 12,
        boundRevision: 13,
        boundBy: 'Alice',
        boundAt: '2026-07-16T04:30:00.000Z',
        note: 'Verified.',
        scope: {
          dateFrom: '2026-07-07',
          dateTo: '2026-07-13',
          storeName: 'US Store',
          marketplaceCode: 'US',
          asin: 'B0TEST101',
          batchId: 'batch-20260714',
        },
        metricSource: {
          batchId: 'batch-20260714',
          sourceFiles: ['D:/reports/keyword.xlsx'],
          sourceRow: 18,
        },
        writableTarget: target,
      },
    };

    const result = { ok: true as const, recommendationId: 303, status: 'verified' as const, revision: 13, boundAt: '2026-07-16T04:30:00.000Z' };
    expect(isConfirmedDecisionsTargetBinding(row, result, request)).toBe(true);
    expect(isConfirmedDecisionsTargetBinding({ ...row, revision: 12 }, result, request)).toBe(false);
    expect(isConfirmedDecisionsTargetBinding(row, result, {
      ...request,
      scope: { ...request.scope, batchId: 'cross-batch' },
    })).toBe(false);
    expect(isConfirmedDecisionsTargetBinding(row, result, {
      ...request,
      binding: { ...request.binding, boundBy: 'Mallory' },
    })).toBe(false);
  });

  it('confirms controlled review only when the API result and reloaded rev+1 audit match the submitted request', () => {
    const submitted = recommendation('needs_review', {
      id: 202,
      revision: 11,
      evidence: {
        ...recommendation().evidence,
        quantReviewRequired: true,
      },
    });
    const request = buildDecisionsReviewRequest({
      row: submitted,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
      currentBatchId: 'batch-20260714',
      form: {
        reviewedBy: 'Alice',
        rationale: 'Controlled quant review completed.',
        entityType: 'keyword',
        entityId: 'amzn-keyword-202',
        sourceFile: 'D:/reports/keyword.xlsx',
        sourceRow: '18',
        identitySource: 'ads_ui',
        identityProofPath: 'D:/proof/keyword-202.png',
        verificationNote: 'Matched campaign, ad group, and keyword ID.',
      },
    });
    const reviewedAt = '2026-07-16T04:45:00.000Z';
    const target = {
      ...submitted.evidence!.writableTarget!,
      entityId: 'amzn-keyword-202',
      verifiedBy: 'Alice',
      verifiedAt: reviewedAt,
      verificationNote: 'Matched campaign, ad group, and keyword ID.',
      identityProofPath: 'D:/proof/keyword-202.png',
    };
    const refreshed: RecommendationView = {
      ...submitted,
      status: 'pending',
      revision: 12,
      evidence: {
        ...submitted.evidence,
        writableTarget: target,
        reviewResolution: {
          schemaVersion: 1,
          fromStatus: 'needs_review',
          fromRevision: 11,
          resolvedRevision: 12,
          reviewedBy: 'Alice',
          reviewedAt,
          rationale: 'Controlled quant review completed.',
          resolvedBlockers: ['quant_review_required'],
          scope: { ...request.scope },
          metricSource: {
            batchId: 'batch-20260714',
            sourceFiles: ['D:/reports/keyword.xlsx'],
            sourceRow: 18,
          },
          writableTarget: target,
        },
      },
    };
    const result = {
      ok: true as const,
      recommendationId: 202,
      previousStatus: 'needs_review' as const,
      status: 'pending' as const,
      revision: 12,
      reviewedAt,
      resolvedBlockers: ['quant_review_required'] as ['quant_review_required'],
    };

    expect(isConfirmedDecisionsReviewResolution(submitted, request, result, refreshed)).toBe(true);
    expect(isConfirmedDecisionsReviewResolution(submitted, request, result, {
      ...refreshed,
      evidence: { ...refreshed.evidence, reviewResolution: undefined },
    })).toBe(false);
    expect(isConfirmedDecisionsReviewResolution(submitted, request, result, {
      ...refreshed,
      evidence: {
        ...refreshed.evidence,
        reviewResolution: {
          ...refreshed.evidence!.reviewResolution!,
          scope: { ...request.scope, batchId: 'cross-batch' },
        },
      },
    })).toBe(false);
    expect(isConfirmedDecisionsReviewResolution(submitted, request, {
      ...result,
      resolvedBlockers: [] as unknown as ['quant_review_required'],
    }, refreshed)).toBe(false);
  });

  it('builds controlled review requests from the displayed revision and locked scope instead of editable authority fields', () => {
    const row = recommendation('needs_review', { id: 202, revision: 11 });

    expect(buildDecisionsReviewRequest({
      row,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
      currentBatchId: 'batch-20260714',
      form: {
        reviewedBy: ' Alice ',
        rationale: ' Current Ads row verified. ',
        entityType: 'keyword',
        entityId: ' amzn-keyword-202 ',
        sourceFile: ' D:/reports/keyword.xlsx ',
        sourceRow: '18',
        identitySource: 'ads_ui',
        identityProofPath: ' D:/proof/keyword.png ',
        verificationNote: ' Matched campaign, ad group, and keyword ID. ',
      },
    })).toEqual({
      recommendationId: 202,
      expectedRevision: 11,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
        batchId: 'batch-20260714',
      },
      review: {
        reviewedBy: 'Alice',
        rationale: 'Current Ads row verified.',
        writableTarget: {
          entityType: 'keyword',
          entityId: 'amzn-keyword-202',
          sourceFile: 'D:/reports/keyword.xlsx',
          sourceRow: 18,
          identitySource: 'ads_ui',
          identityProofPath: 'D:/proof/keyword.png',
          verificationNote: 'Matched campaign, ad group, and keyword ID.',
        },
      },
    });
  });

  it('keeps controlled review disabled until the writable Ads target is complete and unambiguous', () => {
    const row = recommendation('needs_review', {
      entityId: 'synthetic-keyword-row',
      evidence: {
        ...recommendation().evidence,
        quantReviewRequired: true,
      },
    });
    const base = {
      row,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
      currentBatchId: 'batch-20260714',
      allowedSourceFiles: ['D:/reports/keyword.xlsx'],
      form: {
        reviewedBy: 'Alice',
        rationale: 'Current Ads row verified.',
        entityType: 'keyword' as const,
        entityId: 'amzn-keyword-202',
        sourceFile: 'D:/reports/keyword.xlsx',
        sourceRow: '18',
        identitySource: 'ads_ui' as const,
        identityProofPath: 'D:/proof/keyword.png',
        verificationNote: 'Matched campaign, ad group, and keyword ID.',
      },
    };

    expect(decisionsReviewBlockers(base)).toEqual([]);
    expect(decisionsReviewBlockers({
      ...base,
      form: { ...base.form, entityId: 'synthetic-keyword-row' },
    })).toContain('可写对象 ID 仍是建议生成用的合成标识，无法唯一定位 Ads 对象');
    expect(decisionsReviewBlockers({
      ...base,
      form: { ...base.form, sourceFile: 'D:/reports/user_search_term.xlsx' },
    })).toContain('可写对象来源文件不属于当前锁定批次');
    expect(decisionsReviewBlockers({
      ...base,
      form: { ...base.form, identityProofPath: '' },
    })).toContain('缺少 Ads 身份核验证据路径');
  });

  it('keeps controlled review disabled when the recommendation evidence itself is outside the locked batch', () => {
    const row = recommendation('needs_review', {
      entityId: 'synthetic-keyword-row',
      evidence: {
        ...recommendation().evidence,
        sourceFiles: ['D:/forged/keyword.xlsx'],
        quantReviewRequired: true,
      },
    });

    expect(decisionsReviewBlockers({
      row,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
      currentBatchId: 'batch-20260714',
      allowedSourceFiles: ['D:/reports/keyword.xlsx'],
      form: {
        reviewedBy: 'Alice',
        rationale: 'Verified.',
        entityType: 'keyword',
        entityId: 'amzn-keyword-202',
        sourceFile: 'D:/reports/keyword.xlsx',
        sourceRow: '18',
        identitySource: 'ads_ui',
        identityProofPath: 'D:/proof/keyword.png',
        verificationNote: 'Matched current Ads row.',
      },
    })).toContain('建议来源证据不属于当前锁定批次');
  });

  it('requires the mixed preview pending row to verify its Ads target before approval', async () => {
    const api = createBrowserPreviewElectronApi('SHC001', 'mixed-recommendations');
    const [pending] = await api.getRecommendations({
      dateFrom: '2026-05-21',
      dateTo: '2026-06-23',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0GTTJFQTM',
      batchId: 'batch_preview_20260625',
      status: 'pending',
    });
    const pipeline = await api.getBusinessUiDataPipeline();

    expect(decisionEligibilitySummary(pending, {
      scope: { storeName: 'FT-US-US', marketplaceCode: 'US' },
      currentBatchId: pending.evidence?.batchId,
      allowedSourceFiles: pipeline.collection.realReportFiles.map((file: { artifactDisplayName: string }) => file.artifactDisplayName),
      stale: false,
    })).toMatchObject({
      label: '先核验 Ads 对象',
      canApprove: false,
      canReject: true,
    });
  });

  it('allows an evidence-complete pending row to be approved or rejected', () => {
    expect(decisionEligibilitySummary(recommendation('pending'), eligibilityContext)).toMatchObject({
      label: '可以批准',
      canApprove: true,
      canReject: true,
      readOnly: false,
      blockers: [],
    });
  });

  it('uses the shared approval policy blockers for renderer eligibility', () => {
    const row = recommendation('pending', {
      currentValue: '0.88',
      recommendedValue: '1.02',
      evidence: {
        ...recommendation().evidence,
        decisionAgreement: 'conflict',
        decisionRequiresReview: true,
      },
    });
    const sharedBlockers = decisionsSharedApprovalPolicyBlockers(row, eligibilityContext);
    const eligibility = decisionEligibilitySummary(row, eligibilityContext);

    expect(sharedBlockers).toEqual(expect.arrayContaining([
      '降价动作的建议出价必须低于当前出价',
      'AI/规则冲突',
      'AI/规则合并标记需复核',
    ]));
    expect(eligibility.blockers).toEqual(expect.arrayContaining(sharedBlockers));
    expect(eligibility.canApprove).toBe(false);
  });

  it('never offers approval for needs_review while preserving a reject path', () => {
    expect(decisionEligibilitySummary(recommendation('needs_review'), eligibilityContext)).toMatchObject({
      label: '需要人工复核',
      canApprove: false,
      canReject: true,
      readOnly: false,
    });
  });

  it.each(['approved', 'rejected'] as const)('keeps %s strictly read-only', (status) => {
    expect(decisionEligibilitySummary(recommendation(status), eligibilityContext)).toMatchObject({
      label: status === 'approved' ? '已批准' : '已拒绝',
      canApprove: false,
      canReject: false,
      readOnly: true,
      detail: expect.stringContaining('批准不等于执行'),
    });
  });

  it('fails closed when previously loaded data is stale', () => {
    expect(decisionEligibilitySummary(recommendation('pending'), {
      ...eligibilityContext,
      stale: true,
    })).toMatchObject({
      label: '数据已过期',
      canApprove: false,
      canReject: false,
      readOnly: false,
    });
  });

  it('fails closed while a newer authoritative read is in flight', () => {
    expect(decisionEligibilitySummary(recommendation('pending'), {
      ...eligibilityContext,
      locked: true,
    })).toMatchObject({
      label: '正在确认权威状态',
      canApprove: false,
      canReject: false,
      readOnly: false,
    });
  });

  it('uses the canonical approval payload and carries expectedRevision', () => {
    const row = recommendation('pending');
    const request = buildDecisionsDecisionRequest({
      decision: 'approved',
      approverName: 'Alice',
      approvalNote: '已核对真实报表。',
      currentBatchId: 'batch-20260714',
      row,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
    });

    expect(request.id).toBe(101);
    expect(request.expectedRevision).toBe(7);
    expect(request.decision).toMatchObject({
      decision: 'approved',
      approvedBy: 'Alice',
      note: '已核对真实报表。',
      recommendationId: 101,
      sourceRow: 18,
    });
  });
});
