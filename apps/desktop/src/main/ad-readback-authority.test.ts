import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import {
  assertCurrentAdReadbackEvidenceAuthority,
  buildAuthorizedAdReadbackEvidenceInput,
  type AdReadbackAuthorityScope,
  type ExportAuthorizedAdReadbackEvidenceRequest,
} from './ad-readback-authority';

const scope: AdReadbackAuthorityScope = {
  dateFrom: '2026-06-01',
  dateTo: '2026-06-12',
  storeName: 'FT-US-US',
  marketplaceCode: 'US',
  asin: 'B0TESTASIN',
  batchId: 'batch_1',
};

const sourceAuthority = {
  reportType: 'keyword',
  entityName: 'tight match target',
  campaignName: 'SP exact',
  adGroupName: 'Main',
  metricDate: '2026-06-12',
  sourceFile: 'C:/reports/keyword.xlsx',
  sourceRow: 12,
};

function approvedRecommendation(overrides: Partial<ActionRecommendation> = {}): ActionRecommendation {
  return {
    id: 101,
    taskId: 'task_1',
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin!,
    msku: 'MSKU-1',
    entityType: 'target',
    entityId: 'target_1',
    entityName: 'tight match target',
    actionType: 'lower_bid',
    currentValue: '1.20',
    recommendedValue: '1.08',
    reason: 'High ACOS with bounded bid reduction.',
    evidence: {
      impressions: 1000,
      clicks: 30,
      cost: 40,
      orders: 1,
      sales: 60,
      acos: 0.67,
      cpc: 1.33,
      cvr: 0.03,
      date: '2026-06-12',
      portfolioName: 'D6 Portfolio',
      campaignName: 'SP exact',
      adGroupName: 'Main',
      targeting: 'tight match target',
      batchId: scope.batchId,
      reportType: 'keyword',
      sourceFile: 'C:/reports/keyword.xlsx',
      sourceFiles: ['C:/reports/keyword.xlsx'],
      sourceRow: 12,
      writableTarget: {
        entityType: 'keyword',
        entityId: 'keyword-123',
        entityName: 'tight match target',
        campaignName: 'SP exact',
        adGroupName: 'Main',
        metricDate: '2026-06-12',
        sourceFile: 'C:/reports/keyword.xlsx',
        sourceRow: 12,
        identitySource: 'ads_ui',
        verifiedBy: 'Alice',
        verifiedAt: '2026-06-12T09:55:00.000Z',
        verificationNote: 'Matched the editable keyword row before approval.',
        identityProofPath: 'C:/evidence/writable-keyword.png',
      },
      explanationSource: 'ai',
      aiModel: 'deepseek-chat',
      decisionAgreement: 'aligned',
      decisionSource: 'rule_ai',
      decisionReasons: ['Current batch supports a bounded bid reduction.'],
      approvalDecision: {
        decision: 'approved',
        approvedBy: 'Alice',
        decidedAt: '2026-06-12T10:00:00.000Z',
        note: 'Approved for one manual Ads UI action.',
        batchId: scope.batchId,
        sourceBatchId: scope.batchId,
        metricDate: '2026-06-12',
        sourceRow: 12,
        sourceFiles: ['C:/reports/keyword.xlsx'],
        scope: {
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
        },
      },
    },
    confidence: 0.8,
    riskLevel: 'APPROVAL',
    status: 'approved',
    revision: 4,
    updatedAt: '2026-06-12T10:00:01.000Z',
    ...overrides,
  };
}

