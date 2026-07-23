import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_CONFIG } from '@amazon-ai-ops/rules-engine';
import type { StoreRuntimeConfigProjection } from '@amazon-ai-ops/shared-types';
import { normalizeStoreId } from '@amazon-ai-ops/shared-types';
import {
  assertRuntimeAnalysisWindow,
  assertRuntimeConfigStore,
  recommendationMeetsStoreConfidence,
  requireStoreRuntimeAnalysisConfig,
  storeRuntimeRuleRevisionPayload,
} from './store-runtime-analysis-config';

const projection: StoreRuntimeConfigProjection = {
  current: {
    configId: 'store-config-store-a',
    storeId: normalizeStoreId('store-a'),
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    status: 'active',
    revision: 3,
    values: {
      aiRecommendationsEnabled: true,
      collectionScheduleLocalTime: '08:00',
      collectionLookbackDays: 14,
      analysisWindowDays: 30,
      defaultTargetAcosPercent: 32.5,
      minimumRecommendationConfidencePercent: 72,
      evidenceRetentionDays: 365,
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
  },
  versions: [],
};

describe('store runtime analysis config', () => {
  it('projects the store target ACOS while retaining the system fallback rule fields', () => {
    const runtime = requireStoreRuntimeAnalysisConfig(DEFAULT_RULE_CONFIG, projection);

    expect(runtime.ruleConfig).toMatchObject({
      ...DEFAULT_RULE_CONFIG,
      targetAcos: 0.325,
    });
    expect(runtime.minimumRecommendationConfidence).toBe(0.72);
    expect(storeRuntimeRuleRevisionPayload(runtime)).toMatchObject({
      storeId: 'store-a',
      analysisWindowDays: 30,
      defaultTargetAcosPercent: 32.5,
      minimumRecommendationConfidencePercent: 72,
      effectiveRuleConfig: { targetAcos: 0.325 },
    });
  });

  it('keeps collection and retention edits outside the analysis-rule fingerprint domain', () => {
    const runtime = requireStoreRuntimeAnalysisConfig(DEFAULT_RULE_CONFIG, projection);
    const operationalOnlyProjection: StoreRuntimeConfigProjection = {
      ...projection,
      current: {
        ...projection.current!,
        revision: 99,
        values: {
          ...projection.current!.values,
          collectionScheduleLocalTime: '22:30',
          collectionLookbackDays: 60,
          evidenceRetentionDays: 1825,
        },
      },
    };
    const operationalOnly = requireStoreRuntimeAnalysisConfig(DEFAULT_RULE_CONFIG, operationalOnlyProjection);

    expect(storeRuntimeRuleRevisionPayload(operationalOnly))
      .toEqual(storeRuntimeRuleRevisionPayload(runtime));
  });

  it('changes the analysis-rule fingerprint payload for effective rule, window or confidence edits', () => {
    const runtime = requireStoreRuntimeAnalysisConfig(DEFAULT_RULE_CONFIG, projection);
    for (const values of [
      { analysisWindowDays: 14 },
      { defaultTargetAcosPercent: 28 },
      { minimumRecommendationConfidencePercent: 85 },
    ]) {
      const changed = requireStoreRuntimeAnalysisConfig(DEFAULT_RULE_CONFIG, {
        ...projection,
        current: {
          ...projection.current!,
          values: { ...projection.current!.values, ...values },
        },
      });
      expect(storeRuntimeRuleRevisionPayload(changed))
        .not.toEqual(storeRuntimeRuleRevisionPayload(runtime));
    }
  });

  it('fails closed for missing or archived store configuration', () => {
    expect(() => requireStoreRuntimeAnalysisConfig(DEFAULT_RULE_CONFIG, { current: null, versions: [] }))
      .toThrow(/还没有运行配置/);
    expect(() => requireStoreRuntimeAnalysisConfig(DEFAULT_RULE_CONFIG, {
      ...projection,
      current: { ...projection.current!, status: 'archived' },
    })).toThrow(/已归档/);
  });

  it('binds store identity, analysis window and recommendation confidence', () => {
    const runtime = requireStoreRuntimeAnalysisConfig(DEFAULT_RULE_CONFIG, projection);

    expect(() => assertRuntimeConfigStore(runtime, normalizeStoreId('store-b'))).toThrow(/数据域不一致/);
    expect(() => assertRuntimeAnalysisWindow(runtime, '2026-06-03', '2026-07-02')).not.toThrow();
    expect(() => assertRuntimeAnalysisWindow(runtime, '2026-06-02', '2026-07-02')).toThrow(/超过店铺配置/);
    expect(recommendationMeetsStoreConfidence(0.72, runtime)).toBe(true);
    expect(recommendationMeetsStoreConfidence(0.719, runtime)).toBe(false);
  });
});
