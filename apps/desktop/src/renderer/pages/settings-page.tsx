import React, { useEffect, useMemo, useState } from 'react';
import { aiCallEvidenceLabel, aiCallEvidenceTotal, aiCallKindLabel, aiCallOutputFormatLabel, buildAiCallDiagnostics } from '../ai-call-diagnostics';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import type { AiCallLogView, AiConnectionStatus, AiProviderSettings, SettingsRuleConfig, StoragePathsView } from '../types';
import { toUserFacingError } from '../user-facing-error';

const DEFAULT_AI_PERSONA = [
  '你是中文亚马逊广告运营顾问，擅长结合真实广告报表、产品阶段、成本结构和运营事件做量化分析。',
  '请用运营能直接理解的中文解释阈值、风险和建议；只输出结构化 JSON，不执行广告动作。',
].join('');

const DEFAULT_AI_SETTINGS: AiProviderSettings = {
  aiApiKey: '',
  aiBaseUrl: 'https://api.deepseek.com',
  aiModel: 'deepseek-v4-flash',
  aiTemperature: '0.3',
  aiMaxTokens: '8192',
  aiOutputLanguage: '简体中文',
  aiPersona: DEFAULT_AI_PERSONA,
  aiLastTestStatus: '',
  aiLastTestAt: '',
  aiLastTestBaseUrl: '',
  aiLastTestModel: '',
  aiLastTestMessage: '',
};

const DEFAULT_RULE_CONFIG: SettingsRuleConfig = {
  targetAcos: 0.25,
  highAcosThreshold: 0.4,
  noOrderClickThreshold: 30,
  minSpend: 10,
  bidAdjustPercent: 0.1,
  maxBidDecrement: 0.2,
  brandWordWhitelist: [],
  coreWordWhitelist: [],
  maxCpc: 5,
  minCpc: 0.02,
  enableAutoLowerBid: false,
  enableAutoAddNegative: false,
};

const SAFETY_POLICIES = [
  '不允许无边界批量写入广告账户。',
  '任意真实写入前必须有人工审批。',
  '每次执行必须保留 before / after / readback 证据。',
  '执行对象必须与店铺、站点、campaign、ad group、ASIN 和投放对象范围完全匹配。',
];

const DIAGNOSTIC_CHECKS = [
  'AI 连接：确认 Provider、Base URL、模型和脱敏 Key 状态。',
  '广告建议解释：确认建议来自当前范围真实广告指标，并标记 AI 或规则来源。',
  'Listing 草案：确认 Listing 读取、关键词机会和草案来源，不自动提交 Amazon。',
  '最终交付：确认真实报表、量化、AI、审批、readback 和安装包证据是否闭环。',
];

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function listToText(value: string[]): string {
  return value.join(', ');
}

function parseListInput(value: string): string[] {
  return Array.from(new Set(normalizeList(value)));
}

export function aiAuditIntroText(): string {
  return '只显示最近调用的模型、标准 JSON 输出格式、证据包规模和成败状态；不保存 API Key，也不展示完整提示词。';
}

export function aiAuditPurposeText(): string {
  return '用于排查 AI 是否成功返回标准 JSON、是否带输出格式版本、是否带证据包摘要。';
}

export function aiAuditLogFormatLine(log: Pick<AiCallLogView, 'schemaVersion' | 'promptVersion'>): string {
  return `输出格式 ${aiCallOutputFormatLabel(log)}`;
}

export function aiAuditLogTitle(log: Pick<AiCallLogView, 'promptKey'>): string {
  return aiCallKindLabel(log);
}

