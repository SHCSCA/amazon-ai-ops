import React, { useEffect, useMemo, useState } from 'react';
import { aiCallEvidenceLabel, aiCallEvidenceTotal, aiCallKindLabel, aiCallOutputFormatLabel, buildAiCallDiagnostics } from '../ai-call-diagnostics';
import { aiContractPrimaryCopy, aiOutputContracts, aiOutputContractTags } from '../ai-output-contracts';
import { OperatorTaskPanel } from '../components/operator-task-panel';
import { ProgressiveDetails } from '../components/progressive-details';
import { TagMetricGroup, type TagMetricItem } from '../components/tag-metric-group';
import { FormTable, FormTableRow, PageHeader, Panel, StatusPill } from '../components/ui';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import type { AiCallLogView, AiConnectionStatus, AiProviderSettings, SettingsRuleConfig, StoragePathsView } from '../types';
import { toUserFacingError } from '../user-facing-error';

const DEFAULT_AI_PERSONA = [
  '你是中文亚马逊广告运营顾问，擅长结合真实广告报表、产品阶段、成本结构和运营事件做量化分析。',
  '请用运营能直接理解的中文解释阈值、风险和建议；字段结构由系统固定输出合同约束，人设只影响表达风格，不执行广告动作。',
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
const STRUCTURED_AI_OUTPUT_TOKEN_FLOOR = 8192;

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
  '每次执行必须保留执行前、执行后和回读证据。',
  '执行对象必须与店铺、站点、广告活动、广告组、ASIN 和投放对象范围完全匹配。',
];

const DIAGNOSTIC_CHECKS = [
  'AI 连接：确认 Provider、Base URL、模型和脱敏 Key 状态。',
  '广告建议解释：确认建议来自当前范围真实广告指标，并标记 AI 或规则来源。',
  'Listing 草案：确认 Listing 读取、关键词机会和草案来源，不自动提交 Amazon。',
  '最终交付：确认真实报表、量化、AI、审批、回读和安装包证据是否闭环。',
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
  return '只显示最近调用的模型、固定输出格式、证据包规模和成败状态；不保存 API Key，也不展示完整提示词。';
}

export function aiAuditPurposeText(): string {
  return '用于排查 AI 是否成功返回固定字段、是否带输出格式版本、是否带证据包摘要。';
}

export function aiAuditLogFormatLine(log: Pick<AiCallLogView, 'schemaVersion' | 'promptVersion'>): string {
  return `输出格式 ${aiCallOutputFormatLabel(log)}`;
}

export function aiAuditLogTitle(log: Pick<AiCallLogView, 'promptKey'>): string {
  return aiCallKindLabel(log);
}

export function aiSettingsActionHint(input: { canSaveSettings: boolean; keyPresent: boolean; canTestAi: boolean }): string {
  if (!input.canSaveSettings) return '当前环境未接入设置保存接口，无法保存或清除 API Key。';
  if (!input.keyPresent) return '填写 API Key 后才能测试连接。';
  if (!input.canTestAi) return '当前环境未接入 AI 连接测试接口。';
  return '';
}

export function settingsAiContractPrimaryCopy(): string {
  return aiContractPrimaryCopy();
}

export function settingsAiContractTags(): TagMetricItem[] {
  return aiOutputContractTags().map((tag) => ({
    label: tag.label,
    detail: tag.detail,
    tone: tag.tone,
  }));
}

export function settingsAiContractVersionItems(): TagMetricItem[] {
  return aiOutputContracts.map((contract) => ({
    label: `${contract.label} v1`,
    value: '系统固定',
    detail: `${contract.usedBy}：${contract.consumedAs}`,
    tone: 'neutral',
  }));
}

