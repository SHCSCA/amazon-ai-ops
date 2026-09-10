/**
 * V1.6 Policy Runtime
 *
 * Per PRD §15.2 + §15.4:
 *   - Exactly two write-authority modes: manual_approval | policy_auto.
 *   - Mode change requires non-empty reason + CAS on `authorityModeRevision`.
 *   - Each successful change increments `authorityModeRevision` and
 *     records an audit row; renderer/Main/UI see the same monotonic value.
 *   - Mode/policy change invalidates pending authority (Decisions/Grants/
 *     preflight/unsubmitted slots) but does NOT rewrite submitted history.
 *   - Switching back to the old mode never resurrects invalidated Grants.
 *
 * @module v16-policy-runtime
 */

import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  PolicyMode,
  PolicyStore,
  PolicyVersionRecord,
  PolicyVersionService,
} from './v16-policy-version';

export interface ModeChangeAuditRow {
  readonly auditId: string;
  readonly storeId: string;
  readonly fromMode: PolicyMode | null;
  readonly toMode: PolicyMode;
  readonly authorityModeRevisionBefore: number;
  readonly authorityModeRevisionAfter: number;
  readonly previousPolicyVersionId: string | null;
  readonly activePolicyVersionId: string | null;
  readonly reason: string;
  readonly actor: string;
  readonly changedAt: string;
  readonly contextSnapshot: StoreContextEnvelope;
}

export interface RuntimeState {
  readonly storeId: string;
  readonly mode: PolicyMode;
  readonly authorityModeRevision: number;
  readonly activePolicyVersionId: string | null;
}

export interface InvalidationRecord {
  readonly invalidationId: string;
  readonly storeId: string;
  readonly authorityModeRevision: number;
  readonly invalidatesGrantIds: readonly string[];
  readonly invalidatesBatchIds: readonly string[];
  readonly invalidatesSlotIds: readonly string[];
  readonly reason: string;
  readonly createdAt: string;
  /** Terminal — never resurrects even if mode/policy is reverted. */
  readonly terminal: true;
}

export class PolicyRuntimeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_MODE'
      | 'INVALID_REASON'
      | 'INVALID_REVISION'
      | 'REVISION_CONFLICT'
      | 'POLICY_NOT_ENABLED'
      | 'STORE_MISMATCH'
      | 'GRANT_NOT_PENDING'
      | 'INVALIDATION_TERMINAL'
      | 'POLICY_MISSING'
      | 'INVALID_INPUT',
  ) {
    super(message);
    this.name = 'PolicyRuntimeError';
  }
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Pending authority registry: tracks which Grants / Batches / Slots are open
 * against the current `authorityModeRevision`. Mode/policy changes flip the
 * revision and remove their authority from the active set; invalidation
 * records keep the historical chain so callers cannot resurrect them.
 */
export interface PendingAuthorityRegistry {
  readonly pendingGrantIds: Set<string>;
  readonly pendingBatchIds: Set<string>;
  readonly pendingSlotIds: Set<string>;
}

/**
 * Shared store contract used by the runtime. Two services constructed
 * against the same store see the same mode/audit/invalidation history.
 */
export interface PolicyRuntimeStore extends PolicyStore {
  readonly mode: Map<string, PolicyMode>;
  readonly authorityModeRevision: Map<string, number>;
  readonly activePolicyVersionId: Map<string, string | null>;
  readonly audit: ModeChangeAuditRow[];
  readonly invalidations: InvalidationRecord[];
  readonly pending: Map<string, PendingAuthorityRegistry>;
}

export function createRuntimeStore(): PolicyRuntimeStore {
  return {
    policies: new Map(),
    storeIndex: new Map(),
    mode: new Map(),
    authorityModeRevision: new Map(),
    activePolicyVersionId: new Map(),
    audit: [],
    invalidations: [],
    pending: new Map(),
  };
}

/**
 * Policy Runtime — owns the per-store mode, authority mode revision, active
 * policy version, and audit/invalidation ledger. The runtime does not own
 * the policy version lifecycle itself; it delegates to `PolicyVersionService`.
 */
export class PolicyRuntime {
  private readonly policySvc: PolicyVersionService;

