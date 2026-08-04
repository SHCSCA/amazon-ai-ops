import { describe, expect, it } from 'vitest';
import {
  createStoreScopedLoginCredentialStore,
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

describe('store-scoped login credential persistence', () => {
  it('does not expose Store A credentials while Store B is active', () => {
    const baseStore = new MemorySettingsStore();
    const storeA = createStoreScopedLoginCredentialStore(baseStore, 'store-a');
    const storeB = createStoreScopedLoginCredentialStore(baseStore, 'store-b');

    saveLoginCredentials(storeA, {
      username: 'seller-a@example.com',
      password: 'store-a-password',
      rememberPassword: true,
    }, cipher);

    expect(readSavedLoginCredentialStatus(storeB, cipher)).toEqual({
      username: '',
      rememberPassword: false,
      passwordAvailable: false,
      credentialState: 'none',
    });
    expect(() => resolveSavedLoginPassword(storeB, cipher, 'seller-a@example.com'))
      .toThrow();
  });

  it('preserves each store credential when switching A to B and back to A', () => {
    const baseStore = new MemorySettingsStore();
    const storeA = createStoreScopedLoginCredentialStore(baseStore, 'store-a');
    const storeB = createStoreScopedLoginCredentialStore(baseStore, 'store-b');

    saveLoginCredentials(storeA, {
      username: 'seller-a@example.com',
      password: 'store-a-password',
      rememberPassword: true,
    }, cipher);
    saveLoginCredentials(storeB, {
      username: 'seller-b@example.com',
      password: 'store-b-password',
      rememberPassword: true,
    }, cipher);

    expect(resolveSavedLoginPassword(storeB, cipher, 'seller-b@example.com'))
      .toBe('store-b-password');
    expect(resolveSavedLoginPassword(storeA, cipher, 'seller-a@example.com'))
      .toBe('store-a-password');
  });

  it('clears Store A without changing Store B credentials', () => {
    const baseStore = new MemorySettingsStore();
    const storeA = createStoreScopedLoginCredentialStore(baseStore, 'store-a');
    const storeB = createStoreScopedLoginCredentialStore(baseStore, 'store-b');
    saveLoginCredentials(storeA, {
      username: 'seller-a@example.com',
      password: 'store-a-password',
      rememberPassword: true,
    }, cipher);
    saveLoginCredentials(storeB, {
      username: 'seller-b@example.com',
      password: 'store-b-password',
      rememberPassword: true,
    }, cipher);

    saveLoginCredentials(storeA, {
      username: 'seller-a@example.com',
      rememberPassword: false,
    }, cipher);

    expect(readSavedLoginCredentialStatus(storeA, cipher)).toEqual({
      username: 'seller-a@example.com',
      rememberPassword: false,
      passwordAvailable: false,
      credentialState: 'none',
    });
    expect(resolveSavedLoginPassword(storeB, cipher, 'seller-b@example.com'))
      .toBe('store-b-password');
  });

  it('uses the shared normalized store ID for the credential namespace', () => {
    const baseStore = new MemorySettingsStore();
    const normalizedOnCreate = createStoreScopedLoginCredentialStore(baseStore, ' Store-A ');
    saveLoginCredentials(normalizedOnCreate, {
      username: 'seller-a@example.com',
      password: 'store-a-password',
      rememberPassword: true,
    }, cipher);

    const canonical = createStoreScopedLoginCredentialStore(baseStore, 'store-a');

    expect(resolveSavedLoginPassword(canonical, cipher, 'seller-a@example.com'))
      .toBe('store-a-password');
  });

  it('touches only canonical store-prefixed credential keys', () => {
    const baseStore = new MemorySettingsStore();
    const storeA = createStoreScopedLoginCredentialStore(baseStore, 'store-a');
    saveLoginCredentials(storeA, {
      username: 'seller-a@example.com',
      password: 'store-a-password',
      rememberPassword: true,
    }, cipher);

    expect([...baseStore.values.keys()].sort()).toEqual([
      'store_login_credentials:v1:store-a:login_password_encrypted',
      'store_login_credentials:v1:store-a:login_remember_password',
      'store_login_credentials:v1:store-a:login_username',
    ]);
    const before = [...baseStore.values.entries()];
    expect(() => storeA.set('ai_api_key', 'not-a-login-credential')).toThrow(
      'Unsupported login credential storage key',
    );
    expect([...baseStore.values.entries()]).toEqual(before);
  });

  it.each([
    '../store-a',
    'C:\\profiles\\store-a',
    'store/a',
    '',
  ])('rejects illegal or path-like store ID %j without writing', (storeId) => {
    const baseStore = new MemorySettingsStore();
    baseStore.set('unrelated', 'preserved');
    const before = [...baseStore.values.entries()];

    expect(() => createStoreScopedLoginCredentialStore(baseStore, storeId)).toThrow();
    expect([...baseStore.values.entries()]).toEqual(before);
  });

  it('does not leak or migrate unscoped legacy and encrypted credentials into a store', () => {
    const baseStore = new MemorySettingsStore();
    baseStore.set('login_username', 'global@example.com');
    baseStore.set('login_remember_password', 'true');
    baseStore.set('login_password_encrypted', 'global-ciphertext');
    baseStore.set('login_password', 'global-legacy-password');
    const before = [...baseStore.values.entries()];
    const storeA = createStoreScopedLoginCredentialStore(baseStore, 'store-a');

    expect(readSavedLoginCredentialStatus(storeA, cipher)).toEqual({
      username: '',
      rememberPassword: false,
      passwordAvailable: false,
      credentialState: 'none',
    });
    expect(() => resolveSavedLoginPassword(storeA, cipher, 'global@example.com')).toThrow();
    expect([...baseStore.values.entries()]).toEqual(before);
  });

  it('migrates a scoped legacy password without crossing into another store', () => {
    const baseStore = new MemorySettingsStore();
    const storeA = createStoreScopedLoginCredentialStore(baseStore, 'store-a');
    const storeB = createStoreScopedLoginCredentialStore(baseStore, 'store-b');
    storeA.set('login_username', 'legacy-a@example.com');
    storeA.set('login_password', 'legacy-store-a-password');

    expect(readSavedLoginCredentialStatus(storeA, cipher)).toEqual({
      username: 'legacy-a@example.com',
      rememberPassword: true,
      passwordAvailable: true,
      credentialState: 'migrated',
    });
    expect(storeA.get('login_password')).toBeNull();
    expect(resolveSavedLoginPassword(storeA, cipher, 'legacy-a@example.com'))
      .toBe('legacy-store-a-password');
    expect(readSavedLoginCredentialStatus(storeB, cipher).credentialState).toBe('none');
  });

  it('rolls back the complete scoped credential tuple when its transaction fails', () => {
    const baseStore = new MemorySettingsStore();
    const storeA = createStoreScopedLoginCredentialStore(baseStore, 'store-a');
    saveLoginCredentials(storeA, {
      username: 'old-a@example.com',
      password: 'old-store-a-password',
      rememberPassword: true,
    }, cipher);
    const before = [...baseStore.values.entries()];
    baseStore.failTransactionAfterWork = true;

    expect(() => saveLoginCredentials(storeA, {
      username: 'new-a@example.com',
      password: 'new-store-a-password',
      rememberPassword: true,
    }, cipher)).toThrow('simulated transaction failure');

    expect([...baseStore.values.entries()]).toEqual(before);
    expect(resolveSavedLoginPassword(storeA, cipher, 'old-a@example.com'))
      .toBe('old-store-a-password');
  });

  it('keeps scoped status and decryption errors free of password material and ciphertext', () => {
    const baseStore = new MemorySettingsStore();
    const storeA = createStoreScopedLoginCredentialStore(baseStore, 'store-a');
    const password = 'store-a-secret-material';
    saveLoginCredentials(storeA, {
      username: 'seller-a@example.com',
      password,
      rememberPassword: true,
    }, cipher);
    const ciphertext = storeA.get('login_password_encrypted')!;
    const leakyCipher: LoginCredentialCipher = {
      ...cipher,
      decrypt: () => {
        throw new Error(`unsafe boundary detail: ${password} ${ciphertext}`);
      },
    };

    const credentialStatus = readSavedLoginCredentialStatus(storeA, leakyCipher);
    let resolutionError: unknown;
    try {
      resolveSavedLoginPassword(storeA, leakyCipher, 'seller-a@example.com');
    } catch (error) {
      resolutionError = error;
    }
    const serializedStatus = JSON.stringify(credentialStatus);
    const errorMessage = resolutionError instanceof Error
      ? resolutionError.message
      : String(resolutionError);

    expect(credentialStatus.credentialState).toBe('encrypted_corrupt');
    expect(resolutionError).toBeInstanceOf(Error);
    expect(serializedStatus).not.toContain(password);
    expect(serializedStatus).not.toContain(ciphertext);
    expect(errorMessage).not.toContain(password);
    expect(errorMessage).not.toContain(ciphertext);
  });
});
