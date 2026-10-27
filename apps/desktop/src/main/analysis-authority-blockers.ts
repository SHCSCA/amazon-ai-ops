import type {
  AnalysisAuthorizationBlocker,
  AnalysisAuthorizationBlockerCode,
} from '@amazon-ai-ops/shared-types';
import { ANALYSIS_AUTHORIZATION_BLOCKER_CODES } from '@amazon-ai-ops/shared-types';

const analysisBlockerCodes = new Set<string>(ANALYSIS_AUTHORIZATION_BLOCKER_CODES);

export function analysisBlocker(
  code: AnalysisAuthorizationBlockerCode,
  message: string,
): AnalysisAuthorizationBlocker {
  return { code, message };
}

export function uniqueAnalysisBlockers(
  blockers: readonly AnalysisAuthorizationBlocker[],
): AnalysisAuthorizationBlocker[] {
  const seen = new Set<string>();
  const unique: AnalysisAuthorizationBlocker[] = [];
  for (const blocker of blockers) {
    if (!blocker?.code || seen.has(blocker.code)) continue;
    seen.add(blocker.code);
    unique.push({
      code: blocker.code,
      message: String(blocker.message ?? '').trim() || blocker.code,
    });
  }
  return unique;
}

export function analysisError(code: AnalysisAuthorizationBlockerCode, translation: string): Error {
  const error = new Error(`${code}: ${translation}`);
  (error as Error & { code: string }).code = code;
  return error;
}

export function analysisErrorCode(error: unknown): AnalysisAuthorizationBlockerCode {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  if (analysisBlockerCodes.has(code)) return code as AnalysisAuthorizationBlockerCode;
  const message = error instanceof Error ? error.message : String(error ?? '');
  const prefixed = message.match(/^([A-Z][A-Z0-9_]+):/);
  if (prefixed && analysisBlockerCodes.has(prefixed[1])) return prefixed[1] as AnalysisAuthorizationBlockerCode;
  return 'ANALYSIS_INTERRUPTED';
}
