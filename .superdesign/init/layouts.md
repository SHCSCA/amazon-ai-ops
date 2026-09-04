# Shared Layouts — Amazon AI Ops desktop renderer

Source scope: `apps/desktop/src/renderer`. This is the production Electron renderer, not the standalone interactive-prototype directories.

## Runtime layout model

- Framework: React renderer mounted by `main.tsx`; state uses Zustand.
- Root branch: `App` renders `LoginPage` until the browser/ERP session is ready, then switches to the authenticated application shell.
- Authenticated shell hierarchy: `.app-shell > .topbar + .app-body > .app-sidebar + .app-content`.
- Topbar: brand/readiness cluster, the persistent `ScopeBar`, current-store/session status, and logout.
- Sidebar: two semantic navigation groups generated from `VISIBLE_WORKSPACES`; the sidebar selects a primary workspace, not an individual legacy page.
- Main canvas: `.app-content` is the workspace scroll owner. `App` resets both scroll axes whenever workspace or subview changes and overlays a 150 ms cross-workspace handoff status.
- Workspace branch: product, data-preparation, growth, and system use `WorkspaceSubviewShell`; today and diagnosis render their page directly; decisions and readback own their internal page frame/subview treatment.
- Detail branch: `ResponsiveInspector` is inline on viewports at least 1400 px wide and a modal drawer at 1399 px or narrower.
- There is no footer and no browser URL router in the renderer.

## Layout source inventory

| Source | Responsibility |
|---|---|
| `apps/desktop/src/renderer/App.tsx` | Root renderer layout and composition boundary. It contains the mutually exclusive login and authenticated branches; the authenticated branch renders the global topbar, persistent ScopeBar, Sidebar, the sole scrolling main canvas, navigation handoff feedback, and the workspace-to-page switch. |
| `apps/desktop/src/renderer/components/app-shell.tsx` | Persistent sidebar navigation and the reusable next-safe-action handoff. Sidebar sections and item state are driven by VISIBLE_WORKSPACES from navigation.ts. |
| `apps/desktop/src/renderer/components/scope-bar.tsx` | Global operation-scope surface embedded in the topbar. It renders compact scope facts, progressive details, and the anchored scope editor for date/store/marketplace/product/batch. |
| `apps/desktop/src/renderer/components/workspace/page-frame.tsx` | Shared page-level frame for title, description, task rail, summary strip, and page content. |
| `apps/desktop/src/renderer/components/workspace/workspace-subview-shell.tsx` | Shared workspace wrapper for product, data-preparation, growth, and system branches. It supplies workspace identity, keyboard-operable tabs, preview notice, and the active tabpanel. |
| `apps/desktop/src/renderer/components/workspace/responsive-inspector.tsx` | Responsive secondary-detail layout. At 1400px and above it is an inline complementary region; at 1399px and below it becomes a focus-trapped modal drawer with inert background. |

## `apps/desktop/src/renderer/App.tsx`

Root renderer layout and composition boundary. It contains the mutually exclusive login and authenticated branches; the authenticated branch renders the global topbar, persistent ScopeBar, Sidebar, the sole scrolling main canvas, navigation handoff feedback, and the workspace-to-page switch.

