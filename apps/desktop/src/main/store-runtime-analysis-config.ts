import type { RuleConfig } from '@amazon-ai-ops/rules-engine';
import type {
  StoreId,
  StoreRuntimeConfigProjection,
  StoreRuntimeConfigValues,
} from '@amazon-ai-ops/shared-types';

export class StoreRuntimeAnalysisConfigError extends Error {
  constructor(
    readonly code: 'MISSING' | 'ARCHIVED' | 'STORE_MISMATCH' | 'ANALYSIS_WINDOW_EXCEEDED',
    message: string,
  ) {
    super(message);
    this.name = 'StoreRuntimeAnalysisConfigError';
  }
}

export interface StoreRuntimeAnalysisConfig {
  storeId: StoreId;
  configRevision: number;
  values: StoreRuntimeConfigValues;
  ruleConfig: RuleConfig;
  minimumRecommendationConfidence: number;
}

export function requireStoreRuntimeAnalysisConfig(
  baseRuleConfig: RuleConfig,
  projection: StoreRuntimeConfigProjection,
): StoreRuntimeAnalysisConfig {
  const current = projection.current;
  if (!current) {
    throw new StoreRuntimeAnalysisConfigError(
      'MISSING',
      '当前店铺还没有运行配置；请先在系统设置中创建店铺级配置。',
    );
  }
  if (current.status !== 'active') {
    throw new StoreRuntimeAnalysisConfigError(
      'ARCHIVED',
      '当前店铺运行配置已归档；恢复配置后才能生成分析和建议。',
    );
  }
  return {
    storeId: current.storeId,
    configRevision: current.revision,
    values: current.values,
    ruleConfig: {
      ...baseRuleConfig,
      targetAcos: current.values.defaultTargetAcosPercent / 100,
    },
    minimumRecommendationConfidence: current.values.minimumRecommendationConfidencePercent / 100,
  };
}

export function assertRuntimeConfigStore(
  runtime: StoreRuntimeAnalysisConfig,
  expectedStoreId: StoreId,
): void {
  if (runtime.storeId !== expectedStoreId) {
    throw new StoreRuntimeAnalysisConfigError(
      'STORE_MISMATCH',
      '当前店铺运行配置与分析数据域不一致；请切回对应店铺后重新运行。',
    );
  }
}

export function assertRuntimeAnalysisWindow(
  runtime: StoreRuntimeAnalysisConfig,
  dateFrom: string,
  dateTo: string,
): void {
  const days = inclusiveUtcDateSpan(dateFrom, dateTo);
  if (days > runtime.values.analysisWindowDays) {
    throw new StoreRuntimeAnalysisConfigError(
      'ANALYSIS_WINDOW_EXCEEDED',
      `当前分析范围为 ${days} 天，超过店铺配置的 ${runtime.values.analysisWindowDays} 天上限。`,
    );
  }
}

export function recommendationMeetsStoreConfidence(
  confidence: number,
  runtime: StoreRuntimeAnalysisConfig,
): boolean {
  return Number.isFinite(confidence)
    && confidence >= runtime.minimumRecommendationConfidence;
}

export function storeRuntimeRuleRevisionPayload(runtime: StoreRuntimeAnalysisConfig): Record<string, unknown> {
  return {
    storeId: runtime.storeId,
    storeConfigRevision: runtime.configRevision,
    storeConfigValues: runtime.values,
    effectiveRuleConfig: runtime.ruleConfig,
  };
}

function inclusiveUtcDateSpan(dateFrom: string, dateTo: string): number {
  const start = Date.parse(`${dateFrom}T00:00:00.000Z`);
  const end = Date.parse(`${dateTo}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new TypeError('analysis date range must use ordered YYYY-MM-DD values');
  }
  return Math.floor((end - start) / 86_400_000) + 1;
}
