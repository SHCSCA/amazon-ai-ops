import {
  BrowserLeaseError,
  type BrowserLeaseManager,
  type BrowserTransitionBarrierProof,
  type BrowserTransitionEnteredProof,
  type BrowserTransitionLeaseEmptyProof,
} from '@amazon-ai-ops/browser-worker';

export type UserVisibleBrowserTransitionFinalState = Readonly<
  | { state: 'empty' }
  | {
    state: 'runtime_started';
    runtimeId: string;
    epoch: number;
  }
>;

export class UserVisibleBrowserTransitionPreMutationError extends Error {
  readonly code = 'VISIBLE_BROWSER_TRANSITION_BUSY';
  readonly mutationStarted = false;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UserVisibleBrowserTransitionPreMutationError';
  }
}

export function isUserVisibleBrowserTransitionPreMutationError(
  error: unknown,
): error is UserVisibleBrowserTransitionPreMutationError {
  return error instanceof UserVisibleBrowserTransitionPreMutationError
    && error.code === 'VISIBLE_BROWSER_TRANSITION_BUSY'
    && error.mutationStarted === false;
}

export interface RunUserVisibleBrowserTransitionOptions<Result> {
  leases: BrowserLeaseManager;
  owner: string;
  /** Must close and consume the exact visible-runtime empty proof. */
  closeRuntime(): Promise<void>;
  /** Synchronous readback: registry and pending controllers are exactly empty. */
  assertRuntimeClosed(): void;
  /** Runs only after the runtime-close and global-lease-empty proofs. */
  work(): Promise<Result> | Result;
  /** Synchronous final CAS readback used while the transition barrier is held. */
  readFinalState(result: Result): UserVisibleBrowserTransitionFinalState;
}

export interface StoreMutationTransitionScope {
  operation: string;
  targetStoreId?: string;
}

/** Lane-in decision: only mutations that can replace/invalidate active authority close it. */
export function storeMutationRequiresVisibleBrowserTransition(
  scope: StoreMutationTransitionScope,
  activeStoreId: string | undefined,
): boolean {
  if (scope.operation === 'stores:switch' || scope.operation === 'stores:reconnect') return true;
  if (scope.operation === 'stores:create' || scope.operation === 'stores:restore') return false;
  const activeScopedMutation = scope.operation === 'stores:update'
    || scope.operation === 'stores:archive'
    || scope.operation === 'stores:connections:create'
    || scope.operation === 'stores:connections:update'
    || scope.operation === 'stores:connections:remove';
  if (!activeScopedMutation) {
    throw new TypeError(`unsupported Store mutation transition operation: ${scope.operation}`);
  }
  return Boolean(activeStoreId && scope.targetStoreId === activeStoreId);
}

/**
 * Main-only Store/session transition guard.
 *
 * Barrier admission is deliberately synchronous. A pre-existing lease is a
 * safe pre-mutation rejection; after admission, every failure is safety
 * unknown and the barrier remains held until an explicit recovery proves an
 * exact empty runtime.
 */
export function runUserVisibleBrowserTransition<Result>(
  options: RunUserVisibleBrowserTransitionOptions<Result>,
): Promise<Result> {
  let entered: BrowserTransitionEnteredProof;
  try {
    entered = options.leases.enterTransitionBarrier(options.owner);
  } catch (error) {
    if (error instanceof BrowserLeaseError
      && (error.code === 'LEASES_ACTIVE' || error.code === 'TRANSITION_BARRIER_HELD')) {
      throw new UserVisibleBrowserTransitionPreMutationError(
        'visible browser transition is busy with an active operation',
        { cause: error },
      );
    }
    throw error;
  }

  return performAdmittedTransition(options, entered);
}

async function performAdmittedTransition<Result>(
  options: RunUserVisibleBrowserTransitionOptions<Result>,
  entered: BrowserTransitionEnteredProof,
): Promise<Result> {
  let proof: BrowserTransitionBarrierProof = entered;
  try {
    await options.closeRuntime();
    options.assertRuntimeClosed();
    proof = options.leases.confirmTransitionRuntimeClosed(entered);
    proof = options.leases.confirmTransitionLeasesEmpty(proof);

    const result = await options.work();
    const finalState = options.readFinalState(result);
    if (finalState.state === 'empty') {
      options.assertRuntimeClosed();
      options.leases.assertTransitionProofCurrent(
        proof as BrowserTransitionLeaseEmptyProof,
        'leases_proven',
      );
      options.leases.completeTransitionAfterExactEmpty(
        proof as BrowserTransitionLeaseEmptyProof,
        'aborted',
      );
      return result;
    }

    assertStartedIdentity(finalState);
    proof = options.leases.confirmTransitionRuntimeStarted(
      proof as BrowserTransitionLeaseEmptyProof,
    );
    options.leases.completeTransitionIdentityVerified(proof);
    return result;
  } catch (error) {
    try {
      options.leases.markTransitionSafetyUnknown(proof);
    } catch {
      // A missing, forged, or replayed proof is already safety unknown. Never
      // attempt to release the barrier on this path.
    }
    throw error;
  }
}

function assertStartedIdentity(
  state: Extract<UserVisibleBrowserTransitionFinalState, { state: 'runtime_started' }>,
): void {
  if (typeof state.runtimeId !== 'string'
    || !/^[A-Za-z0-9:_-]{1,160}$/.test(state.runtimeId)
    || !Number.isSafeInteger(state.epoch)
    || state.epoch < 1) {
    throw new TypeError('visible runtime final identity is invalid');
  }
}
