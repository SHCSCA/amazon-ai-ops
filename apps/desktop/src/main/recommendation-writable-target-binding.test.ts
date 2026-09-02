import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type {
  ActionRecommendation,
  BindRecommendationWritableTargetRequest,
  WritableAdTargetEvidence,
} from '@amazon-ai-ops/shared-types';
import { bindRecommendationWritableTarget } from './recommendation-writable-target-binding';

const sourceFile = 'D:/reports/keyword.xlsx';
const scope = {
  dateFrom: '2026-05-21',
  dateTo: '2026-06-23',
  storeName: 'FT-US-US',
  marketplaceCode: 'US',
  asin: 'B0TESTASIN',
  batchId: 'batch_current',
};

function recommendation(overrides: Partial<ActionRecommendation> = {}): ActionRecommendation {
  return {
    id: 81,
    taskId: 'task_81',
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    msku: 'MSKU-81',
    entityType: 'target',
    entityId: 'synthetic-target-81',
    entityName: 'door lock',
    actionType: 'lower_bid',
    currentValue: '1.49',
    recommendedValue: '1.00',
    reason: 'ACOS above target.',
    evidence: {
      impressions: 1000,
      clicks: 30,
      cost: 40,
      orders: 2,
      sales: 70,
      acos: 0.57,
      cpc: 1.33,
      cvr: 0.06,
      date: '2026-06-23',
      asin: scope.asin,
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      targeting: 'door lock',
      batchId: scope.batchId,
      reportType: 'keyword',
      sourceFile,
      sourceFiles: [sourceFile],
      sourceRow: 611,
      decisionAgreement: 'aligned',
      decisionRequiresReview: false,
      quantReviewRequired: false,
    },
    confidence: 0.88,
    riskLevel: 'APPROVAL',
    status: 'pending',
    revision: 4,
    ...overrides,
  };
}

function request(): BindRecommendationWritableTargetRequest {
  return {
    recommendationId: 81,
    expectedRevision: 4,
    scope,
    binding: {
      boundBy: 'Alice',
      note: 'Matched campaign, ad group, and keyword ID in authenticated Ads UI.',
      writableTarget: {
        entityType: 'keyword',
        entityId: 'amzn-keyword-opaque-81',
        sourceFile,
        sourceRow: 611,
        identitySource: 'ads_ui',
        identityProofPath: 'D:/proof/keyword-81.png',
        verificationNote: 'Matched the current editable keyword row.',
      },
    },
  };
}

const canonicalTarget: WritableAdTargetEvidence = {
  entityType: 'keyword',
  entityId: 'amzn-keyword-opaque-81',
  entityName: 'door lock',
  campaignName: 'Campaign A',
  adGroupName: 'Ad Group A',
  metricDate: '2026-06-23',
  sourceFile,
  sourceRow: 611,
  identitySource: 'ads_ui',
  verifiedBy: 'Alice',
  verifiedAt: '2026-07-16T04:30:00.000Z',
  verificationNote: 'Matched the current editable keyword row.',
  identityProofPath: 'D:/proof/keyword-81.png',
};

const sourceAuthority = {
  reportType: 'keyword',
  entityName: 'door lock',
  campaignName: 'Campaign A',
  adGroupName: 'Ad Group A',
  metricDate: '2026-06-23',
  sourceFile,
  sourceRow: 611,
};

describe('pending recommendation writable target binding', () => {
  it('atomically binds one verified Ads target while keeping the recommendation pending', () => {
    const persist = vi.fn(() => true);

    const result = bindRecommendationWritableTarget({
      recommendation: recommendation(),
      request: request(),
      allowedSourceFiles: [sourceFile],
      sourceAuthority,
      boundAt: '2026-07-16T04:30:00.000Z',
      resolveWritableTarget: () => canonicalTarget,
      persist,
    });

    expect(result).toEqual({
      ok: true,
      recommendationId: 81,
      status: 'bound',
      revision: 5,
      boundAt: '2026-07-16T04:30:00.000Z',
    });
    expect(result.status).not.toBe('pending');
    expect(persist).toHaveBeenCalledWith({
      writableTarget: canonicalTarget,
      writableTargetBinding: {
        schemaVersion: 1,
        fromRevision: 4,
        boundRevision: 5,
        boundBy: 'Alice',
        boundAt: '2026-07-16T04:30:00.000Z',
        note: 'Matched campaign, ad group, and keyword ID in authenticated Ads UI.',
        scope,
        metricSource: {
          batchId: 'batch_current',
          sourceFiles: [sourceFile],
          sourceRow: 611,
        },
        writableTarget: canonicalTarget,
      },
    });
  });

  it('wires the production IPC through current scope authority and the dedicated pending CAS', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const start = source.indexOf('function handleBindRecommendationWritableTarget');
    const end = source.indexOf('function handleResolveRecommendationReview');
    const handler = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(handler).toContain('bindRecommendationWritableTarget({');
    expect(handler).toContain("getBusinessRecommendationGate({ ...request.scope, storeContext: context }, 'approval')");
    expect(handler).toContain('findByIdForStore(context.storeId, request.recommendationId)');
    expect(handler).toContain('storeId: context.storeId');
    expect(handler).toContain('assertRecommendationMetricSourceAuthority(state.db');
    expect(handler).toContain('resolveWritableAdTargetAuthority(state.db!');
    expect(handler).toContain('bindWritableTargetIfCurrentForStore(');
    expect(handler).not.toContain('.bindWritableTargetIfCurrent(');
    expect(source).toContain("registerTrackedIpcHandler('recommendations:bind-writable-target'");
  });

  it('never overwrites an existing writable target even when its binding audit is absent', () => {
    const persist = vi.fn(() => true);
    const existingTarget = { ...canonicalTarget, entityId: 'existing-opaque-id' };

    expect(() => bindRecommendationWritableTarget({
      recommendation: recommendation({
        evidence: {
          ...recommendation().evidence,
          writableTarget: existingTarget,
        },
      }),
      request: request(),
      allowedSourceFiles: [sourceFile],
      sourceAuthority,
      boundAt: '2026-07-16T04:30:00.000Z',
      resolveWritableTarget: () => canonicalTarget,
      persist,
    })).toThrow(/已经存在 Ads 可写对象|不能覆盖/);
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects a real same-batch Ads row that belongs to another campaign or ad group', () => {
    const persist = vi.fn(() => true);

    expect(() => bindRecommendationWritableTarget({
      recommendation: recommendation(),
      request: request(),
      allowedSourceFiles: [sourceFile],
      sourceAuthority,
      boundAt: '2026-07-16T04:30:00.000Z',
      resolveWritableTarget: () => ({
        ...canonicalTarget,
        campaignName: 'Campaign B',
        adGroupName: 'Ad Group B',
      }),
      persist,
    })).toThrow('核验到的 Ads 对象不属于当前建议的 campaign / ad group');
    expect(persist).not.toHaveBeenCalled();
  });
});