```tsx
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Sidebar } from './components/app-shell';
import { ScopeBar } from './components/scope-bar';
import { WorkspaceSubviewShell } from './components/workspace';
import { AdQuantPage } from './pages/ad-quant-page';
import { DashboardPage } from './pages/dashboard-page';
import { DataCollectionPage } from './pages/data-collection-page';
import { DataImportValidationPage } from './pages/data-import-validation-page';
import { DecisionsPage } from './pages/decisions-page';
import { DeliveryPage } from './pages/delivery-page';
import { KeywordOpportunitiesPage } from './pages/keyword-opportunities-page';
import { ListingOptimizationPage } from './pages/listing-optimization-page';
import { OperationEventsPage } from './pages/operation-events-page';
import { OperationScopePage } from './pages/operation-scope-page';
import { ProductConfigPage } from './pages/product-config-page';
import { ProductManagementPage } from './pages/product-management-page';
import { ReadbackPage } from './pages/readback-page';
import { SchedulerPage } from './pages/scheduler-page';
import { SettingsPage } from './pages/settings-page';
import type { AppRoute, DeliveryReadinessView } from './types';
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
  resolveNavigationTarget,
  WORKSPACE_SUBVIEW_TABS,
} from './navigation';
import type { NavigationIntent } from './navigation';
import { useScopeStore } from './scope-store';
import { deriveWorkflowEvidence, selectNextSafeAction } from './workflow-state';
import type { NextSafeAction, WorkflowEvidence } from './workflow-state';
import { subscribeWorkflowInvalidation } from './workflow-invalidation';
import type { WorkflowEventTarget, WorkflowInvalidationDetail } from './workflow-invalidation';
import { toUserFacingError } from './user-facing-error';
import { bootstrapBrowserPreview } from './dev-preview-api';
import { readbackAuthorityForMode, type ReadbackAuthority } from './pages/readback-workspace-model';
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

interface LoginSessionInfo {
  erpSessionReused?: boolean;
  sessionIdentityVerified?: boolean;
  adsEntryMode?: string;
  adsUrl?: string;
  adsTitle?: string;
  credentialPersistence?: BrowserLoginCredentialPersistence;
}

interface AppState {
  isLoggedIn: boolean;
  currentStore: string;
  loginSession?: LoginSessionInfo | null;
  activeNavigation: NavigationIntent;
  setActiveNavigation: (intent: NavigationIntent) => void;
  setLoginState: (isLoggedIn: boolean, store?: string, loginSession?: LoginSessionInfo | null) => void;
}

const useStore = create<AppState>((set) => ({
  isLoggedIn: false,
  currentStore: '',
  loginSession: null,
  activeNavigation: DEFAULT_WORKSPACE_INTENTS.today,
  setActiveNavigation: (intent) => set({ activeNavigation: intent }),
  setLoginState: (isLoggedIn, store = '', loginSession = null) => set({ isLoggedIn, currentStore: store, loginSession }),
}));

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
  const ads = session.adsTitle || session.adsUrl ? `Ads 已进入：${session.adsTitle || session.adsUrl}` : 'Ads 会话待确认';
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
  const erpReady = Boolean(session.erpSessionReused);
  const adsReady = Boolean(session.adsTitle || session.adsUrl || session.adsEntryMode);
  if (erpReady && adsReady) return 'ERP/Ads 已连接';
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
  credentialSource: 'saved' | 'typed';
  password: string;
  rememberPassword: boolean;
  savedCredentialUsername: string;
  savedPasswordAvailable: boolean;
  username: string;
}): BrowserLoginRequest | null {
  const username = input.username.trim();
  const useSavedCredential = input.credentialSource === 'saved'
    && input.savedPasswordAvailable
    && input.rememberPassword
    && username === input.savedCredentialUsername;
  if (!username) return null;
  if (useSavedCredential) {
    return {
      username,
      credentialSource: 'saved',
      rememberPassword: true,
    };
  }
  if (!input.password) return null;
  return {
    username,
    credentialSource: 'typed',
    password: input.password,
    rememberPassword: input.rememberPassword,
  };
}

function headerReadinessClass(readiness: DeliveryReadinessView | null): string {
  if (readiness?.appReady && readiness?.manifestDriven) return 'app-status app-status-ready';
  if (readiness?.available === false) return 'app-status app-status-pending';
  return 'app-status app-status-warning';
}

function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberPassword, setRememberPassword] = useState(false);
  const [credentialSource, setCredentialSource] = useState<'saved' | 'typed'>('typed');
  const [savedCredentialUsername, setSavedCredentialUsername] = useState('');
  const [savedPasswordAvailable, setSavedPasswordAvailable] = useState(false);
  const [savedCredentialState, setSavedCredentialState] = useState<SavedLoginCredentialState>('none');
  const [credentialNotice, setCredentialNotice] = useState('');
  const [credentialTone, setCredentialTone] = useState<LoginCredentialTone>('neutral');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const setLoginState = useStore((state) => state.setLoginState);
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
    const request = buildBrowserLoginRequest({
      credentialSource,
      password,
      rememberPassword,
      savedCredentialUsername,
      savedPasswordAvailable,
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
            onKeyDown={(event) => event.key === 'Enter' && !loading && handleLogin()}
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
            onKeyDown={(event) => event.key === 'Enter' && !loading && handleLogin()}
            placeholder="领星密码"
            style={loginStyles.input}
            type="password"
            value={password}
          />
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
          <div style={loginStyles.hint}>登录流程：ERP 登录 {'->'} ERP 广告入口 {'->'} Ads 会话确认。</div>
          {error && <div role="alert" style={loginStyles.error}>{error}</div>}
          <button
            aria-busy={loginButtonView.ariaBusy}
            className={loginButtonView.className}
            disabled={loading}
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

function BusinessRoutePage({
  navigation,
  nextSafeAction,
  onNavigate,
  previewMode,
  readbackAuthority,
  previewScenarioId,
}: {
  navigation: NavigationIntent;
  nextSafeAction: NextSafeAction;
  onNavigate: (intent: NavigationIntent) => void;
  previewMode: boolean;
  readbackAuthority: ReadbackAuthority;
  previewScenarioId?: string;
}) {
  const route = resolveNavigationTarget(navigation) || 'dashboard';
  if (navigation.workspace === 'decisions') return <DecisionsPage activeSubview={navigation.subview} />;
  if (navigation.workspace === 'readback') {
    return <ReadbackPage authority={readbackAuthority} previewScenarioId={previewScenarioId} />;
  }
  if (navigation.workspace === 'today') return <DashboardPage nextSafeAction={nextSafeAction} />;
  if (navigation.workspace === 'product') {
    const content = navigation.subview === 'products'
      ? <ProductManagementPage />
      : navigation.subview === 'targets'
        ? <ProductConfigPage />
        : <OperationEventsPage />;
    return (
      <WorkspaceSubviewShell
        description="锁定当前产品，维护经营目标，并记录会影响判断的运营事件。"
        onNavigate={(subview) => onNavigate({ workspace: 'product', subview })}
        ownsPageHeading={navigation.subview === 'products'}
        subview={navigation.subview}
        tabs={WORKSPACE_SUBVIEW_TABS.product}
        workspace="product"
        workspaceLabel="产品工作台"
      >
        {content}
      </WorkspaceSubviewShell>
    );
  }
  if (navigation.workspace === 'data-preparation') {
    const content = navigation.subview === 'scope'
      ? <OperationScopePage />
      : navigation.subview === 'reports'
        ? <DataCollectionPage />
        : <DataImportValidationPage />;
    return (
      <WorkspaceSubviewShell
        description="确认工作范围，补齐八类真实报表，并核对逐类入库结果。"
        onNavigate={(subview) => onNavigate({ workspace: 'data-preparation', subview })}
        subview={navigation.subview}
        tabs={WORKSPACE_SUBVIEW_TABS['data-preparation']}
        workspace="data-preparation"
        workspaceLabel="数据准备"
      >
        {content}
      </WorkspaceSubviewShell>
    );
  }
  if (navigation.workspace === 'diagnosis') return <AdQuantPage />;
  if (navigation.workspace === 'growth') {
    const content = navigation.subview === 'keywords'
      ? <KeywordOpportunitiesPage />
      : <ListingOptimizationPage />;
    return (
      <WorkspaceSubviewShell
        description="从真实关键词机会进入仅本地使用的 Listing 草案流程。"
        onNavigate={(subview) => onNavigate({ workspace: 'growth', subview })}
        subview={navigation.subview}
        tabs={WORKSPACE_SUBVIEW_TABS.growth}
        workspace="growth"
        workspaceLabel="关键词与 Listing"
      >
        {content}
      </WorkspaceSubviewShell>
    );
  }
  if (navigation.workspace === 'system') {
    const content = navigation.subview === 'settings'
      ? <SettingsPage />
      : navigation.subview === 'scheduler'
        ? <SchedulerPage />
        : <DeliveryPage />;
    return (
      <WorkspaceSubviewShell
        description="管理 AI 与规则、自动任务，并核对当前候选包的交付状态。"
        onNavigate={(subview) => onNavigate({ workspace: 'system', subview })}
        previewNotice={previewMode ? '仅开发预览，不代表 APP_READY。预览动作不形成正式交付证据。' : undefined}
        subview={navigation.subview}
        tabs={WORKSPACE_SUBVIEW_TABS.system}
        workspace="system"
        workspaceLabel="系统与交付"
      >
        {content}
      </WorkspaceSubviewShell>
    );
  }
  if (route === 'dashboard') return <DashboardPage nextSafeAction={nextSafeAction} />;
  return <DashboardPage nextSafeAction={nextSafeAction} />;
}

export default function App() {
  const { isLoggedIn, currentStore, loginSession, activeNavigation, setActiveNavigation, setLoginState } = useStore();
  const scope = useScopeStore((state) => state.scope);
  const activeTab = resolveNavigationTarget(activeNavigation) || 'dashboard';
  const [deliveryReadiness, setDeliveryReadiness] = useState<DeliveryReadinessView | null>(null);
  const [workflowEvidence, setWorkflowEvidence] = useState<WorkflowEvidence>(() => deriveWorkflowEvidence({}));
  const [pendingNavigationIntent, setPendingNavigationIntent] = useState<NavigationIntent | null>(null);
  const pendingNavigationRoute = resolveNavigationTarget(pendingNavigationIntent);
  const nextSafeAction = selectNextSafeAction(workflowEvidence);
  const readbackAuthority = readbackAuthorityForMode(
    browserPreviewBootstrap.enabled ? 'preview-readonly' : 'production',
  );
  const contentRef = useRef<HTMLElement | null>(null);
  const navigationTimerRef = useRef<number | null>(null);

  useEffect(() => {
    async function checkLoginState() {
      try {
        const api = appElectronApi();
        const state = await api.getState();
        setLoginState(Boolean(state.isLoggedIn), state.currentStore, state.loginSession || null);
      } catch (caught) {
        console.error(caught);
        setLoginState(false);
      }
    }

    checkLoginState();
  }, [setLoginState]);

  const requestNavigate = useCallback((target: AppRoute | NavigationIntent) => {
    const intent = normalizeNavigationTarget(target);
    if (!intent) return;
    const route = resolveNavigationTarget(target);
    if (!route) return;
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
    if (!isLoggedIn) return;
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
  }, [isLoggedIn, scope]);

  async function handleLogout() {
    await (window as any).electronAPI.browserLogout();
    setLoginState(false);
  }

  if (!isLoggedIn) {
    return <LoginPage />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>Amazon AI Ops</strong>
          <span>v1.5.0</span>
          {browserPreviewBootstrap.enabled && (
            <span
              className="app-status app-status-warning"
              role={browserPreviewBootstrap.warning ? 'alert' : 'status'}
              title={browserPreviewBootstrap.warning || '开发预览只使用内存 fixture，不写入真实业务数据或验收证据。'}
            >
              仅开发预览 · {browserPreviewBootstrap.scenarioId}
              {browserPreviewBootstrap.warning ? ` · ${browserPreviewBootstrap.warning}` : ''}
            </span>
          )}
          <span className={headerReadinessClass(deliveryReadiness)}>{headerReadinessLabel(deliveryReadiness)}</span>
        </div>
        <ScopeBar />
        <div className="topbar-right">
          <strong>{currentStore || (loginSession?.sessionIdentityVerified === false ? '账号未核验' : '')}</strong>
          <span
            aria-label={describeLoginSession(loginSession)}
            aria-live="polite"
            className={`session-line${loginSession?.sessionIdentityVerified === false ? ' session-line-warning' : ''}`}
            role="status"
            tabIndex={loginSession?.sessionIdentityVerified === false ? 0 : undefined}
            title={describeLoginSession(loginSession)}
          >
            {headerSessionStatusLabel(loginSession)}
          </span>
          <button className="logout-button" onClick={handleLogout} type="button">退出登录</button>
        </div>
      </header>
      <div className="app-body">
        <Sidebar activeRoute={activeTab} pendingRoute={pendingNavigationRoute} onNavigate={requestNavigate} />
        <main ref={contentRef} className={`app-content${pendingNavigationRoute ? ' app-content-navigating' : ''}`}>
          {pendingNavigationRoute && (
            <div className="route-handoff-feedback" role="status" aria-live="polite">
              转跳中...
            </div>
          )}
          <BusinessRoutePage
            navigation={activeNavigation}
            nextSafeAction={nextSafeAction}
            onNavigate={requestNavigate}
            previewMode={browserPreviewBootstrap.enabled}
            previewScenarioId={'scenarioId' in browserPreviewBootstrap ? browserPreviewBootstrap.scenarioId : undefined}
            readbackAuthority={readbackAuthority}
          />
        </main>
      </div>
    </div>
  );
}
```

