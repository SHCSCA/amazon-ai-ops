import * as path from 'path';
import {
  normalizeStoreContextEnvelope,
  type LingxingCollectionExternalStep,
  type LingxingCollectionGuardContext,
  type LingxingCollectionGuardDecision,
  type LingxingCollectionJobSnapshot,
  type LingxingCollectionProgressEvent,
  type LingxingCollectionReportCheckpoint,
  type LingxingCollectionReportState,
  type LingxingCollectionRequestDto,
  type LingxingCollectionResumeState,
  type LingxingCreateReportOutcome,
  type LingxingCreatedReportIdentity,
  type LingxingReportBatch,
  type LingxingReportDefinition,
  type LingxingReportFile,
  type LingxingReportType,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { LINGXING_AD_REPORTS } from './report-types';
import { DownloadCenterPage, type DownloadCenterAutomationPort } from './download-center-page';
import { verifyDownloadedFile } from './file-verifier';
import { writeManifest } from './manifest';

type MaybePromise<T> = T | Promise<T>;

export type LingxingCollectionProgressSink = (
  event: LingxingCollectionProgressEvent,
) => MaybePromise<void>;

export type LingxingCollectionAuthorityGuard = (
  context: LingxingCollectionGuardContext,
) => MaybePromise<LingxingCollectionGuardDecision>;

export type LingxingCollectionCancellationGuard = (
  context: LingxingCollectionGuardContext,
) => MaybePromise<LingxingCollectionGuardDecision>;

export interface RunBatchOptions {
  requestId: string;
  storeContext: StoreContextEnvelope;
  storeDisplayName: string;
  dateStart: string;
  dateEnd: string;
  rootDownloadDir: string;
  appVersion?: string;
  reportTypes?: readonly LingxingReportType[];
  maxRetries?: number;
  automation: DownloadCenterAutomationPort;
  progressSink: LingxingCollectionProgressSink;
  authorityGuard: LingxingCollectionAuthorityGuard;
  cancellationGuard: LingxingCollectionCancellationGuard;
  /**
   * The durable request context stays immutable across an in-place resume.
   * Main may provide a newer session generation solely for guarded browser
   * execution; it must still describe the same stable store axes.
   */
  executionStoreContext?: StoreContextEnvelope;
  progressEventNamespace?: string;
  resumeFrom?: LingxingCollectionResumeState | LingxingInPlaceResumeState;
}

export interface LingxingInPlaceResumeState extends LingxingCollectionResumeState {
  job: LingxingCollectionJobSnapshot;
  batch: LingxingReportBatch;
  files: readonly LingxingReportFile[];
}

export interface RunBatchResult {
  batch: LingxingReportBatch;
  files: LingxingReportFile[];
  job: LingxingCollectionJobSnapshot;
}

type ReportDownloadMode = 'create-and-download' | 'download-existing';

type MutableCollectionJob = Omit<LingxingCollectionJobSnapshot, 'reports' | 'request'> & {
  request: LingxingCollectionRequestDto;
  reports: LingxingCollectionReportCheckpoint[];
};

class GuardBlockedError extends Error {
  constructor(
    readonly state: 'cancelled' | 'stale_authority',
    readonly blockerCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'GuardBlockedError';
  }
}

class UnknownCreateOutcomeError extends Error {
  constructor(readonly blockerCode: string, message: string) {
    super(message);
    this.name = 'UnknownCreateOutcomeError';
  }
}

class KnownNotCreatedError extends Error {
  constructor(
    readonly retryable: boolean,
    readonly blockerCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'KnownNotCreatedError';
  }
}

class ProgressPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProgressPersistenceError';
  }
}

