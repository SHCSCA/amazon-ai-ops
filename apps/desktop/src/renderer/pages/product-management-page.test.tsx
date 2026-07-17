import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PRODUCT_QUICK_COST_FIELDS,
  PRODUCT_QUICK_TARGET_FIELDS,
  buildCredentialSandboxSummary,
  productManagementActionButtonView,
  buildProductManagementOptionView,
  buildProductManagementPageModel,
  buildProductManagementTaskState,
  productManagementActionRoutes,
  productInspectorTabTarget,
  productTimelineScopeLabel,
} from './product-management-page';
import type { BusinessDataPipeline } from '../types';

describe('ProductManagementPage workspace contract', () => {
  it('keeps product browsing read-only inside a virtual queue and responsive inspector', () => {
    const source = readFileSync(new URL('./product-management-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain("useBusinessDataPipeline({ mode: 'portfolio' })");
    expect(source).toContain('electronAPI?.getProducts?.()');
    expect(source).toContain('const lockedAsin =');
    expect(source).toContain('const [focusedAsin, setFocusedAsin]');
    expect(source).toMatch(/function openProductInspector\([\s\S]*?setFocusedAsin\(asin\);[\s\S]*?setInspectorTab\(panel\);[\s\S]*?\n  }/);
    expect(source.match(/function openProductInspector\([\s\S]*?\n  }/)?.[0]).not.toContain('setScope');
    expect(source).toContain('<VirtualDataTable');
    expect(source).toContain('estimateSize={54}');
    expect(source).toContain('<WorkbenchPanel');
    expect(source).toContain('<ResponsiveInspector');
    expect(source).toContain('data-workspace-work-surface');
    expect(source).toContain('data-workspace-queue');
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tabpanel"');
    expect(source).not.toContain('<PageHeader');
    expect(source).not.toContain('PAGE_HEADER_TITLES');
    expect(source).toContain('className="business-stack product-management-page-stack"');
    expect(source).not.toContain('product-config-modal-backdrop product-management-modal-backdrop');
    expect(source).not.toContain('useOverlayFocusScope');
  });

  it('keeps save separate from the explicit global product lock', () => {
    const source = readFileSync(new URL('./product-management-page.tsx', import.meta.url), 'utf8');
    const saveProductSource = source.match(/async function saveProduct\(\) \{[\s\S]*?\n  \}/)?.[0] || '';

    expect(saveProductSource).not.toContain('setScope');
    expect(source).toContain('保存只更新本地产品配置；全局 ASIN 仅由显式锁定动作更新。');
    expect(source).toContain('如需切换请使用“锁定为当前产品”');
  });
});

describe('ProductManagementPage inspector tabs', () => {
  it('supports arrow, Home, and End keyboard navigation without changing on unrelated keys', () => {
    expect(productInspectorTabTarget('detail', 'ArrowRight')).toBe('edit');
    expect(productInspectorTabTarget('detail', 'ArrowLeft')).toBe('timeline');
    expect(productInspectorTabTarget('daily', 'Home')).toBe('detail');
    expect(productInspectorTabTarget('edit', 'End')).toBe('timeline');
    expect(productInspectorTabTarget('edit', 'Enter')).toBe('edit');
  });
});

describe('ProductManagementPage model', () => {
  it('selects the scoped product and exposes product identity, ad summary, and timeline tags', () => {
    const model = buildProductManagementPageModel({
      data: pipeline(),
      scopeAsin: 'B001',
    });

    expect(model.selectedProduct?.title).toBe('D6 Smart Lock');
    expect(model.selectedProduct?.asin).toBe('B001');
    expect(model.selectedProduct?.cost).toBe(80);
    expect(model.selectedDailyRows).toEqual([
      expect.objectContaining({ date: '2026-06-10', cost: 20, orders: 1 }),
      expect.objectContaining({ date: '2026-06-11', cost: 60, orders: 3 }),
    ]);
    expect(model.timeline.map((item) => productTimelineScopeLabel(item.scope))).toEqual(['全局', '产品']);
    expect(model.emptyReason).toBe('');
  });

  it('uses canonical product totals instead of summing diagnostic detail rows', () => {
    const data = {
      ...pipeline(),
      productHistory: { ledgers: [], ledgerCount: 0, notes: [] },
      quant: {
        ...pipeline().quant,
        totalSpend: 784.31,
        totalSales: 1289.68,
        totalOrders: 25,
        totalClicks: 495,
        diagnostics: [
          {
            asin: 'B001',
            spend: 478.48,
            sales: 769.81,
            orders: 17,
            clicks: 296,
            acos: 0.62,
            cvr: 0.057,
            cpc: 1.62,
            severity: 'medium',
            diagnosis: '复核',
            suggestedDirection: '观察',
          },
          {
            asin: 'B001',
            spend: 456.77,
            sales: 689.83,
            orders: 16,
            clicks: 279,
            acos: 0.66,
            cvr: 0.057,
            cpc: 1.64,
            severity: 'medium',
            diagnosis: '复核',
            suggestedDirection: '观察',
          },
          {
            asin: 'B001',
            spend: 225.79,
            sales: 399.9,
            orders: 6,
            clicks: 146,
            acos: 0.56,
            cvr: 0.041,
            cpc: 1.55,
            severity: 'high',
            diagnosis: '高风险',
            suggestedDirection: '复核',
          },
        ],
      },
    } as BusinessDataPipeline;

    const model = buildProductManagementPageModel({ data, scopeAsin: 'B001' });

    expect(model.selectedProduct).toMatchObject({
      asin: 'B001',
      cost: 784.31,
      sales: 1289.68,
      orders: 25,
      clicks: 495,
      highRiskCount: 1,
    });
  });

  it('supplements the portfolio while applying scoped canonical totals only to the locked ASIN', () => {
    const portfolioData = {
      ...pipeline(),
      scope: { ...pipeline().scope, asin: undefined },
      quant: {
        ...pipeline().quant,
        totalSpend: 999,
        totalSales: 1998,
      },
    };

    const model = buildProductManagementPageModel({
      data: portfolioData,
      scopeAsin: 'B001',
      authoritativeData: pipeline(),
      supplementalProducts: [{ asin: 'B002', title: 'Configured only product', productStage: 'cold_start' }],
    });

    expect(model.products.map((product) => product.asin)).toEqual(['B001', 'B002']);
    expect(model.selectedProduct).toMatchObject({
      asin: 'B001',
      cost: 80,
      sales: 160,
    });

    const viewedOnlyModel = buildProductManagementPageModel({
      data: portfolioData,
      scopeAsin: 'B002',
      authoritativeData: pipeline(),
      supplementalProducts: [{ asin: 'B002', title: 'Configured only product' }],
    });
    expect(viewedOnlyModel.selectedProduct).toMatchObject({
      asin: 'B002',
      cost: 0,
      sales: 0,
    });
  });

  it('uses clear empty copy when no products or ASIN metrics exist', () => {
    const model = buildProductManagementPageModel({
      data: {
        ...pipeline(),
        productContext: { products: [], productCount: 0, notes: [] },
        productHistory: { ledgers: [], ledgerCount: 0, notes: [] },
        quant: { ...pipeline().quant, diagnostics: [] },
        operations: { events: [], eventCount: 0, notes: [] },
      },
      scopeAsin: '',
    });

    expect(model.products).toHaveLength(0);
    expect(model.emptyReason).toBe('当前范围还没有产品配置或可识别 ASIN 的广告数据。');
  });

  it('does not silently select the first product when scope has no ASIN', () => {
    const model = buildProductManagementPageModel({
      data: {
        ...pipeline(),
        scope: { ...pipeline().scope, asin: undefined },
      },
      scopeAsin: '',
    });

    expect(model.products).toHaveLength(1);
    expect(model.selectedProduct).toBeUndefined();
    expect(model.selectedDailyRows).toEqual([]);
    expect(model.timeline).toEqual([]);
  });

  it('builds a first-screen task state for a selected product with imported metrics', () => {
    const model = buildProductManagementPageModel({
      data: pipeline(),
      scopeAsin: 'B001',
    });

    const taskState = buildProductManagementTaskState({
      model,
      loading: false,
      error: '',
      saving: false,
      importedRows: 10,
      hasImportedMetrics: true,
    });

    expect(taskState).toMatchObject({
      title: '当前产品：D6 Smart Lock',
      primaryActionLabel: '进入 AI 量化',
      primaryRoute: 'ad-quant',
      feedbackLabel: '已锁定产品上下文',
      feedbackTone: 'ready',
    });
    expect(taskState.detail).toContain('B001');
    expect(taskState.secondaryActions.map((action) => action.route)).toEqual([
      'operation-events',
      'keyword-opportunities',
      'listing-optimization',
    ]);
  });

  it('routes selected products without imported metrics back to import validation', () => {
    const model = buildProductManagementPageModel({
      data: pipeline(),
      scopeAsin: 'B001',
    });

    const taskState = buildProductManagementTaskState({
      model,
      loading: false,
      error: '',
      saving: false,
      importedRows: 0,
      hasImportedMetrics: false,
    });

    expect(taskState).toMatchObject({
      title: '当前产品：D6 Smart Lock',
      primaryActionLabel: '先导入广告指标',
      primaryRoute: 'data-import-validation',
      feedbackLabel: '缺少导入指标',
      feedbackTone: 'warning',
    });
    expect(taskState.detail).toContain('当前缺少导入广告指标');
  });

  it('keeps AI quantification out of the primary path while only some report types are imported', () => {
    const model = buildProductManagementPageModel({
      data: pipeline(),
      scopeAsin: 'B001',
    });

    const taskState = buildProductManagementTaskState({
      model,
      loading: false,
      error: '',
      saving: false,
      importedRows: 1879,
      hasImportedMetrics: true,
      importedReportTypeCount: 5,
      formalDataReady: false,
    });

    expect(taskState).toMatchObject({
      title: '当前产品：D6 Smart Lock',
      primaryActionLabel: '补齐逐类入库',
      primaryRoute: 'data-import-validation',
      feedbackLabel: '正式数据门未闭合',
      feedbackTone: 'warning',
    });
    expect(taskState.detail).toContain('当前仅 5/8 类逐类入库');
    expect(taskState.feedbackDetail).toContain('1879 行指标来自 5/8 类报表');
  });

  it('keeps save feedback in the product task state', () => {
    const model = buildProductManagementPageModel({
      data: pipeline(),
      scopeAsin: 'B001',
    });

    expect(buildProductManagementTaskState({
      model,
      loading: false,
      error: '',
      saving: true,
      importedRows: 10,
      hasImportedMetrics: true,
    })).toMatchObject({
      feedbackLabel: '正在保存产品信息',
      feedbackTone: 'pending',
    });

    expect(buildProductManagementTaskState({
      model,
      loading: false,
      error: '',
      saving: false,
      saveError: '保存产品信息失败。',
      importedRows: 10,
      hasImportedMetrics: true,
    })).toMatchObject({
      feedbackLabel: '保存失败',
      feedbackDetail: '保存产品信息失败。',
      feedbackTone: 'blocked',
    });
  });

  it('defines product-context action routes', () => {
    expect(productManagementActionRoutes()).toEqual({
      adQuant: 'ad-quant',
      recommendations: 'recommendations',
      keywordOpportunities: 'keyword-opportunities',
      listingOptimization: 'listing-optimization',
      operationEvents: 'operation-events',
      productConfig: 'product-config',
    });
  });

  it('names quick product cost and target fields explicitly', () => {
    expect(PRODUCT_QUICK_COST_FIELDS.map((field) => field.label)).toEqual(['采购成本', 'FBA 费用', '最低可接受售价']);
    expect(PRODUCT_QUICK_TARGET_FIELDS.map((field) => field.label)).toEqual(['目标 ACOS', '目标 TACOS', '目标净利率']);
  });

  it('styles quick product fields as labeled mini table cells instead of bare inputs', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.inline-field\s*{[\s\S]*border:\s*1px solid var\(--line-soft\)/);
    expect(css).toMatch(/\.inline-field\s*{[\s\S]*border-radius:\s*var\(--radius-sm\)/);
    expect(css).toMatch(/\.inline-field:focus-within\s*{[\s\S]*box-shadow:/);
    expect(css).toMatch(/\.inline-field-label\s*{[\s\S]*background:\s*#fff/);
    expect(css).toMatch(/\.inline-field input\[type="number"\]\s*{[\s\S]*text-align:\s*right/);
  });

  it('builds explicit lock feedback for selected product cards', () => {
    const selectedView = buildProductManagementOptionView({
      selected: true,
      productTitle: 'D6 Smart Lock',
      asin: 'B001',
      hasImportedMetrics: true,
      dailyDays: 2,
    });

    expect(selectedView.className).toContain('product-management-option-active');
    expect(selectedView.className).toContain('product-management-option-locked');
    expect(selectedView.ariaPressed).toBe(true);
    expect(selectedView.actionTag).toBe('已锁定');
    expect(selectedView.statusLine).toContain('工具栏已解冻');
    expect(selectedView.statusLine).toContain('后续页面按 B001 读取数据库');

    const idleView = buildProductManagementOptionView({
      selected: false,
      productTitle: 'D7',
      asin: 'B002',
      hasImportedMetrics: false,
      dailyDays: 0,
    });

    expect(idleView.ariaPressed).toBe(false);
    expect(idleView.actionTag).toBe('点击锁定');
    expect(idleView.statusLine).toContain('点击锁定 D7 / B002');
  });

  it('gives product save actions an explicit busy contract', () => {
    const saving = productManagementActionButtonView({
      active: true,
      baseClassName: 'primary-button',
      busyLabel: '保存中...',
      label: '保存产品信息',
    });

    expect(saving.label).toBe('保存中...');
    expect(saving.className).toContain('primary-button');
    expect(saving.className).toContain('button-loading');
    expect(saving.disabled).toBe(true);
    expect(saving.ariaBusy).toBe(true);
    expect(saving.showSpinner).toBe(true);

    const lockedPeer = productManagementActionButtonView({
      active: false,
      baseClassName: 'secondary-button',
      busyLabel: '处理中...',
      groupBusy: true,
      label: '打开完整配置',
    });

    expect(lockedPeer.label).toBe('打开完整配置');
    expect(lockedPeer.disabled).toBe(true);
    expect(lockedPeer.ariaBusy).toBeUndefined();
    expect(lockedPeer.className).not.toContain('button-loading');
    expect(lockedPeer.showSpinner).toBe(false);
  });

  it('builds a non-secret Main credential sandbox hover summary', () => {
    const summary = buildCredentialSandboxSummary({
      dateFrom: '2026-06-01',
      dateTo: '2026-06-23',
      storeName: 'operator@example.com',
      marketplaceCode: 'US',
    });

    expect(summary).toMatchObject({
      label: '凭证映射通过',
      status: 'Main 托管',
      sandboxId: '#FL-US-2026-06',
    });
    expect(summary.detail).toContain('login-credentials 已托管至 Main 系统加密区');
    expect(summary.detail).toContain('不接收或回填已保存密码');
    expect(JSON.stringify(summary)).not.toContain('operator@example.com');
  });

  it('renders the computed product task state through one task-first banner', () => {
    const source = readFileSync(new URL('./product-management-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain("import { ResponsiveInspector, TaskBanner, WorkbenchPanel } from '../components/workspace';");
    expect(source.match(/<TaskBanner/g)).toHaveLength(1);
    expect(source).toContain('label: taskState.primaryActionLabel');
    expect(source).toContain('taskState.secondaryActions.slice(0, 2)');
    expect(source).not.toContain("label: '打开完整配置',\n          onClick: () => navigate(routes.productConfig)");
  });
});

function pipeline(): BusinessDataPipeline {
  return {
    scope: {
      dateFrom: '2026-06-01',
      dateTo: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B001',
      currency: 'USD',
    },
    generatedAt: '2026-06-12T00:00:00.000Z',
    collection: {} as BusinessDataPipeline['collection'],
    quant: {
      hasImportedMetrics: true,
      importedRows: 10,
      totalSpend: 80,
      totalSales: 160,
      totalOrders: 4,
      totalClicks: 40,
      totalImpressions: 1000,
      acos: 0.5,
      cvr: 0.1,
      cpc: 2,
      wastedSpend: 0,
      highRiskCount: 1,
      blockers: [],
      diagnostics: [{
        asin: 'B001',
        spend: 20,
        sales: 40,
        orders: 1,
        clicks: 10,
        acos: 0.5,
        cvr: 0.1,
        cpc: 2,
        severity: 'high',
        diagnosis: '高 ACOS',
        suggestedDirection: '复核',
      }],
      adObjectTimelines: [],
    },
    operations: {
      events: [
        event({ id: 1, eventDate: '2026-06-10', asin: 'B001', title: 'Coupon started' }),
        event({ id: 2, eventDate: '2026-06-11', asin: undefined, title: 'Prime event' }),
      ],
      eventCount: 2,
      notes: [],
    },
    productContext: {
      products: [{ asin: 'B001', title: 'D6 Smart Lock', sku: 'D6-SKU', productStage: 'keyword_exploration', status: 'active' }],
      productCount: 1,
      notes: [],
    },
    productHistory: {
      ledgers: [{
        asin: 'B001',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        activeDays: 2,
        inferredStage: 'keyword_exploration',
        stageReasons: [],
        daily: [
          {
            date: '2026-06-10',
            impressions: 200,
            clicks: 10,
            cost: 20,
            orders: 1,
            sales: 40,
            acos: 0.5,
            cpc: 2,
            cvr: 0.1,
            currency: 'USD',
          },
          {
            date: '2026-06-11',
            impressions: 800,
            clicks: 30,
            cost: 60,
            orders: 3,
            sales: 120,
            acos: 0.5,
            cpc: 2,
            cvr: 0.1,
            currency: 'USD',
          },
        ],
        totals: {
          impressions: 1000,
          clicks: 40,
          cost: 80,
          orders: 4,
          sales: 160,
          acos: 0.5,
          cpc: 2,
          cvr: 0.1,
          currency: 'USD',
        },
        events: [],
      }],
      ledgerCount: 1,
      notes: [],
    },
  };
}

function event(patch: any) {
  return {
    id: patch.id,
    eventDate: patch.eventDate,
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: patch.asin,
    campaignName: patch.campaignName,
    adGroupName: patch.adGroupName,
    eventType: 'coupon',
    title: patch.title,
    impactExpectation: 'unknown',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
