export interface NormalizedAiSettings {
  [key: string]: string;
  aiApiKey: string;
  ai_api_key: string;
  aiBaseUrl: string;
  ai_base_url: string;
  aiModel: string;
  ai_model: string;
  aiTemperature: string;
  ai_temperature: string;
  aiMaxTokens: string;
  ai_max_tokens: string;
  aiOutputLanguage: string;
  ai_output_language: string;
  aiPersona: string;
  ai_persona: string;
  aiLastTestStatus: string;
  ai_last_test_status: string;
  aiLastTestAt: string;
  ai_last_test_at: string;
  aiLastTestBaseUrl: string;
  ai_last_test_base_url: string;
  aiLastTestModel: string;
  ai_last_test_model: string;
  aiLastTestMessage: string;
  ai_last_test_message: string;
}

export const STRUCTURED_AI_OUTPUT_TOKEN_FLOOR = 8192;

export function normalizeAiSettingsRecord(settings: Record<string, unknown> = {}): NormalizedAiSettings {
  const apiKey = stringSetting(settings.ai_api_key) || stringSetting(settings.aiApiKey);
  const baseUrl = (stringSetting(settings.ai_base_url) || stringSetting(settings.aiBaseUrl) || 'https://api.deepseek.com').replace(/\/+$/, '');
  const model = stringSetting(settings.ai_model) || stringSetting(settings.aiModel) || 'deepseek-v4-flash';
  const temperature = stringSetting(settings.ai_temperature) || stringSetting(settings.aiTemperature) || '0.3';
  const maxTokens = normalizeStructuredAiMaxTokens(settings.ai_max_tokens || settings.aiMaxTokens);
  const outputLanguage =
    stringSetting(settings.ai_output_language) || stringSetting(settings.aiOutputLanguage) || '简体中文';
  const persona = stringSetting(settings.ai_persona) || stringSetting(settings.aiPersona) || [
    '你是中文亚马逊广告运营顾问，擅长结合真实广告报表、产品阶段、成本结构和运营事件做量化分析。',
    '请用运营能直接理解的中文解释阈值、风险和建议；字段结构由系统固定输出合同约束，不执行广告动作。',
  ].join('');
  const lastTestStatus = stringSetting(settings.ai_last_test_status) || stringSetting(settings.aiLastTestStatus);
  const lastTestAt = stringSetting(settings.ai_last_test_at) || stringSetting(settings.aiLastTestAt);
  const lastTestBaseUrl = stringSetting(settings.ai_last_test_base_url) || stringSetting(settings.aiLastTestBaseUrl);
  const lastTestModel = stringSetting(settings.ai_last_test_model) || stringSetting(settings.aiLastTestModel);
  const lastTestMessage = stringSetting(settings.ai_last_test_message) || stringSetting(settings.aiLastTestMessage);
  return {
    aiApiKey: apiKey,
    ai_api_key: apiKey,
    aiBaseUrl: baseUrl,
    ai_base_url: baseUrl,
    aiModel: model,
    ai_model: model,
    aiTemperature: temperature,
    ai_temperature: temperature,
    aiMaxTokens: maxTokens,
    ai_max_tokens: maxTokens,
    aiOutputLanguage: outputLanguage,
    ai_output_language: outputLanguage,
    aiPersona: persona,
    ai_persona: persona,
    aiLastTestStatus: lastTestStatus,
    ai_last_test_status: lastTestStatus,
    aiLastTestAt: lastTestAt,
    ai_last_test_at: lastTestAt,
    aiLastTestBaseUrl: lastTestBaseUrl,
    ai_last_test_base_url: lastTestBaseUrl,
    aiLastTestModel: lastTestModel,
    ai_last_test_model: lastTestModel,
    aiLastTestMessage: lastTestMessage,
    ai_last_test_message: lastTestMessage,
  };
}

export function normalizeStructuredAiMaxTokens(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(STRUCTURED_AI_OUTPUT_TOKEN_FLOOR);
  return String(Math.max(STRUCTURED_AI_OUTPUT_TOKEN_FLOOR, Math.trunc(parsed)));
}

