export interface LoginCredentialStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
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

export interface SavedLoginCredentials {
  username: string;
  password: string;
  rememberPassword: boolean;
  passwordAvailable: boolean;
}

const LOGIN_USERNAME_KEY = 'login_username';
const LOGIN_REMEMBER_PASSWORD_KEY = 'login_remember_password';
const LOGIN_PASSWORD_ENCRYPTED_KEY = 'login_password_encrypted';
const LEGACY_LOGIN_PASSWORD_KEY = 'login_password';

export function saveLoginCredentials(
  store: LoginCredentialStore,
  input: SaveLoginCredentialsInput,
  cipher: LoginCredentialCipher,
): void {
  const username = input.username.trim();
  store.set(LOGIN_USERNAME_KEY, username);

  if (!input.rememberPassword) {
    store.set(LOGIN_REMEMBER_PASSWORD_KEY, 'false');
    store.delete(LOGIN_PASSWORD_ENCRYPTED_KEY);
    store.delete(LEGACY_LOGIN_PASSWORD_KEY);
    return;
  }

  store.set(LOGIN_REMEMBER_PASSWORD_KEY, 'true');
  store.delete(LEGACY_LOGIN_PASSWORD_KEY);

  if (input.password) {
    if (!cipher.isEncryptionAvailable()) {
      throw new Error('当前系统不支持本机加密保存密码，请取消勾选“记住账号密码”。');
    }
    store.set(LOGIN_PASSWORD_ENCRYPTED_KEY, cipher.encrypt(input.password));
  }
}

export function readSavedLoginCredentials(
  store: LoginCredentialStore,
  cipher: LoginCredentialCipher,
): SavedLoginCredentials {
  const username = store.get(LOGIN_USERNAME_KEY) ?? '';
  const rememberPassword = store.get(LOGIN_REMEMBER_PASSWORD_KEY) === 'true';
  if (!rememberPassword) {
    return {
      username,
      password: '',
      rememberPassword: false,
      passwordAvailable: false,
    };
  }

  const encryptedPassword = store.get(LOGIN_PASSWORD_ENCRYPTED_KEY);
  if (encryptedPassword && cipher.isEncryptionAvailable()) {
    try {
      return {
        username,
        password: cipher.decrypt(encryptedPassword),
        rememberPassword: true,
        passwordAvailable: true,
      };
    } catch {
      return {
        username,
        password: '',
        rememberPassword: true,
        passwordAvailable: false,
      };
    }
  }

  const legacyPassword = store.get(LEGACY_LOGIN_PASSWORD_KEY);
  if (legacyPassword) {
    return {
      username,
      password: legacyPassword,
      rememberPassword: true,
      passwordAvailable: true,
    };
  }

  return {
    username,
    password: '',
    rememberPassword: true,
    passwordAvailable: false,
  };
}
