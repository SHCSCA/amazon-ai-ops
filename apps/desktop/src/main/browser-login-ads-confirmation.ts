import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { ConfirmBrowserLoginAdsIdentityRequest } from '../shared/login-contract';

const SAFE_CONFIRMATION_TOKEN = /^[a-f0-9-]{16,128}$/i;

export function normalizeBrowserLoginAdsIdentityConfirmation(
  input: unknown,
): ConfirmBrowserLoginAdsIdentityRequest {
  const candidate = input && typeof input === 'object'
    ? input as Record<string, unknown>
    : {};
  const confirmationToken = typeof candidate.confirmationToken === 'string'
    ? candidate.confirmationToken.trim()
    : '';
  if (!SAFE_CONFIRMATION_TOKEN.test(confirmationToken)) {
    throw new Error('Amazon Ads 自动识别确认令牌无效或已失效。');
  }
  return {
    confirmationToken,
    storeContext: normalizeStoreContextEnvelope(candidate.storeContext),
  };
}
