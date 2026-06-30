import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  dashboardAiStatus,
  dashboardAiWorkStatus,
  dashboardCanGenerateFormalRecommendations,
  dashboardDataActionQueueBlocker,
  dashboardDataGateDetail,
  dashboardDataGateLabel,
  dashboardDataGateAction,
  dashboardDeliveryHeadline,
  dashboardDeliveryPrimaryAction,
  dashboardDeliveryPrimaryRoute,
  dashboardMetricStatusCopy,
  dashboardNormalizeDeliveryItem,
  dashboardOpenPathButtonView,
  dashboardPrimaryTaskAction,
  dashboardPrimaryTaskNavigationFeedback,
  dashboardProductWorkbenchAction,
  dashboardSelectProductHistory,
  dashboardRecommendationHealthCopy,
  dashboardRecommendationHealthSummary,
  dashboardRecommendationStatusFilters,
  dashboardRiskObjectFallbackCopy,
  dashboardRiskObjectPrimaryAction,
  dashboardRiskObjectSecondaryAction,
  dashboardSecondaryRecommendationAction,
  dashboardTaskRecommendationMetric,
  dashboardTaskEntryStatus,
  dashboardVisibleDeliveryItems,
  dashboardWorkflowCollectStep,
  dashboardWorkflowPostQuantSteps,
  dashboardWorkflowRecommendationRoute,
  dashboardWorkflowQuantNext,
  dashboardWorkflowQuantStatus,
} from './dashboard-page';
import type { AiDiagnosisRunView, ProductHistoryLedgerView } from '../types';

describe('dashboardRecommendationStatusFilters', () => {
  it('loads both approvable and review-only recommendations for the dashboard queue', () => {
    expect(dashboardRecommendationStatusFilters()).toEqual(['pending', 'needs_review']);
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
      baseAction: { route: 'ad-quant', label: '复核广告量化', title: '可以分析：真实报表和日级指标已闭合' },
    })).toEqual({
      route: 'product-management',
      label: '选择产品',
      title: '先选择产品工作台',
    });
  });
});

