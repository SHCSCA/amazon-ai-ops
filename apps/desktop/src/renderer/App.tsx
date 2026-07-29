import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { missionControlContextKey, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { AppRoute, DeliveryReadinessView, OperationScope } from './types';
import type {
  BrowserLoginCredentialPersistence,
  BrowserLoginRequest,
  BrowserLoginResult,
} from '../shared/login-contract';
import {
  DEFAULT_WORKSPACE_INTENTS,
  navigationIntentsEqual,
  navigationNeedsGlobalHandoff,
  normalizeNavigationTarget,
} from './navigation';
import type { NavigationIntent } from './navigation';
import { useScopeStore } from './scope-store';
import { deriveWorkflowEvidence, selectNextSafeAction } from './workflow-state';
import type { NextSafeAction, WorkflowEvidence } from './workflow-state';
import { subscribeWorkflowInvalidation } from './workflow-invalidation';
import type { WorkflowEventTarget, WorkflowInvalidationDetail } from './workflow-invalidation';
import { toUserFacingError } from './user-facing-error';
import { bootstrapBrowserPreview } from './dev-preview-api';
import { readbackAuthorityForMode } from './pages/readback-workspace-model';
import {
  MissionControlStoreContextProvider,
  useMissionControlStoreContext,
} from './mission-control/store-context';
import type { MissionControlStorePhase } from './mission-control/store-context';
import { MissionControlStoreGate } from './mission-control/store-gate';
import { useMissionControlBridge } from './mission-control/bridge/use-mission-control-bridge';
import {
  DEFAULT_BLOCKED_AUTONOMY,
  MissionControlShell,
} from './mission-control/mission-control-shell';
import { LegacyAdapterRouter } from './mission-control/router';
import { MissionControlWorkspaceView } from './mission-control/workspaces';
import { StoreManagementPanel, StoreRuntimeConfigPanel } from './mission-control/components';
import './styles.css';
import './styles/tokens.css';
import './styles/foundations.css';
import './styles/shell.css';
import './styles/workspace.css';
import './styles/priority-table.css';
import './styles/decisions.css';
import './styles/object-workspace.css';
import './styles/readback.css';
import './styles/states-motion.css';
import './styles/mission-control-shell.css';

interface LoginSessionInfo {
  erpSessionReady?: boolean;
  erpSessionReused?: boolean;
  sessionIdentityVerified?: boolean;
  adsSessionReady?: boolean;
  adsEntryMode?: string;
  adsUrl?: string;
  adsTitle?: string;
  adsUnavailableReason?: string;
  credentialPersistence?: BrowserLoginCredentialPersistence;
}

interface AppState {
  isLoggedIn: boolean;
  currentStore: string;
  loginSession?: LoginSessionInfo | null;
  loginStateRevision: number;
  activeNavigation: NavigationIntent;
  setActiveNavigation: (intent: NavigationIntent) => void;
  setLoginState: (isLoggedIn: boolean, store?: string, loginSession?: LoginSessionInfo | null) => void;
}

const useStore = create<AppState>((set) => ({
  isLoggedIn: false,
  currentStore: '',
  loginSession: null,
  loginStateRevision: 0,
  activeNavigation: DEFAULT_WORKSPACE_INTENTS.today,
  setActiveNavigation: (intent) => set({ activeNavigation: intent }),
  setLoginState: (isLoggedIn, store = '', loginSession = null) => set((state) => ({
    isLoggedIn,
    currentStore: store,
    loginSession,
    loginStateRevision: state.loginStateRevision + 1,
  })),
}));

export interface StoreAuthoritySnapshot {
  authorityKey: string | null;
  contextEpoch: number;
  phase: MissionControlStorePhase;
}

export function shouldInvalidateLoginForStoreAuthority(
  isLoggedIn: boolean,
  previous: StoreAuthoritySnapshot,
  current: StoreAuthoritySnapshot,
): boolean {
  if (!isLoggedIn) return false;

  // The first explicit store selection establishes the initial authority. Every
  // later switch starts a new browser/session authority, even when the operator
  // re-selects the same store.
  if (current.phase === 'switching') return current.contextEpoch > 0;

  // Once an authority has existed, losing it means the old ERP/Ads session can
  // no longer be displayed for any subsequent store selection.
  if (current.authorityKey === null) return current.contextEpoch > 0;

  // A direct Main-side authority replacement must also fail closed. The epoch
  // guard distinguishes it from the initial null -> first-authority bootstrap.
  if (previous.authorityKey === null) return current.contextEpoch > 1;
  return previous.authorityKey !== current.authorityKey;
}

export function shouldRestoreLoginForStoreAuthority(input: {
  responseIsLoggedIn: boolean;
  responseAuthorityKey: string | null;
  requestedAuthorityKey: string;
  currentAuthorityKey: string | null;
}): boolean {
  return input.responseIsLoggedIn
    && input.responseAuthorityKey !== null
    && input.responseAuthorityKey === input.requestedAuthorityKey
    && input.responseAuthorityKey === input.currentAuthorityKey;
}

function appStateAuthorityKey(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const context = (value as { storeContext?: unknown }).storeContext;
  if (!context) return null;
  try {
    return missionControlContextKey(context as StoreContextEnvelope);
  } catch {
    return null;
  }
}

function bootstrapAppBrowserPreview(username = 'SHC001') {
  if (typeof window === 'undefined') return { enabled: false } as const;
  return bootstrapBrowserPreview({
    dev: import.meta.env.DEV,
    target: window as any,
    username,
  });
}

interface WorkspaceScrollOwner {
  scrollLeft: number;
  scrollTop: number;
  scrollTo: (options: ScrollToOptions) => void;
}

export function resetWorkspaceScrollPosition(owner: WorkspaceScrollOwner | null): boolean {
  if (!owner) return false;
  owner.scrollTop = 0;
  owner.scrollLeft = 0;
  owner.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  return true;
}

const browserPreviewBootstrap = bootstrapAppBrowserPreview();

export function createAppNavigationEventHandler(onNavigate: (intent: NavigationIntent) => void) {
  return (event: Event): boolean => {
    const intent = normalizeNavigationTarget((event as CustomEvent<unknown>).detail);
    if (!intent) return false;
    onNavigate(intent);
    return true;
  };
}

export function subscribeAppWorkflowInvalidation(
  onInvalidate: (detail: WorkflowInvalidationDetail) => void,
  target?: WorkflowEventTarget,
): () => void {
  return subscribeWorkflowInvalidation(onInvalidate, target);
}

export function createLatestWorkflowLoadGuard() {
  let sequence = 0;
  return {
    begin() {
      sequence += 1;
      return sequence;
    },
    invalidate() {
      sequence += 1;
    },
    isCurrent(requestSequence: number) {
      return requestSequence === sequence;
    },
  };
}

function appElectronApi(username = 'SHC001') {
  bootstrapAppBrowserPreview(username);
  return (window as any).electronAPI;
}

const loginStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'grid',
    minHeight: '100vh',
    placeItems: 'center',
    background: 'var(--aao-bg)',
    padding: 24,
  },
  card: {
    display: 'grid',
    gap: 16,
    width: 'min(420px, 100%)',
    border: '1px solid var(--aao-line)',
    borderRadius: 10,
    background: 'var(--aao-surface)',
    padding: 28,
    boxShadow: '0 16px 40px rgba(15, 23, 42, 0.12)',
  },
  title: { margin: 0, color: 'var(--aao-ink)', fontSize: 26, lineHeight: 1.15 },
  subtitle: { margin: 0, color: 'var(--aao-ink-2)', fontSize: 13, fontWeight: 700 },
  form: { display: 'grid', gap: 12 },
  input: {
    height: 42,
    border: '1px solid var(--aao-line-strong)',
    borderRadius: 8,
    padding: '0 12px',
    fontSize: 15,
  },
  hint: {
    border: '1px solid var(--tone-pending-border)',
    borderRadius: 8,
    background: 'var(--tone-pending-bg)',
    color: 'var(--aao-ink-2)',
    padding: '10px 12px',
    fontSize: 13,
    lineHeight: 1.45,
  },
  rememberRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    color: 'var(--aao-ink-2)',
    fontSize: 13,
    fontWeight: 700,
  },
  rememberLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
  },
  notice: {
    color: 'var(--aao-ink-2)',
    fontSize: 12,
    lineHeight: 1.4,
  },
  error: {
    border: '1px solid var(--tone-blocked-border)',
    borderRadius: 8,
    background: 'var(--tone-blocked-bg)',
    color: 'var(--tone-blocked-text)',
    padding: '10px 12px',
    fontSize: 13,
  },
  connectionPanel: {
    display: 'grid',
    gap: 8,
    border: '1px solid var(--aao-line)',
    borderRadius: 8,
    background: 'var(--aao-surface-subtle)',
    padding: '10px 12px',
  },
  connectionStatus: {
    margin: 0,
    color: 'var(--aao-ink-2)',
    fontSize: 13,
    lineHeight: 1.45,
  },
  connectionButton: {
    height: 38,
    border: '1px solid var(--aao-brand-600)',
    borderRadius: 8,
    background: 'var(--aao-surface)',
    color: 'var(--aao-brand-700)',
    fontSize: 13,
    fontWeight: 800,
  },
  button: {
    height: 44,
    border: 0,
    borderRadius: 8,
    background: 'var(--aao-brand-600)',
    color: 'white',
    fontSize: 15,
    fontWeight: 800,
  },
};

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
  const erp = session.erpSessionReused ? 'ERP 已复用登录态' : 'ERP 已完成登录';
  const ads = session.adsSessionReady === false
    ? `Ads 未连接：${session.adsUnavailableReason || '独立 Profile 待授权，广告执行保持阻断'}`
    : session.adsTitle || session.adsUrl
      ? `Ads 已进入：${session.adsTitle || session.adsUrl}`
      : 'Ads 会话待确认';
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
  const erpReady = session.erpSessionReady === true || Boolean(session.erpSessionReused);
  const adsReady = session.adsSessionReady === true
    || (session.adsSessionReady === undefined && Boolean(session.adsTitle || session.adsUrl || session.adsEntryMode));
  if (erpReady && adsReady) return 'ERP/Ads 已连接';
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
    label: loading ? '正在确认 ERP 和 Ads 会话...' : '登录并进入 Ads',
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
      ? '正在确认 ERP 和 Ads 会话；已保存密码只在本机安全区解密。'
      : '正在确认 ERP 和 Ads 会话；本次输入只用于建立当前会话。';
  }
  if (input.credentialNotice) return input.credentialNotice;
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
  amazonAdsProfileId: string;
  credentialSource: 'saved' | 'typed';
  password: string;
  rememberPassword: boolean;
  savedCredentialUsername: string;
  savedPasswordAvailable: boolean;
  storeContext: StoreContextEnvelope | null;
  username: string;
}): BrowserLoginRequest | null {
  const username = input.username.trim();
  const amazonAdsProfileId = input.amazonAdsProfileId.trim();
  const useSavedCredential = input.credentialSource === 'saved'
    && input.savedPasswordAvailable
    && input.rememberPassword
    && username === input.savedCredentialUsername;
  if (!username || !amazonAdsProfileId || !input.storeContext) return null;
  if (useSavedCredential) {
    return {
      amazonAdsProfileId,
      username,
      credentialSource: 'saved',
      rememberPassword: true,
      storeContext: input.storeContext,
    };
  }
  if (!input.password) return null;
  return {
    amazonAdsProfileId,
    username,
    credentialSource: 'typed',
    password: input.password,
    rememberPassword: input.rememberPassword,
    storeContext: input.storeContext,
  };
}

