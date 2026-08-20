import {
  ANALYSIS_REQUIRED_REPORT_TYPES,
  type LingxingReportType,
} from '@amazon-ai-ops/shared-types';

export interface LingxingImportRecoverySummary {
  inspected: number;
  recovered: number;
  failed: number;
  knownFailed: number;
  authorityFailed: number;
}

export interface LingxingFailedImportSettlementProof {
  jobId: string;
  requestId: string;
  importState?: string;
  importCompletedAt?: string;
  importError?: string;
}

export class KnownLingxingImportRecoveryFailure extends Error {
  readonly code = 'LINGXING_COLLECTION_IMPORT_RECOVERY_KNOWN_FAILED';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'KnownLingxingImportRecoveryFailure';
  }
}

const ANALYSIS_REQUIRED_REPORT_TYPE_SET = new Set<LingxingReportType>(
  ANALYSIS_REQUIRED_REPORT_TYPES,
);

function isExactReportTypeSet(
  actual: readonly LingxingReportType[],
  expected: readonly LingxingReportType[],
): boolean {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && new Set(expected).size === expected.length
    && actual.every((reportType) => expected.includes(reportType));
}

export function classifyLingxingPartialImportRecoveryFailure(input: {
  state?: string;
  immutableImportRunPresent: boolean;
  expectedJobId: string;
  expectedRequestId: string;
  requestedReportTypes: readonly LingxingReportType[];
  downloadedCheckpointReportTypes: readonly LingxingReportType[];
  downloadedFileReportTypes: readonly LingxingReportType[];
  failedSettlement: LingxingFailedImportSettlementProof;
}): unknown {
  const importError = input.failedSettlement.importError;
  const requestedReportTypes = input.requestedReportTypes;
  const isExactPartialTerminal = (
    input.state === 'completed' || input.state === 'completed_with_errors'
  )
    && input.immutableImportRunPresent === false
    && input.failedSettlement.jobId === input.expectedJobId
    && input.failedSettlement.requestId === input.expectedRequestId
    && input.failedSettlement.importState === 'failed'
    && Boolean(input.failedSettlement.importCompletedAt)
    && typeof importError === 'string'
    && (
      importError.startsWith('LINGXING_COLLECTION_IMPORT_FAILED:')
      || importError.startsWith('LINGXING_IMPORT_RECONCILIATION_EVIDENCE_MISSING:')
    )
    && requestedReportTypes.length > 0
    && requestedReportTypes.length < ANALYSIS_REQUIRED_REPORT_TYPES.length
    && new Set(requestedReportTypes).size === requestedReportTypes.length
    && requestedReportTypes.every((reportType) => ANALYSIS_REQUIRED_REPORT_TYPE_SET.has(reportType))
    && isExactReportTypeSet(input.downloadedCheckpointReportTypes, requestedReportTypes)
    && isExactReportTypeSet(input.downloadedFileReportTypes, requestedReportTypes);

  return isExactPartialTerminal
    ? new KnownLingxingImportRecoveryFailure(importError, { cause: new Error(importError) })
    : undefined;
}

export function classifyLingxingImportRecoveryFailure(input: {
  error: unknown;
  immutableImportRunPresent: boolean;
  expectedJobId: string;
  expectedRequestId: string;
  failedSettlement: LingxingFailedImportSettlementProof;
}): unknown {
  const recoveryError = input.error;
  const explicitlyFailedWithoutCommittedRun = recoveryError instanceof Error
    && recoveryError.message.startsWith('LINGXING_COLLECTION_IMPORT_FAILED:')
    && input.immutableImportRunPresent === false
    && input.failedSettlement.jobId === input.expectedJobId
    && input.failedSettlement.requestId === input.expectedRequestId
    && input.failedSettlement.importState === 'failed'
    && Boolean(input.failedSettlement.importCompletedAt);
  return explicitlyFailedWithoutCommittedRun
    ? new KnownLingxingImportRecoveryFailure(recoveryError.message, { cause: recoveryError })
    : recoveryError;
}

export function isKnownLingxingImportRecoveryFailure(
  error: unknown,
): error is KnownLingxingImportRecoveryFailure {
  return error instanceof KnownLingxingImportRecoveryFailure
    && error.code === 'LINGXING_COLLECTION_IMPORT_RECOVERY_KNOWN_FAILED';
}

export function assertLingxingImportStartupRecoverySafe(
  summary: LingxingImportRecoverySummary,
): void {
  const counts = [
    summary.inspected,
    summary.recovered,
    summary.failed,
    summary.knownFailed,
    summary.authorityFailed,
  ];
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)
    || summary.failed !== summary.knownFailed + summary.authorityFailed
    || summary.inspected !== summary.recovered + summary.failed) {
    throw new Error(
      'LINGXING_COLLECTION_IMPORT_RECOVERY_SUMMARY_INVALID: startup import recovery counts are not an exact partition',
    );
  }
  if (summary.authorityFailed !== 0) {
    throw new Error(
      'LINGXING_COLLECTION_IMPORT_RECOVERY_AUTHORITY_FAILED: import recovery could not prove a known durable terminal for every Store',
    );
  }
}