## `apps/desktop/src/renderer/components/app-shell.tsx`

Persistent sidebar navigation and the reusable next-safe-action handoff. Sidebar sections and item state are driven by VISIBLE_WORKSPACES from navigation.ts.

```tsx
import React from 'react';
import type { AppRoute } from '../types';
import {
  VISIBLE_WORKSPACES,
  workspaceForRoute,
} from '../navigation';
import type { NavigationIntent, VisibleWorkspaceDefinition } from '../navigation';
import type { NextSafeAction } from '../workflow-state';

const navigationSections: Array<{
  id: 'daily' | 'system';
  label: string;
  items: readonly VisibleWorkspaceDefinition[];
}> = [
  { id: 'daily', label: '运营工作台', items: VISIBLE_WORKSPACES.filter((item) => item.section === 'daily') },
  { id: 'system', label: '系统', items: VISIBLE_WORKSPACES.filter((item) => item.section === 'system') },
];

export function navItemOrdinal(index: number): string {
  return String(index + 1).padStart(2, '0');
}

export function navGroupLabelId(index: number): string {
  return `app-nav-group-${index + 1}-label`;
}

export function Sidebar({
  activeRoute,
  pendingRoute = null,
  onNavigate,
}: {
  activeRoute: AppRoute;
  pendingRoute?: AppRoute | null;
  onNavigate: (intent: NavigationIntent) => void;
}) {
  const navigationBusy = Boolean(pendingRoute);
  const activeWorkspace = workspaceForRoute(activeRoute);
  const pendingWorkspace = workspaceForRoute(pendingRoute);

  return (
    <nav className="app-sidebar" aria-busy={navigationBusy || undefined} aria-label="主业务导航" data-navigation-busy={navigationBusy || undefined}>
      {navigationSections.map((section, groupIndex) => {
        const groupLabelId = navGroupLabelId(groupIndex);

        return (
          <section
            className={`nav-group${section.id === 'system' ? ' nav-group-system' : ''}`}
            data-navigation-section={section.id}
            key={section.id}
            role="group"
            aria-labelledby={groupLabelId}
          >
            <div className="nav-group-label" id={groupLabelId}>{section.label}</div>
            <div className="nav-item-list" role="list" aria-label={`${section.label}导航项`}>
              {section.items.map((item, index) => {
                const isPending = pendingWorkspace === item.id;
                return (
                  <div className="nav-item-shell" key={item.id} role="listitem" aria-posinset={index + 1} aria-setsize={section.items.length}>
                    <button
                      aria-busy={isPending || undefined}
                      aria-current={activeWorkspace === item.id ? 'page' : undefined}
                      aria-describedby={groupLabelId}
                      className="nav-item"
                      data-pending={isPending ? 'true' : undefined}
                      disabled={navigationBusy}
                      onClick={() => {
                        if (!navigationBusy) onNavigate(item.defaultIntent);
                      }}
                      title={item.description}
                      type="button"
                    >
                      <span className="nav-item-index">{navItemOrdinal(index)}</span>
                      <span className="nav-item-label">{item.label}</span>
                      {isPending && <span className="nav-item-feedback">转跳中...</span>}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </nav>
  );
}

export function NextSafeActionHandoff({
  action,
  onNavigate,
}: {
  action: NextSafeAction;
  onNavigate: (intent: NavigationIntent) => void;
}) {
  return (
    <section
      aria-label="下一安全动作"
      className="next-safe-action-handoff"
      data-blocked={action.blocked ? 'true' : 'false'}
      data-workflow-stage={action.stage}
    >
      <div className="next-safe-action-copy">
        <strong>下一安全动作</strong>
        <span>{action.reason}</span>
      </div>
      <button className="primary-button" onClick={() => onNavigate(action.intent)} type="button">
        {action.label}
      </button>
    </section>
  );
}
```

## `apps/desktop/src/renderer/components/scope-bar.tsx`

Global operation-scope surface embedded in the topbar. It renders compact scope facts, progressive details, and the anchored scope editor for date/store/marketplace/product/batch.

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useScopeStore } from '../scope-store';
import { toUserFacingError } from '../user-facing-error';
import type { BusinessBatchOption } from '../types';
import { ProgressiveDetails } from './progressive-details';

const AUTO_BATCH_VALUE = '__auto__';
const MANUAL_BATCH_VALUE = '__manual__';
const REQUIRED_REPORT_COUNT = 8;

function cleanCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

function formatReportCoverage(batch: Partial<BusinessBatchOption>): string {
  const coverage = cleanCount(batch.realReportFileCount);
  if (coverage === null) return '待校验';
  const cappedCoverage = Math.min(REQUIRED_REPORT_COUNT, coverage);
  const fileCount = cleanCount(batch.totalFileRecords);
  const fileSuffix = fileCount !== null && fileCount > cappedCoverage ? ` · ${fileCount} 个文件` : '';
  return `${cappedCoverage}/${REQUIRED_REPORT_COUNT} 类${fileSuffix}`;
}

