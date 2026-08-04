import { randomUUID } from 'crypto';
import type { StoreContextEnvelope, StoreId } from '@amazon-ai-ops/shared-types';
import {
  assertStoreContextEnvelope,
  normalizeStoreId,
} from '@amazon-ai-ops/shared-types';

export type BrowserLeasePurpose = 'collection' | 'external_write';

export interface BrowserLease {
  storeId: StoreId;
  token: string;
  generation: number;
  purpose: BrowserLeasePurpose;
  owner: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface AcquireBrowserLeaseInput {
  storeId: StoreId;
  purpose: BrowserLeasePurpose;
  owner: string;
  ttlMs?: number;
}

export type BrowserTransitionBarrierStage =
  | 'entered'
  | 'runtime_closed'
  | 'leases_proven'
  | 'runtime_started'
  | 'sticky_unknown';

declare const browserTransitionProofBrand: unique symbol;
type BrowserTransitionProof<Stage extends BrowserTransitionBarrierStage> = Readonly<{
  capability: Readonly<object>;
  owner: string;
  epoch: number;
  stage: Stage;
  readonly [browserTransitionProofBrand]: Stage;
}>;

export type BrowserTransitionEnteredProof = BrowserTransitionProof<'entered'>;
export type BrowserTransitionRuntimeClosedProof = BrowserTransitionProof<'runtime_closed'>;
export type BrowserTransitionLeaseEmptyProof = BrowserTransitionProof<'leases_proven'>;
export type BrowserTransitionRuntimeStartedProof = BrowserTransitionProof<'runtime_started'>;
export type BrowserTransitionStickyUnknownProof = BrowserTransitionProof<'sticky_unknown'>;
export type BrowserTransitionBarrierProof =
  | BrowserTransitionEnteredProof
  | BrowserTransitionRuntimeClosedProof
  | BrowserTransitionLeaseEmptyProof
  | BrowserTransitionRuntimeStartedProof
  | BrowserTransitionStickyUnknownProof;

export interface BrowserTransitionReleaseReceipt {
  capability: Readonly<object>;
  owner: string;
  epoch: number;
  released: true;
  outcome: 'identity_verified' | 'aborted' | 'terminal_close';
}

interface TransitionProofRecord {
  proof: BrowserTransitionBarrierProof;
  consumed: boolean;
}

export class BrowserLeaseError extends Error {
  constructor(
    readonly code:
      | 'LEASE_HELD'
      | 'LEASE_NOT_FOUND'
      | 'STALE_LEASE'
      | 'LEASE_EXPIRED'
      | 'LEASE_GENERATION_EXHAUSTED'
      | 'LEASES_ACTIVE'
      | 'TRANSITION_BARRIER_HELD'
      | 'TRANSITION_BARRIER_NOT_HELD'
      | 'TRANSITION_BARRIER_STAGE_MISMATCH'
      | 'TRANSITION_BARRIER_PROOF_INVALID'
      | 'TRANSITION_BARRIER_EPOCH_EXHAUSTED'
      | 'INVALID_LEASE_OWNER'
      | 'INVALID_LEASE_PURPOSE'
      | 'INVALID_LEASE_TOKEN'
      | 'INVALID_LEASE_TTL',
    message: string,
  ) {
    super(message);
    this.name = 'BrowserLeaseError';
  }
}

/**
 * Per-store single-holder lease. Collection and writes share the same lane so
 * a collection can queue above this layer but can never preempt a submit.
 */
export class BrowserLeaseManager {
  private readonly leases = new Map<StoreId, BrowserLease>();
  private readonly generations = new Map<StoreId, number>();
  private transitionBarrierEpoch = 0;
  private transitionBarrier: {
    owner: string;
    epoch: number;
    proof: BrowserTransitionBarrierProof;
  } | null = null;
  private readonly transitionProofs = new WeakMap<object, TransitionProofRecord>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly createToken: () => string = () => randomUUID(),
    private readonly defaultTtlMs = 60_000,
  ) {}

