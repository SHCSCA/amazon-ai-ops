import {
  type LingxingCollectionJobSnapshot,
  type StoreContextEnvelope,
  type StoreId,
  type StoreRuntimeConfigProjection,
} from '@amazon-ai-ops/shared-types';
import {
  type CollectionImportRecoveryCasToken,
  type LingxingImportRepository,
  type ReportImportRunRecord,
} from '@amazon-ai-ops/local-db';
import type {
  LingxingCollectionCoordinator,
} from './lingxing-collection-coordinator';
import {
  type StoreCollectionAuthorityReadback,
  type StoreCollectionOrchestratorDependencies,
  type StoreCollectionTransitionCapabilityDomain,
  type StoreCollectionTransitionCapabilityScope,
} from './store-collection-orchestrator';
import type {
  StoreCollectionOrchestratorDomainAdapter,
} from './store-collection-orchestrator-domain-adapter';

export type SchedulerPort = StoreCollectionOrchestratorDependencies['scheduler'];

export type SchedulerExecuteInput = Parameters<SchedulerPort['execute']>[0];

export type SchedulerRecoverInput = Parameters<SchedulerPort['recover']>[0];

export interface StoreCollectionOrchestratorSchedulerAdapterOptions {
  domain: Pick<StoreCollectionOrchestratorDomainAdapter, 'claimSchedulerTransitionAuthority'>;
  config: {
    getForStoreId(storeId: StoreId): StoreRuntimeConfigProjection;
  };
  coordinator: Pick<LingxingCollectionCoordinator, 'start'>;
  repository: Pick<
    LingxingImportRepository,
    | 'readUniqueCollectionAuthorityProofForStoreByRequestId'
    | 'inspectUniqueCollectionJobForSemanticScope'
  >;
}

export interface StoreCollectionDurableProofScope {
  context: StoreContextEnvelope;
  requestId: string;
  dateStart: string;
  dateEnd: string;
}

export type StoreCollectionDurableProofClassification =
  | 'claimed'
  | 'succeeded'
  | 'failed';

export interface StoreCollectionCommittedImportRecoveryExpectation
  extends StoreCollectionDurableProofScope {
  expectedJob: LingxingCollectionJobSnapshot;
  expectedRun: ReportImportRunRecord;
}

export interface StoreCollectionCommittedImportRecoveryReceipt {
  storeId: StoreId;
  jobId: string;
  requestId: string;
  browserProfileId: string;
  businessDate: string;
  sessionGeneration: number;
  dateStart: string;
  dateEnd: string;
  jobUpdatedAt: string;
  runId: string;
  runCompletedAt: string;
  authorityProofSha256: string;
  run: ReportImportRunRecord;
  casToken?: CollectionImportRecoveryCasToken;
}

export class StoreCollectionDurableProofUnknownError extends Error {
  readonly code = 'SAFETY_STATE_UNKNOWN' as const;

  constructor(detail: string) {
    super(`durable collection proof UNKNOWN: ${detail}`);
    this.name = 'StoreCollectionDurableProofUnknownError';
  }
}

export interface AuthorizedSchedulerRequest<
  Domain extends StoreCollectionTransitionCapabilityDomain,
> {
  input: Domain extends 'transition_execution' ? SchedulerExecuteInput : SchedulerRecoverInput;
  context: StoreContextEnvelope;
  expectedAuthority: StoreCollectionAuthorityReadback;
  scope: StoreCollectionTransitionCapabilityScope<Domain>;
  executionScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>;
  dateStart: string;
  dateEnd: string;
}

export type AuthorizedSchedulerAuthority<
  Domain extends StoreCollectionTransitionCapabilityDomain,
> = Omit<AuthorizedSchedulerRequest<Domain>, 'dateStart' | 'dateEnd'>;

export type DurableLifecycleShape =
  | 'queued'
  | 'running'
  | 'completed_pending'
  | 'completed_failed'
  | 'completed_succeeded'
  | 'terminal_not_applicable'
  | 'restart_cancelled_before_batch';
