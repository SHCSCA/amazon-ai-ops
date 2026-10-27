// 保留页面编排与原有交互，纯值规则和展示规则按职责复用。
import type { AiCallLogView, AiConnectionStatus, AiProviderSettings, SettingsRuleConfig, StoragePathsView } from '../types';
import { STRUCTURED_AI_OUTPUT_TOKEN_FLOOR, DEFAULT_AI_SETTINGS, DEFAULT_RULE_CONFIG, type AiSettingsField } from './settings-contracts';

export function readString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

export function readNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function readBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'string') {
        if (value.toLowerCase() === 'true')
            return true;
        if (value.toLowerCase() === 'false')
            return false;
    }
    return typeof value === 'boolean' ? value : fallback;
}

export function normalizeList(value: unknown): string[] {
    if (Array.isArray(value))
        return value.map((item) => String(item).trim()).filter(Boolean);
    if (typeof value === 'string') {
        return value
            .split(/[,，\n]/)
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
}

export function listToText(value: string[]): string {
    return value.join(', ');
}

export function parseListInput(value: string): string[] {
    return Array.from(new Set(normalizeList(value)));
}

export function clampStructuredAiMaxTokens(value: string): string {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return String(STRUCTURED_AI_OUTPUT_TOKEN_FLOOR);
    return String(Math.max(STRUCTURED_AI_OUTPUT_TOKEN_FLOOR, Math.trunc(parsed)));
}

export function normalizeAiSettings(settings: Record<string, unknown> | null | undefined): AiProviderSettings {
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

export function testedStatusForSettings(settings: AiProviderSettings): AiConnectionStatus {
    const normalizeBaseUrl = (value: unknown) => String(value || '').trim().replace(/\/+$/, '');
    const baseMatches = normalizeBaseUrl(settings.aiLastTestBaseUrl) === normalizeBaseUrl(settings.aiBaseUrl);
    const modelMatches = settings.aiLastTestModel === settings.aiModel;
    if (!settings.aiKeyConfigured && !settings.aiApiKey.trim())
        return 'unconfigured';
    if (baseMatches && modelMatches && settings.aiLastTestStatus === 'available')
        return 'available';
    if (baseMatches && modelMatches && settings.aiLastTestStatus === 'failed')
        return 'failed';
    return 'pending_test';
}

export function normalizeRuleConfig(config: Record<string, unknown> | null | undefined): SettingsRuleConfig {
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

export function percentLabel(value: number): string {
    return `${(value * 100).toFixed(0)}%`;
}

export function finiteRuleNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function settingsRuleConfigFieldFeedback(config: SettingsRuleConfig): Partial<Record<keyof SettingsRuleConfig, string>> {
    const feedback: Partial<Record<keyof SettingsRuleConfig, string>> = {};
    if (!finiteRuleNumber(config.targetAcos) || config.targetAcos <= 0)
        feedback.targetAcos = '目标 ACOS 必须大于 0';
    if (!finiteRuleNumber(config.highAcosThreshold) || config.highAcosThreshold <= 0) {
        feedback.highAcosThreshold = '高 ACOS 阈值必须大于 0';
    }
    else if (finiteRuleNumber(config.targetAcos) && config.highAcosThreshold < config.targetAcos) {
        feedback.highAcosThreshold = '高 ACOS 阈值不能低于目标 ACOS';
    }
    if (!finiteRuleNumber(config.noOrderClickThreshold) || config.noOrderClickThreshold < 1) {
        feedback.noOrderClickThreshold = '无订单点击阈值必须至少为 1';
    }
    if (!finiteRuleNumber(config.minSpend) || config.minSpend < 0)
        feedback.minSpend = '最低花费不能为负数';
    if (!finiteRuleNumber(config.bidAdjustPercent) || config.bidAdjustPercent <= 0 || config.bidAdjustPercent > 1) {
        feedback.bidAdjustPercent = '降价比例必须在 0 到 1 之间';
    }
    if (!finiteRuleNumber(config.maxBidDecrement) || config.maxBidDecrement <= 0 || config.maxBidDecrement > 1) {
        feedback.maxBidDecrement = '最大降价比例必须在 0 到 1 之间';
    }
    else if (finiteRuleNumber(config.bidAdjustPercent) && config.maxBidDecrement < config.bidAdjustPercent) {
        feedback.maxBidDecrement = '最大降价比例不能低于单次降价比例';
    }
    if (config.minCpc !== undefined && (!finiteRuleNumber(config.minCpc) || config.minCpc < 0))
        feedback.minCpc = '最低 CPC 不能为负数';
    if (config.maxCpc !== undefined && (!finiteRuleNumber(config.maxCpc) || config.maxCpc <= 0))
        feedback.maxCpc = '最高 CPC 必须大于 0';
    if (finiteRuleNumber(config.minCpc)
        && finiteRuleNumber(config.maxCpc)
        && Number(config.minCpc) > Number(config.maxCpc)) {
        feedback.minCpc = '最低 CPC 不能高于最高 CPC';
    }
    return feedback;
}

export function validateRuleConfigForSave(config: SettingsRuleConfig): string[] {
    const errors: string[] = [];
    if (!finiteRuleNumber(config.targetAcos) || config.targetAcos <= 0)
        errors.push('目标 ACOS 必须大于 0');
    if (!finiteRuleNumber(config.highAcosThreshold) || config.highAcosThreshold <= 0)
        errors.push('高 ACOS 阈值必须大于 0');
    if (finiteRuleNumber(config.targetAcos) && finiteRuleNumber(config.highAcosThreshold) && config.highAcosThreshold < config.targetAcos) {
        errors.push('高 ACOS 阈值不能低于目标 ACOS');
    }
    if (!finiteRuleNumber(config.noOrderClickThreshold) || config.noOrderClickThreshold < 1)
        errors.push('无订单点击阈值必须至少为 1');
    if (!finiteRuleNumber(config.minSpend) || config.minSpend < 0)
        errors.push('最低花费不能为负数');
    if (!finiteRuleNumber(config.bidAdjustPercent) || config.bidAdjustPercent <= 0 || config.bidAdjustPercent > 1) {
        errors.push('降价比例必须在 0 到 1 之间');
    }
    if (!finiteRuleNumber(config.maxBidDecrement) || config.maxBidDecrement <= 0 || config.maxBidDecrement > 1) {
        errors.push('最大降价比例必须在 0 到 1 之间');
    }
    if (finiteRuleNumber(config.bidAdjustPercent) && finiteRuleNumber(config.maxBidDecrement) && config.maxBidDecrement < config.bidAdjustPercent) {
        errors.push('最大降价比例不能低于单次降价比例');
    }
    if (config.minCpc !== undefined && (!finiteRuleNumber(config.minCpc) || config.minCpc < 0))
        errors.push('最低 CPC 不能为负数');
    if (config.maxCpc !== undefined && (!finiteRuleNumber(config.maxCpc) || config.maxCpc <= 0))
        errors.push('最高 CPC 必须大于 0');
    if (finiteRuleNumber(config.minCpc) && finiteRuleNumber(config.maxCpc) && Number(config.minCpc) > Number(config.maxCpc)) {
        errors.push('最低 CPC 不能高于最高 CPC');
    }
    return errors;
}

export function clearAiTestState(settings: AiProviderSettings): AiProviderSettings {
    return {
        ...settings,
        aiLastTestStatus: '',
        aiLastTestAt: '',
        aiLastTestBaseUrl: '',
        aiLastTestModel: '',
        aiLastTestMessage: '',
    };
}

export function shouldResetAiTestForSettingsField(field: AiSettingsField): boolean {
    return field === 'aiApiKey' || field === 'aiBaseUrl' || field === 'aiModel';
}

export function updateAiSettingsField(settings: AiProviderSettings, field: AiSettingsField, value: string | boolean): AiProviderSettings {
    const next = { ...settings, [field]: value } as AiProviderSettings;
    return shouldResetAiTestForSettingsField(field) ? clearAiTestState(next) : next;
}

export function api(): Record<string, any> {
    return ((window as any).electronAPI || {}) as Record<string, any>;
}