function headerReadinessClass(readiness: DeliveryReadinessView | null): string {
  if (readiness?.appReady && readiness?.manifestDriven) return 'app-status app-status-ready';
  if (readiness?.available === false) return 'app-status app-status-pending';
  return 'app-status app-status-warning';
}

function LoginPage() {
  const store = useMissionControlStoreContext();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberPassword, setRememberPassword] = useState(false);
  const [credentialSource, setCredentialSource] = useState<'saved' | 'typed'>('typed');
  const [savedCredentialUsername, setSavedCredentialUsername] = useState('');
  const [savedPasswordAvailable, setSavedPasswordAvailable] = useState(false);
  const [savedCredentialState, setSavedCredentialState] = useState<SavedLoginCredentialState>('none');
  const [credentialNotice, setCredentialNotice] = useState('');
  const [credentialTone, setCredentialTone] = useState<LoginCredentialTone>('neutral');
  const [amazonAdsProfileId, setAmazonAdsProfileId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loginConnectionState, setLoginConnectionState] = useState<'missing' | 'binding' | 'ready' | 'error'>('missing');
  const [amazonAdsConnectionState, setAmazonAdsConnectionState] =
    useState<'missing' | 'binding' | 'ready' | 'error'>('missing');
  const setLoginState = useStore((state) => state.setLoginState);
  const lingxingConnection = store.activeView?.connections.find(
    (connection) => connection.provider === 'lingxing',
  );
  const amazonAdsConnection = store.activeView?.connections.find(
    (connection) => connection.provider === 'amazon_ads',
  );
  const lingxingConnectionReady = Boolean(username.trim())
    && lingxingConnection?.accountLabel?.trim() === username.trim();
  const amazonAdsConnectionReady = Boolean(amazonAdsProfileId.trim())
    && amazonAdsConnection?.externalAccountId?.trim() === amazonAdsProfileId.trim();
  const loginConnectionsReady = lingxingConnectionReady && amazonAdsConnectionReady;
  const loginButtonView = loginSubmitButtonView(loading);
  const loginStatus = loginStatusMessage({ credentialSource, loading, credentialNotice, rememberPassword });
  const loginStatusClass = [
    'login-status-line',
    loading ? 'login-status-line-pending' : '',
    !loading && credentialTone === 'ready' ? 'login-status-line-ready' : '',
    !loading && credentialTone === 'warning' ? 'login-status-line-warning' : '',
    !loading && credentialTone === 'blocked' ? 'login-status-line-blocked' : '',
  ].filter(Boolean).join(' ');
  const securityTagView = loginSecurityTagView({
    credentialSource,
    credentialState: savedCredentialState,
    loading,
    passwordAvailable: savedPasswordAvailable,
  });

  useEffect(() => {
    setLoginConnectionState(lingxingConnectionReady ? 'ready' : 'missing');
  }, [
    lingxingConnection?.accountLabel,
    lingxingConnection?.id,
    lingxingConnectionReady,
    store.authorityKey,
    username,
  ]);

  useEffect(() => {
    setAmazonAdsProfileId(amazonAdsConnection?.externalAccountId?.trim() ?? '');
  }, [
    amazonAdsConnection?.externalAccountId,
    amazonAdsConnection?.id,
    store.activeStore?.storeId,
  ]);

  useEffect(() => {
    setAmazonAdsConnectionState(amazonAdsConnectionReady ? 'ready' : 'missing');
  }, [
    amazonAdsConnection?.externalAccountId,
    amazonAdsConnection?.id,
    amazonAdsConnectionReady,
    amazonAdsProfileId,
    store.authorityKey,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadSavedCredentialStatus() {
      const api = appElectronApi(username);
      if (!api?.getSavedLoginCredentialStatus) return;
      try {
        const saved = await api.getSavedLoginCredentialStatus();
        if (cancelled || !saved) return;
        const savedUsername = typeof saved.username === 'string' ? saved.username : '';
        const passwordAvailable = Boolean(saved.passwordAvailable);
        const credentialState = saved.credentialState || 'none';
        const encryptionAvailable = credentialState !== 'encryption_unavailable';
        const remember = encryptionAvailable && Boolean(saved.rememberPassword);
        setUsername(savedUsername);
        setSavedCredentialUsername(savedUsername);
        setSavedPasswordAvailable(passwordAvailable);
        setSavedCredentialState(credentialState);
        setRememberPassword(remember);
        setPassword('');
        setCredentialSource(passwordAvailable && remember ? 'saved' : 'typed');
        setCredentialNotice(savedLoginCredentialNotice({
          credentialState,
          passwordAvailable,
          rememberPassword: remember,
        }));
        setCredentialTone(savedLoginCredentialTone({ credentialState, passwordAvailable }));
      } catch {
        if (!cancelled) {
          setCredentialNotice('无法读取本机凭证状态，请重新输入密码。');
          setCredentialTone('blocked');
        }
      }
    }

    loadSavedCredentialStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogin() {
    if (loading) return;
    if (!lingxingConnectionReady) {
      setError('请先把当前领星账号绑定到所选店铺。');
      return;
    }
    if (!amazonAdsConnectionReady) {
      setError('请先把 Amazon Ads Profile ID 绑定到所选店铺。');
      return;
    }
    const request = buildBrowserLoginRequest({
      amazonAdsProfileId,
      credentialSource,
      password,
      rememberPassword,
      savedCredentialUsername,
      savedPasswordAvailable,
      storeContext: store.authoritativeContext,
      username,
    });
    if (!request) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const api = appElectronApi(username);
      if (!api?.browserLogin && browserPreviewBootstrap.enabled) {
        const previewState = await api.getState();
        setCredentialNotice('已进入浏览器预览模式；这里不连接真实 ERP/Ads，也不会写入本地数据库。');
        setLoginState(true, previewState.currentStore, previewState.loginSession || null);
        return;
      }
      const session = await api.browserLogin(request) as BrowserLoginResult;
      setLoginState(true, session.currentStore, session);
    } catch (caught) {
      setError(toUserFacingError(caught, '登录失败'));
    } finally {
      setLoading(false);
    }
  }

  async function handleBindLingxingConnection() {
    if (loading || loginConnectionState === 'binding' || lingxingConnectionReady) return;
    if (!username.trim()) {
      setError('请输入领星用户名后再绑定。');
      return;
    }
    setLoginConnectionState('binding');
    setError('');
    try {
      await store.bindLingxingConnection(username.trim());
      setLoginConnectionState('ready');
    } catch (caught) {
      setLoginConnectionState('error');
      setError(toUserFacingError(caught, '领星连接绑定失败'));
    }
  }

  async function handleBindAmazonAdsConnection() {
    if (loading || amazonAdsConnectionState === 'binding' || amazonAdsConnectionReady) return;
    if (!amazonAdsProfileId.trim()) {
      setError('请输入 Amazon Ads Profile ID 后再绑定。');
      return;
    }
    setAmazonAdsConnectionState('binding');
    setError('');
    try {
      await store.bindAmazonAdsConnection(amazonAdsProfileId);
      setAmazonAdsConnectionState('ready');
    } catch (caught) {
      setAmazonAdsConnectionState('error');
      setError(toUserFacingError(caught, 'Amazon Ads Profile 绑定失败'));
    }
  }

  const loginConnectionStatus = loginConnectionState === 'ready'
    ? '领星连接已绑定'
    : loginConnectionState === 'binding'
      ? '正在绑定当前领星账号…'
      : loginConnectionState === 'error'
        ? '领星连接绑定失败，请检查后重试。'
        : lingxingConnection
          ? '当前用户名与店铺领星连接不一致，请更新绑定。'
          : '当前店铺尚未绑定领星连接。';

  const amazonAdsConnectionStatus = amazonAdsConnectionState === 'ready'
    ? 'Amazon Ads Profile 已绑定'
    : amazonAdsConnectionState === 'binding'
      ? '正在绑定 Amazon Ads Profile…'
      : amazonAdsConnectionState === 'error'
        ? 'Amazon Ads Profile 绑定失败，请检查后重试。'
        : amazonAdsConnection
          ? '当前 Profile ID 与店铺 Amazon Ads 连接不一致，请更新绑定。'
          : '当前店铺尚未绑定 Amazon Ads Profile。';

  return (
    <div style={loginStyles.container}>
      <section style={loginStyles.card}>
        <div>
          <h1 style={loginStyles.title}>Amazon AI Ops Agent</h1>
          <p style={loginStyles.subtitle}>v1.5.0</p>
        </div>
        <div style={loginStyles.form}>
          <input
            onChange={(event) => {
              const nextUsername = event.target.value;
              const canReuseSaved = savedPasswordAvailable
                && rememberPassword
                && !password
                && nextUsername.trim() === savedCredentialUsername;
              setUsername(nextUsername);
              setCredentialSource(canReuseSaved ? 'saved' : 'typed');
              if (savedPasswordAvailable && !canReuseSaved) {
                setCredentialNotice('账号已修改；请输入密码以建立新的登录会话。');
                setCredentialTone('warning');
              } else if (canReuseSaved) {
                setCredentialNotice(savedLoginCredentialNotice({
                  credentialState: 'encrypted_ready',
                  passwordAvailable: true,
                  rememberPassword: true,
                }));
                setCredentialTone('ready');
              }
            }}
            aria-label="领星用户名"
            onKeyDown={(event) => event.key === 'Enter' && !loading && loginConnectionsReady && handleLogin()}
            placeholder="领星用户名"
            style={loginStyles.input}
            type="text"
            value={username}
          />
          <input
            data-credential-source={credentialSource}
            onChange={(event) => {
              const nextPassword = event.target.value;
              const canReuseSaved = !nextPassword
                && savedPasswordAvailable
                && rememberPassword
                && username.trim() === savedCredentialUsername;
              setPassword(nextPassword);
              setCredentialSource(canReuseSaved ? 'saved' : 'typed');
              if (canReuseSaved) {
                setCredentialNotice(savedLoginCredentialNotice({
                  credentialState: 'encrypted_ready',
                  passwordAvailable: true,
                  rememberPassword: true,
                }));
                setCredentialTone('ready');
              } else if (savedCredentialState === 'encryption_unavailable') {
                setCredentialNotice('当前系统无法使用本机加密；本次仅登录、不保存密码。');
                setCredentialTone('warning');
              } else {
                setCredentialNotice('本次将使用当前页面输入的密码；已保存密码不会发送到当前页面。');
                setCredentialTone('neutral');
              }
            }}
            aria-label="领星密码"
            onKeyDown={(event) => event.key === 'Enter' && !loading && loginConnectionsReady && handleLogin()}
            placeholder="领星密码"
            style={loginStyles.input}
            type="password"
            value={password}
          />
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={loginStyles.notice}>Amazon Ads Profile ID</span>
            <input
              aria-label="Amazon Ads Profile ID"
              autoComplete="off"
              data-package-ui-evidence-field="amazon-ads-profile-id"
              maxLength={256}
              onChange={(event) => setAmazonAdsProfileId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || loading) return;
                if (loginConnectionsReady) {
                  void handleLogin();
                } else if (
                  amazonAdsConnectionState !== 'binding'
                  && amazonAdsProfileId.trim()
                ) {
                  void handleBindAmazonAdsConnection();
                }
              }}
              placeholder="填写 ads.lingxing.com 的 profile_id"
              style={loginStyles.input}
              type="text"
              value={amazonAdsProfileId}
            />
            <span style={loginStyles.notice}>
              美国站 · USD；填写 ads.lingxing.com 当前广告账户显示的 profile_id。此字段不是密码或密钥。
            </span>
          </label>
          <div style={loginStyles.rememberRow}>
            <label style={loginStyles.rememberLabel}>
              <input
                checked={rememberPassword}
                disabled={savedCredentialState === 'encryption_unavailable'}
                onChange={(event) => {
                  const remember = event.target.checked;
                  const canReuseSaved = remember
                    && savedPasswordAvailable
                    && !password
                    && username.trim() === savedCredentialUsername;
                  setRememberPassword(remember);
                  setCredentialSource(canReuseSaved ? 'saved' : 'typed');
                  if (!remember && savedPasswordAvailable) {
                    setCredentialNotice('取消后请重新输入密码；登录成功会清除本机保存的密码，账号仍保留。');
                    setCredentialTone('warning');
                  } else if (canReuseSaved) {
                    setCredentialNotice(savedLoginCredentialNotice({
                      credentialState: 'encrypted_ready',
                      passwordAvailable: true,
                      rememberPassword: true,
                    }));
                    setCredentialTone('ready');
                  } else {
                    setCredentialTone('neutral');
                  }
                }}
                type="checkbox"
              />
              <span>记住密码</span>
            </label>
            <span className={securityTagView.className}>{securityTagView.label}</span>
          </div>
          <div className={loginStatusClass} role="status" aria-live="polite">
            {loginStatus}
          </div>
          <div style={loginStyles.connectionPanel}>
            <p
              data-login-connection-status
              data-state={loginConnectionState}
              role="status"
              aria-live="polite"
              style={loginStyles.connectionStatus}
            >
              {loginConnectionStatus}
            </p>
            {!lingxingConnectionReady ? (
              <button
                data-package-ui-evidence-action="bind-lingxing-connection"
                type="button"
                disabled={loading || loginConnectionState === 'binding' || !username.trim()}
                onClick={handleBindLingxingConnection}
                style={loginStyles.connectionButton}
              >
                {loginConnectionState === 'binding'
                  ? '绑定中…'
                  : lingxingConnection
                    ? '更新当前领星账号绑定'
                    : '绑定当前领星账号'}
              </button>
            ) : null}
          </div>
          <div style={loginStyles.connectionPanel}>
            <p
              data-login-amazon-ads-connection-status
              data-state={amazonAdsConnectionState}
              role="status"
              aria-live="polite"
              style={loginStyles.connectionStatus}
            >
              {amazonAdsConnectionStatus}
            </p>
            {!amazonAdsConnectionReady ? (
              <button
                data-package-ui-evidence-action="bind-amazon-ads-connection"
                type="button"
                disabled={loading || amazonAdsConnectionState === 'binding' || !amazonAdsProfileId.trim()}
                onClick={handleBindAmazonAdsConnection}
                style={loginStyles.connectionButton}
              >
                {amazonAdsConnectionState === 'binding'
                  ? '绑定中…'
                  : amazonAdsConnection
                    ? '更新 Amazon Ads Profile 绑定'
                    : '绑定 Amazon Ads Profile'}
              </button>
            ) : null}
          </div>
          <div style={loginStyles.hint}>登录流程：ERP 登录 {'->'} ERP 广告入口 {'->'} Ads 会话确认。</div>
          {error && <div role="alert" style={loginStyles.error}>{error}</div>}
          <button
            aria-busy={loginButtonView.ariaBusy}
            className={loginButtonView.className}
            disabled={loading || !loginConnectionsReady}
            onClick={handleLogin}
            style={loginStyles.button}
            type="button"
          >
            <span className="button-content">
              {loginButtonView.loading && <span className="button-spinner" aria-hidden="true" />}
              <span>{loginButtonView.label}</span>
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}