  acquire(input: AcquireBrowserLeaseInput): BrowserLease {
    if (this.transitionBarrier) {
      throw new BrowserLeaseError(
        'TRANSITION_BARRIER_HELD',
        'browser transition barrier blocks all new collection and external_write leases',
      );
    }
    const storeId = normalizeStoreId(input.storeId);
    const owner = normalizeOwner(input.owner);
    if (input.purpose !== 'collection' && input.purpose !== 'external_write') {
      throw new BrowserLeaseError(
        'INVALID_LEASE_PURPOSE',
        'browser lease purpose must be collection or external_write',
      );
    }
    const ttlMs = normalizeTtl(input.ttlMs ?? this.defaultTtlMs);
    const now = this.readNow();
    const held = this.leases.get(storeId);
    if (held) {
      throw new BrowserLeaseError(
        'LEASE_HELD',
        `store ${storeId} still has an unreleased ${held.purpose} browser lease`,
      );
    }
    const token = this.createToken();
    if (typeof token !== 'string' || token.length < 16 || token.length > 512) {
      throw new BrowserLeaseError(
        'INVALID_LEASE_TOKEN',
        'browser lease token factory returned an invalid token',
      );
    }
    const generation = (this.generations.get(storeId) ?? 0) + 1;
    if (!Number.isSafeInteger(generation)) {
      throw new BrowserLeaseError(
        'LEASE_GENERATION_EXHAUSTED',
        'browser lease generation is exhausted',
      );
    }
    this.generations.set(storeId, generation);
    const lease: BrowserLease = Object.freeze({
      storeId,
      token,
      generation,
      purpose: input.purpose,
      owner,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    });
    this.leases.set(storeId, lease);
    return lease;
  }

  current(storeIdInput: unknown): BrowserLease | undefined {
    const storeId = normalizeStoreId(storeIdInput);
    return this.leases.get(storeId);
  }

  /**
   * Main-only readback used at Store/Profile transition boundaries.
   *
   * TTL expiry is diagnostic only: it never proves that the underlying browser
   * operation stopped. Every holder remains in this global readback until its
   * exact token/generation/expiry tuple is explicitly released.
   */
  activeLeases(): readonly BrowserLease[] {
    return Object.freeze(
      [...this.leases.values()]
        .sort((left, right) => (
          left.storeId < right.storeId ? -1 : left.storeId > right.storeId ? 1 : 0
        ))
        .map((lease) => Object.freeze({ ...lease })),
    );
  }

  assertNoActiveLeases(): readonly BrowserLease[] {
    const active = this.activeLeases();
    if (active.length > 0) {
      throw new BrowserLeaseError(
        'LEASES_ACTIVE',
        `cannot transition the visible browser while ${active.length} browser lease(s) remain active`,
      );
    }
    return active;
  }

  assertCurrent(lease: BrowserLease): BrowserLease {
    const current = this.leases.get(normalizeStoreId(lease?.storeId));
    if (!current) throw new BrowserLeaseError('LEASE_NOT_FOUND', 'browser lease was not found');
    if (
      current.token !== lease.token
      || current.generation !== lease.generation
      || current.expiresAt !== lease.expiresAt
      || current.owner !== lease.owner
      || current.purpose !== lease.purpose
    ) {
      throw new BrowserLeaseError(
        'STALE_LEASE',
        'browser lease token, generation, or expiry is stale',
      );
    }
    if (this.isExpired(current, this.readNow())) {
      throw new BrowserLeaseError('LEASE_EXPIRED', 'browser lease has expired');
    }
    return current;
  }

  renew(lease: BrowserLease, ttlMs = this.defaultTtlMs): BrowserLease {
    const current = this.assertCurrent(lease);
    const normalizedTtl = normalizeTtl(ttlMs);
    const now = this.readNow();
    const currentExpiry = Date.parse(current.expiresAt);
    const nextExpiry = Math.max(now + normalizedTtl, currentExpiry + 1);
    const renewed: BrowserLease = Object.freeze({
      ...current,
      expiresAt: new Date(nextExpiry).toISOString(),
    });
    this.leases.set(current.storeId, renewed);
    return renewed;
  }

