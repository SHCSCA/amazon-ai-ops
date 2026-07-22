import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import { getRecommendationApprovalBlockers } from '../main/recommendation-approval-policy';
import * as PreviewModule from './dev-preview-api';
import * as DeliveryPageModule from './pages/delivery-page';

const EXPECTED_SCENARIOS = [
  'missing-scope',
  'missing-reports',
  'pending-import',
  'diagnosis-ready',
  'mixed-recommendations',
  'missing-readback-evidence',
  'delivery-ready',
] as const;

type PreviewScenarioId = (typeof EXPECTED_SCENARIOS)[number];

const PREVIEW_RECOMMENDATION_FILTER = {
  dateFrom: '2026-05-21',
  dateTo: '2026-06-23',
  storeName: 'FT-US-US',
  marketplaceCode: 'US',
  asin: 'B0GTTJFQTM',
  batchId: 'batch_preview_20260625',
} as const;

function getPreviewRecommendations(
  api: any,
  filter: Record<string, unknown> = {},
): Promise<any[]> {
  return api.getRecommendations({
    ...PREVIEW_RECOMMENDATION_FILTER,
    ...filter,
  });
}

interface PreviewScenarioContract {
  id: PreviewScenarioId;
  scopeReady: boolean;
  reportsCollected: boolean;
  reportsImported: boolean;
  diagnosisReady: boolean;
  recommendationState: 'blocked' | 'none' | 'mixed' | 'approved';
  readbackEvidenceReady: boolean;
  deliveryReady: boolean;
}

function previewExports() {
  return PreviewModule as unknown as {
    PREVIEW_SCENARIO_IDS?: readonly PreviewScenarioId[];
    PREVIEW_SCENARIOS?: Record<PreviewScenarioId, PreviewScenarioContract>;
    resolvePreviewBootstrap?: (input: {
      dev: boolean;
      hostname: string;
      search: string;
    }) => {
      enabled: boolean;
      scenarioId?: PreviewScenarioId;
      warning?: string;
    };
    bootstrapBrowserPreview?: (input: {
      dev: boolean;
      target: {
        electronAPI?: any;
        location: { hostname: string; search: string };
      };
    }) => {
      enabled: boolean;
      scenarioId?: PreviewScenarioId;
      warning?: string;
    };
    createBrowserPreviewElectronApi?: (username: string, scenarioId?: PreviewScenarioId) => any;
  };
}

async function bindPreviewPendingTarget(api: any, pending: any) {
  return api.bindRecommendationWritableTarget({
    recommendationId: pending.id,
    expectedRevision: pending.revision,
    scope: {
      dateFrom: '2026-05-21',
      dateTo: '2026-06-23',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0GTTJFQTM',
      batchId: 'batch_preview_20260625',
    },
    binding: {
      boundBy: 'Preview Verifier',
      note: '已在 Ads UI 中确认当前关键词与真实报表行唯一对应。',
      writableTarget: {
        entityType: 'keyword',
        entityId: 'amzn-keyword-preview-1001',
        sourceFile: 'D:/preview/reports/keyword.xlsx',
        sourceRow: pending.evidence.sourceRow,
        identitySource: 'ads_ui',
        identityProofPath: 'D:/preview/evidence/keyword-1001.png',
        verificationNote: '逐项核对广告活动、广告组、关键词名称与对象 ID。',
      },
    },
  });
}

describe('development preview enablement', () => {
  it('rejects localhost preview in a production build even with an explicit query opt-in', () => {
    const resolve = previewExports().resolvePreviewBootstrap;
    expect(typeof resolve).toBe('function');

    expect(resolve!({
      dev: false,
      hostname: 'localhost',
      search: '?preview=1&scenario=delivery-ready',
    })).toMatchObject({ enabled: false });
  });

  it('rejects a development browser session without explicit preview opt-in', () => {
    const resolve = previewExports().resolvePreviewBootstrap;
    expect(typeof resolve).toBe('function');

    expect(resolve!({
      dev: true,
      hostname: 'localhost',
      search: '',
    })).toMatchObject({ enabled: false });
  });

  it('accepts explicit development preview and defaults to the non-final diagnosis-ready scenario', () => {
    const resolve = previewExports().resolvePreviewBootstrap;
    expect(typeof resolve).toBe('function');

    expect(resolve!({
      dev: true,
      hostname: '127.0.0.1',
      search: '?preview=1',
    })).toEqual({
      enabled: true,
      scenarioId: 'diagnosis-ready',
    });
  });

  it('falls back deterministically and visibly when the requested scenario is invalid', () => {
    const resolve = previewExports().resolvePreviewBootstrap;
    expect(typeof resolve).toBe('function');

    const result = resolve!({
      dev: true,
      hostname: 'localhost',
      search: '?preview=1&scenario=definitely-not-real',
    });

    expect(result).toMatchObject({
      enabled: true,
      scenarioId: 'diagnosis-ready',
    });
    expect(result.warning).toContain('definitely-not-real');
    expect(result.warning).toContain('diagnosis-ready');
  });
});

