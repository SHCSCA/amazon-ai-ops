import { describe, expect, it } from 'vitest';
import {
  dashboardAiStatus,
  dashboardAiWorkStatus,
  dashboardCanGenerateFormalRecommendations,
  dashboardDataActionQueueBlocker,
  dashboardDataGateDetail,
  dashboardDataGateLabel,
  dashboardRecommendationStatusFilters,
  dashboardTaskEntryStatus,
  dashboardWorkflowQuantNext,
  dashboardWorkflowQuantStatus,
} from './dashboard-page';
import type { AiDiagnosisRunView } from '../types';

describe('dashboardRecommendationStatusFilters', () => {
  it('loads both approvable and review-only recommendations for the dashboard queue', () => {
    expect(dashboardRecommendationStatusFilters()).toEqual(['pending', 'needs_review']);
  });
});

describe('dashboardDataGateDetail', () => {
  it('describes real-report coverage by report type instead of raw spreadsheet count', () => {
    expect(dashboardDataGateDetail({
      isQuantifiable: true,
      hasRealFiles: true,
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 12,
    })).toBe('8/8 类真实报表，96 行广告指标，其中 12 行可生成建议。');
  });

  it('uses the same report-type coverage wording before metrics are imported', () => {
    expect(dashboardDataGateDetail({
      isQuantifiable: false,
      hasRealFiles: true,
      realReportCount: 3,
      importedRows: 0,
      actionableRows: 0,
    })).toBe('3/8 类真实报表尚未导入量化指标。');
  });

  it('does not describe partial report coverage with imported metrics as formal recommendation ready', () => {
    expect(dashboardCanGenerateFormalRecommendations({
      realReportCount: 3,
      importedRows: 512,
      actionableRows: 12,
      hasImportedMetrics: true,
    })).toBe(false);

    expect(dashboardDataGateDetail({
      isQuantifiable: false,
      hasRealFiles: true,
      realReportCount: 3,
      importedRows: 512,
      actionableRows: 12,
    })).toBe('3/8 类真实报表已导入 512 行指标，但未达到正式建议门槛；需补齐 8 类真实报表。');

    expect(dashboardDataGateLabel({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      realReportCount: 3,
      importedRows: 512,
    })).toBe('已导入部分数据，待补齐报表');

    expect(dashboardTaskEntryStatus({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      realReportCount: 3,
      importedRows: 512,
    })).toBe('不可生成正式建议：当前只完成 3/8 类真实报表');

    expect(dashboardWorkflowQuantStatus({
      canGenerateFormalRecommendations: false,
      hasMetrics: true,
      realReportCount: 3,
      actionableRows: 12,
    })).toBe('12 行已导入但未达正式建议门槛');

    expect(dashboardWorkflowQuantNext({
      canGenerateFormalRecommendations: false,
      hasMetrics: true,
      hasRealFiles: true,
      realReportCount: 3,
    })).toEqual({
      route: 'data-collection',
      label: '补齐报表',
    });

    expect(dashboardDataActionQueueBlocker({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: true,
      realReportCount: 3,
    })).toEqual({
      title: '补齐 8 类真实报表',
      detail: '当前只完成 3/8 类真实报表；已有指标可用于预览，但不能生成正式优化建议。',
      route: 'data-collection',
      tone: 'blocked',
    });
  });
});

describe('dashboardAiStatus', () => {
  it('uses Chinese fallback copy when settings cannot be loaded', () => {
    expect(dashboardAiStatus(null).detail).toBe('设置接口不可用时，建议仍可使用规则兜底，但不会标记 AI 已参与。');
  });
});

describe('dashboardAiWorkStatus', () => {
  it('surfaces recent insight-only AI diagnosis as work output instead of only connection status', () => {
    const status = dashboardAiWorkStatus(dashboardAiStatus({
      aiKeyConfigured: true,
      aiBaseUrl: 'https://api.deepseek.com',
      aiModel: 'deepseek-v4-flash',
      aiLastTestBaseUrl: 'https://api.deepseek.com',
      aiLastTestModel: 'deepseek-v4-flash',
      aiLastTestStatus: 'available',
    }), [{
      id: 1,
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'v1',
      model: 'deepseek-v4-flash',
      scope: {},
      insights: [{
        entityType: 'search_term',
        entityName: 'door lock',
        actionType: 'lower_bid',
        reason: '证据不足',
        reasoningSteps: [],
        evidenceRefs: [],
        invalidReasons: ['缺少证据引用'],
        riskWarnings: [],
        confidence: 0.62,
      }],
      formalRecommendationCount: 0,
      success: true,
      createdAt: '2026-06-17T10:00:00.000Z',
    } as AiDiagnosisRunView]);

    expect(status.label).toBe('AI 有洞察待补证据');
    expect(status.detail).toContain('1 条洞察');
    expect(status.detail).toContain('未进入建议池');
    expect(status.detail).toContain('证据引用');
    expect(status.tone).toBe('warning');
    expect(status.route).toBe('ad-quant');
    expect(status.actionLabel).toBe('查看 AI 诊断');
  });
});
