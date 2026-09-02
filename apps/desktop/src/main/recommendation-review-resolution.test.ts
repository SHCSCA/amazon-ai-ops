import type {
  ActionRecommendation,
  ResolveRecommendationReviewRequest,
  WritableAdTargetEvidence,
} from '@amazon-ai-ops/shared-types';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { resolveRecommendationReview } from './recommendation-review-resolution';
import { getRecommendationApprovalBlockers } from './recommendation-approval-policy';

const sourceFile = 'C:/reports/keyword.xlsx';
const scope = {
  dateFrom: '2026-05-21',
  dateTo: '2026-06-23',
  storeName: 'FT-US-US',
  marketplaceCode: 'US',
  asin: 'B0TESTASIN',
  batchId: 'batch_current',
};

const writableTarget: WritableAdTargetEvidence = {
  entityType: 'keyword',
  entityId: 'amzn-keyword-opaque-123',
  entityName: 'door lock',
  campaignName: 'Campaign A',
  adGroupName: 'Ad Group A',
  metricDate: '2026-06-23',
  sourceFile,
  sourceRow: 611,
  identitySource: 'ads_ui',
  verifiedBy: 'Alice',
  verifiedAt: '2026-07-16T03:00:00.000Z',
  verificationNote: 'Matched the current editable keyword row.',
  identityProofPath: 'C:/evidence/keyword-identity.png',
};

function recommendation(overrides: Partial<ActionRecommendation> = {}): ActionRecommendation {
  return {
    id: 8,
    taskId: 'task_8',
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    msku: 'MSKU-8',
    entityType: 'search_term',
    entityId: 'Campaign A_Ad Group A_door lock',
    entityName: 'door lock',
    actionType: 'lower_bid',
    currentValue: '1.49',
    recommendedValue: '1.00',
    reason: 'Bounded bid reduction.',
    evidence: {
      impressions: 1000,
      clicks: 30,
      cost: 40,
      orders: 1,
      sales: 60,
      acos: 0.67,
      cpc: 1.33,
      cvr: 0.03,
      date: '2026-06-23',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      searchTerm: 'door lock',
      batchId: scope.batchId,
      reportType: 'keyword',
      sourceFile,
      sourceFiles: [sourceFile],
      sourceRow: 611,
      decisionAgreement: 'aligned',
      decisionSource: 'rule_ai',
      quantReviewRequired: true,
    },
    confidence: 0.8,
    riskLevel: 'APPROVAL',
    status: 'needs_review',
    revision: 0,
    ...overrides,
  };
}

function request(overrides: Partial<ResolveRecommendationReviewRequest> = {}): ResolveRecommendationReviewRequest {
  return {
    recommendationId: 8,
    expectedRevision: 0,
    scope,
    review: {
      reviewedBy: 'Alice',
      rationale: 'Quant review completed against the current editable keyword row.',
      writableTarget: {
        entityType: 'keyword',
        entityId: 'amzn-keyword-opaque-123',
        sourceFile,
        sourceRow: 611,
        identitySource: 'ads_ui',
        identityProofPath: 'C:/evidence/keyword-identity.png',
        verificationNote: 'Matched the current editable keyword row.',
      },
    },
    ...overrides,
  };
}

const sourceAuthority = {
  reportType: 'keyword',
  entityName: 'door lock',
  campaignName: 'Campaign A',
  adGroupName: 'Ad Group A',
  metricDate: '2026-06-23',
  sourceFile,
  sourceRow: 611,
};

