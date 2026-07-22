import * as fs from 'fs';
import {
  LINGXING_AD_REPORTS,
  downloadExistingLingxingReportBatch,
  runLingxingReportBatch,
  type DownloadCenterAutomationPort,
  type LingxingCollectionAuthorityGuard,
  type LingxingCollectionCancellationGuard,
  type LingxingCollectionProgressSink,
  type RunBatchOptions,
  type RunBatchResult,
} from '@amazon-ai-ops/lingxing-report-collector';
import type {
  LingxingCollectionImportState,
  LingxingCollectionJobSnapshot,
  LingxingCollectionLineage,
  LingxingCollectionProgressEvent,
  LingxingCollectionRequestDto,
  LingxingCollectionResumeState,
  LingxingReportType,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  missionControlContextKey,
  normalizeStoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type {
  CollectionOperation,
  CollectionOperationGuard,
  StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import {
  assertPathContained,
  ensureStoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLLECTION_LEASE_TTL_MS = 60 * 60 * 1_000;
const REPORT_TYPES = new Set<LingxingReportType>(
  LINGXING_AD_REPORTS.map((report) => report.type),
);

export interface LingxingCollectionAuthority {
  assertActiveStoreContext(value: unknown): StoreContextEnvelope;
  getActiveStoreContext(): StoreContextEnvelope | null;
}

export interface LingxingCollectionRuntime {
  automation: DownloadCenterAutomationPort;
  browserProfileId: string;
  canary: boolean;
  capsule: StoreCapsulePaths;
  storeDisplayName: string;
  storeId: string;
  target: {
    marketplaceCode: 'US';
    storeId: string;
    storeName: string;
  };
}

export interface LingxingCollectionPersistence {
  persistProgress(event: LingxingCollectionProgressEvent): void | Promise<void>;
  persistResult(result: RunBatchResult): void | Promise<void>;
  persistImportState(job: LingxingCollectionJobSnapshot): void | Promise<void>;
}

export interface LingxingCollectionCoordinatorDependencies {
  authority: LingxingCollectionAuthority;
  operations: Pick<CollectionOperationGuard, 'run'>;
  resolveRuntime(
    context: StoreContextEnvelope,
    options: { canary: boolean },
  ): LingxingCollectionRuntime;
  preflight?(
    request: LingxingCollectionRequestDto,
    runtime: LingxingCollectionRuntime,
  ): void | Promise<void>;
  assertRuntimeCurrent?(
    context: StoreContextEnvelope,
    runtime: LingxingCollectionRuntime,
  ): void;
  clearCancellation?(input: { jobId?: string; requestId: string; storeId: string }): void;
  persistence: LingxingCollectionPersistence;
  importResult?(result: RunBatchResult): unknown | Promise<unknown>;
  publishProgress?(event: LingxingCollectionProgressEvent): void;
  isCancelled?(input: { jobId: string; requestId: string; storeId: string }): boolean;
  runCreateBatch?: (options: RunBatchOptions) => Promise<RunBatchResult>;
  runExistingBatch?: (options: RunBatchOptions) => Promise<RunBatchResult>;
}

export interface StartLingxingCollectionInput {
  requestId: string;
  storeContext: StoreContextEnvelope;
  dateStart: string;
  dateEnd: string;
  mode: 'create-and-download' | 'download-existing';
  reportTypes?: readonly LingxingReportType[];
  maxRetries?: number;
  appVersion?: string;
  resumeFrom?: LingxingCollectionResumeState;
  lineage?: LingxingCollectionLineage;
  canary?: boolean;
}

export interface LingxingCollectionCoordinatorResult {
  result: RunBatchResult;
  importSummary?: unknown;
}

/**
 * Main-process collection boundary. The Renderer supplies a captured store
 * context, but Main re-authorizes it, resolves the store capsule/runtime, and
 * owns every persistence and browser step.
 */
export class LingxingCollectionCoordinator {
  private readonly runCreateBatch: (options: RunBatchOptions) => Promise<RunBatchResult>;
  private readonly runExistingBatch: (options: RunBatchOptions) => Promise<RunBatchResult>;

  constructor(private readonly dependencies: LingxingCollectionCoordinatorDependencies) {
    this.runCreateBatch = dependencies.runCreateBatch ?? runLingxingReportBatch;
    this.runExistingBatch = dependencies.runExistingBatch ?? downloadExistingLingxingReportBatch;
  }

  async start(input: StartLingxingCollectionInput): Promise<LingxingCollectionCoordinatorResult> {
    const request = normalizeCollectionRequest(input);
    assertCanaryRequestIdentity(request.requestId, Boolean(input.canary));
    const capturedContext = this.captureAuthority(request.storeContext);

    return this.dependencies.operations.run({
      context: capturedContext,
      owner: `lingxing-collection:${request.requestId}`,
      ttlMs: COLLECTION_LEASE_TTL_MS,
    }, async (operation) => {
      try {
        operation.assertStepCurrent();
        const runtime = this.resolveAuthorizedRuntime(capturedContext, Boolean(input.canary));
        this.dependencies.assertRuntimeCurrent?.(capturedContext, runtime);
        await this.dependencies.preflight?.(request, runtime);
        operation.assertStepCurrent();

        const progressSink = this.buildProgressSink(request, input);
        const authorityGuard = this.buildAuthorityGuard(operation, capturedContext, runtime);
        const cancellationGuard = this.buildCancellationGuard();
        const options: RunBatchOptions = {
          requestId: request.requestId,
          storeContext: capturedContext,
          dateStart: request.dateStart,
          dateEnd: request.dateEnd,
          storeDisplayName: runtime.storeDisplayName,
          rootDownloadDir: runtime.capsule.downloadsDir,
          ...(input.appVersion ? { appVersion: input.appVersion } : {}),
          reportTypes: request.reportTypes,
          ...(input.maxRetries === undefined ? {} : { maxRetries: input.maxRetries }),
          automation: runtime.automation,
          progressSink,
          authorityGuard,
          cancellationGuard,
          ...(input.resumeFrom ? { resumeFrom: input.resumeFrom } : {}),
        };
        const runner = request.mode === 'download-existing'
          ? this.runExistingBatch
          : this.runCreateBatch;
        const runnerResult = await runner(options);
        let result = attachCollectionLineage(runnerResult, request, input);

        // The collector guards every external step, but Main still rechecks
        // immediately before publishing a terminal snapshot. This prevents a
        // buggy or substituted runner from persisting a normal completion after
        // the operator switched stores while the promise was in flight.
        operation.assertStepCurrent();
        this.dependencies.assertRuntimeCurrent?.(capturedContext, runtime);
        result = this.cancelResultIfRequested(result, request, capturedContext);
        assertResultBelongsToRequest(result, request, runtime.capsule);
        let importEligible = (
          !runtime.canary
          && (result.job.state === 'completed' || result.job.state === 'completed_with_errors')
          && !result.job.reports.some((checkpoint) => checkpoint.state === 'create_unknown')
        );
        let finalizedResult: RunBatchResult = {
          ...result,
          job: transitionCollectionImportState(
            result.job,
            importEligible ? 'pending' : 'not_applicable',
          ),
        };
        // Cancellation is an independent operator authority boundary. A
        // substituted runner may return a normal completion without observing
        // its guard, so check again immediately before the durable terminal
        // commit rather than trusting the runner's final state.
        finalizedResult = this.cancelResultIfRequested(
          finalizedResult,
          request,
          capturedContext,
        );
        if (finalizedResult.job.state === 'cancelled') importEligible = false;
        await this.dependencies.persistence.persistResult(finalizedResult);
        if (finalizedResult.job.state === 'cancelled') {
          // Clear the volatile guard only after the cancelled terminal (and its
          // batch/file proof, when available) committed successfully.
          this.dependencies.clearCancellation?.({
            storeId: capturedContext.storeId,
            requestId: request.requestId,
            jobId: finalizedResult.job.jobId,
          });
        }
        this.publishTerminalProgress(finalizedResult);

        let importSummary: unknown;
        if (importEligible) {
          this.assertNotCancelled(result.job.jobId, request, capturedContext);
          operation.assertStepCurrent();
          const attemptedAt = nextCollectionTimestamp(finalizedResult.job.updatedAt);
          finalizedResult = {
            ...finalizedResult,
            job: transitionCollectionImportState(finalizedResult.job, 'pending', {
              attemptedAt,
            }),
          };
          await this.dependencies.persistence.persistImportState(finalizedResult.job);
          this.publishTerminalProgress(finalizedResult);
          try {
            // persistImportState can itself yield. Re-read cancellation after
            // that write and before any report rows reach the authority DB.
            this.assertNotCancelled(result.job.jobId, request, capturedContext);
            if (!this.dependencies.importResult) {
              throw new Error('LINGXING_COLLECTION_IMPORT_HANDLER_UNAVAILABLE');
            }
            importSummary = await this.dependencies.importResult(finalizedResult);
          } catch (error) {
            const completedAt = nextCollectionTimestamp(finalizedResult.job.updatedAt);
            finalizedResult = {
              ...finalizedResult,
              job: transitionCollectionImportState(finalizedResult.job, 'failed', {
                attemptedAt,
                completedAt,
                error: error instanceof Error ? error.message : String(error),
              }),
            };
            await this.dependencies.persistence.persistImportState(finalizedResult.job);
            this.publishTerminalProgress(finalizedResult);
            throw error;
          }
          const completedAt = nextCollectionTimestamp(finalizedResult.job.updatedAt);
          finalizedResult = {
            ...finalizedResult,
            job: transitionCollectionImportState(finalizedResult.job, 'succeeded', {
              attemptedAt,
              completedAt,
            }),
          };
          await this.dependencies.persistence.persistImportState(finalizedResult.job);
          this.publishTerminalProgress(finalizedResult);
        }
        return {
          result: finalizedResult,
          ...(importSummary === undefined ? {} : { importSummary }),
        };
      } catch (error) {
        // Intentionally retain a cancellation guard on every failure path. It
        // is safe to remove only after a durable cancelled terminal succeeds.
        throw error;
      }
    });
  }

  private resolveAuthorizedRuntime(
    context: StoreContextEnvelope,
    canary: boolean,
  ): LingxingCollectionRuntime {
    const runtime = this.dependencies.resolveRuntime(context, { canary });
    if (!runtime?.automation || !runtime.capsule || !runtime.target) {
      throw new Error('LINGXING_COLLECTION_RUNTIME_UNAVAILABLE');
    }
    if (
      runtime.storeId !== context.storeId
      || runtime.browserProfileId !== context.browserProfileId
      || runtime.capsule.storeId !== context.storeId
      || runtime.capsule.browserProfileId !== context.browserProfileId
      || !runtime.storeDisplayName.trim()
      || runtime.target.marketplaceCode !== 'US'
      || runtime.target.storeId !== context.storeId
      || !runtime.target.storeName.trim()
      || runtime.canary !== canary
    ) {
      throw new Error('LINGXING_COLLECTION_RUNTIME_SCOPE_MISMATCH');
    }
    const capsule = ensureStoreCapsulePaths(runtime.capsule);
    assertPathContained(capsule.storeRoot, capsule.downloadsDir);
    return { ...runtime, capsule };
  }

  private captureAuthority(submitted: StoreContextEnvelope): StoreContextEnvelope {
    const captured = this.dependencies.authority.assertActiveStoreContext(submitted);
    const authoritative = this.dependencies.authority.getActiveStoreContext();
    if (
      !authoritative
      || missionControlContextKey(authoritative) !== missionControlContextKey(captured)
    ) {
      throw new Error('LINGXING_COLLECTION_STORE_CONTEXT_CHANGED');
    }
    return Object.freeze({ ...authoritative });
  }

  private buildProgressSink(
    request: LingxingCollectionRequestDto,
    input: StartLingxingCollectionInput,
  ): LingxingCollectionProgressSink {
    return async (event) => {
      const durableEvent = {
        ...event,
        job: attachCollectionJobLineage(event.job, request, input),
      };
      assertProgressBelongsToRequest(durableEvent, request);
      if (this.isCancellationRequested(
        durableEvent.job.jobId,
        request,
        durableEvent.job.request.storeContext,
      )) return;
      // Progress durability is the safety boundary. A failed write must reject
      // so the collector stops before another external step.
      await this.dependencies.persistence.persistProgress(durableEvent);
      if (this.isCancellationRequested(
        durableEvent.job.jobId,
        request,
        durableEvent.job.request.storeContext,
      )) return;
      if (!this.dependencies.publishProgress) return;
      try {
        this.dependencies.authority.assertActiveStoreContext(durableEvent.job.request.storeContext);
        this.dependencies.publishProgress(durableEvent);
      } catch {
        // Never project a previous store's progress into the newly selected
        // workspace. The persisted checkpoint remains available for resume.
      }
    };
  }

  private buildAuthorityGuard(
    operation: CollectionOperation,
    context: StoreContextEnvelope,
    runtime: LingxingCollectionRuntime,
  ): LingxingCollectionAuthorityGuard {
    return () => {
      try {
        operation.renew(COLLECTION_LEASE_TTL_MS);
        this.dependencies.assertRuntimeCurrent?.(context, runtime);
        return { allowed: true };
      } catch (error) {
        return {
          allowed: false,
          blockerCode: 'LINGXING_COLLECTION_AUTHORITY_STALE',
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    };
  }

  private publishTerminalProgress(result: RunBatchResult): void {
    if (!this.dependencies.publishProgress) return;
    try {
      this.dependencies.authority.assertActiveStoreContext(result.job.request.storeContext);
      this.dependencies.publishProgress({
        eventId: `${result.job.jobId}:terminal:${result.job.importState || 'legacy'}`,
        emittedAt: result.job.updatedAt,
        job: result.job,
      });
    } catch {
      // Terminal truth is already durable. A store switch suppresses only the
      // projection into the newly selected Renderer workspace.
    }
  }

  private buildCancellationGuard(): LingxingCollectionCancellationGuard {
    return (context) => this.dependencies.isCancelled?.({
      jobId: context.jobId,
      requestId: context.requestId,
      storeId: context.storeContext.storeId,
    })
      ? {
          allowed: false,
          blockerCode: 'LINGXING_COLLECTION_CANCELLED',
          detail: '运营者已取消本次领星采集。',
        }
      : { allowed: true };
  }

  private cancelResultIfRequested(
    result: RunBatchResult,
    request: LingxingCollectionRequestDto,
    context: StoreContextEnvelope,
  ): RunBatchResult {
    if (result.job.state === 'cancelled') return result;
    if (!this.isCancellationRequested(result.job.jobId, request, context)) return result;
    return transitionCollectionResultToCancelled(result);
  }

  private isCancellationRequested(
    jobId: string,
    request: LingxingCollectionRequestDto,
    context: StoreContextEnvelope,
  ): boolean {
    return this.dependencies.isCancelled?.({
      jobId,
      requestId: request.requestId,
      storeId: context.storeId,
    }) ?? false;
  }

  private assertNotCancelled(
    jobId: string,
    request: LingxingCollectionRequestDto,
    context: StoreContextEnvelope,
    allowCancelledTerminal = false,
  ): void {
    if (this.dependencies.isCancelled?.({
      jobId,
      requestId: request.requestId,
      storeId: context.storeId,
    }) && !allowCancelledTerminal) {
      throw new Error('LINGXING_COLLECTION_CANCELLED');
    }
  }
}

const TERMINAL_REPORT_STATES = new Set<LingxingCollectionJobSnapshot['reports'][number]['state']>([
  'downloaded',
  'failed',
  'create_unknown',
  'cancelled',
  'stale_authority',
]);

function transitionCollectionResultToCancelled(result: RunBatchResult): RunBatchResult {
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

function attachCollectionLineage(
  result: RunBatchResult,
  request: LingxingCollectionRequestDto,
  input: StartLingxingCollectionInput,
): RunBatchResult {
  const job = attachCollectionJobLineage(result.job, request, input);
  return job === result.job ? result : { ...result, job };
}

function attachCollectionJobLineage(
  job: LingxingCollectionJobSnapshot,
  request: LingxingCollectionRequestDto,
  input: StartLingxingCollectionInput,
): LingxingCollectionJobSnapshot {
  if (input.canary) return job;
  const fullRequest = request.reportTypes.length === REPORT_TYPES.size
    && request.reportTypes.every((reportType) => REPORT_TYPES.has(reportType));
  const lineage = input.lineage ?? (fullRequest ? {
    lineageId: job.jobId,
    rootJobId: job.jobId,
    expectedReportTypes: [...request.reportTypes],
    purpose: 'production_full' as const,
  } : undefined);
  if (!lineage) return job;

  const safeJobId = (value: string) => /^[A-Za-z0-9._-]{1,180}$/.test(value);
  const expected = new Set(lineage.expectedReportTypes);
  if (
    !safeJobId(lineage.lineageId)
    || !safeJobId(lineage.rootJobId)
    || (lineage.parentJobId !== undefined && !safeJobId(lineage.parentJobId))
    || lineage.lineageId !== lineage.rootJobId
    || expected.size !== REPORT_TYPES.size
    || [...REPORT_TYPES].some((reportType) => !expected.has(reportType))
    || request.reportTypes.some((reportType) => !expected.has(reportType))
    || !['production_full', 'resume', 'retry'].includes(lineage.purpose)
    || (lineage.purpose === 'production_full' && (
      lineage.rootJobId !== job.jobId
      || lineage.parentJobId !== undefined
      || !fullRequest
    ))
    || (lineage.purpose !== 'production_full' && !lineage.parentJobId)
  ) {
    throw new Error('LINGXING_COLLECTION_LINEAGE_INVALID');
  }
  return {
    ...job,
    lineage: {
      lineageId: lineage.lineageId,
      rootJobId: lineage.rootJobId,
      ...(lineage.parentJobId ? { parentJobId: lineage.parentJobId } : {}),
      expectedReportTypes: [...lineage.expectedReportTypes],
      purpose: lineage.purpose,
    },
  };
}

function assertCanaryRequestIdentity(requestId: string, canary: boolean): void {
  const hasReservedPrefix = requestId.startsWith('canary:');
  if (hasReservedPrefix !== canary) {
    throw new Error(canary
      ? 'LINGXING_COLLECTION_CANARY_REQUEST_ID_REQUIRED'
      : 'LINGXING_COLLECTION_CANARY_REQUEST_ID_RESERVED');
  }
}

function nextCollectionTimestamp(previous: string): string {
  const previousMs = Date.parse(previous);
  const nextMs = Number.isFinite(previousMs)
    ? Math.max(Date.now(), previousMs + 1)
    : Date.now();
  return new Date(nextMs).toISOString();
}

function transitionCollectionImportState(
  job: LingxingCollectionJobSnapshot,
  importState: LingxingCollectionImportState,
  options: {
    attemptedAt?: string;
    completedAt?: string;
    error?: string;
  } = {},
): LingxingCollectionJobSnapshot {
  const updatedAt = nextCollectionTimestamp(job.updatedAt);
  return {
    ...job,
    importState,
    updatedAt,
    ...(options.attemptedAt ? { importAttemptedAt: options.attemptedAt } : {}),
    ...(options.completedAt ? { importCompletedAt: options.completedAt } : {}),
    ...(options.error ? { importError: options.error } : {}),
  };
}

export function normalizeCollectionRequest(
  input: StartLingxingCollectionInput,
): LingxingCollectionRequestDto {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Lingxing collection request must be an object');
  }
  const requestId = String(input.requestId || '').trim();
  if (!SAFE_REQUEST_ID.test(requestId)) {
    throw new TypeError('Lingxing collection requestId is invalid');
  }
  if (input.mode !== 'create-and-download' && input.mode !== 'download-existing') {
    throw new TypeError('Lingxing collection mode is invalid');
  }
  const dateStart = normalizeIsoDate(input.dateStart, 'dateStart');
  const dateEnd = normalizeIsoDate(input.dateEnd, 'dateEnd');
  if (dateStart > dateEnd) {
    throw new TypeError('Lingxing collection date range must be ascending');
  }
  const storeContext = normalizeStoreContextEnvelope(input.storeContext);
  const reportTypes = input.reportTypes === undefined
    ? LINGXING_AD_REPORTS.map((report) => report.type)
    : [...input.reportTypes];
  if (
    reportTypes.length < 1
    || new Set(reportTypes).size !== reportTypes.length
    || reportTypes.some((reportType) => !REPORT_TYPES.has(reportType))
  ) {
    throw new TypeError('Lingxing collection reportTypes are invalid');
  }
  return {
    requestId,
    storeContext,
    dateStart,
    dateEnd,
    mode: input.mode,
    reportTypes,
  };
}

function normalizeIsoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new TypeError(`Lingxing collection ${label} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`Lingxing collection ${label} is invalid`);
  }
  return value;
}

function assertProgressBelongsToRequest(
  event: LingxingCollectionProgressEvent,
  request: LingxingCollectionRequestDto,
): void {
  if (
    event.job.request.requestId !== request.requestId
    || event.job.request.mode !== request.mode
    || event.job.request.dateStart !== request.dateStart
    || event.job.request.dateEnd !== request.dateEnd
    || missionControlContextKey(event.job.request.storeContext)
      !== missionControlContextKey(request.storeContext)
    || !sameReportTypeSet(event.job.request.reportTypes, request.reportTypes)
    || !sameReportTypeSet(
      event.job.reports.map((checkpoint) => checkpoint.reportType),
      request.reportTypes,
    )
  ) {
    throw new Error('LINGXING_COLLECTION_PROGRESS_SCOPE_MISMATCH');
  }
}

function assertResultBelongsToRequest(
  result: RunBatchResult,
  request: LingxingCollectionRequestDto,
  capsule: StoreCapsulePaths,
): void {
  assertProgressBelongsToRequest({
    eventId: `${result.job.jobId}:final`,
    emittedAt: result.job.updatedAt,
    job: result.job,
  }, request);
  if (
    result.job.jobId !== result.batch.id
    || result.batch.requestId !== request.requestId
    || result.batch.storeId !== request.storeContext.storeId
    || result.batch.browserProfileId !== request.storeContext.browserProfileId
    || result.batch.businessDate !== request.storeContext.businessDate
    || result.batch.sessionGeneration !== request.storeContext.sessionGeneration
    || result.batch.marketplaceCode !== request.storeContext.marketplace
    || result.batch.dateStart !== request.dateStart
    || result.batch.dateEnd !== request.dateEnd
  ) {
    throw new Error('LINGXING_COLLECTION_RESULT_SCOPE_MISMATCH');
  }
  assertPathContained(capsule.downloadsDir, result.batch.downloadDir);
  if (result.batch.manifestPath) {
    assertPathContained(result.batch.downloadDir, result.batch.manifestPath);
  }
  if (
    (result.job.state === 'completed' || result.job.state === 'completed_with_errors')
    && (
      !result.batch.manifestPath
      || !fs.existsSync(result.batch.manifestPath)
      || !fs.statSync(result.batch.manifestPath).isFile()
    )
  ) {
    throw new Error('LINGXING_COLLECTION_RESULT_MANIFEST_MISSING');
  }
  if (
    (result.job.state === 'completed' || result.job.state === 'completed_with_errors')
    && !sameReportTypeSet(
      result.files.map((file) => file.reportType),
      request.reportTypes,
    )
  ) {
    throw new Error('LINGXING_COLLECTION_RESULT_FILE_SET_INCOMPLETE');
  }
  const seenFileIds = new Set<string>();
  for (const file of result.files) {
    if (
      file.batchId !== result.batch.id
      || !request.reportTypes.includes(file.reportType)
      || seenFileIds.has(file.id)
    ) {
      throw new Error('LINGXING_COLLECTION_RESULT_FILE_SCOPE_MISMATCH');
    }
    seenFileIds.add(file.id);
    if (file.filePath) assertPathContained(result.batch.downloadDir, file.filePath);
    if (
      file.status === 'downloaded'
      && (
        !file.filePath
        || !fs.existsSync(file.filePath)
        || !fs.statSync(file.filePath).isFile()
      )
    ) {
      throw new Error('LINGXING_COLLECTION_RESULT_DOWNLOADED_FILE_MISSING');
    }
  }
}

function sameReportTypeSet(
  left: readonly LingxingReportType[],
  right: readonly LingxingReportType[],
): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && left.every((reportType) => right.includes(reportType));
}
