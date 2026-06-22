import { describe, expect, it } from 'vitest';
import {
  aiAuditIntroText,
  aiAuditLogFormatLine,
  aiAuditLogTitle,
  aiAuditPurposeText,
  aiSettingsActionHint,
  shouldResetAiTestForSettingsField,
} from './settings-page';

describe('settings AI audit copy', () => {
  it('uses operator-facing output-format wording instead of schema or prompt jargon', () => {
    const copy = [
      aiAuditIntroText(),
      aiAuditPurposeText(),
      aiAuditLogFormatLine({ schemaVersion: 'ad_strategy_diagnosis_v1', promptVersion: 'legacy_v0' }),
      aiAuditLogTitle({ promptKey: 'ad_strategy_diagnosis' }),
    ].join('\n');

    expect(copy).toContain('输出格式 广告策略诊断 v1');
    expect(copy).toContain('广告策略诊断');
    expect(copy).toContain('完整提示词');
    expect(copy).not.toContain('ad_strategy_diagnosis');
    expect(copy).not.toContain('schema');
    expect(copy).not.toContain('prompt');
  });
});

describe('settings AI connection status invalidation', () => {
  it('only resets connection test status when connection fields change', () => {
    expect(shouldResetAiTestForSettingsField('aiApiKey')).toBe(true);
    expect(shouldResetAiTestForSettingsField('aiBaseUrl')).toBe(true);
    expect(shouldResetAiTestForSettingsField('aiModel')).toBe(true);

    expect(shouldResetAiTestForSettingsField('aiTemperature')).toBe(false);
    expect(shouldResetAiTestForSettingsField('aiMaxTokens')).toBe(false);
    expect(shouldResetAiTestForSettingsField('aiOutputLanguage')).toBe(false);
    expect(shouldResetAiTestForSettingsField('aiPersona')).toBe(false);
  });
});

describe('aiSettingsActionHint', () => {
  it('explains why AI settings actions are disabled', () => {
    expect(aiSettingsActionHint({ canSaveSettings: false, keyPresent: false, canTestAi: false })).toBe('当前环境未接入设置保存接口，无法保存或清除 API Key。');
    expect(aiSettingsActionHint({ canSaveSettings: true, keyPresent: false, canTestAi: false })).toBe('填写 API Key 后才能测试连接。');
    expect(aiSettingsActionHint({ canSaveSettings: true, keyPresent: true, canTestAi: false })).toBe('当前环境未接入 AI 连接测试接口。');
    expect(aiSettingsActionHint({ canSaveSettings: true, keyPresent: true, canTestAi: true })).toBe('');
  });
});
