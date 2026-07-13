import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as PreviewModule from './dev-preview-api';

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
    createBrowserPreviewElectronApi?: (username: string, scenarioId?: PreviewScenarioId) => any;
  };
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
      const [scope, pipeline, recommendations, readback, delivery] = await Promise.all([
        api.getOperationScope(),
        api.getBusinessUiDataPipeline(),
        api.getRecommendations(),
        api.getDeliveryEvidenceStatus(),
        api.getDeliveryReadiness(),
      ]);

      expect(Boolean(scope)).toBe(scenario.scopeReady);
      expect(pipeline.collection.status === 'ready').toBe(scenario.reportsCollected);
      expect(pipeline.quant.hasImportedMetrics).toBe(scenario.reportsImported);
      expect(pipeline.quant.diagnostics.length > 0).toBe(scenario.diagnosisReady);
      expect(recommendations.length > 0).toBe(['mixed', 'approved'].includes(scenario.recommendationState));
      expect(readback.ready).toBe(scenario.readbackEvidenceReady);
      expect(delivery.previewReady).toBe(scenario.deliveryReady);
      expect(delivery.appReady).toBe(false);
      expect(delivery.previewOnly).toBe(true);
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

    expect(await mixedApi.getRecommendations({ status: 'pending' })).toHaveLength(1);
    expect(await mixedApi.getRecommendations({ status: 'needs_review' })).toHaveLength(1);
    expect(await mixedApi.getRecommendations({ status: 'approved' })).toEqual([]);
    expect(await approvedApi.getRecommendations({ status: 'pending' })).toEqual([]);
    expect(await approvedApi.getRecommendations({ status: 'approved' })).toHaveLength(2);
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

describe('App preview bootstrap integration', () => {
  it('installs preview API only through the explicit development bootstrap contract', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

    expect(source).toContain('bootstrapBrowserPreview');
    expect(source).toContain('dev: import.meta.env.DEV');
    expect(source).not.toContain('isBrowserPreviewHost');
    expect(source).not.toMatch(/window\.location\.hostname/);
    expect(source).not.toMatch(/electronAPI\s*=\s*createBrowserPreviewElectronApi/);
  });
});
