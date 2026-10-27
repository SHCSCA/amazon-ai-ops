import {
type StoreContextEnvelope,
type StoreWorkspaceView
} from '@amazon-ai-ops/shared-types';
import type {
BrowserLoginRequest
} from '../shared/login-contract';
import { type LoginSessionInfo } from './app-login-state';
import type { DeliveryReadinessView } from './types';

export function currentConnectionSessionState(
  loginSession: Readonly<{
    adsSessionReady?: boolean;
    erpSessionReady?: boolean;
  }> | null | undefined,
): Readonly<{
  adsSessionConnected: boolean;
  erpSessionConnected: boolean;
}> {
  return Object.freeze({
    adsSessionConnected: loginSession?.adsSessionReady === true,
    erpSessionConnected: loginSession?.erpSessionReady === true,
  });
}

export const CONNECTION_INTERNAL_OPERATOR_COPY = /\b(?:Mission|Experiment|UNKNOWN|revision|draft|Main|StoreContext|Authority|Profile|manifest|fingerprint|Renderer|CRUD|PRODUCTION_NATIVE|PROTOTYPE_ONLY|LEGACY_ADAPTER|sequence|correction|DECISION|ACTION|READBACK|EFFECT)\b|\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b|\bset_keyword_bid\b|\bdry-run\b|\bappend-only\b/i;

export function connectionOperatorCopy(value: unknown, fallback: string): string {
  const message = typeof value === 'string' ? value.trim() : '';
  if (!message || CONNECTION_INTERNAL_OPERATOR_COPY.test(message)) return fallback;
  return message;
}

export function connectionAttemptOperatorCopy(
  value: unknown,
  session: Readonly<{
    adsSessionConnected: boolean;
    erpSessionConnected: boolean;
  }>,
): string {
  const fallback = session.erpSessionConnected
    ? 'ERP 当前会话仍可用于只读采集，但 Ads 会话没有建立。请点击“重试 Ads”；若按钮不可用，请重新连接 ERP 与 Ads，真实广告执行继续阻断。'
    : '本次可见浏览器会话没有建立或已经结束；账户与店铺映射仍保留。请点击“启动当前店铺连接”重新建立 ERP 与 Ads 会话，真实广告执行继续阻断。';
  return connectionOperatorCopy(value, fallback);
}

export function configuredSessionResetRequiredFromError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('当前领星会话身份未经本次凭证验证');
}

export function configuredSessionResetActionVisible(
  error: unknown,
  localRequired: boolean,
): boolean {
  return localRequired || configuredSessionResetRequiredFromError(error);
}

export function describeLoginSession(session?: LoginSessionInfo | null): string {
  if (!session) return 'ERP/Ads 会话：待确认';
  if (
    session.erpSessionReused
    && session.sessionIdentityVerified === false
  ) {
    const ads = session.adsTitle || session.adsUrl ? `Ads 已进入：${session.adsTitle || session.adsUrl}` : 'Ads 会话待确认';
    const identity = session.credentialPersistence === 'not_saved_unverified_session'
      ? '账号和本次密码均未核验'
      : '保存账号未与当前 ERP 会话核验';
    return `ERP 已复用登录态；${identity}，本机安全区未更改；${ads}`;
  }
  const erp = session.erpSessionReady === true
    ? session.erpSessionReused ? 'ERP 已复用登录态' : 'ERP 已完成登录'
    : 'ERP 会话待确认';
  const ads = session.adsSessionReady === false
    ? session.adsTitle || session.adsUrl
      ? `Ads 页面已打开，当前店铺身份待识别：${session.adsUnavailableReason || '真实广告执行保持阻断'}`
      : `Ads 未连接：${session.adsUnavailableReason || '独立 Ads 会话待授权，广告执行保持阻断'}`
    : session.adsSessionReady === true && (session.adsTitle || session.adsUrl)
      ? `Ads 已进入：${session.adsTitle || session.adsUrl}`
      : session.adsSessionReady === true ? 'Ads 已连接' : 'Ads 会话待确认';
  return `${erp}；${ads}`;
}

export function headerSessionStatusLabel(session?: LoginSessionInfo | null): string {
  if (!session) return '会话待确认';
  if (
    session.erpSessionReused
    && session.sessionIdentityVerified === false
  ) {
    return 'ERP 会话复用 · 身份未核验';
  }
  const erpReady = session.erpSessionReady === true;
  const adsReady = session.adsSessionReady === true;
  if (erpReady && adsReady) return session.sessionIdentityVerified === true ? 'ERP/Ads 已连接' : 'ERP/Ads 身份待确认';
  if (erpReady && session.adsSessionReady === false && Boolean(session.adsTitle || session.adsUrl)) {
    return 'ERP 已连接 · Ads 待识别';
  }
  if (erpReady && session.adsSessionReady === false) return 'ERP 已连接 · Ads 待授权';
  if (adsReady) return 'Ads 已连接';
  if (erpReady) return 'ERP 已连接';
  return '会话确认中';
}

