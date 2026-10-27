import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  dashboardDecisionSummary,
  dashboardProductWorkbenchAction,
  dashboardSelectProductHistory,
  dashboardRiskObjectLabel,
  dashboardRiskObjectQueue,
  dashboardRiskObjectFallbackCopy,
  dashboardRiskObjectPrimaryAction,
  dashboardRiskObjectSecondaryAction,
  dashboardRiskObjectTone,
} from './dashboard-page';
import type {
  ProductHistoryLedgerView,
} from '../types';
import { dashboardDiagnostic } from './dashboard-page.test-fixtures';

describe('dashboard risk object semantics', () => {
  it.each([
    { row: dashboardDiagnostic({ quantStatus: 'healthy', severity: 'low' }), label: '健康', tone: 'ready' },
    { row: dashboardDiagnostic({ quantStatus: 'scale', severity: 'low' }), label: '可扩量', tone: 'ready' },
    { row: dashboardDiagnostic({ quantStatus: 'watch', severity: 'medium' }), label: '待复核', tone: 'warning' },
    { row: dashboardDiagnostic({ quantStatus: 'waste', severity: 'high' }), label: '高风险', tone: 'blocked' },
  ])('maps $label objects to their real operator-facing state', ({ row, label, tone }) => {
    expect(dashboardRiskObjectLabel(row)).toBe(label);
    expect(dashboardRiskObjectTone(row)).toBe(tone);
  });

  it('does not report healthy and scalable objects as red risks or review work', () => {
    const queue = dashboardRiskObjectQueue({
      diagnostics: [
        dashboardDiagnostic({ objectName: '健康对象', quantStatus: 'healthy', severity: 'low', spend: 200 }),
        dashboardDiagnostic({ objectName: '扩量对象', quantStatus: 'scale', severity: 'low', spend: 150 }),
      ],
      isQuantifiable: true,
    });

    expect(queue.rows).toEqual([]);
    expect(queue.status).toEqual({ tone: 'ready', label: '暂无风险对象' });
  });

  it('filters ready objects before limiting and prioritizes real risk over spend', () => {
    const queue = dashboardRiskObjectQueue({
      diagnostics: [
        dashboardDiagnostic({ objectName: '健康高花费', quantStatus: 'healthy', severity: 'low', spend: 500 }),
        dashboardDiagnostic({ objectName: '可扩量高花费', quantStatus: 'scale', severity: 'low', spend: 400 }),
        dashboardDiagnostic({ objectName: '普通待复核', quantStatus: 'watch', severity: 'medium', spend: 50 }),
        dashboardDiagnostic({ objectName: '低花费高风险', quantStatus: 'waste', severity: 'high', spend: 1 }),
      ],
      isQuantifiable: true,
      limit: 2,
    });

    expect(queue.rows.map((row) => row.objectName)).toEqual(['低花费高风险', '普通待复核']);
    expect(queue.status).toEqual({ tone: 'blocked', label: '2 个待看' });
  });

  it('reports the full attention count even when the visible risk queue is limited', () => {
    const queue = dashboardRiskObjectQueue({
      diagnostics: Array.from({ length: 7 }, (_, index) => dashboardDiagnostic({
        objectName: `待复核对象 ${index + 1}`,
        quantStatus: 'watch',
        severity: 'medium',
        spend: index + 1,
      })),
      isQuantifiable: true,
      limit: 2,
    });

    expect(queue.rows).toHaveLength(2);
    expect(queue.status).toEqual({ tone: 'warning', label: '7 个待看' });
  });
});

describe('dashboard decision summary', () => {
  it('prioritizes current decisions and explains their pending and review split', () => {
    expect(dashboardDecisionSummary({
      actionRecommendationCount: 3,
      reviewRecommendationCount: 1,
      approvedRecommendationCount: 2,
      canGenerateFormalRecommendations: true,
    })).toEqual({
      value: '3 条',
      detail: '2 条待审批，1 条需人工复核',
    });
  });

  it('does not report decided recommendations as waiting to be generated', () => {
    expect(dashboardDecisionSummary({
      actionRecommendationCount: 0,
      reviewRecommendationCount: 0,
      approvedRecommendationCount: 2,
      canGenerateFormalRecommendations: true,
    })).toEqual({
      value: '0 条',
      detail: '已决策 2 条，批准不等于执行',
    });
  });

  it.each([
    {
      canGenerateFormalRecommendations: true,
      expectedDetail: '当前数据已可生成判断',
    },
    {
      canGenerateFormalRecommendations: false,
      expectedDetail: '先完成真实数据与量化门槛',
    },
  ])('uses truthful generation guidance when no current or decided recommendations exist', ({
    canGenerateFormalRecommendations,
    expectedDetail,
  }) => {
    expect(dashboardDecisionSummary({
      actionRecommendationCount: 0,
      reviewRecommendationCount: 0,
      approvedRecommendationCount: 0,
      canGenerateFormalRecommendations,
    })).toEqual({
      value: '待生成',
      detail: expectedDetail,
    });
  });
});

