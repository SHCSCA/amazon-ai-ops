import {
  normalizeStoreContextEnvelope,
  type StoreConnection,
  type StoreContextEnvelope,
  type StoreId,
  type StoreRecord,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionAuthorityReadback,
  type StoreCollectionVisibleRuntimeIntent,
} from './store-collection-orchestrator';
import {
  sameVisibleRuntimeContext,
  type VisibleBrowserRuntimeClaim,
} from './visible-browser-runtime-registry';
import {
  type RuntimeInput,
  type CloseInput,
  type TransitionBinding,
} from "./collection-visible-contracts";
import {
  assertExactUsContext,
  authorityAllowsContext,
  targetMatchesContext,
  runtimeObject,
  normalizeAuthority,
  assertAuthorityUsOrNull,
  authorityWithinScope,
  sameAuthority,
  cloneAuthority,
  cloneScope,
  sameScope,
} from "./collection-visible-values";

import type { CollectionVisibleAdapterRuntime } from './collection-visible-runtime';

export function assertRuntimeStillCurrent(this: CollectionVisibleAdapterRuntime,
  input: RuntimeInput,
  claim: VisibleBrowserRuntimeClaim,
  stage: string): void {
    this.options.registry.assertClaimCurrent(claim);
    this.assertRuntimeInput(input, `${stage}_after_await`);
    const barrier = this.requireTransitionBarrier(input);
    this.options.browserLeases.assertTransitionProofCurrent(barrier.proof);
    if (!sameVisibleRuntimeContext(claim.runtime.context, input.context)) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        'visible runtime context changed during an asynchronous operation',
      );
    }
  }

export function assertRuntimeInput(this: CollectionVisibleAdapterRuntime,
  input: RuntimeInput,
  stage: string): StoreCollectionAuthorityReadback {
    const authority = this.assertPortAuthority(input, stage);
    const context = normalizeStoreContextEnvelope(input.context);
    assertExactUsContext(context);
    if (!authorityAllowsContext(authority, context)
      || !input.transitionScope.target
      || !targetMatchesContext(input.transitionScope.target, context)
      || input.transitionScope.purpose !== 'collection') {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        'runtime input is outside the exact transition target and current authority',
      );
    }
    this.requireActiveStore(context);
    return authority;
  }

export function assertPortAuthority(this: CollectionVisibleAdapterRuntime,
  input: CloseInput,
  stage: string): StoreCollectionAuthorityReadback {
    if (!input
      || !runtimeObject(input.capability)
      || !runtimeObject(input.transitionCapability)
      || !input.transitionScope
      || typeof input.transitionScope !== 'object') {
      throw this.error('SAFETY_STATE_UNKNOWN', `visible runtime ${stage} authority is missing`);
    }
    const expected = normalizeAuthority(input.expectedAuthority);
    assertAuthorityUsOrNull(expected);
    if (!authorityWithinScope(expected, input.transitionScope)) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        `visible runtime ${stage} expected authority is outside transition scope`,
      );
    }
    const current = normalizeAuthority(this.options.readCurrentAuthority());
    assertAuthorityUsOrNull(current);
    if (!sameAuthority(current, expected)) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        `visible runtime ${stage} authority drifted before admission`,
      );
    }
    const binding = this.assertStableTransitionBinding(input, stage, expected);
    const authorityAdvances = !sameAuthority(binding.authoritySnapshot, expected);
    if (authorityAdvances) {
      const permitsAuthorityAdvance = (
        stage === 'start'
        && binding.phase === 'initial_leases_proven'
        && binding.scopeSnapshot.purpose === 'collection'
      ) || (
        stage === 'close'
        && binding.phase === 'initial_leases_proven'
      );
      if (!permitsAuthorityAdvance) {
        throw this.error(
          'SAFETY_STATE_UNKNOWN',
          `visible runtime ${stage} authority changed outside its one allowed transition boundary`,
        );
      }
    }
    if (authorityAdvances) binding.authoritySnapshot = cloneAuthority(expected);
    return current;
  }

