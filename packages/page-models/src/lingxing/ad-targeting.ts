import type { PageModel } from '@amazon-ai-ops/shared-types';
import { BUTTON, INPUT } from '../shared/locator-presets';

export const AD_TARGETING_PAGE: PageModel = {
  id: 'lingxing-ad-targeting',
  name: '广告关键词管理',
  version: '1.0.0',
  lingxingVersion: '2.0',
  elements: {
    'campaign-name': {
      id: 'col-campaign-name',
      strategies: [
        { type: 'text', value: '广告活动', timeout: 5000 },
      ],
      description: '广告活动列',
    },
    'ad-group-name': {
      id: 'col-ad-group-name',
      strategies: [
        { type: 'text', value: '广告组', timeout: 5000 },
      ],
      description: '广告组列',
    },
    'targeting-input': {
      id: 'col-targeting',
      strategies: [
        { type: 'text', value: '关键词', timeout: 5000 },
        { type: 'text', value: '投放', timeout: 5000 },
      ],
      description: '关键词/投放列',
    },
    'match-type-badge': {
      id: 'col-match-type',
      strategies: [
        { type: 'text', value: '匹配类型', timeout: 5000 },
        { type: 'text', value: '匹配方式', timeout: 5000 },
      ],
      description: '匹配类型列',
    },
    'bid-input': {
      id: 'input-bid',
      strategies: [
        { type: 'css', value: 'input[type="number"][class*="bid"]', timeout: 5000 },
        { type: 'css', value: 'input[class*="bid"]', timeout: 5000 },
      ],
      description: '出价输入框',
    },
    'status-toggle': {
      id: 'toggle-status',
      strategies: [
        { type: 'css', value: '.ant-switch', timeout: 5000 },
        { type: 'role', value: 'switch', index: 0 },
      ],
      description: '状态开关',
    },
    'negative-btn': {
      id: 'btn-negative',
      strategies: [
        { type: 'text', value: '否词', timeout: 5000 },
        { type: 'text', value: '添加否定', timeout: 5000 },
      ],
      description: '添加否词按钮',
    },
    'negative-dialog': {
      id: 'dialog-negative',
      strategies: [
        { type: 'css', value: '.ant-modal', timeout: 5000 },
        { type: 'text', value: '否定', timeout: 5000 },
      ],
      description: '否定词对话框',
    },
    'negative-confirm': BUTTON.CLICK('确认'),
  },
  waitConditions: [
    { type: 'networkidle', timeout: 30000 },
  ],
  stateCheck: {
    loggedIn: {
      urlPatterns: ['/ads/targeting', '/ad/keyword', '/ads/keyword'],
      requiredTexts: ['广告', '关键词', '投放'],
      forbiddenTexts: ['登录'],
    },
  },
  verifySelectors: ['.ant-table-tbody'],
  updatedAt: '2024-01-01',
};
