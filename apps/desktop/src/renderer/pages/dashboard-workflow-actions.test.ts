import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  readFileSync,
} from 'node:fs';
import {
  dashboardAiStatus,
  dashboardAiWorkStatus,
  dashboardOpenArtifactButtonView,
  dashboardPrimaryTaskAction,
  dashboardPrimaryTaskNavigationFeedback,
  dashboardWorkflowCollectStep,
  dashboardWorkflowPostQuantSteps,
  dashboardWorkflowRecommendationRoute,
  dashboardWorkflowQuantNext,
} from './dashboard-page';
import type {
  AiDiagnosisRunView,
} from '../types';

describe('dashboardWorkflowRecommendationRoute', () => {
  it('does not route the recommendations workflow step to recommendations before quantification passes', () => {
    expect(dashboardWorkflowRecommendationRoute({
      canGenerateFormalRecommendations: false,
      fallbackRoute: 'ad-quant',
    })).toBe('ad-quant');

    expect(dashboardWorkflowRecommendationRoute({
      canGenerateFormalRecommendations: false,
      fallbackRoute: 'data-import-validation',
    })).toBe('data-import-validation');
  });

  it('routes to recommendations only after formal quantification passes', () => {
    expect(dashboardWorkflowRecommendationRoute({
      canGenerateFormalRecommendations: true,
      fallbackRoute: 'data-import-validation',
    })).toBe('recommendations');
  });
});

describe('dashboardWorkflowQuantNext', () => {
  it('routes imported metrics with no actionable rows to quant review instead of import validation', () => {
    expect(dashboardWorkflowQuantNext({
      canGenerateFormalRecommendations: false,
      hasMetrics: true,
      hasRealFiles: true,
      realReportCount: 8,
      importedReportTypeCount: 8,
      importedRows: 96,
      actionableRows: 0,
    })).toEqual({
      route: 'ad-quant',
      label: '复核量化口径',
    });
  });

  it('routes imported rows with no actionable rows to quant review even if metrics flag is false', () => {
    expect(dashboardWorkflowQuantNext({
      canGenerateFormalRecommendations: false,
      hasMetrics: false,
      hasRealFiles: true,
      realReportCount: 8,
      importedReportTypeCount: 8,
      importedRows: 96,
      actionableRows: 0,
    })).toEqual({
      route: 'ad-quant',
      label: '复核量化口径',
    });
  });
});

describe('dashboardWorkflowPostQuantSteps', () => {
  it('removes recommendation approval and readback titles before formal gates pass', () => {
    const steps = dashboardWorkflowPostQuantSteps({
      isQuantifiable: false,
      fallbackRoute: 'ad-quant',
    });
    const copy = steps.map((step) => `${step.title} ${step.status} ${step.next}`).join(' ');

    expect(copy).not.toContain('建议');
    expect(copy).not.toContain('审批');
    expect(copy).not.toContain('回读');
    expect(steps.map((step) => step.route)).toEqual(['ad-quant', 'ad-quant']);
  });

  it('keeps recommendation approval and readback titles after formal gates pass', () => {
    expect(dashboardWorkflowPostQuantSteps({
      isQuantifiable: true,
      fallbackRoute: 'ad-quant',
    }).map((step) => step.title)).toEqual([
      '3. 生成建议',
      '4. 审批与结果核对',
    ]);
  });
});

describe('dashboardWorkflowCollectStep', () => {
  it('points the collect workflow step to quant review when files exist but no actionable objects exist', () => {
    const step = dashboardWorkflowCollectStep({
      isQuantifiable: false,
      hasRealFiles: true,
      gateRoute: 'ad-quant',
      gateLabel: '复核量化口径',
    });

    expect(step.route).toBe('ad-quant');
    expect(step.next).toBe('复核量化口径');
    expect(step.next).not.toContain('采集');
    expect(step.next).not.toContain('导入');
  });

  it('keeps collect workflow on data collection when real files are missing', () => {
    expect(dashboardWorkflowCollectStep({
      isQuantifiable: false,
      hasRealFiles: false,
      gateRoute: 'data-collection',
      gateLabel: '先下载报表',
    })).toMatchObject({
      route: 'data-collection',
      next: '去数据采集',
    });
  });

  it('routes collect workflow to import validation when files exist but rows are not imported', () => {
    expect(dashboardWorkflowCollectStep({
      isQuantifiable: false,
      hasRealFiles: true,
      gateRoute: 'data-import-validation',
      gateLabel: '去导入校验',
    })).toMatchObject({
      route: 'data-import-validation',
      next: '去导入校验',
    });
  });
});

