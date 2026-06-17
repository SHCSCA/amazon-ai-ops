import { describe, expect, it } from 'vitest';
import {
  normalizeAiSettingsForSaveInput,
  normalizeAiSettingsForTestInput,
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
    expect(result.aiLastTestStatus).toBe('available');
    expect(JSON.stringify(result)).not.toContain('sk-saved-live-key-123456');
  });

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
});
