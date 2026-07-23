import { describe, expect, it } from 'vitest';
import {
  normalizeAiSettingsForSaveInput,
  normalizeAiSettingsRecord,
  normalizeAiSettingsForTestInput,
  SYSTEM_AI_PROVIDER,
  sanitizeAiSettingsForRenderer,
} from './ai-settings-normalization';

describe('ai settings normalization', () => {
  const savedSettings = {
    aiApiKey: 'sk-saved-live-key-123456',
    aiBaseUrl: 'https://api.deepseek.com',
    aiModel: 'deepseek-v4-flash',
    aiTemperature: '0.3',
    aiMaxTokens: '8192',
    aiOutputLanguage: '简体中文',
    aiPersona: '原始人设',
    aiLastTestStatus: 'available',
    aiLastTestAt: '2026-06-17T10:00:00.000Z',
    aiLastTestBaseUrl: 'https://api.deepseek.com',
    aiLastTestModel: 'deepseek-v4-flash',
    aiLastTestMessage: 'AI 连接测试通过',
  };

  it('sanitizes settings for renderer without exposing the stored API key', () => {
    const result = sanitizeAiSettingsForRenderer(savedSettings);

    expect(result.aiApiKey).toBe('');
    expect(result.ai_api_key).toBe('');
    expect(result.aiKeyConfigured).toBe(true);
    expect(result.ai_key_configured).toBe(true);
    expect(result.aiProvider).toBe(SYSTEM_AI_PROVIDER);
    expect(result.ai_provider).toBe(SYSTEM_AI_PROVIDER);
    expect(result.aiLastTestStatus).toBe('available');
    expect(JSON.stringify(result)).not.toContain('sk-saved-live-key-123456');
  });

  it.each([undefined, '', 'deepseek', 'openai', 'unsupported-provider'])(
    'migrates the legacy provider label %s into the single closed provider contract',
    (aiProvider) => {
      const result = normalizeAiSettingsRecord({ aiProvider });

      expect(result.aiProvider).toBe('openai-compatible');
      expect(result.ai_provider).toBe('openai-compatible');
    },
  );

  it('preserves saved API key and available test state when saving persona from hidden-key UI state', () => {
    const result = normalizeAiSettingsForSaveInput({
      aiApiKey: '',
      aiKeyConfigured: true,
      aiBaseUrl: 'https://api.deepseek.com/',
      aiModel: 'deepseek-v4-flash',
      aiPersona: '你是中文亚马逊广告量化运营顾问。',
    }, savedSettings);

    expect(result.aiApiKey).toBe('sk-saved-live-key-123456');
    expect(result.ai_api_key).toBe('sk-saved-live-key-123456');
    expect(result.aiPersona).toContain('中文亚马逊广告量化运营顾问');
    expect(result.aiLastTestStatus).toBe('available');
    expect(result.aiLastTestAt).toBe('2026-06-17T10:00:00.000Z');
  });

  it.each([
    ['Base URL', { aiBaseUrl: 'https://api.example.com' }],
    ['模型', { aiModel: 'deepseek-reasoner' }],
    ['API Key', { aiApiKey: 'sk-new-live-key-654321' }],
  ])('invalidates the saved connection test when %s changes', (_field, changedSettings) => {
    const result = normalizeAiSettingsForSaveInput({
      aiApiKey: '',
      aiBaseUrl: savedSettings.aiBaseUrl,
      aiModel: savedSettings.aiModel,
      aiPersona: savedSettings.aiPersona,
      ...changedSettings,
    }, savedSettings);

    expect(result.aiLastTestStatus).toBe('');
    expect(result.aiLastTestAt).toBe('');
    expect(result.aiLastTestBaseUrl).toBe('');
    expect(result.aiLastTestModel).toBe('');
    expect(result.aiLastTestMessage).toBe('');
  });

  it('uses the saved API key when testing AI from a hidden-key renderer state', () => {
    const result = normalizeAiSettingsForTestInput({
      aiApiKey: '',
      aiKeyConfigured: true,
      aiBaseUrl: 'https://api.deepseek.com',
      aiModel: 'deepseek-v4-flash',
    }, savedSettings);

    expect(result.aiApiKey).toBe('sk-saved-live-key-123456');
    expect(result.ai_api_key).toBe('sk-saved-live-key-123456');
  });

  it('clears the saved API key and test state only when explicitly requested', () => {
    const result = normalizeAiSettingsForSaveInput({
      clearAiKey: true,
      aiApiKey: '',
      aiKeyConfigured: true,
      aiBaseUrl: 'https://api.deepseek.com',
      aiModel: 'deepseek-v4-flash',
      aiPersona: '清除后的人设仍保留',
    }, savedSettings);

    expect(result.aiApiKey).toBe('');
    expect(result.ai_api_key).toBe('');
    expect(result.aiLastTestStatus).toBe('');
    expect(result.aiLastTestAt).toBe('');
    expect(result.aiLastTestMessage).toBe('');
    expect(result.aiPersona).toBe('清除后的人设仍保留');
  });

  it('defaults max tokens high enough for structured evidence-chain JSON output', () => {
    const result = sanitizeAiSettingsForRenderer({});

    expect(result.aiMaxTokens).toBe('8192');
    expect(result.ai_max_tokens).toBe('8192');
  });

  it('upgrades legacy low max tokens so structured AI output cannot be truncated by old settings', () => {
    const result = normalizeAiSettingsRecord({
      aiMaxTokens: '700',
    });

    expect(result.aiMaxTokens).toBe('8192');
    expect(result.ai_max_tokens).toBe('8192');
  });

  it('persists the structured output token floor when saving from an old renderer state', () => {
    const result = normalizeAiSettingsForSaveInput({
      aiApiKey: '',
      aiKeyConfigured: true,
      aiBaseUrl: 'https://api.deepseek.com',
      aiModel: 'deepseek-v4-flash',
      aiMaxTokens: '700',
    }, savedSettings);

    expect(result.aiApiKey).toBe('sk-saved-live-key-123456');
    expect(result.aiMaxTokens).toBe('8192');
    expect(result.ai_max_tokens).toBe('8192');
  });

  it('rejects credential namespace and arbitrary fields from AI settings persistence', () => {
    const result = normalizeAiSettingsForSaveInput({
      aiModel: 'deepseek-reasoner',
      login_username: 'attacker@example.com',
      login_password: 'plaintext-injection',
      login_password_encrypted: 'forged-ciphertext',
      login_remember_password: 'true',
      arbitrary_setting: 'must-not-persist',
    }, {
      ...savedSettings,
      login_password: 'legacy-secret',
    });

    expect(result.aiModel).toBe('deepseek-reasoner');
    expect(result).not.toHaveProperty('login_username');
    expect(result).not.toHaveProperty('login_password');
    expect(result).not.toHaveProperty('login_password_encrypted');
    expect(result).not.toHaveProperty('login_remember_password');
    expect(result).not.toHaveProperty('arbitrary_setting');
  });
});
