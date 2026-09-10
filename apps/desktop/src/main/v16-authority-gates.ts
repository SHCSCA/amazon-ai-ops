/**
 * V1.6 Authority Gates
 *
 * Per PRD §15.3.1, P0–P6 priority determines primary blocker and recovery
 * action — NOT which gates are skipped. All gates are AND'd.
 *
 * The three phase contracts from §15.3.2 are:
 *   - Grant issuance: scope/limits/evidence/policy/batch completeness
 *   - just-before-submit: P0–P6 + session + entity + current value + intent
 *   - post-submit readback: identity + before/after/reload proof (no submit)
 *
 * This module composes the gates from `v16-policy-version.evaluatePolicyGates`
 * with phase-specific extras (P2 context check, P6 evidence check) so each
 * phase can be evaluated atomically. It is intentionally framework-free —
 * the policy runtime, ExecutionService, and renderer compose it at the
 * trust boundary.
 *
 * @module v16-authority-gates
 */

import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  assertValidStoreContext,
  sameStoreContext,
} from './v16-store-context-guard';
import { GATE_PRIORITY_ORDER, GateCode, evaluatePolicyGates } from './v16-policy-version';
import type {
  ActionType,
  PolicyVersionRecord,
} from './v16-policy-version';

export type { GateCode } from './v16-policy-version';

export const AUTHORITY_GATE_PRIORITY_ORDER: readonly GateCode[] = GATE_PRIORITY_ORDER;

export interface PhaseGrantIssuanceInput {
  readonly phase: 'grant_issuance';
  readonly expectedBatchCompleteness: boolean;
  readonly expectedPolicyAuthorityRevision: number;
  readonly actualPolicyAuthorityRevision: number;
  readonly expectedModeRevision: number;
  readonly actualModeRevision: number;
  readonly policy: PolicyVersionRecord | null;
  readonly grantRemainingSlots: number;
  readonly entityId: string;
  readonly actionType: ActionType;
  /** True when every proposal in the batch has been individually validated. */
  readonly batchIndividuallyValidated: boolean;
}

export interface PhaseJustBeforeSubmitInput {
  readonly phase: 'just_before_submit';
  readonly ctx: StoreContextEnvelope;
  readonly currentCtx: StoreContextEnvelope;
  readonly adsIdentityMatches: boolean;
  readonly adsSessionLive: boolean;
  readonly expectedPolicyAuthorityRevision: number;
  readonly actualPolicyAuthorityRevision: number;
  readonly expectedActionRevision: number;
  readonly actualActionRevision: number;
  readonly policy: PolicyVersionRecord | null;
  readonly grantRemainingSlots: number;
  readonly entityId: string;
  readonly actionType: ActionType;
  /** True when before-screenshot, current value, and reload evidence are fresh. */
  readonly evidenceFresh: boolean;
  /** True when the expected-before current value matches the live page identity. */
  readonly expectedBeforeMatches: boolean;
  /** True when the unique intent id has not been seen before (no duplicate submit). */
  readonly uniqueIntent: boolean;
}

export interface PhasePostSubmitReadbackInput {
  readonly phase: 'post_submit_readback';
  readonly ctx: StoreContextEnvelope;
  readonly currentCtx: StoreContextEnvelope;
  readonly adsIdentityMatches: boolean;
  readonly adsSessionLive: boolean;
  readonly hasBeforeProof: boolean;
  readonly hasAfterProof: boolean;
  readonly hasReloadProof: boolean;
  /** True when readback value is structurally valid (verifier ran). */
  readonly readbackValueVerifiable: boolean;
}

export type AuthorityGateInput =
  | PhaseGrantIssuanceInput
  | PhaseJustBeforeSubmitInput
  | PhasePostSubmitReadbackInput;

export interface AuthorityGateResult {
  readonly passed: boolean;
  readonly blockedGates: GateCode[];
  readonly primaryBlocker: GateCode | null;
  readonly phase: AuthorityGateInput['phase'];
}

/**
 * Validate a phase input. Returns a list of failed gates; primaryBlocker is
 * the first failing gate in `AUTHORITY_GATE_PRIORITY_ORDER`.
 *
 * NOTE: post-submit readback never runs submission gates; the only relevant
 * failure there is context drift / identity mismatch / missing readback proof.
 */
export function evaluateAuthorityGates(input: AuthorityGateInput): AuthorityGateResult {
  if (input.phase === 'grant_issuance') {
    return evaluateGrantIssuance(input);
  }
  if (input.phase === 'just_before_submit') {
    return evaluateJustBeforeSubmit(input);
  }
  return evaluatePostSubmitReadback(input);
}

function evaluateGrantIssuance(input: PhaseGrantIssuanceInput): AuthorityGateResult {
  const blocked: GateCode[] = [];

  // P0 / P1 — sourced from the policy stops flags.
  if (input.policy?.stops?.killSwitchOn) blocked.push('P0_KILL_SWITCH');
  if (input.policy?.stops?.circuitBreakerTriggered) blocked.push('P1_CIRCUIT_BREAKER');

  // P2 — context mismatch applies at issuance only when current grant's
  // batch was assembled under a stale revision (i.e. authorityModeRevision
  // drift). The runtime enforces this; here we surface the gate.
  // (No envelope check at issuance — the runtime invariant guarantees it.)

  // P3 — revision match for both policy authority and mode revision.
  if (input.expectedPolicyAuthorityRevision !== input.actualPolicyAuthorityRevision) {
    blocked.push('P3_REVISION_MISMATCH');
  }
  if (input.expectedModeRevision !== input.actualModeRevision) {
    blocked.push('P3_REVISION_MISMATCH');
  }

  // P4 — grant residual authority (slot-based).
  if (input.grantRemainingSlots <= 0) blocked.push('P4_GRANT_INVALID');

  // P5 — scope (action/entity). Cooldown/daily/budget are runtime-tracked
  // at submission; we surface the gate but the runtime may resolve it.
  if (input.policy?.scope) {
    if (!input.policy.scope.actionTypes.includes(input.actionType)) {
      blocked.push('P5_SCOPE_MISMATCH');
    }
    const ids = input.policy.scope.entityIds ?? [];
    if (ids.length > 0 && !ids.includes(input.entityId)) {
      blocked.push('P5_SCOPE_MISMATCH');
    }
  }

  // P6 — issuance requires completeness + per-proposal validation.
  if (!input.expectedBatchCompleteness || !input.batchIndividuallyValidated) {
    blocked.push('P6_EVIDENCE_REQUIRED');
  }

  return composeResult(blocked, 'grant_issuance');
}