describe('dashboardPrimaryTaskAction', () => {
  it('routes missing reports to data collection', () => {
    expect(dashboardPrimaryTaskAction({
      canGenerateFormalRecommendations: false,
      hasRealFiles: false,
      hasMetrics: false,
      realReportCount: 0,
      importedRows: 0,
      actionableRows: 0,
      pendingRecommendationCount: 0,
      reviewRecommendationCount: 0,
    }).route).toBe('data-collection');
  });

  it('routes real reports without imported metrics to import validation', () => {
    expect(dashboardPrimaryTaskAction({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: false,
      realReportCount: 8,
      importedRows: 0,
      actionableRows: 0,
      pendingRecommendationCount: 0,
      reviewRecommendationCount: 0,
    }).route).toBe('data-import-validation');
  });

  it('routes imported rows with no actionable rows to quant review even when metrics flag is false', () => {
    const action = dashboardPrimaryTaskAction({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: false,
      realReportCount: 8,
      importedReportTypeCount: 8,
      importedRows: 96,
      actionableRows: 0,
      pendingRecommendationCount: 2,
      reviewRecommendationCount: 1,
    });

    expect(action.route).toBe('ad-quant');
    expect(`${action.title} ${action.label}`).toContain('量化口径');
  });

  it('keeps recommendation counts behind missing data gates', () => {
    const partialReports = dashboardPrimaryTaskAction({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: true,
      realReportCount: 3,
      importedRows: 512,
      actionableRows: 12,
      pendingRecommendationCount: 2,
      reviewRecommendationCount: 1,
    });

    expect(partialReports.route).toBe('data-collection');

    const noActionableRows = dashboardPrimaryTaskAction({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: true,
      realReportCount: 8,
      importedReportTypeCount: 8,
      importedRows: 96,
      actionableRows: 0,
      pendingRecommendationCount: 2,
      reviewRecommendationCount: 1,
    });

    expect(noActionableRows.route).toBe('ad-quant');
    expect(`${noActionableRows.title} ${noActionableRows.label}`).toContain('量化口径');
    expect(`${noActionableRows.title} ${noActionableRows.label}`).not.toContain('可以分析');
  });

  it('routes analyzable data to ad quantification by default', () => {
    expect(dashboardPrimaryTaskAction({
      canGenerateFormalRecommendations: true,
      hasRealFiles: true,
      hasMetrics: true,
      realReportCount: 8,
      importedReportTypeCount: 8,
      importedRows: 96,
      actionableRows: 12,
      pendingRecommendationCount: 0,
      reviewRecommendationCount: 0,
    }).route).toBe('ad-quant');
  });

  it('routes pending recommendations before review recommendations only after formal data gates pass', () => {
    expect(dashboardPrimaryTaskAction({
      canGenerateFormalRecommendations: true,
      hasRealFiles: true,
      hasMetrics: true,
      realReportCount: 8,
      importedReportTypeCount: 8,
      importedRows: 96,
      actionableRows: 12,
      pendingRecommendationCount: 2,
      reviewRecommendationCount: 3,
    }).route).toBe('approval');

    expect(dashboardPrimaryTaskAction({
      canGenerateFormalRecommendations: true,
      hasRealFiles: true,
      hasMetrics: true,
      realReportCount: 8,
      importedReportTypeCount: 8,
      importedRows: 96,
      actionableRows: 12,
      pendingRecommendationCount: 0,
      reviewRecommendationCount: 3,
    }).route).toBe('recommendations');
  });
});

