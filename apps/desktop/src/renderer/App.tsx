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
        <p style={styles.loginSubtitle}>v1.5.0</p>
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

function V15Workspace() {
  const [dateStart, setDateStart] = useState('2026-05-01');
  const [dateEnd, setDateEnd] = useState('2026-05-25');
  const [collectionStoreName, setCollectionStoreName] = useState('FT-US-US');
  const [collectionMarketplaceCode, setCollectionMarketplaceCode] = useState('US');
  const [message, setMessage] = useState('');
  const [selectedReportFile, setSelectedReportFile] = useState('');
  const [keywordSource, setKeywordSource] = useState('search_term');
  const [keywordDuplicateStrategy, setKeywordDuplicateStrategy] = useState<'overwrite' | 'merge' | 'skip'>('merge');
  const [keywordMetrics, setKeywordMetrics] = useState<any[]>([]);
  const [keywordDiagnostics, setKeywordDiagnostics] = useState<any>(null);
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [reportBatchResult, setReportBatchResult] = useState<any>(null);
  const [downloadCenterDiagnostic, setDownloadCenterDiagnostic] = useState<any>(null);
  const [collectionPreflight, setCollectionPreflight] = useState<any>(null);
  const [downloadCenterPageModelInfo, setDownloadCenterPageModelInfo] = useState<any>(null);
  const [downloadCenterPageModelText, setDownloadCenterPageModelText] = useState('');
  const [listing, setListing] = useState({
    asin: '',
    title: '',
    bulletsText: '',
    aPlus: '',
    imageCopy: '',
    backendTerms: '',
  });
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);

  useEffect(() => {
    loadDownloadCenterPageModel();
  }, []);

  const collectionRequest = () => ({
    start: dateStart,
    end: dateEnd,
    storeName: collectionStoreName.trim(),
    marketplaceCode: collectionMarketplaceCode.trim(),
  });

  const collectReports = async () => {
    setMessage('正在启动领星报告采集...');
    try {
      const result = await (window as any).electronAPI.collectLingxingReports(collectionRequest());
      setReportBatchResult(result);
      const failed = result.files.filter((file: any) => file.status === 'failed');
      setMessage(
        result.batch.status === 'failed'
          ? `采集失败：${failed.length} 个报告未完成。首个错误：${failed[0]?.errorMessage || '未知错误'}`
          : `采集批次 ${result.batch.id} 已记录，成功 ${result.files.length - failed.length} 个，失败 ${failed.length} 个，文件夹：${result.batch.downloadDir}`,
      );
    } catch (e: any) {
      setMessage(e.message || '采集失败');
    }
  };

  const preflightCollection = async () => {
    setMessage('正在执行领星采集预检...');
    try {
      const result = await (window as any).electronAPI.preflightLingxingCollection(collectionRequest());
      setCollectionPreflight(result);
      setMessage(result.ready
        ? '采集预检通过：页面模型、近期诊断证据和浏览器登录状态均满足启动条件'
        : `采集预检未通过：${result.checks.filter((check: any) => check.status !== 'passed').map((check: any) => `${check.name}: ${check.detail}`).join('；')}`);
    } catch (e: any) {
      setMessage(e.message || '采集预检失败');
    }
  };

  const exportCollectionPreflight = async () => {
    setMessage('正在导出采集预检证据...');
    try {
      const exportPath = await (window as any).electronAPI.exportLingxingCollectionPreflight(collectionRequest());
      setMessage(`采集预检证据已导出：${exportPath}`);
      await openReportPath(exportPath);
    } catch (e: any) {
      setMessage(e.message || '导出采集预检证据失败');
    }
  };

  const retryReport = async (file: any) => {
    setMessage(`正在重试 ${file.displayName}...`);
    try {
      const result = await (window as any).electronAPI.retryLingxingReport(
        collectionRequest(),
        file.reportType,
      );
      setReportBatchResult(result);
      const retryFile = result.files[0];
      setMessage(
        retryFile?.status === 'downloaded'
          ? `单项重试成功：${retryFile.displayName}，文件：${retryFile.filePath}`
          : `单项重试失败：${retryFile?.errorMessage || '未知错误'}`,
      );
    } catch (e: any) {
      setMessage(e.message || '单项重试失败');
    }
  };

  const openReportPath = async (targetPath: string) => {
    try {
      await (window as any).electronAPI.openReportPath(targetPath);
    } catch (e: any) {
      setMessage(e.message || '打开路径失败');
    }
  };

  const exportLingxingAcceptanceAudit = async () => {
    if (!reportBatchResult) {
      setMessage('请先完成一次完整 8 报表领星报告采集；单项重试批次可导出但不会通过完整验收审计');
      return;
    }
    try {
      const auditPath = await (window as any).electronAPI.exportLingxingAcceptanceAudit(reportBatchResult.batch.id);
      setMessage(`领星验收审计已导出：${auditPath}`);
      await openReportPath(auditPath);
    } catch (e: any) {
      setMessage(e.message || '导出领星验收审计失败');
    }
  };

  const diagnoseDownloadCenter = async () => {
    setMessage('正在只读验证领星下载中心页面模型...');
    try {
      const result = await (window as any).electronAPI.diagnoseLingxingDownloadCenter(collectionRequest());
      setDownloadCenterDiagnostic(result);
      setMessage(result.ready ? '下载中心页面模型诊断通过，仍需人工确认后才能打开自动下载。' : `下载中心页面模型未通过：${result.errorMessage || '缺少页面文本或关键选择器'}`);
    } catch (e: any) {
      setMessage(e.message || '下载中心页面模型诊断失败');
    }
  };

  const exportDownloadCenterDiagnosticBundle = async () => {
    if (!downloadCenterDiagnostic?.id) {
      setMessage('请先运行“验证页面”生成诊断证据');
      return;
    }
    try {
      const bundlePath = await (window as any).electronAPI.exportDownloadCenterDiagnosticBundle(downloadCenterDiagnostic.id);
      setMessage(`下载中心诊断证据包已导出：${bundlePath}`);
      await openReportPath(bundlePath);
    } catch (e: any) {
      setMessage(e.message || '导出下载中心诊断证据包失败');
    }
  };

  const exportDownloadCenterPageModelDraft = async () => {
    if (!downloadCenterDiagnostic?.id) {
      setMessage('请先运行“验证页面”生成诊断证据');
      return;
    }
    try {
      const result = await (window as any).electronAPI.exportDownloadCenterPageModelDraft(downloadCenterDiagnostic.id);
      setDownloadCenterPageModelText(JSON.stringify(result.draft, null, 2));
      setMessage(`页面模型草稿已生成并填入编辑框：${result.exportPath}`);
      await openReportPath(result.exportPath);
    } catch (e: any) {
      setMessage(e.message || '生成页面模型草稿失败');
    }
  };

  const exportDownloadCenterPageModelEnablementAudit = async () => {
    try {
      const result = await (window as any).electronAPI.exportDownloadCenterPageModelEnablementAudit(
        { start: dateStart, end: dateEnd },
      );
      setMessage(result.canDisableManualVerification
        ? `页面模型启用审计通过：${result.exportPath}`
        : `页面模型启用审计未通过：${result.missing?.join(', ') || '缺少诊断证据'}；证据已导出：${result.exportPath}`);
      await openReportPath(result.exportPath);
    } catch (e: any) {
      setMessage(e.message || '导出页面模型启用审计失败');
    }
  };

  const loadDownloadCenterPageModel = async () => {
    try {
      const result = await (window as any).electronAPI.getDownloadCenterPageModel();
      setDownloadCenterPageModelInfo(result);
      setDownloadCenterPageModelText(JSON.stringify(result.model, null, 2));
    } catch (e: any) {
      setMessage(e.message || '读取下载中心页面模型失败');
    }
  };

  const saveDownloadCenterPageModel = async () => {
    try {
      const model = JSON.parse(downloadCenterPageModelText);
      const result = await (window as any).electronAPI.saveDownloadCenterPageModel(model);
      setDownloadCenterPageModelInfo(result);
      setDownloadCenterPageModelText(JSON.stringify(result.model, null, 2));
      const backupNote = result.overrideSaveMetadata?.backupPath ? `，旧 override 已备份：${result.overrideSaveMetadata.backupPath}` : '';
      const metadataNote = result.overrideSaveMetadata?.overridePath ? `，保存元数据：${result.overrideMetadataPath}` : '';
      const postSaveDiagnosticNote = result.overrideSaveMetadata?.postSaveDiagnosticRequired
        ? '；已关闭人工验证，必须立刻重新运行“验证页面”生成 enabled snapshot 诊断证据，之后再采集'
        : '';
      setMessage(result.readiness?.ready
        ? `页面模型 override 已保存，结构校验通过${postSaveDiagnosticNote}：${result.path}${backupNote}${metadataNote}`
        : `页面模型 override 已保存，但自动化仍未就绪：${result.readiness?.reason || result.readiness?.missing?.join(', ') || '需要继续验证'}${postSaveDiagnosticNote}${backupNote}${metadataNote}`);
    } catch (e: any) {
      setMessage(e.message || '保存下载中心页面模型失败');
    }
  };

  const resetDownloadCenterPageModel = async () => {
    try {
      const result = await (window as any).electronAPI.resetDownloadCenterPageModel();
      setDownloadCenterPageModelInfo(result);
      setDownloadCenterPageModelText(JSON.stringify(result.model, null, 2));
      setMessage(result.resetBackupPath ? `已恢复使用打包内置页面模型，旧 override 已备份：${result.resetBackupPath}` : '已恢复使用打包内置页面模型');
    } catch (e: any) {
      setMessage(e.message || '重置下载中心页面模型失败');
    }
  };

  const selectKeywordReport = async () => {
    const filePath = await (window as any).electronAPI.selectReportFile();
    if (filePath) {
      setSelectedReportFile(filePath);
      setKeywordDiagnostics(null);
      setMessage(`已选择报表：${filePath}`);
    }
  };

  const importKeywordReport = async () => {
    if (!selectedReportFile) {
      setMessage('请先选择搜索词、SQP 或关键词报表');
      return;
    }

    try {
      setKeywordDiagnostics(null);
      const result = await (window as any).electronAPI.importKeywordReport(selectedReportFile, keywordSource, keywordDuplicateStrategy);
      setKeywordMetrics(result.metrics);
      setKeywordDiagnostics(result.diagnostics || null);
      setOpportunities(result.opportunities);
      setSuggestions([]);
      setDrafts([]);
      if (result.skipped) {
        setMessage(`已跳过重复报表：库中已有 ${result.existingRows || 0} 行来自该文件`);
        return;
      }
      const warningCount = result.diagnostics?.warnings?.length || 0;
      const duplicateNote = result.duplicate
        ? (result.duplicateStrategy === 'overwrite' ? `，已覆盖旧 ${result.existingRows || 0} 行` : `，已与旧 ${result.existingRows || 0} 行合并`)
        : '';
      setMessage(`已导入 ${result.metricsCount} 行关键词指标，生成 ${result.opportunities.length} 条机会${duplicateNote}${warningCount ? `，解析警告 ${warningCount} 条` : ''}`);
    } catch (e: any) {
      setKeywordDiagnostics(null);
      setMessage(e.message || '关键词报表导入失败');
    }
  };

  const buildListing = () => ({
    asin: listing.asin.trim(),
    title: listing.title.trim(),
    bullets: listing.bulletsText.split('\n').map((line) => line.trim()).filter(Boolean),
    aPlus: listing.aPlus.trim(),
    imageCopy: listing.imageCopy.trim(),
    backendTerms: listing.backendTerms.trim(),
  });

  const importListingContent = async () => {
    const filePath = await (window as any).electronAPI.selectReportFile();
    if (!filePath) return;

    try {
      const data = await (window as any).electronAPI.importListingContent(filePath);
      setListing({
        asin: data.asin || '',
        title: data.title || '',
        bulletsText: (data.bullets || []).join('\n'),
        aPlus: data.aPlus || '',
        imageCopy: data.imageCopy || '',
        backendTerms: data.backendTerms || '',
      });
      setSuggestions([]);
      setDrafts([]);
      setMessage(`已导入 Listing 文案：${filePath}`);
    } catch (e: any) {
      setMessage(e.message || 'Listing 文案导入失败');
    }
  };

  const runListingAnalysis = async () => {
    const listingContent = buildListing();
    if (!listingContent.asin || !listingContent.title) {
      setMessage('请填写 ASIN 和标题后再生成 Listing 建议');
      return;
    }
    if (opportunities.length === 0) {
      setMessage('请先导入关键词报表生成机会');
      return;
    }

    const scopedOpportunities = opportunities.filter((item) => !item.asin || item.asin === listingContent.asin);
    if (scopedOpportunities.length === 0) {
      setMessage('当前 ASIN 没有可用于生成 Listing 建议的关键词机会');
      return;
    }

    const coverage = await (window as any).electronAPI.analyzeListingCoverage(
      listingContent,
      scopedOpportunities.map((item) => item.normalizedKeyword),
    );
    const coverageByKeyword = Object.fromEntries(
      coverage
        .filter((item: any) => item.covered)
        .map((item: any) => [item.normalizedKeyword, item.sections]),
    );
    const scopedMetrics = keywordMetrics.filter((item) => !item.asin || item.asin === listingContent.asin);
    const rankedOpportunities = scopedMetrics.length > 0
      ? await (window as any).electronAPI.buildKeywordOpportunities(scopedMetrics, { coverageByKeyword })
      : scopedOpportunities;
    setOpportunities(rankedOpportunities);
    const data = await (window as any).electronAPI.buildListingSuggestions(listingContent, rankedOpportunities);
    setSuggestions(data);
    setDrafts([]);
    setMessage(`覆盖分析 ${coverage.length} 条，Listing 建议 ${data.length} 条`);
  };

  const updateSuggestionStatus = async (suggestion: any, status: 'accepted' | 'ignored') => {
    if (!suggestion.id) {
      setSuggestions((items) => items.map((item) => item === suggestion ? { ...item, status } : item));
      return;
    }
    await (window as any).electronAPI.updateListingSuggestionStatus(suggestion.id, status);
    setSuggestions((items) => items.map((item) => item.id === suggestion.id ? { ...item, status } : item));
  };

  const exportSuggestions = async (format: 'csv' | 'xlsx' | 'markdown') => {
    const filePath = await (window as any).electronAPI.exportListingSuggestions(suggestions, format);
    setMessage(`已导出：${filePath}`);
  };

  const exportKeywordDiagnostics = async () => {
    if (!keywordDiagnostics || ((keywordDiagnostics.errors?.length || 0) + (keywordDiagnostics.warnings?.length || 0)) === 0) {
      setMessage('当前没有可导出的解析诊断');
      return;
    }
    const filePath = await (window as any).electronAPI.exportKeywordDiagnostics(keywordDiagnostics);
    setMessage(`解析诊断已导出：${filePath}`);
  };

  const generateDrafts = async () => {
    if (suggestions.length === 0) {
      setMessage('请先生成 Listing 建议');
      return;
    }
    const data = await (window as any).electronAPI.generateListingDrafts(suggestions);
    setDrafts(data);
    setMessage(`已生成 ${data.length} 条 Listing 修改草案`);
  };

  return (
    <div style={styles.page}>
      <h2 style={styles.sectionTitle}>v1.5 关键词与 Listing 工作台</h2>
      <div style={styles.panelGrid}>
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>广告报告采集</h3>
          <div style={styles.inlineForm}>
            <input value={dateStart} onChange={(e) => setDateStart(e.target.value)} style={styles.input} />
            <input value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} style={styles.input} />
            <input
              value={collectionStoreName}
              onChange={(e) => setCollectionStoreName(e.target.value)}
              placeholder="店铺，如 FT-US-US"
              style={styles.input}
            />
            <input
              value={collectionMarketplaceCode}
              onChange={(e) => setCollectionMarketplaceCode(e.target.value)}
              placeholder="站点，如 US"
              style={styles.input}
            />
            <button onClick={collectReports} style={styles.saveButton}>启动采集</button>
            <button onClick={preflightCollection} style={styles.btnSmall}>采集预检</button>
            <button onClick={exportCollectionPreflight} style={styles.btnSmall}>导出预检</button>
            <button onClick={diagnoseDownloadCenter} style={styles.btnSmall}>验证页面</button>
            <button onClick={exportDownloadCenterDiagnosticBundle} style={styles.btnSmall}>导出证据包</button>
            <button onClick={exportDownloadCenterPageModelDraft} style={styles.btnSmall}>生成模型草稿</button>
            <button onClick={exportDownloadCenterPageModelEnablementAudit} style={styles.btnSmall}>导出启用审计</button>
          </div>
          {collectionPreflight && (
            <div style={styles.summaryLine}>
              <div>预检：{collectionPreflight.ready ? 'ready' : 'blocked'}</div>
              <div>生成时间：{collectionPreflight.generatedAt}</div>
              {collectionPreflight.checks.map((check: any) => (
                <div key={check.name}>
                  {check.name}：{check.status}
                  {check.missing?.length ? `，缺失：${check.missing.join(', ')}` : ''}
                  {check.detail ? `，${check.detail}` : ''}
                </div>
              ))}
            </div>
          )}
          {reportBatchResult && (
            <div style={styles.summaryLine}>
              <div>批次：{reportBatchResult.batch.id}</div>
              <div>状态：{reportBatchResult.batch.status}</div>
              <div style={styles.pathLine}>{reportBatchResult.batch.downloadDir}</div>
              <div style={styles.buttonRow}>
                <button onClick={() => openReportPath(reportBatchResult.batch.downloadDir)} style={styles.btnSmall}>打开文件夹</button>
                {reportBatchResult.batch.manifestPath && (
                  <button onClick={() => openReportPath(reportBatchResult.batch.manifestPath)} style={styles.btnSmall}>打开 Manifest</button>
                )}
                <button onClick={exportLingxingAcceptanceAudit} style={styles.btnSmall}>导出验收审计</button>
              </div>
            </div>
          )}
          {downloadCenterPageModelInfo && (
            <div style={styles.summaryLine}>
              <div>页面模型：{downloadCenterPageModelInfo.source}</div>
              <div>自动化：{downloadCenterPageModelInfo.readiness?.ready ? 'ready' : (downloadCenterPageModelInfo.readiness?.reason || 'not ready')}</div>
              {downloadCenterPageModelInfo.readiness?.missing?.length > 0 && (
                <div>缺失：{downloadCenterPageModelInfo.readiness.missing.join(', ')}</div>
              )}
              {downloadCenterPageModelInfo.overrideError && (
                <div style={styles.error}>本地 override 无效，当前已回退内置模型：{downloadCenterPageModelInfo.overrideError}</div>
              )}
              <div style={styles.pathLine}>{downloadCenterPageModelInfo.path}</div>
            </div>
          )}
          <textarea
            value={downloadCenterPageModelText}
            onChange={(e) => setDownloadCenterPageModelText(e.target.value)}
            spellCheck={false}
            style={{ ...styles.textarea, minHeight: '180px', fontFamily: 'Consolas, monospace' }}
          />
          <div style={styles.buttonRow}>
            <button onClick={saveDownloadCenterPageModel} style={styles.btnSmall}>保存页面模型</button>
            <button onClick={loadDownloadCenterPageModel} style={styles.btnSmall}>重新读取</button>
            <button onClick={resetDownloadCenterPageModel} style={styles.btnSmall}>恢复内置模型</button>
          </div>
        </div>
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>关键词机会</h3>
          <div style={styles.stackedForm}>
            <select value={keywordSource} onChange={(e) => setKeywordSource(e.target.value)} style={styles.input}>
              <option value="search_term">搜索词报表</option>
              <option value="sqp">SQP 报表</option>
              <option value="keyword_report">关键词报表</option>
            </select>
            <select value={keywordDuplicateStrategy} onChange={(e) => setKeywordDuplicateStrategy(e.target.value as 'overwrite' | 'merge' | 'skip')} style={styles.input}>
              <option value="merge">重复文件：合并</option>
              <option value="overwrite">重复文件：覆盖</option>
              <option value="skip">重复文件：跳过</option>
            </select>
            <button onClick={selectKeywordReport} style={styles.btnSmall}>选择报表</button>
            <button onClick={importKeywordReport} style={styles.btnExecute}>导入并生成机会</button>
          </div>
          <div style={styles.summaryLine}>{selectedReportFile || '未选择文件'}</div>
          {keywordDiagnostics && (
            <div style={styles.summaryLine}>
              解析：{keywordDiagnostics.parsedRows}/{keywordDiagnostics.totalRows} 行，
              错误行 {keywordDiagnostics.invalidRows}，
              警告 {keywordDiagnostics.warnings?.length || 0}
              {((keywordDiagnostics.errors?.length || 0) + (keywordDiagnostics.warnings?.length || 0)) > 0 && (
                <button onClick={exportKeywordDiagnostics} style={{ ...styles.btnSmall, marginLeft: '8px' }}>导出诊断</button>
              )}
            </div>
          )}
          <div style={styles.summaryLine}>机会数：{opportunities.length}</div>
        </div>
        <div style={{ ...styles.panel, gridColumn: '1 / -1' }}>
          <h3 style={styles.panelTitle}>Listing 建议</h3>
          <div style={styles.listingGrid}>
            <input
              value={listing.asin}
              onChange={(e) => setListing({ ...listing, asin: e.target.value })}
              placeholder="ASIN"
              style={styles.input}
            />
            <input
              value={listing.title}
              onChange={(e) => setListing({ ...listing, title: e.target.value })}
              placeholder="标题"
              style={styles.input}
            />
            <textarea
              value={listing.bulletsText}
              onChange={(e) => setListing({ ...listing, bulletsText: e.target.value })}
              placeholder="五点描述，每行一条"
              style={styles.textarea}
            />
            <textarea
              value={listing.backendTerms}
              onChange={(e) => setListing({ ...listing, backendTerms: e.target.value })}
              placeholder="Search Terms / Backend Terms"
              style={styles.textarea}
            />
            <textarea
              value={listing.aPlus}
              onChange={(e) => setListing({ ...listing, aPlus: e.target.value })}
              placeholder="A+ 文案"
              style={styles.textarea}
            />
            <textarea
              value={listing.imageCopy}
              onChange={(e) => setListing({ ...listing, imageCopy: e.target.value })}
              placeholder="图片文案"
              style={styles.textarea}
            />
          </div>
          <div style={styles.buttonRow}>
            <button onClick={importListingContent} style={styles.btnSmall}>导入 Listing Excel</button>
            <button onClick={runListingAnalysis} style={styles.btnExecute}>生成建议</button>
            <button onClick={generateDrafts} disabled={suggestions.length === 0} style={styles.btnExecute}>生成草案</button>
            <button onClick={() => exportSuggestions('csv')} disabled={suggestions.length === 0} style={styles.btnSmall}>导出 CSV</button>
            <button onClick={() => exportSuggestions('xlsx')} disabled={suggestions.length === 0} style={styles.btnSmall}>导出 Excel</button>
            <button onClick={() => exportSuggestions('markdown')} disabled={suggestions.length === 0} style={styles.btnSmall}>导出 Markdown</button>
          </div>
          <div style={styles.summaryLine}>建议数：{suggestions.length}</div>
        </div>
      </div>
      {message && <div style={styles.notice}>{message}</div>}
      {downloadCenterDiagnostic && (
        <table style={{ ...styles.table, marginBottom: '16px' }}>
          <thead>
            <tr>
              <th style={styles.th}>页面模型</th>
              <th style={styles.th}>URL</th>
              <th style={styles.th}>就绪</th>
              <th style={styles.th}>截图</th>
              <th style={styles.th}>DOM</th>
              <th style={styles.th}>命中文本</th>
              <th style={styles.th}>命中报告</th>
              <th style={styles.th}>缺失必需选择器</th>
              <th style={styles.th}>候选选择器</th>
              <th style={styles.th}>动作选择器</th>
            </tr>
          </thead>
          <tbody>
            <tr style={styles.tr}>
              <td style={styles.td}>{downloadCenterDiagnostic.pageModel}</td>
              <td style={styles.td}><span style={styles.pathLine}>{downloadCenterDiagnostic.url}</span></td>
              <td style={styles.td}>{downloadCenterDiagnostic.ready ? 'ready' : 'not ready'}</td>
              <td style={styles.td}>
                {downloadCenterDiagnostic.screenshotPath
                  ? <button onClick={() => openReportPath(downloadCenterDiagnostic.screenshotPath)} style={styles.btnSmall}>打开截图</button>
                  : '-'}
              </td>
              <td style={styles.td}>
                {downloadCenterDiagnostic.domSnapshotPath
                  ? <button onClick={() => openReportPath(downloadCenterDiagnostic.domSnapshotPath)} style={styles.btnSmall}>打开 DOM</button>
                  : '-'}
              </td>
              <td style={styles.td}>{downloadCenterDiagnostic.matchedEntryHints?.join(', ') || '-'}</td>
              <td style={styles.td}>{downloadCenterDiagnostic.matchedReportNames?.join(', ') || '-'}</td>
              <td style={styles.td}>{downloadCenterDiagnostic.missingRequiredSelectors?.join(', ') || '-'}</td>
              <td style={styles.td}>{downloadCenterDiagnostic.selectorCandidates?.length || 0}</td>
              <td style={styles.td}>
                {(downloadCenterDiagnostic.actionSelectorChecks || []).filter((check: any) => check.usable).length}
                /
                {downloadCenterDiagnostic.actionSelectorChecks?.length || 0}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {downloadCenterDiagnostic?.actionSelectorChecks?.length > 0 && (
        <table style={{ ...styles.table, marginBottom: '16px' }}>
          <thead>
            <tr>
              <th style={styles.th}>动作</th>
              <th style={styles.th}>报告</th>
              <th style={styles.th}>必需</th>
              <th style={styles.th}>命中数</th>
              <th style={styles.th}>可用</th>
              <th style={styles.th}>selector</th>
              <th style={styles.th}>错误</th>
            </tr>
          </thead>
          <tbody>
            {downloadCenterDiagnostic.actionSelectorChecks.map((check: any, index: number) => (
              <tr key={`${check.name}-${check.reportType || 'global'}-${index}`} style={styles.tr}>
                <td style={styles.td}>{check.name}</td>
                <td style={styles.td}>{check.reportDisplayName || '-'}</td>
                <td style={styles.td}>{check.required ? '是' : '否'}</td>
                <td style={styles.td}>{check.matchCount}</td>
                <td style={styles.td}>{check.usable ? '可用' : check.ambiguous ? '过宽' : '不可用'}</td>
                <td style={styles.td}><span style={styles.pathLine}>{check.renderedSelector || check.selector}</span></td>
                <td style={styles.td}>{check.errorMessage || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {downloadCenterDiagnostic?.selectorCandidates?.length > 0 && (
        <table style={{ ...styles.table, marginBottom: '16px' }}>
          <thead>
            <tr>
              <th style={styles.th}>用途</th>
              <th style={styles.th}>文本</th>
              <th style={styles.th}>标签</th>
              <th style={styles.th}>唯一</th>
              <th style={styles.th}>候选 selector</th>
            </tr>
          </thead>
          <tbody>
            {downloadCenterDiagnostic.selectorCandidates.slice(0, 20).map((candidate: any, index: number) => (
              <tr key={`${candidate.selector}-${index}`} style={styles.tr}>
                <td style={styles.td}>{candidate.role}</td>
                <td style={styles.td}>{candidate.text}</td>
                <td style={styles.td}>{candidate.tagName}</td>
                <td style={styles.td}>{candidate.unique ? '是' : `否 (${candidate.matchCount ?? '-'})`}</td>
                <td style={styles.td}><span style={styles.pathLine}>{candidate.selector}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {reportBatchResult?.files?.length > 0 && (
        <table style={{ ...styles.table, marginBottom: '16px' }}>
          <thead>
            <tr>
              <th style={styles.th}>报告</th>
              <th style={styles.th}>类型</th>
              <th style={styles.th}>状态</th>
              <th style={styles.th}>自动重试</th>
              <th style={styles.th}>文件</th>
              <th style={styles.th}>错误</th>
              <th style={styles.th}>失败证据</th>
              <th style={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {reportBatchResult.files.map((file: any) => (
              <tr key={file.id} style={styles.tr}>
                <td style={styles.td}>{file.displayName}</td>
                <td style={styles.td}>{file.reportType}</td>
                <td style={styles.td}>{file.status}</td>
                <td style={styles.td}>{file.autoRetryCount ?? 0}/{file.maxAutoRetries ?? 2}</td>
                <td style={styles.td}><span style={styles.pathLine}>{file.filePath || '-'}</span></td>
                <td style={styles.td}>{file.errorMessage || '-'}</td>
                <td style={styles.td}>
                  <div style={styles.buttonRow}>
                    {file.failureScreenshotPath && <button onClick={() => openReportPath(file.failureScreenshotPath)} style={styles.btnSmall}>截图</button>}
                    {file.failureDomSnapshotPath && <button onClick={() => openReportPath(file.failureDomSnapshotPath)} style={styles.btnSmall}>DOM</button>}
                    {file.failureTracePath && <button onClick={() => openReportPath(file.failureTracePath)} style={styles.btnSmall}>Trace</button>}
                  </div>
                  {!file.failureTracePath && file.traceUnavailableReason && (
                    <span style={styles.pathLine}>{file.traceUnavailableReason}</span>
                  )}
                </td>
                <td style={styles.td}>
                  {file.filePath && <button onClick={() => openReportPath(file.filePath)} style={styles.btnSmall}>打开</button>}
                  {file.status === 'failed' && <button onClick={() => retryReport(file)} style={styles.btnSmall}>重试</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {opportunities.length > 0 && (
        <table style={{ ...styles.table, marginBottom: '16px' }}>
          <thead>
            <tr>
              <th style={styles.th}>ASIN</th>
              <th style={styles.th}>关键词</th>
              <th style={styles.th}>等级</th>
              <th style={styles.th}>分数</th>
              <th style={styles.th}>证据</th>
              <th style={styles.th}>风险</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.slice(0, 20).map((item, index) => (
              <tr key={`${item.normalizedKeyword}-${index}`} style={styles.tr}>
                <td style={styles.td}>{item.asin || '-'}</td>
                <td style={styles.td}>{item.normalizedKeyword}</td>
                <td style={styles.td}>{item.opportunityLevel}</td>
                <td style={styles.td}>{Number(item.score || 0).toFixed(1)}</td>
                <td style={styles.td}>{item.evidence}</td>
                <td style={styles.td}>{item.riskFlags?.join(', ') || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {suggestions.length > 0 && (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>关键词</th>
              <th style={styles.th}>位置</th>
              <th style={styles.th}>建议文案</th>
              <th style={styles.th}>风险</th>
              <th style={styles.th}>状态</th>
              <th style={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((item, index) => (
              <tr key={`${item.keyword}-${index}`} style={styles.tr}>
                <td style={styles.td}>{item.keyword}</td>
                <td style={styles.td}>{item.section}</td>
                <td style={styles.td}>{item.suggestedText}</td>
                <td style={styles.td}>{item.riskWarnings?.join(', ') || '-'}</td>
                <td style={styles.td}>{item.status}</td>
                <td style={styles.td}>
                  <button onClick={() => updateSuggestionStatus(item, 'accepted')} style={styles.btnApprove}>采纳</button>
                  <button onClick={() => updateSuggestionStatus(item, 'ignored')} style={styles.btnReject}>忽略</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {drafts.length > 0 && (
        <table style={{ ...styles.table, marginTop: '16px' }}>
          <thead>
            <tr>
              <th style={styles.th}>位置</th>
              <th style={styles.th}>关键词</th>
              <th style={styles.th}>草案</th>
              <th style={styles.th}>来源</th>
              <th style={styles.th}>风险</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((item, index) => (
              <tr key={`${item.section}-${index}`} style={styles.tr}>
                <td style={styles.td}>{item.section}</td>
                <td style={styles.td}>{item.keywords?.join(', ')}</td>
                <td style={styles.td}>{item.draftedText}</td>
                <td style={styles.td}>{item.source}</td>
                <td style={styles.td}>{item.riskWarnings?.join(', ') || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
    { id: 'v15', label: 'v1.5 工作台' },
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
          <span style={styles.version}>v1.5.0</span>
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
          {activeTab === 'v15' && <V15Workspace />}
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
  panelGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '16px' },
  panel: { background: '#fff', border: '1px solid #eee', borderRadius: '6px', padding: '16px', minWidth: 0 },
  panelTitle: { fontSize: '15px', fontWeight: 700, margin: '0 0 12px', color: '#333' },
  inlineForm: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', alignItems: 'center', minWidth: 0 },
  stackedForm: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', alignItems: 'center', minWidth: 0 },
  listingGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))', gap: '10px', marginBottom: '12px' },
  textarea: { padding: '12px 16px', borderRadius: '4px', border: '1px solid #d9d9d9', fontSize: '14px', width: '100%', minHeight: '88px', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' },
  buttonRow: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
  summaryLine: { marginTop: '12px', color: '#666', fontSize: '13px' },
  pathLine: { wordBreak: 'break-all', fontFamily: 'Consolas, monospace', fontSize: '12px' },
  notice: { padding: '12px 16px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: '6px', marginBottom: '16px' },
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
  btnSmall: { padding: '4px 12px', background: '#f0f0f0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
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
