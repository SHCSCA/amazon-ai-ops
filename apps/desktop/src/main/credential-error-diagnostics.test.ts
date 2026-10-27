import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordCredentialFailure } from './credential-error-diagnostics';
import { readPersistedAiApiKey, type AiKeyStore } from './ai-key-persistence';
import { readSavedLoginCredentialStatus, resolveSavedLoginPassword, type LoginCredentialStore } from './login-credentials';
import { runtimeLogger } from './runtime-logger';

const secret = 'PASSWORD_AND_API_KEY_SECRET';
const ciphertext = 'safe:ENCRYPTED_PRIVATE_BYTES';
const leakyError = () => Object.assign(new Error(`${secret} ${ciphertext}`), {
  name: `${secret}-name`, code: `${secret}-code`, cause: { password: secret },
});
function logger() { return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }; }
function store(initial: Record<string, string> = {}): LoginCredentialStore & AiKeyStore {
  const values = new Map(Object.entries(initial));
  return { get: key => values.get(key) ?? null, set: (key, value) => { values.set(key, value); },
    delete: key => { values.delete(key); }, transaction: work => work() };
}
const cipher = { isEncryptionAvailable: () => true,
  encrypt: () => { throw leakyError(); }, decrypt: () => { throw leakyError(); } };

afterEach(() => { vi.restoreAllMocks(); });

describe('credential safe failure diagnostics', () => {
  it('records encrypted AI key read failure without disclosing original error fields', () => {
    const log = logger();
    expect(readPersistedAiApiKey(store({ ai_api_key_encrypted: ciphertext }), cipher, log)).toBe('');
    expect(log.warn).toHaveBeenCalledWith('security.credential_operation_failed', {
      operation: 'ai_key_decrypt', category: 'credential_operation_failed', errorName: 'Error',
    });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(ciphertext);
  });

  it('records AI migration storage failure and preserves fail closed plaintext removal', () => {
    const log = logger(); const data = store({ ai_api_key: secret });
    data.set = () => { throw Object.assign(leakyError(), { code: 'SQLITE_FULL' }); };
    expect(readPersistedAiApiKey(data, { ...cipher, encrypt: () => ciphertext }, log)).toBe('');
    expect(data.get('ai_api_key')).toBeNull();
    expect(log.warn).toHaveBeenCalledWith('security.credential_operation_failed', {
      operation: 'ai_key_migrate', category: 'credential_operation_failed', errorName: 'Error', code: 'SQLITE_FULL',
    });
  });

  it('records corrupt saved login decryption and keeps status and resolution secret free', () => {
    const log = logger(); const data = store({ login_username: 'operator', login_password_encrypted: ciphertext });
    expect(readSavedLoginCredentialStatus(data, cipher, log).credentialState).toBe('encrypted_corrupt');
    expect(() => resolveSavedLoginPassword(data, cipher, 'operator', log)).toThrow('保存的密码无法解密');
    expect(log.warn).toHaveBeenCalledWith('security.credential_operation_failed', {
      operation: 'login_decrypt', category: 'credential_operation_failed', errorName: 'Error',
    });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(ciphertext);
  });

  it('records login migration failure while preserving quarantined legacy data', () => {
    const log = logger(); const data = store({ login_username: 'operator', login_password: secret });
    expect(readSavedLoginCredentialStatus(data, cipher, log).credentialState).toBe('migration_failed');
    expect(data.get('login_password')).toBe(secret);
    expect(log.warn.mock.calls[0][1].operation).toBe('login_migrate');
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(secret);
  });

  it('records both credential cleanup transaction failures with fixed operations', () => {
    const log = logger(); const data = store({ login_remember_password: 'false' });
    data.transaction = () => { throw leakyError(); };
    expect(readSavedLoginCredentialStatus(data, cipher, log).credentialState).toBe('migration_failed');
    expect(log.warn.mock.calls[0][1].operation).toBe('login_clear');
    const legacy = store({ login_password_encrypted: ciphertext, login_password: secret });
    legacy.transaction = data.transaction;
    expect(readSavedLoginCredentialStatus(legacy, { ...cipher, decrypt: () => secret }, log).credentialState)
      .toBe('migration_failed');
    expect(log.warn.mock.calls[1][1].operation).toBe('login_remove_legacy');
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(secret);
  });

  it('records a second decryption failure while retaining the safe resolution error', () => {
    const log = logger(); let calls = 0;
    const data = store({ login_username: 'operator', login_password_encrypted: ciphertext });
    const changing = { ...cipher, decrypt: () => { if (++calls === 1) return secret; throw leakyError(); } };
    expect(() => resolveSavedLoginPassword(data, changing, 'operator', log)).toThrow('无法解密');
    expect(log.warn.mock.calls[0][1].operation).toBe('login_resolve');
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(secret);
  });

  it('does not invoke error getters and only accepts explicit safe code values', () => {
    const log = logger(); const error = new TypeError('private'); const getter = vi.fn(() => { throw leakyError(); });
    Object.defineProperties(error, { code: { get: getter }, name: { get: getter }, message: { get: getter } });
    recordCredentialFailure('login_migrate', error, log);
    expect(getter).not.toHaveBeenCalled();
    expect(log.warn.mock.calls[0][1]).toEqual({ operation: 'login_migrate',
      category: 'credential_operation_failed', errorName: 'TypeError' });
  });

  it('keeps safe business outcomes when the supplied diagnostic port fails', () => {
    const fallback = vi.spyOn(runtimeLogger, 'warn').mockImplementation(() => {});
    const log = logger(); log.warn.mockImplementation(() => { throw leakyError(); });
    expect(readPersistedAiApiKey(store({ ai_api_key_encrypted: ciphertext }), cipher, log)).toBe('');
    expect(fallback).toHaveBeenCalledWith('security.credential_diagnostic_delivery_failed', {
      operation: 'ai_key_decrypt', category: 'credential_operation_failed', errorName: 'Error',
    });
    expect(JSON.stringify(fallback.mock.calls)).not.toContain(secret);
  });

  it('keeps unavailable encryption capability as the expected non-error status', () => {
    const log = logger();
    expect(readSavedLoginCredentialStatus(store({ login_password_encrypted: ciphertext }), {
      ...cipher, isEncryptionAvailable: () => false,
    }, log).credentialState).toBe('encryption_unavailable');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('records an actual capability probe exception with safe fields and preserves unavailable status', () => {
    const log = logger(); const error = leakyError(); const getter = vi.fn(() => { throw leakyError(); });
    Object.defineProperties(error, { name: { get: getter }, code: { get: getter }, message: { get: getter } });
    const unavailable = { ...cipher, isEncryptionAvailable: () => { throw error; } };
    expect(readSavedLoginCredentialStatus(store({ login_password_encrypted: ciphertext }), unavailable, log).credentialState)
      .toBe('encryption_unavailable');
    expect(log.warn).toHaveBeenCalledWith('security.credential_operation_failed', {
      operation: 'login_capability', category: 'credential_operation_failed', errorName: 'Error',
    });
    expect(getter).not.toHaveBeenCalled();
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(ciphertext);
  });

  it('connects both confirmed and pending login persistence catches to the safe diagnostic port', () => {
    const source = fs.readFileSync(path.join(__dirname, 'main-browser-login-runtime.ts'), 'utf8');
    for (const operation of ['login_save_confirmed', 'login_save_pending']) {
      expect(source).toContain(`recordCredentialFailure('${operation}', error);`);
    }
    expect(source).not.toContain('recordCredentialFailure(rememberPassword');
  });
});
