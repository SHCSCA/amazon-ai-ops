import { describe, expect, it } from 'vitest';
import {
  aiAuditIntroText,
  aiAuditLogFormatLine,
  aiAuditLogTitle,
  aiAuditPurposeText,
  aiSettingsActionHint,
  settingsAiContractPrimaryCopy,
  settingsAiContractTags,
  settingsPrimaryAiStatusItems,
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
  it('keeps AI output contract copy concrete and non-JSON primary', () => {
    expect(settingsAiContractPrimaryCopy()).toBe('AI 输出合同由系统固定，页面只读取已校验字段；人设只影响表达风格，不改变字段结构。');
    expect(settingsAiContractPrimaryCopy()).not.toMatch(/\bJSON\b|schemaVersion/i);
    expect(settingsAiContractTags().map((item) => item.label)).toEqual([
      '广告诊断 v1',
      '广告解释 v1',
      'Listing 草案 v1',
      '异常回退规则',
    ]);
  });

  it('keeps the normal settings viewport focused on connection fields', () => {
    expect(settingsPrimaryAiStatusItems({
      aiBaseUrl: 'https://api.deepseek.com',
      aiModel: 'deepseek-v4-flash',
    }, 'pending_test', true)).toEqual([
      { label: 'API Key', value: '已配置（已隐藏）' },
      { label: 'Base URL', value: 'https://api.deepseek.com' },
      { label: 'Model', value: 'deepseek-v4-flash' },
      { label: '连接状态', value: '已配置，待测试' },
    ]);
  });

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
