import {
  type RunBatchResult,
} from '@amazon-ai-ops/lingxing-report-collector';
import type {
  LingxingCollectionLineage,
  LingxingCollectionRequestDto,
} from '@amazon-ai-ops/shared-types';
import {
  REPORT_TYPES,
} from "./collection-coordinator-constants";
import {
  type LingxingCollectionCoordinatorDependencies,
} from "./collection-coordinator-contracts";
import {
  isExactFullCollectionRequest,
} from "./collection-coordinator-lineage-values";
import type { CollectionCoordinatorRuntime } from './collection-coordinator-runtime';

export function isProductionImportAuthorized(this: CollectionCoordinatorRuntime,
  request: LingxingCollectionRequestDto,
  continuationLineage?: LingxingCollectionLineage): boolean {
    if (this.dependencies.importResult) {
      this.assertLegacyImportRunnerIsInjected(request.mode);
      return true;
    }
    if (isExactFullCollectionRequest(request)) return true;
    // 仅接受 Main 颁发且已核验的采集谱系，执行器自带谱系不构成权限。
    return continuationLineage !== undefined;
  }

export function resolveImportResultHandler(this: CollectionCoordinatorRuntime,
  request: LingxingCollectionRequestDto): LingxingCollectionCoordinatorDependencies['importResult'] {
    if (this.dependencies.productionImport) return this.dependencies.productionImport.run;
    if (!this.dependencies.importResult) return undefined;
    this.assertLegacyImportRunnerIsInjected(request.mode);
    return this.dependencies.importResult;
  }

export function isProductionResultComplete(this: CollectionCoordinatorRuntime,
  request: LingxingCollectionRequestDto,
  result: RunBatchResult): boolean {
    if (!this.dependencies.productionImport) return true;
    return isExactFullCollectionRequest(request)
      && result.job.state === 'completed'
      && result.job.reports.length === REPORT_TYPES.size
      && result.job.reports.every((checkpoint) => checkpoint.state === 'downloaded')
      && result.files.length === REPORT_TYPES.size
      && result.files.every((file) => file.status === 'downloaded');
  }

export function assertLegacyImportRunnerIsInjected(this: CollectionCoordinatorRuntime,
  mode: LingxingCollectionRequestDto['mode']): void {
    const injected = mode === 'download-existing'
      ? this.dependencies.runExistingBatch !== undefined
      : this.dependencies.runCreateBatch !== undefined;
    if (!injected) throw new Error('LINGXING_COLLECTION_LEGACY_IMPORT_PORT_FORBIDDEN');
  }