function MissionControlRuntime({
  loginSession,
  onLoggedOut,
}: {
  loginSession?: LoginSessionInfo | null;
  onLoggedOut: () => void;
}) {
  const { activeNavigation, setActiveNavigation } = useStore();
  const store = useMissionControlStoreContext();
  const missionControl = useMissionControlBridge();
  const scope = useScopeStore((state) => state.scope);
  const setScope = useScopeStore((state) => state.setScope);
  const [deliveryReadiness, setDeliveryReadiness] = useState<DeliveryReadinessView | null>(null);
  const [workflowEvidence, setWorkflowEvidence] = useState<WorkflowEvidence>(() => deriveWorkflowEvidence({}));
  const [pendingNavigationIntent, setPendingNavigationIntent] = useState<NavigationIntent | null>(null);
  const nextSafeAction = selectNextSafeAction(workflowEvidence);
  const readbackAuthority = readbackAuthorityForMode(
    browserPreviewBootstrap.enabled ? 'preview-readonly' : 'production',
  );
  const contentRef = useRef<HTMLElement | null>(null);
  const navigationTimerRef = useRef<number | null>(null);
  const operationScopeLoadSequenceRef = useRef(0);

  const requestNavigate = useCallback((target: AppRoute | NavigationIntent) => {
    const intent = normalizeNavigationTarget(target);
    if (!intent) return;
    if (navigationIntentsEqual(intent, activeNavigation) && !pendingNavigationIntent) return;
    if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current);
    setActiveNavigation(intent);
    if (!navigationNeedsGlobalHandoff(activeNavigation, intent)) {
      setPendingNavigationIntent(null);
      navigationTimerRef.current = null;
      return;
    }
    setPendingNavigationIntent(intent);
    navigationTimerRef.current = window.setTimeout(() => {
      setPendingNavigationIntent((current) => (navigationIntentsEqual(current, intent) ? null : current));
      navigationTimerRef.current = null;
    }, 150);
  }, [activeNavigation, pendingNavigationIntent, setActiveNavigation]);

  useEffect(() => {
    const handleNavigate = createAppNavigationEventHandler(requestNavigate);
    window.addEventListener('amazon-ai-ops:navigate', handleNavigate);
    return () => window.removeEventListener('amazon-ai-ops:navigate', handleNavigate);
  }, [requestNavigate]);

  useEffect(() => () => {
    if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    const content = contentRef.current;
    resetWorkspaceScrollPosition(content);
    const repaintFrame = window.requestAnimationFrame(() => resetWorkspaceScrollPosition(content));
    return () => window.cancelAnimationFrame(repaintFrame);
  }, [activeNavigation.subview, activeNavigation.workspace]);

  useEffect(() => {
    if (!store.authoritativeContext || !store.activeStore) return;
    const context = store.authoritativeContext;
    const storeName = store.activeStore.displayName;
    const authorityKey = missionControlContextKey(context);
    const requestSequence = ++operationScopeLoadSequenceRef.current;
    setDeliveryReadiness(null);
    setWorkflowEvidence(deriveWorkflowEvidence({}));
    setScope(defaultOperationScopeForAuthority(context, storeName));
    const api = (window as any).electronAPI;
    void api?.getOperationScope?.(context)
      .then((savedScope: unknown) => {
        if (
          requestSequence !== operationScopeLoadSequenceRef.current
          || store.authorityKey !== authorityKey
        ) return;
        if (operationScopeBelongsToAuthority(savedScope, context, storeName)) {
          setScope(savedScope);
        }
      })
      .catch(() => undefined);
    return () => {
      operationScopeLoadSequenceRef.current += 1;
    };
  }, [setScope, store.authorityKey]);

  useEffect(() => {
    if (!store.authoritativeContext || !store.authorityKey) return;
    const dashboardCapability = missionControl.capabilities.find((capability) => (
      capability.view === 'today/overview'
        && capability.action === 'view'
        && capability.state === 'LEGACY_ADAPTER'
    ));
    if (!dashboardCapability) {
      setDeliveryReadiness(null);
      setWorkflowEvidence(deriveWorkflowEvidence({ scope }));
      return;
    }
    let cancelled = false;
    const workflowLoadGuard = createLatestWorkflowLoadGuard();
    async function loadWorkflowState() {
      const loadSequence = workflowLoadGuard.begin();
      try {
        const api = (window as any).electronAPI;
        const pipeline = await api?.getBusinessUiDataPipeline?.(scope);
        const batchId = scope.batchId || pipeline?.collection?.latestBatch?.id;
        const filter = {
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
          batchId,
          limit: 100,
        };
        const [pending, needsReview, approved, readback, readiness] = await Promise.all([
          api?.getRecommendations?.({ ...filter, status: 'pending' }) || [],
          api?.getRecommendations?.({ ...filter, status: 'needs_review' }) || [],
          api?.getRecommendations?.({ ...filter, status: 'approved' }) || [],
          api?.getDeliveryEvidenceStatus?.(filter) || null,
          api?.getDeliveryReadiness?.() || null,
        ]);
        if (!cancelled && workflowLoadGuard.isCurrent(loadSequence)) {
          setDeliveryReadiness(readiness || null);
          setWorkflowEvidence(deriveWorkflowEvidence({
            scope,
            pipeline,
            recommendations: {
              pending: Array.isArray(pending) ? pending.length : 0,
              needsReview: Array.isArray(needsReview) ? needsReview.length : 0,
              approved: Array.isArray(approved) ? approved.length : 0,
            },
            readback: readback?.readback,
            readiness,
          }));
        }
      } catch {
        if (!cancelled && workflowLoadGuard.isCurrent(loadSequence)) {
          setDeliveryReadiness(null);
          setWorkflowEvidence(deriveWorkflowEvidence({ scope }));
        }
      }
    }

    loadWorkflowState();
    window.addEventListener('business-ui:data-updated', loadWorkflowState);
    const unsubscribeWorkflowInvalidation = subscribeAppWorkflowInvalidation(() => {
      void loadWorkflowState();
    });
    return () => {
      cancelled = true;
      workflowLoadGuard.invalidate();
      window.removeEventListener('business-ui:data-updated', loadWorkflowState);
      unsubscribeWorkflowInvalidation();
    };
  }, [missionControl.capabilities, scope, store.authorityKey, store.authoritativeContext]);

  async function handleLogout() {
    await (window as any).electronAPI.browserLogout();
    onLoggedOut();
  }

  if (!store.authoritativeContext || !store.activeStore) return null;

  const previewScenarioId = 'scenarioId' in browserPreviewBootstrap
    ? browserPreviewBootstrap.scenarioId
    : undefined;
  const brandBadges = (
    <>
      {browserPreviewBootstrap.enabled && (
        <span
          className="app-status app-status-warning"
          role={browserPreviewBootstrap.warning ? 'alert' : 'status'}
          title={browserPreviewBootstrap.warning || '开发预览只使用内存 fixture，不写入真实业务数据或验收证据。'}
        >
          仅开发预览 · {previewScenarioId}
          {browserPreviewBootstrap.warning ? ` · ${browserPreviewBootstrap.warning}` : ''}
        </span>
      )}
      <span className={headerReadinessClass(deliveryReadiness)}>{headerReadinessLabel(deliveryReadiness)}</span>
      {missionControl.error && <span className="app-status app-status-warning">Capability 同步失败</span>}
    </>
  );
  const sessionStatus = (
    <span
      aria-label={describeLoginSession(loginSession)}
      aria-live="polite"
      className={`session-line${loginSession?.sessionIdentityVerified === false || loginSession?.adsSessionReady === false ? ' session-line-warning' : ''}`}
      role="status"
      tabIndex={loginSession?.sessionIdentityVerified === false || loginSession?.adsSessionReady === false ? 0 : undefined}
      title={describeLoginSession(loginSession)}
    >
      {headerSessionStatusLabel(loginSession)}
    </span>
  );

  return (
    <MissionControlShell
      activeIntent={activeNavigation}
      activeStore={store.activeStore}
      authoritativeContext={store.authoritativeContext}
      autonomy={missionControl.autonomy ?? DEFAULT_BLOCKED_AUTONOMY}
      brandBadges={brandBadges}
      capabilities={missionControl.capabilities}
      contentRef={contentRef}
      onLogout={handleLogout}
      onNavigate={requestNavigate}
      onSetAutonomyMode={missionControl.setAutonomyMode}
      onSwitchStore={store.switchStore}
      pendingIntent={pendingNavigationIntent}
      sessionStatus={sessionStatus}
      storeError={store.error}
      storePhase={store.phase}
      stores={store.stores}
    >
      <div key={store.authorityKey} data-authority-key={store.authorityKey}>
        <MissionControlWorkspaceView
          autonomy={missionControl.autonomy}
          today={missionControl.today}
          bridgeError={missionControl.error}
          bridgePhase={missionControl.phase}
          capabilities={missionControl.phase === 'loading' ? undefined : missionControl.capabilities}
          intent={activeNavigation}
          legacySlot={({ route, intent, capabilities }) => (
            <LegacyAdapterRouter
              capabilities={capabilities}
              intent={intent}
              nextSafeAction={nextSafeAction}
              previewMode={browserPreviewBootstrap.enabled}
              previewScenarioId={previewScenarioId}
              readbackAuthority={readbackAuthority}
              route={route}
              storeContext={store.authoritativeContext!}
            />
          )}
          onNavigate={requestNavigate}
          onRefreshAuthority={missionControl.refreshBootstrap}
          previewMode={browserPreviewBootstrap.enabled}
          storeCrudSlot={(
            <StoreManagementPanel
              activeStoreId={store.activeStore.storeId}
              error={store.error}
              onArchive={store.archiveStore}
              onCreate={store.createStore}
              onRestore={store.restoreStore}
              onSwitch={store.switchStore}
              onUpdate={store.updateStore}
              stores={store.stores}
            />
          )}
          settingsCrudSlot={(
            <StoreRuntimeConfigPanel storeContext={store.authoritativeContext} />
          )}
          storeContext={store.authoritativeContext}
        />
      </div>
    </MissionControlShell>
  );
}

