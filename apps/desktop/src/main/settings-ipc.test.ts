import Database from 'better-sqlite3';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from '@amazon-ai-ops/rules-engine';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { normalizeAiSettingsRecord } from './ai-settings-normalization';
import { persistAiConfiguration } from './ai-settings-persistence';
import { ConfigurationBus } from './configuration-bus';
import { MainIpcOperationTracker } from './main-ipc-operation-tracker';
import { bindRuleConfiguration } from './rule-configuration';
import { registerSettingsIpcHandlers, type SettingsIpcPorts } from './settings-ipc';
import { createTrackedIpcRegistrar } from './tracked-ipc-handler';

const context = normalizeStoreContextEnvelope({
  storeId: 'settings-test-store',
  browserProfileId: 'settings-test-profile',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-10-16',
  sessionGeneration: 3,
});

function fixture(overrides: Partial<SettingsIpcPorts> = {}) {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>();
  const ipc = { handle: (channel: string, listener: typeof handlers extends Map<string, infer V> ? V : never) => handlers.set(channel, listener) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const tracker = new MainIpcOperationTracker();
  const ports: SettingsIpcPorts = {
    readAiSettingsForMain: vi.fn(() => normalizeAiSettingsRecord({ aiApiKey: 'saved-private-key' })),
    persistAiSettingsForMain: vi.fn(),
    resolveBusinessStoreAuthority: vi.fn(() => ({ context })),
    handleTestAiSettings: vi.fn(async () => ({ success: true, message: 'available' })),
    handleListAiCallLogs: vi.fn(() => []),
    getRuleConfig: vi.fn(() => DEFAULT_RULE_CONFIG),
    saveRuleConfig: vi.fn(),
    handleGetOperationScope: vi.fn(() => null),
    handleSaveOperationScope: vi.fn(() => ({ success: true })),
    handleGetStoragePaths: vi.fn(() => ({ localDbPath: 'isolated-test.db' })),
    onBusinessDataUpdated: vi.fn(),
    ...overrides,
  };
  registerSettingsIpcHandlers({ handle: createTrackedIpcRegistrar(ipc as unknown as IpcMain, tracker, logger) }, ports);
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({} as IpcMainInvokeEvent, ...args);
  return { handlers, invoke, ports, logger, tracker };
}

describe('settings IPC registration', () => {
  it('registers the nine settings channels through the supplied tracked registrar', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'settings:get', 'settings:save', 'settings:test-ai', 'settings:ai-call-logs',
      'settings:get-rule-config', 'settings:save-rule-config',
      'settings:get-operation-scope', 'settings:save-operation-scope', 'settings:get-storage-paths',
    ]);
  });

  it('returns configured flags while keeping plaintext and encrypted keys out of the renderer response', async () => {
    const { invoke } = fixture({
      readAiSettingsForMain: () => ({ aiApiKey: 'private-key', ai_api_key_encrypted: 'private-ciphertext' }),
    });
    const result = await invoke('settings:get');
    expect(result).toMatchObject({ aiApiKey: '', ai_api_key: '', aiKeyConfigured: true, ai_key_configured: true });
    expect(result).not.toHaveProperty('ai_api_key_encrypted');
    expect(JSON.stringify(result)).not.toContain('private-');
  });

  it('normalizes a save and passes rules and key handling to the single persistence port before refresh', async () => {
    const { invoke, ports } = fixture();
    const rules = { ...DEFAULT_RULE_CONFIG, targetAcos: 0.31 };
    await expect(invoke('settings:save', { aiModel: ' test-model ', aiMaxTokens: '12', ruleConfig: rules })).resolves.toEqual({ success: true });
    expect(ports.persistAiSettingsForMain).toHaveBeenCalledWith(expect.objectContaining({
      aiModel: 'test-model', ai_model: 'test-model', aiApiKey: 'saved-private-key', aiMaxTokens: '8192',
    }), { clearApiKey: false, ruleConfig: rules });
    expect(ports.onBusinessDataUpdated).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ports.persistAiSettingsForMain).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(ports.onBusinessDataUpdated).mock.invocationCallOrder[0]);
  });

  it.each([undefined, null, false, 12, 'invalid', []])('normalizes a non-record save input %s to settings defaults', async (input) => {
    const { invoke, ports } = fixture();
    await expect(invoke('settings:save', input)).resolves.toEqual({ success: true });
    expect(ports.persistAiSettingsForMain).toHaveBeenCalledWith(expect.objectContaining({
      aiApiKey: 'saved-private-key', aiModel: 'deepseek-v4-flash',
    }), { clearApiKey: false, ruleConfig: undefined });
  });

  it.each([
    [{ clearAiKey: true }, true],
    [{ clear_ai_key: ' YES ' }, true],
    [{ clearAiKey: '1' }, true],
    [{ clearAiKey: 'false' }, false],
    [{ clearAiKey: false, clear_ai_key: true }, false],
  ])('preserves key clear aliases and precedence for %j', async (request, clearApiKey) => {
    const { invoke, ports } = fixture();
    await invoke('settings:save', request);
    expect(ports.persistAiSettingsForMain).toHaveBeenCalledWith(expect.objectContaining({
      aiApiKey: clearApiKey ? '' : 'saved-private-key',
      ai_api_key: clearApiKey ? '' : 'saved-private-key',
    }), { clearApiKey, ruleConfig: undefined });
  });

  it('logs persistence rejection through the real tracker without logging input or sending refresh', async () => {
    const failure = new Error('persistence rejected');
    const { invoke, ports, logger } = fixture({ persistAiSettingsForMain: () => { throw failure; } });
    await expect(invoke('settings:save', { aiApiKey: 'never-log-input' })).rejects.toBe(failure);
    expect(logger.error).toHaveBeenCalledWith('ipc.handler_failed', { channel: 'settings:save', error: failure });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('never-log-input');
    expect(ports.onBusinessDataUpdated).not.toHaveBeenCalled();
  });

  it('rejects all settings work when the shared tracker closes admission', async () => {
    const { tracker, invoke, ports } = fixture();
    await tracker.stopAndDrain();
    await expect(invoke('settings:get')).rejects.toMatchObject({ code: 'IPC_ADMISSION_CLOSED' });
    expect(ports.readAiSettingsForMain).not.toHaveBeenCalled();
  });
});

