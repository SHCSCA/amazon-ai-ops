import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PAGE_FILES = [
  'pages/dashboard-page.tsx',
  'pages/product-management-page.tsx',
  'pages/operation-scope-page.tsx',
  'pages/data-collection-page.tsx',
  'pages/data-import-validation-page.tsx',
  'pages/operation-events-page.tsx',
  'pages/product-config-page.tsx',
  'pages/ad-quant-page.tsx',
  'pages/recommendations-page.tsx',
  'pages/approval-page.tsx',
  'pages/readback-page.tsx',
  'pages/keyword-opportunities-page.tsx',
  'pages/listing-optimization-page.tsx',
  'pages/delivery-page.tsx',
  'pages/scheduler-page.tsx',
  'pages/settings-page.tsx',
];

const PROTOTYPE_FIRST_SCREEN_MARKERS = [
  {
    pageFile: 'App.tsx',
    markers: ['LoginPage', '登录并进入 Ads', 'ERP 广告入口'],
  },
  {
    pageFile: 'pages/dashboard-page.tsx',
    markers: ['PageFrame', 'TaskBanner', 'SummaryStrip', '风险对象队列', '当前产品上下文'],
  },
  {
    pageFile: 'pages/product-management-page.tsx',
    markers: ['product-management-shell', '产品列表', '搜索产品', '当前产品'],
  },
  {
    pageFile: 'pages/operation-scope-page.tsx',
    markers: ['operation-scope-confirm-panel', '范围字段确认', 'operation-scope-field-card', '后续读取与影响页面', 'openScopeEditor'],
  },
  {
    pageFile: 'pages/data-collection-page.tsx',
    markers: ['data-collection-primary-panel', 'aria-label="当前报表采集摘要"', 'data-collection-workbench-toolbar', 'collection-selector-grid'],
  },
  {
    pageFile: 'pages/data-import-validation-page.tsx',
    markers: ['data-import-primary-panel', '导入批次状态', 'data-import-prototype-table', 'data-import-title-pills'],
  },
  {
    pageFile: 'pages/operation-events-page.tsx',
    markers: ['operation-events-prototype-status-grid', '当前范围与作用', 'OPERATION_EVENT_PAGE_COPY.newEventPanelTitle', 'OPERATION_EVENT_PAGE_COPY.timelinePanelTitle'],
  },
  {
    pageFile: 'pages/product-config-page.tsx',
    markers: ['product-config-list-panel', 'product-config-target-panel', 'product-config-basic-panel', '产品目标列表'],
  },
  {
    pageFile: 'pages/ad-quant-page.tsx',
    markers: ['ad-quant-workbench-toolbar', '广告表现阻断', '广告对象诊断', '当前范围', '数据来源与量化口径'],
  },
  {
    pageFile: 'pages/recommendations-page.tsx',
    markers: ['recommendation-primary-panel', 'recommendation-primary-head', 'recommendation-title-pills', '建议生成范围', '建议处理路径', '待处理建议'],
  },
  {
    pageFile: 'pages/approval-page.tsx',
    markers: ['approval-workbench-head', '审批队列', '人工审批决定', 'DecisionActionStrip'],
  },
  {
    pageFile: 'pages/readback-page.tsx',
    markers: ['readback-current-step-summary', 'readback-current-step-meta', '1. 选择已批准动作', '2. 填写审批凭证', 'SafetyGateLine'],
  },
  {
    pageFile: 'pages/keyword-opportunities-page.tsx',
    markers: ['关键词机会池', 'keyword-opportunity-summary-grid', 'keyword-opportunity-blocker-strip', '机会口径、来源和复核摘要', 'folded-ops-panel'],
  },
  {
    pageFile: 'pages/listing-optimization-page.tsx',
    markers: ['listing-editor-panel', 'listing-draft-panel', '核心商机词根覆盖', '关键词与本地草案工作台'],
  },
  {
    pageFile: 'pages/scheduler-page.tsx',
    markers: ['scheduler-prototype-status-grid', '本地调度控制器', '自动化安全边界', '任务列表'],
  },
  {
    pageFile: 'pages/settings-page.tsx',
    markers: ['settings-ai-workbench', 'settings-ai-contract-copy-folded', 'AI 服务连接', '规则阈值与动作边界', 'FormTable'],
  },
  {
    pageFile: 'pages/delivery-page.tsx',
    markers: ['delivery-summary-workbench', '交付摘要', '交付判断依据', '业务闭环矩阵', '交付消息'],
  },
] as const;

function rendererSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('prototype parity design system integration', () => {
  it('uses a shared first-screen density contract on all prototype-mapped business pages', () => {
    for (const pageFile of PAGE_FILES) {
      const source = rendererSource(pageFile);

      const tableFirstWorkbenchContracts: Partial<Record<(typeof PAGE_FILES)[number], string[]>> = {
        'pages/dashboard-page.tsx': ['TaskBanner', 'SummaryStrip', 'WorkbenchPanel', 'PriorityDataTable'],
        'pages/product-management-page.tsx': ['product-management-topline', 'product-management-shell'],
        'pages/operation-scope-page.tsx': ['operation-scope-confirm-panel', 'operation-scope-field-card'],
        'pages/data-import-validation-page.tsx': ['data-import-primary-panel', 'data-import-prototype-table'],
        'pages/product-config-page.tsx': ['product-config-page-stack', 'product-config-list-panel'],
        'pages/ad-quant-page.tsx': ['ad-quant-workbench-toolbar', 'ad-quant-primary-panel', '广告表现阻断'],
        'pages/recommendations-page.tsx': ['recommendation-primary-panel', 'recommendation-primary-head', 'recommendation-workbench-table'],
        'pages/keyword-opportunities-page.tsx': ['keyword-opportunity-summary-grid', 'keyword-opportunity-blocker-strip', 'folded-ops-panel'],
        'pages/listing-optimization-page.tsx': ['listing-optimization-page-stack', 'listing-editor-panel', 'listing-draft-panel'],
        'pages/approval-page.tsx': ['approval-workbench-head', 'approval-table'],
        'pages/readback-page.tsx': ['readback-current-step-summary', 'readback-step-grid'],
        'pages/settings-page.tsx': ['settings-ai-workbench', 'settings-ai-contract-copy-folded'],
        'pages/delivery-page.tsx': ['delivery-summary-workbench', 'delivery-summary-hero'],
      };
      const workbenchContract = tableFirstWorkbenchContracts[pageFile];
      if (workbenchContract) {
        for (const marker of workbenchContract) {
          expect(source, `${pageFile} should include ${marker}`).toContain(marker);
        }
        continue;
      }

      expect(source, pageFile).toContain('KpiCard');
      expect(source, pageFile).toContain('className="kpi-row');
    }
  });

  it('keeps all 17 prototype-mapped pages on their first-screen structure contract', () => {
    for (const { pageFile, markers } of PROTOTYPE_FIRST_SCREEN_MARKERS) {
      const source = rendererSource(pageFile);

      for (const marker of markers) {
        expect(source, `${pageFile} should include ${marker}`).toContain(marker);
      }
    }
  });

  it('keeps production renderer assets offline and light-theme only', () => {
    const indexHtml = rendererSource('index.html');
    const styles = rendererSource('styles.css');

    expect(indexHtml).not.toContain('fonts.googleapis.com');
    expect(styles).not.toContain('fonts.googleapis.com');
    expect(styles).not.toContain('DM Sans');
    expect(styles).not.toContain('DM Mono');
    expect(styles).not.toContain('.dark');
    expect(styles).not.toContain('color-scheme: dark');
  });

  it('keeps the login surface on shared light-theme tokens instead of one-off hex colors', () => {
    const appSource = rendererSource('App.tsx');
    const loginStylesStart = appSource.indexOf('const loginStyles');
    const loginStylesEnd = appSource.indexOf('export function describeLoginSession', loginStylesStart);
    const loginStylesSource = appSource.slice(loginStylesStart, loginStylesEnd);

    expect(loginStylesSource).toContain('var(--aao-bg)');
    expect(loginStylesSource).toContain('var(--aao-surface)');
    expect(loginStylesSource).toContain('var(--tone-ready-bg)');
    expect(loginStylesSource).toContain('var(--tone-blocked-bg)');
    expect(loginStylesSource).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('does not leave prototype-only component stubs in the shared UI module', () => {
    const uiSource = rendererSource('components/ui.tsx');

    expect(uiSource).not.toContain('AiModuleCard');
    expect(uiSource).not.toContain('EmptyState');
    expect(uiSource).not.toContain('ContentCard');
    expect(uiSource).not.toContain('SectionHeader');
  });
});