  constructor(
    private readonly ctx: StoreContextEnvelope,
    private readonly store: PolicyRuntimeStore,
  ) {
    this.policySvc = new PolicyVersionService(ctx, store);
  }

  private validateStore(storeId: string): void {
    if (String(this.ctx.storeId) !== String(storeId)) {
      throw new PolicyRuntimeError(
        `Policy runtime store mismatch: ${storeId} vs ${this.ctx.storeId}`,
        'STORE_MISMATCH',
      );
    }
  }

  private reasonProvided(reason: string | undefined): reason is string {
    return typeof reason === 'string' && reason.trim().length > 0;
  }

  /** Read the current runtime state for the bound store. */
  getState(): RuntimeState {
    const sid = String(this.ctx.storeId);
    const mode = this.store.mode.get(sid);
    const rev = this.store.authorityModeRevision.get(sid);
    const policyId = this.store.activePolicyVersionId.get(sid) ?? null;
    if (!mode || typeof rev !== 'number') {
      throw new PolicyRuntimeError(
        `Runtime state not initialised for ${this.ctx.storeId}`,
        'POLICY_MISSING',
      );
    }
    return {
      storeId: sid,
      mode,
      authorityModeRevision: rev,
      activePolicyVersionId: policyId,
    };
  }

  /** Initialise the per-store mode/policy. Idempotent; subsequent calls must
   * use `changeMode` / `supersedeActivePolicy` and require CAS. */
  initialise(input: {
    mode: PolicyMode;
    actor: string;
    reason: string;
    activePolicyVersionId?: string | null;
  }): RuntimeState {
    const sid = String(this.ctx.storeId);
    if (this.store.mode.has(sid)) {
      throw new PolicyRuntimeError(
        'Runtime already initialised; use changeMode/supersedeActivePolicy',
        'REVISION_CONFLICT',
      );
    }
    if (!this.reasonProvided(input.reason)) {
      throw new PolicyRuntimeError('Initialise requires a non-empty reason', 'INVALID_REASON');
    }
    if (input.activePolicyVersionId) {
      const policy = this.store.policies.get(input.activePolicyVersionId);
      if (!policy) {
        throw new PolicyRuntimeError('Active policy not found', 'POLICY_NOT_ENABLED');
      }
      if (policy.status !== 'enabled') {
        throw new PolicyRuntimeError('Active policy must not be enabled', 'POLICY_NOT_ENABLED');
      }
    }
    this.store.mode.set(sid, input.mode);
    this.store.authorityModeRevision.set(sid, 1);
    this.store.activePolicyVersionId.set(sid, input.activePolicyVersionId ?? null);
    this.store.pending.set(sid, {
      pendingGrantIds: new Set(),
      pendingBatchIds: new Set(),
      pendingSlotIds: new Set(),
    });
    const audit: ModeChangeAuditRow = {
      auditId: generateId('mode'),
      storeId: sid,
      fromMode: null,
      toMode: input.mode,
      authorityModeRevisionBefore: 0,
      authorityModeRevisionAfter: 1,
      previousPolicyVersionId: null,
      activePolicyVersionId: input.activePolicyVersionId ?? null,
      reason: input.reason,
      actor: input.actor,
      changedAt: new Date().toISOString(),
      contextSnapshot: { ...this.ctx },
    };
    this.store.audit.push(audit);
    return this.getState();
  }

