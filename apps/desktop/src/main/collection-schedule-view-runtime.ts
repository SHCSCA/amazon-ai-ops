import {
  type StoreCollectionSchedulerReadModelOptions,
} from "./collection-schedule-view-contracts";
import {
  get,
  readAuthorized,
} from "./collection-schedule-view-projection";
import {
  runNow,
} from "./collection-schedule-view-manual-run";
import {
  resumeJob,
} from "./collection-schedule-view-resume-job";

export class CollectionScheduleViewRuntime {
  readonly now: () => Date;
  get = get;
  readAuthorized = readAuthorized;
  runNow = runNow;
  resumeJob = resumeJob;

  constructor(readonly options: StoreCollectionSchedulerReadModelOptions) {
    this.now = options.now ?? (() => new Date());
  }
}
