import type { PageModel } from '@amazon-ai-ops/shared-types';

export const INVENTORY_PAGE: PageModel = {
  id: 'lingxing-inventory',
  name: '库存管理',
  version: '1.0.0',
  lingxingVersion: '2.0',
  elements: {
    'inventory-menu': {
      id: 'nav-inventory',
      strategies: [
        { type: 'text', value: '库存', timeout: 5000 },
      ],
      description: '库存菜单',
    },
    'sku-filter': {
      id: 'filter-sku',
      strategies: [
        { type: 'css', value: 'input[placeholder*="SKU"]', timeout: 5000 },
        { type: 'css', value: 'input[placeholder*="ASIN"]', timeout: 5000 },
      ],
      description: 'SKU/ASIN 筛选',
    },
    'available-qty': {
      id: 'col-available-qty',
      strategies: [
        { type: 'text', value: '可用数量', timeout: 5000 },
        { type: 'text', value: '可售', timeout: 5000 },
      ],
      description: '可用数量列',
    },
    'reserved-qty': {
      id: 'col-reserved-qty',
      strategies: [
        { type: 'text', value: '预留数量', timeout: 5000 },
      ],
      description: '预留数量列',
    },
    'inbound-qty': {
      id: 'col-inbound-qty',
      strategies: [
        { type: 'text', value: '在途数量', timeout: 5000 },
        { type: 'text', value: '入库', timeout: 5000 },
      ],
      description: '在途数量列',
    },
    'inventory-days': {
      id: 'col-inventory-days',
      strategies: [
        { type: 'text', value: '库存天数', timeout: 5000 },
        { type: 'text', value: '可售天数', timeout: 5000 },
      ],
      description: '库存天数列',
    },
    'low-stock-alert': {
      id: 'alert-low-stock',
      strategies: [
        { type: 'css', value: '[class*="low-stock"]', timeout: 3000 },
        { type: 'text', value: '库存不足', timeout: 3000 },
      ],
      description: '低库存警告',
    },
    'export-button': {
      id: 'btn-export',
      strategies: [
        { type: 'text', value: '导出', timeout: 5000 },
      ],
      description: '导出按钮',
    },
  },
  waitConditions: [
    { type: 'networkidle', timeout: 30000 },
  ],
  stateCheck: {
    loggedIn: {
      urlPatterns: ['/inventory', '/stock'],
      requiredTexts: ['库存'],
      forbiddenTexts: ['登录'],
    },
  },
  verifySelectors: ['.ant-table-tbody'],
  updatedAt: '2024-01-01',
};
