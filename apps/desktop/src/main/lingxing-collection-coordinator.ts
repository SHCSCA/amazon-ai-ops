import {
  type LingxingCollectionCoordinatorDependencies,
  type StartLingxingCollectionInput,
  type LingxingCollectionCoordinatorResult,
  type ResumeLingxingCollectionInput,
} from "./collection-coordinator-contracts";

import { CollectionCoordinatorRuntime } from './collection-coordinator-runtime';

export {
  type LingxingCollectionAuthority,
  type LingxingCollectionRuntime,
  type LingxingCollectionPersistence,
  type LingxingCollectionCoordinatorDependencies,
  type StartLingxingCollectionInput,
  type LingxingCollectionCoordinatorResult,
  type ResumeLingxingCollectionInput,
} from "./collection-coordinator-contracts";
export {
  normalizeCollectionRequest,
} from "./collection-coordinator-request-values";

export class LingxingCollectionCoordinator {
  private readonly runtime: CollectionCoordinatorRuntime;

  constructor(dependencies: LingxingCollectionCoordinatorDependencies) {
    this.runtime = new CollectionCoordinatorRuntime(dependencies);
  }

  start(input: StartLingxingCollectionInput): Promise<LingxingCollectionCoordinatorResult> {
    return this.runtime.start(input);
  }

  resumeInPlace(
    input: ResumeLingxingCollectionInput,
  ): Promise<LingxingCollectionCoordinatorResult> {
    return this.runtime.resumeInPlace(input);
  }
}