describe('preview scenario contract', () => {
  it('publishes exactly the seven named operational scenarios', () => {
    const { PREVIEW_SCENARIO_IDS, PREVIEW_SCENARIOS } = previewExports();

    expect(PREVIEW_SCENARIO_IDS).toEqual(EXPECTED_SCENARIOS);
    expect(Object.keys(PREVIEW_SCENARIOS || {})).toEqual(EXPECTED_SCENARIOS);
  });

  it('keeps every scenario coherent from scope through delivery', () => {
    const scenarios = previewExports().PREVIEW_SCENARIOS;
    expect(scenarios).toBeDefined();

    for (const id of EXPECTED_SCENARIOS) {
      const scenario = scenarios![id];
      expect(scenario.id).toBe(id);

      if (!scenario.scopeReady) {
        expect(scenario.reportsCollected).toBe(false);
      }
      if (!scenario.reportsCollected) {
        expect(scenario.reportsImported).toBe(false);
      }
      if (!scenario.reportsImported) {
        expect(scenario.diagnosisReady).toBe(false);
      }
      if (!scenario.diagnosisReady) {
        expect(scenario.recommendationState).toBe('blocked');
      }
      if (scenario.recommendationState !== 'approved') {
        expect(scenario.readbackEvidenceReady).toBe(false);
      }
      if (!scenario.readbackEvidenceReady) {
        expect(scenario.deliveryReady).toBe(false);
      }
    }
  });

  it('keeps API responses aligned with each scenario and never emits real APP_READY', async () => {
    const { PREVIEW_SCENARIOS, createBrowserPreviewElectronApi } = previewExports();
    expect(PREVIEW_SCENARIOS).toBeDefined();
    expect(typeof createBrowserPreviewElectronApi).toBe('function');

    for (const id of EXPECTED_SCENARIOS) {
      const scenario = PREVIEW_SCENARIOS![id];
      const api = createBrowserPreviewElectronApi!('SHC001', id);
      const [scope, pipeline, batchOptions, recommendations, evidenceStatus, delivery] = await Promise.all([
        api.getOperationScope(),
        api.getBusinessUiDataPipeline(),
        api.getBusinessBatchOptions(),
        getPreviewRecommendations(api),
        api.getDeliveryEvidenceStatus(),
        api.getDeliveryReadiness(),
      ]);

      expect(Boolean(scope)).toBe(scenario.scopeReady);
      expect(batchOptions).toEqual(pipeline.collection.availableBatches);
      expect(pipeline.collection.status === 'ready').toBe(scenario.reportsCollected);
      expect(pipeline.quant.hasImportedMetrics).toBe(scenario.reportsImported);
      expect(pipeline.quant.diagnostics.length > 0).toBe(scenario.diagnosisReady);
      expect(recommendations.length > 0).toBe(['mixed', 'approved'].includes(scenario.recommendationState));
      expect(recommendations.every((recommendation: { revision?: unknown }) => (
        Number.isInteger(recommendation.revision) && Number(recommendation.revision) >= 0
      ))).toBe(true);
      expect(evidenceStatus.readback.verifiedCount > 0).toBe(scenario.readbackEvidenceReady);
      expect(evidenceStatus.preview.workflowComplete).toBe(scenario.deliveryReady);
      expect(evidenceStatus.package.installerAvailable).toBe(false);
      expect(delivery.previewReady).toBe(scenario.deliveryReady);
      expect(delivery.appReady).toBe(false);
      expect(delivery.previewOnly).toBe(true);
    }
  });

  it('keeps readback-stage previews focused on readback instead of earlier AI or Listing gaps', async () => {
    const createApi = previewExports().createBrowserPreviewElectronApi!;

    for (const id of ['missing-readback-evidence', 'delivery-ready'] as const) {
      const api = createApi('SHC001', id);
      const [settings, aiRuns, evidenceStatus] = await Promise.all([
        api.getSettings(),
        api.listAiDiagnosisRuns({ limit: 5 }),
        api.getDeliveryEvidenceStatus(),
      ]);

      expect(settings).toMatchObject({
        aiKeyConfigured: true,
        aiBaseUrl: 'https://api.deepseek.com',
        aiLastTestBaseUrl: 'https://api.deepseek.com',
        aiLastTestModel: 'deepseek-v4-flash',
        aiLastTestStatus: 'available',
      });
      expect(aiRuns).toEqual([
        expect.objectContaining({
          success: true,
          diagnosis: expect.objectContaining({
            source: 'ai',
            lifecycleStageRequiresReview: false,
          }),
        }),
      ]);
      expect(evidenceStatus.listing).toMatchObject({
        readReady: true,
        draftReady: true,
        aiDraftCount: 1,
      });
      expect(evidenceStatus.package.installerAvailable).toBe(false);
    }
  });

  it('ships a 100-plus-row diagnosis-ready fixture for real scroll-owner validation', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
    const [pipeline, products, events] = await Promise.all([
      api.getBusinessUiDataPipeline(),
      api.getProducts(),
      api.listOperationEvents(),
    ]);

    expect(products.length).toBeGreaterThanOrEqual(100);
    expect(events.length).toBeGreaterThanOrEqual(100);
    expect(pipeline.quant.diagnostics.length).toBeGreaterThanOrEqual(100);
  });

  it('reports meaningful preview-only gate progress without claiming production readiness', async () => {
    const expectedPassed: Record<PreviewScenarioId, number> = {
      'missing-scope': 0,
      'missing-reports': 1,
      'pending-import': 2,
      'diagnosis-ready': 4,
      'mixed-recommendations': 5,
      'missing-readback-evidence': 5,
      'delivery-ready': 7,
    };

    for (const id of EXPECTED_SCENARIOS) {
      const readiness = await previewExports().createBrowserPreviewElectronApi!('SHC001', id).getDeliveryReadiness();

      expect(readiness).toMatchObject({
        appReady: false,
        manifestDriven: false,
        previewOnly: true,
        gatesSummary: {
          total: 7,
          passed: expectedPassed[id],
          failed: 7 - expectedPassed[id],
        },
      });
      expect(readiness.gates).toHaveLength(7);
      expect(readiness.gates.every((gate: { name?: string }) => gate.name?.startsWith('开发预览·'))).toBe(true);
    }
  });

  it('does not leak imported metrics, history, or keyword opportunities into pre-diagnosis scenarios', async () => {
    const createApi = previewExports().createBrowserPreviewElectronApi!;

    for (const id of ['missing-scope', 'missing-reports', 'pending-import'] as const) {
      const api = createApi('SHC001', id);
      const [pipeline, keywordOpportunities] = await Promise.all([
        api.getBusinessUiDataPipeline(),
        api.getBusinessKeywordOpportunities(),
      ]);

      expect(pipeline.quant).toMatchObject({
        hasImportedMetrics: false,
        importedRows: 0,
        canonicalRows: 0,
        actionableRows: 0,
        totalSpend: 0,
        totalSales: 0,
        totalOrders: 0,
        totalClicks: 0,
        totalImpressions: 0,
        wastedSpend: 0,
      });
      expect(pipeline.productHistory.ledgers).toEqual([]);
      expect(keywordOpportunities).toEqual([]);
    }
  });

  it('filters mixed and approved recommendation scenarios the same way the pages request them', async () => {
    const createApi = previewExports().createBrowserPreviewElectronApi!;
    const mixedApi = createApi('SHC001', 'mixed-recommendations');
    const approvedApi = createApi('SHC001', 'missing-readback-evidence');

    expect(await getPreviewRecommendations(mixedApi, { status: 'pending' })).toHaveLength(1);
    expect(await getPreviewRecommendations(mixedApi, { status: 'needs_review' })).toHaveLength(1);
    expect(await getPreviewRecommendations(mixedApi, { status: 'approved' })).toEqual([]);
    expect(await getPreviewRecommendations(approvedApi, { status: 'pending' })).toEqual([]);
    expect(await getPreviewRecommendations(approvedApi, { status: 'approved' })).toHaveLength(1);
    expect(await getPreviewRecommendations(approvedApi, { status: 'rejected' })).toHaveLength(1);
  });

  it('requires the same scoped query contract as the production recommendation reader', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');

    expect(await api.getRecommendations()).toEqual([]);
    expect(await api.getRecommendations({
      ...PREVIEW_RECOMMENDATION_FILTER,
      batchId: 'forged-batch',
    })).toEqual([]);
    expect(await api.getRecommendations({
      ...PREVIEW_RECOMMENDATION_FILTER,
      asin: 'B0WRONGASIN',
    })).toEqual([]);
    expect(await api.getRecommendations({
      ...PREVIEW_RECOMMENDATION_FILTER,
      limit: 1,
    })).toHaveLength(1);
    expect(await getPreviewRecommendations(api, { status: 'pending' })).toHaveLength(1);
  });

  it('exposes complete canonical ActionRecommendation fixtures backed by nested report evidence', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [recommendations, pipeline] = await Promise.all([
      getPreviewRecommendations(api),
      api.getBusinessUiDataPipeline(),
    ]);
    const currentSourceFiles = new Set(
      pipeline.collection.realReportFiles.map((file: { filePath: string }) => file.filePath.toLowerCase()),
    );
    const legalActionTypes = new Set([
      'lower_bid',
      'raise_bid',
      'pause_target',
      'resume_target',
      'add_negative_exact',
      'add_negative_phrase',
      'add_negative_broad',
      'adjust_campaign_budget',
      'create_campaign',
      'archive_campaign',
    ]);

    expect(recommendations).toHaveLength(2);
    for (const recommendation of recommendations) {
      expect(Number.isInteger(recommendation.id) && recommendation.id > 0).toBe(true);
      expect(legalActionTypes.has(recommendation.actionType)).toBe(true);
      expect(recommendation).toMatchObject({
        taskId: expect.any(String),
        storeName: PREVIEW_RECOMMENDATION_FILTER.storeName,
        marketplaceCode: PREVIEW_RECOMMENDATION_FILTER.marketplaceCode,
        asin: PREVIEW_RECOMMENDATION_FILTER.asin,
        msku: expect.any(String),
        entityName: expect.any(String),
        currentValue: expect.any(String),
        recommendedValue: expect.any(String),
        reason: expect.any(String),
        acos: expect.any(Number),
        clicks: expect.any(Number),
        cost: expect.any(Number),
        confidence: expect.any(Number),
        revision: expect.any(Number),
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        evidence: {
          batchId: expect.any(String),
          date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          asin: expect.any(String),
          campaignName: expect.any(String),
          adGroupName: expect.any(String),
          sourceFiles: expect.arrayContaining([expect.stringMatching(/\.(xlsx|xls|csv)$/i)]),
          sourceRow: expect.any(Number),
          clicks: expect.any(Number),
          cost: expect.any(Number),
          orders: expect.any(Number),
          sales: expect.any(Number),
          acos: expect.any(Number),
          cpc: expect.any(Number),
          cvr: expect.any(Number),
          aiStrategySummary: expect.any(String),
          aiEvidenceDetails: expect.any(Array),
          decisionAgreement: expect.stringMatching(/^(aligned|rule_only|ai_only|conflict)$/),
          decisionReasons: expect.arrayContaining([expect.any(String)]),
        },
      });
      expect(recommendation.evidence.sourceRow).toBeGreaterThan(0);
      expect(recommendation.confidence).toBeGreaterThan(0);
      expect(recommendation.confidence).toBeLessThanOrEqual(1);
      expect(recommendation.evidence.sourceFiles.every((file: string) => currentSourceFiles.has(file.toLowerCase()))).toBe(true);
      const detailIds = new Set(recommendation.evidence.aiEvidenceDetails.map((detail: { evidenceId: string }) => detail.evidenceId));
      expect(recommendation.evidence.aiEvidenceRefs.every((ref: string) => detailIds.has(ref))).toBe(true);
      expect(recommendation).not.toHaveProperty('suggestedValue');
      expect(recommendation).not.toHaveProperty('evidenceRefs');
    }
  });

  it('builds approved preview history through a valid binding, revision, and decision snapshot', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'missing-readback-evidence');
    const [approved] = await getPreviewRecommendations(api, { status: 'approved' });

    expect(approved).toMatchObject({
      status: 'approved',
      revision: expect.any(Number),
      evidence: {
        writableTarget: {
          entityType: 'keyword',
          entityId: expect.any(String),
          identityProofPath: expect.any(String),
        },
        writableTargetBinding: {
          schemaVersion: 1,
          fromRevision: 0,
          boundRevision: 1,
        },
        approvalDecision: {
          decision: 'approved',
          approvedBy: 'Preview Approver',
          recommendationId: approved.id,
          actionType: approved.actionType,
          entityType: approved.entityType,
          entityName: approved.entityName,
          currentValue: approved.currentValue,
          recommendedValue: approved.recommendedValue,
          sourceBatchId: PREVIEW_RECOMMENDATION_FILTER.batchId,
          scope: {
            dateFrom: PREVIEW_RECOMMENDATION_FILTER.dateFrom,
            dateTo: PREVIEW_RECOMMENDATION_FILTER.dateTo,
            storeName: PREVIEW_RECOMMENDATION_FILTER.storeName,
            marketplaceCode: PREVIEW_RECOMMENDATION_FILTER.marketplaceCode,
            asin: PREVIEW_RECOMMENDATION_FILTER.asin,
          },
        },
      },
    });
    expect(approved.revision).toBeGreaterThanOrEqual(2);

    expect(getRecommendationApprovalBlockers(approved as ActionRecommendation, {
      allowedSourceFiles: approved.evidence.sourceFiles,
      sourceAuthority: {
        reportType: approved.evidence.reportType,
        entityName: approved.entityName,
        campaignName: approved.evidence.campaignName,
        adGroupName: approved.evidence.adGroupName,
        metricDate: approved.evidence.date,
        sourceFile: approved.evidence.sourceFile || approved.evidence.sourceFiles[0],
        sourceRow: approved.evidence.sourceRow,
      },
    })).toEqual([]);
  });

  it('does not approve a resolved row while its action direction and AI decision still conflict', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [needsReview] = await getPreviewRecommendations(api, { status: 'needs_review' });

    const result = await api.resolveRecommendationReview({
      recommendationId: needsReview.id,
      expectedRevision: needsReview.revision,
      scope: PREVIEW_RECOMMENDATION_FILTER,
      review: {
        reviewedBy: 'Preview Reviewer',
        rationale: '仅确认 Ads 对象身份，不覆盖动作方向与 AI/规则冲突。',
        writableTarget: {
          entityType: 'keyword',
          entityId: 'amzn-keyword-preview-conflict',
          sourceFile: 'D:/preview/reports/keyword.xlsx',
          sourceRow: needsReview.evidence.sourceRow,
          identitySource: 'ads_ui',
          identityProofPath: 'D:/preview/evidence/conflict-keyword.png',
          verificationNote: '已确认对象身份，但未改变建议内容。',
        },
      },
    });

    await expect(api.approveRecommendation({
      id: needsReview.id,
      expectedRevision: result.revision,
      decision: { approvedBy: 'Preview Ops' },
    })).rejects.toThrow(/降价|冲突|复核/);
    expect((await getPreviewRecommendations(api, { status: 'pending' })).find(
      (row) => row.id === needsReview.id,
    )).toBeDefined();
    expect(await getPreviewRecommendations(api, { status: 'approved' })).toEqual([]);
  });

  it('isolates recommendation reads from caller mutation without weakening decision guards', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [pending, needsReview] = await getPreviewRecommendations(api);
    const pendingRevision = pending.revision;
    const reviewRevision = needsReview.revision;
    const pendingSourceFile = pending.evidence.sourceFiles[0];
    const pendingEvidenceCost = pending.evidence.aiEvidenceDetails[0].metrics.cost;

    pending.status = 'approved';
    pending.revision = 999;
    pending.evidence.sourceFiles[0] = 'D:/forged/report.xlsx';
    pending.evidence.aiEvidenceDetails[0].metrics.cost = 0;
    pending.evidence.approvalDecision = {
      decision: 'approved',
      approvedBy: 'Forged Approver',
      decidedAt: '2026-07-14T00:00:00.000Z',
    };
    needsReview.status = 'rejected';
    needsReview.evidence.approvalDecision = {
      decision: 'rejected',
      rejectedBy: 'Forged Reviewer',
      note: 'Forged reason',
      decidedAt: '2026-07-14T00:00:00.000Z',
    };

    const [freshPending] = await getPreviewRecommendations(api, { status: 'pending' });
    const [freshReview] = await getPreviewRecommendations(api, { status: 'needs_review' });
    expect(freshPending).toMatchObject({
      id: pending.id,
      status: 'pending',
      revision: pendingRevision,
      evidence: {
        sourceFiles: [pendingSourceFile],
      },
    });
    expect(freshPending.evidence.aiEvidenceDetails[0].metrics.cost).toBe(pendingEvidenceCost);
    expect(freshPending.evidence.approvalDecision).toBeUndefined();
    expect(freshReview).toMatchObject({
      id: needsReview.id,
      status: 'needs_review',
      revision: reviewRevision,
    });
    expect(freshReview.evidence.approvalDecision).toBeUndefined();

    await expect(api.approveRecommendation({
      id: pending.id,
      expectedRevision: pending.revision,
      decision: { approvedBy: 'Forged Approver' },
    })).rejects.toThrow(/版本|冲突/);
    await expect(api.rejectRecommendation({
      id: needsReview.id,
      expectedRevision: reviewRevision,
      decision: { rejectedBy: '', note: 'Forged reason' },
    })).rejects.toThrow(/处理人|审批人/);
    await expect(api.rejectRecommendation({
      id: needsReview.id,
      expectedRevision: reviewRevision,
      decision: { rejectedBy: 'Preview Reviewer', note: '' },
    })).rejects.toThrow(/拒绝原因|原因/);

    const bindingResult = await bindPreviewPendingTarget(api, freshPending);
    await api.approveRecommendation({
      id: pending.id,
      expectedRevision: bindingResult.revision,
      decision: { approvedBy: 'Preview Ops' },
    });
    await api.rejectRecommendation({
      id: needsReview.id,
      expectedRevision: reviewRevision,
      decision: { rejectedBy: 'Preview Reviewer', note: '证据冲突，暂不执行' },
    });
    expect(await getPreviewRecommendations(api, { status: 'approved' })).toHaveLength(1);
    expect(await getPreviewRecommendations(api, { status: 'rejected' })).toHaveLength(1);
  });

  it('returns generation results as isolated snapshots of preview recommendation state', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const firstGeneration = await api.generateRecommendations();
    const generatedPending = firstGeneration.recommendations[0];
    const originalRevision = generatedPending.revision;
    const originalSourceFile = generatedPending.evidence.sourceFiles[0];

    generatedPending.status = 'approved';
    generatedPending.revision = 777;
    generatedPending.evidence.sourceFiles[0] = 'D:/forged/generated.xlsx';
    firstGeneration.recommendations.pop();

    const secondGeneration = await api.generateRecommendations();
    expect(secondGeneration.generated).toBe(2);
    expect(secondGeneration.recommendations).toHaveLength(2);
    expect(secondGeneration.recommendations[0]).toMatchObject({
      id: generatedPending.id,
      status: 'pending',
      revision: originalRevision,
      evidence: { sourceFiles: [originalSourceFile] },
    });
    expect(await getPreviewRecommendations(api, { status: 'pending' })).toHaveLength(1);
    expect(await getPreviewRecommendations(api, { status: 'approved' })).toEqual([]);
  });

  it('persists an approved decision in preview memory with revision and decision evidence', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [pending] = await getPreviewRecommendations(api, { status: 'pending' });
    const bindingResult = await bindPreviewPendingTarget(api, pending);
    const [boundPending] = await getPreviewRecommendations(api, { status: 'pending' });

    await api.approveRecommendation({
      id: boundPending.id,
      expectedRevision: bindingResult.revision,
      decision: { approvedBy: 'Preview Ops', note: '同意本次调整' },
    });

    expect(await getPreviewRecommendations(api, { status: 'pending' })).toEqual([]);
    const [approved] = await getPreviewRecommendations(api, { status: 'approved' });
    expect(approved).toMatchObject({
      id: pending.id,
      status: 'approved',
      revision: pending.revision + 2,
      evidence: {
        approvalDecision: {
          decision: 'approved',
          approvedBy: 'Preview Ops',
          note: '同意本次调整',
          decidedAt: expect.any(String),
        },
      },
    });
    expect((await getPreviewRecommendations(api)).find((row: { id: number }) => row.id === pending.id)?.status).toBe('approved');
  });

  it('keeps ordinary pending recommendations unapproved until target binding is reloaded', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [pending] = await getPreviewRecommendations(api, { status: 'pending' });

    await expect(api.approveRecommendation({
      id: pending.id,
      expectedRevision: pending.revision,
      decision: { approvedBy: 'Preview Ops' },
    })).rejects.toThrow(/Ads|可写对象|核验/);

    const result = await bindPreviewPendingTarget(api, pending);
    const [reloaded] = await getPreviewRecommendations(api, { status: 'pending' });
    expect(result).toMatchObject({
      ok: true,
      recommendationId: pending.id,
      status: 'pending',
      revision: pending.revision + 1,
    });
    expect(reloaded).toMatchObject({
      status: 'pending',
      revision: result.revision,
      evidence: {
        writableTarget: { entityId: 'amzn-keyword-preview-1001' },
        writableTargetBinding: {
          fromRevision: pending.revision,
          boundRevision: result.revision,
          boundBy: 'Preview Verifier',
        },
      },
    });
    expect(await getPreviewRecommendations(api, { status: 'approved' })).toEqual([]);
  });

  it('persists a rejected review decision and its required operator reason in preview memory', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [needsReview] = await getPreviewRecommendations(api, { status: 'needs_review' });
    const displayedRevision = needsReview.revision;

    await api.rejectRecommendation({
      id: needsReview.id,
      expectedRevision: displayedRevision,
      decision: { rejectedBy: 'Preview Reviewer', note: '证据冲突，暂不执行' },
    });

    expect(await getPreviewRecommendations(api, { status: 'needs_review' })).toEqual([]);
    const [rejected] = await getPreviewRecommendations(api, { status: 'rejected' });
    expect(rejected).toMatchObject({
      id: needsReview.id,
      status: 'rejected',
      revision: displayedRevision + 1,
      evidence: {
        approvalDecision: {
          decision: 'rejected',
          rejectedBy: 'Preview Reviewer',
          note: '证据冲突，暂不执行',
          decidedAt: expect.any(String),
        },
      },
    });
  });

  it('resolves one controlled review back to pending without approving it', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [needsReview] = await getPreviewRecommendations(api, { status: 'needs_review' });

    const result = await api.resolveRecommendationReview({
      recommendationId: needsReview.id,
      expectedRevision: needsReview.revision,
      scope: {
        dateFrom: '2026-05-21',
        dateTo: '2026-06-23',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0GTTJFQTM',
        batchId: 'batch_preview_20260625',
      },
      review: {
        reviewedBy: 'Preview Reviewer',
        rationale: '已在 Ads UI 中确认当前关键词行与真实报表来源唯一对应。',
        writableTarget: {
          entityType: 'keyword',
          entityId: 'amzn-keyword-preview-2002',
          sourceFile: 'D:/preview/reports/keyword.xlsx',
          sourceRow: needsReview.evidence.sourceRow,
          identitySource: 'ads_ui',
          identityProofPath: 'D:/preview/evidence/keyword-identity.png',
          verificationNote: '在已认证 Ads UI 中逐项核对活动、广告组与关键词 ID。',
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      recommendationId: needsReview.id,
      previousStatus: 'needs_review',
      status: 'pending',
      revision: needsReview.revision + 1,
      resolvedBlockers: ['quant_review_required'],
    });
    expect(await getPreviewRecommendations(api, { status: 'needs_review' })).toEqual([]);
    expect((await getPreviewRecommendations(api, { status: 'pending' })).find(
      (row: { id: number }) => row.id === needsReview.id,
    )).toMatchObject({
      status: 'pending',
      evidence: {
        writableTarget: {
          entityType: 'keyword',
          entityId: 'amzn-keyword-preview-2002',
          identitySource: 'ads_ui',
        },
        reviewResolution: {
          fromStatus: 'needs_review',
          reviewedBy: 'Preview Reviewer',
        },
      },
    });
    expect(await getPreviewRecommendations(api, { status: 'approved' })).toEqual([]);
  });

  it('keeps preview review unresolved when the writable target source is outside the locked batch', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [needsReview] = await getPreviewRecommendations(api, { status: 'needs_review' });

    await expect(api.resolveRecommendationReview({
      recommendationId: needsReview.id,
      expectedRevision: needsReview.revision,
      scope: {
        dateFrom: '2026-05-21',
        dateTo: '2026-06-23',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0GTTJFQTM',
        batchId: 'batch_preview_20260625',
      },
      review: {
        reviewedBy: 'Preview Reviewer',
        rationale: 'Attempted forged source.',
        writableTarget: {
          entityType: 'keyword',
          entityId: 'amzn-keyword-preview-2002',
          sourceFile: 'D:/forged/keyword.xlsx',
          sourceRow: 43,
          identitySource: 'ads_ui',
          identityProofPath: 'D:/preview/evidence/keyword-identity.png',
          verificationNote: 'Attempted forged source.',
        },
      },
    })).rejects.toThrow(/锁定批次|可写对象/);

    expect(await getPreviewRecommendations(api, { status: 'needs_review' })).toHaveLength(1);
    expect(await getPreviewRecommendations(api, { status: 'approved' })).toEqual([]);
  });

  it('rejects a stale displayed revision without mutating preview state', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [pending] = await getPreviewRecommendations(api, { status: 'pending' });

    await expect(api.approveRecommendation({
      id: pending.id,
      expectedRevision: pending.revision + 1,
      decision: { approvedBy: 'Preview Ops' },
    })).rejects.toThrow(/版本|冲突/);

    expect(await getPreviewRecommendations(api, { status: 'pending' })).toHaveLength(1);
    expect(await getPreviewRecommendations(api, { status: 'approved' })).toEqual([]);
  });

  it('requires a non-empty approval operator before changing preview state', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [pending] = await getPreviewRecommendations(api, { status: 'pending' });
    const bindingResult = await bindPreviewPendingTarget(api, pending);

    await expect(api.approveRecommendation({
      id: pending.id,
      expectedRevision: bindingResult.revision,
      decision: { approvedBy: '   ' },
    })).rejects.toThrow(/审批人|处理人/);

    expect(await getPreviewRecommendations(api, { status: 'pending' })).toHaveLength(1);
  });

  it('requires a non-empty rejection operator before changing preview state', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [needsReview] = await getPreviewRecommendations(api, { status: 'needs_review' });

    await expect(api.rejectRecommendation({
      id: needsReview.id,
      expectedRevision: needsReview.revision,
      decision: { rejectedBy: '', note: '证据不足' },
    })).rejects.toThrow(/处理人|审批人/);

    expect(await getPreviewRecommendations(api, { status: 'needs_review' })).toHaveLength(1);
  });

  it('requires a non-empty rejection reason before changing preview state', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [needsReview] = await getPreviewRecommendations(api, { status: 'needs_review' });

    await expect(api.rejectRecommendation({
      id: needsReview.id,
      expectedRevision: needsReview.revision,
      decision: { rejectedBy: 'Preview Reviewer', note: '  ' },
    })).rejects.toThrow(/拒绝原因|原因/);

    expect(await getPreviewRecommendations(api, { status: 'needs_review' })).toHaveLength(1);
  });

  it('rejects a stale rejection revision without mutating preview state', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [needsReview] = await getPreviewRecommendations(api, { status: 'needs_review' });

    await expect(api.rejectRecommendation({
      id: needsReview.id,
      expectedRevision: needsReview.revision + 1,
      decision: { rejectedBy: 'Preview Reviewer', note: '证据不足' },
    })).rejects.toThrow(/版本|冲突/);

    expect(await getPreviewRecommendations(api, { status: 'needs_review' })).toHaveLength(1);
    expect(await getPreviewRecommendations(api, { status: 'rejected' })).toEqual([]);
  });

  it('does not allow a needs-review recommendation to bypass review through approval', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [needsReview] = await getPreviewRecommendations(api, { status: 'needs_review' });

    await expect(api.approveRecommendation({
      id: needsReview.id,
      expectedRevision: needsReview.revision,
      decision: { approvedBy: 'Preview Ops' },
    })).rejects.toThrow(/状态|不允许|复核/);

    expect(await getPreviewRecommendations(api, { status: 'needs_review' })).toHaveLength(1);
  });

  it('keeps approved-scenario decisions as immutable approved and rejected history', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'missing-readback-evidence');
    const history = await getPreviewRecommendations(api);
    const initial = history.map((row: any) => ({ id: row.id, status: row.status, revision: row.revision }));

    expect(history.map((row: any) => ({
      status: row.status,
      decision: row.evidence?.approvalDecision?.decision,
      operator: row.evidence?.approvalDecision?.approvedBy || row.evidence?.approvalDecision?.rejectedBy,
    }))).toEqual([
      { status: 'approved', decision: 'approved', operator: 'Preview Approver' },
      { status: 'rejected', decision: 'rejected', operator: 'Preview Reviewer' },
    ]);

    for (const row of history) {
      await expect(api.approveRecommendation({
        id: row.id,
        expectedRevision: row.revision,
        decision: { approvedBy: 'Second Approver' },
      })).rejects.toThrow(/状态|不允许/);
      await expect(api.rejectRecommendation({
        id: row.id,
        expectedRevision: row.revision,
        decision: { rejectedBy: 'Second Reviewer', note: '尝试覆盖历史' },
      })).rejects.toThrow(/状态|不允许/);
    }

    expect((await getPreviewRecommendations(api)).map((row: any) => ({
      id: row.id,
      status: row.status,
      revision: row.revision,
    }))).toEqual(initial);
  });

  it('allows a pending recommendation to be rejected without first moving it to review', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [pending] = await getPreviewRecommendations(api, { status: 'pending' });

    await api.rejectRecommendation({
      id: pending.id,
      expectedRevision: pending.revision,
      decision: { rejectedBy: 'Preview Reviewer', note: '运营决定不采用' },
    });

    expect(await getPreviewRecommendations(api, { status: 'pending' })).toEqual([]);
    expect(await getPreviewRecommendations(api, { status: 'rejected' })).toHaveLength(1);
  });

  it.each([
    ['approveRecommendation', 'pending', undefined],
    ['approveRecommendation', 'pending', -1],
    ['approveRecommendation', 'pending', 0.5],
    ['approveRecommendation', 'pending', '0'],
    ['rejectRecommendation', 'needs_review', undefined],
    ['rejectRecommendation', 'needs_review', -1],
    ['rejectRecommendation', 'needs_review', 0.5],
    ['rejectRecommendation', 'needs_review', '0'],
  ] as const)('rejects invalid displayed revision %s / %s / %s', async (method, status, expectedRevision) => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'mixed-recommendations');
    const [recommendation] = await getPreviewRecommendations(api, { status });
    const decision = method === 'approveRecommendation'
      ? { approvedBy: 'Preview Ops' }
      : { rejectedBy: 'Preview Reviewer', note: '证据不足' };

    await expect(api[method]({
      id: recommendation.id,
      expectedRevision,
      decision,
    })).rejects.toThrow(/版本|冲突/);

    expect(await getPreviewRecommendations(api, { status })).toHaveLength(1);
  });

  it('keeps delivery-ready preview in memory and exposes no evidence-writing API', () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'delivery-ready');

    for (const method of [
      'exportAdReadbackEvidence',
      'prepareAdReadbackSession',
      'fillAdReadbackSession',
      'verifyAdReadbackSession',
      'verifyAdReadbackEvidence',
      'saveReadbackCapture',
      'refreshFinalReadiness',
    ]) {
      expect(api[method], `${method} must stay unavailable in preview`).toBeUndefined();
    }
  });
});

