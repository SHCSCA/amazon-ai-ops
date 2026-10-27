import type { Database } from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { ConfigurationBus, type ConfigurationChange } from './configuration-bus';
import { bindRuleConfiguration } from './rule-configuration';
import { persistAiConfiguration } from './ai-settings-persistence';
import { DEFAULT_RULE_CONFIG } from '@amazon-ai-ops/rules-engine';

class TransactionalSettingsDatabase {
  values = new Map<string, string>();
  failCommit = false;

  prepare(sql: string) {
    if (/SELECT value FROM app_settings/i.test(sql)) {
      return { get: (key: string) => this.values.has(key) ? { value: this.values.get(key) } : undefined };
    }
    if (/INSERT INTO app_settings/i.test(sql)) {
      return { run: (key: string, value: string) => { this.values.set(key, value); } };
    }
    if (/DELETE FROM app_settings/i.test(sql)) return { run: (key: string) => this.values.delete(key) };
    if (/SELECT key, value FROM app_settings/i.test(sql)) {
      return { all: () => [...this.values].map(([key, value]) => ({ key, value })) };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  transaction<T>(work: () => T) {
    return () => {
      const snapshot = new Map(this.values);
      try {
        const result = work();
        if (this.failCommit) throw new Error('commit failed');
        return result;
      } catch (error) {
        this.values = snapshot;
        throw error;
      }
    };
  }
}

function fixture() {
  const database = new TransactionalSettingsDatabase();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { database, logger, bus: new ConfigurationBus(database as unknown as Database, logger) };
}

describe('ConfigurationBus', () => {
  it('publishes committed nested changes only after the outer transaction completes', () => {
    const { bus } = fixture();
    const events: ConfigurationChange[] = [];
    bus.subscribe((event) => { events.push(event); });
    bus.transaction(() => {
      bus.set('outer', '1');
      bus.transaction(() => bus.set('inner', '2'));
      expect(events).toEqual([]);
    });
    expect(events.map((event) => [event.key, event.revision])).toEqual([['outer', 1], ['inner', 2]]);
    expect(events.every(Object.isFrozen)).toBe(true);
    expect(events[0]).not.toHaveProperty('value');
  });

  it('discards changes from an inner rollback without losing the outer transaction', () => {
    const { bus } = fixture();
    const observer = vi.fn();
    bus.subscribe(observer);
    bus.transaction(() => {
      bus.set('outer', '1');
      expect(() => bus.transaction(() => { bus.set('rolled_back', '2'); throw new Error('rollback'); })).toThrow('rollback');
    });
    expect(bus.get('rolled_back')).toBeNull();
    expect(observer.mock.calls.map(([event]) => event.key)).toEqual(['outer']);
  });

  it('publishes nothing when SQLite rejects the commit', () => {
    const { bus, database } = fixture();
    const observer = vi.fn();
    bus.subscribe(observer);
    database.failCommit = true;
    expect(() => bus.save({ key: 'value' })).toThrow('commit failed');
    expect(bus.get('key')).toBeNull();
    expect(observer).not.toHaveBeenCalled();
  });

  it('keeps revision order for every subscriber during reentrant writes', () => {
    const { bus } = fixture();
    const seen: number[] = [];
    bus.subscribe((event) => { if (event.key === 'first') bus.set('second', '2'); });
    bus.subscribe((event) => { seen.push(event.revision); });
    bus.set('first', '1');
    expect(seen).toEqual([1, 2]);
  });

  it('isolates synchronous and asynchronous subscriber errors', async () => {
    const { bus, logger } = fixture();
    const observer = vi.fn();
    bus.subscribe(() => { throw new Error('sync failure'); });
    bus.subscribe(async () => { throw new Error('async failure'); });
    const unsubscribe = bus.subscribe(observer);
    bus.set('key', 'value');
    await Promise.resolve();
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(observer).toHaveBeenCalledTimes(1);
    expect(bus.get('key')).toBe('value');
    unsubscribe();
    bus.delete('key');
    await Promise.resolve();
    expect(observer).toHaveBeenCalledTimes(1);
  });

  it('reserves login and AI secrets from bulk writes and notifications', () => {
    const { bus } = fixture();
    const observer = vi.fn();
    const protectedKeys = ['login_password', 'store_login_credentials:v1:store-a:login_username', 'ai_api_key', 'aiApiKey', 'ai_api_key_encrypted'];
    bus.subscribe(observer);
    bus.save(Object.fromEntries(protectedKeys.map((key) => [key, 'injected'])));
    for (const key of protectedKeys) {
      expect(bus.get(key)).toBeNull();
      bus.set(key, 'main-only-secret');
      bus.delete(key);
    }
    expect(observer).not.toHaveBeenCalled();
  });

  it('logs invalid persisted rule data and refuses non-object rule writes', () => {
    const { bus, logger } = fixture();
    bus.set('rule_config', '{broken');
    expect(bus.getRuleConfig()).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('configuration.parse_failed', expect.objectContaining({ key: 'rule_config' }));
    for (const value of [undefined, null, [], 'text']) expect(() => bus.saveRuleConfig(value)).toThrow();
    bus.saveRuleConfig({ limit: 2 });
    expect(bus.getRuleConfig()).toEqual({ limit: 2 });
  });

  it('rolls back key, model and rule changes together without publishing partial settings', () => {
    const { bus } = fixture();
    bus.set('ai_api_key_encrypted', 'old-ciphertext');
    bus.set('ai_model', 'old-model');
    const observer = vi.fn();
    bus.subscribe(observer);
    const cipher = { isEncryptionAvailable: () => true, encrypt: (value: string) => `enc:${value}`, decrypt: (value: string) => value };
    expect(() => persistAiConfiguration(bus, { ai_model: 'new-model' }, cipher, { clearApiKey: true, ruleConfig: null })).toThrow();
    expect(bus.get('ai_api_key_encrypted')).toBe('old-ciphertext');
    expect(bus.get('ai_model')).toBe('old-model');
    expect(observer).not.toHaveBeenCalled();
  });

  it('refreshes the rule consumer only after committed persistence and restores defaults on deletion', () => {
    const { bus } = fixture();
    const apply = vi.fn();
    const unbind = bindRuleConfiguration(bus, apply);
    expect(apply).toHaveBeenLastCalledWith(DEFAULT_RULE_CONFIG);
    const rules = { ...DEFAULT_RULE_CONFIG, targetAcos: 0.3 };
    bus.transaction(() => {
      bus.saveRuleConfig(rules);
      expect(apply).toHaveBeenCalledTimes(1);
    });
    expect(apply).toHaveBeenLastCalledWith(rules);
    bus.delete('rule_config');
    expect(apply).toHaveBeenLastCalledWith(DEFAULT_RULE_CONFIG);
    unbind();
    bus.saveRuleConfig(rules);
    expect(apply).toHaveBeenCalledTimes(3);
  });
});
