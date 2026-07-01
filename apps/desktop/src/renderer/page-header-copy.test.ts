import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const copyPath = new URL('./page-header-copy.ts', import.meta.url);

const expectedTitles = {
  dashboard: '今日运营看板与自动化链路就绪健康度总览',
  productManagement: '店铺商品 SKU / ASIN 本地主映射数据对齐工作台',
  operationScope: '设置全局分析视图与计价边界',
  dataCollection: '领星下载中心广告报告自动化批量采集管道',
  dataImportValidation: '原始报表本地核验与 DuckDB 结构化对账工作台',
  operationEvents: '核心运营事件时间轴标记',
  productConfig: '产品 SKU / ASIN 量化阈值及 ACOS 警戒线控制中心',
  adQuant: '广告全口径量化诊断中心',
  recommendations: '广告优化策略生成建议草案工作台',
  approval: '策略修改行为安全决策审批中心',
  readback: '广告操作手动执行与截图存证过闸向导',
  keywordOpportunities: '全渠道多源融合关键词机会与商机评分看板',
  listingOptimization: '亚马逊 Listing 关键词覆盖热力图与结构化草案编辑器',
  delivery: '本地运营资产交付验证门与最终就绪审计中心',
  scheduler: '本地定时调度与自动化队列控制台',
  settings: '全局系统运行参数、大模型适配与存储诊断中心',
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
