import {
  downloadExistingLingxingReportBatch,
  runLingxingReportBatch,
  type RunBatchOptions,
  type RunBatchResult,
} from '@amazon-ai-ops/lingxing-report-collector';
import {
  type LingxingCollectionCoordinatorDependencies,
} from "./collection-coordinator-contracts";
import {
  start,
} from "./collection-coordinator-start-job";
import {
  resumeInPlace,
} from "./collection-coordinator-resume-job";
import {
  isProductionImportAuthorized,
  resolveImportResultHandler,
  isProductionResultComplete,
  assertLegacyImportRunnerIsInjected,
} from "./collection-coordinator-production-import";
import {
  publishResumeProgress,
  resolveAuthorizedRuntime,
  captureAuthority,
  buildProgressSink,
  buildAuthorityGuard,
  publishTerminalProgress,
} from "./collection-coordinator-authority-progress";
import {
  buildCancellationGuard,
  cancelResultIfRequested,
  isCancellationRequested,
  assertNotCancelled,
} from "./collection-coordinator-cancellation";

export class CollectionCoordinatorRuntime {
  readonly runCreateBatch: (options: RunBatchOptions) => Promise<RunBatchResult>;
  readonly runExistingBatch: (options: RunBatchOptions) => Promise<RunBatchResult>;
  start = start;
  resumeInPlace = resumeInPlace;
  isProductionImportAuthorized = isProductionImportAuthorized;
  resolveImportResultHandler = resolveImportResultHandler;
  isProductionResultComplete = isProductionResultComplete;
  assertLegacyImportRunnerIsInjected = assertLegacyImportRunnerIsInjected;
  publishResumeProgress = publishResumeProgress;
  resolveAuthorizedRuntime = resolveAuthorizedRuntime;
  captureAuthority = captureAuthority;
  buildProgressSink = buildProgressSink;
  buildAuthorityGuard = buildAuthorityGuard;
  publishTerminalProgress = publishTerminalProgress;
  buildCancellationGuard = buildCancellationGuard;
  cancelResultIfRequested = cancelResultIfRequested;
  isCancellationRequested = isCancellationRequested;
  assertNotCancelled = assertNotCancelled;

  constructor(readonly dependencies: LingxingCollectionCoordinatorDependencies) {
    if (dependencies.productionImport && dependencies.importResult) {
      throw new Error('LINGXING_COLLECTION_IMPORT_PORT_CONFLICT');
    }
    if (dependencies.importResult
      && dependencies.runCreateBatch === undefined
      && dependencies.runExistingBatch === undefined) {
      throw new Error('LINGXING_COLLECTION_LEGACY_IMPORT_PORT_FORBIDDEN');
    }
    this.runCreateBatch = dependencies.runCreateBatch ?? runLingxingReportBatch;
    this.runExistingBatch = dependencies.runExistingBatch ?? downloadExistingLingxingReportBatch;
  }
}
