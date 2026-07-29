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
  const amazonAdsProfileId = typeof candidate.amazonAdsProfileId === 'string'
    ? candidate.amazonAdsProfileId.trim()
    : '';
  if (
    !amazonAdsProfileId
    || amazonAdsProfileId.length > 256
    || /[\u0000-\u001f\u007f]/.test(amazonAdsProfileId)
  ) {
    throw new Error('请输入有效的 Amazon Ads Profile ID。');
  }
  const authority = { amazonAdsProfileId, storeContext };
  if (candidate.credentialSource === 'saved') {
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
  };
}
