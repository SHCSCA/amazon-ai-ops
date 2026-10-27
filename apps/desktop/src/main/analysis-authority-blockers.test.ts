import { describe, expect, it } from 'vitest';
import { ANALYSIS_AUTHORIZATION_BLOCKER_CODES } from '@amazon-ai-ops/shared-types';
import { analysisError, analysisErrorCode } from './analysis-authority-blockers';

describe('analysis authority error classification', () => {
  it('preserves every declared domain code from typed errors and durable message prefixes', () => {
    for (const code of ANALYSIS_AUTHORIZATION_BLOCKER_CODES) {
      expect(analysisErrorCode(analysisError(code, '当前条件未满足。'))).toBe(code);
      expect(analysisErrorCode(new Error(`${code}: 当前条件未满足。`))).toBe(code);
    }
  });

  it('classifies unknown provider and operating-system codes as interrupted analysis', () => {
    for (const code of ['ETIMEDOUT', 'RATE_LIMIT_PROVIDER', 'SQLITE_ERROR', 'UNKNOWN_GATE']) {
      expect(analysisErrorCode(Object.assign(new Error('服务不可用。'), { code }))).toBe('ANALYSIS_INTERRUPTED');
      expect(analysisErrorCode(new Error(`${code}: 服务不可用。`))).toBe('ANALYSIS_INTERRUPTED');
    }
    expect(analysisErrorCode(null)).toBe('ANALYSIS_INTERRUPTED');
  });
});
