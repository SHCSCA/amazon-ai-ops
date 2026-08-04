import type {
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  normalizeStoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  BrowserLeaseError,
  BrowserLeaseManager,
  type BrowserLease,
} from './browser-lease';

export type CollectionOperationContextSnapshot = Readonly<Pick<
  StoreContextEnvelope,
  'browserProfileId' | 'businessDate' | 'sessionGeneration' | 'storeId'
>>;

export interface StartCollectionOperationInput {
  readonly context: StoreContextEnvelope;
  readonly owner: string;
  readonly ttlMs?: number;
}

export interface CollectionOperationGuardDependencies {
  readonly assertActiveContext: (context: StoreContextEnvelope) => StoreContextEnvelope;
  readonly leases: BrowserLeaseManager;
}

export class CollectionOperationGuardError extends Error {
  constructor(
    readonly code:
      | 'ACTIVE_CONTEXT_UNAVAILABLE'
      | 'COLLECTION_CONTEXT_CHANGED'
      | 'COLLECTION_OPERATION_CLOSED',
    message: string,
  ) {
    super(message);
    this.name = 'CollectionOperationGuardError';
  }
}

/**
 * One store-scoped collection operation. Call assertStepCurrent immediately
 * before each browser step; renew also performs the same authority check.
 */
export class CollectionOperation {
  private closed = false;
  private lease: BrowserLease;

  constructor(
    readonly snapshot: CollectionOperationContextSnapshot,
    private readonly capturedContext: StoreContextEnvelope,
    lease: BrowserLease,
    private readonly guard: CollectionOperationGuard,
  ) {
    this.lease = lease;
  }

  currentLease(): BrowserLease {
    this.assertOpen();
    return this.lease;
  }

  assertStepCurrent(): BrowserLease {
    this.assertOpen();
    this.guard.assertContextCurrent(this.capturedContext);
    return this.guard.assertLeaseCurrent(this.lease);
  }

  renew(ttlMs?: number): BrowserLease {
    this.assertStepCurrent();
    this.lease = this.guard.renewLease(this.lease, ttlMs);
    return this.lease;
  }

  release(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.guard.releaseLease(this.lease);
    } catch (error) {
      if (
        error instanceof BrowserLeaseError
        && ['LEASE_EXPIRED', 'LEASE_NOT_FOUND', 'STALE_LEASE'].includes(error.code)
      ) {
        return;
      }
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new CollectionOperationGuardError(
        'COLLECTION_OPERATION_CLOSED',
        'collection operation is already closed',
      );
    }
  }
}

/**
 * Couples the shared StoreContextEnvelope authority with the existing
 * per-store browser lease. Collection and external writes therefore share one
 * serial lane, while store switches and reconnect generations fail closed.
 */
export class CollectionOperationGuard {
  constructor(private readonly dependencies: CollectionOperationGuardDependencies) {}

  start(input: StartCollectionOperationInput): CollectionOperation {
    const context = normalizeStoreContextEnvelope(input.context);
    const snapshot = snapshotContext(context);
    this.assertContextCurrent(context);

    const lease = this.dependencies.leases.acquire({
      storeId: context.storeId,
      owner: input.owner,
      purpose: 'collection',
      ttlMs: input.ttlMs,
    });
    try {
      // A synchronous active-context source makes acquisition and this second
      // validation one no-yield critical section for Renderer/Main callers.
      this.assertContextCurrent(context);
      return new CollectionOperation(snapshot, context, lease, this);
    } catch (error) {
      this.dependencies.leases.release(lease);
      throw error;
    }
  }

  async run<T>(
    input: StartCollectionOperationInput,
    execute: (operation: CollectionOperation) => Promise<T> | T,
  ): Promise<T> {
    const operation = this.start(input);
    try {
      const result = await execute(operation);
      // A final check prevents an async store switch from producing a normal
      // completion when the callback forgot a final readback step.
      operation.assertStepCurrent();
      return result;
    } finally {
      operation.release();
    }
  }

  assertContextCurrent(context: StoreContextEnvelope): StoreContextEnvelope {
    const captured = normalizeStoreContextEnvelope(context);
    const authoritativeValue = this.dependencies.assertActiveContext(captured);
    let authoritative: StoreContextEnvelope;
    try {
      authoritative = normalizeStoreContextEnvelope(authoritativeValue);
    } catch {
      throw new CollectionOperationGuardError(
        'ACTIVE_CONTEXT_UNAVAILABLE',
        'active store authority returned an unavailable or invalid context',
      );
    }
    if (!sameCollectionAuthority(snapshotContext(captured), authoritative)) {
      throw new CollectionOperationGuardError(
        'COLLECTION_CONTEXT_CHANGED',
        'active store, browser profile, business date, or session generation changed during collection',
      );
    }
    return authoritative;
  }

  assertLeaseCurrent(lease: BrowserLease): BrowserLease {
    return this.dependencies.leases.assertCurrent(lease);
  }

  renewLease(lease: BrowserLease, ttlMs?: number): BrowserLease {
    return ttlMs === undefined
      ? this.dependencies.leases.renew(lease)
      : this.dependencies.leases.renew(lease, ttlMs);
  }

  releaseLease(lease: BrowserLease): void {
    this.dependencies.leases.release(lease);
  }

}

function snapshotContext(context: StoreContextEnvelope): CollectionOperationContextSnapshot {
  return Object.freeze({
    storeId: context.storeId,
    browserProfileId: context.browserProfileId,
    businessDate: context.businessDate,
    sessionGeneration: context.sessionGeneration,
  });
}

function sameCollectionAuthority(
  snapshot: CollectionOperationContextSnapshot,
  active: StoreContextEnvelope,
): boolean {
  return snapshot.storeId === active.storeId
    && snapshot.browserProfileId === active.browserProfileId
    && snapshot.businessDate === active.businessDate
    && snapshot.sessionGeneration === active.sessionGeneration;
}