describe('dashboard product workbench', () => {
  const ledgers = [
    {
      asin: 'B001',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-02',
      activeDays: 1,
      inferredStage: 'keyword_exploration',
      stageReasons: [],
      daily: [],
      totals: { impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0, acos: 0, cpc: 0, cvr: 0, currency: 'USD' },
      events: [],
    },
    {
      asin: 'B002',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-02',
      activeDays: 1,
      inferredStage: 'keyword_exploration',
      stageReasons: [],
      daily: [],
      totals: { impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0, acos: 0, cpc: 0, cvr: 0, currency: 'USD' },
      events: [],
    },
  ] satisfies ProductHistoryLedgerView[];

  it('does not silently use the first product when no global ASIN is selected', () => {
    expect(dashboardSelectProductHistory(ledgers, '')).toBeUndefined();
  });

  it('uses the selected global ASIN for the product history ledger', () => {
    expect(dashboardSelectProductHistory(ledgers, 'b002')?.asin).toBe('B002');
  });

  it('routes the dashboard primary task to product management before product-scoped work', () => {
    expect(dashboardProductWorkbenchAction({
      scopeAsin: '',
      baseAction: { route: 'ad-quant', label: '查看广告表现', title: '可以分析：真实报表和日级指标已闭合' },
    })).toEqual({
      route: 'product-management',
      label: '选择产品',
      title: '先锁定产品上下文',
    });
  });
});

describe('dashboardRiskObjectFallbackCopy', () => {
  it('describes a quantified all-ready queue as having no risk objects', () => {
    expect(dashboardRiskObjectFallbackCopy({
      isQuantifiable: true,
      hasRealFiles: true,
      importedRows: 96,
      actionableRows: 7,
    })).toBe('当前范围暂无风险对象。');
  });

  it('describes imported metrics without actionable objects as a quant review gap', () => {
    const copy = dashboardRiskObjectFallbackCopy({
      isQuantifiable: false,
      hasRealFiles: true,
      importedRows: 96,
      actionableRows: 0,
    });

    expect(copy).toContain('已有导入指标');
    expect(copy).toContain('没有可行动对象');
    expect(copy).toContain('量化口径');
    expect(copy).not.toContain('缺少真实广告表格');
    expect(copy).not.toContain('缺少真实广告表格和导入指标');
    expect(copy).not.toContain('建议');
  });
});

describe('dashboardRiskObjectPrimaryAction', () => {
  it('enables quant review for imported rows with no actionable objects even when formal gates fail', () => {
    expect(dashboardRiskObjectPrimaryAction({
      isQuantifiable: false,
      gateRoute: 'ad-quant',
      gateLabel: '复核量化口径',
    })).toEqual({
      route: 'ad-quant',
      label: '复核量化口径',
      disabled: false,
    });
  });

  it('keeps the quant details action after formal gates pass', () => {
    expect(dashboardRiskObjectPrimaryAction({
      isQuantifiable: true,
      gateRoute: 'ad-quant',
      gateLabel: '复核广告表现',
    })).toEqual({
      route: 'ad-quant',
      label: '查看广告表现',
      disabled: false,
    });
  });
});

describe('dashboardRiskObjectSecondaryAction', () => {
  it('omits secondary action when it duplicates the pre-gate primary route', () => {
    expect(dashboardRiskObjectSecondaryAction({
      isQuantifiable: false,
      primaryAction: {
        route: 'ad-quant',
        label: '复核量化口径',
        disabled: false,
      },
      secondaryAction: {
        route: 'ad-quant',
        label: '复核量化口径',
        disabled: false,
      },
    })).toBeNull();
  });

  it('keeps the secondary action after formal gates pass', () => {
    expect(dashboardRiskObjectSecondaryAction({
      isQuantifiable: true,
      primaryAction: {
        route: 'ad-quant',
        label: '查看广告表现',
        disabled: false,
      },
      secondaryAction: {
        route: 'recommendations',
        label: '生成优化建议',
        disabled: false,
      },
    })).toEqual({
      route: 'recommendations',
      label: '生成优化建议',
      disabled: false,
    });
  });
});
