import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const copyPath = new URL('./page-header-copy.ts', import.meta.url);

const expectedTitles = {
  dashboard: '今日看板',
  productManagement: '产品管理',
  operationScope: '工作范围',
  dataCollection: '数据采集',
  dataImportValidation: '导入校验',
  operationEvents: '运营事件',
  productConfig: '成本目标',
  adQuant: '广告表现',
  recommendations: '优化建议',
  approval: '审批中心',
  readback: '结果核对',
  keywordOpportunities: '关键词机会',
  listingOptimization: 'Listing草案',
  delivery: '交付验收',
  scheduler: '自动任务',
  settings: 'AI与规则',
};

const pageTitleBindings = [
  ['dashboard', 'pages/dashboard-page.tsx', 'dashboard'],
  ['product management', 'pages/product-management-page.tsx', 'productManagement'],
  ['operation scope', 'pages/operation-scope-page.tsx', 'operationScope'],
  ['data collection', 'pages/data-collection-page.tsx', 'dataCollection'],
  ['data import validation', 'pages/data-import-validation-page.tsx', 'dataImportValidation'],
  ['operation events', 'pages/operation-events-page.tsx', 'operationEvents'],
  ['product config', 'pages/product-config-page.tsx', 'productConfig'],
  ['ad quant', 'pages/ad-quant-page.tsx', 'adQuant'],
  ['recommendations', 'pages/recommendations-page.tsx', 'recommendations'],
  ['approval', 'pages/approval-page.tsx', 'approval'],
  ['readback', 'pages/readback-page.tsx', 'readback'],
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
});