function formatImportedCoverage(batch: Partial<BusinessBatchOption>): string {
  const coverage = cleanCount(batch.importedReportTypeCount);
  if (coverage === null) return '待校验';
  const cappedCoverage = Math.min(REQUIRED_REPORT_COUNT, coverage);
  const rows = cleanCount(batch.importedRowCount);
  const rowsSuffix = rows === null ? '' : ` · ${rows} 行`;
  return `${cappedCoverage}/${REQUIRED_REPORT_COUNT} 类${rowsSuffix}`;
}

export function formatBatchOption(batch: BusinessBatchOption): string {
  const reportCoverage = formatReportCoverage(batch);
  const importedCoverage = formatImportedCoverage(batch);
  return `${batch.id} · ${reportCoverage === '待校验' ? '报表文件待校验' : `报表文件 ${reportCoverage}`} · ${importedCoverage === '待校验' ? '逐类入库待校验' : `逐类入库 ${importedCoverage}`}`;
}

type ScopeSummaryFact = {
  label: string;
  value: string;
  title?: string;
};

export type ScopeFieldFeedbackKey = 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode' | 'asin' | 'batchId';

type ProductLabelRow = {
  asin?: string;
  title?: string;
  store_name?: string;
  marketplace_code?: string;
  storeName?: string;
  marketplaceCode?: string;
};

export function buildScopeSummaryFacts(input: {
  batchId?: string;
  batchModeLabel: string;
  reportCoverage: string;
  importedRows: string;
  asin?: string;
  productLabel?: string;
}): ScopeSummaryFact[] {
  return [
    { label: '产品', value: input.productLabel || input.asin?.trim() || '全部产品' },
    { label: '报表文件', value: input.reportCoverage },
    { label: '逐类入库', value: input.importedRows },
    {
      label: '追溯批次',
      value: input.batchId || '自动匹配',
      title: input.batchModeLabel,
    },
  ];
}

export function buildScopeWarningSummary(input: {
  batchOptionsError?: string | null;
  scopePersistError?: string | null;
}): string | null {
  if (input.batchOptionsError?.trim() || input.scopePersistError?.trim()) {
    return '范围或批次需要处理，展开查看详情。';
  }
  return null;
}

export function buildScopeCompactRangeLabel(input: {
  dateFrom?: string;
  dateTo?: string;
}): string {
  const dateFrom = input.dateFrom?.trim();
  const dateTo = input.dateTo?.trim();
  if (dateFrom && dateTo) return `${dateFrom} ~ ${dateTo}`;
  if (dateFrom || dateTo) return dateFrom || dateTo || '日期待设置';
  return '日期待设置';
}

export function buildScopeCompactContextLabel(input: {
  storeName?: string;
  marketplaceCode?: string;
  asin?: string;
}): string {
  return [
    input.storeName?.trim() || '未选店铺',
    input.marketplaceCode?.trim() || '未选站点',
    input.asin?.trim() || '全部产品',
  ].join(' / ');
}

export function scopeFieldFeedbackLabel(field: ScopeFieldFeedbackKey): string {
  const labels: Record<ScopeFieldFeedbackKey, string> = {
    dateFrom: '开始日期已记录为待保存范围',
    dateTo: '结束日期已记录为待保存范围',
    storeName: '店铺已记录为待保存范围',
    marketplaceCode: '站点已记录为待保存范围',
    asin: 'ASIN 已记录为待保存范围',
    batchId: '批次已记录为当前范围',
  };
  return labels[field];
}

export function scopeFieldFeedbackClass(
  field: ScopeFieldFeedbackKey,
  activeField?: ScopeFieldFeedbackKey | null,
  baseClass = 'scope-field-feedback-shell',
): string {
  return [
    baseClass,
    activeField === field ? 'scope-field-confirmed' : '',
  ].filter(Boolean).join(' ');
}

export function scopeEditorSaveButtonView(saving: boolean): {
  label: string;
  disabled: boolean;
  ariaBusy: boolean;
  showSpinner: boolean;
  className: string;
} {
  return {
    label: saving ? '正在保存...' : '保存范围',
    disabled: saving,
    ariaBusy: saving,
    showSpinner: saving,
    className: ['primary-button', saving ? 'button-loading' : ''].filter(Boolean).join(' '),
  };
}

