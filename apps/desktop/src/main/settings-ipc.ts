import type { RuleConfig } from '@amazon-ai-ops/rules-engine';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { AiSettingsPersistenceOptions } from './ai-settings-persistence';
import {
  normalizeAiSettingsForSaveInput,
  normalizeAiSettingsForTestInput,
  sanitizeAiSettingsForRenderer,
} from './ai-settings-normalization';
import type { IpcHandlerRegistrar } from './store-ipc';

export interface SettingsAiTestResult {
  success: boolean;
  [key: string]: unknown;
}

export interface SettingsIpcPorts {
  readAiSettingsForMain(): Record<string, string>;
  persistAiSettingsForMain(settings: Record<string, string>, options: AiSettingsPersistenceOptions): void;
  resolveBusinessStoreAuthority(submittedContext?: unknown): { context: StoreContextEnvelope };
  handleTestAiSettings(settings: Record<string, unknown>, context: StoreContextEnvelope): Promise<SettingsAiTestResult>;
  handleListAiCallLogs(input: unknown): unknown;
  getRuleConfig(): RuleConfig;
  saveRuleConfig(config: unknown): void;
  handleGetOperationScope(context?: unknown): unknown;
  handleSaveOperationScope(input: unknown): unknown;
  handleGetStoragePaths(): unknown;
  onBusinessDataUpdated(): void;
}

export function registerSettingsIpcHandlers(
  trackedRegistrar: IpcHandlerRegistrar,
  ports: SettingsIpcPorts,
): void {
  trackedRegistrar.handle('settings:get', () => sanitizeAiSettingsForRenderer(ports.readAiSettingsForMain()));
  trackedRegistrar.handle('settings:save', (_event, input) => {
    const incoming = settingsRecord(input);
    ports.persistAiSettingsForMain(normalizeAiSettingsForSaveInput(incoming, ports.readAiSettingsForMain()), {
      clearApiKey: requestsAiKeyClear(incoming),
      ruleConfig: incoming.ruleConfig,
    });
    ports.onBusinessDataUpdated();
    return { success: true };
  });
  trackedRegistrar.handle('settings:test-ai', async (_event, input) => {
    const incoming = settingsRecord(input);
    if (!incoming.storeContext) throw new Error('AI 连接测试缺少当前店铺信息，请刷新设置页后重试。');
    const { context } = ports.resolveBusinessStoreAuthority(incoming.storeContext);
    const result = await ports.handleTestAiSettings(
      normalizeAiSettingsForTestInput(incoming, ports.readAiSettingsForMain()),
      context,
    );
    // 已返回的失败结果也可能保存测试状态和费用记录。
    ports.onBusinessDataUpdated();
    return result;
  });
  trackedRegistrar.handle('settings:ai-call-logs', (_event, input) => ports.handleListAiCallLogs(input));
  trackedRegistrar.handle('settings:get-rule-config', () => ports.getRuleConfig());
  trackedRegistrar.handle('settings:save-rule-config', (_event, input) => ports.saveRuleConfig(input));
  trackedRegistrar.handle('settings:get-operation-scope', (_event, input) => ports.handleGetOperationScope(input));
  trackedRegistrar.handle('settings:save-operation-scope', (_event, input) => ports.handleSaveOperationScope(input));
  trackedRegistrar.handle('settings:get-storage-paths', () => ports.handleGetStoragePaths());
}

function settingsRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function requestsAiKeyClear(input: Record<string, unknown>): boolean {
  const value = input.clearAiKey ?? input.clear_ai_key;
  if (typeof value === 'boolean') return value;
  return typeof value === 'string' && ['true', '1', 'yes'].includes(value.trim().toLowerCase());
}
