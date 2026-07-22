import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  MISSION_CONTROL_LEGACY_ROUTE_IDS,
  type ActionRecommendation,
  type MissionControlLegacyRouteId,
  type MissionControlViewId,
} from '@amazon-ai-ops/shared-types';
import { getRecommendationApprovalBlockers } from '../main/recommendation-approval-policy';
import * as PreviewModule from './dev-preview-api';
import { LegacyAdapterBoundary } from './mission-control/legacy-boundary';
import { resolveLegacyCapability } from './mission-control/router';
import type { NavigationIntent } from './navigation';
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

const LEGACY_PREVIEW_ROUTE_CASES: readonly {
  route: MissionControlLegacyRouteId;
  intent: NavigationIntent;
  view: MissionControlViewId;
}[] = [
  { route: 'dashboard', intent: { workspace: 'today', subview: 'overview' }, view: 'today/overview' },
  { route: 'operation-events', intent: { workspace: 'today', subview: 'events' }, view: 'today/events' },
  { route: 'ad-quant', intent: { workspace: 'missions', subview: 'facts' }, view: 'missions/facts' },
  { route: 'recommendations', intent: { workspace: 'decisions', subview: 'recommendations' }, view: 'decisions/recommendations' },
  { route: 'approval', intent: { workspace: 'decisions', subview: 'approval' }, view: 'decisions/approval' },
  { route: 'approval', intent: { workspace: 'decisions', subview: 'decided' }, view: 'decisions/decided' },
  { route: 'readback', intent: { workspace: 'execution', subview: 'evidence' }, view: 'execution/evidence' },
  { route: 'product-management', intent: { workspace: 'objects', subview: 'products' }, view: 'objects/products' },
  { route: 'product-config', intent: { workspace: 'objects', subview: 'targets' }, view: 'objects/targets' },
  { route: 'keyword-opportunities', intent: { workspace: 'objects', subview: 'keywords' }, view: 'objects/keywords' },
  { route: 'listing-optimization', intent: { workspace: 'objects', subview: 'listing' }, view: 'objects/listing' },
  { route: 'operation-scope', intent: { workspace: 'collection', subview: 'scope' }, view: 'collection/scope' },
  { route: 'data-collection', intent: { workspace: 'collection', subview: 'reports' }, view: 'collection/reports' },
  { route: 'data-import-validation', intent: { workspace: 'collection', subview: 'import-check' }, view: 'collection/import-check' },
  { route: 'settings', intent: { workspace: 'settings', subview: 'ai-and-local' }, view: 'settings/ai-and-local' },
  { route: 'scheduler', intent: { workspace: 'settings', subview: 'scheduler' }, view: 'settings/scheduler' },
  { route: 'delivery', intent: { workspace: 'settings', subview: 'delivery' }, view: 'settings/delivery' },
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
        sourceFile: 'keyword.xlsx',
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
      const [store] = await api.listStores();
      const view = await api.switchStore(store.storeId);
      const scope = await api.getOperationScope(view.context);
      const [pipeline, batchOptions, recommendations, evidenceStatus, delivery] = await Promise.all([
        api.getBusinessUiDataPipeline(),
        api.getBusinessBatchOptions(),
        getPreviewRecommendations(api, scope || { storeName: store.displayName }),
        api.getDeliveryEvidenceStatus(),
        api.getDeliveryReadiness(),
      ]);

      expect(Boolean(scope)).toBe(scenario.scopeReady);
      expect(batchOptions).toEqual(pipeline.collection.availableBatches);
      expect(pipeline.collection.status === 'ready').toBe(scenario.reportsCollected);
      expect(pipeline.quant.hasImportedMetrics).toBe(scenario.reportsImported);
      expect(pipeline.quant.diagnostics.length > 0).toBe(scenario.diagnosisReady);
      expect(
        recommendations.length > 0,
        `scenario ${id} recommendation projection must match ${scenario.recommendationState}`,
      ).toBe(['mixed', 'approved'].includes(scenario.recommendationState));
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

  it('ships native object rows plus a 100-row diagnosis surface for scroll-owner validation', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
    const [store] = await api.listStores();
    const view = await api.switchStore(store.storeId);
    const [pipeline, products, events] = await Promise.all([
      api.getBusinessUiDataPipeline(),
      api.listStoreProducts(view.context),
      api.listStoreOperationEvents(view.context),
    ]);

    expect(products.length).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);
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

  it('does not leak imported metrics, history, or canonical keyword facts into pre-diagnosis scenarios', async () => {
    const createApi = previewExports().createBrowserPreviewElectronApi!;

    for (const id of ['missing-scope', 'missing-reports', 'pending-import'] as const) {
      const api = createApi('SHC001', id);
      const [store] = await api.listStores();
      const context = (await api.switchStore(store.storeId)).context;
      const [pipeline, keywordFacts] = await Promise.all([
        api.getBusinessUiDataPipeline(),
        api.listStoreKeywordFacts(context, { limit: 20 }),
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
      expect(keywordFacts).toEqual([]);
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
      pipeline.collection.realReportFiles.map((file: { artifactDisplayName: string }) => file.artifactDisplayName.toLowerCase()),
    );
    const collectionPayload = JSON.stringify(pipeline.collection);
    expect(collectionPayload).not.toMatch(/filePath|folderPath|downloadDir|manifestPath|evidencePaths/);
    expect(pipeline.collection.evidenceArtifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifactId: expect.stringMatching(/^artifact:v1:/),
        displayName: expect.any(String),
        kind: 'folder',
      }),
    ]));
    expect(pipeline.collection.realReportFiles.every((file: any) => (
      /^artifact:v1:/.test(file.artifactId)
      && /^artifact:v1:/.test(file.sourceArtifactId)
      && !/[\\/]/.test(file.artifactDisplayName)
    ))).toBe(true);
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

  it('opens only registered report artifacts under the current store authority', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
    const [firstStore, secondStore] = await api.listStores();
    const firstView = await api.switchStore(firstStore.storeId);
    const pipeline = await api.getBusinessUiDataPipeline();
    const artifactId = pipeline.collection.realReportFiles[0].artifactId;

    await expect(api.openReportArtifact(artifactId, firstView.context)).resolves.toMatchObject({
      opened: true,
      artifactId,
      previewOnly: true,
    });
    const secondView = await api.switchStore(secondStore.storeId);
    await expect(api.openReportArtifact(artifactId, firstView.context)).rejects.toThrow(/STORE_CONTEXT_MISMATCH|权威|上下文|失效/);
    await expect(api.openReportArtifact('artifact:v1:unknown', secondView.context)).rejects.toThrow(/不存在|失效/);
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
          sourceFile: 'keyword.xlsx',
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
          sourceFile: 'keyword.xlsx',
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
    const [store] = await target.electronAPI.listStores();
    const storeView = await target.electronAPI.switchStore(store.storeId);
    expect(target.electronAPI.missionDomain).toBeTruthy();
    await expect(target.electronAPI.missionDomain.missions.list(storeView.context, { includeArchived: true }))
      .resolves.toHaveLength(7);
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

describe('Mission Control development preview bridge', () => {
  it('starts with exactly two isolated US/USD fixture stores and requires an explicit switch', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
    const stores = await api.listStores({ includeArchived: true });

    expect(stores).toHaveLength(2);
    expect(stores.every((store: any) => store.marketplace === 'US' && store.currency === 'USD')).toBe(true);
    expect(new Set(stores.map((store: any) => store.storeId)).size).toBe(2);
    expect(new Set(stores.map((store: any) => store.browserProfileId)).size).toBe(2);
    expect(await api.getActiveStoreContext()).toBeNull();

    await expect(api.missionControl.query({
      query: 'workspace-bootstrap', requestId: 'before-switch', contextEpoch: 0,
      context: {
        storeId: stores[0].storeId,
        browserProfileId: stores[0].browserProfileId,
        marketplace: 'US', currency: 'USD', businessTimezone: stores[0].businessTimezone,
        businessDate: '2026-07-22', sessionGeneration: 0,
      },
    })).rejects.toThrow('PREVIEW_EXPLICIT_STORE_SELECTION_REQUIRED');
  });

  it('publishes explicit store switches and returns preview-only capabilities without secrets or paths', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
    const stores = await api.listStores();
    const contexts: any[] = [];
    const unsubscribe = api.onStoreContextChanged((view: any) => contexts.push(view.context));
    const view = await api.switchStore(stores[0].storeId);
    const response = await api.missionControl.query({
      query: 'workspace-bootstrap', requestId: 'preview-query', contextEpoch: 7, context: view.context,
    });
    unsubscribe();

    expect(contexts).toHaveLength(1);
    expect(response).toEqual(expect.objectContaining({
      requestId: 'preview-query',
      contextEpoch: 7,
      authoritativeContext: view.context,
    }));
    expect(response.data.capabilities.length).toBeGreaterThan(22);
    expect(response.data.capabilities.every((row: any) => row.state === 'PROTOTYPE_ONLY'
      || (row.capabilityId === 'decisions.grants.issue'
        && row.state === 'BLOCKED'
        && row.blockerCode === 'AD_ENTITY_REGISTRY_NOT_IMPLEMENTED'))).toBe(true);
    expect(response.data.capabilities.find((row: any) => row.capabilityId === 'decisions.grants.issue')?.view)
      .toBe('decisions/decided');
    expect(response.data.capabilities.find((row: any) => row.capabilityId === 'decisions.grants.revoke')?.view)
      .toBe('decisions/decided');
    const serialized = JSON.stringify(response);
    expect(serialized).not.toMatch(/password|cookie|token|apiKey|filePath|profilePath/i);
    expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it('marks every store-scoped object preview capability as prototype-only', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
    const [store] = await api.listStores();
    const view = await api.switchStore(store.storeId);
    const response = await api.missionControl.query({
      query: 'workspace-bootstrap', requestId: 'preview-object-capabilities', contextEpoch: 1, context: view.context,
    });
    const expected = [
      'today.events.view',
      'today.events.create',
      'today.events.update',
      'today.events.archive',
      'today.events.restore',
      'objects.products.view',
      'objects.products.create',
      'objects.products.update',
      'objects.products.archive',
      'objects.events.view',
      'objects.events.create',
      'objects.events.update',
      'objects.events.delete',
      'objects.targets.view',
      'objects.keywords.view',
      'objects.listing.view',
      'objects.listing.create',
      'objects.listing.update',
      'objects.listing.delete',
    ];
    const capabilities = new Map(
      response.data.capabilities.map((capability: any) => [capability.capabilityId, capability]),
    );

    expect(api.storeScopedObjectsPreviewOnly).toBe(true);
    expect(api.storeScopedAdListingPreviewOnly).toBe(true);
    for (const capabilityId of expected) {
      expect(capabilities.get(capabilityId)).toEqual(expect.objectContaining({
        capabilityId,
        blockerCode: 'DEV_PREVIEW_ONLY',
        state: 'PROTOTYPE_ONLY',
      }));
    }
  });

  it('keeps versioned product CRUD isolated by the complete active StoreContext', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
    const stores = await api.listStores();
    const firstView = await api.switchStore(stores[0].storeId);
    const first = await api.createStoreProduct(firstView.context, {
      asin: 'B0PREVIEW9',
      title: 'First preview store product',
      marketplace: 'US',
      currency: 'USD',
      cost: { currentPrice: 39.99, purchaseCost: 8.5, targetAcos: 0.3 },
    });

    expect(first).toEqual(expect.objectContaining({
      storeId: stores[0].storeId,
      store_name: stores[0].displayName,
      marketplace_code: 'US',
      asin: 'B0PREVIEW9',
      title: 'First preview store product',
      status: 'active',
      revision: expect.stringMatching(/^product-v1:[a-f0-9]{64}$/),
      cost: expect.objectContaining({ currentPrice: 39.99, purchaseCost: 8.5, targetAcos: 0.3 }),
    }));

    const secondView = await api.switchStore(stores[1].storeId);
    const second = await api.createStoreProduct(secondView.context, {
      asin: 'B0PREVIEW9',
      title: 'Second preview store product',
    });
    expect(second).toEqual(expect.objectContaining({
      storeId: stores[1].storeId,
      asin: 'B0PREVIEW9',
      title: 'Second preview store product',
    }));
    expect(second.id).not.toBe(first.id);
    expect(await api.listStoreProducts(secondView.context)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: second.id, storeId: stores[1].storeId }),
    ]));
    expect((await api.listStoreProducts(secondView.context)).some((row: any) => row.id === first.id)).toBe(false);
    await expect(api.listStoreProducts(firstView.context)).rejects.toThrow('PREVIEW_MISSION_CONTROL_STORE_CONTEXT_MISMATCH');

    const refreshedFirst = await api.switchStore(stores[0].storeId);
    const current = (await api.listStoreProducts(refreshedFirst.context, { includeArchived: true }))
      .find((row: any) => row.id === first.id);
    const updated = await api.updateStoreProduct(refreshedFirst.context, {
      id: current.id,
      expectedRevision: current.revision,
      patch: { title: 'First product updated', marketplace: 'US', currency: 'USD' },
      cost: { currentPrice: 42.5 },
    });
    expect(updated).toEqual(expect.objectContaining({
      id: first.id,
      title: 'First product updated',
      cost: expect.objectContaining({ currentPrice: 42.5, purchaseCost: 8.5 }),
    }));
    expect(updated.revision).not.toBe(current.revision);
    await expect(api.updateStoreProduct(refreshedFirst.context, {
      id: first.id,
      expectedRevision: current.revision,
      patch: { title: 'Stale overwrite' },
    })).rejects.toThrow(/revision|版本|冲突/i);

    const archived = await api.archiveStoreProduct(refreshedFirst.context, {
      id: first.id,
      expectedRevision: updated.revision,
    });
    expect(archived.status).toBe('archived');
    expect((await api.listStoreProducts(refreshedFirst.context)).some((row: any) => row.id === first.id)).toBe(false);
    expect(await api.getStoreProduct(refreshedFirst.context, { id: first.id })).toEqual(
      expect.objectContaining({ id: first.id, status: 'archived' }),
    );
  });

  it('supports store-owned operation-event CRUD with revision CAS', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
    const stores = await api.listStores();
    const firstView = await api.switchStore(stores[0].storeId);
    const created = await api.createStoreOperationEvent(firstView.context, {
      eventDate: firstView.context.businessDate,
      eventType: 'coupon',
      title: 'Preview coupon launched',
      asin: 'B0EVENT001',
      impactExpectation: 'conversion_up',
      notes: 'Track this store only.',
      marketplace: 'US',
      currency: 'USD',
    });
    expect(created).toEqual(expect.objectContaining({
      storeId: stores[0].storeId,
      storeName: stores[0].displayName,
      marketplaceCode: 'US',
      eventDate: firstView.context.businessDate,
      title: 'Preview coupon launched',
      archiveRevision: 0,
      revision: expect.stringMatching(/^operation-event-v1:[a-f0-9]{64}$/),
    }));

    const updated = await api.updateStoreOperationEvent(firstView.context, {
      id: created.id,
      expectedRevision: created.revision,
      patch: { title: 'Preview coupon reviewed', notes: 'Keep observing ACOS.' },
    });
    expect(updated.title).toBe('Preview coupon reviewed');
    expect(updated.revision).not.toBe(created.revision);
    await expect(api.deleteStoreOperationEvent(firstView.context, {
      id: created.id,
      expectedRevision: created.revision,
    })).rejects.toThrow(/revision|版本|冲突/i);
    expect(await api.listStoreOperationEvents(firstView.context, {
      asin: 'b0event001', dateFrom: '2026-07-01', dateTo: '2026-07-31', limit: 20,
    })).toEqual([expect.objectContaining({ id: created.id, title: 'Preview coupon reviewed' })]);

    const secondView = await api.switchStore(stores[1].storeId);
    expect((await api.listStoreOperationEvents(secondView.context, { limit: 200 }))
      .some((row: any) => row.id === created.id)).toBe(false);
    const refreshedFirst = await api.switchStore(stores[0].storeId);
    const archived = await api.deleteStoreOperationEvent(refreshedFirst.context, {
      id: updated.id,
      expectedRevision: updated.revision,
    });
    expect(archived).toEqual(expect.objectContaining({
      id: updated.id,
      archivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      archiveRevision: 1,
      revision: expect.stringMatching(/^operation-event-v1:[a-f0-9]{64}$/),
    }));
    expect(archived.revision).not.toBe(updated.revision);
    expect((await api.listStoreOperationEvents(refreshedFirst.context, { limit: 200 }))
      .some((row: any) => row.id === updated.id)).toBe(false);
    expect(await api.listStoreOperationEvents(refreshedFirst.context, {
      includeArchived: true,
      limit: 200,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: updated.id, archiveRevision: 1 }),
    ]));
    await expect(api.listStoreOperationEvents(refreshedFirst.context, {
      includeArchived: 'yes',
    })).rejects.toThrow(/includeArchived/);
    await expect(api.updateStoreOperationEvent(refreshedFirst.context, {
      id: updated.id,
      expectedRevision: archived.revision,
      patch: { title: 'Archived overwrite' },
    })).rejects.toThrow(/归档|只读|恢复/);
    await expect(api.updateStoreOperationEvent(refreshedFirst.context, {
      id: updated.id,
      expectedRevision: archived.revision,
      patch: { archived: false, title: 'Restore and overwrite' },
    })).rejects.toThrow(/拆分|恢复/);
    const restored = await api.updateStoreOperationEvent(refreshedFirst.context, {
      id: updated.id,
      expectedRevision: archived.revision,
      patch: { archived: false },
    });
    expect(restored).toEqual(expect.objectContaining({
      id: updated.id,
      archiveRevision: 2,
      title: 'Preview coupon reviewed',
    }));
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.revision).not.toBe(archived.revision);
    expect((await api.listStoreOperationEvents(refreshedFirst.context, { limit: 200 }))
      .some((row: any) => row.id === updated.id)).toBe(true);
  });

  it('projects store-isolated US/USD advertising objects and keyword facts', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
    const stores = await api.listStores();
    const firstView = await api.switchStore(stores[0].storeId);
    const firstByKind = await Promise.all(
      ['campaign', 'ad_group', 'target', 'search_term'].map((kind) => (
        api.listStoreAdObjects(firstView.context, { kind, limit: 20 })
      )),
    );
    expect(firstByKind.every((rows) => rows.length > 0)).toBe(true);
    expect(firstByKind.flat().every((row: any) => (
      row.storeId === stores[0].storeId && row.marketplace === 'US' && row.currency === 'USD'
    ))).toBe(true);
    const firstTarget = firstByKind[2][0];
    expect(await api.listStoreAdObjects(firstView.context, {
      kind: 'target', asin: firstTarget.asin, query: firstTarget.name, limit: 5,
    })).toEqual([expect.objectContaining({ objectKey: firstTarget.objectKey })]);

    const firstKeywords = await api.listStoreKeywordFacts(firstView.context, { limit: 20 });
    expect(firstKeywords.length).toBeGreaterThan(0);
    expect(firstKeywords.every((row: any) => (
      row.storeId === stores[0].storeId && row.marketplace === 'US' && row.currency === 'USD'
    ))).toBe(true);
    expect(await api.listStoreKeywordFacts(firstView.context, {
      asin: firstKeywords[0].asin, query: firstKeywords[0].keyword, limit: 5,
    })).toEqual([expect.objectContaining({ keyword: firstKeywords[0].keyword })]);

    const secondView = await api.switchStore(stores[1].storeId);
    const secondTargets = await api.listStoreAdObjects(secondView.context, { kind: 'target', limit: 20 });
    const secondKeywords = await api.listStoreKeywordFacts(secondView.context, { limit: 20 });
    expect(secondTargets.every((row: any) => row.storeId === stores[1].storeId)).toBe(true);
    expect(secondKeywords.every((row: any) => row.storeId === stores[1].storeId)).toBe(true);
    expect(JSON.stringify({ secondTargets, secondKeywords })).not.toContain(firstTarget.asin);
    expect(JSON.stringify({ secondTargets, secondKeywords })).not.toContain(String(stores[0].storeId));
  });

  it('keeps Listing CRUD and durable versions isolated with revision CAS', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
    const stores = await api.listStores();
    const firstView = await api.switchStore(stores[0].storeId);
    const first = await api.createStoreListingContent(firstView.context, {
      asin: 'B0LISTP009',
      title: 'First store preview Listing',
      bullets: ['First bullet', 'Second bullet'],
      description: 'Store-owned description',
      backendTerms: 'preview listing',
      source: 'manual',
      versionLabel: 'v1',
      changeSummary: 'Created in DEV preview',
      marketplace: 'US',
      currency: 'USD',
    });
    expect(first).toEqual(expect.objectContaining({
      storeId: stores[0].storeId,
      storeName: stores[0].displayName,
      marketplace: 'US',
      currency: 'USD',
      asin: 'B0LISTP009',
      title: 'First store preview Listing',
      bullets: ['First bullet', 'Second bullet'],
      revision: expect.stringMatching(/^listing-content-v1:[a-f0-9]{64}$/),
    }));
    expect(await api.getStoreListingContent(firstView.context, { asin: 'b0listp009' }))
      .toEqual(expect.objectContaining({ id: first.id, storeId: stores[0].storeId }));
    expect(await api.listStoreListingContentVersions(firstView.context, {
      listingContentId: first.id, limit: 20,
    })).toEqual([expect.objectContaining({
      listingContentId: first.id,
      storeId: stores[0].storeId,
      asin: 'B0LISTP009',
      title: 'First store preview Listing',
    })]);

    const secondView = await api.switchStore(stores[1].storeId);
    const second = await api.createStoreListingContent(secondView.context, {
      asin: 'B0LISTP009', title: 'Second store preview Listing',
    });
    expect(second.storeId).toBe(stores[1].storeId);
    expect(second.id).not.toBe(first.id);
    expect((await api.listStoreListingContent(secondView.context, { limit: 250 }))
      .some((row: any) => row.id === first.id)).toBe(false);

    const refreshedFirst = await api.switchStore(stores[0].storeId);
    const current = await api.getStoreListingContent(refreshedFirst.context, { id: first.id });
    const updated = await api.updateStoreListingContent(refreshedFirst.context, {
      id: current.id,
      expectedRevision: current.revision,
      patch: {
        title: 'First store Listing updated',
        bullets: ['Updated bullet'],
        versionLabel: 'v2',
        changeSummary: 'Reviewed in DEV preview',
        marketplace: 'US',
        currency: 'USD',
      },
    });
    expect(updated.title).toBe('First store Listing updated');
    expect(updated.revision).not.toBe(current.revision);
    await expect(api.updateStoreListingContent(refreshedFirst.context, {
      id: first.id,
      expectedRevision: current.revision,
      patch: { title: 'Stale Listing overwrite' },
    })).rejects.toThrow(/revision|版本|冲突/i);
    expect(await api.listStoreListingContentVersions(refreshedFirst.context, {
      listingContentId: first.id, limit: 20,
    })).toHaveLength(2);

    expect(await api.deleteStoreListingContent(refreshedFirst.context, {
      id: first.id,
      expectedRevision: updated.revision,
    })).toEqual({ id: first.id, deleted: true });
    expect((await api.listStoreListingContent(refreshedFirst.context, { limit: 250 }))
      .some((row: any) => row.id === first.id)).toBe(false);
    expect(await api.listStoreListingContentVersions(refreshedFirst.context, {
      listingContentId: first.id, limit: 20,
    })).toHaveLength(2);
    const deletedHistoryInStoreLedger = await api.listStoreListingContentVersions(
      refreshedFirst.context,
      { limit: 100, offset: 0 },
    );
    expect(deletedHistoryInStoreLedger.filter((row: any) => row.listingContentId === first.id))
      .toHaveLength(2);
    expect(deletedHistoryInStoreLedger.every((row: any) => row.storeId === stores[0].storeId))
      .toBe(true);
    const [ledgerPageOne, ledgerPageTwo] = await Promise.all([
      api.listStoreListingContentVersions(refreshedFirst.context, { limit: 1, offset: 0 }),
      api.listStoreListingContentVersions(refreshedFirst.context, { limit: 1, offset: 1 }),
    ]);
    expect(ledgerPageOne).toHaveLength(1);
    expect(ledgerPageTwo).toHaveLength(1);
    expect(ledgerPageTwo[0].id).not.toBe(ledgerPageOne[0].id);
  });

  it('exposes a clearly marked empty collection-job bridge without inventing production records', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
    const [store] = await api.listStores();
    const view = await api.switchStore(store.storeId);

    expect(api.lingxingCollectionJobsPreviewOnly).toBe(true);
    expect(await api.listLingxingCollectionJobs({ storeContext: view.context, limit: 12 })).toEqual([]);
    await expect(api.resumeLingxingCollection({
      storeContext: view.context,
      jobId: 'preview-job-does-not-exist',
      requestId: 'lx:preview-resume',
    })).rejects.toThrow('开发预览没有可恢复的真实领星任务');
    await expect(api.cancelLingxingCollection({
      storeContext: view.context,
      jobId: 'preview-job-does-not-exist',
      requestId: 'lx:preview-cancel',
    })).rejects.toThrow('开发预览没有可取消的真实领星任务');
    expect(api.onLingxingCollectionProgress(() => undefined)()).toBeUndefined();
  });

  it('keeps canonical preview facts isolated when the authoritative store changes', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
    const stores = await api.listStores();

    const firstView = await api.switchStore(stores[0].storeId);
    const firstScope = await api.getOperationScope(firstView.context);
    const firstProducts = await api.listStoreProducts(firstView.context);
    const firstPipeline = await api.getBusinessUiDataPipeline();

    const secondView = await api.switchStore(stores[1].storeId);
    const secondScope = await api.getOperationScope(secondView.context);
    const secondProducts = await api.listStoreProducts(secondView.context);
    const secondPipeline = await api.getBusinessUiDataPipeline();

    expect(firstScope).toEqual(expect.objectContaining({ storeName: 'SHC001-US', currency: 'USD' }));
    expect(secondScope).toEqual(expect.objectContaining({ storeName: 'SHC002-US', currency: 'USD' }));
    expect(secondScope.storeName).not.toBe(firstScope.storeName);
    expect(secondScope.asin).not.toBe(firstScope.asin);
    expect(secondScope.batchId).not.toBe(firstScope.batchId);
    expect(secondProducts[0].asin).not.toBe(firstProducts[0].asin);
    expect(secondProducts.every((product: any) => product.store_name === stores[1].displayName)).toBe(true);
    expect(firstPipeline.scope.storeName).toBe(firstScope.storeName);
    expect(secondPipeline.scope.storeName).toBe(secondScope.storeName);
    expect(JSON.stringify(secondPipeline)).not.toContain(firstScope.storeName);
    expect(JSON.stringify(secondPipeline)).not.toContain('D:/preview/shc002/shc002/');

    const refreshedFirst = await api.switchStore(stores[0].storeId);
    expect(await api.getOperationScope(refreshedFirst.context)).toEqual(firstScope);
    expect((await api.listStoreProducts(refreshedFirst.context))[0].asin).toBe(firstProducts[0].asin);
  });

  it('binds all 16 legacy preview pages to their exact route projection without opening production', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
    const [store] = await api.listStores();
    const storeView = await api.switchStore(store.storeId);
    const response = await api.missionControl.query({
      query: 'workspace-bootstrap',
      requestId: 'preview-legacy-routes',
      contextEpoch: 2,
      context: storeView.context,
    });

    expect(new Set(LEGACY_PREVIEW_ROUTE_CASES.map(({ route }) => route))).toEqual(
      new Set(MISSION_CONTROL_LEGACY_ROUTE_IDS),
    );

    for (const { route, intent, view } of LEGACY_PREVIEW_ROUTE_CASES) {
      const capability = resolveLegacyCapability(response.data.capabilities, route, intent);
      expect(capability, `${view} should resolve ${route}`).toEqual(expect.objectContaining({
        action: 'view',
        legacyRoute: route,
        state: 'PROTOTYPE_ONLY',
        view,
        workspace: intent.workspace,
      }));

      const previewMarkup = renderToStaticMarkup(createElement(
        LegacyAdapterBoundary,
        {
          capability,
          children: createElement('span', null, `mounted:${view}`),
          intent,
          previewMode: true,
          route,
          storeContext: response.authoritativeContext,
        },
      ));
      expect(previewMarkup).toContain('仅开发预览');
      expect(previewMarkup).toContain(`mounted:${view}`);
    }

    const firstCase = LEGACY_PREVIEW_ROUTE_CASES[0];
    const previewCapability = resolveLegacyCapability(
      response.data.capabilities,
      firstCase.route,
      firstCase.intent,
    );
    const productionMarkup = renderToStaticMarkup(createElement(
      LegacyAdapterBoundary,
      {
        capability: previewCapability,
        children: createElement('span', null, 'must-not-mount-in-production'),
        intent: firstCase.intent,
        previewMode: false,
        route: firstCase.route,
        storeContext: response.authoritativeContext,
      },
    ));
    expect(productionMarkup).toContain('当前功能未放行');
    expect(productionMarkup).not.toContain('must-not-mount-in-production');
  });

  it('shares the explicit preview Policy runtime with the shell and strictly rejects extra request fields', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
    const [store] = await api.listStores();
    const view = await api.switchStore(store.storeId);
    const applied = await api.missionControl.command({
      command: 'set-autonomy-mode',
      requestId: 'preview-auto',
      contextEpoch: 1,
      context: view.context,
      payload: { mode: 'policy_auto' },
    });
    expect(applied).toEqual(expect.objectContaining({
      status: 'APPLIED',
      currentMode: 'policy_auto',
    }));
    expect(applied.detail).toMatch(/仅开发预览|不授权|不执行/);
    const refreshed = await api.missionControl.query({
      query: 'workspace-bootstrap', requestId: 'preview-auto-query', contextEpoch: 1, context: view.context,
    });
    expect(refreshed.data.autonomy).toEqual(expect.objectContaining({
      currentMode: 'policy_auto', policyAutoAvailable: true,
    }));

    await expect(api.missionControl.query({
      query: 'workspace-bootstrap',
      requestId: 'preview-extra',
      contextEpoch: 1,
      context: view.context,
      filePath: 'C:/not-allowed',
    })).rejects.toThrow(/unsupported field filePath/);
  });

  it('supports fixture CRUD without silently selecting a newly created store', async () => {
    const api = previewExports().createBrowserPreviewElectronApi!('SHC001', 'diagnosis-ready');
    const records: any[] = [];
    api.onStoresChanged((store: any) => records.push(store));
    const created = await api.createStore({
      displayName: 'SHC003', marketplace: 'CA', currency: 'CAD', businessTimezone: 'UTC',
    });

    expect(created).toEqual(expect.objectContaining({
      displayName: 'SHC003', marketplace: 'US', currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
    }));
    expect(await api.listStores()).toHaveLength(3);
    expect(await api.getActiveStoreContext()).toBeNull();
    expect(records).toHaveLength(1);
  });
});
