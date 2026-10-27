import { recordCredentialFailure } from './credential-error-diagnostics';
import { runtimeLogger, type RuntimeLogPort } from './runtime-logger';

export interface AiKeyStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export interface AiKeyCipher {
  isEncryptionAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

const AI_API_KEY_ENCRYPTED = 'ai_api_key_encrypted';
const LEGACY_AI_API_KEY_KEYS = ['ai_api_key', 'aiApiKey'] as const;
const AI_API_KEY_STORAGE_FIELDS = new Set<string>([
  AI_API_KEY_ENCRYPTED,
  ...LEGACY_AI_API_KEY_KEYS,
]);

export function isPersistedAiApiKeyField(key: string): boolean {
  return AI_API_KEY_STORAGE_FIELDS.has(key);
}

export function readPersistedAiApiKey(store: AiKeyStore, cipher: AiKeyCipher, logger: RuntimeLogPort = runtimeLogger): string {
  const encryptedKey = store.get(AI_API_KEY_ENCRYPTED);
  if (encryptedKey) {
    deleteLegacyPlaintextKeys(store);
    if (!cipher.isEncryptionAvailable()) return '';
    try {
      return cipher.decrypt(encryptedKey).trim();
    } catch (error) {
      recordCredentialFailure('ai_key_decrypt', error, logger);
      return '';
    }
  }

  const legacyKey = LEGACY_AI_API_KEY_KEYS
    .map((key) => store.get(key)?.trim() ?? '')
    .find(Boolean) ?? '';

  if (!legacyKey) {
    return '';
  }

  if (!cipher.isEncryptionAvailable()) {
    deleteLegacyPlaintextKeys(store);
    return '';
  }

  try {
    store.set(AI_API_KEY_ENCRYPTED, cipher.encrypt(legacyKey));
    return legacyKey;
  } catch (error) {
    recordCredentialFailure('ai_key_migrate', error, logger);
    return '';
  } finally {
    deleteLegacyPlaintextKeys(store);
  }
}

export function savePersistedAiApiKey(
  store: AiKeyStore,
  apiKey: string,
  cipher: AiKeyCipher,
): void {
  const normalizedKey = apiKey.trim();
  deleteLegacyPlaintextKeys(store);

  if (!normalizedKey) {
    store.delete(AI_API_KEY_ENCRYPTED);
    return;
  }

  if (!cipher.isEncryptionAvailable()) {
    throw new Error('当前系统不支持本机加密保存 AI Key，请修复系统加密能力后重试。');
  }

  store.set(AI_API_KEY_ENCRYPTED, cipher.encrypt(normalizedKey));
}

export function stripPersistedAiApiKeyFields<T>(settings: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !isPersistedAiApiKeyField(key)),
  ) as Record<string, T>;
}

export function resolveAiSettingsWithPersistedKey(
  settings: Record<string, string>,
  store: AiKeyStore,
  cipher: AiKeyCipher,
  logger: RuntimeLogPort = runtimeLogger,
): Record<string, string> {
  const safeSettings = stripPersistedAiApiKeyFields(settings);
  const apiKey = readPersistedAiApiKey(store, cipher, logger);
  return {
    ...safeSettings,
    aiApiKey: apiKey,
    ai_api_key: apiKey,
  };
}

function deleteLegacyPlaintextKeys(store: AiKeyStore): void {
  for (const key of LEGACY_AI_API_KEY_KEYS) {
    store.delete(key);
  }
}