export function headerReadinessLabel(readiness: DeliveryReadinessView | null): string {
  if (readiness?.appReady && readiness?.manifestDriven) return '应用包验收通过';
  if (readiness?.available === false) return '待生成验收';
  return '等待最终验收';
}

export interface LoginSubmitButtonView {
  ariaBusy?: boolean;
  className: string;
  label: string;
  loading: boolean;
}

export function loginSubmitButtonView(loading: boolean): LoginSubmitButtonView {
  return {
    ariaBusy: loading ? true : undefined,
    className: ['login-submit-button', loading ? 'button-loading' : ''].filter(Boolean).join(' '),
    label: loading ? '正在启动当前店铺连接...' : '启动当前店铺连接',
    loading,
  };
}

export function loginStatusMessage(input: {
  credentialSource?: 'saved' | 'typed';
  loading: boolean;
  credentialNotice?: string;
  rememberPassword: boolean;
}): string {
  if (input.loading) {
    return input.credentialSource === 'saved'
      ? '正在启动领星与 Ads 可见会话；已保存密码只在本机安全区解密。'
      : '正在启动领星与 Ads 可见会话；本次输入只用于建立当前会话。';
  }
  if (input.credentialNotice) {
    return connectionOperatorCopy(
      input.credentialNotice,
      '凭证状态异常，请重新输入密码后重试。',
    );
  }
  if (input.rememberPassword) return '勾选后密码保存在本机安全区；账号保留在本机用于下次识别。';
  return '未记住密码；账号仍保留在本机，密码只用于本次登录。';
}

export type SavedLoginCredentialState =
  | 'none'
  | 'encrypted_ready'
  | 'migrated'
  | 'encryption_unavailable'
  | 'encrypted_corrupt'
  | 'migration_failed';

export type LoginCredentialTone = 'neutral' | 'ready' | 'warning' | 'blocked';

export function savedLoginCredentialTone(input: {
  credentialState?: SavedLoginCredentialState;
  passwordAvailable?: boolean;
}): LoginCredentialTone {
  if (input.passwordAvailable) return 'ready';
  if (input.credentialState === 'encrypted_corrupt' || input.credentialState === 'migration_failed') {
    return 'blocked';
  }
  if (input.credentialState === 'encryption_unavailable') return 'warning';
  return 'neutral';
}

export function loginSecurityTagView(input: {
  credentialSource: 'saved' | 'typed';
  credentialState: SavedLoginCredentialState;
  loading: boolean;
  passwordAvailable: boolean;
}): { className: string; label: string } {
  if (input.loading) {
    return { className: 'login-security-tag login-security-tag-pending', label: '会话确认中' };
  }
  if (input.credentialSource === 'saved' && input.passwordAvailable) {
    return { className: 'login-security-tag login-security-tag-ready', label: '本机安全区托管' };
  }
  if (input.credentialState === 'encryption_unavailable') {
    return { className: 'login-security-tag login-security-tag-warning', label: '本次不保存' };
  }
  if (input.credentialState === 'encrypted_corrupt' || input.credentialState === 'migration_failed') {
    return { className: 'login-security-tag login-security-tag-blocked', label: '需重新输入' };
  }
  return { className: 'login-security-tag', label: '当前页面输入' };
}

export function savedLoginCredentialNotice(input: {
  credentialState?: SavedLoginCredentialState;
  passwordAvailable?: boolean;
  rememberPassword?: boolean;
}): string {
  if (input.passwordAvailable) {
    return input.credentialState === 'migrated'
      ? '旧版密码已迁移至本机安全区；后续登录由本机安全区托管，当前页面不会读取密码。'
      : '已加载账号；保存的密码由本机安全区托管，当前页面不会读取。';
  }
  if (input.credentialState === 'encryption_unavailable') {
    return '当前系统无法使用本机加密；请重新输入密码，本次仅登录、不保存密码。';
  }
  if (input.credentialState === 'encrypted_corrupt') {
    return '本机保存的密码无法解密，请重新输入并保存。';
  }
  if (input.credentialState === 'migration_failed') {
    return '旧版凭证尚未完成安全迁移，系统未把旧密码发送到界面；请重新输入密码。';
  }
  if (input.rememberPassword) return '已加载账号，密码需重新输入。';
  return '';
}

