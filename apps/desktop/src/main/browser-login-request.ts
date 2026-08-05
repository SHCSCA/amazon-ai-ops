import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { BrowserLoginRequest } from '../shared/login-contract';

export function normalizeBrowserLoginRequest(input: unknown): BrowserLoginRequest {
  const candidate = input && typeof input === 'object'
    ? input as Record<string, unknown>
    : {};
  const username = typeof candidate.username === 'string' ? candidate.username.trim() : '';
  if (!username || username.length > 256 || /[\u0000-\u001f\u007f]/.test(username)) {
    throw new Error('请输入有效的领星用户名。');
  }
  if (typeof candidate.rememberPassword !== 'boolean') {
    throw new Error('登录凭证的记住选项无效。');
  }
  const storeContext = normalizeStoreContextEnvelope(candidate.storeContext);
  if (Object.prototype.hasOwnProperty.call(candidate, 'amazonAdsProfileId')) {
    throw new Error('Amazon Ads 广告账户由 Main 从可见页面自动识别，Renderer 不得提交 Profile ID。');
  }
  const authority = { storeContext };
  if (
    candidate.resetLingxingSessionForEnrollment !== undefined
    && typeof candidate.resetLingxingSessionForEnrollment !== 'boolean'
  ) {
    throw new Error('领星会话重置确认值无效。');
  }
  if (candidate.credentialSource === 'saved') {
    if (candidate.resetLingxingSessionForEnrollment === true) {
      throw new Error('领星首次绑定会话重置必须使用本次手动输入的凭证。');
    }
    if (candidate.rememberPassword !== true) {
      throw new Error('保存凭证登录必须保持“记住密码”开启。');
    }
    return {
      ...authority,
      username,
      credentialSource: 'saved',
      rememberPassword: true,
    };
  }
  if (candidate.credentialSource !== 'typed') {
    throw new Error('登录凭证来源无效，请重新输入密码。');
  }
  const password = typeof candidate.password === 'string' ? candidate.password : '';
  if (!password || password.length > 4096 || /[\u0000\u007f]/.test(password)) {
    throw new Error('请输入有效的领星密码。');
  }
  return {
    ...authority,
    username,
    credentialSource: 'typed',
    password,
    rememberPassword: candidate.rememberPassword,
    ...(candidate.resetLingxingSessionForEnrollment === true
      ? { resetLingxingSessionForEnrollment: true }
      : {}),
  };
}