function normalizeAiSettings(settings: Record<string, unknown> | null | undefined): AiProviderSettings {
  return {
    aiApiKey: readString(settings?.aiApiKey ?? settings?.ai_api_key, DEFAULT_AI_SETTINGS.aiApiKey),
    aiKeyConfigured: readBoolean(settings?.aiKeyConfigured ?? settings?.ai_key_configured, false),
    aiBaseUrl: readString(settings?.aiBaseUrl ?? settings?.ai_base_url, DEFAULT_AI_SETTINGS.aiBaseUrl),
    aiModel: readString(settings?.aiModel ?? settings?.ai_model, DEFAULT_AI_SETTINGS.aiModel),
    aiTemperature: readString(settings?.aiTemperature ?? settings?.ai_temperature, DEFAULT_AI_SETTINGS.aiTemperature),
    aiMaxTokens: readString(settings?.aiMaxTokens ?? settings?.ai_max_tokens, DEFAULT_AI_SETTINGS.aiMaxTokens),
    aiOutputLanguage: readString(settings?.aiOutputLanguage ?? settings?.ai_output_language, DEFAULT_AI_SETTINGS.aiOutputLanguage),
    aiPersona: readString(settings?.aiPersona ?? settings?.ai_persona, DEFAULT_AI_SETTINGS.aiPersona),
    aiLastTestStatus: readString(settings?.aiLastTestStatus ?? settings?.ai_last_test_status, DEFAULT_AI_SETTINGS.aiLastTestStatus) as AiProviderSettings['aiLastTestStatus'],
    aiLastTestAt: readString(settings?.aiLastTestAt ?? settings?.ai_last_test_at, DEFAULT_AI_SETTINGS.aiLastTestAt),
    aiLastTestBaseUrl: readString(settings?.aiLastTestBaseUrl ?? settings?.ai_last_test_base_url, DEFAULT_AI_SETTINGS.aiLastTestBaseUrl),
    aiLastTestModel: readString(settings?.aiLastTestModel ?? settings?.ai_last_test_model, DEFAULT_AI_SETTINGS.aiLastTestModel),
    aiLastTestMessage: readString(settings?.aiLastTestMessage ?? settings?.ai_last_test_message, DEFAULT_AI_SETTINGS.aiLastTestMessage),
  };
}

function testedStatusForSettings(settings: AiProviderSettings): AiConnectionStatus {
  const normalizeBaseUrl = (value: unknown) => String(value || '').trim().replace(/\/+$/, '');
  const baseMatches = normalizeBaseUrl(settings.aiLastTestBaseUrl) === normalizeBaseUrl(settings.aiBaseUrl);
  const modelMatches = settings.aiLastTestModel === settings.aiModel;
  if (!settings.aiKeyConfigured && !settings.aiApiKey.trim()) return 'unconfigured';
  if (baseMatches && modelMatches && settings.aiLastTestStatus === 'available') return 'available';
  if (baseMatches && modelMatches && settings.aiLastTestStatus === 'failed') return 'failed';
  return 'pending_test';
}

function normalizeRuleConfig(config: Record<string, unknown> | null | undefined): SettingsRuleConfig {
  return {
    targetAcos: readNumber(config?.targetAcos, DEFAULT_RULE_CONFIG.targetAcos),
    highAcosThreshold: readNumber(config?.highAcosThreshold, DEFAULT_RULE_CONFIG.highAcosThreshold),
    noOrderClickThreshold: readNumber(config?.noOrderClickThreshold, DEFAULT_RULE_CONFIG.noOrderClickThreshold),
    minSpend: readNumber(config?.minSpend ?? config?.minimumSpend, DEFAULT_RULE_CONFIG.minSpend),
    bidAdjustPercent: readNumber(config?.bidAdjustPercent ?? config?.lowerBidPercent, DEFAULT_RULE_CONFIG.bidAdjustPercent),
    maxBidDecrement: readNumber(config?.maxBidDecrement ?? config?.maxLowerBidPercent, DEFAULT_RULE_CONFIG.maxBidDecrement),
    brandWordWhitelist: normalizeList(config?.brandWordWhitelist ?? config?.brandWhitelist),
    coreWordWhitelist: normalizeList(config?.coreWordWhitelist ?? config?.coreWhitelist),
    maxCpc: readNumber(config?.maxCpc, DEFAULT_RULE_CONFIG.maxCpc ?? 5),
    minCpc: readNumber(config?.minCpc, DEFAULT_RULE_CONFIG.minCpc ?? 0.02),
    enableAutoLowerBid: readBoolean(config?.enableAutoLowerBid, DEFAULT_RULE_CONFIG.enableAutoLowerBid ?? false),
    enableAutoAddNegative: readBoolean(config?.enableAutoAddNegative, DEFAULT_RULE_CONFIG.enableAutoAddNegative ?? false),
  };
}

function statusLabel(status: AiConnectionStatus): string {
  const labels: Record<AiConnectionStatus, string> = {
    unconfigured: '未配置',
    pending_test: '待测试',
    testing: '测试中',
    available: 'AI 可用',
    failed: 'AI 不可用',
  };
  return labels[status];
}