export function buildBrowserLoginRequest(input: {
  credentialSource: 'saved' | 'typed';
  password: string;
  resetLingxingSessionForEnrollment?: boolean;
  rememberPassword: boolean;
  savedCredentialUsername: string;
  savedPasswordAvailable: boolean;
  storeContext: StoreContextEnvelope | null;
  lingxingCollectionStoreName: string;
  username: string;
}): BrowserLoginRequest | null {
  const username = input.username.trim();
  const lingxingCollectionStoreName = input.lingxingCollectionStoreName.trim();
  const useSavedCredential = input.credentialSource === 'saved'
    && input.savedPasswordAvailable
    && input.rememberPassword
    && input.resetLingxingSessionForEnrollment !== true
    && username === input.savedCredentialUsername;
  if (!username || !lingxingCollectionStoreName || !input.storeContext) return null;
  if (useSavedCredential) {
    return {
      username,
      credentialSource: 'saved',
      rememberPassword: true,
      storeContext: input.storeContext,
    };
  }
  if (!input.password) return null;
  return {
    username,
    credentialSource: 'typed',
    password: input.password,
    rememberPassword: input.rememberPassword,
    storeContext: input.storeContext,
    ...(input.resetLingxingSessionForEnrollment === true
      ? { resetLingxingSessionForEnrollment: true }
      : {}),
  };
}

export function resolveAdsRetryCredentialAvailability(input: Readonly<{
  connectionUsername: string;
  loginSession?: LoginSessionInfo | null;
  rememberPassword: boolean;
  savedCredentialUsername: string;
  savedPasswordAvailable: boolean;
}>): Readonly<{
  passwordAvailable: boolean;
  rememberPassword: boolean;
  username: string;
}> {
  const connectionUsername = input.connectionUsername.trim();
  const sessionBackedCredential = Boolean(
    connectionUsername
    && input.loginSession?.erpSessionReady === true
    && input.loginSession?.sessionIdentityVerified === true
    && (
      input.loginSession?.credentialPersistence === 'saved'
      || input.loginSession?.credentialPersistence === 'main_managed'
    ),
  );
  return {
    passwordAvailable: input.savedPasswordAvailable || sessionBackedCredential,
    rememberPassword: input.rememberPassword || sessionBackedCredential,
    username: input.savedCredentialUsername.trim()
      || (sessionBackedCredential ? connectionUsername : ''),
  };
}

export function selectFreshBrowserLoginStoreContext(
  expected: StoreContextEnvelope | null,
  activeView: StoreWorkspaceView | null,
): StoreContextEnvelope {
  if (!expected || !activeView) {
    throw new Error('当前店铺授权上下文不可用，请刷新店铺后重新连接。');
  }
  const candidate = activeView.context;
  const returnedStore = activeView.store;
  if (
    candidate.storeId !== expected.storeId
    || candidate.browserProfileId !== expected.browserProfileId
    || candidate.marketplace !== expected.marketplace
    || candidate.currency !== expected.currency
    || candidate.businessTimezone !== expected.businessTimezone
    || returnedStore.storeId !== candidate.storeId
    || returnedStore.browserProfileId !== candidate.browserProfileId
    || returnedStore.marketplace !== candidate.marketplace
    || returnedStore.currency !== candidate.currency
    || returnedStore.businessTimezone !== candidate.businessTimezone
  ) {
    throw new Error('本机读取的当前店铺身份与正在操作的店铺不一致，请刷新店铺后重新连接；本次操作已阻断。');
  }
  return candidate;
}

export function formatConnectionSuccessTime(value?: string): string {
  if (!value) return '本次会话刚刚确认';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return '本次会话已确认';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).format(timestamp);
}

export function headerReadinessClass(readiness: DeliveryReadinessView | null): string {
  if (readiness?.appReady && readiness?.manifestDriven) return 'app-status app-status-ready';
  if (readiness?.available === false) return 'app-status app-status-pending';
  return 'app-status app-status-warning';
}

export interface StoreConnectionCredentialDraft {
  storeId: string;
  username: string;
  password: string;
  rememberPassword: boolean;
  credentialSource: 'saved' | 'typed';
  resetLingxingSessionForEnrollment: boolean;
  dirty: boolean;
  hydrated: boolean;
}

export type StoreConnectionLoginAction = 'initial' | 'retry-ads' | 'reconnect-all';

export interface StoreLoginAttemptEvidence {
  storeId: string;
  sequence: number;
  pending: boolean;
  action: StoreConnectionLoginAction;
  error: string;
}

export function emptyStoreConnectionCredentialDraft(storeId: string): StoreConnectionCredentialDraft {
  return {
    storeId,
    username: '',
    password: '',
    rememberPassword: false,
    credentialSource: 'typed',
    resetLingxingSessionForEnrollment: false,
    dirty: false,
    hydrated: false,
  };
}

export function emptyStoreLoginAttemptEvidence(storeId: string): StoreLoginAttemptEvidence {
  return {
    storeId,
    sequence: 0,
    pending: false,
    action: 'initial',
    error: '',
  };
}
