import React, { useState, useEffect, useCallback } from 'react';
import { create } from 'zustand';

// Types
interface AppState {
  isLoggedIn: boolean;
  currentStore: string;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  setLoginState: (isLoggedIn: boolean, store?: string) => void;
}

interface RuleConfig {
  targetAcos: number;
  maxCpc: number;
  noOrderClickThreshold: number;
  highAcosThreshold: number;
  enableAutoLowerBid: boolean;
  enableAutoAddNegative: boolean;
}

interface Recommendation {
  id: number;
  actionType: string;
  entityName: string;
  reason: string;
  acos: number;
  clicks: number;
  cost: number;
  riskLevel: string;
  status: string;
  confidence: number;
  evidence?: { acos: number; cost: number; clicks: number; };
}

// Zustand store
const useStore = create<AppState>((set) => ({
  isLoggedIn: false,
  currentStore: '',
  activeTab: 'dashboard',
  setActiveTab: (tab) => set({ activeTab: tab }),
  setLoginState: (isLoggedIn, store = '') => set({ isLoggedIn, currentStore: store }),
}));

// Login Component
function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const setLoginState = useStore((s) => s.setLoginState);

  const handleLogin = async () => {
    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await (window as any).electronAPI.browserLogin(username, password);
      setLoginState(true, username);
    } catch (e: any) {
      setError(e.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.loginContainer}>
      <div style={styles.loginCard}>
        <h1 style={styles.loginTitle}>Amazon AI Ops Agent</h1>
        <p style={styles.loginSubtitle}>v1.2.0</p>
        <div style={styles.loginForm}>
          <input
            type="text"
            placeholder="领星用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={styles.input}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
          <input
            type="password"
            placeholder="领星密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
          {error && <div style={styles.error}>{error}</div>}
          <button onClick={handleLogin} disabled={loading} style={styles.loginButton}>
            {loading ? '登录中...' : '登录领星'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Dashboard Component
function Dashboard() {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
  }, []);

  const loadMetrics = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const data = await (window as any).electronAPI.getMetricsSummary(today);
      setMetrics(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.dashboard}>
      <h2 style={styles.sectionTitle}>今日概览</h2>
      {loading ? (
        <div style={styles.loading}>加载中...</div>
      ) : (
        <div style={styles.metricsGrid}>
          <MetricCard label="广告销售" value={`¥${((metrics?.totalSales) || 0).toFixed(2)}`} color="#1890ff" />
          <MetricCard label="广告花费" value={`¥${((metrics?.totalCost) || 0).toFixed(2)}`} color="#f5222d" />
          <MetricCard label="ACOS" value={`${((metrics?.avgAcos) || 0).toFixed(1)}%`} color="#faad14" />
          <MetricCard label="总点击" value={(metrics?.totalClicks || 0).toString()} color="#52c41a" />
          <MetricCard label="总订单" value={(metrics?.totalOrders || 0).toString()} color="#722ed1" />
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ ...styles.metricCard, borderLeft: `4px solid ${color}` }}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={{ ...styles.metricValue, color }}>{value}</div>
    </div>
  );
}

