import { describe, expect, it } from 'vitest';
import {
  aiAuditIntroText,
  aiAuditLogFormatLine,
  aiAuditLogTitle,
  aiAuditPurposeText,
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