describe('browser preview bootstrap integration', () => {
  it('does not install an API on production localhost even with explicit opt-in', () => {
    const bootstrap = previewExports().bootstrapBrowserPreview;
    const target = {
      location: { hostname: 'localhost', search: '?preview=1&scenario=delivery-ready' },
    } as { location: { hostname: string; search: string }; electronAPI?: any };

    expect(typeof bootstrap).toBe('function');
    expect(bootstrap!({ dev: false, target })).toMatchObject({ enabled: false });
    expect(target.electronAPI).toBeUndefined();
  });

  it('installs the selected fixture only for an explicitly opted-in local development URL', async () => {
    const bootstrap = previewExports().bootstrapBrowserPreview;
    const target = {
      location: { hostname: '127.0.0.1', search: '?preview=1&scenario=mixed-recommendations' },
    } as { location: { hostname: string; search: string }; electronAPI?: any };

    expect(bootstrap!({ dev: true, target })).toEqual({
      enabled: true,
      scenarioId: 'mixed-recommendations',
    });
    expect(await getPreviewRecommendations(target.electronAPI)).toHaveLength(2);
  });

  it('preserves a pre-injected Electron API instead of replacing smoke or preload behavior', () => {
    const bootstrap = previewExports().bootstrapBrowserPreview;
    const injectedApi = { getState: async () => ({ isLoggedIn: true }), marker: 'pre-injected' };
    const target = {
      electronAPI: injectedApi,
      location: { hostname: 'localhost', search: '?preview=1&scenario=delivery-ready' },
    };

    expect(bootstrap!({ dev: true, target })).toMatchObject({
      enabled: true,
      scenarioId: 'delivery-ready',
    });
    expect(target.electronAPI).toBe(injectedApi);
  });
});

