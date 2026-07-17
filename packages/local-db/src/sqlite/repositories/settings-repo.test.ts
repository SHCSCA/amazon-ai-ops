import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SettingsRepository } from './settings-repo';

class TransactionalSettingsDatabase {
  values = new Map<string, string>();

  prepare(sql: string) {
    if (/SELECT value FROM app_settings/i.test(sql)) {
      return {
        get: (key: string) => this.values.has(key) ? { value: this.values.get(key) } : undefined,
      };
    }
    if (/INSERT INTO app_settings/i.test(sql)) {
      return {
        run: (key: string, value: string) => {
          this.values.set(key, value);
          return {};
        },
      };
    }
    if (/DELETE FROM app_settings/i.test(sql)) {
      return {
        run: (key: string) => {
          this.values.delete(key);
          return {};
        },
      };
    }
    if (/SELECT key, value FROM app_settings/i.test(sql)) {
      return {
        all: () => Array.from(this.values, ([key, value]) => ({ key, value })),
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  transaction<T>(work: () => T) {
    return () => {
      const snapshot = new Map(this.values);
      try {
        return work();
      } catch (error) {
        this.values = snapshot;
        throw error;
      }
    };
  }
}

describe('SettingsRepository transactions', () => {
  it('rolls back every settings change when a credential transaction fails', () => {
    const database = new TransactionalSettingsDatabase();
    const repo = new SettingsRepository(database as unknown as Database.Database);
    repo.set('login_password', 'legacy-secret');

    expect(() => repo.transaction(() => {
      repo.set('login_password_encrypted', 'safe:encrypted');
      repo.delete('login_password');
      throw new Error('simulated commit failure');
    })).toThrow('simulated commit failure');

    expect(repo.get('login_password')).toBe('legacy-secret');
    expect(repo.get('login_password_encrypted')).toBeNull();
  });

  it('reserves the login credential namespace from generic bulk settings writes', () => {
    const database = new TransactionalSettingsDatabase();
    const repo = new SettingsRepository(database as unknown as Database.Database);

    repo.save({
      ai_model: 'deepseek-reasoner',
      login_username: 'attacker@example.com',
      login_password: 'plaintext-injection',
      login_password_encrypted: 'forged-ciphertext',
      login_remember_password: 'true',
    });

    expect(repo.get('ai_model')).toBe('deepseek-reasoner');
    expect(repo.get('login_username')).toBeNull();
    expect(repo.get('login_password')).toBeNull();
    expect(repo.get('login_password_encrypted')).toBeNull();
    expect(repo.get('login_remember_password')).toBeNull();
  });
});
