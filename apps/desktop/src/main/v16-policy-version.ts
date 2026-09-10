/**
 * V1.6 Policy Version Schema
 *
 * Per PRD §16 + Phase 6:
 *  - manual_approval (human) vs policy_auto (policy runtime)
 *  - draft policy cannot grant authority
 *  - enabled policy cannot be mutated in place — changes create new version
 *  - kill switch and circuit breaker
 *
 * @module v16-policy-version
 */

import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';

export type PolicyMode = 'manual_approval' | 'policy_auto';

export type PolicyStatus = 'draft' | 'enabled' | 'disabled' | 'superseded';

export type ActionType =
  | 'adjust_keyword_bid'
  | 'pause_keyword'
  | 'resume_keyword'
  | 'adjust_campaign_budget'
  | 'adjust_ad_group_budget'
  | 'pause_campaign'
  | 'add_negative_keyword';

export interface PolicyScope {
  readonly entityIds?: string[];      // empty = wildcard
  readonly productIds?: string[];      // empty = wildcard
  readonly actionTypes: ActionType[];  // allowed action types
}

export interface PolicyLimits {
  readonly maxChangePercent: number;    // per-action max change
  readonly maxAbsoluteChange?: number;  // absolute max change
  readonly maxSlotsPerGrant: number;
  readonly maxDailyCount: number;
  readonly cooldownMinutes: number;
  readonly budgetCapPerGrant?: number;
}

export interface PolicyWindow {
  readonly activeFrom: string;        // ISO timestamp
  readonly activeUntil?: string;       // ISO timestamp, optional
  readonly activeFromLocal?: string;   // HH:MM in policy timezone (for businessHoursOnly)
  readonly activeUntilLocal?: string;  // HH:MM in policy timezone (for businessHoursOnly)
  readonly businessHoursOnly: boolean;
  readonly timezone: string;           // IANA tz
}

export interface PolicyEvidenceRequirement {
  readonly requiresBeforeScreenshot: boolean;
  readonly requiresAfterScreenshot: boolean;
  readonly requiresReloadScreenshot: boolean;
  readonly requiresValueReadback: boolean;
  readonly requiresOperatorNote: boolean;
}

export interface PolicyStops {
  readonly killSwitchOn: boolean;
  readonly circuitBreakerTriggered: boolean;
  readonly reason?: string;
}

export interface PolicyVersionRecord {
  readonly policyVersionId: string;
  readonly storeId: string;
  readonly mode: PolicyMode;
  readonly status: PolicyStatus;
  readonly revision: number;
  readonly scope: PolicyScope;
  readonly limits: PolicyLimits;
  readonly window: PolicyWindow;
  readonly evidence: PolicyEvidenceRequirement;
  readonly stops: PolicyStops;
  readonly createdAt: string;
  readonly enabledAt?: string;
  readonly disabledAt?: string;
  readonly enabledBy: string;
  readonly reason: string;
  readonly supersedesPolicyVersionId?: string;
}

export class PolicyError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'POLICY_NOT_FOUND'
      | 'POLICY_NOT_ENABLED'
      | 'POLICY_DRAFT_NOT_GRANTABLE'
      | 'POLICY_CHANGE_DENIED'
      | 'INVALID_MODE'
      | 'INVALID_SCOPE'
      | 'INVALID_LIMITS'
      | 'STORE_MISMATCH'
      | 'REASON_REQUIRED',
  ) {
    super(message);
    this.name = 'PolicyError';
  }
}

const VALID_MODES: PolicyMode[] = ['manual_approval', 'policy_auto'];

