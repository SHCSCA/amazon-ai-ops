import type { PageModel } from '@amazon-ai-ops/shared-types';
import { BUTTON, INPUT } from '../shared/locator-presets';

export const LOGIN_PAGE: PageModel = {
  id: 'lingxing-login',
  name: '登录页',
  version: '1.0.0',
  lingxingVersion: '2.0',
  elements: {
    'username-input': {
      id: 'login-username',
      strategies: [
        { type: 'css', value: 'input[placeholder*="账号"]', timeout: 10000 },
        { type: 'css', value: 'input[name="username"]', timeout: 5000 },
        { type: 'label', value: '账号', timeout: 5000 },
      ],
      description: '用户名输入框',
    },
    'password-input': {
      id: 'login-password',
      strategies: [
        { type: 'css', value: 'input[placeholder*="密码"]', timeout: 10000 },
        { type: 'css', value: 'input[name="password"]', timeout: 5000 },
        { type: 'label', value: '密码', timeout: 5000 },
      ],
      description: '密码输入框',
    },
    'submit-button': BUTTON.CLICK('登录'),
    'submit-button-alt': {
      id: 'login-submit',
      strategies: [
        { type: 'css', value: 'button[type="submit"]', timeout: 5000 },
        { type: 'role', value: 'button', index: 0 },
      ],
      description: '登录提交按钮',
    },
    'captcha-image': {
      id: 'login-captcha',
      strategies: [
        { type: 'css', value: 'img[class*="captcha"]', timeout: 5000 },
        { type: 'css', value: '.captcha-img', timeout: 5000 },
      ],
      description: '验证码图片',
    },
    'error-message': {
      id: 'login-error',
      strategies: [
        { type: 'css', value: '.ant-alert-error', timeout: 3000 },
        { type: 'text', value: '账号或密码错误', timeout: 3000 },
      ],
      description: '登录错误提示',
    },
  },
  waitConditions: [
    { type: 'domcontentloaded', timeout: 15000 },
  ],
  stateCheck: {
    loggedOut: {
      urlPatterns: ['/login', '/signin', '/auth'],
      requiredTexts: ['登录', '账号', '密码'],
    },
  },
  verifySelectors: ['input[name="username"]', 'input[name="password"]', 'button[type="submit"]'],
  updatedAt: '2024-01-01',
};
