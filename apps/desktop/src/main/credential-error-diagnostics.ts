import { runtimeLogger, type RuntimeLogPort } from './runtime-logger';

type CredentialOperation =
  | 'ai_key_decrypt' | 'ai_key_migrate'
  | 'login_clear' | 'login_remove_legacy' | 'login_decrypt'
  | 'login_resolve' | 'login_migrate' | 'login_capability'
  | 'login_save_confirmed' | 'login_save_pending';

const SAFE_ERROR_CODES = new Set([
  'SQLITE_BUSY', 'SQLITE_FULL', 'SQLITE_IOERR', 'SQLITE_READONLY',
  'SQLITE_CONSTRAINT', 'SQLITE_CORRUPT', 'EACCES', 'EPERM', 'ENOSPC',
]);

function safeErrorName(error: unknown): string {
  if (error instanceof TypeError) return 'TypeError';
  if (error instanceof RangeError) return 'RangeError';
  if (error instanceof SyntaxError) return 'SyntaxError';
  return error instanceof Error ? 'Error' : 'UnknownError';
}

function safeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  try {
    const code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
    return typeof code === 'string' && SAFE_ERROR_CODES.has(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

export function recordCredentialFailure(
  operation: CredentialOperation,
  error: unknown,
  logger: RuntimeLogPort = runtimeLogger,
): void {
  // 加密库错误可能含密码或密文；只记录固定分类，绝不转发原错字段。
  const code = safeErrorCode(error);
  const diagnostic = { operation, category: 'credential_operation_failed', errorName: safeErrorName(error),
    ...(code ? { code } : {}) };
  try {
    logger.warn('security.credential_operation_failed', diagnostic);
  } catch {
    runtimeLogger.warn('security.credential_diagnostic_delivery_failed', diagnostic);
  }
}