describe('dashboardPrimaryTaskNavigationFeedback', () => {
  it('morphs the dashboard primary task action into a short jump feedback state', () => {
    const idle = dashboardPrimaryTaskNavigationFeedback({
      action: {
        route: 'recommendations',
        label: '去优化建议',
        title: '可以分析：有建议需复核',
      },
      pendingRoute: null,
    });

    expect(idle).toEqual({
      label: '去优化建议',
      busy: false,
      busyLabel: undefined,
      disabled: false,
    });

    const jumping = dashboardPrimaryTaskNavigationFeedback({
      action: {
        route: 'recommendations',
        label: '去优化建议',
        title: '可以分析：有建议需复核',
      },
      pendingRoute: 'recommendations',
    });

    expect(jumping).toEqual({
      label: '去优化建议',
      busy: true,
      busyLabel: '转跳中...',
      disabled: true,
    });
  });

  it('wires the authoritative NextSafeAction directly into the Today task banner', () => {
    const source = readFileSync(new URL('./dashboard-workspace.tsx', import.meta.url), 'utf8');

    expect(source).toContain('DashboardPage({ nextSafeAction }');
    expect(source).toContain('<TaskBanner');
    expect(source).toContain('title={nextSafeAction.label}');
    expect(source).toContain('description={nextSafeAction.reason}');
    expect(source).toContain('onClick: () => navigate(nextSafeAction.intent)');
    expect(source).not.toContain('const primaryTaskAction = dashboardProductWorkbenchAction({');
    expect(source).not.toContain('<PageHeader');
  });

  it('keeps the product context as a compact dashboard entry instead of a full workbench panel', () => {
    const source = readFileSync(new URL('./dashboard-workspace.tsx', import.meta.url), 'utf8');

    expect(source).toContain('aria-label="当前产品上下文"');
    expect(source).toContain('workbench-context-bar');
    expect(source).not.toContain('title="产品工作台"');
  });

  it('keeps the dashboard overview low-noise instead of rendering KPI card walls', () => {
    const source = readFileSync(new URL('./dashboard-workspace.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<SummaryStrip');
    expect(source).toContain("label: '逐类入库'");
    expect(source).toContain('value: `${importedReportTypeCount}/8 类`');
    expect(source).toContain('`报表文件 ${realReportCount}/8 类 · ${importedRows} 行`');
    expect(source).not.toContain("label: '真实数据',\n                value: `${realReportCount}/8 类`");
    expect(source).toContain('<WorkbenchPanel');
    expect(source).toContain('dashboard-history-summary-grid');
    expect(source).not.toContain('dashboard-overview-metrics');
    expect(source).not.toContain('dashboard-overview-status');
    expect(source).not.toContain('KpiCard');
    expect(source).not.toContain('dashboard-prototype-kpi-strip');
    expect(source).not.toContain('dashboard-prototype-status-grid');
  });

  it('keeps one single-layer technical disclosure for secondary status and evidence', () => {
    const source = readFileSync(new URL('./dashboard-workspace.tsx', import.meta.url), 'utf8');
    const disclosures = source.match(/<ProgressiveDetails\b/g) || [];

    expect(disclosures).toHaveLength(1);
    expect(source).toContain('workspace-technical-surface');
    expect(source).toContain('StateLightGrid');
  });
});

describe('dashboardOpenArtifactButtonView', () => {
  it('gives dashboard evidence artifact buttons active feedback and locks artifact peers', () => {
    const active = dashboardOpenArtifactButtonView({
      activeArtifactKey: '打开证据:artifact:v1:evidence',
      idleLabel: '打开',
      artifactKey: '打开证据:artifact:v1:evidence',
    });
    const locked = dashboardOpenArtifactButtonView({
      activeArtifactKey: '打开证据:artifact:v1:evidence',
      idleLabel: '打开',
      artifactKey: '打开清单:artifact:v1:manifest',
    });

    expect(active.label).toBe('打开中...');
    expect(active.disabled).toBe(true);
    expect(active.ariaBusy).toBe(true);
    expect(active.showSpinner).toBe(true);
    expect(active.className).toContain('button-loading');
    expect(locked.label).toBe('打开');
    expect(locked.disabled).toBe(true);
    expect(locked.ariaBusy).toBeUndefined();
    expect(locked.showSpinner).toBe(false);
  });

  it('opens collection evidence only through store-bound opaque artifacts', () => {
    const source = readFileSync(new URL('./dashboard-workspace.tsx', import.meta.url), 'utf8');
    expect(source).toContain('const open = (window as any).electronAPI?.openReportArtifact');
    expect(source).toContain("typeof open !== 'function'");
    expect(source).toContain('await open(artifactId, { ...storeContext })');
    expect(source).toContain('collection.evidenceArtifacts.map');
    expect(source).not.toContain('electronAPI?.openReportPath');
    expect(source).not.toContain('collection.evidencePaths');
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
