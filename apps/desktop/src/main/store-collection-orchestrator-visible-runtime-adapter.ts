import {
  type StoreCollectionOrchestratorDependencies,
} from './store-collection-orchestrator';
import {
  type StoreCollectionVisibleRuntimeAdapterOptions,
  type CloseInput,
  type LeaseInput,
  type RuntimeInput,
  type VerifyInput,
} from "./collection-visible-contracts";

import { CollectionVisibleAdapterRuntime } from './collection-visible-runtime';

export {
  type CollectionOnlyBrowserController,
  type CollectionOnlyBrowserFactoryInput,
  type StoreCollectionVisibleRuntimeAdapterOptions,
  StoreCollectionVisibleRuntimeAdapterError,
} from "./collection-visible-contracts";

export class StoreCollectionOrchestratorVisibleRuntimeAdapter implements Pick<
  StoreCollectionOrchestratorDependencies,
  | 'closeVisibleRuntime'
  | 'assertCollectionLeaseReleased'
  | 'startCollectionOnlyVisibleRuntime'
  | 'verifyVisibleLingxingIdentity'
> {
  private readonly runtime: CollectionVisibleAdapterRuntime;

  constructor(options: StoreCollectionVisibleRuntimeAdapterOptions) {
    this.runtime = new CollectionVisibleAdapterRuntime(options);
  }

  closeVisibleRuntime(
    input: CloseInput,
  ): ReturnType<StoreCollectionOrchestratorDependencies['closeVisibleRuntime']> {
    return this.runtime.closeVisibleRuntime(input);
  }

  assertCollectionLeaseReleased(
    input: LeaseInput,
  ): ReturnType<StoreCollectionOrchestratorDependencies['assertCollectionLeaseReleased']> {
    return this.runtime.assertCollectionLeaseReleased(input);
  }

  startCollectionOnlyVisibleRuntime(
    input: RuntimeInput,
  ): ReturnType<StoreCollectionOrchestratorDependencies['startCollectionOnlyVisibleRuntime']> {
    return this.runtime.startCollectionOnlyVisibleRuntime(input);
  }

  verifyVisibleLingxingIdentity(
    input: VerifyInput,
  ): ReturnType<StoreCollectionOrchestratorDependencies['verifyVisibleLingxingIdentity']> {
    return this.runtime.verifyVisibleLingxingIdentity(input);
  }
}
