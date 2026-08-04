import type { StoreContextEnvelope } from './store';
import type { LingxingReportType } from './v1_5';

export const LINGXING_COLLECTION_MODES = [
  'create-and-download',
  'download-existing',
] as const;

export type LingxingCollectionMode = (typeof LINGXING_COLLECTION_MODES)[number];

export const LINGXING_COLLECTION_REPORT_STATES = [
  'queued',
  'navigating',
  'creating',
  'created',
  'waiting_ready',
  'ready',
  'downloading',
  'verifying',
  'downloaded',
  'failed',
  'create_unknown',
  'cancelled',
  'stale_authority',
] as const;

export type LingxingCollectionReportState =
  (typeof LINGXING_COLLECTION_REPORT_STATES)[number];

export const LINGXING_COLLECTION_JOB_STATES = [
  'queued',
  'running',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'stale_authority',
] as const;

export type LingxingCollectionJobState =
  (typeof LINGXING_COLLECTION_JOB_STATES)[number];

export const LINGXING_COLLECTION_IMPORT_STATES = [
  'pending',
  'succeeded',
  'failed',
  'not_applicable',
] as const;

export type LingxingCollectionImportState =
  (typeof LINGXING_COLLECTION_IMPORT_STATES)[number];

export const LINGXING_COLLECTION_EXTERNAL_STEPS = [
  'start_trace',
  'navigate',
  'create',
  'wait_ready',
  'download',
  'verify',
  'stop_trace',
  'capture_failure_evidence',
  'write_manifest',
] as const;

export type LingxingCollectionExternalStep =
  (typeof LINGXING_COLLECTION_EXTERNAL_STEPS)[number];

/**
 * Renderer-safe request identity. Main must verify the complete StoreContext
 * against StoreCoordinator before constructing a collector RunBatchOptions.
 */
export interface LingxingCollectionRequestDto {
  requestId: string;
  storeContext: StoreContextEnvelope;
  dateStart: string;
  dateEnd: string;
  mode: LingxingCollectionMode;
  reportTypes: readonly LingxingReportType[];
}

/**
 * Stable identity returned only after the provider has positively confirmed
 * report creation. It is safe to persist and use for deterministic resume.
 */
export interface LingxingCreatedReportIdentity {
  provider: 'lingxing';
  reportType: LingxingReportType;
  externalReportName: string;
  externalReportId?: string;
  dateStart: string;
  dateEnd: string;
  createdAt: string;
}

export type LingxingCreateReportOutcome =
  | {
      status: 'created';
      identity: LingxingCreatedReportIdentity;
    }
  | {
      status: 'not_created';
      retryable: boolean;
      detail: string;
      blockerCode?: string;
    }
  | {
      status: 'unknown';
      detail: string;
      blockerCode?: string;
    };

export interface LingxingCollectionReportCheckpoint {
  reportType: LingxingReportType;
  state: LingxingCollectionReportState;
  attemptIndex: number;
  autoRetryCount: number;
  createdReportIdentity?: LingxingCreatedReportIdentity;
  fileSizeBytes?: number;
  errorCode?: string;
  detail?: string;
  updatedAt: string;
}

/**
 * Durable, path-free job snapshot. Absolute paths, cookies and lease tokens are
 * intentionally excluded so this object may be projected outside Main.
 */
export interface LingxingCollectionJobSnapshot {
  jobId: string;
  request: LingxingCollectionRequestDto;
  lineage?: LingxingCollectionLineage;
  state: LingxingCollectionJobState;
  reports: readonly LingxingCollectionReportCheckpoint[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  blockerCode?: string;
  detail?: string;
  /** Durable post-download import lifecycle; absent only on legacy snapshots. */
  importState?: LingxingCollectionImportState;
  importAttemptedAt?: string;
  importCompletedAt?: string;
  importError?: string;
}

export interface LingxingCollectionProgressEvent {
  eventId: string;
  emittedAt: string;
  changedReportType?: LingxingReportType;
  externalStep?: LingxingCollectionExternalStep;
  job: LingxingCollectionJobSnapshot;
}

/**
 * Main-issued chain that binds a partial resume to one original full eight-
 * report collection. Standalone retries intentionally have no lineage and
 * therefore cannot be combined into a production-ready 8/8 claim.
 */
export interface LingxingCollectionLineage {
  lineageId: string;
  rootJobId: string;
  parentJobId?: string;
  expectedReportTypes: readonly LingxingReportType[];
  purpose: 'production_full' | 'resume' | 'retry';
}

/** A previously persisted checkpoint accepted by the collector for resume. */
export interface LingxingCollectionResumeState {
  jobId: string;
  request: LingxingCollectionRequestDto;
  reports: readonly LingxingCollectionReportCheckpoint[];
}

export interface LingxingCollectionGuardContext {
  jobId: string;
  requestId: string;
  storeContext: StoreContextEnvelope;
  reportType?: LingxingReportType;
  attemptIndex: number;
  step: LingxingCollectionExternalStep;
  createdReportIdentity?: LingxingCreatedReportIdentity;
}

export type LingxingCollectionGuardDecision =
  | { allowed: true }
  | {
      allowed: false;
      blockerCode: string;
      detail: string;
    };