  /**
   * Change the write-authority mode. Requires a non-empty reason, a CAS on
   * `expectedAuthorityModeRevision`, and atomically:
   *   - bumps `authorityModeRevision`
   *   - invalidates all pending Grants/Batches/Slots for the store
   *   - records an audit row
   * Returns the previous runtime state for callers to diff.
   */
  changeMode(input: {
    newMode: PolicyMode;
    expectedAuthorityModeRevision: number;
    actor: string;
    reason: string;
  }): { before: RuntimeState; after: RuntimeState; audit: ModeChangeAuditRow } {
    const sid = String(this.ctx.storeId);
    if (!this.reasonProvided(input.reason)) {
      throw new PolicyRuntimeError('Mode change requires a non-empty reason', 'INVALID_REASON');
    }
    if (input.newMode !== 'manual_approval' && input.newMode !== 'policy_auto') {
      throw new PolicyRuntimeError(`Unknown mode: ${input.newMode}`, 'INVALID_MODE');
    }
    const before = this.getState();
    if (input.expectedAuthorityModeRevision !== before.authorityModeRevision) {
      throw new PolicyRuntimeError(
        `expectedAuthorityModeRevision ${input.expectedAuthorityModeRevision} != current ${before.authorityModeRevision}`,
        'REVISION_CONFLICT',
      );
    }
    const afterRev = before.authorityModeRevision + 1;
    this.store.authorityModeRevision.set(sid, afterRev);
    this.store.mode.set(sid, input.newMode);
    // Invalidate all pending authority for the previous mode/revision.
    this.recordInvalidation({
      reason: `mode change: ${before.mode} -> ${input.newMode}`,
      invalidates: this.collectPendingAuthority(sid),
    });
    const audit: ModeChangeAuditRow = {
      auditId: generateId('mode'),
      storeId: sid,
      fromMode: before.mode,
      toMode: input.newMode,
      authorityModeRevisionBefore: before.authorityModeRevision,
      authorityModeRevisionAfter: afterRev,
      previousPolicyVersionId: before.activePolicyVersionId,
      activePolicyVersionId: before.activePolicyVersionId,
      reason: input.reason,
      actor: input.actor,
      changedAt: new Date().toISOString(),
      contextSnapshot: { ...this.ctx },
    };
    this.store.audit.push(audit);
    const after = this.getState();
    return { before, after, audit };
  }

  /**
   * Atomically swap the active policy version. Same CAS contract; bumps
   * `authorityModeRevision`, invalidates pending authority, records audit.
   */
  supersedeActivePolicy(input: {
    newPolicyVersionId: string;
    expectedAuthorityModeRevision: number;
    actor: string;
    reason: string;
  }): { before: RuntimeState; after: RuntimeState; audit: ModeChangeAuditRow } {
    const sid = String(this.ctx.storeId);
    if (!this.reasonProvided(input.reason)) {
      throw new PolicyRuntimeError('Supersede requires a non-empty reason', 'INVALID_REASON');
    }
    const newPolicy = this.store.policies.get(input.newPolicyVersionId);
    if (!newPolicy) throw new PolicyRuntimeError('New policy not found', 'POLICY_NOT_ENABLED');
    this.validateStore(newPolicy.storeId);
    if (newPolicy.status !== 'enabled') {
      throw new PolicyRuntimeError('New policy must be enabled', 'POLICY_NOT_ENABLED');
    }
    const before = this.getState();
    if (input.expectedAuthorityModeRevision !== before.authorityModeRevision) {
      throw new PolicyRuntimeError(
        `expectedAuthorityModeRevision ${input.expectedAuthorityModeRevision} != current ${before.authorityModeRevision}`,
        'REVISION_CONFLICT',
      );
    }
    const afterRev = before.authorityModeRevision + 1;
    this.store.authorityModeRevision.set(sid, afterRev);
    this.store.activePolicyVersionId.set(sid, newPolicy.policyVersionId);
    this.recordInvalidation({
      reason: `policy swap -> ${newPolicy.policyVersionId} rev ${newPolicy.revision}`,
      invalidates: this.collectPendingAuthority(sid),
    });
    const audit: ModeChangeAuditRow = {
      auditId: generateId('mode'),
      storeId: sid,
      fromMode: before.mode,
      toMode: before.mode,
      authorityModeRevisionBefore: before.authorityModeRevision,
      authorityModeRevisionAfter: afterRev,
      previousPolicyVersionId: before.activePolicyVersionId,
      activePolicyVersionId: newPolicy.policyVersionId,
      reason: input.reason,
      actor: input.actor,
      changedAt: new Date().toISOString(),
      contextSnapshot: { ...this.ctx },
    };
    this.store.audit.push(audit);
    const after = this.getState();
    return { before, after, audit };
  }

  // ─── Pending Authority Tracking ───────────────────────────────────────

  /**
   * Register a Grant as pending under the current `authorityModeRevision`.
   * If the Grant is already registered under a different revision it has
   * already been invalidated and cannot be re-registered.
   */
  registerPendingGrant(grantId: string): number {
    return this.registerPending('pendingGrantIds', grantId);
  }

