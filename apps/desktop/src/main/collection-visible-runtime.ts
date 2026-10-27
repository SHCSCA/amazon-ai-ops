import {
  inspectLingxingProviderPageIdentity,
} from './provider-page-active-identity';
import {
  type VisibleBrowserRuntimeClaim,
} from './visible-browser-runtime-registry';
import {
  type StoreCollectionVisibleRuntimeAdapterOptions,
  type TransitionBinding,
  type ActiveTransitionBarrier,
} from "./collection-visible-contracts";
import {
  closeVisibleRuntime,
  assertCollectionLeaseReleased,
  startCollectionOnlyVisibleRuntime,
  verifyVisibleLingxingIdentity,
  cleanupFailedRuntime,
} from "./collection-visible-browser-lifecycle";
import {
  assertRuntimeStillCurrent,
  assertRuntimeInput,
  assertPortAuthority,
  assertStableTransitionBinding,
  visibleRuntimeIntentKind,
  requireTransitionBinding,
  requireActiveStore,
  requireLingxingConnection,
} from "./collection-visible-capability-binding";
import {
  ensureTransitionBarrier,
  requireTransitionBarrier,
  confirmBarrierRuntimeClosed,
  markBarrierUnknown,
  markActiveBarrierUnknownForExactInput,
  readNow,
  error,
} from "./collection-visible-barrier";

export class CollectionVisibleAdapterRuntime {
  readonly now: () => Date;
  readonly inspectIdentity: NonNullable<
    StoreCollectionVisibleRuntimeAdapterOptions['inspectLingxingIdentity']
  >;
  readonly transitionBindings = new WeakMap<object, TransitionBinding>();
  readonly intentDomainBindings = new WeakMap<object, Readonly<object>>();
  runtimeClaim: VisibleBrowserRuntimeClaim | null = null;
  activeBarrier: ActiveTransitionBarrier | null = null;
  closeVisibleRuntime = closeVisibleRuntime;
  assertCollectionLeaseReleased = assertCollectionLeaseReleased;
  startCollectionOnlyVisibleRuntime = startCollectionOnlyVisibleRuntime;
  verifyVisibleLingxingIdentity = verifyVisibleLingxingIdentity;
  assertRuntimeStillCurrent = assertRuntimeStillCurrent;
  cleanupFailedRuntime = cleanupFailedRuntime;
  assertRuntimeInput = assertRuntimeInput;
  assertPortAuthority = assertPortAuthority;
  assertStableTransitionBinding = assertStableTransitionBinding;
  visibleRuntimeIntentKind = visibleRuntimeIntentKind;
  requireTransitionBinding = requireTransitionBinding;
  requireActiveStore = requireActiveStore;
  requireLingxingConnection = requireLingxingConnection;
  ensureTransitionBarrier = ensureTransitionBarrier;
  requireTransitionBarrier = requireTransitionBarrier;
  confirmBarrierRuntimeClosed = confirmBarrierRuntimeClosed;
  markBarrierUnknown = markBarrierUnknown;
  markActiveBarrierUnknownForExactInput = markActiveBarrierUnknownForExactInput;
  readNow = readNow;
  error = error;

  constructor(readonly options: StoreCollectionVisibleRuntimeAdapterOptions) {
    this.now = options.now ?? (() => new Date());
    this.inspectIdentity = options.inspectLingxingIdentity
      ?? inspectLingxingProviderPageIdentity;
  }
}
