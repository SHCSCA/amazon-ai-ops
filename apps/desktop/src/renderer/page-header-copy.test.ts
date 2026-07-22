import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const copyPath = new URL('./page-header-copy.ts', import.meta.url);

const expectedTitles = {
  productManagement: '产品',
  operationScope: '工作范围',
  dataCollection: '报表采集',
  dataImportValidation: '导入检查',
  operationEvents: '运营事件',
  productConfig: '目标与成本',
  adQuant: '广告诊断',
  recommendations: '待判断',
  approval: '待审批',
  readback: '结果核对',
  keywordOpportunities: '关键词机会',
  listingOptimization: 'Listing 草案',
  delivery: '交付验收',
  scheduler: '定时任务',
  settings: 'AI 与规则',
};

const pageTitleBindings = [
  ['operation scope', 'pages/operation-scope-page.tsx', 'operationScope'],
  ['data collection', 'pages/data-collection-page.tsx', 'dataCollection'],
  ['data import validation', 'pages/data-import-validation-page.tsx', 'dataImportValidation'],
  ['operation events', 'pages/operation-events-page.tsx', 'operationEvents'],
  ['product config', 'pages/product-config-page.tsx', 'productConfig'],
  ['ad quant', 'pages/ad-quant-page.tsx', 'adQuant'],
  ['recommendations', 'pages/recommendations-page.tsx', 'recommendations'],
  ['approval', 'pages/approval-page.tsx', 'approval'],
  ['keyword opportunities', 'pages/keyword-opportunities-page.tsx', 'keywordOpportunities'],
  ['listing optimization', 'pages/listing-optimization-page.tsx', 'listingOptimization'],
  ['delivery', 'pages/delivery-page.tsx', 'delivery'],
  ['scheduler', 'pages/scheduler-page.tsx', 'scheduler'],
  ['settings', 'pages/settings-page.tsx', 'settings'],
] as const;

describe('page header copy contract', () => {
  it('defines the spec-grade page title map', () => {
    expect(existsSync(copyPath)).toBe(true);

    const source = readFileSync(copyPath, 'utf8');
    for (const [key, title] of Object.entries(expectedTitles)) {
      expect(source).toContain(`${key}: '${title}'`);
    }
  });

  it.each(pageTitleBindings)('wires %s PageHeader title through the shared copy contract', (_name, pageFile, titleKey) => {
    const source = readFileSync(new URL(pageFile, import.meta.url), 'utf8');

    expect(source).toContain("import { PAGE_HEADER_TITLES } from '../page-header-copy'");
    expect(source).toContain(`title={PAGE_HEADER_TITLES.${titleKey}}`);
  });

  it('lets the product workspace shell own the single page heading', () => {
    const workspaceSource = readFileSync(new URL('mission-control/workspaces/objects-workspace.tsx', import.meta.url), 'utf8');
    const pageSource = readFileSync(new URL('pages/product-management-page.tsx', import.meta.url), 'utf8');

    expect(workspaceSource).toContain('<PageFrame');
    expect(workspaceSource).toContain("title={activeSubview === 'products' ? '店铺与广告对象' : surface.title}");
    expect(pageSource).not.toContain('<PageHeader');
    expect(pageSource).not.toContain('PAGE_HEADER_TITLES');
  });

  it('uses the task-first PageFrame title for Today instead of the legacy PageHeader contract', () => {
    const source = readFileSync(new URL('pages/dashboard-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<PageFrame');
    expect(source).toContain('title="今日任务"');
    expect(source).not.toContain('<PageHeader');
  });

  it('uses the task-first PageFrame title for readback instead of the legacy PageHeader contract', () => {
    const source = readFileSync(new URL('pages/readback-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<PageFrame');
    expect(source).toContain('title="结果核对"');
    expect(source).not.toContain('<PageHeader');
  });
});