function stamp(): string {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17)}_${Math.random().toString(36).slice(2, 8)}`;
}

let lastGeneratedTimestampMs = 0;

function isoNow(): string {
  const nextTimestampMs = Math.max(Date.now(), lastGeneratedTimestampMs + 1);
  lastGeneratedTimestampMs = nextTimestampMs;
  return new Date(nextTimestampMs).toISOString();
}

function isoAfter(value: string): string {
  const floor = Date.parse(value);
  if (!Number.isFinite(floor)) throw new Error('resume updatedAt must be a valid timestamp');
  const nextTimestampMs = Math.max(Date.now(), lastGeneratedTimestampMs + 1, floor + 1);
  lastGeneratedTimestampMs = nextTimestampMs;
  return new Date(nextTimestampMs).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pathFreeDetail(value: unknown): string {
  return String(value ?? '')
    .slice(0, 2_000)
    .replace(/[A-Za-z]:[\\/][^\s"'<>]*/g, '[local-path-redacted]')
    .replace(/\\\\[^\s"'<>]+/g, '[local-path-redacted]')
    .replace(/\/(?:Users|home|tmp|var|opt|mnt)\/[^\s"'<>]*/g, '[local-path-redacted]')
    .replace(/\b(password|passwd|cookie|token|secret|authorization)\b\s*[:=]\s*([^\s,;]+)/gi, '$1=[redacted]')
    .replace(/(https?:\/\/)([^/\s@]+)@/gi, '$1[userinfo-redacted]@');
}

function containsUnsafeIdentityText(value: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(value) || pathFreeDetail(value) !== value;
}

function normalizeBlockerCode(value: unknown, fallback: string): string {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z0-9][A-Z0-9_.:-]{0,127}$/.test(normalized) ? normalized : fallback;
}

function validateRequestId(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new Error('requestId must contain 1-128 safe identifier characters');
  }
  return normalized;
}

function validateStoreDisplayName(value: string): string {
  const normalized = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (
    !normalized
    || normalized.length > 160
    || containsUnsafeIdentityText(normalized)
  ) {
    throw new Error('storeDisplayName must be a safe non-empty display label of at most 160 characters');
  }
  return normalized;
}

function validateDateRange(dateStart: string, dateEnd: string): void {
  const validIsoDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!validIsoDate(dateStart) || !validIsoDate(dateEnd) || dateStart > dateEnd) {
    throw new Error('dateStart and dateEnd must be a valid ascending YYYY-MM-DD range');
  }
}

function selectReports(reportTypes?: readonly LingxingReportType[]): LingxingReportDefinition[] {
  if (reportTypes && reportTypes.length === 0) {
    throw new Error('reportTypes must be omitted for a full batch or contain at least one report type');
  }
  if (!reportTypes) return [...LINGXING_AD_REPORTS];

  const requested = new Set(reportTypes);
  if (requested.size !== reportTypes.length) {
    throw new Error(`Duplicate Lingxing report type in retry batch: ${reportTypes.join(', ')}`);
  }
  const selected = LINGXING_AD_REPORTS.filter((report) => requested.has(report.type));
  if (selected.length !== reportTypes.length) {
    throw new Error(`Unknown Lingxing report type in retry batch: ${reportTypes.join(', ')}`);
  }
  return selected;
}

function storeContextKey(context: StoreContextEnvelope): string {
  return [
    context.storeId,
    context.browserProfileId,
    context.marketplace,
    context.currency,
    context.businessTimezone,
    context.businessDate,
    context.sessionGeneration,
  ].join('|');
}

function stableStoreContextKey(context: StoreContextEnvelope): string {
  return [
    context.storeId,
    context.browserProfileId,
    context.marketplace,
    context.currency,
    context.businessTimezone,
    context.businessDate,
  ].join('|');
}

function isInPlaceResumeState(
  value: LingxingCollectionResumeState | LingxingInPlaceResumeState | undefined,
): value is LingxingInPlaceResumeState {
  return Boolean(
    value
    && 'job' in value
    && 'batch' in value
    && 'files' in value
    && Array.isArray(value.files),
  );
}

function cloneReportFile(file: LingxingReportFile): LingxingReportFile {
  return {
    ...file,
    ...(file.attemptErrors ? { attemptErrors: [...file.attemptErrors] } : {}),
  };
}

function assertPathWithin(rootPath: string, candidatePath: string, label: string): void {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must remain inside the authorized store download root`);
  }
}

function cloneCreatedIdentity(
  identity: LingxingCreatedReportIdentity,
): LingxingCreatedReportIdentity {
  return { ...identity };
}

function cloneCheckpoint(
  checkpoint: LingxingCollectionReportCheckpoint,
): LingxingCollectionReportCheckpoint {
  return {
    ...checkpoint,
    ...(checkpoint.createdReportIdentity
      ? { createdReportIdentity: cloneCreatedIdentity(checkpoint.createdReportIdentity) }
      : {}),
  };
}

function cloneRequest(request: LingxingCollectionRequestDto): LingxingCollectionRequestDto {
  return {
    ...request,
    storeContext: { ...request.storeContext },
    reportTypes: [...request.reportTypes],
  };
}

function snapshotJob(job: MutableCollectionJob): LingxingCollectionJobSnapshot {
  return {
    ...job,
    request: cloneRequest(job.request),
    reports: job.reports.map(cloneCheckpoint),
  };
}

function normalizeCreatedIdentity(
  value: LingxingCreatedReportIdentity,
  reportType: LingxingReportType,
  dateStart: string,
  dateEnd: string,
): LingxingCreatedReportIdentity {
  if (!value || typeof value !== 'object') {
    throw new Error('create result did not include a report identity');
  }
  const externalReportName = String(value.externalReportName || '').trim();
  const createdAt = String(value.createdAt || '').trim();
  if (
    value.provider !== 'lingxing'
    || value.reportType !== reportType
    || value.dateStart !== dateStart
    || value.dateEnd !== dateEnd
    || !externalReportName
    || externalReportName.length > 320
    || containsUnsafeIdentityText(externalReportName)
    || !createdAt
    || Number.isNaN(Date.parse(createdAt))
  ) {
    throw new Error('create result returned an invalid or mismatched report identity');
  }
  const externalReportId = value.externalReportId === undefined
    ? undefined
    : String(value.externalReportId).trim();
  if (
    value.externalReportId !== undefined
    && (
      !externalReportId
      || externalReportId.length > 320
      || containsUnsafeIdentityText(externalReportId)
    )
  ) {
    throw new Error('create result returned an invalid external report id');
  }
  return Object.freeze({
    provider: 'lingxing' as const,
    reportType,
    externalReportName,
    ...(externalReportId ? { externalReportId } : {}),
    dateStart,
    dateEnd,
    createdAt: new Date(createdAt).toISOString(),
  });
}

interface ValidatedResumeState {
  checkpoints: Map<LingxingReportType, LingxingCollectionReportCheckpoint>;
  downloadedFiles: Map<LingxingReportType, LingxingReportFile>;
  inPlace?: LingxingInPlaceResumeState;
}

