import {
  deriveStoreCapsulePaths,
  type StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionAuthorityReadback,
  type StoreCollectionExecutionAutomationAuthority,
  type StoreCollectionTransitionCapabilityScope,
} from './store-collection-orchestrator';
import {
  type ProviderIdentityPageLike,
  type ProviderPageIdentityResult,
} from './provider-page-active-identity';
import {
  sameVisibleRuntimeContext,
} from './visible-browser-runtime-registry';
import {
  StoreCollectionVisibleRuntimeAdapterError,
  type CollectionOnlyBrowserController,
} from "./collection-visible-contracts";

export function confirmation<
  Input extends StoreCollectionExecutionAutomationAuthority,
  Result extends Record<string, true>,
>(
  input: Input,
  authority: StoreCollectionAuthorityReadback,
  result: Result,
): Input & { authority: StoreCollectionAuthorityReadback } & Result {
  return {
    owner: input.owner,
    capability: input.capability,
    transitionCapability: input.transitionCapability,
    transitionScope: input.transitionScope,
    authority: cloneAuthority(authority),
    ...result,
  } as Input & { authority: StoreCollectionAuthorityReadback } & Result;
}

export function assertCapsule(capsule: StoreCapsulePaths, context: StoreContextEnvelope): void {
  if (!capsule || typeof capsule.trustedStoresRoot !== 'string') {
    throw new StoreCollectionVisibleRuntimeAdapterError(
      'SAFETY_STATE_UNKNOWN',
      'derived store capsule is unavailable',
    );
  }
  let canonical: StoreCapsulePaths;
  try {
    canonical = deriveStoreCapsulePaths(
      capsule.trustedStoresRoot,
      context.storeId,
      context.browserProfileId,
    );
  } catch (error) {
    throw new StoreCollectionVisibleRuntimeAdapterError(
      'SAFETY_STATE_UNKNOWN',
      'store capsule could not be re-derived from the trusted root',
      { cause: error },
    );
  }
  if (capsule.storeId !== context.storeId
    || capsule.browserProfileId !== context.browserProfileId
    || typeof capsule.lingxingProfileDir !== 'string'
    || capsule.lingxingProfileDir.length === 0
    || capsule.lingxingProfileDir === capsule.amazonAdsProfileDir
    || capsule.storeRoot !== canonical.storeRoot
    || capsule.lingxingProfileDir !== canonical.lingxingProfileDir
    || capsule.amazonAdsProfileDir !== canonical.amazonAdsProfileDir) {
    throw new StoreCollectionVisibleRuntimeAdapterError(
      'SAFETY_STATE_UNKNOWN',
      'derived store capsule does not match the exact Store/Profile or provider split',
    );
  }
}

export function controllerLike(value: unknown): value is CollectionOnlyBrowserController {
  return Boolean(value)
    && typeof (value as CollectionOnlyBrowserController).launch === 'function'
    && typeof (value as CollectionOnlyBrowserController).navigate === 'function'
    && typeof (value as CollectionOnlyBrowserController).close === 'function'
    && typeof (value as CollectionOnlyBrowserController).getPage === 'function'
    && typeof (value as CollectionOnlyBrowserController).getContext === 'function';
}

export function pageLike(value: unknown): value is ProviderIdentityPageLike {
  return Boolean(value)
    && typeof (value as ProviderIdentityPageLike).url === 'function'
    && typeof (value as ProviderIdentityPageLike).title === 'function'
    && typeof (value as ProviderIdentityPageLike).evaluate === 'function';
}

export function identityFailureCode(
  status: ProviderPageIdentityResult['status'],
): StoreCollectionVisibleRuntimeAdapterError['code'] {
  if (status === 'login_required') return 'LOGIN_REQUIRED';
  if (status === 'mfa_required') return 'MFA_REQUIRED';
  return 'IDENTITY_UNVERIFIED';
}

export function identityFailureMessage(status: ProviderPageIdentityResult['status']): string {
  if (status === 'login_required') return 'visible Lingxing session requires operator login';
  if (status === 'mfa_required') return 'visible Lingxing session requires operator MFA';
  return 'visible Lingxing page identity is unverified';
}

export function assertExactUsContext(context: StoreContextEnvelope): void {
  if (context.marketplace !== 'US'
    || context.currency !== 'USD'
    || context.businessTimezone !== 'America/Los_Angeles') {
    throw new StoreCollectionVisibleRuntimeAdapterError(
      'UNSUPPORTED_STORE',
      'collection-only runtime supports exact US/USD/America/Los_Angeles stores only',
    );
  }
}

export function authorityAllowsContext(
  authority: StoreCollectionAuthorityReadback,
  context: StoreContextEnvelope,
): boolean {
  return authority.activeStoreId === context.storeId
    && authority.context !== null
    && sameVisibleRuntimeContext(authority.context, context);
}