  release(lease: BrowserLease): void {
    const current = this.assertHeldExact(lease);
    this.leases.delete(current.storeId);
  }

  enterTransitionBarrier(ownerInput: unknown): BrowserTransitionEnteredProof {
    const owner = normalizeOwner(ownerInput);
    if (this.transitionBarrier) {
      throw new BrowserLeaseError(
        'TRANSITION_BARRIER_HELD',
        'a browser transition barrier is already held',
      );
    }
    if (this.leases.size > 0) {
      throw new BrowserLeaseError(
        'LEASES_ACTIVE',
        `cannot enter browser transition while ${this.leases.size} unreleased lease(s) remain`,
      );
    }
    const epoch = this.transitionBarrierEpoch + 1;
    if (!Number.isSafeInteger(epoch)) {
      throw new BrowserLeaseError(
        'TRANSITION_BARRIER_EPOCH_EXHAUSTED',
        'browser transition barrier epoch is exhausted',
      );
    }
    this.transitionBarrierEpoch = epoch;
    const proof = this.issueTransitionProof(owner, epoch, 'entered');
    this.transitionBarrier = { owner, epoch, proof };
    return proof as BrowserTransitionEnteredProof;
  }

  confirmTransitionRuntimeClosed(
    proof: BrowserTransitionEnteredProof
      | BrowserTransitionLeaseEmptyProof
      | BrowserTransitionRuntimeStartedProof
      | BrowserTransitionStickyUnknownProof,
  ): BrowserTransitionRuntimeClosedProof {
    this.requireTransitionProof(proof, [
      'entered',
      'leases_proven',
      'runtime_started',
      'sticky_unknown',
    ]);
    return this.advanceTransitionProof(proof, 'runtime_closed') as BrowserTransitionRuntimeClosedProof;
  }

  confirmTransitionLeasesEmpty(
    proof: BrowserTransitionRuntimeClosedProof,
  ): BrowserTransitionLeaseEmptyProof {
    this.requireTransitionProof(proof, ['runtime_closed']);
    if (this.leases.size > 0) {
      throw new BrowserLeaseError(
        'LEASES_ACTIVE',
        `browser transition still has ${this.leases.size} unreleased lease(s)`,
      );
    }
    return this.advanceTransitionProof(proof, 'leases_proven') as BrowserTransitionLeaseEmptyProof;
  }

  confirmTransitionRuntimeStarted(
    proof: BrowserTransitionLeaseEmptyProof,
  ): BrowserTransitionRuntimeStartedProof {
    this.requireTransitionProof(proof, ['leases_proven']);
    return this.advanceTransitionProof(proof, 'runtime_started') as BrowserTransitionRuntimeStartedProof;
  }

  completeTransitionIdentityVerified(
    proof: BrowserTransitionRuntimeStartedProof,
  ): BrowserTransitionReleaseReceipt {
    this.requireTransitionProof(proof, ['runtime_started']);
    return this.releaseTransitionProof(proof, 'identity_verified');
  }

  completeTransitionAfterExactEmpty(
    proof: BrowserTransitionLeaseEmptyProof,
    outcome: 'aborted' | 'terminal_close',
  ): BrowserTransitionReleaseReceipt {
    this.requireTransitionProof(proof, ['leases_proven']);
    if (this.leases.size > 0) {
      throw new BrowserLeaseError(
        'LEASES_ACTIVE',
        'cannot release transition barrier without an exact global empty proof',
      );
    }
    return this.releaseTransitionProof(proof, outcome);
  }

  markTransitionSafetyUnknown(
    proof: BrowserTransitionBarrierProof,
  ): BrowserTransitionStickyUnknownProof {
    if (proof.stage === 'sticky_unknown') {
      this.requireTransitionProof(proof, ['sticky_unknown'], false);
      return proof as BrowserTransitionStickyUnknownProof;
    }
    this.requireTransitionProof(proof, [
      'entered',
      'runtime_closed',
      'leases_proven',
      'runtime_started',
    ]);
    return this.advanceTransitionProof(proof, 'sticky_unknown') as BrowserTransitionStickyUnknownProof;
  }

