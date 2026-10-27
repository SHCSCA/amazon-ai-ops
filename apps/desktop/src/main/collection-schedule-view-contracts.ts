import type {
  StoreCollectionScheduleProjection,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type LingxingCollectionAuthorityProof,
  type LingxingImportRepository,
} from '@amazon-ai-ops/local-db';
import type {
  StoreCollectionExistingResumeRequest,
} from './store-collection-main-runtime';
import type {
  StoreCoordinator,
} from './store-coordinator';
import type {
  StoreCollectionOrchestrator,
  StoreCollectionProtectedSemanticAttemptReadback,
} from './store-collection-orchestrator';
import type {
  StoreRuntimeConfigService,
} from './store-runtime-config-service';
import type { StoreCollectionAutomationService } from './store-collection-automation-service';

export interface StoreCollectionSchedulerReadModelOptions {
  authority: Pick<StoreCoordinator, 'assertActiveStoreContext' | 'getActiveStoreContext'>;
  runtimeConfig: Pick<StoreRuntimeConfigService, 'get'>;
  automationControl: Pick<StoreCollectionAutomationService, 'get'>;
  importRepository: Pick<
    LingxingImportRepository,
    | 'inspectUniqueCollectionJobForSemanticScope'
    | 'getCollectionJobForStore'
    | 'readUniqueCollectionAuthorityProofForStoreByRequestId'
    | 'getCollectionInPlaceResumeStateForStore'
    | 'readLatestCollectionResumeAttemptReceiptForStore'
    | 'readUniqueSucceededCollectionResumeReceiptForStore'
  >;
  orchestrator: Pick<StoreCollectionOrchestrator, 'readProtectedSemanticAttempt'>;
  // 必须使用统一 Main 入口，在到达编排器前拒绝 Package UI 写入。
  manualRun(context: StoreContextEnvelope): Promise<unknown>;
  // 仅供用户显式续跑，定时器与启动恢复不得获取此端口。
  resumeExisting(input: StoreCollectionExistingResumeRequest): Promise<unknown>;
  now?: () => Date;
}

export interface AuthorizedReadback {
  context: StoreContextEnvelope;
  projection: StoreCollectionScheduleProjection;
  durable?: LingxingCollectionAuthorityProof;
  protectedAttempt?: Readonly<StoreCollectionProtectedSemanticAttemptReadback>;
}

export interface ManualCycleOutcomeReadback {
  storeId: string;
  browserProfileId: string;
  businessDate: string;
  fingerprint: string;
  requestId?: string;
  state: 'succeeded' | 'blocked' | 'failed';
  failureCode?: string;
}

export type ManualCycleReadback =
  | { disposition: 'skipped' }
  | { disposition: 'attempted'; outcome: ManualCycleOutcomeReadback };

export interface SelectedDurableReadback {
  state: 'claimed' | 'succeeded' | 'failed';
  storeId: string;
  browserProfileId: string;
  businessDate: string;
  jobId: string;
  requestId: string;
  dateStart: string;
  dateEnd: string;
  fingerprint: string;
}