describe('settings AI test authority', () => {
  it.each([undefined, null, {}, { storeContext: null }])('rejects a request without explicit store context %j', async (input) => {
    const { invoke, ports } = fixture();
    await expect(invoke('settings:test-ai', input)).rejects.toThrow('AI 连接测试缺少当前店铺信息');
    expect(ports.resolveBusinessStoreAuthority).not.toHaveBeenCalled();
    expect(ports.readAiSettingsForMain).not.toHaveBeenCalled();
    expect(ports.handleTestAiSettings).not.toHaveBeenCalled();
    expect(ports.onBusinessDataUpdated).not.toHaveBeenCalled();
  });

  it('rejects stale store context before reading secrets or calling the test service', async () => {
    const failure = new Error('STORE_CONTEXT_STALE');
    const staleContext = { ...context, sessionGeneration: 2 };
    const { invoke, ports, logger } = fixture({ resolveBusinessStoreAuthority: () => { throw failure; } });
    await expect(invoke('settings:test-ai', { storeContext: staleContext })).rejects.toBe(failure);
    expect(ports.readAiSettingsForMain).not.toHaveBeenCalled();
    expect(ports.handleTestAiSettings).not.toHaveBeenCalled();
    expect(ports.onBusinessDataUpdated).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('ipc.handler_failed', { channel: 'settings:test-ai', error: failure });
  });

  it('uses the authority-resolved context and saved key before publishing a successful result', async () => {
    const submitted = { submittedContext: true };
    const result = { success: true, message: 'available', usage: { totalTokens: 3 } };
    const { invoke, ports } = fixture({ handleTestAiSettings: vi.fn(async () => result) });
    await expect(invoke('settings:test-ai', { storeContext: submitted, aiModel: 'test-model', aiApiKey: '' })).resolves.toBe(result);
    expect(ports.resolveBusinessStoreAuthority).toHaveBeenCalledWith(submitted);
    expect(ports.handleTestAiSettings).toHaveBeenCalledWith(expect.objectContaining({
      aiModel: 'test-model', aiApiKey: 'saved-private-key',
    }), context);
    expect(ports.onBusinessDataUpdated).toHaveBeenCalledTimes(1);
  });

  it('forwards an explicit test key without changing the saved key through the save port', async () => {
    const { invoke, ports } = fixture();
    await invoke('settings:test-ai', { storeContext: context, aiApiKey: 'temporary-private-key' });
    expect(ports.handleTestAiSettings).toHaveBeenCalledWith(expect.objectContaining({ aiApiKey: 'temporary-private-key' }), context);
    expect(ports.persistAiSettingsForMain).not.toHaveBeenCalled();
  });

  it('refreshes persisted test status and call records when the service returns failure', async () => {
    const result = { success: false, message: 'connection unavailable' };
    const persisted = { status: 'unknown', callRecords: 0 };
    const { invoke, ports } = fixture({ handleTestAiSettings: async () => {
      persisted.status = 'failed';
      persisted.callRecords += 1;
      return result;
    } });
    await expect(invoke('settings:test-ai', { storeContext: context })).resolves.toBe(result);
    expect(persisted).toEqual({ status: 'failed', callRecords: 1 });
    expect(ports.onBusinessDataUpdated).toHaveBeenCalledTimes(1);
  });

  it('preserves service rejection and does not notify business data consumers', async () => {
    const failure = new Error('connection rejected');
    const { invoke, ports } = fixture({ handleTestAiSettings: async () => { throw failure; } });
    await expect(invoke('settings:test-ai', { storeContext: context })).rejects.toBe(failure);
    expect(ports.onBusinessDataUpdated).not.toHaveBeenCalled();
  });
});

