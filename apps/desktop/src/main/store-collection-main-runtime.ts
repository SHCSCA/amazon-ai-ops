import {
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type PolicyDispatchSuppressionReadPort,
} from './store-collection-policy-suppression';
import {
  type StoreCollectionMainRuntimeOptions,
  type StoreCollectionMainCycleResult,
  type StoreCollectionExistingResumeRequest,
  type StoreCollectionCancellationRequest,
  type StoreCollectionCancellationResult,
  type StoreCollectionUserMutationScope,
  type StoreCollectionMainRuntimeStatus,
} from "./collection-main-contracts";

import { CollectionMainRuntimeContext } from './collection-main-runtime';

export {
  type StoreCollectionMainCycleResult,
  type StoreCollectionManualCycleAdmission,
  type StoreCollectionManualCyclePreMutationReason,
  type StoreCollectionManualCyclePreMutationRejection,
  type StoreCollectionManualCycleResult,
  type StoreCollectionExistingResumeRequest,
  type StoreCollectionMainOrchestratorPort,
  type StoreCollectionMainRuntimeOwnedPorts,
  type StoreCollectionMainRuntimeLifecycle,
  type StoreCollectionMainRuntimeStatus,
  type StoreCollectionMainRuntimeErrorCode,
  StoreCollectionMainRuntimeError,
  type StoreCollectionMainRuntimeOptions,
  type StoreCollectionUserMutationScope,
  type StoreCollectionCancellationPath,
  type StoreCollectionCancellationCallbackInput,
  type StoreCollectionCancellationSettlement,
  type StoreCollectionCancellationRequest,
  type StoreCollectionCancellationResult,
} from "./collection-main-contracts";

export class StoreCollectionMainRuntime implements PolicyDispatchSuppressionReadPort {
  private readonly runtime: CollectionMainRuntimeContext;

  constructor(options: StoreCollectionMainRuntimeOptions) {
    this.runtime = new CollectionMainRuntimeContext(options);
  }

  recoverStartupThenConfirm(): Promise<void> {
    return this.runtime.recoverStartupThenConfirm();
  }

  runNow(
    contextInput: StoreContextEnvelope,
  ): Promise<StoreCollectionMainCycleResult> {
    return this.runtime.runNow(contextInput);
  }

  resumeExisting(
    input: StoreCollectionExistingResumeRequest,
  ): Promise<StoreCollectionMainCycleResult> {
    return this.runtime.resumeExisting(input);
  }

  cancelCollection(
    input: StoreCollectionCancellationRequest,
  ): Promise<StoreCollectionCancellationResult> {
    return this.runtime.cancelCollection(input);
  }

  start(): void {
    return this.runtime.start();
  }

  assertUserOperationAllowed(): void {
    return this.runtime.assertUserOperationAllowed();
  }

  withUserStoreMutation<Result>(
    scopeInput: StoreCollectionUserMutationScope,
    work: () => Promise<Result> | Result,
  ): Promise<Result> {
    return this.runtime.withUserStoreMutation(scopeInput, work);
  }

  withPackageUiSetupMutation<Result>(
    scopeInput: StoreCollectionUserMutationScope,
    work: () => Promise<Result> | Result,
  ): Promise<Result> {
    return this.runtime.withPackageUiSetupMutation(scopeInput, work);
  }

  stopAndDrain(timeoutMs = 5_000): Promise<void> {
    return this.runtime.stopAndDrain(timeoutMs);
  }

  closeRegistry(timeoutMs = 5_000): Promise<void> {
    return this.runtime.closeRegistry(timeoutMs);
  }

  isPolicyDispatchSuppressed(): boolean {
    return this.runtime.isPolicyDispatchSuppressed();
  }

  readStatus(): StoreCollectionMainRuntimeStatus {
    return this.runtime.readStatus();
  }
}
