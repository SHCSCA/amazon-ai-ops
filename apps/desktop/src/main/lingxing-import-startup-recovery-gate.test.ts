import { describe, expect, it } from 'vitest';
import {
  assertLingxingImportStartupRecoverySafe,
  classifyLingxingImportRecoveryFailure,
  classifyLingxingPartialImportRecoveryFailure,
  isKnownLingxingImportRecoveryFailure,
} from './lingxing-import-startup-recovery-gate';

const parserFailure = new Error('LINGXING_COLLECTION_IMPORT_FAILED: malformed report');
const failedSettlement = {
  jobId: 'job-one',
  requestId: 'request-one',
  importState: 'failed',
  importCompletedAt: '2026-08-03T08:00:00.000Z',
};

describe('Lingxing import startup recovery gate', () => {
  it('classifies an exact partial terminal without an immutable run as known-failed', () => {
    const classified = classifyLingxingPartialImportRecoveryFailure({
      state: 'completed',
      immutableImportRunPresent: false,
      expectedJobId: 'job-one',
      expectedRequestId: 'request-one',
      requestedReportTypes: ['campaign'],
      downloadedCheckpointReportTypes: ['campaign'],
      downloadedFileReportTypes: ['campaign'],
      failedSettlement: {
        ...failedSettlement,
        importError: 'LINGXING_IMPORT_RECONCILIATION_EVIDENCE_MISSING: 部分任务没有完整八类证据。',
      },
    });

    expect(isKnownLingxingImportRecoveryFailure(classified)).toBe(true);
    expect(classified).toMatchObject({
      code: 'LINGXING_COLLECTION_IMPORT_RECOVERY_KNOWN_FAILED',
    });

    const base = {
      state: 'completed',
      immutableImportRunPresent: false,
      expectedJobId: 'job-one',
      expectedRequestId: 'request-one',
      requestedReportTypes: ['campaign'] as const,
      downloadedCheckpointReportTypes: ['campaign'] as const,
      downloadedFileReportTypes: ['campaign'] as const,
      failedSettlement: {
        ...failedSettlement,
        importError: 'LINGXING_IMPORT_RECONCILIATION_EVIDENCE_MISSING: 部分任务没有完整八类证据。',
      },
    };
    expect(isKnownLingxingImportRecoveryFailure(
      classifyLingxingPartialImportRecoveryFailure({ ...base, immutableImportRunPresent: true }),
    )).toBe(false);
    expect(isKnownLingxingImportRecoveryFailure(
      classifyLingxingPartialImportRecoveryFailure({ ...base, downloadedFileReportTypes: [] }),
    )).toBe(false);
    expect(isKnownLingxingImportRecoveryFailure(
      classifyLingxingPartialImportRecoveryFailure({
        ...base,
        requestedReportTypes: [
          'campaign',
          'ad_group',
          'placement',
          'advertised_product',
          'auto_targeting',
          'keyword',
          'product_targeting',
          'user_search_term',
        ],
      }),
    )).toBe(false);
  });

  it('classifies only an exact no-commit parser failure with a durable failed settlement as known', () => {
    const classified = classifyLingxingImportRecoveryFailure({
      error: parserFailure,
      immutableImportRunPresent: false,
      expectedJobId: 'job-one',
      expectedRequestId: 'request-one',
      failedSettlement,
    });

    expect(isKnownLingxingImportRecoveryFailure(classified)).toBe(true);
    expect(classified).toMatchObject({
      code: 'LINGXING_COLLECTION_IMPORT_RECOVERY_KNOWN_FAILED',
      cause: parserFailure,
    });
  });

  it.each([
    ['an immutable run exists', { immutableImportRunPresent: true }],
    ['the error is an authority failure', { error: new Error('COLLECTION_IMPORT_RECOVERY_CAS_CONFLICT') }],
    ['the failed job differs', { failedSettlement: { ...failedSettlement, jobId: 'other-job' } }],
    ['the failed request differs', { failedSettlement: { ...failedSettlement, requestId: 'other-request' } }],
    ['the durable terminal is incomplete', {
      failedSettlement: { ...failedSettlement, importCompletedAt: undefined },
    }],
  ])('keeps %s in the authority-failed class', (_label, overrides) => {
    const classified = classifyLingxingImportRecoveryFailure({
      error: parserFailure,
      immutableImportRunPresent: false,
      expectedJobId: 'job-one',
      expectedRequestId: 'request-one',
      failedSettlement,
      ...overrides,
    });

    expect(isKnownLingxingImportRecoveryFailure(classified)).toBe(false);
  });

  it('allows an exact known-failed partition but blocks any authority failure', () => {
    expect(() => assertLingxingImportStartupRecoverySafe({
      inspected: 2,
      recovered: 1,
      failed: 1,
      knownFailed: 1,
      authorityFailed: 0,
    })).not.toThrow();
    expect(() => assertLingxingImportStartupRecoverySafe({
      inspected: 2,
      recovered: 1,
      failed: 1,
      knownFailed: 0,
      authorityFailed: 1,
    })).toThrow(/IMPORT_RECOVERY_AUTHORITY_FAILED/);
  });

  it('rejects malformed summary counts instead of accidentally confirming startup', () => {
    expect(() => assertLingxingImportStartupRecoverySafe({
      inspected: 3,
      recovered: 1,
      failed: 1,
      knownFailed: 1,
      authorityFailed: 0,
    })).toThrow(/RECOVERY_SUMMARY_INVALID/);
  });
});
