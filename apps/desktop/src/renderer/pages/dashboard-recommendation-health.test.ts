import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  dashboardRecommendationHealthCopy,
  dashboardRecommendationHealthSummary,
  dashboardRecommendationStatusFilters,
  dashboardSecondaryRecommendationAction,
  dashboardTaskRecommendationMetric,
} from './dashboard-page';

describe('dashboardRecommendationStatusFilters', () => {
  it('loads both approvable and review-only recommendations for the dashboard queue', () => {
    expect(dashboardRecommendationStatusFilters()).toEqual(['pending', 'needs_review']);
  });
});

describe('dashboardRecommendationHealthCopy', () => {
  it('gates recommendation page copy behind data and quantification readiness', () => {
    const detail = dashboardRecommendationHealthCopy({
      isQuantifiable: false,
      gateRoute: 'data-collection',
      gateLabel: '补齐真实报表',
      aiWorkStatus: {
        label: 'AI 已产出建议',
        detail: '最近一次 AI 诊断形成 2 条正式建议，另有 1 条洞察。继续到优化建议页查看证据和审批状态。',
        tone: 'ready',
        route: 'recommendations',
        actionLabel: '去建议页',
      },
      actionRecommendationCount: 3,
      pendingRecommendationCount: 2,
      reviewRecommendationCount: 1,
    });

    expect(detail).not.toContain('建议页');
    expect(detail).not.toContain('待审批');
    expect(detail).not.toContain('去建议页');
    expect(detail).not.toContain('建议');
    expect(detail).toContain('数据');
    expect(detail).toContain('补齐真实报表');
  });

  it('uses report wording before files are collected', () => {
    const detail = dashboardRecommendationHealthCopy({
      isQuantifiable: false,
      gateRoute: 'data-collection',
      gateLabel: '先下载真实报表',
      aiWorkStatus: {
        label: 'AI 已产出建议',
        detail: '不应透出',
        tone: 'ready',
      },
      actionRecommendationCount: 3,
      pendingRecommendationCount: 2,
      reviewRecommendationCount: 1,
    });

    expect(detail).toContain('先下载真实报表');
    expect(detail).not.toContain('量化口径');
    expect(detail).not.toContain('建议');
  });

  it('uses import wording when reports are complete but rows are missing', () => {
    const detail = dashboardRecommendationHealthCopy({
      isQuantifiable: false,
      gateRoute: 'data-import-validation',
      gateLabel: '导入广告指标',
      aiWorkStatus: {
        label: 'AI 已产出建议',
        detail: '不应透出',
        tone: 'ready',
      },
      actionRecommendationCount: 3,
      pendingRecommendationCount: 2,
      reviewRecommendationCount: 1,
    });

    expect(detail).toContain('导入广告指标');
    expect(detail).not.toContain('量化口径');
    expect(detail).not.toContain('建议');
  });

  it('keeps recommendation counts after formal quantification passes', () => {
    expect(dashboardRecommendationHealthCopy({
      isQuantifiable: true,
      gateRoute: 'ad-quant',
      gateLabel: '复核广告表现',
      aiWorkStatus: {
        label: 'AI 已产出建议',
        detail: '最近一次 AI 诊断形成 2 条正式建议，另有 1 条洞察。继续到优化建议页查看证据和审批状态。',
        tone: 'ready',
      },
      actionRecommendationCount: 3,
      pendingRecommendationCount: 2,
      reviewRecommendationCount: 1,
    })).toBe('2 条待审批，1 条需复核。');
  });
});