describe('pre-gate dashboard copy', () => {
  it('keeps visible and folded helper copy free of recommendation approval and readback semantics', () => {
    const blockedTerms = /建议|优化建议|审批|回读/;
    const deliveryItem = {
      key: 'recommendations',
      label: '建议与审批',
      statusLabel: '可生成建议',
      detail: '进入建议页处理建议审批。',
      route: 'recommendations',
      nextAction: '生成优化建议',
    } as any;
    const states = [
      {
        name: 'no files/no rows',
        hasRealFiles: false,
        hasMetrics: false,
        realReportCount: 0,
        importedRows: 0,
        actionableRows: 0,
      },
      {
        name: 'partial reports with rows',
        hasRealFiles: true,
        hasMetrics: true,
        realReportCount: 3,
        importedRows: 512,
        actionableRows: 12,
      },
      {
        name: 'full reports without imported rows',
        hasRealFiles: true,
        hasMetrics: false,
        realReportCount: 8,
        importedRows: 0,
        actionableRows: 0,
      },
      {
        name: 'full reports with imported rows but no actionable rows',
        hasRealFiles: true,
        hasMetrics: false,
        realReportCount: 8,
        importedRows: 96,
        actionableRows: 0,
      },
      {
        name: 'full reports with imported actionable rows but metrics flag is false',
        hasRealFiles: true,
        hasMetrics: false,
        realReportCount: 8,
        importedRows: 96,
        actionableRows: 12,
      },
    ];

    for (const state of states) {
      const gateAction = dashboardDataGateAction({
        canGenerateFormalRecommendations: false,
        hasMetrics: state.hasMetrics,
        hasRealFiles: state.hasRealFiles,
        realReportCount: state.realReportCount,
        importedRows: state.importedRows,
        actionableRows: state.actionableRows,
      });
      const gateRoute = dashboardWorkflowQuantNext({
        canGenerateFormalRecommendations: false,
        hasMetrics: state.hasMetrics,
        hasRealFiles: state.hasRealFiles,
        realReportCount: state.realReportCount,
        importedRows: state.importedRows,
        actionableRows: state.actionableRows,
      });
      const primaryAction = dashboardPrimaryTaskAction({
        canGenerateFormalRecommendations: false,
        hasRealFiles: state.hasRealFiles,
        hasMetrics: state.hasMetrics,
        realReportCount: state.realReportCount,
        importedRows: state.importedRows,
        actionableRows: state.actionableRows,
        pendingRecommendationCount: 2,
        reviewRecommendationCount: 1,
      });
      const metricCopy = dashboardMetricStatusCopy({
        isQuantifiable: false,
        canGenerateFormalRecommendations: false,
        hasRealFiles: state.hasRealFiles,
        realReportCount: state.realReportCount,
        importedRows: state.importedRows,
        actionableRows: state.actionableRows,
        hasMetrics: state.hasMetrics,
        operatingJudgment: '不应显示',
      });
      if (state.name === 'partial reports with rows') {
        const visibleMetricCopy = `${metricCopy.dataGateDetail} ${metricCopy.performanceDetail}`;
        expect(visibleMetricCopy).toContain('补齐真实报表');
        expect(visibleMetricCopy).not.toContain('复核量化口径');
      }
      const recommendationHealthSummary = dashboardRecommendationHealthSummary({
        isQuantifiable: false,
        gateRoute: gateAction.route,
        gateLabel: gateAction.label,
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
      const taskRecommendationMetric = dashboardTaskRecommendationMetric({
        isQuantifiable: false,
        gateRoute: gateAction.route,
        gateLabel: gateAction.label,
        actionRecommendationCount: 3,
        pendingRecommendationCount: 2,
        reviewRecommendationCount: 1,
      });
      const actionQueueBlocker = dashboardDataActionQueueBlocker({
        canGenerateFormalRecommendations: false,
        hasRealFiles: state.hasRealFiles,
        hasMetrics: state.hasMetrics,
        realReportCount: state.realReportCount,
        importedRows: state.importedRows,
        actionableRows: state.actionableRows,
      });
      const normalizedDeliveryItem = dashboardNormalizeDeliveryItem(deliveryItem, {
        canGenerateFormalRecommendations: false,
        hasRealFiles: state.hasRealFiles,
        realReportCount: state.realReportCount,
        importedRows: state.importedRows,
        actionableRows: state.actionableRows,
      });
      const deliveryPrimaryAction = dashboardDeliveryPrimaryAction({
        canGenerateFormalRecommendations: false,
        deliveryStatus: 'needs_work',
        gateRoute: gateRoute.route,
        gateLabel: gateRoute.label,
        matrixLabel: '继续审批与执行回读',
      });
      const outputs = [
        gateAction.title,
        gateAction.label,
        gateAction.detail,
        dashboardDataGateDetail({
          isQuantifiable: false,
          hasRealFiles: state.hasRealFiles,
          realReportCount: state.realReportCount,
          importedRows: state.importedRows,
          actionableRows: state.actionableRows,
        }),
        dashboardDataGateLabel({
          canGenerateFormalRecommendations: false,
          hasRealFiles: state.hasRealFiles,
          hasMetrics: state.hasMetrics,
          realReportCount: state.realReportCount,
          importedRows: state.importedRows,
          actionableRows: state.actionableRows,
        }),
        primaryAction.title,
        primaryAction.label,
        metricCopy.dataGateDetail,
        metricCopy.performanceDetail,
        recommendationHealthSummary.label,
        recommendationHealthSummary.detail,
        taskRecommendationMetric,
        actionQueueBlocker?.title,
        actionQueueBlocker?.detail,
        dashboardWorkflowQuantStatus({
          canGenerateFormalRecommendations: false,
          hasMetrics: state.hasMetrics,
          realReportCount: state.realReportCount,
          actionableRows: state.actionableRows,
        }),
        gateRoute.label,
        deliveryPrimaryAction.label,
        dashboardDeliveryHeadline({
          canGenerateFormalRecommendations: false,
          gateRoute: gateRoute.route,
          gateLabel: gateRoute.label,
          matrixHeadline: '建议审批与执行回读待完成',
        }),
        normalizedDeliveryItem.label,
        normalizedDeliveryItem.statusLabel,
        normalizedDeliveryItem.detail,
        normalizedDeliveryItem.nextAction,
      ].filter(Boolean).join(' ');

      expect(outputs, state.name).not.toMatch(blockedTerms);
    }
  });
});

describe('dashboardDataGateAction', () => {
  it('routes missing files to real report collection', () => {
    expect(dashboardDataGateAction({
      canGenerateFormalRecommendations: false,
      hasRealFiles: false,
      hasMetrics: false,
      realReportCount: 0,
      importedRows: 0,
      actionableRows: 0,
    })).toMatchObject({
      route: 'data-collection',
      label: '先下载真实报表',
    });
  });

  it('routes partial reports with rows to report completion', () => {
    expect(dashboardDataGateAction({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: true,
      realReportCount: 3,
      importedRows: 512,
      actionableRows: 12,
    })).toMatchObject({
      route: 'data-collection',
      label: '补齐真实报表',
    });
  });

  it('routes full reports without rows to metric import', () => {
    const action = dashboardDataGateAction({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: false,
      realReportCount: 8,
      importedRows: 0,
      actionableRows: 0,
    });

    expect(action).toMatchObject({
      route: 'data-import-validation',
      label: '导入广告指标',
      title: '不可分析：广告指标未入库',
    });
    expect(action.title).not.toContain('真实报表未入库');
  });

  it('routes imported rows without actionable rows to quant review', () => {
    expect(dashboardDataGateAction({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: false,
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 0,
    })).toMatchObject({
      route: 'ad-quant',
      label: '复核量化口径',
    });
  });

  it('routes imported actionable rows with metrics flag false to quant review', () => {
    expect(dashboardDataGateAction({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: false,
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 12,
    })).toMatchObject({
      route: 'ad-quant',
      label: '复核量化口径',
    });
  });
});

describe('dashboardDeliveryHeadline', () => {
  it('normalizes pre-gate folded delivery headline instead of using raw matrix approval copy', () => {
    const headline = dashboardDeliveryHeadline({
      canGenerateFormalRecommendations: false,
      gateRoute: 'ad-quant',
      gateLabel: '复核量化口径',
      matrixHeadline: '建议审批与执行回读待完成',
    });

    expect(headline).toBe('量化门槛未闭合：复核量化口径');
    expect(headline).not.toMatch(/建议|审批|回读/);
  });
});

describe('dashboardDataGateDetail', () => {
  it('prioritizes missing reports before delivery details', () => {
    expect(dashboardTaskEntryStatus({
      canGenerateFormalRecommendations: false,
      hasRealFiles: false,
      realReportCount: 0,
      importedRows: 0,
    })).toBe('不可分析：缺真实报表和入库指标');

    expect(dashboardDataActionQueueBlocker({
      canGenerateFormalRecommendations: false,
      hasRealFiles: false,
      hasMetrics: false,
      realReportCount: 0,
      importedRows: 0,
      actionableRows: 0,
    })?.title).toBe('补齐真实报表');
  });

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

    expect(dashboardTaskEntryStatus({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      realReportCount: 3,
      importedRows: 0,
    })).toBe('数据门槛未闭合：当前只完成 3/8 类真实报表');

    expect(dashboardTaskEntryStatus({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      realReportCount: 8,
      importedRows: 0,
    })).toBe('不可分析：广告指标未入库');
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
    })).toBe('3/8 类真实报表已导入 512 行指标，但量化门槛未闭合；需补齐 8 类真实报表。');

    expect(dashboardDataGateLabel({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: true,
      realReportCount: 3,
      importedRows: 512,
      actionableRows: 12,
    })).toBe('补齐真实报表');

    expect(dashboardTaskEntryStatus({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      realReportCount: 3,
      importedRows: 512,
    })).toBe('数据门槛未闭合：当前只完成 3/8 类真实报表');

    expect(dashboardWorkflowQuantStatus({
      canGenerateFormalRecommendations: false,
      hasMetrics: true,
      realReportCount: 3,
      actionableRows: 12,
    })).toBe('12 行已导入但未达量化门槛');

    expect(dashboardWorkflowQuantNext({
      canGenerateFormalRecommendations: false,
      hasMetrics: true,
      hasRealFiles: true,
      realReportCount: 3,
      importedRows: 512,
      actionableRows: 12,
    })).toEqual({
      route: 'data-collection',
      label: '补齐真实报表',
    });

    expect(dashboardDataActionQueueBlocker({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: true,
      realReportCount: 3,
      importedRows: 512,
      actionableRows: 12,
    })).toEqual({
      title: '补齐 8 类真实报表',
      detail: '3/8 类真实报表已导入 512 行指标，但量化门槛未闭合；需补齐 8 类真实报表。',
      route: 'data-collection',
      tone: 'blocked',
    });
  });

  it('keeps action queue on quant review when imported metrics have no actionable rows', () => {
    const blocker = dashboardDataActionQueueBlocker({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: true,
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 0,
    });

    expect(blocker?.route).toBe('ad-quant');
    expect(blocker?.title).toContain('量化口径');
    expect(blocker?.detail).toContain('可行动对象');
    expect(blocker?.route).not.toBe('recommendations');
  });

  it('keeps action queue on quant review when imported rows exist even if metrics flag is false', () => {
    const blocker = dashboardDataActionQueueBlocker({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: false,
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 0,
    });

    expect(blocker?.route).toBe('ad-quant');
    expect(blocker?.title).toContain('量化口径');
  });

  it('describes imported metrics with no actionable rows as a quantification gap instead of missing reports', () => {
    expect(dashboardCanGenerateFormalRecommendations({
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 0,
      hasImportedMetrics: true,
    })).toBe(false);

    expect(dashboardDataGateDetail({
      isQuantifiable: false,
      hasRealFiles: true,
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 0,
    })).toBe('8/8 类真实报表已导入 96 行指标，但未形成可行动对象；需复核量化口径。');

    expect(dashboardDataGateLabel({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: false,
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 0,
    })).toBe('复核量化口径');
  });

  it('uses quant copy for full reports with rows when the imported metrics flag is not closed', () => {
    const label = dashboardDataGateLabel({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: false,
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 12,
    });

    expect(label).toBe('复核量化口径');
    expect(label).not.toContain('量化门槛');
  });

  it('keeps visible labels aligned to the actual data gap', () => {
    expect(dashboardDataGateLabel({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: true,
      realReportCount: 3,
      importedRows: 512,
      actionableRows: 12,
    })).toBe('补齐真实报表');

    expect(dashboardDataGateLabel({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: false,
      realReportCount: 8,
      importedRows: 0,
      actionableRows: 0,
    })).toBe('导入广告指标');
  });
});

