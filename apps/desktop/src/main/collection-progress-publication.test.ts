import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishCollectionProgressAfterPersistence } from './collection-progress-publication';
import { publishResumeProgress, publishTerminalProgress, buildProgressSink } from './collection-coordinator-authority-progress';
import type { CollectionCoordinatorRuntime } from './collection-coordinator-runtime';
import type { RunBatchResult } from '@amazon-ai-ops/lingxing-report-collector';
import type { LingxingCollectionProgressEvent, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { context, jobRequest } from './collection-coordinator.test-fixtures';
import { runtimeLogger } from './runtime-logger';
import { StoreCoordinatorError } from './store-coordinator';

const event = { eventId: 'durable-1', emittedAt: '2026-07-22T08:00:00.000Z', job: {
  jobId: 'batch-1', request: jobRequest(), state: 'queued' as const,
  reports: jobRequest().reportTypes.map(reportType => ({ reportType, state: 'queued' as const,
    attemptIndex: 0, autoRetryCount: 0, updatedAt: '2026-07-22T08:00:00.000Z' })),
  createdAt: '2026-07-22T08:00:00.000Z', updatedAt: '2026-07-22T08:00:00.000Z',
} };
function runtime(publishProgress: (event: LingxingCollectionProgressEvent) => void = vi.fn(),
  assertCurrent: () => StoreContextEnvelope = vi.fn(() => context())) {
  const persistence = { persistProgress: vi.fn() };
  return { dependencies: { publishProgress, authority: { assertActiveStoreContext: assertCurrent }, persistence },
    isCancellationRequested: () => false } as unknown as CollectionCoordinatorRuntime;
}
afterEach(() => { vi.restoreAllMocks(); });

describe('collection durable progress publication logging', () => {
  it('logs a valid-context publisher exception without losing the durable result', () => {
    const error = new Error('WebContents was destroyed'); const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(() => publishCollectionProgressAfterPersistence({ phase: 'progress', event,
      assertCurrent: () => context(), publish: () => { throw error; } }, log)).not.toThrow();
    expect(log.warn).toHaveBeenCalledWith('collection.progress_publication_failed', {
      phase: 'progress', jobId: 'batch-1', requestId: event.job.request.requestId, storeId: context().storeId, error,
    });
  });

  it('suppresses an expected stale context without publishing or logging a false transport failure', () => {
    const publish = vi.fn(); const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    publishCollectionProgressAfterPersistence({ phase: 'resume', event,
      assertCurrent: () => { throw new StoreCoordinatorError('STALE_STORE_CONTEXT', 'generation changed'); }, publish }, log);
    expect(publish).not.toHaveBeenCalled(); expect(log.warn).not.toHaveBeenCalled();
  });

  it('logs a real authority repository failure while suppressing the unverified UI projection', () => {
    const error = Object.assign(new Error('database read failed'), { code: 'SQLITE_IOERR' });
    const publish = vi.fn(); const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(() => publishCollectionProgressAfterPersistence({ phase: 'resume', event,
      assertCurrent: () => { throw error; }, publish }, log)).not.toThrow();
    expect(publish).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith('collection.progress_authority_check_failed',
      expect.objectContaining({ phase: 'resume', error }));
  });

  it('preserves publication and reporting failures independently if the injected logger throws', () => {
    const error = new Error('send failed'); const reportingError = new Error('logger failed');
    const fallback = vi.spyOn(runtimeLogger, 'error').mockImplementation(() => {});
    expect(() => publishCollectionProgressAfterPersistence({ phase: 'terminal', event,
      assertCurrent: () => context(), publish: () => { throw error; } },
    { info: vi.fn(), warn: () => { throw reportingError; }, error: vi.fn() })).not.toThrow();
    expect(fallback).toHaveBeenCalledWith('collection.progress_diagnostic_delivery_failed',
      expect.objectContaining({ error, reportingError }));
  });

  it('connects resume and terminal coordinator entry points to the unified logger', () => {
    const error = new Error('renderer gone'); const log = vi.spyOn(runtimeLogger, 'warn').mockImplementation(() => {});
    const current = runtime(vi.fn(() => { throw error; }));
    publishResumeProgress.call(current, event, context());
    publishTerminalProgress.call(current, { job: event.job } as unknown as RunBatchResult);
    expect(log.mock.calls.map(call => call[1]?.phase)).toEqual(['resume', 'terminal']);
    expect(log.mock.calls.every(call => call[1]?.error === error)).toBe(true);
  });

  it('persists progress before a publisher failure and does not turn the failure into a retry', async () => {
    const error = new Error('renderer gone'); const log = vi.spyOn(runtimeLogger, 'warn').mockImplementation(() => {});
    const current = runtime(vi.fn(() => { throw error; }));
    const sink = buildProgressSink.call(current, event.job.request, { ...event.job.request, canary: true });
    await expect(sink(event)).resolves.toBeUndefined();
    expect(current.dependencies.persistence.persistProgress).toHaveBeenCalledTimes(1);
    expect(current.dependencies.publishProgress).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('collection.progress_publication_failed',
      expect.objectContaining({ phase: 'progress', error }));
  });

  it('propagates a persistence failure unchanged before any publication', async () => {
    const error = new Error('SQLITE_IOERR'); const current = runtime();
    vi.mocked(current.dependencies.persistence.persistProgress).mockRejectedValue(error);
    const sink = buildProgressSink.call(current, event.job.request, { ...event.job.request, canary: true });
    await expect(sink(event)).rejects.toBe(error);
    expect(current.dependencies.publishProgress).not.toHaveBeenCalled();
  });
});