describe('dashboardRecommendationHealthSummary', () => {
  it('hides produced-recommendation labels before formal gates pass', () => {
    const summary = dashboardRecommendationHealthSummary({
      isQuantifiable: false,
      gateRoute: 'ad-quant',
      gateLabel: '复核量化口径',
      aiWorkStatus: {
        label: 'AI 已产出建议',
        detail: '最近一次 AI 诊断形成 2 条正式建议，另有 1 条洞察。继续到优化建议页查看证据和审批状态。',
        tone: 'ready',
        route: 'recommendations',
        actionLabel: '去建议页',
      },
      actionRecommendationCount: 3,
      pendingRecommendationCount: 2,
      reviewRecommendationCount: 1,
    });
    const copy = `${summary.label} ${summary.detail}`;

    expect(summary.label).not.toContain('已产出建议');
    expect(copy).not.toContain('建议');
    expect(copy).not.toContain('待审批');
    expect(copy).not.toContain('建议页');
    expect(copy).toContain('量化门槛');
  });

  it('keeps AI work label and recommendation detail after formal gates pass', () => {
    expect(dashboardRecommendationHealthSummary({
      isQuantifiable: true,
      gateRoute: 'ad-quant',
      gateLabel: '复核广告表现',
      aiWorkStatus: {
        label: 'AI 已产出建议',
        detail: '最近一次 AI 诊断形成 2 条正式建议，另有 1 条洞察。继续到优化建议页查看证据和审批状态。',
        tone: 'ready',
      },
      actionRecommendationCount: 3,
      pendingRecommendationCount: 2,
      reviewRecommendationCount: 1,
    })).toEqual({
      label: 'AI 已产出建议',
      detail: '2 条待审批，1 条需复核。',
    });
  });
});

describe('dashboardTaskRecommendationMetric', () => {
  it('defers recommendation counts in the primary task metrics until formal gates pass', () => {
    const metric = dashboardTaskRecommendationMetric({
      isQuantifiable: false,
      gateRoute: 'ad-quant',
      gateLabel: '复核量化口径',
      actionRecommendationCount: 3,
      pendingRecommendationCount: 2,
      reviewRecommendationCount: 1,
    });

    expect(metric).toBe('量化门槛未闭合，复核量化口径');
    expect(metric).not.toContain('建议');
    expect(metric).not.toContain('待审批');
    expect(metric).not.toContain('需复核');
    expect(metric).not.toContain('建议页');
  });

  it('uses the gate action wording for deferred primary task metrics', () => {
    expect(dashboardTaskRecommendationMetric({
      isQuantifiable: false,
      gateRoute: 'data-collection',
      gateLabel: '先下载真实报表',
      actionRecommendationCount: 3,
      pendingRecommendationCount: 2,
      reviewRecommendationCount: 1,
    })).toBe('数据门槛未闭合，先下载真实报表');
    expect(dashboardTaskRecommendationMetric({
      isQuantifiable: false,
      gateRoute: 'data-import-validation',
      gateLabel: '导入广告指标',
      actionRecommendationCount: 3,
      pendingRecommendationCount: 2,
      reviewRecommendationCount: 1,
    })).toBe('数据门槛未闭合，导入广告指标');
  });

  it('keeps recommendation counts in the primary task metrics after formal gates pass', () => {
    expect(dashboardTaskRecommendationMetric({
      isQuantifiable: true,
      gateRoute: 'ad-quant',
      gateLabel: '复核广告表现',
      actionRecommendationCount: 3,
      pendingRecommendationCount: 2,
      reviewRecommendationCount: 1,
    })).toBe('2 条待审批 / 1 条需复核');
  });

  it('omits recommendation metric when there are no recommendation counts', () => {
    expect(dashboardTaskRecommendationMetric({
      isQuantifiable: false,
      gateRoute: 'data-collection',
      gateLabel: '先下载真实报表',
      actionRecommendationCount: 0,
      pendingRecommendationCount: 0,
      reviewRecommendationCount: 0,
    })).toBeNull();
  });
});

describe('dashboardSecondaryRecommendationAction', () => {
  it('keeps the secondary recommendation button on the quant gate before formal readiness', () => {
    const action = dashboardSecondaryRecommendationAction({
      isQuantifiable: false,
      gateRoute: 'ad-quant',
      gateLabel: '复核量化口径',
    });

    expect(action.route).toBe('ad-quant');
    expect(action.label).toBe('复核量化口径');
    expect(action.label).not.toContain('建议');
    expect(action.disabled).toBe(false);
  });

  it('routes to recommendations only after formal readiness passes', () => {
    expect(dashboardSecondaryRecommendationAction({
      isQuantifiable: true,
      gateRoute: 'ad-quant',
      gateLabel: '复核广告表现',
    })).toEqual({
      route: 'recommendations',
      label: '生成优化建议',
      disabled: false,
    });
  });
});