describe('dashboardMetricStatusCopy', () => {
  it('prioritizes report completion over quant review when partial reports already have rows', () => {
    const copy = dashboardMetricStatusCopy({
      isQuantifiable: false,
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      realReportCount: 3,
      importedRows: 512,
      actionableRows: 12,
      hasMetrics: true,
      operatingJudgment: '不应显示',
    });
    const combinedCopy = `${copy.dataGateDetail} ${copy.performanceDetail}`;

    expect(combinedCopy).toContain('补齐真实报表');
    expect(combinedCopy).not.toContain('复核量化口径');
  });

  it('describes imported rows without actionable rows as a quantification review even when metrics flag is false', () => {
    const copy = dashboardMetricStatusCopy({
      isQuantifiable: false,
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 0,
      hasMetrics: false,
      operatingJudgment: '不应显示',
    });
    const combinedCopy = `${copy.dataGateDetail} ${copy.performanceDetail}`;

    expect(combinedCopy).not.toContain('导入');
    expect(combinedCopy).toContain('量化口径');
    expect(combinedCopy).toContain('可行动对象');
  });

  it('still asks for metric import when no rows are imported', () => {
    const copy = dashboardMetricStatusCopy({
      isQuantifiable: false,
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      realReportCount: 8,
      importedRows: 0,
      actionableRows: 0,
      hasMetrics: false,
      operatingJudgment: '不应显示',
    });

    expect(copy.dataGateDetail).toContain('导入');
    expect(copy.performanceDetail).toContain('导入');
  });

  it('uses the operating judgment when formal quantification is ready', () => {
    expect(dashboardMetricStatusCopy({
      isQuantifiable: true,
      canGenerateFormalRecommendations: true,
      hasRealFiles: true,
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 12,
      hasMetrics: true,
      operatingJudgment: 'ACOS 偏高，先复核高花费/低转化对象',
    })).toEqual({
      dataGateDetail: '12 行可生成建议。',
      performanceDetail: 'ACOS 偏高，先复核高花费/低转化对象',
    });
  });
});

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
      importedRows: 96,
      actionableRows: 0,
    })).toEqual({
      route: 'ad-quant',
      label: '复核量化口径',
    });
  });
});

