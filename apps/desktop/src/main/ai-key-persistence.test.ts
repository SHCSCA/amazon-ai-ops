import { describe, expect, it } from 'vitest';
import {
  readPersistedAiApiKey,
  resolveAiSettingsWithPersistedKey,
  savePersistedAiApiKey,
  stripPersistedAiApiKeyFields,
  type AiKeyCipher,
  type AiKeyStore,
} from './ai-key-persistence';
import { sanitizeAiSettingsForRenderer } from './ai-settings-normalization';

class MemoryAiKeyStore implements AiKeyStore {
  readonly values = new Map<string, string>();

  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.values.set(key, value);
  }

  delete(key: string): void {
    this.values.delete(key);
  }
}

const availableCipher: AiKeyCipher = {
  isEncryptionAvailable: () => true,
  encrypt: (value) => `enc:${Buffer.from(value, 'utf8').toString('base64')}`,
  decrypt: (value) => Buffer.from(value.replace(/^enc:/, ''), 'base64').toString('utf8'),
};

const unavailableCipher: AiKeyCipher = {
  isEncryptionAvailable: () => false,
  encrypt: () => {
    throw new Error('encryption unavailable');
  },
  decrypt: () => {
    throw new Error('encryption unavailable');
  },
};

const failingEncryptionCipher: AiKeyCipher = {
  isEncryptionAvailable: () => true,
  encrypt: () => {
    throw new Error('OS encryption failed');
  },
  decrypt: () => {
    throw new Error('OS decryption failed');
  },
};

describe('AI API key persistence', () => {
  it('migrates a legacy plaintext key to encrypted storage before returning it', () => {
    const store = new MemoryAiKeyStore();
    store.set('ai_api_key', 'sk-legacy-secret');

    expect(readPersistedAiApiKey(store, availableCipher)).toBe('sk-legacy-secret');
    expect(store.get('ai_api_key_encrypted')).toBe('enc:c2stbGVnYWN5LXNlY3JldA==');
    expect(store.get('ai_api_key')).toBeNull();
    expect(store.get('aiApiKey')).toBeNull();
  });

  it('decrypts an existing encrypted key without recreating plaintext aliases', () => {
    const store = new MemoryAiKeyStore();
    store.set('ai_api_key_encrypted', 'enc:c2stcGVyc2lzdGVkLXNlY3JldA==');

    expect(readPersistedAiApiKey(store, availableCipher)).toBe('sk-persisted-secret');
    expect(store.get('ai_api_key')).toBeNull();
    expect(store.get('aiApiKey')).toBeNull();
  });

  it('fails closed and removes legacy plaintext when encryption is unavailable', () => {
    const store = new MemoryAiKeyStore();
    store.set('ai_api_key', 'sk-must-not-fallback');
    store.set('aiApiKey', 'sk-must-not-fallback-alias');

    expect(readPersistedAiApiKey(store, unavailableCipher)).toBe('');
    expect(store.get('ai_api_key_encrypted')).toBeNull();
    expect(store.get('ai_api_key')).toBeNull();
    expect(store.get('aiApiKey')).toBeNull();
  });

  it('fails closed without crashing when legacy migration encryption fails', () => {
    const store = new MemoryAiKeyStore();
    store.set('ai_api_key', 'sk-migration-must-fail-closed');

    expect(readPersistedAiApiKey(store, failingEncryptionCipher)).toBe('');
    expect(store.get('ai_api_key_encrypted')).toBeNull();
    expect(store.get('ai_api_key')).toBeNull();
    expect(store.get('aiApiKey')).toBeNull();
  });

  it('saves a new key only in encrypted storage', () => {
    const store = new MemoryAiKeyStore();
    store.set('ai_api_key', 'sk-stale-plaintext');
    store.set('aiApiKey', 'sk-stale-plaintext-alias');

    savePersistedAiApiKey(store, '  sk-new-secret  ', availableCipher);

    expect(store.get('ai_api_key_encrypted')).toBe('enc:c2stbmV3LXNlY3JldA==');
    expect(store.get('ai_api_key')).toBeNull();
    expect(store.get('aiApiKey')).toBeNull();
    expect(readPersistedAiApiKey(store, availableCipher)).toBe('sk-new-secret');
  });

  it('rejects a new key when encryption is unavailable without retaining plaintext', () => {
    const store = new MemoryAiKeyStore();
    store.set('ai_api_key', 'sk-stale-plaintext');

    expect(() => savePersistedAiApiKey(store, 'sk-rejected-secret', unavailableCipher))
      .toThrow('不支持本机加密保存 AI Key');
    expect(store.get('ai_api_key_encrypted')).toBeNull();
    expect(store.get('ai_api_key')).toBeNull();
    expect(store.get('aiApiKey')).toBeNull();
  });

  it('strips every API key storage field before bulk-saving non-secret settings', () => {
    expect(stripPersistedAiApiKeyFields({
      ai_api_key: 'sk-snake-plaintext',
      aiApiKey: 'sk-camel-plaintext',
      ai_api_key_encrypted: 'untrusted-encrypted-value',
      ai_model: 'deepseek-v4-flash',
    })).toEqual({
      ai_model: 'deepseek-v4-flash',
    });
  });

  it('resolves the key for Main provider use while renderer output remains redacted', () => {
    const store = new MemoryAiKeyStore();
    store.set('ai_api_key_encrypted', 'enc:c2stcHJvdmlkZXItc2VjcmV0');

    const mainSettings = resolveAiSettingsWithPersistedKey({
      ai_api_key_encrypted: 'enc:c2stcHJvdmlkZXItc2VjcmV0',
      ai_model: 'deepseek-v4-flash',
    }, store, availableCipher);

    expect(mainSettings.aiApiKey).toBe('sk-provider-secret');
    expect(mainSettings.ai_api_key).toBe('sk-provider-secret');
    expect(mainSettings.ai_api_key_encrypted).toBeUndefined();
    const rendererSettings = sanitizeAiSettingsForRenderer(mainSettings);
    expect(rendererSettings.aiKeyConfigured).toBe(true);
    expect(rendererSettings.aiApiKey).toBe('');
    expect(JSON.stringify(rendererSettings)).not.toContain('sk-provider-secret');
  });
});
