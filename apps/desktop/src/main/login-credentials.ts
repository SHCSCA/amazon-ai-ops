import { normalizeStoreId } from '@amazon-ai-ops/shared-types';

export const LEGACY_LOGIN_MIGRATION_MARKER = 'amazon-ai-ops:legacy-login-migration/v1';

export interface LoginCredentialStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
  transaction<T>(work: () => T): T;
}

export interface LoginCredentialCipher {
  isEncryptionAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export interface SaveLoginCredentialsInput {
  username: string;
  password?: string;
  rememberPassword?: boolean;
}

export type LoginCredentialState =
  | 'none'
  | 'encrypted_ready'
  | 'migrated'
  | 'encryption_unavailable'
  | 'encrypted_corrupt'
  | 'migration_failed';

export interface SavedLoginCredentialStatus {
  username: string;
  rememberPassword: boolean;
  passwordAvailable: boolean;
  credentialState: LoginCredentialState;
}

const LOGIN_USERNAME_KEY = 'login_username';
const LOGIN_REMEMBER_PASSWORD_KEY = 'login_remember_password';
const LOGIN_PASSWORD_ENCRYPTED_KEY = 'login_password_encrypted';
const LEGACY_LOGIN_PASSWORD_KEY = 'login_password';
const STORE_LOGIN_CREDENTIAL_KEY_PREFIX = 'store_login_credentials:v1';
const LOGIN_CREDENTIAL_KEYS = new Set<string>([
  LOGIN_USERNAME_KEY,
  LOGIN_REMEMBER_PASSWORD_KEY,
  LOGIN_PASSWORD_ENCRYPTED_KEY,
  LEGACY_LOGIN_PASSWORD_KEY,
]);

/**
 * Adapt the existing Main-only credential flow to one logical store namespace.
 */
export function createStoreScopedLoginCredentialStore(
  baseStore: LoginCredentialStore,
  storeIdInput: unknown,
): LoginCredentialStore {
  const storeId = normalizeStoreId(storeIdInput);
  const keyPrefix = `${STORE_LOGIN_CREDENTIAL_KEY_PREFIX}:${storeId}:`;

  const scopedKey = (key: string): string => {
    if (!LOGIN_CREDENTIAL_KEYS.has(key)) {
      throw new Error('Unsupported login credential storage key.');
    }
    return `${keyPrefix}${key}`;
  };

  const scopedStore: LoginCredentialStore = {
    get: (key: string): string | null => baseStore.get(scopedKey(key)),
    set: (key: string, value: string): void => baseStore.set(scopedKey(key), value),
    delete: (key: string): void => baseStore.delete(scopedKey(key)),
    transaction: <T>(work: () => T): T => baseStore.transaction(work),
  };
  return Object.freeze(scopedStore);
}

interface MigrationOutcome {
  credentialState: Extract<LoginCredentialState, 'migrated' | 'encryption_unavailable' | 'migration_failed'>;
  marker: typeof LEGACY_LOGIN_MIGRATION_MARKER;
}

export function saveLoginCredentials(
  store: LoginCredentialStore,
  input: SaveLoginCredentialsInput,
  cipher: LoginCredentialCipher,
): void {
  const username = input.username.trim();

  if (!input.rememberPassword) {
    store.transaction(() => {
      store.set(LOGIN_USERNAME_KEY, username);
      store.set(LOGIN_REMEMBER_PASSWORD_KEY, 'false');
      store.delete(LOGIN_PASSWORD_ENCRYPTED_KEY);
      store.delete(LEGACY_LOGIN_PASSWORD_KEY);
    });
    return;
  }

  if (!input.password) {
    resolveSavedLoginPassword(store, cipher, username);
    store.transaction(() => {
      store.set(LOGIN_USERNAME_KEY, username);
      store.set(LOGIN_REMEMBER_PASSWORD_KEY, 'true');
      store.delete(LEGACY_LOGIN_PASSWORD_KEY);
    });
    return;
  }

  const encryptedPassword = encryptAndVerifyPassword(input.password, cipher);
  store.transaction(() => {
    store.set(LOGIN_PASSWORD_ENCRYPTED_KEY, encryptedPassword);
    store.set(LOGIN_USERNAME_KEY, username);
    store.set(LOGIN_REMEMBER_PASSWORD_KEY, 'true');
    store.delete(LEGACY_LOGIN_PASSWORD_KEY);
  });
}

export function readSavedLoginCredentialStatus(
  store: LoginCredentialStore,
  cipher: LoginCredentialCipher,
): SavedLoginCredentialStatus {
  const username = store.get(LOGIN_USERNAME_KEY) ?? '';
  const rememberSetting = store.get(LOGIN_REMEMBER_PASSWORD_KEY);

  if (rememberSetting === 'false') {
    try {
      store.transaction(() => {
        store.delete(LOGIN_PASSWORD_ENCRYPTED_KEY);
        store.delete(LEGACY_LOGIN_PASSWORD_KEY);
      });
    } catch {
      return status(username, false, false, 'migration_failed');
    }
    return status(username, false, false, 'none');
  }

  const encryptedPassword = store.get(LOGIN_PASSWORD_ENCRYPTED_KEY);
  const legacyPassword = store.get(LEGACY_LOGIN_PASSWORD_KEY);
  const rememberPassword = rememberSetting === 'true' || Boolean(encryptedPassword || legacyPassword);

  if (encryptedPassword) {
    if (!encryptionAvailable(cipher)) {
      return status(username, rememberPassword, false, 'encryption_unavailable');
    }
    try {
      const decryptedPassword = cipher.decrypt(encryptedPassword);
      if (!decryptedPassword) throw new Error('empty decrypted password');
      if (legacyPassword) {
        try {
          store.transaction(() => store.delete(LEGACY_LOGIN_PASSWORD_KEY));
        } catch {
          return status(username, true, false, 'migration_failed');
        }
      }
      return status(username, true, true, 'encrypted_ready');
    } catch {
      if (!legacyPassword) {
        return status(username, rememberPassword, false, 'encrypted_corrupt');
      }
      const migration = migrateLegacyPassword(store, legacyPassword, cipher);
      return statusFromMigration(username, migration);
    }
  }

  if (legacyPassword) {
    const migration = migrateLegacyPassword(store, legacyPassword, cipher);
    return statusFromMigration(username, migration);
  }

  return status(username, rememberSetting === 'true', false, 'none');
}

/**
 * Resolve an already-migrated password for Main-process use only.
 */
export function resolveSavedLoginPassword(
  store: LoginCredentialStore,
  cipher: LoginCredentialCipher,
  requestedUsername: string,
): string {
  const statusResult = readSavedLoginCredentialStatus(store, cipher);
  if (requestedUsername.trim() !== statusResult.username.trim()) {
    throw new Error('保存的账号与当前账号不一致，请重新输入密码。');
  }
  if (!statusResult.passwordAvailable) {
    throw new Error(credentialStateMessage(statusResult.credentialState));
  }

  const encryptedPassword = store.get(LOGIN_PASSWORD_ENCRYPTED_KEY);
  if (!encryptedPassword || !encryptionAvailable(cipher)) {
    throw new Error('本机保存的密码当前不可用，请重新输入密码。');
  }
  try {
    const password = cipher.decrypt(encryptedPassword);
    if (!password) throw new Error('empty decrypted password');
    return password;
  } catch {
    throw new Error('本机保存的密码无法解密，请重新输入并保存。');
  }
}

function migrateLegacyPassword(
  store: LoginCredentialStore,
  legacyPassword: string,
  cipher: LoginCredentialCipher,
): MigrationOutcome {
  const marker = LEGACY_LOGIN_MIGRATION_MARKER;
  if (!encryptionAvailable(cipher)) {
    return { credentialState: 'encryption_unavailable', marker };
  }

  try {
    const encryptedPassword = encryptAndVerifyPassword(legacyPassword, cipher);
    store.transaction(() => {
      store.set(LOGIN_PASSWORD_ENCRYPTED_KEY, encryptedPassword);
      store.set(LOGIN_REMEMBER_PASSWORD_KEY, 'true');
      store.delete(LEGACY_LOGIN_PASSWORD_KEY);
    });
    return { credentialState: 'migrated', marker };
  } catch {
    return { credentialState: 'migration_failed', marker };
  }
}

function encryptAndVerifyPassword(password: string, cipher: LoginCredentialCipher): string {
  if (!encryptionAvailable(cipher)) {
    throw new Error('当前系统不支持本机加密保存密码，请取消勾选“记住密码”。');
  }
  const encryptedPassword = cipher.encrypt(password);
  if (!encryptedPassword || cipher.decrypt(encryptedPassword) !== password) {
    throw new Error('本机加密校验失败，密码未保存。');
  }
  return encryptedPassword;
}

function encryptionAvailable(cipher: LoginCredentialCipher): boolean {
  try {
    return cipher.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function statusFromMigration(
  username: string,
  migration: MigrationOutcome,
): SavedLoginCredentialStatus {
  // Reading the marker here keeps the migration identity coupled to the core
  // path without exposing password material.
  if (migration.marker !== LEGACY_LOGIN_MIGRATION_MARKER) {
    return status(username, true, false, 'migration_failed');
  }
  return status(
    username,
    true,
    migration.credentialState === 'migrated',
    migration.credentialState,
  );
}

function status(
  username: string,
  rememberPassword: boolean,
  passwordAvailable: boolean,
  credentialState: LoginCredentialState,
): SavedLoginCredentialStatus {
  return { username, rememberPassword, passwordAvailable, credentialState };
}

function credentialStateMessage(state: LoginCredentialState): string {
  if (state === 'encryption_unavailable') {
    return '当前系统无法使用本机加密，本机保存的密码未加载；请重新输入密码。';
  }
  if (state === 'encrypted_corrupt') {
    return '本机保存的密码无法解密，请重新输入并保存。';
  }
  if (state === 'migration_failed') {
    return '旧版凭证尚未完成安全迁移，请重新输入密码。';
  }
  return '本机没有可用的保存密码，请重新输入密码。';
}
