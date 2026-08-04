import type { CreateOperationEventInput, OperationEvent } from '@amazon-ai-ops/shared-types';

type BusinessOperationEvent = CreateOperationEventInput | OperationEvent;

export type PathFreeBusinessOperationEvent<
  T extends BusinessOperationEvent = BusinessOperationEvent,
> = Omit<T, 'evidencePath'>;

const LOCAL_FILE_PLACEHOLDER = '[本地文件]';
const DOUBLE_QUOTED_LOCAL_PATH_PATTERN = /"(?:file:(?:\/{2,}|\\{2,})|[A-Za-z]:[\\/]|\\\\)[^"\r\n]*"/gi;
const SINGLE_QUOTED_LOCAL_PATH_PATTERN = /'(?:file:(?:\/{2,}|\\{2,})|[A-Za-z]:[\\/]|\\\\)[^'\r\n]*'/gi;
const FILE_URL_PATTERN = /\bfile:(?:\/{2,}|\\{2,})[^\s"'<>，。；;,、|)\]}]+/gi;
const UNC_ABSOLUTE_PATH_PATTERN = /\\\\[^\\/\s"'<>，。；;,、|)\]}]+[\\/][^\s"'<>，。；;,、|)\]}]+/g;
const DRIVE_ABSOLUTE_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>，。；;,、|)\]}]+/g;

export function sanitizeRendererBusinessText(value: string): string {
  return value
    .replace(DOUBLE_QUOTED_LOCAL_PATH_PATTERN, `"${LOCAL_FILE_PLACEHOLDER}"`)
    .replace(SINGLE_QUOTED_LOCAL_PATH_PATTERN, `'${LOCAL_FILE_PLACEHOLDER}'`)
    .replace(FILE_URL_PATTERN, LOCAL_FILE_PLACEHOLDER)
    .replace(UNC_ABSOLUTE_PATH_PATTERN, LOCAL_FILE_PLACEHOLDER)
    .replace(DRIVE_ABSOLUTE_PATH_PATTERN, LOCAL_FILE_PLACEHOLDER);
}

/**
 * Business pipeline events are explanatory facts, not file-open capabilities.
 * Legacy absolute paths stay in Main and are intentionally not converted into
 * Renderer-visible strings. Evidence browsing belongs to the artifact registry.
 */
export function projectBusinessOperationEventForRenderer<T extends BusinessOperationEvent>(
  event: T,
): PathFreeBusinessOperationEvent<T> {
  const { evidencePath: _mainOnlyEvidencePath, ...safe } = event;
  return Object.fromEntries(Object.entries(safe).map(([key, value]) => [
    key,
    typeof value === 'string' ? sanitizeRendererBusinessText(value) : value,
  ])) as PathFreeBusinessOperationEvent<T>;
}
