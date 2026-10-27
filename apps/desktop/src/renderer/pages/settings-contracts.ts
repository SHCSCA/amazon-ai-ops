// 保留页面编排与原有交互，纯值规则和展示规则按职责复用。
import type { AiCallLogView, AiConnectionStatus, AiProviderSettings, SettingsRuleConfig, StoragePathsView } from '../types';

export const DEFAULT_AI_PERSONA = [
    '你是中文亚马逊广告运营顾问，擅长结合真实广告报表、产品阶段、成本结构和运营事件做量化分析。',
    '请用运营能直接理解的中文解释阈值、风险和建议；字段结构由系统固定输出合同约束，人设只影响表达风格，不执行广告动作。',
].join('');

export const DEFAULT_AI_SETTINGS: AiProviderSettings = {
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

export const STRUCTURED_AI_OUTPUT_TOKEN_FLOOR = 8192;

export const DEFAULT_RULE_CONFIG: SettingsRuleConfig = {
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

export const SAFETY_POLICIES = [
    '不允许无边界批量写入广告账户。',
    '任意真实写入前必须有人工审批。',
    '每次执行必须保留执行前、执行后和回读证据。',
    '执行对象必须与店铺、站点、广告活动、广告组、ASIN 和投放对象范围完全匹配。',
];

export const DIAGNOSTIC_CHECKS = [
    'AI 连接：确认 Provider、Base URL、模型和脱敏 Key 状态。',
    '广告建议解释：确认建议来自当前范围真实广告指标，并标记 AI 或规则来源。',
    'Listing 草案：确认 Listing 读取、关键词机会和草案来源，不自动提交 Amazon。',
    '最终交付：确认真实报表、量化、AI、审批、回读和安装包证据是否闭环。',
];

export type SettingsTaskActionKind = 'edit-connection' | 'test-connection' | 'open-contract';

export interface SettingsRuleActionButtonInput {
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

export type SettingsLocalActionKey = 'clear-ai-key' | 'copy-diagnostics';

export type SettingsModalMode = 'ai-contract' | 'ai-connection' | 'rules' | null;

export interface SettingsLocalActionButtonInput {
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

export type AiSettingsField = keyof AiProviderSettings;
