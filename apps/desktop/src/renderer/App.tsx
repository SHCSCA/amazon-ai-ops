import React, { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Sidebar } from './components/app-shell';
import { ScopeBar } from './components/scope-bar';
import { StatusPill } from './components/ui';
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
import { ReadbackPage } from './pages/readback-page';
import { RecommendationsPage } from './pages/recommendations-page';
import { SchedulerPage } from './pages/scheduler-page';
import { SettingsPage } from './pages/settings-page';
import type { AppRoute, DeliveryReadinessView } from './types';
import { toUserFacingError } from './user-facing-error';
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

const loginStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'grid',
    minHeight: '100vh',
    placeItems: 'center',
    background: '#eef3f8',
    padding: 24,
  },
  card: {
    display: 'grid',
    gap: 16,
    width: 'min(420px, 100%)',
    border: '1px solid #d8e2ed',
    borderRadius: 10,
    background: '#fff',
    padding: 28,
    boxShadow: '0 16px 40px rgba(15, 23, 42, 0.12)',
  },
  title: { margin: 0, color: '#0f2238', fontSize: 26, lineHeight: 1.15 },
  subtitle: { margin: 0, color: '#60758a', fontSize: 13, fontWeight: 700 },
  form: { display: 'grid', gap: 12 },
  input: {
    height: 42,
    border: '1px solid #ccd6e0',
    borderRadius: 8,
    padding: '0 12px',
    fontSize: 15,
  },
  hint: {
    border: '1px solid #d8e9ff',
    borderRadius: 8,
    background: '#f5faff',
    color: '#29496b',
    padding: '10px 12px',
    fontSize: 13,
    lineHeight: 1.45,
  },
  error: {
    border: '1px solid #ffd0d0',
    borderRadius: 8,
    background: '#fff5f5',
    color: '#b42318',
    padding: '10px 12px',
    fontSize: 13,
  },
  button: {
    height: 44,
    border: 0,
    borderRadius: 8,
    background: '#1473e6',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 15,
    fontWeight: 800,
  },
};

function describeLoginSession(session?: LoginSessionInfo | null): string {
  if (!session) return 'ERP/Ads 会话：待确认';
  const erp = session.erpSessionReused ? 'ERP 已复用登录态' : 'ERP 已完成登录';
  const ads = session.adsTitle || session.adsUrl ? `Ads 已进入：${session.adsTitle || session.adsUrl}` : 'Ads 会话待确认';
  return `${erp}；${ads}`;
}

function headerReadinessLabel(readiness: DeliveryReadinessView | null): string {
  if (readiness?.appReady && readiness?.manifestDriven) return '最终验收通过';
  if (readiness?.available === false) return '待生成验收';
  return '等待最终验收';
}

function headerReadinessClass(readiness: DeliveryReadinessView | null): string {
  if (readiness?.appReady && readiness?.manifestDriven) return 'app-status app-status-ready';
  if (readiness?.available === false) return 'app-status app-status-pending';
  return 'app-status app-status-warning';
}

function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const setLoginState = useStore((state) => state.setLoginState);

  async function handleLogin() {
    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const session = await (window as any).electronAPI.browserLogin(username, password);
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
          <div style={loginStyles.hint}>登录流程：ERP 登录 {'->'} ERP 广告入口 {'->'} Ads 会话确认。不会从 Ads URL 直接开始。</div>
          {error && <div style={loginStyles.error}>{error}</div>}
          <button disabled={loading} onClick={handleLogin} style={loginStyles.button} type="button">
            {loading ? '正在确认 ERP 和 Ads 会话...' : '登录并进入 Ads'}
          </button>
        </div>
      </section>
    </div>
  );
}

function BusinessRoutePage({ route }: { route: AppRoute }) {
  if (route === 'dashboard') return <DashboardPage />;
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
  const contentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    async function checkLoginState() {
      try {
        const state = await (window as any).electronAPI.getState();
        setLoginState(Boolean(state.isLoggedIn), state.currentStore, state.loginSession || null);
      } catch (caught) {
        console.error(caught);
        setLoginState(false);
      }
    }

    checkLoginState();
  }, [setLoginState]);

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const route = (event as CustomEvent<AppRoute>).detail;
      if (route) setActiveTab(route);
    };
    window.addEventListener('amazon-ai-ops:navigate', handleNavigate);
    return () => window.removeEventListener('amazon-ai-ops:navigate', handleNavigate);
  }, [setActiveTab]);

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
          <span className={headerReadinessClass(deliveryReadiness)}>{headerReadinessLabel(deliveryReadiness)}</span>
        </div>
        <div className="topbar-right">
          <strong>{currentStore}</strong>
          <span className="session-line">{describeLoginSession(loginSession)}</span>
          <button className="logout-button" onClick={handleLogout} type="button">退出登录</button>
        </div>
      </header>
      <div className="app-body">
        <Sidebar activeRoute={activeTab} onNavigate={setActiveTab} />
        <main ref={contentRef} className="app-content">
          <ScopeBar />
          <div style={{ marginBottom: 12 }}>
            <StatusPill tone="warning">真实报表优先</StatusPill>
          </div>
          <BusinessRoutePage route={activeTab} />
        </main>
      </div>
    </div>
  );
}