function request(overrides: Partial<ExportAuthorizedAdReadbackEvidenceRequest> = {}): ExportAuthorizedAdReadbackEvidenceRequest {
  return {
    recommendationId: 101,
    expectedRevision: 4,
    scope,
    operatorEvidence: {
      approval: {
        operatorConfirmed: true,
        realWriteApproved: true,
        approvalArtifactPath: 'C:/evidence/approval.png',
      },
      risk: { allowedByPolicy: true },
      before: {
        value: '1.20',
        capturedAt: '2026-06-12T10:03:00.000Z',
        screenshotPath: 'C:/evidence/before.png',
        liveBidSourceNote: 'Ads UI row reloaded.',
      },
      after: {
        value: '1.08',
        capturedAt: '2026-06-12T10:06:00.000Z',
        screenshotPath: 'C:/evidence/after.png',
      },
      readback: {
        verified: true,
        method: 'Ads UI reload',
        readAt: '2026-06-12T10:10:00.000Z',
        actualValue: '1.08',
        evidencePath: 'C:/evidence/readback.png',
      },
      execution: {
        success: true,
        verified: true,
        executionId: 'manual-smoke-001',
        executedAt: '2026-06-12T10:05:00.000Z',
        executedBy: 'QA Operator',
      },
    },
    ...overrides,
  };
}

function build(input = request(), recommendation = approvedRecommendation()) {
  return buildAuthorizedAdReadbackEvidenceInput({
    request: input,
    recommendation,
    resolvedScope: scope,
    allowedSourceFiles: ['C:/reports/keyword.xlsx'],
    sourceAuthority,
  });
}

