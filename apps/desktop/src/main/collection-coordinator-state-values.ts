import {
  type RunBatchResult,
} from '@amazon-ai-ops/lingxing-report-collector';
import type {
  LingxingCollectionImportState,
  LingxingCollectionJobSnapshot,
} from '@amazon-ai-ops/shared-types';
import {
  TERMINAL_REPORT_STATES,
} from "./collection-coordinator-constants";

export function transitionCollectionResultToCancelled(result: RunBatchResult): RunBatchResult {
  const completedAt = nextCollectionTimestamp(result.job.updatedAt);
  const detail = '运营者已取消本次领星采集。';
  const blockerCode = 'LINGXING_COLLECTION_CANCELLED';
  const job: LingxingCollectionJobSnapshot = {
    ...result.job,
    state: 'cancelled',
    reports: result.job.reports.map((checkpoint) => (
      TERMINAL_REPORT_STATES.has(checkpoint.state)
        ? checkpoint
        : {
            ...checkpoint,
            state: 'cancelled' as const,
            errorCode: blockerCode,
            detail,
            updatedAt: completedAt,
          }
    )),
    updatedAt: completedAt,
    completedAt,
    blockerCode,
    detail,
    importState: 'not_applicable',
  };
  delete job.importAttemptedAt;
  delete job.importCompletedAt;
  delete job.importError;
  return {
    ...result,
    job,
    batch: {
      ...result.batch,
      status: 'failed',
      completedAt,
    },
  };
}

export function nextCollectionTimestamp(previous: string): string {
  const previousMs = Date.parse(previous);
  const nextMs = Number.isFinite(previousMs)
    ? Math.max(Date.now(), previousMs + 1)
    : Date.now();
  return new Date(nextMs).toISOString();
}

export function transitionCollectionImportState(
  job: LingxingCollectionJobSnapshot,
  importState: LingxingCollectionImportState,
  options: {
    attemptedAt?: string;
    completedAt?: string;
    error?: string;
  } = {},
): LingxingCollectionJobSnapshot {
  // 复用调用方生成的权限时间，避免毫秒推进造成快照晚于获授权导入。
  const updatedAt = options.completedAt
    ?? options.attemptedAt
    ?? nextCollectionTimestamp(job.updatedAt);
  return {
    ...job,
    importState,
    updatedAt,
    ...(options.attemptedAt ? { importAttemptedAt: options.attemptedAt } : {}),
    ...(options.completedAt ? { importCompletedAt: options.completedAt } : {}),
    ...(options.error ? { importError: options.error } : {}),
  };
}
