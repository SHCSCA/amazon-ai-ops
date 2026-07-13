import React, { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Sidebar } from './components/app-shell';
import { ScopeBar } from './components/scope-bar';
import { AdQuantPage } from './pages/ad-quant-page';
import { ApprovalPage } from './pages/approval-page';
import { DashboardPage } from './pages/dashboard-page';
import { DataCollectionPage } from './pages/data-collection-page';
import { DataImportValidationPage } from './pages/data-import-validation-page';
import { DeliveryPage } from './pages/delivery-page';
import { KeywordOpportunitiesPage } from './pages/keyword-opportunities-page';
import { ListingOptimizationPage } from './pages/listing-optimization-page';
import { OperationEventsPage } from './pages/operation-events-page';
import { OperationScopePage } from './pages/operation-scope-page';
import { ProductConfigPage } from './pages/product-config-page';
import { ProductManagementPage } from './pages/product-management-page';
import { ReadbackPage } from './pages/readback-page';
import { RecommendationsPage } from './pages/recommendations-page';
import { SchedulerPage } from './pages/scheduler-page';
import { SettingsPage } from './pages/settings-page';
import type { AppRoute, DeliveryReadinessView } from './types';
import { toUserFacingError } from './user-facing-error';
import { bootstrapBrowserPreview } from './dev-preview-api';
import './styles.css';

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
  activeTab: AppRoute;
  setActiveTab: (tab: AppRoute) => void;
  setLoginState: (isLoggedIn: boolean, store?: string, loginSession?: LoginSessionInfo | null) => void;
}

const useStore = create<AppState>((set) => ({
  isLoggedIn: false,
  currentStore: '',
  loginSession: null,
  activeTab: 'dashboard',
  setActiveTab: (tab) => set({ activeTab: tab }),
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

const browserPreviewBootstrap = bootstrapAppBrowserPreview();

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
  securityTag: {
    border: '1px solid var(--tone-ready-border)',
    borderRadius: 999,
    background: 'var(--tone-ready-bg)',
    color: 'var(--tone-ready-text)',
    padding: '3px 8px',
    fontSize: 12,
    fontWeight: 800,
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
  loading: boolean;
  credentialNotice?: string;
  rememberPassword: boolean;
}): string {
  if (input.loading) return '正在确认 ERP 和 Ads 会话，本机凭证只在主进程安全区解密。';
  if (input.credentialNotice) return input.credentialNotice;
  if (input.rememberPassword) return '勾选后账号密码只保存在本机加密区。';
  return '未记住密码，只使用本次登录输入。';
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
  const [credentialNotice, setCredentialNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const setLoginState = useStore((state) => state.setLoginState);
  const loginButtonView = loginSubmitButtonView(loading);
  const loginStatus = loginStatusMessage({ loading, credentialNotice, rememberPassword });
  const loginStatusClass = [
    'login-status-line',
    loading ? 'login-status-line-pending' : '',
    !loading && credentialNotice ? 'login-status-line-ready' : '',
  ].filter(Boolean).join(' ');

  useEffect(() => {
    let cancelled = false;
    async function loadSavedCredentials() {
      const api = appElectronApi(username);
      if (!api?.getSavedLoginCredentials) return;
      try {
        const saved = await api.getSavedLoginCredentials();
        if (cancelled || !saved) return;
        setUsername(typeof saved.username === 'string' ? saved.username : '');
        setRememberPassword(Boolean(saved.rememberPassword));
        if (saved.passwordAvailable && typeof saved.password === 'string') {
          setPassword(saved.password);
          setCredentialNotice('');
        } else if (saved.rememberPassword) {
          setCredentialNotice('已加载账号，密码需重新输入。');
        }
      } catch {
        if (!cancelled) setCredentialNotice('');
      }
    }

    loadSavedCredentials();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogin() {
    if (!username || !password) {
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
      const session = await api.browserLogin(username, password, rememberPassword);
      setLoginState(true, username, session);
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
            onChange={(event) => setUsername(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && handleLogin()}
            placeholder="领星用户名"
            style={loginStyles.input}
            type="text"
            value={username}
          />
          <input
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && handleLogin()}
            placeholder="领星密码"
            style={loginStyles.input}
            type="password"
            value={password}
          />
          <div style={loginStyles.rememberRow}>
            <label style={loginStyles.rememberLabel}>
              <input
                checked={rememberPassword}
                onChange={(event) => setRememberPassword(event.target.checked)}
                type="checkbox"
              />
              <span>记住账号密码</span>
            </label>
            <span style={loginStyles.securityTag}>本机加密</span>
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

function BusinessRoutePage({ route }: { route: AppRoute }) {
  if (route === 'dashboard') return <DashboardPage />;
  if (route === 'product-management') return <ProductManagementPage />;
  if (route === 'operation-scope') return <OperationScopePage />;
  if (route === 'data-collection') return <DataCollectionPage />;
  if (route === 'data-import-validation') return <DataImportValidationPage />;
  if (route === 'operation-events') return <OperationEventsPage />;
  if (route === 'product-config') return <ProductConfigPage />;
  if (route === 'ad-quant') return <AdQuantPage />;
  if (route === 'recommendations') return <RecommendationsPage />;
  if (route === 'approval') return <ApprovalPage />;
  if (route === 'readback') return <ReadbackPage />;
  if (route === 'keyword-opportunities') return <KeywordOpportunitiesPage />;
  if (route === 'listing-optimization') return <ListingOptimizationPage />;
  if (route === 'scheduler') return <SchedulerPage />;
  if (route === 'settings') return <SettingsPage />;
  if (route === 'delivery') return <DeliveryPage />;
  return <DashboardPage />;
}

export default function App() {
  const { isLoggedIn, currentStore, loginSession, activeTab, setActiveTab, setLoginState } = useStore();
  const [deliveryReadiness, setDeliveryReadiness] = useState<DeliveryReadinessView | null>(null);
  const [pendingNavigationRoute, setPendingNavigationRoute] = useState<AppRoute | null>(null);
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

  const requestNavigate = useCallback((route: AppRoute) => {
    if (route === activeTab && !pendingNavigationRoute) return;
    if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current);
    setPendingNavigationRoute(route);
    setActiveTab(route);
    navigationTimerRef.current = window.setTimeout(() => {
      setPendingNavigationRoute((current) => (current === route ? null : current));
      navigationTimerRef.current = null;
    }, 150);
  }, [activeTab, pendingNavigationRoute, setActiveTab]);

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const route = (event as CustomEvent<AppRoute>).detail;
      if (route) requestNavigate(route);
    };
    window.addEventListener('amazon-ai-ops:navigate', handleNavigate);
    return () => window.removeEventListener('amazon-ai-ops:navigate', handleNavigate);
  }, [requestNavigate]);

  useEffect(() => () => {
    if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current);
  }, []);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, left: 0 });
  }, [activeTab]);

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    async function loadDeliveryReadiness() {
      try {
        const readiness = await (window as any).electronAPI?.getDeliveryReadiness?.();
        if (!cancelled && readiness) setDeliveryReadiness(readiness);
      } catch {
        if (!cancelled) setDeliveryReadiness(null);
      }
    }

    loadDeliveryReadiness();
    window.addEventListener('business-ui:data-updated', loadDeliveryReadiness);
    return () => {
      cancelled = true;
      window.removeEventListener('business-ui:data-updated', loadDeliveryReadiness);
    };
  }, [isLoggedIn]);

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
          <BusinessRoutePage route={activeTab} />
        </main>
      </div>
    </div>
  );
}