function statusTone(status: AiConnectionStatus): 'ready' | 'pending' | 'blocked' | 'warning' {
  if (status === 'available') return 'ready';
  if (status === 'testing' || status === 'pending_test') return 'pending';
  if (status === 'failed') return 'blocked';
  return 'warning';
}

function displayAiStatusLabel(status: AiConnectionStatus, keyPresent: boolean): string {
  if (status === 'pending_test' && keyPresent) return '待测试';
  return statusLabel(status);
}

function displayAiStatusTone(status: AiConnectionStatus, keyPresent: boolean): 'ready' | 'pending' | 'blocked' | 'warning' {
  if (status === 'pending_test' && keyPresent) return 'pending';
  return statusTone(status);
}

function percentLabel(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function validateRuleConfigForSave(config: SettingsRuleConfig): string[] {
  const errors: string[] = [];
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  if (!finite(config.targetAcos) || config.targetAcos <= 0) errors.push('目标 ACOS 必须大于 0');
  if (!finite(config.highAcosThreshold) || config.highAcosThreshold <= 0) errors.push('高 ACOS 阈值必须大于 0');
  if (finite(config.targetAcos) && finite(config.highAcosThreshold) && config.highAcosThreshold < config.targetAcos) {
    errors.push('高 ACOS 阈值不能低于目标 ACOS');
  }
  if (!finite(config.noOrderClickThreshold) || config.noOrderClickThreshold < 1) errors.push('无订单点击阈值必须至少为 1');
  if (!finite(config.minSpend) || config.minSpend < 0) errors.push('最低花费不能为负数');
  if (!finite(config.bidAdjustPercent) || config.bidAdjustPercent <= 0 || config.bidAdjustPercent > 1) {
    errors.push('降价比例必须在 0 到 1 之间');
  }
  if (!finite(config.maxBidDecrement) || config.maxBidDecrement <= 0 || config.maxBidDecrement > 1) {
    errors.push('最大降价比例必须在 0 到 1 之间');
  }
  if (finite(config.bidAdjustPercent) && finite(config.maxBidDecrement) && config.maxBidDecrement < config.bidAdjustPercent) {
    errors.push('最大降价比例不能低于单次降价比例');
  }
  if (config.minCpc !== undefined && (!finite(config.minCpc) || config.minCpc < 0)) errors.push('最低 CPC 不能为负数');
  if (config.maxCpc !== undefined && (!finite(config.maxCpc) || config.maxCpc <= 0)) errors.push('最高 CPC 必须大于 0');
  if (finite(config.minCpc) && finite(config.maxCpc) && Number(config.minCpc) > Number(config.maxCpc)) {
    errors.push('最低 CPC 不能高于最高 CPC');
  }
  return errors;
}

function clearAiTestState(settings: AiProviderSettings): AiProviderSettings {
  return {
    ...settings,
    aiLastTestStatus: '',
    aiLastTestAt: '',
    aiLastTestBaseUrl: '',
    aiLastTestModel: '',
    aiLastTestMessage: '',
  };
}

type AiSettingsField = keyof AiProviderSettings;

export function shouldResetAiTestForSettingsField(field: AiSettingsField): boolean {
  return field === 'aiApiKey' || field === 'aiBaseUrl' || field === 'aiModel';
}

function updateAiSettingsField(
  settings: AiProviderSettings,
  field: AiSettingsField,
  value: string | boolean,
): AiProviderSettings {
  const next = { ...settings, [field]: value } as AiProviderSettings;
  return shouldResetAiTestForSettingsField(field) ? clearAiTestState(next) : next;
}

function api(): Record<string, any> {
  return ((window as any).electronAPI || {}) as Record<string, any>;
}

export function SettingsPage() {
  const [aiSettings, setAiSettings] = useState<AiProviderSettings>(DEFAULT_AI_SETTINGS);
  const [ruleConfig, setRuleConfig] = useState<SettingsRuleConfig>(DEFAULT_RULE_CONFIG);
  const [aiStatus, setAiStatus] = useState<AiConnectionStatus>('unconfigured');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingAi, setSavingAi] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const [storagePaths, setStoragePaths] = useState<StoragePathsView>({});
  const [aiCallLogs, setAiCallLogs] = useState<AiCallLogView[]>([]);

  const apiSurface = useMemo(() => api(), []);
  const canLoadSettings = typeof apiSurface.getSettings === 'function';
  const canSaveSettings = typeof apiSurface.saveSettings === 'function';
  const canTestAi = typeof apiSurface.testAiSettings === 'function';
  const canLoadRules = typeof apiSurface.getRuleConfig === 'function';
  const canSaveRules = typeof apiSurface.saveRuleConfig === 'function';
  const canLoadStoragePaths = typeof apiSurface.getStoragePaths === 'function';
  const canLoadAiCallLogs = typeof apiSurface.listAiCallLogs === 'function';
  const keyPresent = Boolean(aiSettings.aiApiKey.trim() || aiSettings.aiKeyConfigured);

  async function refreshAiSettingsFromStore(): Promise<AiProviderSettings | null> {
    if (!canLoadSettings) return null;
    const settings = await apiSurface.getSettings();
    const next = normalizeAiSettings(settings);
    setAiSettings(next);
    setAiStatus(testedStatusForSettings(next));
    return next;
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      const notes: string[] = [];
      try {
        if (canLoadSettings) {
          const settings = await apiSurface.getSettings();
          if (mounted) {
            const next = normalizeAiSettings(settings);
            setAiSettings(next);
            setAiStatus(testedStatusForSettings(next));
          }
        } else {
          notes.push('getSettings 未接入，AI 设置使用页面默认值。');
        }
        if (canLoadRules) {
          const rules = await apiSurface.getRuleConfig();
          if (mounted) setRuleConfig(normalizeRuleConfig(rules));
        } else {
          notes.push('getRuleConfig 未接入，阈值使用页面默认值。');
        }
        if (canLoadStoragePaths) {
          const paths = await apiSurface.getStoragePaths();
          if (mounted) setStoragePaths(paths || {});
        } else {
          notes.push('getStoragePaths 未接入，路径显示为不可用。');
        }
        if (canLoadAiCallLogs) {
          const logs = await apiSurface.listAiCallLogs({ limit: 5 });
          if (mounted) setAiCallLogs(Array.isArray(logs) ? logs : []);
        }
      } catch (caught) {
        notes.push(toUserFacingError(caught, '读取设置失败。'));
      } finally {
        if (mounted) {
          setMessage(notes.join(' '));
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [apiSurface, canLoadAiCallLogs, canLoadRules, canLoadSettings, canLoadStoragePaths]);

  useEffect(() => {
    if (!keyPresent && aiStatus !== 'unconfigured') setAiStatus('unconfigured');
    if (keyPresent && aiStatus === 'unconfigured') setAiStatus('pending_test');
  }, [aiStatus, keyPresent]);

  const aiStatusItems = useMemo(
    () => [
      { label: 'Base URL', value: aiSettings.aiBaseUrl || '未配置' },
      { label: 'Model', value: aiSettings.aiModel || '未配置' },
      { label: 'API Key', value: keyPresent ? '已配置（已隐藏）' : '未配置' },
      { label: 'Status', value: aiStatus === 'pending_test' ? '已配置，待测试' : statusLabel(aiStatus) },
      { label: '输出语言', value: aiSettings.aiOutputLanguage || DEFAULT_AI_SETTINGS.aiOutputLanguage || '简体中文' },
      { label: '最近测试', value: aiSettings.aiLastTestAt ? `${aiSettings.aiLastTestStatus === 'available' ? '通过' : '失败'} / ${aiSettings.aiLastTestMessage || aiSettings.aiLastTestAt}` : '暂无记录' },
    ],
    [aiSettings.aiBaseUrl, aiSettings.aiLastTestAt, aiSettings.aiLastTestMessage, aiSettings.aiLastTestStatus, aiSettings.aiModel, aiSettings.aiOutputLanguage, aiStatus, keyPresent],
  );
  const aiCallDiagnostics = useMemo(
    () => buildAiCallDiagnostics(aiCallLogs),
    [aiCallLogs],
  );

  async function saveAiSettings() {
    if (!canSaveSettings) {
      setMessage('saveSettings 未接入，当前环境只能编辑页面表单。');
      return;
    }
    setSavingAi(true);
    setMessage('');
    try {
      await apiSurface.saveSettings(aiSettings);
      const refreshed = await refreshAiSettingsFromStore();
      if (!refreshed) {
        const nextSettings = { ...aiSettings, aiApiKey: '', aiKeyConfigured: true };
        setAiSettings(nextSettings);
        setAiStatus(testedStatusForSettings(nextSettings));
      }
      setMessage('AI 设置已保存。API Key 仅显示为已配置状态，不在页面展示明文。');
    } catch (caught) {
      setMessage(`AI 设置保存失败：${toUserFacingError(caught, 'AI 设置保存失败。')}`);
    } finally {
      setSavingAi(false);
    }
  }

  async function testAiSettings() {
    if (!canTestAi) {
      setMessage('testAiSettings 未接入，无法在当前环境发起连接测试。');
      return;
    }
    if (!keyPresent) {
      setAiStatus('unconfigured');
      setMessage('请先填写 API Key，再测试连接。');
      return;
    }
    setAiStatus('testing');
    setMessage('正在测试 AI 连接...');
    try {
      const result = await apiSurface.testAiSettings(aiSettings);
      const success = Boolean(result?.success);
      const resultMessage = readString(result?.message, success ? 'AI 连接可用。' : 'AI 连接失败。');
      const refreshed = await refreshAiSettingsFromStore();
      if (!refreshed) {
        setAiStatus(success ? 'available' : 'failed');
        setAiSettings((current) => ({
          ...current,
          aiLastTestStatus: success ? 'available' : 'failed',
          aiLastTestAt: new Date().toISOString(),
          aiLastTestBaseUrl: current.aiBaseUrl,
          aiLastTestModel: current.aiModel,
          aiLastTestMessage: resultMessage,
        }));
      }
      setMessage(resultMessage);
    } catch (caught) {
      setAiStatus('failed');
      setMessage(`AI 连接测试失败：${toUserFacingError(caught, 'AI 连接测试失败。')}`);
    }
  }

  async function clearLocalAiKey() {
    if (!canSaveSettings) {
      setMessage('saveSettings 未接入，无法清除本地 AI Key。');
      return;
    }
    setSavingAi(true);
    setMessage('');
    try {
      await apiSurface.saveSettings({
        ...aiSettings,
        aiApiKey: '',
        ai_key: '',
        clearAiKey: true,
        aiLastTestStatus: '',
        aiLastTestAt: '',
        aiLastTestBaseUrl: '',
        aiLastTestModel: '',
        aiLastTestMessage: '',
      });
      const refreshed = await refreshAiSettingsFromStore();
      if (!refreshed) {
        setAiSettings({
          ...aiSettings,
          aiApiKey: '',
          aiKeyConfigured: false,
          aiLastTestStatus: '',
          aiLastTestAt: '',
          aiLastTestBaseUrl: '',
          aiLastTestModel: '',
          aiLastTestMessage: '',
        });
        setAiStatus('unconfigured');
      }
      setMessage('AI Key 已清除。需要重新填写并测试后，AI 才会参与建议生成。');
    } catch (caught) {
      setMessage(`AI Key 清除失败：${toUserFacingError(caught, 'AI Key 清除失败。')}`);
    } finally {
      setSavingAi(false);
    }
  }

  async function saveRuleConfig() {
    if (!canSaveRules) {
      setMessage('saveRuleConfig 未接入，当前环境只能编辑页面表单。');
      return;
    }
    const validationErrors = validateRuleConfigForSave(ruleConfig);
    if (validationErrors.length > 0) {
      setMessage(`阈值保存已阻断：${validationErrors.join('；')}。`);
      return;
    }
    setSavingRules(true);
    setMessage('');
    try {
      await apiSurface.saveRuleConfig(ruleConfig);
      setMessage('广告量化阈值已保存。');
    } catch (caught) {
      setMessage(`阈值保存失败：${toUserFacingError(caught, '阈值保存失败。')}`);
    } finally {
      setSavingRules(false);
    }
  }

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(DIAGNOSTIC_CHECKS.join('\n'));
      setCopyNotice('诊断检查清单已复制。');
    } catch (caught) {
      setCopyNotice(`复制失败：${toUserFacingError(caught, '复制失败。')}`);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="系统与交付"
        title="设置"
        description="集中配置 AI Provider、广告量化阈值、安全策略、本地存储和诊断入口。页面只展示脱敏状态，不展示完整 API Key。"
        primaryTask="配置 AI 与规则阈值"
        nextAction={keyPresent ? '测试 AI 连接' : '填写 API Key'}
      />

      <div className="business-stack">
        <Panel title="DeepSeek / OpenAI Compatible">
          <div className="settings-section-header">
            <StatusPill tone={displayAiStatusTone(aiStatus, keyPresent)}>{displayAiStatusLabel(aiStatus, keyPresent)}</StatusPill>
            {loading && <span className="muted-line">正在读取设置...</span>}
          </div>
          <div className="settings-status-grid">
            {aiStatusItems.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <div className="settings-form-grid">
            <label>
              API Key
              <input
                autoComplete="off"
                placeholder="DeepSeek 或 OpenAI Compatible API Key"
                type="password"
                value={aiSettings.aiApiKey}
                onChange={(event) => {
                  const nextKey = event.target.value;
                  setAiSettings(updateAiSettingsField(aiSettings, 'aiApiKey', nextKey));
                  setAiStatus(nextKey.trim() || aiSettings.aiKeyConfigured ? 'pending_test' : 'unconfigured');
                }}
              />
            </label>
            <label>
              Base URL
              <input
                value={aiSettings.aiBaseUrl}
                onChange={(event) => {
                  setAiSettings(updateAiSettingsField(aiSettings, 'aiBaseUrl', event.target.value));
                  setAiStatus(keyPresent ? 'pending_test' : 'unconfigured');
                }}
                placeholder="https://api.deepseek.com"
              />
            </label>
            <label>
              Model
              <input
                value={aiSettings.aiModel}
                onChange={(event) => {
                  setAiSettings(updateAiSettingsField(aiSettings, 'aiModel', event.target.value));
                  setAiStatus(keyPresent ? 'pending_test' : 'unconfigured');
                }}
                placeholder="deepseek-v4-flash"
              />
            </label>
            <label>
              Temperature
              <input
                type="number"
                step="0.1"
                value={aiSettings.aiTemperature}
                onChange={(event) => setAiSettings(updateAiSettingsField(aiSettings, 'aiTemperature', event.target.value))}
              />
            </label>
            <label>
              Max Tokens
              <input
                type="number"
                value={aiSettings.aiMaxTokens}
                onChange={(event) => setAiSettings(updateAiSettingsField(aiSettings, 'aiMaxTokens', event.target.value))}
              />
            </label>
            <label>
              输出语言
              <input
                value={aiSettings.aiOutputLanguage || ''}
                onChange={(event) => setAiSettings(updateAiSettingsField(aiSettings, 'aiOutputLanguage', event.target.value))}
                placeholder="简体中文"
              />
            </label>
            <label className="form-grid-wide">
              <span>AI 人设与输出约束</span>
              <textarea
                aria-label="AI 人设与输出约束"
                value={aiSettings.aiPersona || ''}
                onChange={(event) => setAiSettings(updateAiSettingsField(aiSettings, 'aiPersona', event.target.value))}
                placeholder={DEFAULT_AI_PERSONA}
              />
            </label>
          </div>
          <p className="muted-line">广告诊断、广告建议解释和 Listing 草案都会要求 AI 返回标准 JSON；界面只渲染可控字段，不直接执行广告动作。</p>
          <div className="action-row">
            <button className="primary-button" disabled={savingAi || !canSaveSettings} onClick={saveAiSettings} type="button">
              {savingAi ? '保存中...' : '保存 AI 设置'}
            </button>
            <button className="secondary-button" disabled={aiStatus === 'testing' || !canTestAi} onClick={testAiSettings} type="button">
              {aiStatus === 'testing' ? '测试中...' : '测试 AI 连接'}
            </button>
            <button className="secondary-button" disabled={savingAi || !canSaveSettings || !keyPresent} onClick={clearLocalAiKey} type="button">
              清除本地 AI Key
            </button>
          </div>
        </Panel>

        <Panel title="AI 调用审计">
          <p className="muted-line">{aiAuditIntroText()}</p>
          <div className="context-summary-grid">
            <div>
              <span>最近 AI 是否参与</span>
              <strong>{aiCallDiagnostics.headline}</strong>
              <p>{aiCallDiagnostics.detail}</p>
              <StatusPill tone={aiCallDiagnostics.status === 'ready' ? 'ready' : aiCallDiagnostics.status === 'blocked' ? 'blocked' : 'warning'}>
                {aiCallDiagnostics.nextAction}
              </StatusPill>
            </div>
            <div>
              <span>日志数量</span>
              <strong>{aiCallLogs.length} 条</strong>
              <p>{aiAuditPurposeText()}</p>
              <StatusPill tone={canLoadAiCallLogs ? 'ready' : 'blocked'}>{canLoadAiCallLogs ? '接口可用' : '接口缺失'}</StatusPill>
            </div>
          </div>
          {!canLoadAiCallLogs && <p className="warning-line">当前环境未暴露 AI 调用审计接口。</p>}
          {canLoadAiCallLogs && aiCallLogs.length === 0 && <p className="muted-line">暂无 AI 调用记录。</p>}
          {aiCallLogs.length > 0 && (
            <div className="context-summary-grid">
              {aiCallLogs.map((log) => (
                <div key={log.id}>
                  <span>{aiAuditLogTitle(log)}</span>
                  <strong>{log.model}</strong>
                  <p className="muted-line">{log.createdAt}</p>
                  <p className="muted-line">{aiAuditLogFormatLine(log)}</p>
                  <div className="business-pill-row">
                    <StatusPill tone={log.success ? 'ready' : 'blocked'}>{log.success ? '成功' : '失败'}</StatusPill>
                    <StatusPill tone={aiCallEvidenceTotal(log) ? 'ready' : 'warning'}>{aiCallEvidenceLabel(log)}</StatusPill>
                  </div>
                  {log.errorMessage && <p className="warning-line">{log.errorMessage}</p>}
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="广告量化阈值">
          <div className="settings-rule-summary">
            <div>
              <span>目标利润线</span>
              <strong>目标 ACOS {percentLabel(ruleConfig.targetAcos)}</strong>
              <p>低于目标线的词和投放对象优先保留、观察或扩量复核。</p>
            </div>
            <div>
              <span>风险线</span>
              <strong>高 ACOS {percentLabel(ruleConfig.highAcosThreshold)}</strong>
              <p>超过风险线且花费达到最低门槛时，进入降价或否词建议。</p>
            </div>
            <div>
              <span>无订单浪费</span>
              <strong>{ruleConfig.noOrderClickThreshold} 点击 / {ruleConfig.minSpend} USD</strong>
              <p>达到点击或花费门槛仍无订单时，标记为浪费风险。</p>
            </div>
            <div>
              <span>动作边界</span>
              <strong>每次降价 {percentLabel(ruleConfig.bidAdjustPercent)}</strong>
              <p>单次建议不超过 {percentLabel(ruleConfig.maxBidDecrement)}，且受 CPC 下限保护。</p>
            </div>
          </div>
          <div className="settings-form-grid">
            <label>
              目标 ACOS
              <input
                type="number"
                step="0.01"
                value={ruleConfig.targetAcos}
                onChange={(event) => setRuleConfig({ ...ruleConfig, targetAcos: Number(event.target.value) })}
              />
            </label>
            <label>
              高 ACOS 阈值
              <input
                type="number"
                step="0.01"
                value={ruleConfig.highAcosThreshold}
                onChange={(event) => setRuleConfig({ ...ruleConfig, highAcosThreshold: Number(event.target.value) })}
              />
            </label>
            <label>
              无订单点击阈值
              <input
                type="number"
                value={ruleConfig.noOrderClickThreshold}
                onChange={(event) => setRuleConfig({ ...ruleConfig, noOrderClickThreshold: Number(event.target.value) })}
              />
            </label>
            <label>
              最低花费
              <input
                type="number"
                step="0.01"
                value={ruleConfig.minSpend}
                onChange={(event) => setRuleConfig({ ...ruleConfig, minSpend: Number(event.target.value) })}
              />
            </label>
            <label>
              降价比例
              <input
                type="number"
                step="0.01"
                value={ruleConfig.bidAdjustPercent}
                onChange={(event) => setRuleConfig({ ...ruleConfig, bidAdjustPercent: Number(event.target.value) })}
              />
            </label>
            <label>
              最大降价比例
              <input
                type="number"
                step="0.01"
                value={ruleConfig.maxBidDecrement}
                onChange={(event) => setRuleConfig({ ...ruleConfig, maxBidDecrement: Number(event.target.value) })}
              />
            </label>
            <label>
              最高 CPC
              <input
                type="number"
                step="0.01"
                value={ruleConfig.maxCpc}
                onChange={(event) => setRuleConfig({ ...ruleConfig, maxCpc: Number(event.target.value) })}
              />
            </label>
            <label>
              最低 CPC
              <input
                type="number"
                step="0.01"
                value={ruleConfig.minCpc}
                onChange={(event) => setRuleConfig({ ...ruleConfig, minCpc: Number(event.target.value) })}
              />
            </label>
            <label className="settings-toggle-card">
              <input
                checked={ruleConfig.enableAutoLowerBid}
                type="checkbox"
                onChange={(event) => setRuleConfig({ ...ruleConfig, enableAutoLowerBid: event.target.checked })}
              />
              <span>
                自动生成降价建议
                <small>只生成建议，不自动写入 Ads；执行仍走审批和回读。</small>
              </span>
            </label>
            <label className="settings-toggle-card">
              <input
                checked={ruleConfig.enableAutoAddNegative}
                type="checkbox"
                onChange={(event) => setRuleConfig({ ...ruleConfig, enableAutoAddNegative: event.target.checked })}
              />
              <span>
                自动生成否词建议
                <small>只进入建议池，白名单词会阻断。</small>
              </span>
            </label>
            <label className="form-grid-wide">
              <span>品牌词白名单</span>
              <textarea
                aria-label="品牌词白名单"
                value={listToText(ruleConfig.brandWordWhitelist)}
                onChange={(event) => {
                  setRuleConfig({ ...ruleConfig, brandWordWhitelist: parseListInput(event.target.value) });
                }}
                placeholder="品牌词，用逗号或换行分隔"
              />
            </label>
            <label className="form-grid-wide">
              <span>核心词白名单</span>
              <textarea
                aria-label="核心词白名单"
                value={listToText(ruleConfig.coreWordWhitelist)}
                onChange={(event) => {
                  setRuleConfig({ ...ruleConfig, coreWordWhitelist: parseListInput(event.target.value) });
                }}
                placeholder="核心业务词，用逗号或换行分隔"
              />
            </label>
          </div>
          <div className="action-row">
            <button className="primary-button" disabled={savingRules || !canSaveRules} onClick={saveRuleConfig} type="button">
              {savingRules ? '保存中...' : '保存阈值'}
            </button>
          </div>
        </Panel>

        <div className="business-grid">
          <Panel title="安全策略" tone="warning">
            <ul className="business-list">
              {SAFETY_POLICIES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Panel>

          <Panel title="本地存储路径">
            <dl className="business-definition-list">
              <div>
                <dt>设置路径</dt>
                <dd>{storagePaths.settingsPath || '不可用：getStoragePaths 未返回 settingsPath'}</dd>
              </div>
              <div>
                <dt>证据目录</dt>
                <dd>{storagePaths.evidenceDir || '不可用：getStoragePaths 未返回 evidenceDir'}</dd>
              </div>
              <div>
                <dt>下载目录</dt>
                <dd>{storagePaths.downloadsDir || '不可用：getStoragePaths 未返回 downloadsDir'}</dd>
              </div>
              <div>
                <dt>导出目录</dt>
                <dd>{storagePaths.exportsDir || '不可用：getStoragePaths 未返回 exportsDir'}</dd>
              </div>
              <div>
                <dt>交付包目录</dt>
                <dd>{storagePaths.deliveryDir || '不可用：getStoragePaths 未返回 deliveryDir'}</dd>
              </div>
              <div>
                <dt>本地数据库</dt>
                <dd>{storagePaths.localDbPath || '不可用：getStoragePaths 未返回 localDbPath'}</dd>
              </div>
            </dl>
          </Panel>
        </div>

        <Panel title="诊断工具">
          <div className="settings-diagnostic-row">
            <p>用于验证 AI 连接、广告解释、Listing 草案和最终交付状态；不会改变广告账户，也不会绕过审批、before / after / readback 或范围匹配要求。</p>
            <button className="secondary-button" onClick={copyDiagnostics} type="button">复制诊断检查清单</button>
          </div>
          <details className="details-panel inline-details">
            <summary>查看诊断覆盖项</summary>
            <div className="details-content">
              <ul className="business-list">
                {DIAGNOSTIC_CHECKS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </details>
          {copyNotice && <p className="muted-line">{copyNotice}</p>}
        </Panel>

        {message && <Panel title="状态">{message}</Panel>}
      </div>
    </div>
  );
}