  assertTransitionProofCurrent<Proof extends BrowserTransitionBarrierProof>(
    proof: Proof,
    expectedStage?: Proof['stage'],
  ): Proof {
    this.requireTransitionProof(
      proof,
      expectedStage ? [expectedStage] : [proof.stage],
      false,
    );
    return proof;
  }

  private assertHeldExact(lease: BrowserLease): BrowserLease {
    const current = this.leases.get(normalizeStoreId(lease?.storeId));
    if (!current) throw new BrowserLeaseError('LEASE_NOT_FOUND', 'browser lease was not found');
    if (
      current.token !== lease.token
      || current.generation !== lease.generation
      || current.expiresAt !== lease.expiresAt
      || current.owner !== lease.owner
      || current.purpose !== lease.purpose
    ) {
      throw new BrowserLeaseError(
        'STALE_LEASE',
        'browser lease identity is stale or owner/purpose mismatched',
      );
    }
    return current;
  }

  private issueTransitionProof(
    owner: string,
    epoch: number,
    stage: BrowserTransitionBarrierStage,
  ): BrowserTransitionBarrierProof {
    const capability = Object.freeze({});
    const proof = Object.freeze({ capability, owner, epoch, stage }) as BrowserTransitionBarrierProof;
    this.transitionProofs.set(capability, { proof, consumed: false });
    return proof;
  }

  private requireTransitionProof(
    proof: BrowserTransitionBarrierProof,
    stages: readonly BrowserTransitionBarrierStage[],
    consume = true,
  ): TransitionProofRecord {
    if (!proof
      || typeof proof !== 'object'
      || !proof.capability
      || typeof proof.capability !== 'object') {
      throw new BrowserLeaseError(
        'TRANSITION_BARRIER_PROOF_INVALID',
        'browser transition proof is required',
      );
    }
    const record = this.transitionProofs.get(proof.capability);
    const barrier = this.transitionBarrier;
    if (!record
      || record.proof !== proof
      || record.consumed
      || !barrier
      || barrier.proof !== proof
      || barrier.epoch !== proof.epoch
      || barrier.owner !== proof.owner) {
      throw new BrowserLeaseError(
        'TRANSITION_BARRIER_PROOF_INVALID',
        'browser transition proof is forged, replayed, or stale',
      );
    }
    if (!stages.includes(proof.stage)) {
      throw new BrowserLeaseError(
        'TRANSITION_BARRIER_STAGE_MISMATCH',
        `browser transition stage ${proof.stage} is not allowed here`,
      );
    }
    if (consume) record.consumed = true;
    return record;
  }

  private advanceTransitionProof(
    proof: BrowserTransitionBarrierProof,
    nextStage: BrowserTransitionBarrierStage,
  ): BrowserTransitionBarrierProof {
    const barrier = this.transitionBarrier;
    if (!barrier) {
      throw new BrowserLeaseError(
        'TRANSITION_BARRIER_NOT_HELD',
        'browser transition barrier is not held',
      );
    }
    const next = this.issueTransitionProof(barrier.owner, barrier.epoch, nextStage);
    barrier.proof = next;
    return next;
  }

  private releaseTransitionProof(
    proof: BrowserTransitionBarrierProof,
    outcome: BrowserTransitionReleaseReceipt['outcome'],
  ): BrowserTransitionReleaseReceipt {
    const barrier = this.transitionBarrier;
    if (!barrier) {
      throw new BrowserLeaseError(
        'TRANSITION_BARRIER_NOT_HELD',
        'browser transition barrier is not held',
      );
    }
    const receipt = Object.freeze({
      capability: Object.freeze({}),
      owner: barrier.owner,
      epoch: barrier.epoch,
      released: true,
      outcome,
    }) as BrowserTransitionReleaseReceipt;
    this.transitionBarrier = null;
    return receipt;
  }