describe('DeliveryPage development preview state', () => {
  it('renders all seven scenarios as preview-only and never unlocks the real export gate', async () => {
    const deliveryModule = DeliveryPageModule as unknown as {
      canExportDeliveryBundle: (readiness: any, packageEvidence: any) => boolean;
      deliveryPreviewState?: (readiness: any, evidenceStatus: any) => any;
      DeliveryPreviewNotice?: (props: { state: any }) => any;
    };

    expect(typeof deliveryModule.deliveryPreviewState).toBe('function');
    expect(typeof deliveryModule.DeliveryPreviewNotice).toBe('function');

    for (const id of EXPECTED_SCENARIOS) {
      const api = previewExports().createBrowserPreviewElectronApi!('SHC001', id);
      const [readiness, evidenceStatus] = await Promise.all([
        api.getDeliveryReadiness(),
        api.getDeliveryEvidenceStatus(),
      ]);
      const state = deliveryModule.deliveryPreviewState!(readiness, evidenceStatus);
      const markup = renderToStaticMarkup(createElement(deliveryModule.DeliveryPreviewNotice!, { state }));

      expect(state.scenarioId).toBe(id);
      expect(state.tone).toBe('warning');
      expect(markup).toContain('仅开发预览');
      expect(markup).toContain('不可视为 APP_READY');
      expect(deliveryModule.canExportDeliveryBundle(readiness, evidenceStatus.package)).toBe(false);

      if (id === 'delivery-ready') {
        expect(state.headline).toBe('仅开发预览已走通');
        expect(markup).toContain('仅开发预览已走通');
      } else {
        expect(state.headline).toBe('仅开发预览场景未走通');
      }
    }
  });
});
