import {
  normalizeStoreContextEnvelope,
  type BrowserProfileId,
  type StoreContextEnvelope,
  type StoreId,
  type StoreRecord,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionAutomationLease,
  type StoreCollectionPolicySuppressionLease,
  type StoreCollectionAutomationAuthority,
  type StoreCollectionAuthorityReadback,
  type StoreCollectionTransitionTarget,
  type StoreCollectionOrchestratorTransition,
  type StoreCollectionTransitionCapabilityDomain,
  type StoreCollectionTransitionCapabilityScope,
  type CapabilityIdentityDomain,
} from "./collection-orchestrator-contracts";
import {
  safeId,
  codepointCompare,
  corruptHistory,
} from "./collection-orchestrator-failure-values";

export function assertAutomationLease(value: StoreCollectionAutomationLease): void {
  if (!value
    || !safeId(value.owner)
    || !runtimeCapability(value.capability)
    || typeof value.release !== 'function') {
    throw new Error('invalid automation lease');
  }
}

export function assertPolicySuppressionLease(value: StoreCollectionPolicySuppressionLease): void {
  if (!value
    || !safeId(value.owner)
    || !runtimeCapability(value.capability)
    || !runtimeCapability(value.guard)
    || typeof value.release !== 'function') {
    throw new Error('invalid policy suppression lease');
  }
}

export function cloneAuthority(value: StoreCollectionAutomationAuthority): StoreCollectionAutomationAuthority {
  return { owner: value.owner, capability: value.capability };
}

export function cloneAuthorityReadback(value: StoreCollectionAuthorityReadback): StoreCollectionAuthorityReadback {
  return {
    activeStoreId: value.activeStoreId,
    context: value.context ? normalizeStoreContextEnvelope(value.context) : null,
  };
}

export function sameAuthority(
  left: StoreCollectionAuthorityReadback,
  right: StoreCollectionAuthorityReadback,
): boolean {
  if (left.activeStoreId !== right.activeStoreId) return false;
  if (left.context === null || right.context === null) return left.context === right.context;
  const leftContext = normalizeStoreContextEnvelope(left.context);
  const rightContext = normalizeStoreContextEnvelope(right.context);
  return leftContext.storeId === rightContext.storeId
    && leftContext.browserProfileId === rightContext.browserProfileId
    && leftContext.marketplace === rightContext.marketplace
    && leftContext.currency === rightContext.currency
    && leftContext.businessTimezone === rightContext.businessTimezone
    && leftContext.businessDate === rightContext.businessDate
    && leftContext.sessionGeneration === rightContext.sessionGeneration;
}

export function authorityMatchesRestoreTarget(
  actual: StoreCollectionAuthorityReadback,
  target: StoreCollectionAuthorityReadback,
): boolean {
  if (target.activeStoreId === null) return actual.activeStoreId === null && actual.context === null;
  if (actual.activeStoreId !== target.activeStoreId
    || actual.context === null
    || target.context === null) {
    return false;
  }
  const actualContext = normalizeStoreContextEnvelope(actual.context);
  const targetContext = normalizeStoreContextEnvelope(target.context);
  return actualContext.storeId === targetContext.storeId
    && actualContext.browserProfileId === targetContext.browserProfileId
    && actualContext.marketplace === 'US'
    && actualContext.currency === 'USD'
    && actualContext.businessTimezone === 'America/Los_Angeles'
    && targetContext.marketplace === 'US'
    && targetContext.currency === 'USD'
    && targetContext.businessTimezone === 'America/Los_Angeles'
    && codepointCompare(actualContext.businessDate, targetContext.businessDate) >= 0
    && actualContext.sessionGeneration >= targetContext.sessionGeneration;
}

export function authorityMatchesTransitionTarget(
  actual: StoreCollectionAuthorityReadback,
  target: StoreCollectionTransitionTarget | null,
): boolean {
  if (target === null) return actual.activeStoreId === null && actual.context === null;
  return actual.activeStoreId === target.storeId
    && actual.context !== null
    && actual.context.browserProfileId === target.browserProfileId
    && actual.context.marketplace === target.marketplace
    && actual.context.currency === target.currency
    && actual.context.businessTimezone === target.businessTimezone;
}

export function sameTransitionTarget(
  left: StoreCollectionTransitionTarget | null,
  right: StoreCollectionTransitionTarget | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.storeId === right.storeId
    && left.browserProfileId === right.browserProfileId
    && left.marketplace === right.marketplace
    && left.currency === right.currency
    && left.businessTimezone === right.businessTimezone;
}

export function transitionTargetFromStore(store: StoreRecord): StoreCollectionTransitionTarget {
  return {
    storeId: store.storeId,
    browserProfileId: store.browserProfileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
  };
}

export function manualCollectionCycleKey(context: StoreContextEnvelope): string {
  return JSON.stringify([
    context.storeId,
    context.browserProfileId,
    context.marketplace,
    context.currency,
    context.businessTimezone,
    context.businessDate,
    context.sessionGeneration,
  ]);
}