export function defaultOperationScopeForAuthority(
  context: StoreContextEnvelope,
  storeName: string,
): OperationScope {
  const end = new Date(`${context.businessDate}T12:00:00.000Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 13);
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: context.businessDate,
    storeName,
    marketplaceCode: 'US',
    currency: 'USD',
    asin: undefined,
    batchId: undefined,
  };
}

export function operationScopeBelongsToAuthority(
  value: unknown,
  context: StoreContextEnvelope,
  storeName: string,
): value is OperationScope {
  if (!value || typeof value !== 'object') return false;
  const scope = value as Partial<OperationScope>;
  return typeof scope.dateFrom === 'string'
    && typeof scope.dateTo === 'string'
    && scope.storeName === storeName
    && scope.marketplaceCode === context.marketplace
    && scope.currency === context.currency;
}

export function shouldStartLoginRestoreForAuthority(
  restoredAuthorityKey: string | null,
  current: StoreAuthoritySnapshot,
): current is StoreAuthoritySnapshot & { authorityKey: string } {
  return current.phase === 'ready'
    && Boolean(current.authorityKey)
    && restoredAuthorityKey !== current.authorityKey;
}

function MissionControlSessionAuthorityBoundary({ children }: { children: React.ReactNode }) {
  const store = useMissionControlStoreContext();
  const { isLoggedIn, setLoginState } = useStore();
  const loginRestoreAuthorityRef = useRef<string | null>(null);
  const previousAuthorityRef = useRef<StoreAuthoritySnapshot>({
    authorityKey: store.authorityKey,
    contextEpoch: store.contextEpoch,
    phase: store.phase,
  });

  useLayoutEffect(() => {
    const currentAuthority: StoreAuthoritySnapshot = {
      authorityKey: store.authorityKey,
      contextEpoch: store.contextEpoch,
      phase: store.phase,
    };
    const previousAuthority = previousAuthorityRef.current;
    previousAuthorityRef.current = currentAuthority;
    if (shouldInvalidateLoginForStoreAuthority(isLoggedIn, previousAuthority, currentAuthority)) {
      setLoginState(false);
    }
  }, [isLoggedIn, setLoginState, store.authorityKey, store.contextEpoch, store.phase]);

  useEffect(() => {
    const currentAuthority: StoreAuthoritySnapshot = {
      authorityKey: store.authorityKey,
      contextEpoch: store.contextEpoch,
      phase: store.phase,
    };
    if (!shouldStartLoginRestoreForAuthority(loginRestoreAuthorityRef.current, currentAuthority)) return;
    loginRestoreAuthorityRef.current = currentAuthority.authorityKey;
    const requestedAuthorityKey = currentAuthority.authorityKey;
    const requestedLoginRevision = useStore.getState().loginStateRevision;

    async function restoreLoginState() {
      try {
        const state = await appElectronApi().getState();
        if (useStore.getState().loginStateRevision !== requestedLoginRevision) return;
        const currentAuthorityKey = previousAuthorityRef.current.authorityKey;
        if (shouldRestoreLoginForStoreAuthority({
          responseIsLoggedIn: Boolean(state?.isLoggedIn),
          responseAuthorityKey: appStateAuthorityKey(state),
          requestedAuthorityKey,
          currentAuthorityKey,
        })) {
          setLoginState(true, state.currentStore, state.loginSession || null);
        } else {
          setLoginState(false);
        }
      } catch (caught) {
        console.error(caught);
        if (useStore.getState().loginStateRevision === requestedLoginRevision) {
          setLoginState(false);
        }
      }
    }

    void restoreLoginState();
  }, [setLoginState, store.authorityKey, store.contextEpoch, store.phase]);

  return <>{children}</>;
}

export default function App() {
  const { isLoggedIn, loginSession, setLoginState } = useStore();

  return (
    <MissionControlStoreContextProvider>
      <MissionControlSessionAuthorityBoundary>
        <MissionControlStoreGate>
          {isLoggedIn ? (
            <MissionControlRuntime
              loginSession={loginSession}
              onLoggedOut={() => setLoginState(false)}
            />
          ) : <LoginPage />}
        </MissionControlStoreGate>
      </MissionControlSessionAuthorityBoundary>
    </MissionControlStoreContextProvider>
  );
}
