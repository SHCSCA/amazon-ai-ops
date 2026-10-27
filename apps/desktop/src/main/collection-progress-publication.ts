import type { LingxingCollectionProgressEvent } from '@amazon-ai-ops/shared-types';
import { runtimeLogger, type RuntimeLogPort } from './runtime-logger';
import { StoreCoordinatorError } from './store-coordinator';

const EXPECTED_CONTEXT_CODES = new Set([
  'STALE_STORE_CONTEXT', 'STORE_CONTEXT_MISMATCH', 'STORE_NOT_FOUND', 'STORE_NOT_ACTIVE',
]);

export function publishCollectionProgressAfterPersistence(
  input: {
    phase: 'resume' | 'progress' | 'terminal' | 'import_recovery' | 'import_recovered';
    event: LingxingCollectionProgressEvent;
    assertCurrent(): unknown;
    publish(): void;
  },
  logger: RuntimeLogPort = runtimeLogger,
): void {
  const recordFailure = (eventName: string, error: unknown): void => {
    const details = { phase: input.phase, jobId: input.event.job.jobId,
      requestId: input.event.job.request.requestId, storeId: input.event.job.request.storeContext.storeId, error };
    try {
      logger.warn(eventName, details);
    } catch (reportingError) {
      // 日志端口失效也不能覆盖已经落盘的业务结果或触发外部重试。
      runtimeLogger.error('collection.progress_diagnostic_delivery_failed', { ...details, reportingError });
    }
  };
  try {
    input.assertCurrent();
  } catch (error) {
    // 店铺切换只抑制旧投影；持久检查点仍可用于恢复。
    if (!(error instanceof StoreCoordinatorError && EXPECTED_CONTEXT_CODES.has(error.code))) {
      recordFailure('collection.progress_authority_check_failed', error);
    }
    return;
  }
  try {
    input.publish();
  } catch (error) {
    recordFailure('collection.progress_publication_failed', error);
  }
}