export function collectionAttemptSemanticKey(input: {
  storeId: StoreId;
  browserProfileId: BrowserProfileId;
  expectedFingerprint: string;
}): string {
  return JSON.stringify([
    input.storeId,
    input.browserProfileId,
    input.expectedFingerprint,
  ]);
}

export function transitionTargetFromContext(context: StoreContextEnvelope): StoreCollectionTransitionTarget {
  return {
    storeId: context.storeId,
    browserProfileId: context.browserProfileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
  };
}

export function contextFromTransition(
  transition: StoreCollectionOrchestratorTransition,
): StoreContextEnvelope {
  if (transition.purpose !== 'collection'
    || !transition.toStoreId
    || !transition.browserProfileId
    || !transition.businessDate
    || transition.sessionGeneration === undefined) {
    throw corruptHistory();
  }
  return normalizeStoreContextEnvelope({
    storeId: transition.toStoreId,
    browserProfileId: transition.browserProfileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: transition.businessDate,
    sessionGeneration: transition.sessionGeneration,
  });
}

export function storeFromContext(context: StoreContextEnvelope): StoreRecord {
  return {
    storeId: context.storeId,
    browserProfileId: context.browserProfileId,
    displayName: context.storeId,
    marketplace: 'US',
    currency: 'USD',
    status: 'active',
    businessTimezone: 'America/Los_Angeles',
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
  };
}

export function transitionScopeFromTransition<Domain extends StoreCollectionTransitionCapabilityDomain>(
  transition: StoreCollectionOrchestratorTransition,
  capabilityDomain: Domain,
): StoreCollectionTransitionCapabilityScope<Domain> {
  return {
    capabilityDomain,
    capabilityId: capabilityDomain === 'transition_execution'
      ? transition.capabilityId
      : `${transition.capabilityId}:recovery`,
    cycleId: transition.cycleId,
    transitionId: transition.transitionId,
    purpose: transition.purpose,
    fromAuthority: cloneAuthorityReadback(transition.fromAuthority),
    originAuthority: cloneAuthorityReadback(transition.originAuthority),
    target: transition.toStoreId === null || transition.browserProfileId === null
      ? null
      : {
        storeId: transition.toStoreId,
        browserProfileId: transition.browserProfileId,
        marketplace: 'US',
        currency: 'USD',
        businessTimezone: 'America/Los_Angeles',
      },
    expectedFingerprint: transition.expectedFingerprint ?? null,
  };
}

export function freezeTransitionScope<Domain extends StoreCollectionTransitionCapabilityDomain>(
  value: StoreCollectionTransitionCapabilityScope<Domain>,
): StoreCollectionTransitionCapabilityScope<Domain> {
  const freezeAuthority = (
    authority: StoreCollectionAuthorityReadback,
  ): StoreCollectionAuthorityReadback => Object.freeze({
    activeStoreId: authority.activeStoreId,
    context: authority.context
      ? Object.freeze(normalizeStoreContextEnvelope(authority.context))
      : null,
  });
  return Object.freeze({
    capabilityDomain: value.capabilityDomain,
    capabilityId: value.capabilityId,
    cycleId: value.cycleId,
    transitionId: value.transitionId,
    purpose: value.purpose,
    fromAuthority: freezeAuthority(value.fromAuthority),
    originAuthority: freezeAuthority(value.originAuthority),
    target: value.target ? Object.freeze({ ...value.target }) : null,
    expectedFingerprint: value.expectedFingerprint,
  });
}

export function canonicalTransitionScope<Domain extends StoreCollectionTransitionCapabilityDomain>(
  value: StoreCollectionTransitionCapabilityScope<Domain>,
): StoreCollectionTransitionCapabilityScope<Domain> {
  return {
    capabilityDomain: value.capabilityDomain,
    capabilityId: value.capabilityId,
    cycleId: value.cycleId,
    transitionId: value.transitionId,
    purpose: value.purpose,
    fromAuthority: cloneAuthorityReadback(value.fromAuthority),
    originAuthority: cloneAuthorityReadback(value.originAuthority),
    target: value.target ? { ...value.target } : null,
    expectedFingerprint: value.expectedFingerprint,
  };
}

export function capabilityIdentityDomain(
  domain: StoreCollectionTransitionCapabilityDomain,
): Extract<CapabilityIdentityDomain, 'transition_execution' | 'transition_recovery'> {
  return domain === 'transition_execution'
    ? 'transition_execution'
    : 'transition_recovery';
}

export function runtimeCapability(value: unknown): value is Readonly<object> {
  return typeof value === 'object' && value !== null;
}

export function cloneStoreRecord(value: StoreRecord): StoreRecord {
  return {
    storeId: value.storeId,
    browserProfileId: value.browserProfileId,
    displayName: value.displayName,
    marketplace: value.marketplace,
    currency: value.currency,
    status: value.status,
    businessTimezone: value.businessTimezone,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.archivedAt === undefined ? {} : { archivedAt: value.archivedAt }),
  };
}
