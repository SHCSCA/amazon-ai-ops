import { describe, expect, it } from 'vitest';
import {
  readSavedLoginCredentials,
  saveLoginCredentials,
  type LoginCredentialCipher,
} from './login-credentials';

class MemorySettingsStore {
  values = new Map<string, string>();

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

const cipher: LoginCredentialCipher = {
  isEncryptionAvailable: () => true,
  encrypt: (value) => `enc:${Buffer.from(value, 'utf8').toString('base64')}`,
  decrypt: (value) => Buffer.from(value.replace(/^enc:/, ''), 'base64').toString('utf8'),
};

describe('login credential persistence', () => {
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
    expect(readSavedLoginCredentials(store, cipher)).toEqual({
      username: 'seller@example.com',
      password: 'secret-password',
      rememberPassword: true,
      passwordAvailable: true,
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
    expect(readSavedLoginCredentials(store, cipher)).toEqual({
      username: 'new@example.com',
      password: '',
      rememberPassword: false,
      passwordAvailable: false,
    });
  });
});
