import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  dashboardCanGenerateFormalRecommendations,
  dashboardDataActionQueueBlocker,
  dashboardDataGateDetail,
  dashboardDataGateLabel,
  dashboardDataGateAction,
  dashboardDeliveryHeadline,
  dashboardDeliveryPrimaryAction,
  dashboardMetricStatusCopy,
  dashboardNormalizeDeliveryItem,
  dashboardPrimaryTaskAction,
  dashboardRecommendationHealthSummary,
  dashboardTaskRecommendationMetric,
  dashboardTaskEntryStatus,
  dashboardWorkflowQuantNext,
  dashboardWorkflowQuantStatus,
} from './dashboard-page';

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
        matrixLabel: '继续审批与结果核对',
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
          matrixHeadline: '建议审批与结果核对待完成',
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
      importedReportTypeCount: 0,
      importedRows: 0,
      actionableRows: 0,
    });

    expect(action).toMatchObject({
      route: 'data-import-validation',
      label: '导入广告指标',
      title: '数据门槛未闭合：当前仅 0/8 类逐类入库',
    });
    expect(action.title).not.toContain('真实报表未入库');
  });

  it('routes imported rows without actionable rows to quant review', () => {
    expect(dashboardDataGateAction({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: false,
      realReportCount: 8,
      importedReportTypeCount: 8,
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
      importedReportTypeCount: 8,
      importedRows: 96,
      actionableRows: 12,
    })).toMatchObject({
      route: 'ad-quant',
      label: '复核量化口径',
    });
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
      importedReportTypeCount: 8,
      importedRows: 96,
      actionableRows: 12,
    })).toBe('8/8 类报表文件、8/8 类逐类入库，共 96 行广告指标，其中 12 行可生成建议。');
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
      importedReportTypeCount: 0,
      importedRows: 0,
    })).toBe('数据门槛未闭合：当前仅 0/8 类逐类入库');
  });

  it('does not describe partial report coverage with imported metrics as formal recommendation ready', () => {
    expect(dashboardCanGenerateFormalRecommendations({
      realReportCount: 3,
      importedReportTypeCount: 3,
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

  it('does not treat 8/8 files with only 5/8 imported report types as formal recommendation ready', () => {
    expect(dashboardCanGenerateFormalRecommendations({
      realReportCount: 8,
      importedReportTypeCount: 5,
      importedRows: 1879,
      actionableRows: 34,
      hasImportedMetrics: true,
    })).toBe(false);

    expect(dashboardDataGateAction({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: true,
      realReportCount: 8,
      importedReportTypeCount: 5,
      importedRows: 1879,
      actionableRows: 34,
    })).toMatchObject({
      route: 'data-import-validation',
      label: '补齐逐类入库',
      title: '数据门槛未闭合：当前仅 5/8 类逐类入库',
    });
  });

  it('keeps action queue on quant review when imported metrics have no actionable rows', () => {
    const blocker = dashboardDataActionQueueBlocker({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: true,
      realReportCount: 8,
      importedReportTypeCount: 8,
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
      importedReportTypeCount: 8,
      importedRows: 96,
      actionableRows: 0,
    });

    expect(blocker?.route).toBe('ad-quant');
    expect(blocker?.title).toContain('量化口径');
  });

  it('describes imported metrics with no actionable rows as a quantification gap instead of missing reports', () => {
    expect(dashboardCanGenerateFormalRecommendations({
      realReportCount: 8,
      importedReportTypeCount: 8,
      importedRows: 96,
      actionableRows: 0,
      hasImportedMetrics: true,
    })).toBe(false);

    expect(dashboardDataGateDetail({
      isQuantifiable: false,
      hasRealFiles: true,
      realReportCount: 8,
      importedReportTypeCount: 8,
      importedRows: 96,
      actionableRows: 0,
    })).toBe('8/8 类真实报表已导入 96 行指标，但未形成可行动对象；需复核量化口径。');

    expect(dashboardDataGateLabel({
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      hasMetrics: false,
      realReportCount: 8,
      importedReportTypeCount: 8,
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
      importedReportTypeCount: 8,
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
      importedReportTypeCount: 8,
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