function clampStructuredAiMaxTokens(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(STRUCTURED_AI_OUTPUT_TOKEN_FLOOR);
  return String(Math.max(STRUCTURED_AI_OUTPUT_TOKEN_FLOOR, Math.trunc(parsed)));
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

export function settingsPrimaryAiStatusItems(
  settings: Pick<AiProviderSettings, 'aiBaseUrl' | 'aiModel'>,
  status: AiConnectionStatus,
  keyPresent: boolean,
) {
  return [
    { label: 'API Key', value: keyPresent ? '已配置（已隐藏）' : '未配置' },
    { label: 'Base URL', value: settings.aiBaseUrl || '未配置' },
    { label: 'Model', value: settings.aiModel || '未配置' },
    { label: '连接状态', value: status === 'pending_test' ? '已配置，待测试' : statusLabel(status) },
  ];
}

export function settingsAiTaskTitle(input: { status: AiConnectionStatus; keyPresent: boolean }): string {
  if (!input.keyPresent || input.status === 'unconfigured') return '先填写 API Key 并保存';
  if (input.status === 'testing') return '正在测试当前 AI 连接';
  if (input.status === 'available') return 'AI 连接已可用';
  if (input.status === 'failed') return 'AI 连接需要处理';
  return '测试当前 AI 连接';
}

export function settingsAiConnectionFeedback(input: {
  status: AiConnectionStatus;
  keyPresent: boolean;
  saving: boolean;
  message?: string;
}): { label: string; detail: string; tone: 'ready' | 'pending' | 'blocked' | 'warning' } {
  const message = String(input.message || '').trim();
  if (input.saving) {
    return {
      label: '正在保存 AI 设置',
      detail: 'API Key 会交给主进程本地安全存储，页面不会回显明文。',
      tone: 'pending',
    };
  }
  if (/^AI 设置保存失败|^AI Key 清除失败/.test(message)) {
    return {
      label: 'AI 设置处理失败',
      detail: message,
      tone: 'blocked',
    };
  }
  if (/^AI 设置已保存|^AI Key 已清除/.test(message)) {
    return {
      label: '设置保存完成',
      detail: message,
      tone: 'ready',
    };
  }
  if (!input.keyPresent || input.status === 'unconfigured') {
    return {
      label: '等待 API Key',
      detail: '填写并保存 Key 后，再测试当前 Base URL 和模型是否可用。',
      tone: 'warning',
    };
  }
  if (input.status === 'testing') {
    return {
      label: '正在测试 AI 连接',
      detail: '主进程正在用当前 Base URL、模型和脱敏 Key 做握手验证。',
      tone: 'pending',
    };
  }
  if (input.status === 'available') {
    return {
      label: 'AI 连接测试通过',
      detail: message || '测试通过，当前模型可用于广告诊断、建议解释和 Listing 草案。',
      tone: 'ready',
    };
  }
  if (input.status === 'failed') {
    return {
      label: 'AI 连接测试失败',
      detail: message || '请检查 Base URL、模型名称、API Key 或服务端额度后重新测试。',
      tone: 'blocked',
    };
  }
  return {
    label: '等待连接测试',
    detail: '当前连接字段已有配置变化，需要重新测试后再让 AI 参与建议生成。',
    tone: 'pending',
  };
}

export function settingsSecondaryStatusMessage(message: string): string {
  const text = message.trim();
  if (!text) return '';
  if (/^(AI 设置|AI Key|AI 连接|正在测试 AI 连接|请先填写 API Key|saveSettings 未接入|testAiSettings 未接入)/.test(text)) {
    return '';
  }
  return text;
}

interface SettingsRuleActionButtonInput {
  active: boolean;
  baseClassName: string;
  busyLabel: string;
  disabled?: boolean;
  label: string;
}

export interface SettingsRuleActionButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
}

export function settingsRuleActionButtonView(input: SettingsRuleActionButtonInput): SettingsRuleActionButtonView {
  return {
    ariaBusy: input.active ? true : undefined,
    className: [input.baseClassName, input.active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(input.disabled || input.active),
    label: input.active ? input.busyLabel : input.label,
    showSpinner: input.active,
  };
}

type SettingsLocalActionKey = 'clear-ai-key' | 'copy-diagnostics';

interface SettingsLocalActionButtonInput {
  action: SettingsLocalActionKey;
  activeAction: SettingsLocalActionKey | null;
  baseClassName: string;
  busyLabel: string;
  disabled?: boolean;
  label: string;
}

export interface SettingsLocalActionButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
}