  private isExpired(lease: BrowserLease, now: number): boolean {
    return Date.parse(lease.expiresAt) <= now;
  }

  private readNow(): number {
    const value = this.now();
    if (!Number.isFinite(value)) {
      throw new BrowserLeaseError('INVALID_LEASE_TTL', 'browser lease clock is invalid');
    }
    return value;
  }
}

export class SessionGenerationError extends Error {
  constructor(
    readonly code:
      | 'STALE_SESSION_GENERATION'
      | 'INVALID_INITIAL_GENERATION'
      | 'SESSION_NOT_TRACKED'
      | 'SESSION_GENERATION_EXHAUSTED'
      | 'STORE_NOT_ACTIVE',
    message: string,
  ) {
    super(message);
    this.name = 'SessionGenerationError';
  }
}

export class SessionGenerationRegistry {
  private readonly generations = new Map<StoreId, number>();
  private activeStoreId: StoreId | undefined;

  seed(storeIdInput: unknown, generation: number): void {
    const storeId = normalizeStoreId(storeIdInput);
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new SessionGenerationError(
        'INVALID_INITIAL_GENERATION',
        'initial session generation must be a non-negative safe integer',
      );
    }
    const current = this.generations.get(storeId) ?? 0;
    this.generations.set(storeId, Math.max(current, generation));
  }

  current(storeIdInput: unknown): number {
    return this.generations.get(normalizeStoreId(storeIdInput)) ?? 0;
  }

  advance(storeIdInput: unknown): number {
    const storeId = normalizeStoreId(storeIdInput);
    const next = this.current(storeId) + 1;
    if (!Number.isSafeInteger(next)) {
      throw new SessionGenerationError(
        'SESSION_GENERATION_EXHAUSTED',
        'session generation is exhausted',
      );
    }
    this.generations.set(storeId, next);
    return next;
  }

  reconnect(storeIdInput: unknown): number {
    const storeId = normalizeStoreId(storeIdInput);
    if (this.activeStoreId && this.activeStoreId !== storeId) {
      throw new SessionGenerationError(
        'STORE_NOT_ACTIVE',
        `cannot reconnect inactive store ${storeId}`,
      );
    }
    if (!this.activeStoreId) this.activeStoreId = storeId;
    return this.advance(storeId);
  }

  switchStore(storeIdInput: unknown): number {
    const nextStoreId = normalizeStoreId(storeIdInput);
    const previousStoreId = this.activeStoreId;
    if (previousStoreId && previousStoreId !== nextStoreId) {
      // Invalidate requests issued for the UI store being left as well as any
      // requests issued for the store being entered during an earlier visit.
      this.advance(previousStoreId);
    }
    this.activeStoreId = nextStoreId;
    return this.advance(nextStoreId);
  }

  assertCurrent(context: StoreContextEnvelope): void {
    assertStoreContextEnvelope(context);
    const storeId = normalizeStoreId(context.storeId);
    if (!this.generations.has(storeId)) {
      throw new SessionGenerationError(
        'SESSION_NOT_TRACKED',
        `session generation for store ${storeId} is not registered`,
      );
    }
    if (this.generations.get(storeId) !== context.sessionGeneration) {
      throw new SessionGenerationError(
        'STALE_SESSION_GENERATION',
        `session generation for store ${storeId} is stale`,
      );
    }
  }

  assertActive(context: StoreContextEnvelope): void {
    this.assertCurrent(context);
    if (!this.activeStoreId || context.storeId !== this.activeStoreId) {
      throw new SessionGenerationError(
        'STORE_NOT_ACTIVE',
        'store context does not belong to the active store session',
      );
    }
  }
}

function normalizeOwner(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 160) {
    throw new BrowserLeaseError('INVALID_LEASE_OWNER', 'lease owner must contain 1-160 characters');
  }
  return value.trim();
}

function normalizeTtl(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1_000 || value > 3_600_000) {
    throw new BrowserLeaseError('INVALID_LEASE_TTL', 'lease ttl must be between 1 second and 1 hour');
  }
  return value;
}