export function targetMatchesContext(
  target: NonNullable<StoreCollectionTransitionCapabilityScope['target']>,
  context: StoreContextEnvelope,
): boolean {
  return target.storeId === context.storeId
    && target.browserProfileId === context.browserProfileId
    && target.marketplace === context.marketplace
    && target.currency === context.currency
    && target.businessTimezone === context.businessTimezone;
}

export function authorityWithinScope(
  authority: StoreCollectionAuthorityReadback,
  scope: StoreCollectionTransitionCapabilityScope,
): boolean {
  const candidates = [
    scope.fromAuthority,
    scope.originAuthority,
    ...(scope.target ? [{
      activeStoreId: scope.target.storeId,
      context: authority.context && targetMatchesContext(scope.target, authority.context)
        ? authority.context
        : null,
    }] : []),
  ];
  return candidates.some((candidate) => {
    if (candidate.activeStoreId !== authority.activeStoreId) return false;
    if (candidate.context === null) return authority.context === null;
    return authority.context !== null
      && sameVisibleRuntimeContext(candidate.context, authority.context);
  }) || Boolean(
    scope.target
    && authority.context
    && authority.activeStoreId === scope.target.storeId
    && targetMatchesContext(scope.target, authority.context),
  );
}

export function normalizeAuthority(value: StoreCollectionAuthorityReadback): StoreCollectionAuthorityReadback {
  if (!value || typeof value !== 'object') {
    throw new StoreCollectionVisibleRuntimeAdapterError(
      'SAFETY_STATE_UNKNOWN',
      'Main Store authority readback is invalid',
    );
  }
  if (value.activeStoreId === null) {
    if (value.context !== null) {
      throw new StoreCollectionVisibleRuntimeAdapterError(
        'SAFETY_STATE_UNKNOWN',
        'null Store authority cannot carry a context',
      );
    }
    return { activeStoreId: null, context: null };
  }
  if (!value.context) {
    throw new StoreCollectionVisibleRuntimeAdapterError(
      'SAFETY_STATE_UNKNOWN',
      'active Store authority requires an exact context',
    );
  }
  const context = normalizeStoreContextEnvelope(value.context);
  if (context.storeId !== value.activeStoreId) {
    throw new StoreCollectionVisibleRuntimeAdapterError(
      'SAFETY_STATE_UNKNOWN',
      'active Store id and context do not match',
    );
  }
  return { activeStoreId: context.storeId, context };
}

export function assertAuthorityUsOrNull(authority: StoreCollectionAuthorityReadback): void {
  if (authority.context) assertExactUsContext(authority.context);
}

export function sameAuthority(
  left: StoreCollectionAuthorityReadback,
  right: StoreCollectionAuthorityReadback,
): boolean {
  if (left.activeStoreId !== right.activeStoreId) return false;
  if (!left.context || !right.context) return left.context === right.context;
  return sameVisibleRuntimeContext(left.context, right.context);
}

export function cloneAuthority(
  value: StoreCollectionAuthorityReadback,
): StoreCollectionAuthorityReadback {
  return {
    activeStoreId: value.activeStoreId,
    context: value.context ? normalizeStoreContextEnvelope(value.context) : null,
  };
}

export function cloneScope(
  scope: StoreCollectionTransitionCapabilityScope,
): StoreCollectionTransitionCapabilityScope {
  return {
    capabilityDomain: scope.capabilityDomain,
    capabilityId: scope.capabilityId,
    cycleId: scope.cycleId,
    transitionId: scope.transitionId,
    purpose: scope.purpose,
    fromAuthority: cloneAuthority(scope.fromAuthority),
    originAuthority: cloneAuthority(scope.originAuthority),
    target: scope.target ? { ...scope.target } : null,
    expectedFingerprint: scope.expectedFingerprint,
  };
}

export function sameScope(
  left: StoreCollectionTransitionCapabilityScope,
  right: StoreCollectionTransitionCapabilityScope,
): boolean {
  return left.capabilityDomain === right.capabilityDomain
    && left.capabilityId === right.capabilityId
    && left.cycleId === right.cycleId
    && left.transitionId === right.transitionId
    && left.purpose === right.purpose
    && sameAuthority(left.fromAuthority, right.fromAuthority)
    && sameAuthority(left.originAuthority, right.originAuthority)
    && ((left.target === null && right.target === null)
      || Boolean(left.target && right.target
        && left.target.storeId === right.target.storeId
        && left.target.browserProfileId === right.target.browserProfileId
        && left.target.marketplace === right.target.marketplace
        && left.target.currency === right.target.currency
        && left.target.businessTimezone === right.target.businessTimezone))
    && left.expectedFingerprint === right.expectedFingerprint;
}

export function runtimeObject(value: unknown): value is Readonly<object> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

export function promiseLike(value: unknown): value is PromiseLike<unknown> {
  return runtimeObject(value)
    && typeof (value as { then?: unknown }).then === 'function';
}
