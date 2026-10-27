import {
  type StoreCollectionOrchestratorSchedulerProjection,
} from './store-collection-orchestrator';
import {
  type SchedulerPort,
  type StoreCollectionOrchestratorSchedulerAdapterOptions,
  type SchedulerExecuteInput,
  type SchedulerRecoverInput,
} from "./collection-scheduler-contracts";

import { CollectionSchedulerAdapterRuntime } from './collection-scheduler-runtime';

export {
  type StoreCollectionOrchestratorSchedulerAdapterOptions,
  type StoreCollectionDurableProofScope,
  type StoreCollectionDurableProofClassification,
  type StoreCollectionCommittedImportRecoveryExpectation,
  type StoreCollectionCommittedImportRecoveryReceipt,
  StoreCollectionDurableProofUnknownError,
} from "./collection-scheduler-contracts";
export {
  classifyStoreCollectionDurableProof,
  assertStoreCollectionCommittedImportProofForRecovery,
} from "./collection-scheduler-durable-proof";

export class StoreCollectionOrchestratorSchedulerAdapter implements SchedulerPort {
  private readonly runtime: CollectionSchedulerAdapterRuntime;

  constructor(options: StoreCollectionOrchestratorSchedulerAdapterOptions) {
    this.runtime = new CollectionSchedulerAdapterRuntime(options);
  }

  execute(
    input: SchedulerExecuteInput,
  ): Promise<StoreCollectionOrchestratorSchedulerProjection<'transition_execution'>> {
    return this.runtime.execute(input);
  }

  recover(
    input: SchedulerRecoverInput,
  ): Promise<StoreCollectionOrchestratorSchedulerProjection<'recovery_existing_request_only'>> {
    return this.runtime.recover(input);
  }
}
