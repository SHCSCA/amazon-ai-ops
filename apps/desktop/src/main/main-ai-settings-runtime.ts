import { type AIConfig } from '@amazon-ai-ops/ai-adapter';
import { createGovernedAiProvider } from './ai-spend-governance';
import type { PaidAiPurpose } from '@amazon-ai-ops/shared-types';
import { persistAiConfiguration, type AiSettingsPersistenceOptions } from './ai-settings-persistence';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { resolveAiSettingsWithPersistedKey } from './ai-key-persistence';
import { normalizeAiSettingsRecord } from './ai-settings-normalization';
import { buildSystemAiProviderConfig, resolveSystemAiRuntimeConfig } from './system-ai-runtime-config';
import { resolveBusinessStoreAuthority } from './main-business-scope-runtime';
import { getMainRuntimeContext } from './main-runtime-access';

export function readAiSettingsForMain(): Record<string, string> {
  const mainRuntimeContext = getMainRuntimeContext();
  const repo = mainRuntimeContext.state.configurationBus;
  if (!repo) return normalizeAiSettingsRecord({});
  return normalizeAiSettingsRecord(
    resolveAiSettingsWithPersistedKey(repo.getAll(), repo, mainRuntimeContext.electronLoginCredentialCipher),
  );
}

export function persistAiSettingsForMain(
  settings: Record<string, string>,
  options: AiSettingsPersistenceOptions = {},
): void {
  const mainRuntimeContext = getMainRuntimeContext();
  const repo = mainRuntimeContext.state.configurationBus;
  if (!repo) return;
  persistAiConfiguration(repo, settings, mainRuntimeContext.electronLoginCredentialCipher, options);
}

export function stringSetting(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAiSettings(settings: Record<string, unknown>): Record<string, string> {
  return normalizeAiSettingsRecord(settings);
}

export function buildAiProviderConfig(settings: Record<string, unknown>) {
  return buildSystemAiProviderConfig(resolveSystemAiRuntimeConfig(settings));
}

export function governedAiProvider(config: AIConfig, context: StoreContextEnvelope, purpose: PaidAiPurpose, automatic = true) {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.aiCallLogRepo || !mainRuntimeContext.state.storeCoordinator) throw new Error('AI 费用服务尚未初始化。');
  return createGovernedAiProvider({ config, context, purpose, automatic, repository: mainRuntimeContext.state.aiCallLogRepo,
    assertCurrentContext: captured => mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(captured) });
}

export async function handleTestAiSettings(settings: Record<string, unknown>, context: StoreContextEnvelope) {
  const mainRuntimeContext = getMainRuntimeContext();
  mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(context);
  const runtime = resolveSystemAiRuntimeConfig(settings || {});
  const config = buildSystemAiProviderConfig(runtime);
  function persistTestStatus(status: 'available' | 'failed', message: string) {
    const testedAt = new Date().toISOString();
    persistAiSettingsForMain({
      aiProvider: runtime.provider,
      ai_provider: runtime.provider,
      aiApiKey: config.apiKey,
      ai_api_key: config.apiKey,
      aiBaseUrl: config.baseUrl,
      ai_base_url: config.baseUrl,
      aiModel: config.model,
      ai_model: config.model,
      aiTemperature: String(config.temperature),
      ai_temperature: String(config.temperature),
      aiMaxTokens: String(config.maxTokens),
      ai_max_tokens: String(config.maxTokens),
      aiOutputLanguage: normalizeAiSettings(settings).aiOutputLanguage,
      ai_output_language: normalizeAiSettings(settings).ai_output_language,
      aiPersona: normalizeAiSettings(settings).aiPersona,
      ai_persona: normalizeAiSettings(settings).ai_persona,
      aiLastTestStatus: status,
      ai_last_test_status: status,
      aiLastTestAt: testedAt,
      ai_last_test_at: testedAt,
      aiLastTestBaseUrl: config.baseUrl,
      ai_last_test_base_url: config.baseUrl,
      aiLastTestModel: config.model,
      ai_last_test_model: config.model,
      aiLastTestMessage: message,
      ai_last_test_message: message,
    });
  }

  if (!config.apiKey.trim()) {
    const message = '未配置 AI Key：请填写 DeepSeek 或 OpenAI 兼容 API Key 后再测试。';
    return {
      success: false,
      message,
      baseUrl: config.baseUrl,
      model: config.model,
    };
  }

  const provider = governedAiProvider(config, context, 'connection_test', false);
  const response = await provider.complete('只回复 ok，用于连接测试。', {
    model: config.model,
    temperature: 0,
    maxTokens: 32,
  });

  if (!response.success || !response.content) {
    response.reportOutput?.('invalid');
    const message = summarizeAiError(response.error || 'AI 未返回内容');
    persistTestStatus('failed', message);
    return {
      success: false,
      message,
      baseUrl: config.baseUrl,
      model: config.model,
    };
  }

  const message = `AI 连接测试通过：${config.model}`;
  response.reportOutput?.('accepted');
  persistTestStatus('available', message);
  return {
    success: true,
    message,
    baseUrl: config.baseUrl,
    model: config.model,
    usage: response.usage,
  };
}

export function handleListAiCallLogs(request: any = {}) {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.aiCallLogRepo) return [];
  const { context } = resolveBusinessStoreAuthority();
  const limit = Number.isFinite(Number(request.limit)) ? Math.max(1, Math.min(20, Number(request.limit))) : 5;
  return mainRuntimeContext.state.aiCallLogRepo.findRecentForStore(context.storeId, limit);
}

export function summarizeAiError(error: string): string {
  const firstLine = String(error || '').split(/\r?\n/).find(Boolean) || '未知错误';
  if (/401|unauthorized|invalid api key/i.test(firstLine)) {
    return 'AI 连接失败：API Key 无效或没有权限。';
  }
  if (/429|rate limit|quota/i.test(firstLine)) {
    return 'AI 连接失败：额度不足或请求频率过高。';
  }
  if (/network|fetch|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(firstLine)) {
    return 'AI 连接失败：网络或 Base URL 不可达。';
  }
  return `AI 连接失败：${firstLine.slice(0, 240)}`;
}
