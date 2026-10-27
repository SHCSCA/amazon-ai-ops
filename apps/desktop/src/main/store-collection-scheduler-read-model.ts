import type {
  StoreCollectionScheduleProjection,
  StoreCollectionScheduleRunResult,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type {
  StoreCollectionSchedulerIpcPort,
} from './store-collection-scheduler-ipc';
import {
  type StoreCollectionSchedulerReadModelOptions,
} from "./collection-schedule-view-contracts";

import { CollectionScheduleViewRuntime } from './collection-schedule-view-runtime';

export {
  type StoreCollectionSchedulerReadModelOptions,
} from "./collection-schedule-view-contracts";

export class StoreCollectionSchedulerReadModel implements StoreCollectionSchedulerIpcPort {
  private readonly runtime: CollectionScheduleViewRuntime;

  constructor(options: StoreCollectionSchedulerReadModelOptions) {
    this.runtime = new CollectionScheduleViewRuntime(options);
  }

  get(contextInput: StoreContextEnvelope): StoreCollectionScheduleProjection {
    return this.runtime.get(contextInput);
  }

  runNow(contextInput: StoreContextEnvelope): Promise<StoreCollectionScheduleRunResult> {
    return this.runtime.runNow(contextInput);
  }

  resumeJob(
    contextInput: StoreContextEnvelope,
    jobIdInput: string,
    options: { deferReconciledCreateFailures?: boolean } = {},
  ): Promise<StoreCollectionScheduleRunResult> {
    return this.runtime.resumeJob(contextInput, jobIdInput, options);
  }
}
