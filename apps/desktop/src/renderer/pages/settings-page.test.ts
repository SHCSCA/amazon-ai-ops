import { describe, expect, it } from 'vitest';
import {
  aiAuditIntroText,
  aiAuditLogFormatLine,
  aiAuditLogTitle,
  aiAuditPurposeText,
  aiSettingsActionHint,
  settingsAiConnectionFeedback,
  settingsAiContractPrimaryCopy,
  settingsAiContractTags,
  settingsSecondaryStatusMessage,
  settingsAiTaskTitle,
  settingsPrimaryAiStatusItems,
  settingsRuleConfigFieldFeedback,
  settingsRuleActionButtonView,
  settingsLocalActionButtonView,
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
    expect(copy).not.toContain('JSON');
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

describe('settings AI task feedback', () => {
  it('keeps the first-screen AI task focused on the next connection action', () => {
    expect(settingsAiTaskTitle({ status: 'unconfigured', keyPresent: false })).toBe('先填写 API Key 并保存');
    expect(settingsAiTaskTitle({ status: 'pending_test', keyPresent: true })).toBe('测试当前 AI 连接');
    expect(settingsAiTaskTitle({ status: 'available', keyPresent: true })).toBe('AI 连接已可用');
    expect(settingsAiTaskTitle({ status: 'failed', keyPresent: true })).toBe('AI 连接需要处理');
  });

  it('returns a stable live feedback bubble for testing and result states', () => {
    expect(settingsAiConnectionFeedback({
      status: 'testing',
      keyPresent: true,
      saving: false,
      message: '',
    })).toEqual({
      label: '正在测试 AI 连接',
      detail: '主进程正在用当前 Base URL、模型和脱敏 Key 做握手验证。',
      tone: 'pending',
    });

    expect(settingsAiConnectionFeedback({
      status: 'available',
      keyPresent: true,
      saving: false,
      message: '测试通过：DeepSeek-V3 握手成功，延迟 85ms。',
    })).toEqual({
      label: 'AI 连接测试通过',
      detail: '测试通过：DeepSeek-V3 握手成功，延迟 85ms。',
      tone: 'ready',
    });

    expect(settingsAiConnectionFeedback({
      status: 'failed',
      keyPresent: true,
      saving: false,
      message: 'AI 连接测试失败：401 Unauthorized',
    })).toEqual({
      label: 'AI 连接测试失败',
      detail: 'AI 连接测试失败：401 Unauthorized',
      tone: 'blocked',
    });
  });
});

describe('settings secondary status message', () => {
  it('keeps AI task feedback out of the duplicate bottom status panel', () => {
    expect(settingsSecondaryStatusMessage('AI 设置已保存。API Key 仅显示为已配置状态，不在页面展示明文。')).toBe('');
    expect(settingsSecondaryStatusMessage('AI 连接测试失败：401 Unauthorized')).toBe('');
    expect(settingsSecondaryStatusMessage('阈值保存失败：目标 ACOS 必须大于 0。')).toBe('阈值保存失败：目标 ACOS 必须大于 0。');
  });
});

describe('settings rule field feedback', () => {
  it('maps invalid threshold rules back to exact form rows', () => {
    expect(settingsRuleConfigFieldFeedback({
      targetAcos: 0.35,
      highAcosThreshold: 0.2,
      noOrderClickThreshold: 0,
      minSpend: -1,
      bidAdjustPercent: 0.3,
      maxBidDecrement: 0.2,
      enableAutoLowerBid: true,
      enableAutoAddNegative: true,
      brandWordWhitelist: [],
      coreWordWhitelist: [],
      maxCpc: 0,
      minCpc: 1,
    })).toMatchObject({
      highAcosThreshold: '高 ACOS 阈值不能低于目标 ACOS',
      noOrderClickThreshold: '无订单点击阈值必须至少为 1',
      minSpend: '最低花费不能为负数',
      maxBidDecrement: '最大降价比例不能低于单次降价比例',
      maxCpc: '最高 CPC 必须大于 0',
    });
  });

  it('keeps valid threshold rules free of field feedback', () => {
    expect(settingsRuleConfigFieldFeedback({
      targetAcos: 0.25,
      highAcosThreshold: 0.4,
      noOrderClickThreshold: 30,
      minSpend: 10,
      bidAdjustPercent: 0.12,
      maxBidDecrement: 0.35,
      enableAutoLowerBid: true,
      enableAutoAddNegative: true,
      brandWordWhitelist: [],
      coreWordWhitelist: [],
      maxCpc: 5,
      minCpc: 0.02,
    })).toEqual({});
  });
});

describe('settings rule action feedback', () => {
  it('gives rule save actions an explicit busy contract', () => {
    const saving = settingsRuleActionButtonView({
      active: true,
      baseClassName: 'primary-button',
      busyLabel: '保存中...',
      label: '保存广告阈值',
    });

    expect(saving.label).toBe('保存中...');
    expect(saving.className).toContain('button-loading');
    expect(saving.disabled).toBe(true);
    expect(saving.ariaBusy).toBe(true);
    expect(saving.showSpinner).toBe(true);

    const unavailable = settingsRuleActionButtonView({
      active: false,
      baseClassName: 'primary-button',
      busyLabel: '保存中...',
      disabled: true,
      label: '保存广告阈值',
    });

    expect(unavailable.disabled).toBe(true);
    expect(unavailable.ariaBusy).toBeUndefined();
    expect(unavailable.className).not.toContain('button-loading');
    expect(unavailable.showSpinner).toBe(false);
  });
});

describe('settings local utility action feedback', () => {
  it('marks only the active local utility action as busy', () => {
    const clearing = settingsLocalActionButtonView({
      action: 'clear-ai-key',
      activeAction: 'clear-ai-key',
      baseClassName: 'secondary-button',
      busyLabel: '清除中...',
      label: '清除本地 AI Key',
    });

    expect(clearing.label).toBe('清除中...');
    expect(clearing.className).toContain('button-loading');
    expect(clearing.disabled).toBe(true);
    expect(clearing.ariaBusy).toBe(true);
    expect(clearing.showSpinner).toBe(true);

    const lockedPeer = settingsLocalActionButtonView({
      action: 'copy-diagnostics',
      activeAction: 'clear-ai-key',
      baseClassName: 'secondary-button',
      busyLabel: '复制中...',
      label: '复制诊断检查清单',
    });

    expect(lockedPeer.label).toBe('复制诊断检查清单');
    expect(lockedPeer.disabled).toBe(true);
    expect(lockedPeer.ariaBusy).toBeUndefined();
    expect(lockedPeer.className).not.toContain('button-loading');
    expect(lockedPeer.showSpinner).toBe(false);
  });
});
