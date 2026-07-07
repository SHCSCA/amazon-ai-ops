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
    markers: ['dashboard-prototype-kpi-strip', '风险对象', '产品工作台', '广告历史账本摘要'],
  },
  {
    pageFile: 'pages/product-management-page.tsx',
    markers: ['product-prototype-status-grid', '产品列表', '产品信息维护'],
  },
  {
    pageFile: 'pages/operation-scope-page.tsx',
    markers: ['operation-scope-prototype-status-grid', '范围设置', '当前范围摘要', 'FormTable'],
  },
  {
    pageFile: 'pages/data-collection-page.tsx',
    markers: ['data-collection-prototype-status-grid', '采集进度', '8 类报表选择'],
  },
  {
    pageFile: 'pages/data-import-validation-page.tsx',
    markers: ['data-import-prototype-status-grid', '导入批次状态', 'data-import-prototype-table'],
  },
  {
    pageFile: 'pages/operation-events-page.tsx',
    markers: ['operation-events-prototype-status-grid', '当前范围与作用', 'OPERATION_EVENT_PAGE_COPY.newEventPanelTitle', 'OPERATION_EVENT_PAGE_COPY.timelinePanelTitle'],
  },
  {
    pageFile: 'pages/product-config-page.tsx',
    markers: ['product-config-prototype-status-grid', '当前范围产品配置', '产品基础信息', '利润与广告目标'],
  },
  {
    pageFile: 'pages/ad-quant-page.tsx',
    markers: ['ad-quant-prototype-kpi-strip', '广告表现聚焦', '当前范围', '数据来源与量化口径', '实体诊断'],
  },
  {
    pageFile: 'pages/recommendations-page.tsx',
    markers: ['recommendations-prototype-status-grid', '建议池筛选', '建议生成范围', '建议处理路径', '待处理建议'],
  },
  {
    pageFile: 'pages/approval-page.tsx',
    markers: ['approval-prototype-status-grid', '人工审批任务', '审批队列', '人工审批决定', 'DecisionActionStrip'],
  },
  {
    pageFile: 'pages/readback-page.tsx',
    markers: ['readback-prototype-status-grid', '1. 选择已批准动作', '2. 填写审批凭证', 'SafetyGateLine'],
  },
  {
    pageFile: 'pages/keyword-opportunities-page.tsx',
    markers: ['keyword-prototype-status-grid', '机会来源', '关键词机会与 Listing 覆盖关系', '可带入 Listing 的机会表'],
  },
  {
    pageFile: 'pages/listing-optimization-page.tsx',
    markers: ['listing-prototype-status-grid', '本地草案工作流', '核心商机词根热力图矩阵', '关键词与本地草案工作台'],
  },
  {
    pageFile: 'pages/scheduler-page.tsx',
    markers: ['scheduler-prototype-status-grid', '本地调度控制器', '自动化安全边界', '任务列表'],
  },
  {
    pageFile: 'pages/settings-page.tsx',
    markers: ['settings-prototype-status-grid', 'settings-prototype-actions', 'AI 服务连接', '规则阈值与动作边界', 'FormTable'],
  },
  {
    pageFile: 'pages/delivery-page.tsx',
    markers: ['delivery-prototype-status-grid', '交付摘要', '交付判断依据', '业务闭环矩阵', '交付消息'],
  },
] as const;

function rendererSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('prototype parity design system integration', () => {
  it('uses the shared KPI card strip on all prototype-mapped business pages', () => {
    for (const pageFile of PAGE_FILES) {
      const source = rendererSource(pageFile);

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
