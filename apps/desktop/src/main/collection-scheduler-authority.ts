import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  deriveStoreCollectionSchedulerExecutionIdentity,
  type StoreCollectionTransitionCapabilityDomain,
  type StoreCollectionTransitionCapabilityScope,
} from './store-collection-orchestrator';
import {
  SAFE_ID,
  FINGERPRINT,
  EXECUTION_ATTEMPT_ID,
  EXECUTION_REQUEST_ID,
} from "./collection-scheduler-constants";
import {
  type SchedulerExecuteInput,
  type SchedulerRecoverInput,
  type AuthorizedSchedulerAuthority,
  type AuthorizedSchedulerRequest,
} from "./collection-scheduler-contracts";
import {
  assertUsStoreContext,
  cloneExactAuthority,
  sameContext,
} from "./collection-scheduler-values";
import type { CollectionSchedulerAdapterRuntime } from './collection-scheduler-runtime';

export function authorizeStructure<Domain extends StoreCollectionTransitionCapabilityDomain>(this: CollectionSchedulerAdapterRuntime,
  input: Domain extends 'transition_execution' ? SchedulerExecuteInput : SchedulerRecoverInput,
  capabilityDomain: Domain): AuthorizedSchedulerAuthority<Domain> {
    if (!input
      || !SAFE_ID.test(input.cycleId)
      || !SAFE_ID.test(input.transitionId)
      || !FINGERPRINT.test(input.expectedFingerprint)
      || !EXECUTION_ATTEMPT_ID.test(input.attemptId)
      || !EXECUTION_REQUEST_ID.test(input.requestId)) {
      throw new Error('scheduler request 缺少安全 cycle/transition/fingerprint/attempt/request identity。');
    }
    const context = normalizeStoreContextEnvelope(input.context);
    assertUsStoreContext(context);
    const scope = input.transitionScope;
    if (!scope
      || scope.capabilityDomain !== capabilityDomain
      || scope.cycleId !== input.cycleId
      || scope.transitionId !== input.transitionId
      || scope.purpose !== 'collection'
      || scope.expectedFingerprint !== input.expectedFingerprint
      || !scope.target
      || scope.target.storeId !== context.storeId
      || scope.target.browserProfileId !== context.browserProfileId
      || scope.target.marketplace !== context.marketplace
      || scope.target.currency !== context.currency
      || scope.target.businessTimezone !== context.businessTimezone) {
      throw new Error('scheduler request 与 transition capability scope 不一致。');
    }
    const expectedAuthority = cloneExactAuthority(input.expectedAuthority);
    if (expectedAuthority.activeStoreId !== context.storeId
      || !expectedAuthority.context
      || !sameContext(expectedAuthority.context, context)) {
      throw new Error('scheduler expectedAuthority 与 exact Store/Profile/Generation 不一致。');
    }

    return {
      input: input as AuthorizedSchedulerRequest<Domain>['input'],
      context,
      expectedAuthority,
      scope: scope as StoreCollectionTransitionCapabilityScope<Domain>,
      executionScope: undefined as never,
    };
  }

export function assertExecutionIdentity(this: CollectionSchedulerAdapterRuntime,
  input: SchedulerExecuteInput | SchedulerRecoverInput,
  executionScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>,
  context: StoreContextEnvelope): void {
    const identity = deriveStoreCollectionSchedulerExecutionIdentity({
      cycleId: input.cycleId,
      transitionId: input.transitionId,
      fingerprint: input.expectedFingerprint,
      transitionScope: executionScope,
      context,
    });
    if (identity.attemptId !== input.attemptId || identity.requestId !== input.requestId) {
      throw new Error('scheduler attempt/request 无法由 admitted execution scope 复算。');
    }
  }