describe('settings delegated ports', () => {
  it('forwards rule, scope, call log and path inputs and results without rewriting scope', async () => {
    const rules = { ...DEFAULT_RULE_CONFIG, targetAcos: 0.29 };
    const request = { storeContext: context, scope: { asin: 'test-only-asin' } };
    const logs = { limit: 7 };
    const { invoke, ports } = fixture();
    await expect(invoke('settings:get-rule-config')).resolves.toBe(DEFAULT_RULE_CONFIG);
    await expect(invoke('settings:save-rule-config', rules)).resolves.toBeUndefined();
    expect(ports.saveRuleConfig).toHaveBeenCalledWith(rules);
    await invoke('settings:get-operation-scope', context);
    expect(ports.handleGetOperationScope).toHaveBeenCalledWith(context);
    await invoke('settings:get-operation-scope');
    expect(ports.handleGetOperationScope).toHaveBeenLastCalledWith(undefined);
    await expect(invoke('settings:save-operation-scope', request)).resolves.toEqual({ success: true });
    expect(ports.handleSaveOperationScope).toHaveBeenCalledWith(request);
    await expect(invoke('settings:ai-call-logs', logs)).resolves.toEqual([]);
    expect(ports.handleListAiCallLogs).toHaveBeenCalledWith(logs);
    await expect(invoke('settings:get-storage-paths')).resolves.toEqual({ localDbPath: 'isolated-test.db' });
    expect(ports.onBusinessDataUpdated).not.toHaveBeenCalled();
  });

  it('commits settings, encrypted key and rules together and updates the subscribed consumer immediately', async () => {
    const database = new Database(':memory:');
    database.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
    const bus = new ConfigurationBus(database, { info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    let currentRules: RuleConfig = DEFAULT_RULE_CONFIG;
    const unbind = bindRuleConfiguration(bus, (rules) => { currentRules = rules; });
    const cipher = { isEncryptionAvailable: () => true, encrypt: (value: string) => `test-encrypted:${value}`, decrypt: (value: string) => value };
    const { invoke, ports } = fixture({
      persistAiSettingsForMain: (settings, options) => persistAiConfiguration(bus, settings, cipher, options),
      getRuleConfig: () => currentRules,
      saveRuleConfig: (rules) => bus.saveRuleConfig(rules),
    });
    try {
      const combinedRules = { ...DEFAULT_RULE_CONFIG, targetAcos: 0.27 };
      await invoke('settings:save', { aiModel: 'committed-model', aiApiKey: 'private-key', ruleConfig: combinedRules });
      expect(bus.get('ai_model')).toBe('committed-model');
      expect(bus.get('ai_api_key_encrypted')).toBe('test-encrypted:private-key');
      expect(bus.get('ai_api_key')).toBeNull();
      expect(bus.get('aiApiKey')).toBeNull();
      await expect(invoke('settings:get-rule-config')).resolves.toEqual(combinedRules);
      const directRules = { ...DEFAULT_RULE_CONFIG, targetAcos: 0.24 };
      await invoke('settings:save-rule-config', directRules);
      expect(currentRules).toEqual(directRules);
      await expect(invoke('settings:save', {
        aiModel: 'rolled-back-model', clearAiKey: true, ruleConfig: null,
      })).rejects.toThrow('规则配置必须是 JSON 对象');
      expect(bus.get('ai_model')).toBe('committed-model');
      expect(bus.get('ai_api_key_encrypted')).toBe('test-encrypted:private-key');
      expect(currentRules).toEqual(directRules);
      expect(ports.onBusinessDataUpdated).toHaveBeenCalledTimes(1);
    } finally {
      unbind();
      database.close();
    }
  });
});
