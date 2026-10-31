import {
  type DownloadCenterAutomationPort,
  type RunBatchOptions,
  type RunBatchResult,
} from '@amazon-ai-ops/lingxing-report-collector';
import type {
  AcquireCollectionResumeClaimInput,
  AdvanceCollectionResumeClaimAfterImportInput,
  CollectionInPlaceResumeState,
  CollectionResumeAttemptReceipt,
  CollectionResumeClaim,
  CommitCollectionResumeProgressInput,
  CommitCollectionResumeRunnerResultInput,
  CommitCollectionResumeRunnerResultOutput,
  FinalizeCollectionResumeAttemptInput,
  InterruptCollectionResumeClaimInput,
} from '@amazon-ai-ops/local-db';
import type {
  LingxingCollectionJobSnapshot,
  LingxingCollectionLineage,
  LingxingCollectionProgressEvent,
  LingxingCollectionRequestDto,
  LingxingCollectionResumeState,
  LingxingReportType,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type {
  CollectionOperationGuard,
  StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';

export type ResumeAdmissionStage = 'RUNTIME_AUTHORITY' | 'PREFLIGHT' | 'CLAIM';

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
  persistImportState(job: LingxingCollectionJobSnapshot, expectedJob: LingxingCollectionJobSnapshot): void | Promise<void>;
  acquireCollectionResumeClaimForStore?(
    storeId: StoreContextEnvelope['storeId'],
    input: AcquireCollectionResumeClaimInput,
  ): CollectionResumeClaim | Promise<CollectionResumeClaim>;
  commitCollectionResumeProgressForStore?(
    storeId: StoreContextEnvelope['storeId'],
    input: CommitCollectionResumeProgressInput,
  ): CollectionResumeClaim | Promise<CollectionResumeClaim>;
  commitCollectionResumeRunnerResultForStore?(
    storeId: StoreContextEnvelope['storeId'],
    input: CommitCollectionResumeRunnerResultInput,
  ): CommitCollectionResumeRunnerResultOutput | Promise<CommitCollectionResumeRunnerResultOutput>;
  advanceCollectionResumeClaimAfterImportForStore?(
    storeId: StoreContextEnvelope['storeId'],
    input: AdvanceCollectionResumeClaimAfterImportInput,
  ): CollectionResumeClaim | Promise<CollectionResumeClaim>;
  finalizeCollectionResumeAttemptForStore?(
    storeId: StoreContextEnvelope['storeId'],
    input: FinalizeCollectionResumeAttemptInput,
  ): CollectionResumeAttemptReceipt | Promise<CollectionResumeAttemptReceipt>;
  interruptCollectionResumeClaimForStore?(
    storeId: StoreContextEnvelope['storeId'],
    input: InterruptCollectionResumeClaimInput,
  ): CollectionResumeAttemptReceipt | Promise<CollectionResumeAttemptReceipt>;
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
  reportContentInspector?: RunBatchOptions['reportContentInspector'];
  clearCancellation?(input: { jobId?: string; requestId: string; storeId: string }): void;
  persistence: LingxingCollectionPersistence;
  importResult?(
    result: RunBatchResult,
    options: { startedAt: string; assertBeforeCommit?: () => void; expectedClaim?: CollectionResumeClaim },
  ): unknown | Promise<unknown>;
  productionImport?: {
    policy: 'exact-eight-lineage-v1';
    run(
      result: RunBatchResult,
      options: { startedAt: string; assertBeforeCommit?: () => void; expectedClaim?: CollectionResumeClaim },
    ): unknown | Promise<unknown>;
  };
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

export interface ResumeLingxingCollectionInput {
  currentStoreContext: StoreContextEnvelope;
  resumeFrom: CollectionInPlaceResumeState;
  maxRetries?: number;
  appVersion?: string;
  canary?: false;
  deferReconciledCreateFailures?: boolean;
}

export type RequiredResumePersistence = Required<Pick<
  LingxingCollectionPersistence,
  | 'acquireCollectionResumeClaimForStore'
  | 'commitCollectionResumeProgressForStore'
  | 'commitCollectionResumeRunnerResultForStore'
  | 'advanceCollectionResumeClaimAfterImportForStore'
  | 'finalizeCollectionResumeAttemptForStore'
  | 'interruptCollectionResumeClaimForStore'
>>;
