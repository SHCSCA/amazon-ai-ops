import type { ConfigurationBus } from './configuration-bus';
import { savePersistedAiApiKey, stripPersistedAiApiKeyFields, type AiKeyCipher } from './ai-key-persistence';

export interface AiSettingsPersistenceOptions {
  clearApiKey?: boolean;
  ruleConfig?: unknown;
}

export function persistAiConfiguration(
  bus: ConfigurationBus,
  settings: Record<string, string>,
  cipher: AiKeyCipher,
  options: AiSettingsPersistenceOptions = {},
): void {
  bus.transaction(() => {
    const apiKey = String(settings.ai_api_key || settings.aiApiKey || '').trim();
    if (options.clearApiKey) savePersistedAiApiKey(bus, '', cipher);
    else if (apiKey) savePersistedAiApiKey(bus, apiKey, cipher);
    bus.save(stripPersistedAiApiKeyFields(settings));
    if (options.ruleConfig !== undefined) bus.saveRuleConfig(options.ruleConfig);
  });
}