function validateResumeState(
  resumeFrom: LingxingCollectionResumeState | LingxingInPlaceResumeState | undefined,
  request: LingxingCollectionRequestDto,
  maxRetries: number,
  rootDownloadDir: string,
): ValidatedResumeState {
  if (!resumeFrom) {
    return { checkpoints: new Map(), downloadedFiles: new Map() };
  }
  const inPlace = isInPlaceResumeState(resumeFrom) ? resumeFrom : undefined;
  if (!/^[A-Za-z0-9._-]{1,180}$/.test(resumeFrom.jobId)) {
    throw new Error('resume jobId is invalid');
  }
  if (
    resumeFrom.request.requestId !== request.requestId
    || resumeFrom.request.mode !== request.mode
    || resumeFrom.request.dateStart !== request.dateStart
    || resumeFrom.request.dateEnd !== request.dateEnd
    || storeContextKey(normalizeStoreContextEnvelope(resumeFrom.request.storeContext))
      !== storeContextKey(request.storeContext)
    || JSON.stringify(resumeFrom.request.reportTypes) !== JSON.stringify(request.reportTypes)
  ) {
    throw new Error('resume state does not match the current store-authoritative request');
  }

  if (inPlace) {
    if (
      inPlace.job.jobId !== inPlace.jobId
      || stableJsonForIdentity(inPlace.job.request) !== stableJsonForIdentity(inPlace.request)
      || inPlace.batch.id !== inPlace.jobId
      || inPlace.batch.requestId !== request.requestId
      || inPlace.batch.storeId !== request.storeContext.storeId
      || inPlace.batch.browserProfileId !== request.storeContext.browserProfileId
      || inPlace.batch.marketplaceCode !== request.storeContext.marketplace
      || inPlace.batch.businessDate !== request.storeContext.businessDate
      || inPlace.batch.sessionGeneration !== request.storeContext.sessionGeneration
      || inPlace.batch.dateStart !== request.dateStart
      || inPlace.batch.dateEnd !== request.dateEnd
    ) {
      throw new Error('in-place resume batch/job identity does not match the durable request');
    }
    if (request.reportTypes.length !== LINGXING_AD_REPORTS.length) {
      throw new Error('in-place resume requires the complete eight-report request');
    }
    assertPathWithin(rootDownloadDir, inPlace.batch.downloadDir, 'resume batch downloadDir');
  }

  const allowedReports = new Set(request.reportTypes);
  const checkpoints = new Map<LingxingReportType, LingxingCollectionReportCheckpoint>();
  const downloadedFiles = new Map<LingxingReportType, LingxingReportFile>();
  const filesByType = new Map<LingxingReportType, LingxingReportFile[]>();
  if (inPlace) {
    for (const rawFile of inPlace.files) {
      if (rawFile.batchId !== inPlace.jobId || !allowedReports.has(rawFile.reportType)) {
        throw new Error('in-place resume contains an out-of-scope durable file');
      }
      const current = filesByType.get(rawFile.reportType) ?? [];
      current.push(rawFile);
      if (current.length > 1) {
        throw new Error('in-place resume contains duplicate durable files for one report type');
      }
      filesByType.set(rawFile.reportType, current);
    }
  }
  for (const rawCheckpoint of resumeFrom.reports) {
    if (!allowedReports.has(rawCheckpoint.reportType) || checkpoints.has(rawCheckpoint.reportType)) {
      throw new Error('resume state contains a duplicate or out-of-scope report checkpoint');
    }
    if (
      !Number.isInteger(rawCheckpoint.attemptIndex)
      || rawCheckpoint.attemptIndex < 0
      || rawCheckpoint.attemptIndex > maxRetries
    ) {
      throw new Error('resume state contains an invalid attempt index');
    }
    if (rawCheckpoint.state === 'queued') {
      if (rawCheckpoint.createdReportIdentity) {
        throw new Error('queued resume checkpoints must not contain a created report identity');
      }
      checkpoints.set(rawCheckpoint.reportType, cloneCheckpoint(rawCheckpoint));
      continue;
    }
    if (
      !rawCheckpoint.createdReportIdentity
      && (rawCheckpoint.state === 'navigating' || rawCheckpoint.state === 'failed')
    ) {
      // Navigating without an identity is durably before report creation, so
      // restarting it from queued is safe.
      checkpoints.set(rawCheckpoint.reportType, {
        ...cloneCheckpoint(rawCheckpoint),
        state: 'queued',
        fileSizeBytes: undefined,
        errorCode: undefined,
      });
      continue;
    }
    if (rawCheckpoint.state === 'downloaded') {
      if (!inPlace) {
        throw new Error(
          'downloaded resume checkpoints must be resolved by Main from the persisted verified file and are never redownloaded automatically',
        );
      }
      const matchingFiles = filesByType.get(rawCheckpoint.reportType) ?? [];
      if (matchingFiles.length !== 1) {
        throw new Error('downloaded resume checkpoint requires exactly one durable file');
      }
      const durableFile = matchingFiles[0];
      if (!rawCheckpoint.createdReportIdentity) {
        throw new Error('downloaded resume checkpoint requires a confirmed created report identity');
      }
      normalizeCreatedIdentity(
        rawCheckpoint.createdReportIdentity,
        rawCheckpoint.reportType,
        request.dateStart,
        request.dateEnd,
      );
      if (
        durableFile.status !== 'downloaded'
        || !durableFile.filePath
        || !Number.isSafeInteger(durableFile.fileSizeBytes)
        || durableFile.fileSizeBytes! <= 0
        || durableFile.fileSizeBytes !== rawCheckpoint.fileSizeBytes
      ) {
        throw new Error('downloaded resume checkpoint has invalid durable file metadata');
      }
      const report = LINGXING_AD_REPORTS.find((candidate) => (
        candidate.type === rawCheckpoint.reportType
      ));
      if (!report) throw new Error('downloaded resume checkpoint report type is unknown');
      const verification = verifyDownloadedFile(durableFile.filePath, {
        minBytes: 128,
        expectedFilenameKeyword: report.expectedFilenameKeyword,
        expectedDateRange: { start: request.dateStart, end: request.dateEnd },
        expectedDownloadDir: inPlace.batch.downloadDir,
        expectedReportType: report.type,
      });
      if (!verification.valid || verification.fileSizeBytes !== durableFile.fileSizeBytes) {
        throw new Error(
          verification.errorMessage
          || 'downloaded resume file no longer matches its durable verification metadata',
        );
      }
      checkpoints.set(rawCheckpoint.reportType, cloneCheckpoint(rawCheckpoint));
      downloadedFiles.set(rawCheckpoint.reportType, cloneReportFile(durableFile));
      continue;
    }
    if (rawCheckpoint.state === 'create_unknown' || rawCheckpoint.state === 'creating') {
      throw new Error(
        'resume is blocked because report creation requires human reconciliation',
      );
    }
    if (rawCheckpoint.state === 'cancelled' || rawCheckpoint.state === 'stale_authority') {
      throw new Error(
        'cancelled or stale-authority checkpoints require a newly authorized Main-owned resume request',
      );
    }
    const identity = rawCheckpoint.createdReportIdentity
      ? normalizeCreatedIdentity(
          rawCheckpoint.createdReportIdentity,
          rawCheckpoint.reportType,
          request.dateStart,
          request.dateEnd,
        )
      : undefined;
    if (!identity) {
      throw new Error('resume is allowed only from a checkpoint with a confirmed created report identity');
    }
    const state: LingxingCollectionReportState = rawCheckpoint.state === 'ready'
      ? 'ready'
      : 'created';
    checkpoints.set(rawCheckpoint.reportType, {
      ...rawCheckpoint,
      state,
      createdReportIdentity: identity,
    });
  }
  if (inPlace && checkpoints.size !== request.reportTypes.length) {
    throw new Error('in-place resume must contain exactly one checkpoint for every report type');
  }
  if (inPlace && resumeFrom.reports.length !== request.reportTypes.length) {
    throw new Error('in-place resume must contain exactly eight report checkpoints');
  }
  return { checkpoints, downloadedFiles, ...(inPlace ? { inPlace } : {}) };
}

