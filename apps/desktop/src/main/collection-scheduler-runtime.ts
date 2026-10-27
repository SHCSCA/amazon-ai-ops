import {
  type StoreCollectionOrchestratorSchedulerAdapterOptions,
} from "./collection-scheduler-contracts";
import {
  execute,
} from "./collection-scheduler-execute";
import {
  recover,
} from "./collection-scheduler-recovery";
import {
  authorizeStructure,
  assertExecutionIdentity,
} from "./collection-scheduler-authority";

export class CollectionSchedulerAdapterRuntime {
  
  execute = execute;
  recover = recover;
  authorizeStructure = authorizeStructure;
  assertExecutionIdentity = assertExecutionIdentity;

  constructor(readonly options: StoreCollectionOrchestratorSchedulerAdapterOptions) {}
}
