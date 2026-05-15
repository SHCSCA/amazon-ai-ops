import type { PageModel } from '@amazon-ai-ops/shared-types';
import { BUTTON, INPUT, SELECT, DATE_PICKER, TABLE } from '../shared/locator-presets';

export const AD_EXPORT_PAGE: PageModel = {
  id: 'lingxing-ad-export',
  name: '广告报表导出',
  version: '1.0.0',
  lingxingVersion: '2.0',
  elements: {
    // 导航
    'ad-menu': {
      id: 'nav-ad',
      strategies: [
        { type: 'text', value: '广告', timeout: 5000 },
        { type: 'text', value: '广告管理', timeout: 5000 },
      ],
      description: '广告菜单',
    },
    'report-submenu': {
      id: 'nav-ad-report',
      strategies: [
        { type: 'text', value: '报表', timeout: 5000 },
        { type: 'text', value: '广告报表', timeout: 5000 },
      ],
      description: '广告报表子菜单',
    },
    // 筛选条件
    'store-selector': {
      id: 'filter-store',
      strategies: [
        { type: 'css', value: '[class*="store-select"] input', timeout: 5000 },
        { type: 'css', value: '.ant-select[name="store"] input', timeout: 5000 },
        { type: 'text', value: '请选择店铺', timeout: 5000 },
      ],
      description: '店铺选择器',
    },
    'marketplace-selector': {
      id: 'filter-marketplace',
      strategies: [
        { type: 'css', value: '[class*="marketplace-select"] input', timeout: 5000 },
        { type: 'text', value: '请选择站点', timeout: 5000 },
      ],
      description: '站点选择器',
    },
    'date-range-picker': DATE_PICKER.INPUT(),
    'date-preset-7d': {
      id: 'date-preset-7d',
      strategies: [
        { type: 'text', value: '近7天', timeout: 3000 },
      ],
      description: '近7天快捷选项',
    },
    'date-preset-14d': {
      id: 'date-preset-14d',
      strategies: [
        { type: 'text', value: '近14天', timeout: 3000 },
      ],
      description: '近14天快捷选项',
    },
    'date-preset-30d': {
      id: 'date-preset-30d',
      strategies: [
        { type: 'text', value: '近30天', timeout: 3000 },
      ],
      description: '近30天快捷选项',
    },
    'search-input': INPUT.SEARCH(),
    'asin-filter': {
      id: 'filter-asin',
      strategies: [
        { type: 'css', value: 'input[placeholder*="ASIN"]', timeout: 5000 },
        { type: 'css', value: 'input[placeholder*="asin"]', timeout: 5000 },
      ],
      description: 'ASIN 筛选输入框',
    },
    // 操作按钮
    'export-button': {
      id: 'btn-export',
      strategies: [
        { type: 'text', value: '导出', timeout: 5000 },
        { type: 'text', value: '导出数据', timeout: 5000 },
        { type: 'role', value: 'button', index: 0 },
      ],
      description: '导出按钮',
    },
    'export-dialog': {
      id: 'dialog-export',
      strategies: [
        { type: 'css', value: '.ant-modal', timeout: 5000 },
        { type: 'text', value: '导出', timeout: 5000 },
      ],
      description: '导出对话框',
    },
    'export-confirm': BUTTON.CLICK('确认导出'),
    'export-type-campaign': {
      id: 'export-type-campaign',
      strategies: [
        { type: 'text', value: '广告活动', timeout: 5000 },
      ],
      description: '广告活动报表类型',
    },
    'export-type-targeting': {
      id: 'export-type-targeting',
      strategies: [
        { type: 'text', value: '关键词', timeout: 5000 },
        { type: 'text', value: '投放', timeout: 5000 },
      ],
      description: '关键词/投放报表类型',
    },
    'export-type-search-term': {
      id: 'export-type-search-term',
      strategies: [
        { type: 'text', value: '搜索词', timeout: 5000 },
      ],
      description: '搜索词报表类型',
    },
    // 表格
    'data-table': TABLE.BODY(),
    'table-row-first': TABLE.ROW(0),
    // 状态
    'loading-mask': {
      id: 'loading-mask',
      strategies: [
        { type: 'css', value: '.ant-spin', timeout: 3000 },
        { type: 'css', value: '[class*="loading"]', timeout: 3000 },
      ],
      description: '加载中遮罩',
    },
    'empty-state': {
      id: 'empty-state',
      strategies: [
        { type: 'text', value: '暂无数据', timeout: 3000 },
        { type: 'css', value: '.ant-empty', timeout: 3000 },
      ],
      description: '空状态',
    },
    'download-complete-toast': {
      id: 'toast-download-complete',
      strategies: [
        { type: 'text', value: '下载成功', timeout: 5000 },
        { type: 'text', value: '导出成功', timeout: 5000 },
      ],
      description: '下载完成提示',
    },
  },
  waitConditions: [
    { type: 'networkidle', timeout: 30000 },
    { type: 'selector', value: '.ant-table-tbody', timeout: 15000 },
  ],
  stateCheck: {
    loggedIn: {
      urlPatterns: ['/ads/report', '/ad/report', '/report/ads', '/erp/ads'],
      requiredTexts: ['广告', '报表'],
      forbiddenTexts: ['登录', 'signin'],
    },
    loggedOut: {
      urlPatterns: ['/login', '/signin'],
      requiredTexts: ['登录', '账号'],
    },
  },
  verifySelectors: ['.ant-table-tbody', 'button:has-text("导出")'],
  updatedAt: '2024-01-01',
};
