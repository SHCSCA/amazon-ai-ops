import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  dashboardDeliveryHeadline,
  dashboardDeliveryPrimaryAction,
  dashboardDeliveryPrimaryRoute,
  dashboardNormalizeDeliveryItem,
  dashboardVisibleDeliveryItems,
} from './dashboard-page';

describe('dashboardDeliveryHeadline', () => {
  it('normalizes pre-gate folded delivery headline instead of using raw matrix approval copy', () => {
    const headline = dashboardDeliveryHeadline({
      canGenerateFormalRecommendations: false,
      gateRoute: 'ad-quant',
      gateLabel: '复核量化口径',
      matrixHeadline: '建议审批与结果核对待完成',
    });

    expect(headline).toBe('量化门槛未闭合：复核量化口径');
    expect(headline).not.toMatch(/建议|审批|回读/);
  });
});

describe('dashboardNormalizeDeliveryItem', () => {
  it('routes delivery recommendation and readback gaps to quant review when imported rows have no actionable rows', () => {
    const gateState = {
      canGenerateFormalRecommendations: false,
      hasRealFiles: true,
      realReportCount: 8,
      importedReportTypeCount: 8,
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
      importedReportTypeCount: 8,
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
      label: '结果核对',
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
      importedReportTypeCount: 8,
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
      gateLabel: '复核广告表现',
      matrixLabel: '查看交付验收',
    })).toEqual({
      route: 'delivery',
      label: '查看交付验收',
    });
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
      { key: 'readback', tone: 'blocked', label: '结果核对' },
      { key: 'package', tone: 'blocked', label: '最终交付包' },
    ] as any;

    expect(dashboardVisibleDeliveryItems(items).map((item) => item.key)).toEqual([
      'aiEvidence',
      'businessContext',
      'listing',
    ]);
  });
});