export function ScopeBar() {
  const { scope, setScope } = useScopeStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(scope);
  const [batchOptions, setBatchOptions] = useState<BusinessBatchOption[]>([]);
  const [batchOptionsError, setBatchOptionsError] = useState<string | null>(null);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [editError, setEditError] = useState('');
  const [scopeHydrated, setScopeHydrated] = useState(false);
  const [scopePersistError, setScopePersistError] = useState('');
  const [products, setProducts] = useState<ProductLabelRow[]>([]);
  const [confirmedField, setConfirmedField] = useState<{ field: ScopeFieldFeedbackKey; tick: number } | null>(null);
  const [scopeEditorSaving, setScopeEditorSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const selectedBatch = useMemo(
    () => batchOptions.find((batch) => batch.id === scope.batchId),
    [batchOptions, scope.batchId],
  );
  const autoMatchedBatch = useMemo(() => batchOptions[0], [batchOptions]);

  const save = async () => {
    if (scopeEditorSaving) return;
    const normalizedDraft = {
      ...draft,
      dateFrom: draft.dateFrom.trim(),
      dateTo: draft.dateTo.trim(),
      storeName: draft.storeName.trim(),
      marketplaceCode: draft.marketplaceCode.trim(),
      asin: draft.asin?.trim() || undefined,
      batchId: draft.batchId?.trim() || undefined,
      currency: 'USD' as const,
    };
    if (!normalizedDraft.dateFrom || !normalizedDraft.dateTo) {
      setEditError('请填写开始日期和结束日期。');
      return;
    }
    if (normalizedDraft.dateFrom > normalizedDraft.dateTo) {
      setEditError('开始日期不能晚于结束日期。');
      return;
    }
    if (!normalizedDraft.storeName) {
      setEditError('请填写店铺。');
      return;
    }
    if (!normalizedDraft.marketplaceCode) {
      setEditError('请填写站点。');
      return;
    }
    setScopeEditorSaving(true);
    try {
      const api = (window as any).electronAPI;
      if (api?.saveOperationScope) {
        await api.saveOperationScope(normalizedDraft);
      }
      setScope(normalizedDraft);
      setDraft(normalizedDraft);
      setEditing(false);
      setEditError('');
      setScopePersistError('');
    } catch (caught) {
      const message = toUserFacingError(caught, '保存运营范围失败。');
      setEditError(message);
      setScopePersistError(message);
    } finally {
      setScopeEditorSaving(false);
    }
  };

  const markFieldConfirmed = (field: ScopeFieldFeedbackKey) => {
    setConfirmedField({ field, tick: Date.now() });
  };

  const applyScopePatch = (patch: Partial<typeof scope>) => {
    const nextScope = { ...scope, ...patch, currency: 'USD' as const };
    setScope(nextScope);
    setDraft(nextScope);
  };

  const updateRangeDraft = (field: ScopeFieldFeedbackKey, patch: Partial<typeof scope>) => {
    setEditError('');
    markFieldConfirmed(field);
    setDraft((current) => ({ ...current, ...patch, batchId: undefined, currency: 'USD' as const }));
  };

  const updateDraftField = (field: ScopeFieldFeedbackKey, patch: Partial<typeof scope>) => {
    setEditError('');
    markFieldConfirmed(field);
    setDraft((current) => ({ ...current, ...patch, currency: 'USD' as const }));
  };

  useEffect(() => {
    let cancelled = false;
    async function loadPersistedScope() {
      try {
        const api = (window as any).electronAPI;
        const savedScope = await api?.getOperationScope?.();
        if (cancelled) return;
        if (savedScope?.dateFrom && savedScope?.dateTo && savedScope?.storeName && savedScope?.marketplaceCode) {
          const normalizedScope = { ...savedScope, currency: 'USD' as const };
          setScope(normalizedScope);
          setDraft(normalizedScope);
        }
      } catch (caught) {
        if (!cancelled) {
          setScopePersistError(toUserFacingError(caught, '读取已保存运营范围失败。'));
        }
      } finally {
        if (!cancelled) setScopeHydrated(true);
      }
    }
    loadPersistedScope();
    return () => {
      cancelled = true;
    };
  }, [setScope]);

  useEffect(() => {
    if (!scopeHydrated) return;
    const api = (window as any).electronAPI;
    if (!api?.saveOperationScope) return;
    api.saveOperationScope(scope)
      .then(() => setScopePersistError(''))
      .catch((caught: unknown) => {
        setScopePersistError(toUserFacingError(caught, '保存运营范围失败。'));
      });
  }, [
    scopeHydrated,
    scope.dateFrom,
    scope.dateTo,
    scope.storeName,
    scope.marketplaceCode,
    scope.asin,
    scope.batchId,
    scope.currency,
  ]);

  useEffect(() => {
    const refresh = () => setReloadToken((current) => current + 1);
    window.addEventListener('business-ui:data-updated', refresh);
    return () => window.removeEventListener('business-ui:data-updated', refresh);
  }, []);

  useEffect(() => {
    if (!confirmedField) return undefined;
    const timer = window.setTimeout(() => setConfirmedField(null), 900);
    return () => window.clearTimeout(timer);
  }, [confirmedField]);

  useEffect(() => {
    const openEditor = () => {
      setDraft(scope);
      setEditError('');
      setDetailsOpen(false);
      setEditing(true);
    };
    window.addEventListener('amazon-ai-ops:open-scope-editor', openEditor);
    return () => window.removeEventListener('amazon-ai-ops:open-scope-editor', openEditor);
  }, [scope]);

  useEffect(() => {
    if (!detailsOpen && !editing) return;
    function handleWindowKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || scopeEditorSaving) return;
      setDetailsOpen(false);
      setEditing(false);
      setEditError('');
    }
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [detailsOpen, editing, scopeEditorSaving]);

  useEffect(() => {
    let cancelled = false;
    async function loadProducts() {
      try {
        const rows = await (window as any).electronAPI?.getProducts?.();
        if (!cancelled) setProducts(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setProducts([]);
      }
    }
    loadProducts();
    window.addEventListener('business-ui:data-updated', loadProducts);
    return () => {
      cancelled = true;
      window.removeEventListener('business-ui:data-updated', loadProducts);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadBatchOptions() {
      setLoadingBatches(true);
      setBatchOptionsError(null);
      try {
        const api = (window as any).electronAPI;
        if (!api?.getBusinessBatchOptions) {
          throw new Error('批次列表接口未暴露');
        }
        const batches = await api.getBusinessBatchOptions(scope);
        if (!cancelled) {
          setBatchOptions(Array.isArray(batches) ? batches : []);
        }
      } catch (caught) {
        if (!cancelled) {
          setBatchOptions([]);
          setBatchOptionsError(toUserFacingError(caught, '读取当前范围批次失败。'));
        }
      } finally {
        if (!cancelled) setLoadingBatches(false);
      }
    }

    loadBatchOptions();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, scope.dateFrom, scope.dateTo, scope.storeName, scope.marketplaceCode]);

  const batchSelectValue = scope.batchId
    ? (selectedBatch ? scope.batchId : MANUAL_BATCH_VALUE)
    : AUTO_BATCH_VALUE;
  const batchModeLabel = scope.batchId
    ? (selectedBatch ? '手动指定已校验批次' : '手动批次待校验')
    : autoMatchedBatch ? '自动使用当前范围最新完整批次' : '自动匹配当前范围';
  const manualBatchUnmatched = Boolean(scope.batchId && !selectedBatch);
  const activeBatch = selectedBatch || (!scope.batchId ? autoMatchedBatch : undefined);
  const batchDataLabel = activeBatch
    ? formatReportCoverage(activeBatch)
    : manualBatchUnmatched ? '手动批次待校验'
    : loadingBatches ? '正在读取批次...' : '暂无匹配批次';
  const importedLabel = activeBatch
    ? formatImportedCoverage(activeBatch)
    : manualBatchUnmatched ? '待校验' : '0/8 类 · 0 行';
  const scopeHelperText = activeBatch
    ? `当前数据批次：${activeBatch.id}。批次只决定读取哪批真实报表和入库指标，不会自动重新下载。`
    : manualBatchUnmatched
      ? `当前使用手动批次：${scope.batchId}。该批次不在当前范围自动匹配列表中，后续页面会按这个 ID 尝试读取；如不确定，请切回“自动”。`
      : '当前未匹配到数据批次；需要先到“数据准备 → 报表采集”下载真实广告表格，再到“导入检查”完成入库。';
  const activeProduct = products.find((product) =>
    String(product.asin || '').trim().toUpperCase() === String(scope.asin || '').trim().toUpperCase()
    && (!(product.store_name || product.storeName) || (product.store_name || product.storeName) === scope.storeName)
    && (!(product.marketplace_code || product.marketplaceCode) || (product.marketplace_code || product.marketplaceCode) === scope.marketplaceCode)
  );
  const productLabel = scope.asin
    ? [activeProduct?.title, scope.asin].filter(Boolean).join(' / ') || scope.asin
    : '全部产品';
  const summaryFacts = buildScopeSummaryFacts({
    batchId: activeBatch?.id || scope.batchId,
    batchModeLabel,
    reportCoverage: batchDataLabel,
    importedRows: importedLabel,
    asin: scope.asin,
    productLabel,
  });
  const warningSummary = buildScopeWarningSummary({ batchOptionsError, scopePersistError });
  const confirmedFieldName = confirmedField?.field ?? null;
  const editorSaveButton = scopeEditorSaveButtonView(scopeEditorSaving);
  const renderFieldConfirmation = (field: ScopeFieldFeedbackKey) => (
    <span className="scope-field-confirmation" aria-live="polite">
      {confirmedFieldName === field ? scopeFieldFeedbackLabel(field) : '\u00A0'}
    </span>
  );
  const renderBatchSelect = () => (
    <label className={scopeFieldFeedbackClass('batchId', confirmedFieldName, 'scope-title-action-field')}>
      <span>数据批次</span>
      <select
        aria-label="数据批次来源"
        value={batchSelectValue}
        onChange={(event) => {
          markFieldConfirmed('batchId');
          const value = event.target.value;
          if (value === AUTO_BATCH_VALUE) {
            applyScopePatch({ batchId: undefined });
            return;
          }
          if (value === MANUAL_BATCH_VALUE) {
            setDraft(scope);
            setEditing(true);
            return;
          }
          applyScopePatch({ batchId: value });
        }}
      >
        <option value={AUTO_BATCH_VALUE}>自动批次</option>
        {batchOptions.map((batch) => (
          <option key={batch.id} value={batch.id}>{formatBatchOption(batch)}</option>
        ))}
        {scope.batchId && !selectedBatch && (
          <option value={MANUAL_BATCH_VALUE}>手动批次：{scope.batchId}</option>
        )}
        <option value={MANUAL_BATCH_VALUE}>手动输入批次 ID</option>
      </select>
      {renderFieldConfirmation('batchId')}
    </label>
  );

  const scopeRangeLabel = buildScopeCompactRangeLabel(scope);
  const scopeContextLabel = buildScopeCompactContextLabel(scope);
  const scopeFullLine = `${scopeRangeLabel} / ${scope.storeName || '未选店铺'} / ${scope.marketplaceCode || '未选站点'} / USD${scope.asin?.trim() ? ` / ASIN ${scope.asin.trim()}` : ' / 全部产品'}`;
  const topbarFacts = summaryFacts.filter((fact) => fact.label === '报表文件' || fact.label === '逐类入库');

  return (
    <section className="scope-bar" aria-label="当前工作范围">
      <div className="scope-title-row">
        <button
          aria-expanded={detailsOpen}
          className="scope-title-main scope-compact-trigger"
          onClick={() => {
            setEditing(false);
            setDetailsOpen((value) => !value);
          }}
          title={scopeFullLine}
          type="button"
        >
          <span>范围</span>
          <strong>{scopeRangeLabel}</strong>
          <em>{scopeContextLabel}</em>
          {warningSummary && (
            <span className="scope-visible-warning" role="status" title={warningSummary}>
              范围待处理
            </span>
          )}
        </button>
        <div className="scope-title-actions">
          {topbarFacts.map((fact) => (
            <span className="scope-topbar-fact" key={fact.label} title={fact.title || fact.value}>
              <b>{fact.label}</b>
              {fact.value}
            </span>
          ))}
          <button
            type="button"
            aria-expanded={editing}
            className="secondary-button compact-button scope-settings-button"
            onClick={() => {
              setDraft(scope);
              setEditError('');
              setDetailsOpen(false);
              setEditing((value) => !value);
            }}
          >
            范围设置
          </button>
        </div>
      </div>
      <div className="scope-compact-facts" aria-hidden="true" />
      {detailsOpen && (
      <div className="scope-details-panel">
        <ProgressiveDetails title="范围与批次说明" defaultOpen>
          <div className="scope-details-facts" aria-label="当前范围详情">
            <span><b>日期</b>{scopeRangeLabel}</span>
            <span><b>店铺/站点</b>{scope.storeName || '未选店铺'} / {scope.marketplaceCode || '未选站点'}</span>
            <span><b>币种</b>USD</span>
            <span><b>产品</b>{productLabel}</span>
            <span><b>批次</b>{activeBatch?.id || scope.batchId || '自动匹配'}</span>
          </div>
          <p>这是当前工作范围。数据采集、导入校验、广告表现、优化建议、审批中心、结果核对、关键词机会和 Listing 草案都会按这里读取。</p>
          <p className="scope-helper">{scopeHelperText}</p>
          {(scope.batchId || batchOptionsError || scopePersistError) && (
            <div className="scope-batch-note" aria-label="范围与批次详情">
              {scope.batchId && (
                <span>{manualBatchUnmatched ? `手动批次未自动校验：${scope.batchId}` : `当前批次：${scope.batchId}`}</span>
              )}
              {batchOptionsError && (
                <span className="blocked-line">批次列表读取失败：{batchOptionsError}</span>
              )}
              {scopePersistError && (
                <span className="blocked-line">范围保存失败：{scopePersistError}</span>
              )}
            </div>
          )}
        </ProgressiveDetails>
      </div>
      )}
      {editing && (
        <div className="scope-editor">
          <div className="scope-editor-summary" aria-label="当前范围摘要">
            {summaryFacts.map((fact) => (
              <span className="scope-fact" key={fact.label} title={fact.title}>
                <b>{fact.label}</b>
                {fact.value}
              </span>
            ))}
            <p>{scopeHelperText}</p>
          </div>
          <label className={scopeFieldFeedbackClass('dateFrom', confirmedFieldName)}>
            <span>开始日期</span>
            <input type="date" value={draft.dateFrom} onChange={(event) => updateRangeDraft('dateFrom', { dateFrom: event.target.value })} />
            {renderFieldConfirmation('dateFrom')}
          </label>
          <label className={scopeFieldFeedbackClass('dateTo', confirmedFieldName)}>
            <span>结束日期</span>
            <input type="date" value={draft.dateTo} onChange={(event) => updateRangeDraft('dateTo', { dateTo: event.target.value })} />
            {renderFieldConfirmation('dateTo')}
          </label>
          <label className={scopeFieldFeedbackClass('storeName', confirmedFieldName)}>
            <span>店铺</span>
            <input value={draft.storeName} onChange={(event) => updateRangeDraft('storeName', { storeName: event.target.value })} />
            {renderFieldConfirmation('storeName')}
          </label>
          <label className={scopeFieldFeedbackClass('marketplaceCode', confirmedFieldName)}>
            <span>站点</span>
            <input value={draft.marketplaceCode} onChange={(event) => updateRangeDraft('marketplaceCode', { marketplaceCode: event.target.value })} />
            {renderFieldConfirmation('marketplaceCode')}
          </label>
          <label className={scopeFieldFeedbackClass('asin', confirmedFieldName)}>
            <span>ASIN</span>
            <input value={draft.asin || ''} onChange={(event) => updateDraftField('asin', { asin: event.target.value || undefined })} />
            {renderFieldConfirmation('asin')}
          </label>
          {renderBatchSelect()}
          <label className={scopeFieldFeedbackClass('batchId', confirmedFieldName)}>
            <span>手动批次 ID</span>
            <input value={draft.batchId || ''} onChange={(event) => updateDraftField('batchId', { batchId: event.target.value || undefined })} />
            {renderFieldConfirmation('batchId')}
          </label>
          <p className="scope-editor-note">修改日期、店铺或站点会自动清空旧批次；如需固定历史批次，请重新输入批次 ID。</p>
          {editError && <p className="scope-editor-error">{editError}</p>}
          <button
            type="button"
            aria-busy={editorSaveButton.ariaBusy}
            className={editorSaveButton.className}
            disabled={editorSaveButton.disabled}
            onClick={() => { void save(); }}
          >
            <span className={editorSaveButton.showSpinner ? 'button-content' : undefined}>
              {editorSaveButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
              {editorSaveButton.label}
            </span>
          </button>
        </div>
      )}
    </section>
  );
}
```

## `apps/desktop/src/renderer/components/workspace/page-frame.tsx`

Shared page-level frame for title, description, task rail, summary strip, and page content.

```tsx
import React from 'react';

export type PageFrameProps = {
  title: string;
  description?: React.ReactNode;
  task?: React.ReactNode;
  summary?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  pageId?: string;
};

function pageFrameIdSeed(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(36);
}

export function PageFrame({
  title,
  description,
  task,
  summary,
  children,
  className,
  pageId,
}: PageFrameProps) {
  const idSeed = pageId ?? pageFrameIdSeed(title);
  const titleId = `workspace-page-${idSeed}-title`;
  const descriptionId = description ? `workspace-page-${idSeed}-description` : undefined;

  return (
    <section
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={`workspace-page-frame${className ? ` ${className}` : ''}`}
      data-workspace-page={pageId || undefined}
    >
      <header className="workspace-page-frame__header">
        <h1 id={titleId}>{title}</h1>
        {description && <div className="workspace-page-frame__description" id={descriptionId}>{description}</div>}
      </header>
      {task && <div className="workspace-page-frame__task">{task}</div>}
      {summary && <div className="workspace-page-frame__summary">{summary}</div>}
      <div className="workspace-page-frame__content">{children}</div>
    </section>
  );
}
```

## `apps/desktop/src/renderer/components/workspace/workspace-subview-shell.tsx`

Shared workspace wrapper for product, data-preparation, growth, and system branches. It supplies workspace identity, keyboard-operable tabs, preview notice, and the active tabpanel.

```tsx
import React from 'react';

export type WorkspaceSubviewTab<T extends string> = {
  id: T;
  label: string;
  detail?: string;
  status?: React.ReactNode;
};

export type WorkspaceSubviewShellProps<T extends string> = {
  workspace: string;
  workspaceLabel: string;
  description: React.ReactNode;
  subview: T;
  tabs: readonly WorkspaceSubviewTab<T>[];
  onNavigate: (subview: T) => void;
  children: React.ReactNode;
  ownsPageHeading?: boolean;
  previewNotice?: React.ReactNode;
  className?: string;
};

export function workspaceSubviewIndexFromKey(
  key: string,
  currentIndex: number,
  itemCount: number,
): number | null {
  if (itemCount <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (currentIndex + 1) % itemCount;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (currentIndex - 1 + itemCount) % itemCount;
  return null;
}

function workspaceSubviewId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
}

export function WorkspaceSubviewShell<T extends string>({
  workspace,
  workspaceLabel,
  description,
  subview,
  tabs,
  onNavigate,
  children,
  ownsPageHeading = false,
  previewNotice,
  className,
}: WorkspaceSubviewShellProps<T>) {
  const shellId = workspaceSubviewId(workspace);
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === subview));
  const activeTab = tabs[activeIndex] ?? tabs[0];
  const activeTabId = `${shellId}-workspace-tab-${workspaceSubviewId(activeTab?.id ?? subview)}`;
  const panelId = `${shellId}-workspace-panel`;

  return (
    <div
      className={`workspace-subview-shell${className ? ` ${className}` : ''}`}
      data-workspace={workspace}
      data-workspace-evidence-root={true}
      data-workspace-subview={subview}
    >
      <section aria-label={`${workspaceLabel}工作区导航`} className="workspace-subview-shell__navigation">
        <div className="workspace-subview-shell__identity">
          <span>工作区</span>
          {ownsPageHeading
            ? <h1 id={`${shellId}-workspace-title`}>{workspaceLabel}</h1>
            : <strong>{workspaceLabel}</strong>}
          <p>{description}</p>
        </div>
        <div
          aria-label={`${workspaceLabel}子视图`}
          aria-orientation="horizontal"
          className="workspace-subview-shell__tabs"
          role="tablist"
        >
          {tabs.map((tab, index) => {
            const selected = tab.id === subview;
            const tabId = `${shellId}-workspace-tab-${workspaceSubviewId(tab.id)}`;
            return (
              <button
                aria-controls={panelId}
                aria-selected={selected}
                id={tabId}
                key={tab.id}
                onClick={() => onNavigate(tab.id)}
                onKeyDown={(event) => {
                  const nextIndex = workspaceSubviewIndexFromKey(event.key, index, tabs.length);
                  if (nextIndex === null) return;
                  event.preventDefault();
                  const nextTab = tabs[nextIndex];
                  if (!nextTab) return;
                  onNavigate(nextTab.id);
                  if (typeof document !== 'undefined') {
                    document.getElementById(
                      `${shellId}-workspace-tab-${workspaceSubviewId(nextTab.id)}`,
                    )?.focus();
                  }
                }}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <span>{tab.label}</span>
                {tab.status && <strong>{tab.status}</strong>}
                {tab.detail && <small>{tab.detail}</small>}
              </button>
            );
          })}
        </div>
      </section>
      {previewNotice && (
        <div className="workspace-subview-shell__preview" data-workspace-preview-notice={true} role="note">
          {previewNotice}
        </div>
      )}
      <div
        aria-labelledby={activeTabId}
        className="workspace-subview-shell__panel"
        id={panelId}
        role="tabpanel"
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
```

## `apps/desktop/src/renderer/components/workspace/responsive-inspector.tsx`

Responsive secondary-detail layout. At 1400px and above it is an inline complementary region; at 1399px and below it becomes a focus-trapped modal drawer with inert background.

```tsx
import React, { useEffect, useId, useRef, useState } from 'react';
import {
  captureOverlayFocusTarget,
  handleOverlayEscape,
  isTopOverlayKeyboardLayer,
  makeOverlayBackgroundInert,
  overlayDismissLocked,
  registerOverlayKeyboardLayer,
  resolveOverlayFocusReturnTarget,
  restoreOverlayFocus,
  scheduleOverlayFocusRestore,
  trapOverlayTab,
  type OverlayFocusSurface,
  type OverlayFocusTarget,
  type OverlayInertRoot,
} from './overlay-focus-scope';

export const RESPONSIVE_INSPECTOR_MEDIA_QUERY = '(max-width: 1399px)';

export type ResponsiveInspectorMode = 'inline' | 'drawer';

export type ResponsiveInspectorViewport = {
  innerWidth?: number;
  matchMedia?: (query: string) => { matches: boolean };
};

export type ResponsiveInspectorFocusTarget = OverlayFocusTarget;

export type ResponsiveInspectorProps = {
  open: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  dismissDisabled?: boolean;
  busy?: boolean;
  onClose: () => void;
  resolveFocusReturnTarget?: (
    trigger: ResponsiveInspectorFocusTarget | null,
  ) => ResponsiveInspectorFocusTarget | null;
  children: React.ReactNode;
};

type ResponsiveInspectorFocusScope = OverlayFocusSurface;
type ResponsiveInspectorInertRoot = OverlayInertRoot;

export function resolveResponsiveInspectorMode(
  viewport: ResponsiveInspectorViewport | undefined,
): ResponsiveInspectorMode {
  if (!viewport) return 'inline';

  if (typeof viewport.matchMedia === 'function') {
    try {
      return viewport.matchMedia(RESPONSIVE_INSPECTOR_MEDIA_QUERY).matches ? 'drawer' : 'inline';
    } catch {
      // Fall through to the width check for incomplete browser shims.
    }
  }

  if (typeof viewport.innerWidth === 'number') {
    return viewport.innerWidth < 1400 ? 'drawer' : 'inline';
  }

  return 'inline';
}

export function captureResponsiveInspectorTrigger(
  activeElement: unknown,
): ResponsiveInspectorFocusTarget | null {
  return captureOverlayFocusTarget(activeElement);
}

export function restoreResponsiveInspectorFocus(
  trigger: ResponsiveInspectorFocusTarget | null,
): void {
  restoreOverlayFocus(trigger);
}

export function scheduleResponsiveInspectorFocusRestore(
  trigger: ResponsiveInspectorFocusTarget | null,
  schedule: (callback: () => void) => void,
): void {
  scheduleOverlayFocusRestore(trigger, schedule);
}

export function resolveResponsiveInspectorFocusReturnTarget(
  trigger: ResponsiveInspectorFocusTarget | null,
  resolver?: (
    trigger: ResponsiveInspectorFocusTarget | null,
  ) => ResponsiveInspectorFocusTarget | null,
): ResponsiveInspectorFocusTarget | null {
  return resolveOverlayFocusReturnTarget(trigger, resolver);
}

export function focusResponsiveInspectorEntry(
  mode: ResponsiveInspectorMode,
  closeButton: ResponsiveInspectorFocusTarget | null,
  surface: ResponsiveInspectorFocusTarget | null,
): void {
  if (mode !== 'drawer') return;
  (closeButton ?? surface)?.focus();
}

export function responsiveInspectorDismissLocked(
  dismissDisabled = false,
  busy = false,
): boolean {
  return overlayDismissLocked(dismissDisabled, busy);
}

export function handleResponsiveInspectorEscape(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
  onClose: () => void,
  dismissLocked = false,
): boolean {
  return handleOverlayEscape(event, onClose, dismissLocked);
}

export function trapResponsiveInspectorTab(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>,
  surface: ResponsiveInspectorFocusScope | null,
  activeElement: unknown,
): boolean {
  return trapOverlayTab(event, surface, activeElement);
}

export function makeResponsiveInspectorBackgroundInert(
  root: ResponsiveInspectorInertRoot | null,
): () => void {
  return makeOverlayBackgroundInert(root);
}

function currentViewport(): ResponsiveInspectorViewport | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

function useResponsiveInspectorMode(): ResponsiveInspectorMode {
  const [mode, setMode] = useState<ResponsiveInspectorMode>(() => (
    resolveResponsiveInspectorMode(currentViewport())
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const updateMode = () => setMode(resolveResponsiveInspectorMode(window));
    if (typeof window.matchMedia === 'function') {
      let mediaQuery: MediaQueryList;
      try {
        mediaQuery = window.matchMedia(RESPONSIVE_INSPECTOR_MEDIA_QUERY);
      } catch {
        window.addEventListener('resize', updateMode);
        return () => window.removeEventListener('resize', updateMode);
      }

      const handleChange = () => updateMode();
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
      }

      mediaQuery.addListener?.(handleChange);
      return () => mediaQuery.removeListener?.(handleChange);
    }

    window.addEventListener('resize', updateMode);
    return () => window.removeEventListener('resize', updateMode);
  }, []);

  return mode;
}

export function ResponsiveInspector({
  open,
  title,
  description,
  dismissDisabled = false,
  busy = false,
  onClose,
  resolveFocusReturnTarget,
  children,
}: ResponsiveInspectorProps) {
  const id = useId().replace(/:/g, '');
  const titleId = `responsive-inspector-${id}-title`;
  const descriptionId = description ? `responsive-inspector-${id}-description` : undefined;
  const mode = useResponsiveInspectorMode();
  const surfaceRef = useRef<HTMLElement | null>(null);
  const drawerRootRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<ResponsiveInspectorFocusTarget | null>(null);
  const keyboardLayerRef = useRef(Symbol('responsive-inspector-keyboard-layer'));
  const focusReturnResolverRef = useRef(resolveFocusReturnTarget);
  const dismissLockedRef = useRef(false);
  const modeRef = useRef(mode);
  const onCloseRef = useRef(onClose);
  focusReturnResolverRef.current = resolveFocusReturnTarget;
  const dismissLocked = responsiveInspectorDismissLocked(dismissDisabled, busy);
  dismissLockedRef.current = dismissLocked;
  modeRef.current = mode;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    triggerRef.current = captureResponsiveInspectorTrigger(document.activeElement);

    return () => {
      const trigger = triggerRef.current;
      triggerRef.current = null;
      const returnTarget = resolveResponsiveInspectorFocusReturnTarget(
        trigger,
        focusReturnResolverRef.current,
      );
      scheduleResponsiveInspectorFocusRestore(returnTarget, (callback) => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(callback);
          return;
        }
        queueMicrotask(callback);
      });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    focusResponsiveInspectorEntry(
      mode,
      dismissLocked ? null : closeButtonRef.current,
      surfaceRef.current,
    );
  }, [dismissLocked, mode, open]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const keyboardLayer = keyboardLayerRef.current;
    const unregisterKeyboardLayer = registerOverlayKeyboardLayer(keyboardLayer);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopOverlayKeyboardLayer(keyboardLayer)) return;
      if (modeRef.current === 'drawer' && trapResponsiveInspectorTab(
        event,
        surfaceRef.current,
        document.activeElement,
      )) {
        return;
      }
      handleResponsiveInspectorEscape(event, () => onCloseRef.current(), dismissLockedRef.current);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      unregisterKeyboardLayer();
    };
  }, [open]);

  useEffect(() => {
    if (!open || mode !== 'drawer') return undefined;
    return makeResponsiveInspectorBackgroundInert(drawerRootRef.current);
  }, [mode, open]);

  if (!open) return null;

  const content = (
    <>
      <header className="responsive-inspector__header">
        <div className="responsive-inspector__heading">
          <h2 id={titleId}>{title}</h2>
          {description && (
            <p className="responsive-inspector__description" id={descriptionId}>{description}</p>
          )}
        </div>
        <button
          aria-disabled={dismissLocked || undefined}
          aria-label="关闭详情检查器"
          className="responsive-inspector__close"
          disabled={dismissLocked}
          onClick={dismissLocked ? undefined : onClose}
          ref={closeButtonRef}
          type="button"
        >
          关闭
        </button>
      </header>
      <div className="responsive-inspector__body">{children}</div>
    </>
  );

  if (mode === 'drawer') {
    return (
      <div
        className="responsive-inspector__backdrop"
        data-inspector-mode="drawer"
        ref={drawerRootRef}
      >
        <section
          aria-busy={busy || undefined}
          aria-describedby={descriptionId}
          aria-labelledby={titleId}
          aria-modal="true"
          className="responsive-inspector responsive-inspector--drawer"
          data-dismiss-locked={dismissLocked ? 'true' : undefined}
          data-inspector-mode="drawer"
          ref={surfaceRef}
          role="dialog"
          tabIndex={-1}
        >
          {content}
        </section>
      </div>
    );
  }

  return (
    <aside
      aria-busy={busy || undefined}
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="responsive-inspector responsive-inspector--inline"
      data-dismiss-locked={dismissLocked ? 'true' : undefined}
      data-inspector-mode="inline"
      ref={surfaceRef}
      role="complementary"
      tabIndex={-1}
    >
      {content}
    </aside>
  );
}
```