describe('ad readback export authority', () => {
  it('derives target, source, approval identity, and risk rationale from the approved database row', () => {
    const result = build();

    expect(result.target).toMatchObject({
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      portfolioName: 'D6 Portfolio',
      campaignName: 'SP exact',
      adGroupName: 'Main',
      entityType: 'keyword',
      entityId: 'keyword-123',
      entityName: 'tight match target',
      identityProofPath: 'C:/evidence/writable-keyword.png',
      actionType: 'lower_bid',
    });
    expect(result.source).toMatchObject({
      recommendationId: '101',
      batchId: scope.batchId,
      sourceRow: 12,
      sourceFiles: ['C:/reports/keyword.xlsx'],
      currentValue: '1.20',
      recommendedValue: '1.08',
      aiModel: 'deepseek-chat',
    });
    expect(result.approval).toMatchObject({
      approverName: 'Alice',
      confirmedAt: '2026-06-12T10:00:00.000Z',
      note: 'Approved for one manual Ads UI action.',
      approvalArtifactPath: 'C:/evidence/approval.png',
    });
    expect(result.risk).toEqual({
      allowedByPolicy: true,
      rationale: 'High ACOS with bounded bid reduction.',
    });
    expect(result.authority?.checkedAt).toBe('2026-06-12T10:00:01.000Z');
  });

  it.each([
    ['missing', undefined],
    ['invalid', 'not-a-timestamp'],
  ])('rejects %s database update time because checkedAt cannot be reconstructed', (_label, updatedAt) => {
    expect(() => build(request(), approvedRecommendation({ updatedAt }))).toThrow(/更新时间.*无效/);
  });

  it('treats SQLite datetime values as UTC instead of the host machine timezone', () => {
    const result = build(request(), approvedRecommendation({ updatedAt: '2026-06-12 10:00:01' }));

    expect(result.authority?.checkedAt).toBe('2026-06-12T10:00:01.000Z');
  });

  it.each([
    ['missing recommendation id', request({ recommendationId: 0 }), /缺少有效 recommendationId/],
    ['missing revision', request({ expectedRevision: -1 }), /缺少有效建议版本/],
    ['stale revision', request({ expectedRevision: 3 }), /建议版本已变化/],
    ['non-approved row', request(), /当前状态 pending.*不能导出/, approvedRecommendation({ status: 'pending' })],
  ] as const)('rejects %s', (_label, input, expected, recommendation = approvedRecommendation()) => {
    expect(() => build(input, recommendation)).toThrow(expected);
  });

  it.each([
    ['store', { ...scope, storeName: 'OTHER-US' }],
    ['marketplace', { ...scope, marketplaceCode: 'CA' }],
    ['asin', { ...scope, asin: 'B0OTHERASIN' }],
    ['batch', { ...scope, batchId: 'batch_2' }],
    ['date range', { ...scope, dateFrom: '2026-05-01' }],
  ])('fails closed on a %s authority mismatch', (_label, requestedScope) => {
    expect(() => build(request({ scope: requestedScope }))).toThrow(/当前运行范围不一致/);
  });

  it('rejects a recommendation whose approval snapshot does not bind the same batch and scope', () => {
    const recommendation = approvedRecommendation();
    recommendation.evidence.approvalDecision = {
      ...recommendation.evidence.approvalDecision,
      sourceBatchId: 'stale_batch',
    };

    expect(() => build(request(), recommendation)).toThrow(/批准记录.*批次或范围不一致/);
  });

  it('rejects stale or foreign source files even when the renderer submits otherwise complete evidence', () => {
    expect(() => buildAuthorizedAdReadbackEvidenceInput({
      request: request(),
      recommendation: approvedRecommendation(),
      resolvedScope: scope,
      allowedSourceFiles: ['C:/reports/current-campaign.xlsx'],
      sourceAuthority,
    })).toThrow(/来源文件不属于当前数据批次/);
  });

  it('rejects an approved recommendation without a verified writable Ads target', () => {
    const recommendation = approvedRecommendation();
    delete recommendation.evidence.writableTarget;

    expect(() => build(request(), recommendation)).toThrow(/可写对象/);
  });

  it('rejects a writable row for another object even inside the same campaign and ad group', () => {
    const recommendation = approvedRecommendation();
    recommendation.evidence.writableTarget = {
      ...recommendation.evidence.writableTarget!,
      entityName: 'another target',
    };

    expect(() => build(request(), recommendation)).toThrow(/Ads 可写对象不属于当前建议.*名称/);
  });

  it('rejects an approved quant-review recommendation without the review resolution that authorized approval', () => {
    const recommendation = approvedRecommendation();
    recommendation.evidence.quantReviewRequired = true;

    expect(() => build(request(), recommendation)).toThrow(/复核记录/);
  });

  it('accepts an approved quant-review recommendation only when the prior pending revision carries a matching resolution', () => {
    const recommendation = approvedRecommendation();
    recommendation.evidence.quantReviewRequired = true;
    recommendation.evidence.reviewResolution = {
      schemaVersion: 1,
      fromStatus: 'needs_review',
      fromRevision: 2,
      resolvedRevision: 3,
      reviewedBy: 'Review Owner',
      reviewedAt: '2026-06-12T09:57:00.000Z',
      rationale: 'Confirmed one bounded keyword bid decrease against the current Ads target.',
      resolvedBlockers: ['quant_review_required'],
      scope: { ...scope, asin: scope.asin! },
      metricSource: {
        batchId: scope.batchId,
        sourceFiles: ['C:/reports/keyword.xlsx'],
        sourceRow: 12,
      },
      writableTarget: { ...recommendation.evidence.writableTarget! },
    };

    expect(() => build(request(), recommendation)).not.toThrow();

    recommendation.evidence.reviewResolution.writableTarget.identityProofPath = 'C:/evidence/forged-proof.png';
    expect(() => build(request(), recommendation)).toThrow(/复核记录/);
  });

  it.each([
    ['read-only search term type', { entityType: 'search_term' }],
    ['missing entity id', { entityId: '' }],
    ['synthetic recommendation id', { entityId: 'target_1' }],
    ['invalid source row', { sourceRow: 0 }],
    ['foreign source file', { sourceFile: 'C:/reports/foreign.xlsx' }],
    ['missing identity proof', { identityProofPath: '' }],
    ['missing identity source', { identitySource: '' }],
  ])('rejects a writable target with %s', (_label, writableTargetOverride) => {
    const recommendation = approvedRecommendation();
    recommendation.evidence.writableTarget = {
      ...recommendation.evidence.writableTarget!,
      ...writableTargetOverride,
    } as typeof recommendation.evidence.writableTarget;

    expect(() => build(request(), recommendation)).toThrow(/可写对象/);
  });

  it('keeps the first real readback contract limited to a bounded bid reduction', () => {
    expect(() => build(request(), approvedRecommendation({
      actionType: 'raise_bid',
      recommendedValue: '1.40',
    }))).toThrow(/仅允许.*降低竞价/);
  });

  it('wires Main export through the authority binder before the evidence builder', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const handler = source.slice(
      source.indexOf('function handleExportAdReadbackEvidence'),
      source.indexOf('function handlePrepareAdReadbackSession'),
    );

    expect(handler).toContain('buildAuthorizedAdReadbackEvidenceInput({');
    expect(handler).toContain('assertRecommendationWritableTargetCurrent(');
    expect(handler).toContain('sourceAuthority,');
    expect(handler).toContain('state.recommendationRepo?.findById');
    expect(handler).toContain('getBusinessRecommendationGate');
    expect(handler.indexOf('buildAuthorizedAdReadbackEvidenceInput({')).toBeLessThan(handler.indexOf('buildAdReadbackEvidence('));
  });

  it('keeps raw gate failures in local logs and returns a stable operator-facing export error', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const handler = source.slice(
      source.indexOf('function handleExportAdReadbackEvidence'),
      source.indexOf('function handlePrepareAdReadbackSession'),
    );

    expect(handler).toContain("stage: 'export-gate'");
    expect(handler).toContain(
      "throw new Error('结果核对被阻断：当前范围无法绑定真实报表批次，请刷新范围后重试。')",
    );
    expect(handler).not.toContain('当前范围无法绑定真实报表批次。${detail}');
  });

  it('revalidates database authority before final readiness can accept readback evidence', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const helper = source.slice(
      source.indexOf('function validateCurrentAdReadbackEvidenceAuthority'),
      source.indexOf('function handleRefreshFinalReadiness'),
    );
    const handler = source.slice(
      source.indexOf('function handleRefreshFinalReadiness'),
      source.indexOf('function recordAdActionReasonAiCallLog'),
    );

    expect(helper).toContain('assertCurrentAdReadbackEvidenceAuthority({');
    expect(helper).toContain('assertRecommendationWritableTargetCurrent(');
    expect(helper).toContain("stage: 'verify' | 'final-readiness'");
    expect(handler).toContain('validateAdReadbackAuthority:');
    expect(handler).toContain("validateCurrentAdReadbackEvidenceAuthority(evidencePath, 'final-readiness')");
  });

  it('revalidates a structurally valid evidence file against the current approved row', () => {
    const evidence = build();

    expect(() => assertCurrentAdReadbackEvidenceAuthority({
      evidence,
      recommendation: approvedRecommendation(),
      resolvedScope: scope,
      allowedSourceFiles: ['C:/reports/keyword.xlsx'],
      sourceAuthority,
    })).not.toThrow();
  });

  it('rejects a previously exported file after the database revision or status changes', () => {
    const evidence = build();

    expect(() => assertCurrentAdReadbackEvidenceAuthority({
      evidence,
      recommendation: approvedRecommendation({ revision: 5 }),
      resolvedScope: scope,
      allowedSourceFiles: ['C:/reports/keyword.xlsx'],
      sourceAuthority,
    })).toThrow(/建议版本已变化/);
    expect(() => assertCurrentAdReadbackEvidenceAuthority({
      evidence,
      recommendation: approvedRecommendation({ status: 'executed' }),
      resolvedScope: scope,
      allowedSourceFiles: ['C:/reports/keyword.xlsx'],
      sourceAuthority,
    })).toThrow(/当前状态 executed/);
  });

  it('rejects target or source tampering even when the file is otherwise structurally complete', () => {
    const evidence = build();
    evidence.target = { ...evidence.target, asin: 'B0FORGEDASIN' };

    expect(() => assertCurrentAdReadbackEvidenceAuthority({
      evidence,
      recommendation: approvedRecommendation(),
      resolvedScope: scope,
      allowedSourceFiles: ['C:/reports/keyword.xlsx'],
      sourceAuthority,
    })).toThrow(/权威字段已被修改/);
  });

  it('rejects checkedAt tampering even when the replacement is another valid ISO timestamp', () => {
    const evidence = build();
    const authority = evidence.authority!;
    evidence.authority = {
      ...authority,
      checkedAt: '2026-06-12T10:00:02.000Z',
    };

    expect(() => assertCurrentAdReadbackEvidenceAuthority({
      evidence,
      recommendation: approvedRecommendation(),
      resolvedScope: scope,
      allowedSourceFiles: ['C:/reports/keyword.xlsx'],
      sourceAuthority,
    })).toThrow(/权威字段已被修改/);
  });
});