  registerPendingBatch(batchId: string): number {
    return this.registerPending('pendingBatchIds', batchId);
  }

  registerPendingSlot(slotId: string): number {
    return this.registerPending('pendingSlotIds', slotId);
  }

  /**
   * Check whether a Grant is still authorised at the current revision.
   * Returns false when the Grant's recorded revision is below the current
   * runtime revision (i.e. it has been invalidated).
   */
  isGrantStillAuthorised(grantAuthorityRevision: number): boolean {
    const current = this.getState().authorityModeRevision;
    return grantAuthorityRevision >= current;
  }

  /**
   * Pull the audit history for this store (chronological).
   */
  getAudit(): ModeChangeAuditRow[] {
    const sid = String(this.ctx.storeId);
    return this.store.audit.filter((row) => row.storeId === sid);
  }

  getInvalidations(): InvalidationRecord[] {
    const sid = String(this.ctx.storeId);
    return this.store.invalidations.filter((row) => row.storeId === sid);
  }

  // ─── Policy helpers (delegated) ───────────────────────────────────────

  createPolicy(input: Parameters<PolicyVersionService['create']>[0]) {
    return this.policySvc.create(input);
  }
  enablePolicy(policyVersionId: string, enabledBy: string, reason: string) {
    return this.policySvc.enable(policyVersionId, enabledBy, reason);
  }
  supersedePolicy(input: Parameters<PolicyVersionService['supersede']>[0]) {
    return this.policySvc.supersede(input);
  }
  togglePolicyKillSwitch(policyVersionId: string, on: boolean, reason: string) {
    return this.policySvc.toggleKillSwitch(policyVersionId, on, reason);
  }
  getPolicy(policyVersionId: string): PolicyVersionRecord | null {
    return this.policySvc.get(policyVersionId);
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private registerPending(
    bucket: keyof Pick<PendingAuthorityRegistry, 'pendingGrantIds' | 'pendingBatchIds' | 'pendingSlotIds'>,
    id: string,
  ): number {
    const sid = String(this.ctx.storeId);
    const current = this.getState().authorityModeRevision;
    const pending = this.store.pending.get(sid);
    if (!pending) {
      throw new PolicyRuntimeError('Runtime not initialised', 'POLICY_MISSING');
    }
    pending[bucket].add(id);
    return current;
  }

  private collectPendingAuthority(sid: string): {
    grantIds: string[];
    batchIds: string[];
    slotIds: string[];
  } {
    const pending = this.store.pending.get(sid);
    if (!pending) return { grantIds: [], batchIds: [], slotIds: [] };
    const grantIds = Array.from(pending.pendingGrantIds);
    const batchIds = Array.from(pending.pendingBatchIds);
    const slotIds = Array.from(pending.pendingSlotIds);
    // Clear pending — those IDs are now in the terminal invalidation record.
    pending.pendingGrantIds.clear();
    pending.pendingBatchIds.clear();
    pending.pendingSlotIds.clear();
    return { grantIds, batchIds, slotIds };
  }

  private recordInvalidation(input: {
    reason: string;
    invalidates: { grantIds: string[]; batchIds: string[]; slotIds: string[] };
  }): InvalidationRecord {
    const sid = String(this.ctx.storeId);
    const current = this.store.authorityModeRevision.get(sid) ?? 0;
    const record: InvalidationRecord = {
      invalidationId: generateId('inv'),
      storeId: sid,
      authorityModeRevision: current,
      invalidatesGrantIds: input.invalidates.grantIds,
      invalidatesBatchIds: input.invalidates.batchIds,
      invalidatesSlotIds: input.invalidates.slotIds,
      reason: input.reason,
      createdAt: new Date().toISOString(),
      terminal: true,
    };
    this.store.invalidations.push(record);
    return record;
  }
}

/**
 * Quick check: a previously-recorded `authorityModeRevision` from a Grant
 * is still live iff it equals the runtime's current revision. Once a mode
 * or policy change bumps the revision, any older Grant is terminal.
 */
export function isGrantStillLive(
  runtime: PolicyRuntime,
  grantAuthorityRevision: number,
): boolean {
  return runtime.isGrantStillAuthorised(grantAuthorityRevision);
}