export function settingsLocalActionButtonView(input: SettingsLocalActionButtonInput): SettingsLocalActionButtonView {
  const active = input.activeAction === input.action;
  return {
    ariaBusy: active ? true : undefined,
    className: [input.baseClassName, active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(input.disabled || active || (input.activeAction && !active)),
    label: active ? input.busyLabel : input.label,
    showSpinner: active,
  };
}

function settingsLocalActionButtonContent(view: SettingsLocalActionButtonView) {
  if (!view.showSpinner) return view.label;
  return (
    <span className="button-content">
      <span aria-hidden="true" className="button-spinner" />
      <span>{view.label}</span>
    </span>
  );
}

function percentLabel(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function finiteRuleNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function settingsRuleConfigFieldFeedback(config: SettingsRuleConfig): Partial<Record<keyof SettingsRuleConfig, string>> {
  const feedback: Partial<Record<keyof SettingsRuleConfig, string>> = {};
  if (!finiteRuleNumber(config.targetAcos) || config.targetAcos <= 0) feedback.targetAcos = '目标 ACOS 必须大于 0';
  if (!finiteRuleNumber(config.highAcosThreshold) || config.highAcosThreshold <= 0) {
    feedback.highAcosThreshold = '高 ACOS 阈值必须大于 0';
  } else if (finiteRuleNumber(config.targetAcos) && config.highAcosThreshold < config.targetAcos) {
    feedback.highAcosThreshold = '高 ACOS 阈值不能低于目标 ACOS';
  }
  if (!finiteRuleNumber(config.noOrderClickThreshold) || config.noOrderClickThreshold < 1) {
    feedback.noOrderClickThreshold = '无订单点击阈值必须至少为 1';
  }
  if (!finiteRuleNumber(config.minSpend) || config.minSpend < 0) feedback.minSpend = '最低花费不能为负数';
  if (!finiteRuleNumber(config.bidAdjustPercent) || config.bidAdjustPercent <= 0 || config.bidAdjustPercent > 1) {
    feedback.bidAdjustPercent = '降价比例必须在 0 到 1 之间';
  }
  if (!finiteRuleNumber(config.maxBidDecrement) || config.maxBidDecrement <= 0 || config.maxBidDecrement > 1) {
    feedback.maxBidDecrement = '最大降价比例必须在 0 到 1 之间';
  } else if (finiteRuleNumber(config.bidAdjustPercent) && config.maxBidDecrement < config.bidAdjustPercent) {
    feedback.maxBidDecrement = '最大降价比例不能低于单次降价比例';
  }
  if (config.minCpc !== undefined && (!finiteRuleNumber(config.minCpc) || config.minCpc < 0)) feedback.minCpc = '最低 CPC 不能为负数';
  if (config.maxCpc !== undefined && (!finiteRuleNumber(config.maxCpc) || config.maxCpc <= 0)) feedback.maxCpc = '最高 CPC 必须大于 0';
  if (
    finiteRuleNumber(config.minCpc)
    && finiteRuleNumber(config.maxCpc)
    && Number(config.minCpc) > Number(config.maxCpc)
  ) {
    feedback.minCpc = '最低 CPC 不能高于最高 CPC';
  }
  return feedback;
}

function validateRuleConfigForSave(config: SettingsRuleConfig): string[] {
  const errors: string[] = [];
  if (!finiteRuleNumber(config.targetAcos) || config.targetAcos <= 0) errors.push('目标 ACOS 必须大于 0');
  if (!finiteRuleNumber(config.highAcosThreshold) || config.highAcosThreshold <= 0) errors.push('高 ACOS 阈值必须大于 0');
  if (finiteRuleNumber(config.targetAcos) && finiteRuleNumber(config.highAcosThreshold) && config.highAcosThreshold < config.targetAcos) {
    errors.push('高 ACOS 阈值不能低于目标 ACOS');
  }
  if (!finiteRuleNumber(config.noOrderClickThreshold) || config.noOrderClickThreshold < 1) errors.push('无订单点击阈值必须至少为 1');
  if (!finiteRuleNumber(config.minSpend) || config.minSpend < 0) errors.push('最低花费不能为负数');
  if (!finiteRuleNumber(config.bidAdjustPercent) || config.bidAdjustPercent <= 0 || config.bidAdjustPercent > 1) {
    errors.push('降价比例必须在 0 到 1 之间');
  }
  if (!finiteRuleNumber(config.maxBidDecrement) || config.maxBidDecrement <= 0 || config.maxBidDecrement > 1) {
    errors.push('最大降价比例必须在 0 到 1 之间');
  }
  if (finiteRuleNumber(config.bidAdjustPercent) && finiteRuleNumber(config.maxBidDecrement) && config.maxBidDecrement < config.bidAdjustPercent) {
    errors.push('最大降价比例不能低于单次降价比例');
  }
  if (config.minCpc !== undefined && (!finiteRuleNumber(config.minCpc) || config.minCpc < 0)) errors.push('最低 CPC 不能为负数');
  if (config.maxCpc !== undefined && (!finiteRuleNumber(config.maxCpc) || config.maxCpc <= 0)) errors.push('最高 CPC 必须大于 0');
  if (finiteRuleNumber(config.minCpc) && finiteRuleNumber(config.maxCpc) && Number(config.minCpc) > Number(config.maxCpc)) {
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
  const [localAction, setLocalAction] = useState<SettingsLocalActionKey | null>(null);
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
  const canRunAiTest = canTestAi && keyPresent;
  const aiActionHint = aiSettingsActionHint({
    canSaveSettings,
    keyPresent,
    canTestAi: canRunAiTest,
  });
  const ruleSaveButton = settingsRuleActionButtonView({
    active: savingRules,
    baseClassName: 'primary-button',
    busyLabel: '保存中...',
    disabled: !canSaveRules,
    label: '保存广告阈值',
  });
  const clearAiKeyButton = settingsLocalActionButtonView({
    action: 'clear-ai-key',
    activeAction: localAction,
    baseClassName: 'secondary-button',
    busyLabel: '清除中...',
    disabled: savingAi || !canSaveSettings || !keyPresent,
    label: '清除本地 AI Key',
  });
  const copyDiagnosticsButton = settingsLocalActionButtonView({
    action: 'copy-diagnostics',
    activeAction: localAction,
    baseClassName: 'secondary-button',
    busyLabel: '复制中...',
    label: '复制诊断检查清单',
  });

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
    () => settingsPrimaryAiStatusItems(aiSettings, aiStatus, keyPresent),
    [aiSettings, aiStatus, keyPresent],
  );
  const aiConnectionFeedback = useMemo(
    () => settingsAiConnectionFeedback({
      status: aiStatus,
      keyPresent,
      saving: savingAi,
      message,
    }),
    [aiStatus, keyPresent, message, savingAi],
  );
  const secondaryStatusMessage = useMemo(
    () => settingsSecondaryStatusMessage(message),
    [message],
  );
  const ruleFieldFeedback = useMemo(
    () => settingsRuleConfigFieldFeedback(ruleConfig),
    [ruleConfig],
  );
  const aiCallDiagnostics = useMemo(
    () => buildAiCallDiagnostics(aiCallLogs),
    [aiCallLogs],
  );
  const ruleFeedbackFor = (field: keyof SettingsRuleConfig) => (
    ruleFieldFeedback[field]
      ? { tone: 'blocked' as const, children: ruleFieldFeedback[field] }
      : undefined
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
    setLocalAction('clear-ai-key');
    setSavingAi(true);
    setMessage('正在清除本地 AI Key...');
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
      setLocalAction(null);
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
    setLocalAction('copy-diagnostics');
    setCopyNotice('正在复制诊断检查清单...');
    try {
      await navigator.clipboard.writeText(DIAGNOSTIC_CHECKS.join('\n'));
      setCopyNotice('诊断检查清单已复制。');
    } catch (caught) {
      setCopyNotice(`复制失败：${toUserFacingError(caught, '复制失败。')}`);
    } finally {
      setLocalAction(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="系统与交付"
        title={PAGE_HEADER_TITLES.settings}
        description="配置模型连接、固定输出合同、阈值和本地诊断。API Key 全程脱敏。"
        primaryTask="配置 AI 与规则阈值"
        nextAction={keyPresent ? '测试 AI 连接' : '填写 API Key'}
      />

      <div className="business-stack">
        <OperatorTaskPanel
          eyebrow="AI 适配与诊断"
          title={settingsAiTaskTitle({ status: aiStatus, keyPresent })}
          detail="先确认模型连接和本地凭证，再让 AI 参与广告诊断、建议解释和 Listing 草案。"
          primaryAction={{
            label: aiStatus === 'available' ? '重新测试 AI 连接' : keyPresent ? '测试 AI 连接' : '填写 API Key',
            onClick: testAiSettings,
            disabled: !canRunAiTest,
            busy: aiStatus === 'testing',
            busyLabel: '测试中...',
          }}
          secondaryActions={[
            {
              label: '保存 AI 设置',
              onClick: saveAiSettings,
              disabled: !canSaveSettings,
              busy: savingAi,
              busyLabel: '保存中...',
            },
          ]}
        >
          <div className="dashboard-task-metrics settings-task-metrics" aria-label="AI 设置任务摘要">
            <StatusPill tone={displayAiStatusTone(aiStatus, keyPresent)}>{displayAiStatusLabel(aiStatus, keyPresent)}</StatusPill>
            <span>{aiSettings.aiModel || '未配置模型'}</span>
            <span>{aiSettings.aiBaseUrl || '未配置 Base URL'}</span>
            <span>{keyPresent ? 'Key 已脱敏' : 'Key 未配置'}</span>
          </div>
          <div className={`settings-ai-feedback settings-ai-feedback-${aiConnectionFeedback.tone}`} aria-live="polite" role="status">
            <span>{aiConnectionFeedback.label}</span>
            <strong>{aiConnectionFeedback.detail}</strong>
          </div>
        </OperatorTaskPanel>

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
          <FormTable>
            <FormTableRow label="API Key" required hint="仅保存脱敏状态，页面不展示完整 Key。">
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
            </FormTableRow>
            <FormTableRow label="Base URL" required hint="兼容 OpenAI Chat Completions 的服务地址。">
              <input
                value={aiSettings.aiBaseUrl}
                onChange={(event) => {
                  setAiSettings(updateAiSettingsField(aiSettings, 'aiBaseUrl', event.target.value));
                  setAiStatus(keyPresent ? 'pending_test' : 'unconfigured');
                }}
                placeholder="https://api.deepseek.com"
              />
            </FormTableRow>
            <FormTableRow label="Model" required hint="诊断、建议和 Listing 草案共用同一模型配置。">
              <input
                value={aiSettings.aiModel}
                onChange={(event) => {
                  setAiSettings(updateAiSettingsField(aiSettings, 'aiModel', event.target.value));
                  setAiStatus(keyPresent ? 'pending_test' : 'unconfigured');
                }}
                placeholder="deepseek-v4-flash"
              />
            </FormTableRow>
          </FormTable>
          <p className="muted-line">{settingsAiContractPrimaryCopy()}</p>
          <TagMetricGroup items={settingsAiContractTags()} />
          {aiActionHint && <p className="muted-line">{aiActionHint}</p>}
          <ProgressiveDetails title="高级 AI 参数">
            <div className="settings-status-grid">
              <div>
                <span>输出语言</span>
                <strong>{aiSettings.aiOutputLanguage || DEFAULT_AI_SETTINGS.aiOutputLanguage || '简体中文'}</strong>
              </div>
              <div>
                <span>最近测试</span>
                <strong>{aiSettings.aiLastTestAt ? `${aiSettings.aiLastTestStatus === 'available' ? '通过' : '失败'} / ${aiSettings.aiLastTestMessage || aiSettings.aiLastTestAt}` : '暂无记录'}</strong>
              </div>
            </div>
            <TagMetricGroup items={settingsAiContractVersionItems()} />
            <div className="settings-form-grid">
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
                结构输出预算
                <input
                  type="number"
                  min={STRUCTURED_AI_OUTPUT_TOKEN_FLOOR}
                  value={aiSettings.aiMaxTokens}
                  onChange={(event) => setAiSettings(updateAiSettingsField(aiSettings, 'aiMaxTokens', event.target.value))}
                  onBlur={(event) => setAiSettings(updateAiSettingsField(aiSettings, 'aiMaxTokens', clampStructuredAiMaxTokens(event.target.value)))}
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
                <span>AI 人设与表达风格</span>
                <textarea
                  aria-label="AI 人设与表达风格"
                  value={aiSettings.aiPersona || ''}
                  onChange={(event) => setAiSettings(updateAiSettingsField(aiSettings, 'aiPersona', event.target.value))}
                  placeholder={DEFAULT_AI_PERSONA}
                />
              </label>
            </div>
            <div className="action-row">
              <button
                aria-busy={clearAiKeyButton.ariaBusy}
                className={clearAiKeyButton.className}
                disabled={clearAiKeyButton.disabled}
                onClick={clearLocalAiKey}
                type="button"
              >
                {settingsLocalActionButtonContent(clearAiKeyButton)}
              </button>
            </div>
          </ProgressiveDetails>
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
          <FormTable>
            <FormTableRow label="目标 ACOS" required hint="低于目标线的词和投放对象优先保留、观察或扩量复核。" feedback={ruleFeedbackFor('targetAcos')}>
              <input
                type="number"
                step="0.01"
                value={ruleConfig.targetAcos}
                onChange={(event) => setRuleConfig({ ...ruleConfig, targetAcos: Number(event.target.value) })}
              />
            </FormTableRow>
            <FormTableRow label="高 ACOS 阈值" required hint="超过风险线且花费达到最低门槛时，进入降价或否词建议。" feedback={ruleFeedbackFor('highAcosThreshold')}>
              <input
                type="number"
                step="0.01"
                value={ruleConfig.highAcosThreshold}
                onChange={(event) => setRuleConfig({ ...ruleConfig, highAcosThreshold: Number(event.target.value) })}
              />
            </FormTableRow>
            <FormTableRow label="无订单点击阈值" required hint="达到点击阈值仍无订单时，标记为浪费风险。" feedback={ruleFeedbackFor('noOrderClickThreshold')}>
              <input
                type="number"
                value={ruleConfig.noOrderClickThreshold}
                onChange={(event) => setRuleConfig({ ...ruleConfig, noOrderClickThreshold: Number(event.target.value) })}
              />
            </FormTableRow>
            <FormTableRow label="最低花费" required hint="单位 USD；花费低于该值时只提示观察，不生成强动作。" feedback={ruleFeedbackFor('minSpend')}>
              <input
                type="number"
                step="0.01"
                value={ruleConfig.minSpend}
                onChange={(event) => setRuleConfig({ ...ruleConfig, minSpend: Number(event.target.value) })}
              />
            </FormTableRow>
            <FormTableRow label="降价比例" required hint="只生成建议，不自动写入 Ads；执行仍走审批和回读。" feedback={ruleFeedbackFor('bidAdjustPercent')}>
              <input
                type="number"
                step="0.01"
                value={ruleConfig.bidAdjustPercent}
                onChange={(event) => setRuleConfig({ ...ruleConfig, bidAdjustPercent: Number(event.target.value) })}
              />
            </FormTableRow>
            <FormTableRow label="最大降价比例" required hint="单次建议不超过该比例，且受 CPC 下限保护。" feedback={ruleFeedbackFor('maxBidDecrement')}>
              <input
                type="number"
                step="0.01"
                value={ruleConfig.maxBidDecrement}
                onChange={(event) => setRuleConfig({ ...ruleConfig, maxBidDecrement: Number(event.target.value) })}
              />
            </FormTableRow>
            <FormTableRow label="最高 CPC" hint="单位 USD；用于识别异常高出价和建议上限。" feedback={ruleFeedbackFor('maxCpc')}>
              <input
                type="number"
                step="0.01"
                value={ruleConfig.maxCpc}
                onChange={(event) => setRuleConfig({ ...ruleConfig, maxCpc: Number(event.target.value) })}
              />
            </FormTableRow>
            <FormTableRow label="最低 CPC" hint="单位 USD；降价建议不会低于该下限。" feedback={ruleFeedbackFor('minCpc')}>
              <input
                type="number"
                step="0.01"
                value={ruleConfig.minCpc}
                onChange={(event) => setRuleConfig({ ...ruleConfig, minCpc: Number(event.target.value) })}
              />
            </FormTableRow>
            <FormTableRow label="降价建议" hint="只生成建议，不自动写入 Ads；执行仍走审批和回读。">
              <input
                checked={ruleConfig.enableAutoLowerBid}
                type="checkbox"
                onChange={(event) => setRuleConfig({ ...ruleConfig, enableAutoLowerBid: event.target.checked })}
              />
            </FormTableRow>
            <FormTableRow label="否词建议" hint="只进入建议池，白名单词会阻断。">
              <input
                checked={ruleConfig.enableAutoAddNegative}
                type="checkbox"
                onChange={(event) => setRuleConfig({ ...ruleConfig, enableAutoAddNegative: event.target.checked })}
              />
            </FormTableRow>
            <FormTableRow label="品牌词白名单" hint="品牌词用逗号或换行分隔，命中后阻断否词建议。">
              <textarea
                aria-label="品牌词白名单"
                value={listToText(ruleConfig.brandWordWhitelist)}
                onChange={(event) => {
                  setRuleConfig({ ...ruleConfig, brandWordWhitelist: parseListInput(event.target.value) });
                }}
                placeholder="品牌词，用逗号或换行分隔"
              />
            </FormTableRow>
            <FormTableRow label="核心词白名单" hint="核心业务词用逗号或换行分隔，命中后进入人工复核。">
              <textarea
                aria-label="核心词白名单"
                value={listToText(ruleConfig.coreWordWhitelist)}
                onChange={(event) => {
                  setRuleConfig({ ...ruleConfig, coreWordWhitelist: parseListInput(event.target.value) });
                }}
                placeholder="核心业务词，用逗号或换行分隔"
              />
            </FormTableRow>
          </FormTable>
          <div className="action-row">
            <button
              aria-busy={ruleSaveButton.ariaBusy}
              className={ruleSaveButton.className}
              disabled={ruleSaveButton.disabled}
              onClick={saveRuleConfig}
              type="button"
            >
              {ruleSaveButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
              <span>{ruleSaveButton.label}</span>
            </button>
          </div>
        </Panel>

        <ProgressiveDetails title="AI 调用审计">
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
        </ProgressiveDetails>

        <div className="business-grid">
          <ProgressiveDetails title="安全策略">
            <ul className="business-list">
              {SAFETY_POLICIES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </ProgressiveDetails>

          <ProgressiveDetails title="本地存储路径">
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
          </ProgressiveDetails>
        </div>

        <ProgressiveDetails title="诊断工具">
          <div className="settings-diagnostic-row">
            <p>用于验证 AI 连接、广告解释、Listing 草案和最终交付状态；不会改变广告账户，也不会绕过审批、执行前/执行后/回读或范围匹配要求。</p>
            <button
              aria-busy={copyDiagnosticsButton.ariaBusy}
              className={copyDiagnosticsButton.className}
              disabled={copyDiagnosticsButton.disabled}
              onClick={copyDiagnostics}
              type="button"
            >
              {settingsLocalActionButtonContent(copyDiagnosticsButton)}
            </button>
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
        </ProgressiveDetails>

        {secondaryStatusMessage && <Panel title="状态">{secondaryStatusMessage}</Panel>}
      </div>
    </div>
  );
}