describe('recommendation review resolution', () => {
  it('moves one current quant-review lower_bid back to pending with immutable audit evidence', () => {
    const persist = vi.fn(() => true);
    const result = resolveRecommendationReview({
      recommendation: recommendation(),
      request: request(),
      allowedSourceFiles: [sourceFile],
      sourceAuthority,
      reviewedAt: '2026-07-16T03:00:00.000Z',
      resolveWritableTarget: () => writableTarget,
      persist,
    });

    expect(result).toMatchObject({
      ok: true,
      recommendationId: 8,
      previousStatus: 'needs_review',
      status: 'pending',
      revision: 1,
      resolvedBlockers: ['quant_review_required'],
    });
    expect(persist).toHaveBeenCalledWith('pending', expect.objectContaining({
      writableTarget,
      reviewResolution: expect.objectContaining({
        schemaVersion: 1,
        fromStatus: 'needs_review',
        fromRevision: 0,
        resolvedRevision: 1,
        reviewedBy: 'Alice',
        resolvedBlockers: ['quant_review_required'],
      }),
    }));
  });

  it.each([
    ['stale revision', request({ expectedRevision: 1 }), recommendation()],
    ['wrong status', request(), recommendation({ status: 'pending' })],
    ['scope mismatch', request({ scope: { ...scope, batchId: 'batch_other' } }), recommendation()],
    ['AI conflict', request(), recommendation({ evidence: { ...recommendation().evidence, decisionAgreement: 'conflict' } })],
    ['forbidden risk', request(), recommendation({ riskLevel: 'FORBIDDEN' })],
  ])('rejects %s without persistence', (_label, reviewRequest, row) => {
    const persist = vi.fn(() => true);
    expect(() => resolveRecommendationReview({
      recommendation: row,
      request: reviewRequest,
      allowedSourceFiles: [sourceFile],
      sourceAuthority,
      reviewedAt: '2026-07-16T03:00:00.000Z',
      resolveWritableTarget: () => writableTarget,
      persist,
    })).toThrow(/复核被阻断|状态冲突/);
    expect(persist).not.toHaveBeenCalled();
  });

  it.each([
    ['another campaign', { campaignName: 'Campaign B' }],
    ['another ad group', { adGroupName: 'Ad Group B' }],
    ['another object name', { entityName: 'another target' }],
    ['another writable entity type', { entityType: 'product_targeting' }],
  ] as const)('rejects a canonical target belonging to %s without persistence', (_label, targetOverride) => {
    const persist = vi.fn(() => true);
    expect(() => resolveRecommendationReview({
      recommendation: recommendation(),
      request: request(),
      allowedSourceFiles: [sourceFile],
      sourceAuthority,
      reviewedAt: '2026-07-16T03:00:00.000Z',
      resolveWritableTarget: () => ({
        ...writableTarget,
        ...targetOverride,
      } as WritableAdTargetEvidence),
      persist,
    })).toThrow(/当前建议|对象名称|对象类型/);
    expect(persist).not.toHaveBeenCalled();
  });

  it('fails on a CAS race instead of reporting review success', () => {
    expect(() => resolveRecommendationReview({
      recommendation: recommendation(),
      request: request(),
      allowedSourceFiles: [sourceFile],
      sourceAuthority,
      reviewedAt: '2026-07-16T03:00:00.000Z',
      resolveWritableTarget: () => writableTarget,
      persist: () => false,
    })).toThrow(/状态冲突/);
  });

  it('lets the reviewed pending revision pass the former quant blocker but not ordinary approval itself', () => {
    const base = recommendation();
    let evidencePatch: Record<string, unknown> = {};
    resolveRecommendationReview({
      recommendation: base,
      request: request(),
      allowedSourceFiles: [sourceFile],
      sourceAuthority,
      reviewedAt: '2026-07-16T03:00:00.000Z',
      resolveWritableTarget: () => writableTarget,
      persist: (_status, patch) => {
        evidencePatch = patch;
        return true;
      },
    });
    const reviewed = recommendation({
      status: 'pending',
      revision: 1,
      evidence: { ...base.evidence, ...evidencePatch },
    });

    expect(getRecommendationApprovalBlockers(reviewed, { allowedSourceFiles: [sourceFile], sourceAuthority }))
      .not.toContain('规则量化要求人工复核');
  });

  it('wires the Main handler through current scope, writable target authority, and CAS persistence', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const handler = source.slice(
      source.indexOf('function handleResolveRecommendationReview'),
      source.indexOf('async function handleApproveRecommendation'),
    );
    expect(handler).toContain('resolveLockedRecommendationBatchScope');
    expect(handler).not.toContain("getBusinessRecommendationGate({ ...request.scope, storeContext: context }, 'approval')");
    expect(handler).toContain('findByIdForStore(context.storeId, request.recommendationId)');
    expect(handler).toContain('storeId: context.storeId');
    expect(handler).toContain('assertRecommendationMetricSourceAuthority(state.db');
    expect(handler).toContain('resolveWritableAdTargetAuthority(');
    expect(handler).toContain('resolveRecommendationReview({');
    expect(handler).toContain('updateStatusWithEvidenceIfCurrentForStore(');
    expect(handler).not.toContain('.updateStatusWithEvidenceIfCurrent(');
    expect(source).toContain("registerTrackedIpcHandler('recommendations:resolve-review'");
  });
});