describe('dashboardNormalizeDeliveryItem', () => {
  it('routes delivery recommendation and readback gaps to quant review when imported rows have no actionable rows', () => {
    const gateState = {
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 0,
    };
    const recommendationItem = {
      key: 'recommendations',
      route: 'recommendations',
      nextAction: '生成优化建议',
    } as any;
    const readbackItem = {
      key: 'readback',
      route: 'readback',
      nextAction: '完成审批和回读',
    } as any;

    expect(dashboardNormalizeDeliveryItem(recommendationItem, gateState)).toMatchObject({
      route: 'ad-quant',
      nextAction: '复核量化口径',
    });
    expect(dashboardNormalizeDeliveryItem(readbackItem, gateState)).toMatchObject({
      route: 'ad-quant',
      nextAction: '复核量化口径',
    });
  });

  it('downgrades downstream delivery card copy to data gate language before formal gates pass', () => {
    const gateState = {
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 0,
    };
    const recommendationItem = {
      key: 'recommendations',
      label: '建议与审批',
      statusLabel: '可生成建议',
      detail: '进入建议页处理建议审批。',
      route: 'recommendations',
      nextAction: '去建议页',
    } as any;
    const readbackItem = {
      key: 'readback',
      label: '执行回读',
      statusLabel: '等待审批回读',
      detail: '完成审批和回读。',
      route: 'readback',
      nextAction: '完成审批和回读',
    } as any;

    for (const item of [
      dashboardNormalizeDeliveryItem(recommendationItem, gateState),
      dashboardNormalizeDeliveryItem(readbackItem, gateState),
    ]) {
      const copy = `${item.label} ${item.statusLabel} ${item.detail} ${item.nextAction}`;

      expect(item.route).toBe('ad-quant');
      expect(copy).not.toContain('审批');
      expect(copy).not.toContain('回读');
      expect(copy).not.toContain('建议页');
      expect(copy).toMatch(/量化口径|数据门槛/);
    }
  });

  it('aligns non-downstream delivery card copy with the quant gate route before formal gates pass', () => {
    const item = dashboardNormalizeDeliveryItem({
      key: 'aiEvidence',
      label: 'AI 证据链',
      statusLabel: '待生成建议',
      detail: '补齐真实数据后生成建议。',
      route: 'recommendations',
      nextAction: '生成优化建议',
    } as any, {
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 0,
    });
    const copy = `${item.label} ${item.statusLabel} ${item.detail} ${item.nextAction}`;

    expect(item.route).toBe('ad-quant');
    expect(copy).not.toContain('建议');
    expect(copy).not.toContain('审批');
    expect(copy).not.toContain('回读');
    expect(copy).not.toContain('补齐真实数据');
    expect(copy).toContain('量化口径');
  });

  it('keeps delivery data gaps on import validation when no imported rows exist', () => {
    expect(dashboardNormalizeDeliveryItem({
      key: 'data',
      route: 'data-import-validation',
      nextAction: '去导入校验',
    } as any, {
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      realReportCount: 8,
      importedRows: 0,
      actionableRows: 0,
    })).toMatchObject({
      route: 'data-import-validation',
      nextAction: '导入广告指标',
    });
  });

  it('keeps the delivery matrix route unchanged when formal gates pass', () => {
    expect(dashboardNormalizeDeliveryItem({
      key: 'recommendations',
      route: 'recommendations',
      nextAction: '生成优化建议',
    } as any, {
      canGenerateFormalRecommendations: true,
      hasRealFiles: true,
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 12,
    })).toMatchObject({
      route: 'recommendations',
      nextAction: '生成优化建议',
    });
  });
});