function stableJsonForIdentity(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJsonForIdentity).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJsonForIdentity(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function legacyStatusForState(
  state: LingxingCollectionReportState,
): LingxingReportFile['status'] {
  if (state === 'queued') return 'pending';
  if (state === 'creating') return 'creating';
  if (state === 'created') return 'created';
  if (state === 'waiting_ready') return 'generating';
  if (state === 'ready') return 'ready';
  if (state === 'downloading' || state === 'verifying') return 'downloading';
  if (state === 'downloaded') return 'downloaded';
  return 'failed';
}

function createOutcomeError(outcome: unknown): Error {
  if (!outcome || typeof outcome !== 'object') {
    return new UnknownCreateOutcomeError(
      'LINGXING_CREATE_OUTCOME_INVALID',
      'Lingxing report creation returned no confirmed outcome',
    );
  }
  const candidate = outcome as Partial<Exclude<LingxingCreateReportOutcome, { status: 'created' }>>;
  if (candidate.status === 'unknown') {
    return new UnknownCreateOutcomeError(
      normalizeBlockerCode(candidate.blockerCode, 'LINGXING_CREATE_OUTCOME_UNKNOWN'),
      candidate.detail || 'Lingxing report creation outcome is unknown',
    );
  }
  if (candidate.status === 'not_created' && typeof candidate.retryable === 'boolean') {
    return new KnownNotCreatedError(
      candidate.retryable,
      normalizeBlockerCode(candidate.blockerCode, 'LINGXING_REPORT_NOT_CREATED'),
      candidate.detail || 'Lingxing confirmed that the report was not created',
    );
  }
  return new UnknownCreateOutcomeError(
    'LINGXING_CREATE_OUTCOME_INVALID',
    'Lingxing report creation returned an invalid or unsupported outcome',
  );
}

export async function runLingxingReportBatch(options: RunBatchOptions): Promise<RunBatchResult> {
  return runLingxingReportBatchInternal(options, 'create-and-download');
}

export async function downloadExistingLingxingReportBatch(options: RunBatchOptions): Promise<RunBatchResult> {
  return runLingxingReportBatchInternal(options, 'download-existing');
}

async function runLingxingReportBatchInternal(
  options: RunBatchOptions,
  mode: ReportDownloadMode,
): Promise<RunBatchResult> {
  const requestId = validateRequestId(options.requestId);
  const storeContext = Object.freeze({ ...normalizeStoreContextEnvelope(options.storeContext) });
  const executionStoreContext = Object.freeze({
    ...normalizeStoreContextEnvelope(options.executionStoreContext ?? options.storeContext),
  });
  if (
    stableStoreContextKey(storeContext) !== stableStoreContextKey(executionStoreContext)
    || executionStoreContext.sessionGeneration < storeContext.sessionGeneration
  ) {
    throw new Error(
      'executionStoreContext must match the durable store axes and cannot use an older session generation',
    );
  }
  const progressEventNamespace = options.progressEventNamespace === undefined
    ? undefined
    : validateRequestId(options.progressEventNamespace);
  const storeDisplayName = validateStoreDisplayName(options.storeDisplayName);
  validateDateRange(options.dateStart, options.dateEnd);
  const requestedMaxRetries = options.maxRetries ?? 2;
  if (
    !Number.isInteger(requestedMaxRetries)
    || requestedMaxRetries < 0
    || requestedMaxRetries > 10
  ) {
    throw new Error('maxRetries must be an integer between 0 and 10');
  }
  const durableAttemptFloor = options.resumeFrom?.reports.reduce((highest, checkpoint) => (
    Number.isInteger(checkpoint.attemptIndex)
      && checkpoint.attemptIndex >= 0
      && checkpoint.attemptIndex <= 10
      ? Math.max(highest, checkpoint.attemptIndex)
      : highest
  ), 0) ?? 0;
  // A resume may not lower the retry ceiling beneath a durable checkpoint.
  // This keeps historical jobs resumable when composition omitted maxRetries.
  const maxRetries = Math.max(requestedMaxRetries, durableAttemptFloor);
  const selectedReports = selectReports(options.reportTypes);
  const request: LingxingCollectionRequestDto = Object.freeze({
    requestId,
    storeContext,
    dateStart: options.dateStart,
    dateEnd: options.dateEnd,
    mode,
    reportTypes: Object.freeze(selectedReports.map((report) => report.type)),
  });
  const validatedResume = validateResumeState(
    options.resumeFrom,
    request,
    maxRetries,
    options.rootDownloadDir,
  );
  const resumeCheckpoints = validatedResume.checkpoints;
  const batchId = options.resumeFrom?.jobId ?? `batch_${stamp()}`;
  const downloadDir = validatedResume.inPlace?.batch.downloadDir ?? path.join(
    options.rootDownloadDir,
    'lingxing-ad-reports',
    `${options.dateStart}_${options.dateEnd}`,
    batchId,
  );
  const createdAt = validatedResume.inPlace?.batch.createdAt ?? isoNow();
  if (validatedResume.inPlace?.batch.appVersion
    && options.appVersion
    && validatedResume.inPlace.batch.appVersion !== options.appVersion) {
    throw new Error('in-place resume cannot change the durable batch appVersion');
  }
  const batch: LingxingReportBatch = validatedResume.inPlace
    ? {
        ...validatedResume.inPlace.batch,
        status: 'running',
        completedAt: undefined,
        manifestPath: undefined,
      }
    : {
        id: batchId,
        requestId,
        storeId: storeContext.storeId,
        browserProfileId: storeContext.browserProfileId,
        businessDate: storeContext.businessDate,
        sessionGeneration: storeContext.sessionGeneration,
        appVersion: options.appVersion,
        dateStart: options.dateStart,
        dateEnd: options.dateEnd,
        storeName: storeDisplayName,
        marketplaceCode: storeContext.marketplace,
        status: 'running',
        downloadDir,
        createdAt,
      };
  const initialJobTimestamp = validatedResume.inPlace
    ? isoAfter(validatedResume.inPlace.job.updatedAt)
    : createdAt;
  const job: MutableCollectionJob = validatedResume.inPlace
    ? {
        ...validatedResume.inPlace.job,
        request,
        state: 'running',
        reports: selectedReports.map((report) => (
          resumeCheckpoints.get(report.type)!
        )),
        completedAt: undefined,
        blockerCode: undefined,
        detail: undefined,
        updatedAt: initialJobTimestamp,
      }
    : {
        jobId: batchId,
        request,
        state: 'running',
        reports: selectedReports.map((report) => (
          resumeCheckpoints.get(report.type) ?? {
            reportType: report.type,
            state: 'queued',
            attemptIndex: 0,
            autoRetryCount: 0,
            updatedAt: createdAt,
          }
        )),
        createdAt,
        updatedAt: createdAt,
      };
  const page = new DownloadCenterPage(options.automation);
  const files: LingxingReportFile[] = [];
  const durableFilesByType = new Map<LingxingReportType, LingxingReportFile>(
    (validatedResume.inPlace?.files ?? []).map((file) => [file.reportType, file]),
  );
  let progressSequence = 0;
  let progressSinkFailed = false;
  let aborted: GuardBlockedError | null = null;
  let reconciliationBlocked: UnknownCreateOutcomeError | null = null;

  const emitProgress = async (
    changedReportType?: LingxingReportType,
    externalStep?: LingxingCollectionExternalStep,
  ): Promise<void> => {
    job.updatedAt = isoNow();
    progressSequence += 1;
    const event: LingxingCollectionProgressEvent = {
      eventId: `${progressEventNamespace ?? job.jobId}:${progressSequence}`,
      emittedAt: job.updatedAt,
      ...(changedReportType ? { changedReportType } : {}),
      ...(externalStep ? { externalStep } : {}),
      job: snapshotJob(job),
    };
    try {
      await options.progressSink(event);
    } catch (error) {
      progressSinkFailed = true;
      throw new ProgressPersistenceError(`collection progress sink failed: ${errorMessage(error)}`);
    }
  };

  const updateReport = async (
    checkpoint: LingxingCollectionReportCheckpoint,
    file: LingxingReportFile,
    state: LingxingCollectionReportState,
    detail?: string,
    externalStep?: LingxingCollectionExternalStep,
  ): Promise<void> => {
    checkpoint.state = state;
    checkpoint.detail = detail === undefined ? undefined : pathFreeDetail(detail);
    checkpoint.updatedAt = isoNow();
    checkpoint.autoRetryCount = checkpoint.attemptIndex;
    file.status = legacyStatusForState(state);
    file.updatedAt = checkpoint.updatedAt;
    await emitProgress(checkpoint.reportType, externalStep);
  };

  const guardExternalStep = async (
    step: LingxingCollectionExternalStep,
    reportType?: LingxingReportType,
    attemptIndex = 0,
    createdReportIdentity?: LingxingCreatedReportIdentity,
  ): Promise<void> => {
    const context: LingxingCollectionGuardContext = {
      jobId: job.jobId,
      requestId,
      storeContext: executionStoreContext,
      ...(reportType ? { reportType } : {}),
      attemptIndex,
      step,
      ...(createdReportIdentity ? { createdReportIdentity: cloneCreatedIdentity(createdReportIdentity) } : {}),
    };
    let authority: LingxingCollectionGuardDecision;
    try {
      authority = await options.authorityGuard(context);
    } catch (error) {
      throw new GuardBlockedError(
        'stale_authority',
        'LINGXING_COLLECTION_AUTHORITY_GUARD_FAILED',
        errorMessage(error),
      );
    }
    if (!authority || authority.allowed !== true) {
      const blocked = authority as Exclude<LingxingCollectionGuardDecision, { allowed: true }> | undefined;
      throw new GuardBlockedError(
        'stale_authority',
        normalizeBlockerCode(
          blocked?.blockerCode,
          'LINGXING_COLLECTION_AUTHORITY_STALE',
        ),
        blocked?.detail || 'Store authority is no longer current',
      );
    }
    let cancellation: LingxingCollectionGuardDecision;
    try {
      cancellation = await options.cancellationGuard(context);
    } catch (error) {
      throw new GuardBlockedError(
        'cancelled',
        'LINGXING_COLLECTION_CANCELLATION_GUARD_FAILED',
        errorMessage(error),
      );
    }
    if (!cancellation || cancellation.allowed !== true) {
      const blocked = cancellation as Exclude<LingxingCollectionGuardDecision, { allowed: true }> | undefined;
      throw new GuardBlockedError(
        'cancelled',
        normalizeBlockerCode(blocked?.blockerCode, 'LINGXING_COLLECTION_CANCELLED'),
        blocked?.detail || 'Collection was cancelled',
      );
    }
  };

  await emitProgress();

  for (let reportIndex = 0; reportIndex < selectedReports.length; reportIndex += 1) {
    const report = selectedReports[reportIndex];
    const checkpoint = job.reports[reportIndex];
    const downloadedFile = validatedResume.downloadedFiles.get(report.type);
    if (downloadedFile) {
      files.push(cloneReportFile(downloadedFile));
      continue;
    }
    const durableFile = durableFilesByType.get(report.type);
    const {
      filePath: _staleFilePath,
      fileSizeBytes: _staleFileSizeBytes,
      ...durableFileBase
    } = durableFile ? cloneReportFile(durableFile) : {};
    const file: LingxingReportFile = {
      ...durableFileBase,
      id: durableFile?.id ?? `${batchId}_${report.type}`,
      batchId,
      reportType: report.type,
      displayName: durableFile?.displayName ?? report.displayName,
      status: legacyStatusForState(checkpoint.state),
      maxAutoRetries: maxRetries,
      autoRetryCount: checkpoint.autoRetryCount,
      attemptErrors: [...(durableFile?.attemptErrors ?? [])],
      createdAt: durableFile?.createdAt ?? createdAt,
      updatedAt: checkpoint.updatedAt,
    };
    let createdReportIdentity = checkpoint.createdReportIdentity;
    let readyConfirmed = checkpoint.state === 'ready';
    let reportCompleted = false;

    for (let attempt = checkpoint.attemptIndex; attempt <= maxRetries; attempt += 1) {
      checkpoint.attemptIndex = attempt;
      checkpoint.autoRetryCount = attempt;
      file.autoRetryCount = attempt;
      const isFinalAttempt = attempt === maxRetries;
      let traceStarted = false;
      let tracePath: string | undefined;

      try {
        if (isFinalAttempt && options.automation.startAttemptTrace) {
          await guardExternalStep('start_trace', report.type, attempt, createdReportIdentity);
          await options.automation.startAttemptTrace(
            report,
            { start: options.dateStart, end: options.dateEnd },
            attempt,
          );
          traceStarted = true;
        }

        await updateReport(checkpoint, file, 'navigating', '正在打开当前店铺的领星下载中心。', 'navigate');
        await guardExternalStep('navigate', report.type, attempt, createdReportIdentity);
        await page.navigate();

        if (mode === 'create-and-download' && !createdReportIdentity) {
          await updateReport(checkpoint, file, 'creating', '正在提交领星报表创建请求。', 'create');
          await guardExternalStep('create', report.type, attempt);
          let outcome: LingxingCreateReportOutcome;
          try {
            outcome = await page.create(report, { start: options.dateStart, end: options.dateEnd });
          } catch (error) {
            throw new UnknownCreateOutcomeError(
              'LINGXING_CREATE_CALL_INTERRUPTED',
              `report creation call ended without a confirmed outcome: ${errorMessage(error)}`,
            );
          }
          if (!outcome || outcome.status !== 'created') {
            throw createOutcomeError(outcome);
          }
          try {
            createdReportIdentity = normalizeCreatedIdentity(
              outcome.identity,
              report.type,
              options.dateStart,
              options.dateEnd,
            );
          } catch (error) {
            throw new UnknownCreateOutcomeError(
              'LINGXING_CREATED_IDENTITY_INVALID',
              errorMessage(error),
            );
          }
          checkpoint.createdReportIdentity = createdReportIdentity;
          readyConfirmed = false;
          await updateReport(
            checkpoint,
            file,
            'created',
            `已保存领星报表身份 ${createdReportIdentity.externalReportName}。`,
            'create',
          );
        }

        if (!readyConfirmed) {
          await updateReport(checkpoint, file, 'waiting_ready', '正在等待领星报表生成完成。', 'wait_ready');
          await guardExternalStep('wait_ready', report.type, attempt, createdReportIdentity);
          await page.waitUntilReady(
            report,
            { start: options.dateStart, end: options.dateEnd },
            createdReportIdentity,
          );
          readyConfirmed = true;
          await updateReport(checkpoint, file, 'ready', '领星报表已进入可下载状态。', 'wait_ready');
        }

        await updateReport(checkpoint, file, 'downloading', '正在下载领星报表。', 'download');
        await guardExternalStep('download', report.type, attempt, createdReportIdentity);
        const filePath = await page.download(
          report,
          { start: options.dateStart, end: options.dateEnd },
          downloadDir,
          createdReportIdentity,
        );
        file.filePath = filePath;

        await updateReport(checkpoint, file, 'verifying', '正在校验报表类型、日期、路径和文件大小。', 'verify');
        await guardExternalStep('verify', report.type, attempt, createdReportIdentity);
        const verification = verifyDownloadedFile(filePath, {
          minBytes: 128,
          expectedFilenameKeyword: report.expectedFilenameKeyword,
          expectedDateRange: { start: options.dateStart, end: options.dateEnd },
          expectedDownloadDir: downloadDir,
          expectedReportType: report.type,
        });
        file.fileSizeBytes = verification.fileSizeBytes;
        checkpoint.fileSizeBytes = verification.fileSizeBytes;
        if (!verification.valid) {
          throw new Error(verification.errorMessage || 'Downloaded file verification failed');
        }

        if (traceStarted) {
          await guardExternalStep('stop_trace', report.type, attempt, createdReportIdentity);
          await options.automation.stopAttemptTrace?.(
            report,
            { start: options.dateStart, end: options.dateEnd },
            attempt,
            false,
          );
          traceStarted = false;
        }
        file.errorMessage = undefined;
        checkpoint.errorCode = undefined;
        await updateReport(checkpoint, file, 'downloaded', '报表下载与校验完成。');
        reportCompleted = true;
        break;
      } catch (error) {
        const message = errorMessage(error);
        file.errorMessage = message;
        file.attemptErrors!.push(message);

        const guardError = error instanceof GuardBlockedError ? error : null;
        const unknownCreateError = error instanceof UnknownCreateOutcomeError ? error : null;
        const knownNotCreatedError = error instanceof KnownNotCreatedError ? error : null;
        const persistenceError = error instanceof ProgressPersistenceError ? error : null;
        const retryable = !guardError
          && !unknownCreateError
          && !persistenceError
          && (!knownNotCreatedError || knownNotCreatedError.retryable)
          && !isFinalAttempt;

        if (guardError) {
          aborted = guardError;
          checkpoint.errorCode = guardError.blockerCode;
        } else if (unknownCreateError) {
          checkpoint.errorCode = unknownCreateError.blockerCode;
          reconciliationBlocked = unknownCreateError;
        } else if (knownNotCreatedError) {
          checkpoint.errorCode = knownNotCreatedError.blockerCode;
        } else if (persistenceError) {
          checkpoint.errorCode = 'LINGXING_COLLECTION_PROGRESS_NOT_DURABLE';
        } else {
          checkpoint.errorCode = 'LINGXING_COLLECTION_STEP_FAILED';
        }

        const verifiedDownloadProgressFailed = Boolean(
          persistenceError
          && checkpoint.state === 'downloaded'
          && file.status === 'downloaded'
          && file.filePath
          && checkpoint.fileSizeBytes !== undefined,
        );
        if (verifiedDownloadProgressFailed) {
          checkpoint.detail = pathFreeDetail(
            `${pathFreeDetail(message)}；文件已校验完成，禁止自动重复下载，需由 Main 从已验证文件恢复。`,
          );
          checkpoint.updatedAt = isoNow();
          file.errorMessage = undefined;
          file.updatedAt = checkpoint.updatedAt;
          reportCompleted = true;
          break;
        }

        if (retryable) {
          const recoveryState: LingxingCollectionReportState = readyConfirmed
            ? 'ready'
            : createdReportIdentity
              ? 'created'
              : 'failed';
          try {
            await updateReport(
              checkpoint,
              file,
              recoveryState,
              `${pathFreeDetail(message)}；将从最近确定状态重试，不会重复创建已确认报表。`,
            );
          } catch (progressError) {
            checkpoint.errorCode = 'LINGXING_COLLECTION_PROGRESS_NOT_DURABLE';
            file.errorMessage = errorMessage(progressError);
            file.attemptErrors!.push(file.errorMessage);
            progressSinkFailed = true;
            break;
          }
          continue;
        }

        let terminalGuardError = guardError;
        if (traceStarted && !terminalGuardError && !persistenceError) {
          try {
            await guardExternalStep('stop_trace', report.type, attempt, createdReportIdentity);
            tracePath = await options.automation.stopAttemptTrace?.(
              report,
              { start: options.dateStart, end: options.dateEnd },
              attempt,
              true,
            );
          } catch (traceError) {
            if (traceError instanceof GuardBlockedError) {
              terminalGuardError = traceError;
            } else {
              file.traceUnavailableReason = `停止 Trace 失败：${errorMessage(traceError)}`;
            }
          }
          traceStarted = false;
        }
        if (
          !terminalGuardError
          && !persistenceError
          && options.automation.captureFailureEvidence
        ) {
          try {
            await guardExternalStep(
              'capture_failure_evidence',
              report.type,
              attempt,
              createdReportIdentity,
            );
            const evidence = await options.automation.captureFailureEvidence(
              report,
              { start: options.dateStart, end: options.dateEnd },
              file.attemptErrors!,
            );
            file.failureScreenshotPath = evidence?.screenshotPath;
            file.failureDomSnapshotPath = evidence?.domSnapshotPath;
            file.failureTracePath = tracePath ?? evidence?.tracePath;
            file.traceUnavailableReason = file.traceUnavailableReason ?? evidence?.traceUnavailableReason;
          } catch (evidenceError) {
            if (evidenceError instanceof GuardBlockedError) {
              terminalGuardError = evidenceError;
            } else {
              file.traceUnavailableReason = file.traceUnavailableReason
                ?? `采集失败证据失败：${errorMessage(evidenceError)}`;
            }
          }
        }
        if (terminalGuardError && terminalGuardError !== guardError) {
          aborted = terminalGuardError;
          file.attemptErrors!.push(terminalGuardError.message);
          if (!unknownCreateError) {
            checkpoint.errorCode = terminalGuardError.blockerCode;
            file.errorMessage = terminalGuardError.message;
          }
        }
        const terminalState: LingxingCollectionReportState = unknownCreateError
          ? 'create_unknown'
          : terminalGuardError
            ? terminalGuardError.state
            : 'failed';
        checkpoint.state = terminalState;
        checkpoint.detail = pathFreeDetail(
          unknownCreateError
            ? message
            : terminalGuardError?.message ?? message,
        );
        checkpoint.updatedAt = isoNow();
        file.status = 'failed';
        file.updatedAt = checkpoint.updatedAt;
        if (!progressSinkFailed) {
          try {
            await emitProgress(report.type);
          } catch {
            progressSinkFailed = true;
          }
        }
        break;
      }
    }

    if (!reportCompleted && file.status !== 'failed') {
      file.status = 'failed';
      checkpoint.state = 'failed';
      checkpoint.updatedAt = isoNow();
    }
    files.push(file);
    if (aborted || progressSinkFailed || reconciliationBlocked) break;
  }

  const failedCount = files.filter((file) => file.status === 'failed').length;
  const completedAt = isoNow();
  if (reconciliationBlocked) {
    job.state = 'failed';
    job.blockerCode = reconciliationBlocked.blockerCode;
    job.detail = `${pathFreeDetail(reconciliationBlocked.message)}；必须先人工核对领星下载中心，未核对前不会继续后续报表。`;
    batch.status = 'failed';
  } else if (aborted) {
    job.state = aborted.state;
    job.blockerCode = aborted.blockerCode;
    job.detail = pathFreeDetail(aborted.message);
    batch.status = 'failed';
  } else if (progressSinkFailed) {
    job.state = 'failed';
    job.blockerCode = 'LINGXING_COLLECTION_PROGRESS_NOT_DURABLE';
    job.detail = '阶段进度无法持久化，任务已停止且不会盲目重复创建。';
    batch.status = 'failed';
  } else {
    job.state = failedCount === 0
      ? 'completed'
      : failedCount === files.length
        ? 'failed'
        : 'completed_with_errors';
    batch.status = job.state === 'completed'
      ? 'completed'
      : job.state === 'completed_with_errors'
        ? 'completed_with_errors'
        : 'failed';
  }
  job.completedAt = completedAt;
  job.updatedAt = completedAt;
  batch.completedAt = completedAt;

  const manifestAllowed = !aborted && !progressSinkFailed;
  let manifestWritten = false;
  if (manifestAllowed) {
    try {
      await guardExternalStep('write_manifest');
      const manifestJob = snapshotJob(job);
      const manifestPath = writeManifest(batch, files, manifestJob);
      if (!manifestPath || !String(manifestPath).trim()) {
        throw new Error('manifest writer returned no path');
      }
      batch.manifestPath = manifestPath;
      manifestWritten = true;
    } catch (error) {
      if (error instanceof GuardBlockedError) {
        if (!reconciliationBlocked) {
          job.state = error.state;
          job.blockerCode = error.blockerCode;
          job.detail = pathFreeDetail(error.message);
        }
      } else if (!reconciliationBlocked) {
        job.state = 'failed';
        job.blockerCode = 'LINGXING_COLLECTION_MANIFEST_WRITE_FAILED';
        job.detail = pathFreeDetail(`采集 manifest 写入失败：${errorMessage(error)}`);
      }
      batch.status = 'failed';
      batch.manifestPath = undefined;
    }
  }

  // A successful manifest is the collector-side prepare record. Main owns the
  // terminal authority commit through persistResult after this function
  // returns. Calling progressSink with completed after the manifest would
  // create split-brain truth if that final sink call failed.
  if (!manifestWritten && !progressSinkFailed) {
    try {
      await emitProgress();
    } catch (error) {
      job.state = 'failed';
      job.blockerCode = 'LINGXING_COLLECTION_PROGRESS_NOT_DURABLE';
      job.detail = pathFreeDetail(errorMessage(error));
      batch.status = 'failed';
      progressSinkFailed = true;
    }
  }

  const finalJob = snapshotJob(job);
  return { batch, files, job: finalJob };
}
