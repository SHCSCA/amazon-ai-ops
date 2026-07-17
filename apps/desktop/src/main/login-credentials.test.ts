import { describe, expect, it } from 'vitest';
import {
  LEGACY_LOGIN_MIGRATION_MARKER,
  readSavedLoginCredentialStatus,
  resolveSavedLoginPassword,
  saveLoginCredentials,
  type LoginCredentialCipher,
} from './login-credentials';

class MemorySettingsStore {
  values = new Map<string, string>();
  failTransactionAfterWork = false;

  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.values.set(key, value);
  }

  delete(key: string): void {
    this.values.delete(key);
  }

  transaction<T>(work: () => T): T {
    const snapshot = new Map(this.values);
    try {
      const result = work();
      if (this.failTransactionAfterWork) {
        this.failTransactionAfterWork = false;
        throw new Error('simulated transaction failure');
      }
      return result;
    } catch (error) {
      this.values = snapshot;
      throw error;
    }
  }
}

const cipher: LoginCredentialCipher = {
  isEncryptionAvailable: () => true,
  encrypt: (value) => `enc:${Buffer.from(value, 'utf8').toString('base64')}`,
  decrypt: (value) => Buffer.from(value.replace(/^enc:/, ''), 'base64').toString('utf8'),
};

describe('login credential persistence', () => {
  it('exposes the stable package-evidence migration marker', () => {
    expect(LEGACY_LOGIN_MIGRATION_MARKER).toBe('amazon-ai-ops:legacy-login-migration/v1');
  });

  it('migrates a legacy password without a remember flag before reporting it available', () => {
    const store = new MemorySettingsStore();
    store.set('login_username', 'legacy@example.com');
    store.set('login_password', 'legacy-password');

    expect(readSavedLoginCredentialStatus(store, cipher)).toEqual({
      username: 'legacy@example.com',
      rememberPassword: true,
      passwordAvailable: true,
      credentialState: 'migrated',
    });
    expect(store.get('login_password_encrypted')).toBe('enc:bGVnYWN5LXBhc3N3b3Jk');
    expect(store.get('login_password')).toBeNull();
    expect(store.get('login_remember_password')).toBe('true');
  });

  it('keeps legacy plaintext quarantined when encryption is unavailable', () => {
    const store = new MemorySettingsStore();
    store.set('login_username', 'legacy@example.com');
    store.set('login_password', 'must-not-cross-ipc');
    const unavailableCipher: LoginCredentialCipher = {
      isEncryptionAvailable: () => false,
      encrypt: () => { throw new Error('must not encrypt'); },
      decrypt: () => { throw new Error('must not decrypt'); },
    };

    const result = readSavedLoginCredentialStatus(store, unavailableCipher);

    expect(result).toEqual({
      username: 'legacy@example.com',
      rememberPassword: true,
      passwordAvailable: false,
      credentialState: 'encryption_unavailable',
    });
    expect(result).not.toHaveProperty('password');
    expect(store.get('login_password')).toBe('must-not-cross-ipc');
    expect(store.get('login_password_encrypted')).toBeNull();
  });

  it('rolls back migration and keeps legacy plaintext quarantined when commit fails', () => {
    const store = new MemorySettingsStore();
    store.set('login_username', 'legacy@example.com');
    store.set('login_password', 'legacy-password');
    store.failTransactionAfterWork = true;

    expect(readSavedLoginCredentialStatus(store, cipher)).toEqual({
      username: 'legacy@example.com',
      rememberPassword: true,
      passwordAvailable: false,
      credentialState: 'migration_failed',
    });
    expect(store.get('login_password')).toBe('legacy-password');
    expect(store.get('login_password_encrypted')).toBeNull();
    expect(store.get('login_remember_password')).toBeNull();
  });

  it('repairs corrupt encrypted storage from legacy plaintext without exposing it', () => {
    const store = new MemorySettingsStore();
    store.set('login_username', 'legacy@example.com');
    store.set('login_remember_password', 'true');
    store.set('login_password_encrypted', 'corrupt-ciphertext');
    store.set('login_password', 'legacy-password');
    const repairingCipher: LoginCredentialCipher = {
      ...cipher,
      decrypt: (value) => {
        if (value === 'corrupt-ciphertext') throw new Error('cannot decrypt');
        return cipher.decrypt(value);
      },
    };

    const result = readSavedLoginCredentialStatus(store, repairingCipher);

    expect(result).toEqual({
      username: 'legacy@example.com',
      rememberPassword: true,
      passwordAvailable: true,
      credentialState: 'migrated',
    });
    expect(result).not.toHaveProperty('password');
    expect(store.get('login_password_encrypted')).toBe('enc:bGVnYWN5LXBhc3N3b3Jk');
    expect(store.get('login_password')).toBeNull();
  });

  it('fails closed when a valid encrypted credential cannot clean up its legacy duplicate', () => {
    const store = new MemorySettingsStore();
    store.set('login_username', 'seller@example.com');
    store.set('login_remember_password', 'true');
    store.set('login_password_encrypted', 'enc:c2F2ZWQtcGFzc3dvcmQ=');
    store.set('login_password', 'stale-legacy-password');
    store.failTransactionAfterWork = true;

    expect(readSavedLoginCredentialStatus(store, cipher)).toEqual({
      username: 'seller@example.com',
      rememberPassword: true,
      passwordAvailable: false,
      credentialState: 'migration_failed',
    });
    expect(store.get('login_password')).toBe('stale-legacy-password');
    expect(store.get('login_password_encrypted')).toBe('enc:c2F2ZWQtcGFzc3dvcmQ=');
  });

  it('requires password re-entry when encrypted storage is corrupt and no legacy value exists', () => {
    const store = new MemorySettingsStore();
    store.set('login_username', 'seller@example.com');
    store.set('login_remember_password', 'true');
    store.set('login_password_encrypted', 'corrupt-ciphertext');
    const corruptCipher: LoginCredentialCipher = {
      ...cipher,
      decrypt: () => { throw new Error('cannot decrypt'); },
    };

    expect(readSavedLoginCredentialStatus(store, corruptCipher)).toEqual({
      username: 'seller@example.com',
      rememberPassword: true,
      passwordAvailable: false,
      credentialState: 'encrypted_corrupt',
    });
    expect(() => resolveSavedLoginPassword(store, corruptCipher, 'seller@example.com'))
      .toThrow('无法解密');
    expect(store.get('login_password_encrypted')).toBe('corrupt-ciphertext');
  });

  it('migrates idempotently and resolves the password only through the Main-only resolver', () => {
    const store = new MemorySettingsStore();
    store.set('login_username', 'seller@example.com');
    store.set('login_password', 'legacy-password');
    let encryptCalls = 0;
    const countingCipher: LoginCredentialCipher = {
      ...cipher,
      encrypt: (value) => {
        encryptCalls += 1;
        return cipher.encrypt(value);
      },
    };

    expect(readSavedLoginCredentialStatus(store, countingCipher).credentialState).toBe('migrated');
    expect(readSavedLoginCredentialStatus(store, countingCipher).credentialState).toBe('encrypted_ready');
    expect(encryptCalls).toBe(1);
    expect(resolveSavedLoginPassword(store, countingCipher, 'seller@example.com')).toBe('legacy-password');
    expect(() => resolveSavedLoginPassword(store, countingCipher, 'other@example.com'))
      .toThrow('账号与当前账号不一致');
  });

  it('keeps every legacy field unchanged when encryption throws before migration', () => {
    const store = new MemorySettingsStore();
    store.set('login_username', 'legacy@example.com');
    store.set('login_password', 'legacy-password');
    const failingCipher: LoginCredentialCipher = {
      isEncryptionAvailable: () => true,
      encrypt: () => { throw new Error('OS encryption failed'); },
      decrypt: () => { throw new Error('OS decryption failed'); },
    };

    expect(readSavedLoginCredentialStatus(store, failingCipher).credentialState).toBe('migration_failed');
    expect(store.get('login_password')).toBe('legacy-password');
    expect(store.get('login_password_encrypted')).toBeNull();
    expect(store.get('login_remember_password')).toBeNull();
  });

  it('cleans stale password keys when an explicit remember false setting is read', () => {
    const store = new MemorySettingsStore();
    store.set('login_username', 'seller@example.com');
    store.set('login_remember_password', 'false');
    store.set('login_password', 'stale-legacy');
    store.set('login_password_encrypted', 'enc:c3RhbGU=');

    expect(readSavedLoginCredentialStatus(store, cipher)).toEqual({
      username: 'seller@example.com',
      rememberPassword: false,
      passwordAvailable: false,
      credentialState: 'none',
    });
    expect(store.get('login_password')).toBeNull();
    expect(store.get('login_password_encrypted')).toBeNull();
  });

  it('fails closed without leaking or partially deleting when explicit remember false cleanup cannot commit', () => {
    const store = new MemorySettingsStore();
    store.set('login_username', 'seller@example.com');
    store.set('login_remember_password', 'false');
    store.set('login_password', 'stale-legacy');
    store.set('login_password_encrypted', 'enc:c3RhbGU=');
    store.failTransactionAfterWork = true;

    const result = readSavedLoginCredentialStatus(store, cipher);

    expect(result).toEqual({
      username: 'seller@example.com',
      rememberPassword: false,
      passwordAvailable: false,
      credentialState: 'migration_failed',
    });
    expect(result).not.toHaveProperty('password');
    expect(store.get('login_password')).toBe('stale-legacy');
    expect(store.get('login_password_encrypted')).toBe('enc:c3RhbGU=');
    expect(store.get('login_remember_password')).toBe('false');
  });

  it('leaves the previous credential tuple intact when a new encrypted save cannot commit', () => {
    const store = new MemorySettingsStore();
    store.set('login_username', 'old@example.com');
    store.set('login_remember_password', 'true');
    store.set('login_password', 'legacy-password');
    store.failTransactionAfterWork = true;

    expect(() => saveLoginCredentials(store, {
      username: 'new@example.com',
      password: 'new-password',
      rememberPassword: true,
    }, cipher)).toThrow('simulated transaction failure');

    expect(store.get('login_username')).toBe('old@example.com');
    expect(store.get('login_remember_password')).toBe('true');
    expect(store.get('login_password')).toBe('legacy-password');
    expect(store.get('login_password_encrypted')).toBeNull();
  });

  it('stores remembered credentials with an encrypted password', () => {
    const store = new MemorySettingsStore();

    saveLoginCredentials(store, {
      username: 'seller@example.com',
      password: 'secret-password',
      rememberPassword: true,
    }, cipher);

    expect(store.get('login_username')).toBe('seller@example.com');
    expect(store.get('login_remember_password')).toBe('true');
    expect(store.get('login_password_encrypted')).toBe('enc:c2VjcmV0LXBhc3N3b3Jk');
    expect(store.get('login_password')).toBeNull();
    expect(readSavedLoginCredentialStatus(store, cipher)).toEqual({
      username: 'seller@example.com',
      rememberPassword: true,
      passwordAvailable: true,
      credentialState: 'encrypted_ready',
    });
  });

  it('clears saved passwords when remember password is disabled', () => {
    const store = new MemorySettingsStore();
    store.set('login_username', 'old@example.com');
    store.set('login_password', 'legacy-plain-password');
    store.set('login_password_encrypted', 'enc:b2xkLXBhc3N3b3Jk');
    store.set('login_remember_password', 'true');

    saveLoginCredentials(store, {
      username: 'new@example.com',
      password: 'new-password',
      rememberPassword: false,
    }, cipher);

    expect(store.get('login_username')).toBe('new@example.com');
    expect(store.get('login_remember_password')).toBe('false');
    expect(store.get('login_password')).toBeNull();
    expect(store.get('login_password_encrypted')).toBeNull();
    expect(readSavedLoginCredentialStatus(store, cipher)).toEqual({
      username: 'new@example.com',
      rememberPassword: false,
      passwordAvailable: false,
      credentialState: 'none',
    });
  });
});