describe('dashboardDeliveryPrimaryRoute', () => {
  it('uses the dashboard gate route for blocked delivery with no actionable rows', () => {
    expect(dashboardDeliveryPrimaryRoute({
      deliveryStatus: 'blocked',
      gateRoute: 'ad-quant',
    })).toBe('ad-quant');
  });

  it('uses import validation for blocked delivery when no rows are imported', () => {
    expect(dashboardDeliveryPrimaryRoute({
      deliveryStatus: 'blocked',
      gateRoute: 'data-import-validation',
    })).toBe('data-import-validation');
  });

  it('keeps non-blocked delivery on the delivery page', () => {
    expect(dashboardDeliveryPrimaryRoute({
      deliveryStatus: 'needs_work',
      gateRoute: 'ad-quant',
    })).toBe('delivery');
  });
});

describe('dashboardDeliveryPrimaryAction', () => {
  it('uses quant review route and label for blocked delivery when imported rows have no actionable objects', () => {
    const action = dashboardDeliveryPrimaryAction({
      deliveryStatus: 'blocked',
      gateRoute: 'ad-quant',
      gateLabel: '复核量化口径',
      matrixLabel: '先完成真实报表下载和 DB 日级指标导入',
    });

    expect(action).toEqual({
      route: 'ad-quant',
      label: '复核量化口径',
    });
    expect(action.label).not.toContain('下载');
    expect(action.label).not.toContain('导入');
  });

  it('keeps import wording only when the gate route is import validation', () => {
    expect(dashboardDeliveryPrimaryAction({
      deliveryStatus: 'blocked',
      gateRoute: 'data-import-validation',
      gateLabel: '导入广告指标',
      matrixLabel: '先完成真实报表下载和 DB 日级指标导入',
    })).toEqual({
      route: 'data-import-validation',
      label: '导入广告指标',
    });
  });

  it('keeps the delivery matrix label when delivery is the next route', () => {
    expect(dashboardDeliveryPrimaryAction({
      deliveryStatus: 'needs_work',
      gateRoute: 'ad-quant',
      gateLabel: '复核量化诊断',
      matrixLabel: '查看交付验收',
    })).toEqual({
      route: 'delivery',
      label: '查看交付验收',
    });
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
      gateLabel: '复核量化诊断',
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
      gateLabel: '复核量化诊断',
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
      gateLabel: '复核量化诊断',
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
      gateLabel: '复核量化诊断',
    })).toEqual({
      route: 'recommendations',
      label: '生成优化建议',
      disabled: false,
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
      '4. 审批与执行回读',
    ]);
  });
});