export function assertStableTransitionBinding(this: CollectionVisibleAdapterRuntime,
  input: CloseInput,
  stage: string,
  expectedAuthority: StoreCollectionAuthorityReadback): TransitionBinding {
    const previous = this.transitionBindings.get(input.transitionCapability);
    if (!previous) {
      const intent = this.visibleRuntimeIntentKind(input.visibleRuntimeIntent);
      if (stage !== 'close' || intent !== 'initial') {
        throw this.error(
          'SAFETY_STATE_UNKNOWN',
          'a transition binding may only be issued by the initial close intent',
        );
      }
      let validatorResult: void;
      try {
        validatorResult = this.options.assertTransitionAuthority(input);
      } catch (error) {
        throw this.error(
          'SAFETY_STATE_UNKNOWN',
          `visible runtime ${stage} transition authority was rejected: ${
            error instanceof Error ? error.message : 'unknown authority failure'
          }`,
          error,
        );
      }
      if (validatorResult !== undefined) {
        throw this.error(
          'SAFETY_STATE_UNKNOWN',
          'transition authority validator must be synchronous and return void',
        );
      }
      const binding: TransitionBinding = {
        owner: input.owner,
        automationCapability: input.capability,
        scopeIdentity: input.transitionScope,
        scopeSnapshot: cloneScope(input.transitionScope),
        authoritySnapshot: cloneAuthority(expectedAuthority),
        intentDomainCapability: input.visibleRuntimeIntent.domainCapability,
        initialIntentCapability: input.visibleRuntimeIntent.initialCapability,
        terminalCleanupIntentCapability:
          input.visibleRuntimeIntent.terminalCleanupCapability,
        phase: 'bound',
      };
      const existingIntentBinding = this.intentDomainBindings.get(
        binding.intentDomainCapability,
      );
      if (existingIntentBinding
        && existingIntentBinding !== input.transitionCapability) {
        throw this.error(
          'SAFETY_STATE_UNKNOWN',
          'visible runtime intent domain is aliased across transition capabilities',
        );
      }
      this.intentDomainBindings.set(
        binding.intentDomainCapability,
        input.transitionCapability,
      );
      this.transitionBindings.set(input.transitionCapability, binding);
      return binding;
    }
    this.visibleRuntimeIntentKind(input.visibleRuntimeIntent, previous);
    if (previous.owner !== input.owner
      || previous.automationCapability !== input.capability
      || previous.scopeIdentity !== input.transitionScope
      || !sameScope(previous.scopeSnapshot, input.transitionScope)) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        'transition capability is forged, replayed across owners, or scope-mutated',
      );
    }
    return previous;
  }

export function visibleRuntimeIntentKind(this: CollectionVisibleAdapterRuntime,
  intent: StoreCollectionVisibleRuntimeIntent,
  binding?: TransitionBinding): 'initial' | 'terminal_cleanup' {
    if (!intent
      || !Object.isFrozen(intent)
      || !runtimeObject(intent.domainCapability)
      || !runtimeObject(intent.initialCapability)
      || !runtimeObject(intent.terminalCleanupCapability)
      || !runtimeObject(intent.selectedCapability)
      || intent.domainCapability === intent.initialCapability
      || intent.domainCapability === intent.terminalCleanupCapability
      || intent.initialCapability === intent.terminalCleanupCapability
      || (binding && (
        intent.domainCapability !== binding.intentDomainCapability
        || intent.initialCapability !== binding.initialIntentCapability
        || intent.terminalCleanupCapability !== binding.terminalCleanupIntentCapability
      ))) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        'visible runtime intent capability is forged, aliased, or transition-mismatched',
      );
    }
    if (intent.selectedCapability === intent.initialCapability) return 'initial';
    if (intent.selectedCapability === intent.terminalCleanupCapability) {
      return 'terminal_cleanup';
    }
    throw this.error(
      'SAFETY_STATE_UNKNOWN',
      'visible runtime intent selected capability is forged',
    );
  }

export function requireTransitionBinding(this: CollectionVisibleAdapterRuntime,
  input: CloseInput): TransitionBinding {
    const binding = this.transitionBindings.get(input.transitionCapability);
    if (!binding
      || binding.owner !== input.owner
      || binding.automationCapability !== input.capability
      || binding.scopeIdentity !== input.transitionScope
      || !sameScope(binding.scopeSnapshot, input.transitionScope)) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        'transition binding is missing, forged, replayed across owners, or scope-mutated',
      );
    }
    return binding;
  }

export function requireActiveStore(this: CollectionVisibleAdapterRuntime,
  context: StoreContextEnvelope): StoreRecord {
    const matches = this.options.listActiveStores().filter((store) => (
      store.status === 'active'
      && store.storeId === context.storeId
      && store.browserProfileId === context.browserProfileId
      && store.marketplace === context.marketplace
      && store.currency === context.currency
      && store.businessTimezone === context.businessTimezone
    ));
    if (matches.length !== 1) {
      throw this.error(
        'UNSUPPORTED_STORE',
        'Store/Profile is absent or ambiguous in the active US/USD/LA snapshot',
      );
    }
    assertExactUsContext(context);
    return matches[0];
  }

export function requireLingxingConnection(this: CollectionVisibleAdapterRuntime,
  storeId: StoreId): StoreConnection {
    const matches = this.options.listStoreConnections(storeId)
      .filter((connection) => connection.provider === 'lingxing');
    if (matches.length !== 1
      || matches[0].storeId !== storeId
      || matches[0].status === 'blocked'
      || matches[0].status === 'not_configured'
      || typeof matches[0].externalAccountId !== 'string'
      || matches[0].externalAccountId.trim().length === 0) {
      throw this.error(
        'IDENTITY_UNVERIFIED',
        'exact Lingxing external account identity is unavailable for this store',
      );
    }
    return matches[0];
  }