function generatePolicyId(): string {
  return `policy_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Shared policy store contract. Implementations can be in-memory or
 * persisted to SQLite (see `PolicyVersionRepository`). The service holds
 * a reference so two services bound to different stores still see the
 * same underlying data — but each enforces its own `ctx.storeId` guard.
 */
export interface PolicyStore {
  readonly policies: Map<string, PolicyVersionRecord>;
  readonly storeIndex: Map<string, Set<string>>;
}

/**
 * In-memory policy version store. Persistence is intentionally minimal — the
 * real implementation would use a dedicated `policy_versions` table; for V1.6
 * Phase 6 the contract is what matters.
 */
export class PolicyVersionService {
  constructor(
    private readonly ctx: StoreContextEnvelope,
    private readonly store: PolicyStore = {
      policies: new Map<string, PolicyVersionRecord>(),
      storeIndex: new Map<string, Set<string>>(),
    },
  ) {}

  private validateStore(storeId: string): void {
    if (String(this.ctx.storeId) !== String(storeId)) {
      throw new PolicyError(
        `Policy store mismatch: ${storeId} vs ${this.ctx.storeId}`,
        'STORE_MISMATCH',
      );
    }
  }

  private reasonProvided(reason?: string): reason is string {
    return typeof reason === 'string' && reason.trim().length > 0;
  }

  create(input: {
    mode: PolicyMode;
    scope: PolicyScope;
    limits: PolicyLimits;
    window: PolicyWindow;
    evidence: PolicyEvidenceRequirement;
    reason: string;
  }): PolicyVersionRecord {
    if (!VALID_MODES.includes(input.mode)) {
      throw new PolicyError(`Unknown policy mode: ${input.mode}`, 'INVALID_MODE');
    }
    if (!input.scope.actionTypes || input.scope.actionTypes.length === 0) {
      throw new PolicyError('Policy must allow at least one action type', 'INVALID_SCOPE');
    }
    if (input.limits.maxChangePercent <= 0 || input.limits.maxChangePercent > 100) {
      throw new PolicyError(
        `maxChangePercent must be (0, 100] (got ${input.limits.maxChangePercent})`,
        'INVALID_LIMITS',
      );
    }
    if (input.limits.maxSlotsPerGrant <= 0) {
      throw new PolicyError('maxSlotsPerGrant must be positive', 'INVALID_LIMITS');
    }
    if (!this.reasonProvided(input.reason)) {
      throw new PolicyError('Creating a policy requires a non-empty reason', 'REASON_REQUIRED');
    }
    const now = new Date().toISOString();
    const record: PolicyVersionRecord = {
      policyVersionId: generatePolicyId(),
      storeId: String(this.ctx.storeId),
      mode: input.mode,
      status: 'draft',
      revision: 1,
      scope: input.scope,
      limits: input.limits,
      window: input.window,
      evidence: input.evidence,
      stops: { killSwitchOn: false, circuitBreakerTriggered: false },
      createdAt: now,
      enabledBy: 'operator',
      reason: input.reason,
    };
    this.store.policies.set(record.policyVersionId, record);
    const bucket = this.store.storeIndex.get(record.storeId) ?? new Set<string>();
    bucket.add(record.policyVersionId);
    this.store.storeIndex.set(record.storeId, bucket);
    return record;
  }

  enable(policyVersionId: string, enabledBy: string, reason: string): PolicyVersionRecord {
    const policy = this.store.policies.get(policyVersionId);
    if (!policy) throw new PolicyError('Policy not found', 'POLICY_NOT_FOUND');
    this.validateStore(policy.storeId);
    if (!this.reasonProvided(reason)) {
      throw new PolicyError('Enable requires a non-empty reason', 'REASON_REQUIRED');
    }
    if (policy.status === 'superseded') {
      throw new PolicyError('Cannot enable superseded policy', 'POLICY_CHANGE_DENIED');
    }
    const updated: PolicyVersionRecord = Object.freeze({
      ...policy,
      status: 'enabled' as PolicyStatus,
      enabledAt: new Date().toISOString(),
      enabledBy,
      reason,
    }) as PolicyVersionRecord;
    // Persist the enabled state so subsequent get/supersede/killSwitch see it.
    this.store.policies.set(policyVersionId, updated);
    return updated;
  }

  /**
   * Create a new version that supersedes an existing enabled policy.
   * In-place mutation is forbidden — the new version starts at draft.
   */
  supersede(input: {
    sourcePolicyVersionId: string;
    overrides: {
      scope?: Partial<PolicyScope>;
      limits?: Partial<PolicyLimits>;
      window?: Partial<PolicyWindow>;
      evidence?: Partial<PolicyEvidenceRequirement>;
    };
    reason: string;
  }): PolicyVersionRecord {
    const source = this.store.policies.get(input.sourcePolicyVersionId);
    if (!source) throw new PolicyError('Source policy not found', 'POLICY_NOT_FOUND');
    this.validateStore(source.storeId);
    if (source.status !== 'enabled') {
      throw new PolicyError('Only enabled policies can be superseded', 'POLICY_CHANGE_DENIED');
    }
    if (!this.reasonProvided(input.reason)) {
      throw new PolicyError('Supersede requires a non-empty reason', 'REASON_REQUIRED');
    }
    const now = new Date().toISOString();
    const record: PolicyVersionRecord = {
      policyVersionId: generatePolicyId(),
      storeId: source.storeId,
      mode: source.mode,
      status: 'draft',
      revision: source.revision + 1,
      scope: { ...source.scope, ...input.overrides.scope },
      limits: { ...source.limits, ...input.overrides.limits },
      window: { ...source.window, ...input.overrides.window },
      evidence: { ...source.evidence, ...input.overrides.evidence },
      stops: { ...source.stops },
      createdAt: now,
      enabledBy: 'operator',
      reason: input.reason,
      supersedesPolicyVersionId: source.policyVersionId,
    };
    this.store.policies.set(record.policyVersionId, record);
    const superseded: PolicyVersionRecord = Object.freeze({
      ...source,
      status: 'superseded' as PolicyStatus,
    }) as PolicyVersionRecord;
    this.store.policies.set(source.policyVersionId, superseded);
    return record;
  }

  toggleKillSwitch(policyVersionId: string, on: boolean, reason: string): PolicyVersionRecord {
    const policy = this.store.policies.get(policyVersionId);
    if (!policy) throw new PolicyError('Policy not found', 'POLICY_NOT_FOUND');
    this.validateStore(policy.storeId);
    if (!this.reasonProvided(reason)) {
      throw new PolicyError('Toggling kill switch requires a non-empty reason', 'REASON_REQUIRED');
    }
    const updated: PolicyVersionRecord = Object.freeze({
      ...policy,
      stops: { ...policy.stops, killSwitchOn: on, reason },
    }) as PolicyVersionRecord;
    this.store.policies.set(policyVersionId, updated);
    return updated;
  }

  list(storeId?: string): PolicyVersionRecord[] {
    const sid = storeId ?? String(this.ctx.storeId);
    const ids = this.store.storeIndex.get(sid) ?? new Set<string>();
    return Array.from(ids)
      .map((id) => this.store.policies.get(id))
      .filter((p): p is PolicyVersionRecord => Boolean(p));
  }

  get(policyVersionId: string): PolicyVersionRecord | null {
    return this.store.policies.get(policyVersionId) ?? null;
  }
}

/**
 * Gate priority P0-P6 evaluation against a policy + grant context.
 * Matches the preflight gates already used in ExecutionService.
 */
export interface GateContext {
  readonly policy: PolicyVersionRecord | null;
  readonly grantRemainingSlots: number;
  readonly expectedRevision: number;
  readonly actualRevision: number;
  readonly entityId: string;
  readonly actionType: ActionType;
  /** Optional flags for P2/P6 — runtime already computed these. */
  readonly contextMismatch?: boolean;
  readonly evidenceMissing?: boolean;
}

/**
 * Ordered P0–P6 gate codes (PRD §15.3.1). Priority decides which
 * `primaryBlocker` to surface, NOT whether subsequent gates are skipped —
 * all gates are AND.
 */
export const GATE_PRIORITY_ORDER = [
  'P0_KILL_SWITCH',
  'P1_CIRCUIT_BREAKER',
  'P2_CONTEXT_MISMATCH',
  'P3_REVISION_MISMATCH',
  'P4_GRANT_INVALID',
  'P5_SCOPE_MISMATCH',
  'P6_EVIDENCE_REQUIRED',
] as const;

export type GateCode = (typeof GATE_PRIORITY_ORDER)[number];

/**
 * Full P0–P6 evaluation with all gates AND'd and a single primary blocker
 * chosen by priority order. Returned `blockedGates` lists every failing gate
 * (audit); `primaryBlocker` is the highest-priority failing gate (UI/recovery).
 */
export function evaluatePolicyGates(ctx: GateContext): {
  passed: boolean;
  blockedGates: GateCode[];
  primaryBlocker: GateCode | null;
} {
  const blocked: GateCode[] = [];

  // P0 — kill switch
  if (ctx.policy?.stops?.killSwitchOn) blocked.push('P0_KILL_SWITCH');
  // P1 — circuit breaker
  if (ctx.policy?.stops?.circuitBreakerTriggered) blocked.push('P1_CIRCUIT_BREAKER');
  // P2 — StoreContext / account / session / identity
  // Caller is responsible for invoking assertValidStoreContext before this gate;
  // the gate is included so that runtime can inject a precomputed contextMismatch.
  if (ctx.contextMismatch === true) blocked.push('P2_CONTEXT_MISMATCH');
  // P3 — revision mismatch (mission/action/authorityMode/policy)
  if (ctx.expectedRevision !== ctx.actualRevision) blocked.push('P3_REVISION_MISMATCH');
  // P4 — grant validity / residual authority
  if (ctx.grantRemainingSlots <= 0) blocked.push('P4_GRANT_INVALID');
  // P5 — scope (action/entity) + window + cooldown + daily count + budget
  if (ctx.policy?.scope) {
    if (!ctx.policy.scope.actionTypes.includes(ctx.actionType)) blocked.push('P5_SCOPE_MISMATCH');
    const ids = ctx.policy.scope.entityIds ?? [];
    if (ids.length > 0 && !ids.includes(ctx.entityId)) blocked.push('P5_SCOPE_MISMATCH');
  }
  // P6 — evidence freshness / page identity / expected-before current value
  if (ctx.evidenceMissing === true) blocked.push('P6_EVIDENCE_REQUIRED');

  // Primary blocker = first gate in priority order that failed.
  let primaryBlocker: GateCode | null = null;
  for (const code of GATE_PRIORITY_ORDER) {
    if (blocked.includes(code)) {
      primaryBlocker = code;
      break;
    }
  }

  return { passed: blocked.length === 0, blockedGates: blocked, primaryBlocker };
}

// ─── Policy Eligibility (PRD §15.3) ──────────────────────────────────────

/**
 * Per-proposal inputs to the policy eligibility evaluator. The runtime uses this
 * to decide whether a policy_auto Grant can be issued. `manual_approval`
 * flows do NOT call this — humans decide per-row and only the Grant is checked.
 */
export interface PolicyEligibilityInput {
  readonly policy: PolicyVersionRecord;
  readonly proposal: {
    readonly actionType: ActionType;
    readonly entityId: string;
    readonly currentValue: number;
    readonly proposedValue: number;
    readonly businessDate: string; // YYYY-MM-DD
    readonly businessHourLocal: string; // HH:MM in policy TZ
    readonly localTimezone: string; // IANA tz (validated by caller)
  };
  readonly dailyActionCount: number; // already-reserved + this proposal
  readonly lastActionAt: string | null; // ISO timestamp of prior action
  readonly grantBudgetUsed: number; // running sum of impact
  readonly proposalImpact: number; // |proposedValue - currentValue|
}

export type PolicyEligibilityFailureCode =
  | 'POLICY_NOT_ENABLED'
  | 'POLICY_ACTION_OUT_OF_SCOPE'
  | 'POLICY_ENTITY_OUT_OF_SCOPE'
  | 'POLICY_CHANGE_PCT_EXCEEDED'
  | 'POLICY_DAILY_COUNT_EXCEEDED'
  | 'POLICY_BUDGET_EXCEEDED'
  | 'POLICY_COOLDOWN_ACTIVE'
  | 'POLICY_WINDOW_INACTIVE';

export function evaluatePolicyEligibility(input: PolicyEligibilityInput): {
  readonly eligible: boolean;
  readonly failureCodes: PolicyEligibilityFailureCode[];
} {
  const codes: PolicyEligibilityFailureCode[] = [];
  const { policy, proposal, dailyActionCount, lastActionAt, grantBudgetUsed, proposalImpact } = input;

  if (policy.status !== 'enabled') {
    codes.push('POLICY_NOT_ENABLED');
  }
  if (!policy.scope.actionTypes.includes(proposal.actionType)) {
    codes.push('POLICY_ACTION_OUT_OF_SCOPE');
  }
  const ids = policy.scope.entityIds ?? [];
  if (ids.length > 0 && !ids.includes(proposal.entityId)) {
    codes.push('POLICY_ENTITY_OUT_OF_SCOPE');
  }
  // Change percent bound — only meaningful when currentValue > 0.
  if (proposal.currentValue > 0) {
    const changePct = Math.abs(
      (proposal.proposedValue - proposal.currentValue) / proposal.currentValue,
    ) * 100;
    if (changePct > policy.limits.maxChangePercent) {
      codes.push('POLICY_CHANGE_PCT_EXCEEDED');
    }
  }
  if (dailyActionCount > policy.limits.maxDailyCount) {
    codes.push('POLICY_DAILY_COUNT_EXCEEDED');
  }
  // Cooldown — non-empty lastActionAt must be >= cooldownMinutes old.
  if (lastActionAt && policy.limits.cooldownMinutes > 0) {
    const lastMs = Date.parse(lastActionAt);
    if (Number.isFinite(lastMs)) {
      const elapsedMin = (Date.now() - lastMs) / 60_000;
      if (elapsedMin < policy.limits.cooldownMinutes) {
        codes.push('POLICY_COOLDOWN_ACTIVE');
      }
    }
  }
  // Window: businessHoursOnly check uses simple HH:MM compare on local time.
  if (policy.window.businessHoursOnly) {
    const [h, m] = proposal.businessHourLocal.split(':').map((s) => Number.parseInt(s, 10));
    const [startH, startM] = policy.window.activeFromLocal?.split(':').map((s) => Number.parseInt(s, 10)) ?? [9, 0];
    const [endH, endM] = policy.window.activeUntilLocal?.split(':').map((s) => Number.parseInt(s, 10)) ?? [18, 0];
    const nowMin = (h ?? 0) * 60 + (m ?? 0);
    const startMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;
    if (nowMin < startMin || nowMin > endMin) {
      codes.push('POLICY_WINDOW_INACTIVE');
    }
  }
  // Budget cap
  if (
    typeof policy.limits.budgetCapPerGrant === 'number' &&
    grantBudgetUsed + proposalImpact > policy.limits.budgetCapPerGrant
  ) {
    codes.push('POLICY_BUDGET_EXCEEDED');
  }

  return { eligible: codes.length === 0, failureCodes: codes };
}