// Recommendations Component
function Recommendations() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'executed'>('pending');

  useEffect(() => {
    loadRecommendations();
  }, [filter]);

  const loadRecommendations = async () => {
    setLoading(true);
    try {
      const data = await (window as any).electronAPI.getRecommendations({ status: filter, limit: 50 });
      setRecommendations(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: number) => {
    await (window as any).electronAPI.approveRecommendation(id);
    loadRecommendations();
  };

  const handleReject = async (id: number) => {
    await (window as any).electronAPI.rejectRecommendation(id);
    loadRecommendations();
  };

  const handleExecute = async (id: number) => {
    await (window as any).electronAPI.executeRecommendation(id);
    loadRecommendations();
  };

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h2 style={styles.sectionTitle}>优化建议</h2>
        <div style={styles.filterTabs}>
          {(['pending', 'approved', 'rejected', 'executed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{ ...styles.tab, ...(filter === f ? styles.tabActive : {}) }}
            >
              {f === 'pending' ? '待审批' : f === 'approved' ? '已批准' : f === 'rejected' ? '已拒绝' : '已执行'}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div style={styles.loading}>加载中...</div>
      ) : recommendations.length === 0 ? (
        <div style={styles.empty}>暂无数据</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>动作</th>
              <th style={styles.th}>关键词</th>
              <th style={styles.th}>ACOS</th>
              <th style={styles.th}>花费</th>
              <th style={styles.th}>置信度</th>
              <th style={styles.th}>风险</th>
              <th style={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {recommendations.map((rec) => (
              <tr key={rec.id} style={styles.tr}>
                <td style={styles.td}><span style={styles.actionBadge}>{rec.actionType}</span></td>
                <td style={styles.td}>{rec.entityName}</td>
                <td style={styles.td}>{((rec.evidence?.acos || 0) * 100).toFixed(1)}%</td>
                <td style={styles.td}>¥{(rec.evidence?.cost || 0).toFixed(2)}</td>
                <td style={styles.td}>{((rec.confidence || 0) * 100).toFixed(0)}%</td>
                <td style={styles.td}><span style={styles.riskBadge(rec.riskLevel)}>{rec.riskLevel}</span></td>
                <td style={styles.td}>
                  {filter === 'pending' && (
                    <>
                      <button onClick={() => handleApprove(rec.id)} style={styles.btnApprove}>批准</button>
                      <button onClick={() => handleReject(rec.id)} style={styles.btnReject}>拒绝</button>
                    </>
                  )}
                  {filter === 'approved' && (
                    <button onClick={() => handleExecute(rec.id)} style={styles.btnExecute}>执行</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Settings Component
function Settings() {
  const [config, setConfig] = useState<RuleConfig>({
    targetAcos: 0.25,
    maxCpc: 5.0,
    noOrderClickThreshold: 30,
    highAcosThreshold: 0.4,
    enableAutoLowerBid: true,
    enableAutoAddNegative: true,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    const data = await (window as any).electronAPI.getRuleConfig();
    if (data) setConfig(data);
  };

  const handleSave = async () => {
    setSaving(true);
    await (window as any).electronAPI.saveRuleConfig(config);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={styles.page}>
      <h2 style={styles.sectionTitle}>规则配置</h2>
      <div style={styles.settingsForm}>
        <div style={styles.formGroup}>
          <label style={styles.label}>目标 ACOS</label>
          <input
            type="number"
            step="0.01"
            value={config.targetAcos}
            onChange={(e) => setConfig({ ...config, targetAcos: parseFloat(e.target.value) })}
            style={styles.input}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>最高 CPC (¥)</label>
          <input
            type="number"
            step="0.01"
            value={config.maxCpc}
            onChange={(e) => setConfig({ ...config, maxCpc: parseFloat(e.target.value) })}
            style={styles.input}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>无转化点击阈值</label>
          <input
            type="number"
            value={config.noOrderClickThreshold}
            onChange={(e) => setConfig({ ...config, noOrderClickThreshold: parseInt(e.target.value) })}
            style={styles.input}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>高 ACOS 阈值</label>
          <input
            type="number"
            step="0.01"
            value={config.highAcosThreshold}
            onChange={(e) => setConfig({ ...config, highAcosThreshold: parseFloat(e.target.value) })}
            style={styles.input}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>
            <input
              type="checkbox"
              checked={config.enableAutoLowerBid}
              onChange={(e) => setConfig({ ...config, enableAutoLowerBid: e.target.checked })}
            />
            自动降 bid
          </label>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>
            <input
              type="checkbox"
              checked={config.enableAutoAddNegative}
              onChange={(e) => setConfig({ ...config, enableAutoAddNegative: e.target.checked })}
            />
            自动否词
          </label>
        </div>
        <button onClick={handleSave} disabled={saving} style={styles.saveButton}>
          {saving ? '保存中...' : saved ? '已保存!' : '保存配置'}
        </button>
      </div>
    </div>
  );
}

// Scheduler Component
function Scheduler() {
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadTasks = async () => {
    const data = await (window as any).electronAPI.getScheduledTasks();
    setTasks(data);
  };

  const toggleTask = async (name: string, enabled: boolean) => {
    await (window as any).electronAPI.setTaskEnabled(name, enabled);
    loadTasks();
  };

  const runNow = async (name: string) => {
    await (window as any).electronAPI.runTaskNow(name);
  };

  return (
    <div style={styles.page}>
      <h2 style={styles.sectionTitle}>定时任务</h2>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>任务</th>
            <th style={styles.th}>Cron</th>
            <th style={styles.th}>状态</th>
            <th style={styles.th}>下次执行</th>
            <th style={styles.th}>操作</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.name} style={styles.tr}>
              <td style={styles.td}>{task.name}</td>
              <td style={styles.td}>{task.cron}</td>
              <td style={styles.td}>
                <span style={styles.statusBadge(task.enabled)}>
                  {task.enabled ? '启用' : '禁用'}
                </span>
              </td>
              <td style={styles.td}>{task.nextRun ? new Date(task.nextRun).toLocaleString() : '-'}</td>
              <td style={styles.td}>
                <button onClick={() => toggleTask(task.name, !task.enabled)} style={styles.btnSmall}>
                  {task.enabled ? '禁用' : '启用'}
                </button>
                <button onClick={() => runNow(task.name)} style={styles.btnSmall}>立即执行</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Main App Shell
export default function App() {
  const { isLoggedIn, currentStore, activeTab, setActiveTab, setLoginState } = useStore();

  useEffect(() => {
    checkLoginState();
  }, []);

  const checkLoginState = async () => {
    const state = await (window as any).electronAPI.getState();
    setLoginState(state.isLoggedIn, state.currentStore);
  };

  const handleLogout = async () => {
    await (window as any).electronAPI.browserLogout();
    setLoginState(false);
  };

  if (!isLoggedIn) {
    return <LoginPage />;
  }

  const navItems = [
    { id: 'dashboard', label: '仪表盘' },
    { id: 'recommendations', label: '优化建议' },
    { id: 'scheduler', label: '定时任务' },
    { id: 'settings', label: '设置' },
  ];

  return (
    <div style={styles.appShell}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logo}>Amazon AI Ops</span>
          <span style={styles.version}>v1.2.0</span>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.storeName}>{currentStore}</span>
          <button onClick={handleLogout} style={styles.logoutButton}>退出登录</button>
        </div>
      </header>

      {/* Body */}
      <div style={styles.body}>
        {/* Sidebar */}
        <nav style={styles.sidebar}>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              style={{ ...styles.navItem, ...(activeTab === item.id ? styles.navItemActive : {}) }}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <main style={styles.content}>
          {activeTab === 'dashboard' && <Dashboard />}
          {activeTab === 'recommendations' && <Recommendations />}
          {activeTab === 'scheduler' && <Scheduler />}
          {activeTab === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
}

// Styles
const styles: any = {
  appShell: { display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif', background: '#f5f5f5' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', background: '#001529', color: '#fff' },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '16px' },
  logo: { fontSize: '18px', fontWeight: 'bold' },
  version: { fontSize: '12px', color: '#ffffff99' },
  storeName: { fontSize: '14px' },
  logoutButton: { padding: '6px 16px', background: '#ff4d4f', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '13px' },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  sidebar: { width: '200px', background: '#fff', borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', padding: '8px 0' },
  navItem: { padding: '12px 24px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: '14px', color: '#333', width: '100%' },
  navItemActive: { background: '#e6f7ff', color: '#1890ff', borderRight: '3px solid #1890ff' },
  content: { flex: 1, overflow: 'auto', padding: '24px' },
  loginContainer: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#001529' },
  loginCard: { background: '#fff', padding: '48px', borderRadius: '8px', width: '400px', textAlign: 'center' },
  loginTitle: { margin: '0 0 8px', fontSize: '24px', color: '#333' },
  loginSubtitle: { margin: '0 0 32px', color: '#999', fontSize: '14px' },
  loginForm: { display: 'flex', flexDirection: 'column', gap: '16px' },
  input: { padding: '12px 16px', borderRadius: '4px', border: '1px solid #d9d9d9', fontSize: '14px', width: '100%', boxSizing: 'border-box' },
  loginButton: { padding: '12px', background: '#1890ff', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '16px', cursor: 'pointer' },
  error: { color: '#ff4d4f', fontSize: '14px', textAlign: 'left' },
  dashboard: { padding: '0 8px' },
  page: { padding: '0 8px' },
  sectionTitle: { fontSize: '20px', fontWeight: 'bold', marginBottom: '24px', color: '#333' },
  metricsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' },
  metricCard: { background: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  metricLabel: { fontSize: '14px', color: '#666', marginBottom: '8px' },
  metricValue: { fontSize: '28px', fontWeight: 'bold' },
  loading: { textAlign: 'center', color: '#999', padding: '40px' },
  empty: { textAlign: 'center', color: '#999', padding: '40px' },
  table: { width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  th: { padding: '12px 16px', textAlign: 'left', background: '#fafafa', borderBottom: '1px solid #e8e8e8', fontSize: '13px', color: '#666' },
  td: { padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '14px' },
  tr: { transition: 'background 0.2s' },
  actionBadge: { display: 'inline-block', padding: '2px 8px', background: '#e6f7ff', color: '#1890ff', borderRadius: '4px', fontSize: '12px' },
  riskBadge: (level: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', background: level === 'FORBIDDEN' ? '#fff1f0' : level === 'APPROVAL' ? '#fffbe6' : '#f6ffed', color: level === 'FORBIDDEN' ? '#cf1322' : level === 'APPROVAL' ? '#d46b08' : '#389e0d' }),
  btnApprove: { marginRight: '8px', padding: '4px 12px', background: '#52c41a', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px' },
  btnReject: { marginRight: '8px', padding: '4px 12px', background: '#ff4d4f', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px' },
  btnExecute: { padding: '4px 12px', background: '#1890ff', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px' },
  btnSmall: { marginRight: '8px', padding: '4px 12px', background: '#f0f0f0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
  filterTabs: { display: 'flex', gap: '8px', marginBottom: '16px' },
  tab: { padding: '6px 16px', background: '#f0f0f0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },
  tabActive: { background: '#1890ff', color: '#fff' },
  pageHeader: { marginBottom: '16px' },
  settingsForm: { background: '#fff', padding: '24px', borderRadius: '8px', maxWidth: '500px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  formGroup: { marginBottom: '16px' },
  label: { display: 'block', marginBottom: '8px', fontSize: '14px', color: '#333' },
  saveButton: { padding: '10px 24px', background: '#1890ff', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '14px' },
  statusBadge: (enabled: boolean) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', background: enabled ? '#f6ffed' : '#fff1f0', color: enabled ? '#52c41a' : '#ff4d4f' }),
};