function evaluateJustBeforeSubmit(input: PhaseJustBeforeSubmitInput): AuthorityGateResult {
  // P2 — context / identity / session. Run store-context + identity checks
  // before the rest so P2 surfaces in priority order.
  let contextMismatch = false;
  try {
    assertValidStoreContext(input.currentCtx);
    if (!sameStoreContext(input.ctx, input.currentCtx)) {
      contextMismatch = true;
    }
  } catch {
    contextMismatch = true;
  }
  if (!input.adsSessionLive || !input.adsIdentityMatches) {
    contextMismatch = true;
  }

  // Use evaluatePolicyGates for P0/P1/P3/P4/P5/P6 — but augment P2 + P6 with
  // phase-specific checks (evidenceFresh + uniqueIntent).
  const base = evaluatePolicyGates({
    policy: input.policy,
    grantRemainingSlots: input.grantRemainingSlots,
    expectedRevision: input.expectedPolicyAuthorityRevision,
    actualRevision: input.actualPolicyAuthorityRevision,
    entityId: input.entityId,
    actionType: input.actionType,
    contextMismatch,
    evidenceMissing: !input.evidenceFresh || !input.expectedBeforeMatches || !input.uniqueIntent,
  });
  // Action revision mismatch → P3.
  if (input.expectedActionRevision !== input.actualActionRevision) {
    if (!base.blockedGates.includes('P3_REVISION_MISMATCH')) {
      base.blockedGates.push('P3_REVISION_MISMATCH');
    }
  }
  return composeResult(base.blockedGates, 'just_before_submit');
}

function evaluatePostSubmitReadback(input: PhasePostSubmitReadbackInput): AuthorityGateResult {
  const blocked: GateCode[] = [];
  // P2 — context / identity must still hold for readback to be trusted.
  let contextMismatch = false;
  try {
    assertValidStoreContext(input.currentCtx);
    if (!sameStoreContext(input.ctx, input.currentCtx)) {
      contextMismatch = true;
    }
  } catch {
    contextMismatch = true;
  }
  if (!input.adsSessionLive || !input.adsIdentityMatches) {
    contextMismatch = true;
  }
  if (contextMismatch) blocked.push('P2_CONTEXT_MISMATCH');
  // P6 — readback proof completeness.
  if (
    !input.hasBeforeProof ||
    !input.hasAfterProof ||
    !input.hasReloadProof ||
    !input.readbackValueVerifiable
  ) {
    blocked.push('P6_EVIDENCE_REQUIRED');
  }
  return composeResult(blocked, 'post_submit_readback');
}

function composeResult(blocked: GateCode[], phase: AuthorityGateInput['phase']): AuthorityGateResult {
  // Dedupe while preserving priority order.
  const seen = new Set<GateCode>();
  const ordered: GateCode[] = [];
  for (const code of AUTHORITY_GATE_PRIORITY_ORDER) {
    if (blocked.includes(code) && !seen.has(code)) {
      ordered.push(code);
      seen.add(code);
    }
  }
  let primaryBlocker: GateCode | null = null;
  for (const code of AUTHORITY_GATE_PRIORITY_ORDER) {
    if (ordered.includes(code)) {
      primaryBlocker = code;
      break;
    }
  }
  return {
    passed: ordered.length === 0,
    blockedGates: ordered,
    primaryBlocker,
    phase,
  };
}

/**
 * Recovery hint shown in the UI when a gate blocks. Keeps "all gates are AND"
 * in language — priority only selects which block to surface to the operator
 * (per PRD §15.3.1).
 */
export function describeRecoveryHint(result: AuthorityGateResult): string {
  if (result.passed) return 'all authority gates passed';
  const code = result.primaryBlocker ?? result.blockedGates[0];
  switch (code) {
    case 'P0_KILL_SWITCH':
      return 'Kill switch is on. Lift it to resume.';
    case 'P1_CIRCUIT_BREAKER':
      return 'Circuit breaker is open. Resolve and close it to resume.';
    case 'P2_CONTEXT_MISMATCH':
      return 'Store / Ads session / identity has drifted. Reconfirm before retry.';
    case 'P3_REVISION_MISMATCH':
      return 'Mode/policy/action revision has changed. Re-pull authority and retry.';
    case 'P4_GRANT_INVALID':
      return 'Grant has no residual authority. Re-issue a fresh Grant.';
    case 'P5_SCOPE_MISMATCH':
      return 'Action or entity is outside current policy scope.';
    case 'P6_EVIDENCE_REQUIRED':
      return 'Evidence is missing or stale. Capture fresh before/after/reload.';
    default:
      return 'Authority gate blocked (unknown).';
  }
}