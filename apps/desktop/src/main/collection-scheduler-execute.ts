import {
  type StoreCollectionOrchestratorSchedulerProjection,
} from './store-collection-orchestrator';
import {
  deriveStoreCollectionWindow,
  storeCollectionScheduleSemanticFingerprint,
} from './store-collection-scheduler';
import {
  FULL_REPORT_TYPES,
} from "./collection-scheduler-constants";
import {
  type SchedulerExecuteInput,
  type AuthorizedSchedulerRequest,
} from "./collection-scheduler-contracts";
import {
  exactJobIdentityProblem,
  sameCoordinatorAndDurableJob,
  projection,
} from "./collection-scheduler-job-identity";
import {
  isTerminalJobState,
} from "./collection-scheduler-values";

import type { CollectionSchedulerAdapterRuntime } from './collection-scheduler-runtime';

export async function execute(this: CollectionSchedulerAdapterRuntime,
  input: SchedulerExecuteInput): Promise<StoreCollectionOrchestratorSchedulerProjection<'transition_execution'>> {
    const base = this.authorizeStructure(input, 'transition_execution');
    const configProjection = this.options.config.getForStoreId(base.context.storeId);
    const config = configProjection?.current;
    if (!config || config.status !== 'active') {
      throw new Error('scheduler 要求当前店铺存在 active runtime config。');
    }
    if (config.storeId !== base.context.storeId
      || config.marketplace !== 'US'
      || config.currency !== 'USD'
      || config.businessTimezone !== 'America/Los_Angeles') {
      throw new Error('scheduler runtime config 发生 Store/marketplace/currency/timezone 身份漂移。');
    }
    const window = deriveStoreCollectionWindow(
      base.context.businessDate,
      config.values.collectionLookbackDays,
    );
    const fingerprint = storeCollectionScheduleSemanticFingerprint({
      storeId: base.context.storeId,
      browserProfileId: base.context.browserProfileId,
      businessDate: base.context.businessDate,
      lookbackDays: config.values.collectionLookbackDays,
      ...window,
    });
    if (fingerprint !== input.expectedFingerprint) {
      throw new Error('scheduler runtime config/date window fingerprint 已漂移。');
    }
    this.assertExecutionIdentity(input, base.scope, base.context);
    const claim = this.options.domain.claimSchedulerTransitionAuthority(input, {
      capabilityDomain: 'transition_execution',
      context: base.context,
      expectedAuthority: base.expectedAuthority,
      attemptId: input.attemptId,
      requestId: input.requestId,
    });
    if (claim.executionScope !== base.scope || claim.transitionScope !== base.scope) {
      throw new Error('scheduler execution claim 未绑定 exact transition scope。');
    }
    const authorized: AuthorizedSchedulerRequest<'transition_execution'> = {
      ...base,
      executionScope: claim.executionScope,
      ...window,
    };
    const preexisting = this.options.repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      authorized.context.storeId,
      input.requestId,
    );
    if (preexisting) {
      throw new Error('scheduler execute 拒绝复用既有 durable Store/Request 任务。');
    }
    const semanticPreexisting = this.options.repository.inspectUniqueCollectionJobForSemanticScope({
      storeId: authorized.context.storeId,
      browserProfileId: authorized.context.browserProfileId,
      businessDate: authorized.context.businessDate,
      dateStart: authorized.dateStart,
      dateEnd: authorized.dateEnd,
      mode: 'create-and-download',
      reportTypes: FULL_REPORT_TYPES,
    });
    if (semanticPreexisting) {
      throw new Error('scheduler execute 拒绝重复执行既有 durable semantic collection scope。');
    }

    const output = await this.options.coordinator.start({
      requestId: input.requestId,
      storeContext: authorized.context,
      dateStart: authorized.dateStart,
      dateEnd: authorized.dateEnd,
      mode: 'create-and-download',
      reportTypes: FULL_REPORT_TYPES,
      canary: false,
    });
    if (!isTerminalJobState(output?.result?.job?.state)) {
      throw new Error('Lingxing coordinator 未返回 durable terminal job。');
    }

    const durable = this.options.repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      authorized.context.storeId,
      input.requestId,
    );
    if (!durable) {
      throw new Error('Lingxing coordinator 返回后 exact durable Store/Request job 不存在。');
    }
    const identityProblem = exactJobIdentityProblem(durable.job, {
      context: authorized.context,
      requestId: input.requestId,
      dateStart: authorized.dateStart,
      dateEnd: authorized.dateEnd,
    });
    if (identityProblem) {
      throw new Error(`durable Lingxing job identity mismatch: ${identityProblem}`);
    }
    if (!sameCoordinatorAndDurableJob(output.result.job, durable.job)) {
      throw new Error('Lingxing coordinator result 与 durable authority DB job 不一致。');
    }

    return projection(input, authorized.expectedAuthority, 'accepted');
  }
