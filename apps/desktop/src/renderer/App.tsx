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
import {
  DEFAULT_WORKSPACE_INTENTS,
  navigationIntentsEqual,
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
  adsEntryMode?: string;
  adsUrl?: string;
  adsTitle?: string;
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
  const erp = session.erpSessionReused ? 'ERP 已复用登录态' : 'ERP 已完成登录';
  const ads = session.adsTitle || session.adsUrl ? `Ads 已进入：${session.adsTitle || session.adsUrl}` : 'Ads 会话待确认';
  return `${erp}；${ads}`;
}

export function headerSessionStatusLabel(session?: LoginSessionInfo | null): string {
  if (!session) return '会话待确认';
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

export type BrowserLoginRequest =
  | {
      username: string;
      credentialSource: 'saved';
      rememberPassword: true;
    }
  | {
      username: string;
      credentialSource: 'typed';
      password: string;
      rememberPassword: boolean;
    };

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
      const session = await api.browserLogin(request);
      setLoginState(true, request.username, session);
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
    setPendingNavigationIntent(intent);
    setActiveNavigation(intent);
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
          <strong>{currentStore}</strong>
          <span className="session-line" title={describeLoginSession(loginSession)}>{headerSessionStatusLabel(loginSession)}</span>
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
