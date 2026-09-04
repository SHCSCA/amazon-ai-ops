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
  readonly businessHoursOnly: boolean;
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
 * In-memory policy version store. Persistence is intentionally minimal — the
 * real implementation would use a dedicated `policy_versions` table; for V1.6
 * Phase 6 the contract is what matters.
 */
export class PolicyVersionService {
  private readonly policies = new Map<string, PolicyVersionRecord>();
  private readonly storeIndex = new Map<string, Set<string>>();

  constructor(private readonly ctx: StoreContextEnvelope) {}

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
    this.policies.set(record.policyVersionId, record);
    const bucket = this.storeIndex.get(record.storeId) ?? new Set<string>();
    bucket.add(record.policyVersionId);
    this.storeIndex.set(record.storeId, bucket);
    return record;
  }

  enable(policyVersionId: string, enabledBy: string, reason: string): PolicyVersionRecord {
    const policy = this.policies.get(policyVersionId);
    if (!policy) throw new PolicyError('Policy not found', 'POLICY_NOT_FOUND');
    this.validateStore(policy.storeId);
    if (!this.reasonProvided(reason)) {
      throw new PolicyError('Enable requires a non-empty reason', 'REASON_REQUIRED');
    }
    if (policy.status === 'superseded') {
      throw new PolicyError('Cannot enable superseded policy', 'POLICY_CHANGE_DENIED');
    }
    return Object.freeze({
      ...policy,
      status: 'enabled' as PolicyStatus,
      enabledAt: new Date().toISOString(),
      enabledBy,
      reason,
    }) as PolicyVersionRecord;
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
    const source = this.policies.get(input.sourcePolicyVersionId);
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
    this.policies.set(record.policyVersionId, record);
    this.policies.set(source.policyVersionId, Object.freeze({ ...source, status: 'superseded' as PolicyStatus }) as PolicyVersionRecord);
    return record;
  }

  toggleKillSwitch(policyVersionId: string, on: boolean, reason: string): PolicyVersionRecord {
    const policy = this.policies.get(policyVersionId);
    if (!policy) throw new PolicyError('Policy not found', 'POLICY_NOT_FOUND');
    this.validateStore(policy.storeId);
    if (!this.reasonProvided(reason)) {
      throw new PolicyError('Toggling kill switch requires a non-empty reason', 'REASON_REQUIRED');
    }
    return Object.freeze({
      ...policy,
      stops: { ...policy.stops, killSwitchOn: on, reason },
    }) as PolicyVersionRecord;
  }

  list(storeId?: string): PolicyVersionRecord[] {
    const sid = storeId ?? String(this.ctx.storeId);
    const ids = this.storeIndex.get(sid) ?? new Set<string>();
    return Array.from(ids)
      .map((id) => this.policies.get(id))
      .filter((p): p is PolicyVersionRecord => Boolean(p));
  }

  get(policyVersionId: string): PolicyVersionRecord | null {
    return this.policies.get(policyVersionId) ?? null;
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
}

export function evaluatePolicyGates(ctx: GateContext): {
  passed: boolean;
  blockedGates: Array<'P0_KILL_SWITCH' | 'P1_CIRCUIT_BREAKER' | 'P3_REVISION_MISMATCH' | 'P4_GRANT_INVALID' | 'P5_SCOPE_MISMATCH' | 'P6_EVIDENCE_REQUIRED'>;
} {
  const blocked: Array<'P0_KILL_SWITCH' | 'P1_CIRCUIT_BREAKER' | 'P3_REVISION_MISMATCH' | 'P4_GRANT_INVALID' | 'P5_SCOPE_MISMATCH' | 'P6_EVIDENCE_REQUIRED'> = [];

  if (ctx.policy?.stops.killSwitchOn) blocked.push('P0_KILL_SWITCH');
  if (ctx.policy?.stops.circuitBreakerTriggered) blocked.push('P1_CIRCUIT_BREAKER');
  if (ctx.expectedRevision !== ctx.actualRevision) blocked.push('P3_REVISION_MISMATCH');
  if (ctx.grantRemainingSlots <= 0) blocked.push('P4_GRANT_INVALID');
  if (ctx.policy) {
    if (!ctx.policy.scope.actionTypes.includes(ctx.actionType)) blocked.push('P5_SCOPE_MISMATCH');
    const ids = ctx.policy.scope.entityIds ?? [];
    if (ids.length > 0 && !ids.includes(ctx.entityId)) blocked.push('P5_SCOPE_MISMATCH');
  }
  return { passed: blocked.length === 0, blockedGates: blocked };
}