describe('dashboardRiskObjectFallbackCopy', () => {
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
      gateLabel: '复核量化诊断',
    })).toEqual({
      route: 'ad-quant',
      label: '查看量化明细',
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
        label: '查看量化明细',
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

  it('wires dashboard primary pending state into the state-light refresh rail', () => {
    const source = readFileSync(new URL('./dashboard-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('refreshing={primaryTaskNavigationFeedback.busy}');
    expect(source).toContain('StateLightGrid');
  });
});

describe('dashboardOpenPathButtonView', () => {
  it('gives dashboard evidence path buttons active feedback and locks path peers', () => {
    const active = dashboardOpenPathButtonView({
      activePathKey: '打开证据:C:/evidence',
      idleLabel: '打开',
      pathKey: '打开证据:C:/evidence',
    });
    const locked = dashboardOpenPathButtonView({
      activePathKey: '打开证据:C:/evidence',
      idleLabel: '打开',
      pathKey: '打开清单:C:/manifest.json',
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

describe('dashboardVisibleDeliveryItems', () => {
  it('keeps the dashboard focused on the first three unfinished delivery gaps', () => {
    const items = [
      { key: 'data', tone: 'ready', label: '真实数据闭环' },
      { key: 'aiEvidence', tone: 'blocked', label: 'AI 证据链' },
      { key: 'businessContext', tone: 'warning', label: '运营上下文' },
      { key: 'listing', tone: 'warning', label: 'Listing 草案' },
      { key: 'recommendations', tone: 'ready', label: '建议与审批' },
      { key: 'readback', tone: 'blocked', label: '执行回读' },
      { key: 'package', tone: 'blocked', label: '最终交付包' },
    ] as any;

    expect(dashboardVisibleDeliveryItems(items).map((item) => item.key)).toEqual([
      'aiEvidence',
      'businessContext',
      'listing',
    ]);
  });
});