export function sanitizeAiSettingsForRenderer(settings: Record<string, unknown> = {}): Record<string, string | boolean> {
  const normalized = normalizeAiSettingsRecord(settings);
  return {
    aiApiKey: '',
    ai_api_key: '',
    aiKeyConfigured: Boolean(normalized.aiApiKey.trim()),
    ai_key_configured: Boolean(normalized.aiApiKey.trim()),
    aiBaseUrl: normalized.aiBaseUrl,
    ai_base_url: normalized.ai_base_url,
    aiModel: normalized.aiModel,
    ai_model: normalized.ai_model,
    aiTemperature: normalized.aiTemperature,
    ai_temperature: normalized.ai_temperature,
    aiMaxTokens: normalized.aiMaxTokens,
    ai_max_tokens: normalized.ai_max_tokens,
    aiOutputLanguage: normalized.aiOutputLanguage,
    ai_output_language: normalized.ai_output_language,
    aiPersona: normalized.aiPersona,
    ai_persona: normalized.ai_persona,
    aiLastTestStatus: normalized.aiLastTestStatus || '',
    ai_last_test_status: normalized.aiLastTestStatus || '',
    aiLastTestAt: normalized.aiLastTestAt || '',
    ai_last_test_at: normalized.aiLastTestAt || '',
    aiLastTestBaseUrl: normalized.aiLastTestBaseUrl || '',
    ai_last_test_base_url: normalized.aiLastTestBaseUrl || '',
    aiLastTestModel: normalized.aiLastTestModel || '',
    ai_last_test_model: normalized.aiLastTestModel || '',
    aiLastTestMessage: normalized.aiLastTestMessage || '',
    ai_last_test_message: normalized.aiLastTestMessage || '',
  };
}

export function normalizeAiSettingsForSaveInput(
  incoming: Record<string, unknown> = {},
  savedSettings: Record<string, unknown> = {},
): NormalizedAiSettings {
  const saved = normalizeAiSettingsRecord(savedSettings);
  const normalized = normalizeAiSettingsRecord(incoming);
  const shouldClearKey = booleanSetting(incoming.clearAiKey ?? incoming.clear_ai_key);
  const incomingKey = stringSetting(incoming.ai_api_key) || stringSetting(incoming.aiApiKey);
  const apiKey = shouldClearKey ? '' : incomingKey || saved.aiApiKey;
  const incomingStatus = stringSetting(incoming.aiLastTestStatus) || stringSetting(incoming.ai_last_test_status);
  const savedTestStillMatches =
    !shouldClearKey
    && !incomingStatus
    && !incomingKey
    && Boolean(saved.aiLastTestStatus)
    && normalizeBaseUrl(saved.aiLastTestBaseUrl) === normalizeBaseUrl(normalized.aiBaseUrl)
    && saved.aiLastTestModel === normalized.aiModel;
  const lastTestStatus = incomingStatus || (savedTestStillMatches ? saved.aiLastTestStatus : '');
  const lastTestAt =
    stringSetting(incoming.aiLastTestAt)
    || stringSetting(incoming.ai_last_test_at)
    || (savedTestStillMatches ? saved.aiLastTestAt : '');
  const lastTestBaseUrl =
    stringSetting(incoming.aiLastTestBaseUrl)
    || stringSetting(incoming.ai_last_test_base_url)
    || (savedTestStillMatches ? saved.aiLastTestBaseUrl : '');
  const lastTestModel =
    stringSetting(incoming.aiLastTestModel)
    || stringSetting(incoming.ai_last_test_model)
    || (savedTestStillMatches ? saved.aiLastTestModel : '');
  const lastTestMessage =
    stringSetting(incoming.aiLastTestMessage)
    || stringSetting(incoming.ai_last_test_message)
    || (savedTestStillMatches ? saved.aiLastTestMessage : '');
  return {
    ...normalized,
    aiApiKey: apiKey,
    ai_api_key: apiKey,
    aiLastTestStatus: lastTestStatus,
    ai_last_test_status: lastTestStatus,
    aiLastTestAt: lastTestAt,
    ai_last_test_at: lastTestAt,
    aiLastTestBaseUrl: lastTestBaseUrl,
    ai_last_test_base_url: lastTestBaseUrl,
    aiLastTestModel: lastTestModel,
    ai_last_test_model: lastTestModel,
    aiLastTestMessage: lastTestMessage,
    ai_last_test_message: lastTestMessage,
    aiOutputLanguage: normalized.aiOutputLanguage,
    ai_output_language: normalized.ai_output_language,
    aiPersona: normalized.aiPersona,
    ai_persona: normalized.ai_persona,
  };
}

export function normalizeAiSettingsForTestInput(
  incoming: Record<string, unknown> = {},
  savedSettings: Record<string, unknown> = {},
): NormalizedAiSettings {
  const saved = normalizeAiSettingsRecord(savedSettings);
  const normalized = normalizeAiSettingsRecord(incoming);
  const incomingKey = stringSetting(incoming.ai_api_key) || stringSetting(incoming.aiApiKey);
  const apiKey = incomingKey || saved.aiApiKey;
  return {
    ...normalized,
    aiApiKey: apiKey,
    ai_api_key: apiKey,
  };
}

function normalizeBaseUrl(value: unknown): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function stringSetting(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function booleanSetting(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
  return false;
}
