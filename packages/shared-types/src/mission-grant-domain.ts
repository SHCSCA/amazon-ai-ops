/**
 * MissionGrant Domain Model
 *
 * Represents an immutable authorization grant for executing actions.
 * A grant is issued after approval and defines what actions can be executed,
 * with what limits, and for how long.
 *
 * @module mission-grant-domain
 */

import { normalizeStoreContextEnvelope, type StoreContextEnvelope } from './store';

/**
 * Grant issuer type
 */
export type GrantIssuer = 'human_operator' | 'policy_runtime';

/**
 * Grant status
 */
export type GrantStatus =
  | 'issued'              // Grant created
  | 'active'             // Grant is valid and can be used
  | 'partially_consumed' // Some slots used, some remaining
  | 'fully_consumed'     // All slots used
  | 'expired'            // Past expiry time
  | 'revoked'            // Explicitly revoked by operator
  | 'invalidated';       // Invalidated by context change (e.g., store switch)

/**
 * Grant scope - what this grant authorizes
 */
export interface GrantScope {
  readonly entityIds: string[];          // Which entities are authorized
  readonly actionType: string;           // e.g., 'adjust_keyword_bid'
  readonly maxChangePercent?: number;    // e.g., 10 = max 10% change
  readonly maxAbsoluteChange?: number;    // e.g., 0.50 = max $0.50 bid change
  readonly currency: string;              // Fixed: USD
}

/**
 * Grant limits
 */
export interface GrantLimits {
  readonly maxSlots: number;              // Max number of actions
  readonly maxBudget?: number;            // Max total budget impact (USD)
  readonly dailyCount?: number;           // Max actions per day
  readonly cooldownMinutes?: number;      // Min time between actions
}

/**
 * Grant evidence requirement
 */
export interface GrantEvidenceRequirement {
  readonly requiresBeforeScreenshot: boolean;
  readonly requiresAfterScreenshot: boolean;
  readonly requiresReloadScreenshot: boolean;
  readonly requiresValueReadback: boolean;
}

/**
 * MissionGrant record schema (immutable)
 */
export interface MissionGrantRecord {
  readonly grantId: string;
  readonly storeId: string;

  // Provenance
  readonly missionId: string;
  readonly missionRevision: number;
  readonly decisionIds: string[];         // Decisions that led to this grant

  // Authorization
  readonly issuer: GrantIssuer;
  readonly issuedAt: string;
  readonly expiresAt?: string;            // Optional expiry
  readonly issuedBy: string;             // Operator or policy name

  // Scope and limits
  readonly scope: GrantScope;
  readonly limits: GrantLimits;

  // Evidence requirements
  readonly evidenceRequirement: GrantEvidenceRequirement;

  // Context binding (Phase 5: prevent stale grants)
  readonly sessionGeneration: number;     // Store session when issued
  readonly contextSnapshot: StoreContextEnvelope;
  readonly adsAccountId?: string;         // Ads account ID for additional binding

  // Status and consumption
  readonly status: GrantStatus;
  readonly usedSlots: number;
  readonly consumedAt?: string;
  readonly revokedAt?: string;
  readonly revokedBy?: string;
  readonly revocationReason?: string;

  // Timestamps
  readonly createdAt: string;
  readonly updatedAt: string;

  // Metadata
  readonly reason: string;                // Human-readable authorization reason
  readonly metadata?: Record<string, unknown>;
}

/**
 * Grant lifecycle event (append-only)
 */
export interface GrantLifecycleEvent {
  readonly eventId: string;
  readonly grantId: string;
  readonly eventType: GrantLifecycleEventType;
  readonly timestamp: string;
  readonly slotIndex?: number;
  readonly executionId?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Grant lifecycle event types
 */
export type GrantLifecycleEventType =
  | 'issued'
  | 'slot_reserved'
  | 'slot_consumed'
  | 'expired'
  | 'revoked'
  | 'invalidated';

/**
 * Grant creation input
 */
export interface CreateGrantInput {
  storeId: string;
  missionId: string;
  missionRevision: number;
  decisionIds: string[];
  issuer: GrantIssuer;
  issuedBy: string;
  scope: GrantScope;
  limits: GrantLimits;
  evidenceRequirement: GrantEvidenceRequirement;
  expiresAt?: string;
  sessionGeneration: number;
  contextSnapshot: StoreContextEnvelope;
  adsAccountId?: string;
  reason: string;
}

/**
 * Slot reservation for execution
 */
export interface GrantSlotReservation {
  readonly grantId: string;
  readonly slotIndex: number;
  readonly entityId: string;
  readonly actionType: string;
  readonly reservedAt: string;
  readonly expiresAt: string;
}

/**
 * Residual authority calculation
 */
export interface ResidualAuthority {
  readonly grantId: string;
  readonly remainingSlots: number;
  readonly remainingBudget?: number;
  readonly expiresAt?: string;
  readonly isValid: boolean;
  readonly invalidReason?: string;
}

/**
 * Status labels for display
 */
export const GRANT_STATUS_LABELS: Record<GrantStatus, string> = {
  issued: '已签发',
  active: '有效',
  partially_consumed: '部分使用',
  fully_consumed: '已用尽',
  expired: '已过期',
  revoked: '已撤销',
  invalidated: '已失效',
};

/**
 * Calculate residual authority from grant
 */
export function calculateResidualAuthority(grant: MissionGrantRecord): ResidualAuthority {
  const now = Date.now();
  const expiresAtMs = grant.expiresAt ? new Date(grant.expiresAt).getTime() : null;

  // Check if expired
  if (expiresAtMs && now > expiresAtMs) {
    return {
      grantId: grant.grantId,
      remainingSlots: 0,
      remainingBudget: undefined,
      expiresAt: grant.expiresAt,
      isValid: false,
      invalidReason: '已过期',
    };
  }

  // Check if fully consumed
  if (grant.status === 'fully_consumed') {
    return {
      grantId: grant.grantId,
      remainingSlots: 0,
      remainingBudget: undefined,
      expiresAt: grant.expiresAt,
      isValid: false,
      invalidReason: '已用尽',
    };
  }

  // Check if revoked/invalidated
  if (grant.status === 'revoked' || grant.status === 'invalidated') {
    return {
      grantId: grant.grantId,
      remainingSlots: 0,
      remainingBudget: undefined,
      expiresAt: grant.expiresAt,
      isValid: false,
      invalidReason: grant.status === 'revoked' ? '已撤销' : '已失效',
    };
  }

  // Calculate remaining slots
  const remainingSlots = grant.limits.maxSlots - grant.usedSlots;

  return {
    grantId: grant.grantId,
    remainingSlots,
    remainingBudget: grant.limits.maxBudget,
    expiresAt: grant.expiresAt,
    isValid: remainingSlots > 0,
    invalidReason: remainingSlots <= 0 ? '无可用配额' : undefined,
  };
}

/**
 * Validate mission grant record
 */
export function validateMissionGrantRecord(grant: MissionGrantRecord): void {
  if (!grant.grantId || grant.grantId.trim() === '') {
    throw new Error('Grant ID is required');
  }
  if (!grant.storeId || grant.storeId.trim() === '') {
    throw new Error('Store ID is required');
  }
  if (!grant.missionId || grant.missionId.trim() === '') {
    throw new Error('Mission ID is required');
  }
  if (!Array.isArray(grant.decisionIds)) {
    throw new Error('Decision IDs must be an array');
  }
  if (!grant.issuer) {
    throw new Error('Issuer is required');
  }
  if (!grant.issuedAt) {
    throw new Error('Issued timestamp is required');
  }
  if (!grant.issuedBy || grant.issuedBy.trim() === '') {
    throw new Error('Issued by is required');
  }
  if (!grant.scope) {
    throw new Error('Scope is required');
  }
  if (!grant.limits) {
    throw new Error('Limits are required');
  }
  if (!grant.evidenceRequirement) {
    throw new Error('Evidence requirement is required');
  }
  if (!grant.reason || grant.reason.trim() === '') {
    throw new Error('Reason is required');
  }

  // Validate currency
  if (grant.scope.currency !== 'USD') {
    throw new Error('Only USD currency is supported');
  }

  // Validate timestamps
  const issuedAt = new Date(grant.issuedAt).getTime();
  if (isNaN(issuedAt)) {
    throw new Error('Invalid issued timestamp');
  }

  if (grant.expiresAt) {
    const expiresAt = new Date(grant.expiresAt).getTime();
    if (isNaN(expiresAt)) {
      throw new Error('Invalid expires timestamp');
    }
    if (expiresAt <= issuedAt) {
      throw new Error('Expires timestamp must be after issued timestamp');
    }
  }

  // Validate limits
  if (grant.limits.maxSlots <= 0) {
    throw new Error('Max slots must be positive');
  }
  if (grant.usedSlots < 0 || grant.usedSlots > grant.limits.maxSlots) {
    throw new Error('Used slots must be between 0 and max slots');
  }
}

/**
 * Validate create grant input
 */
export function validateCreateGrantInput(input: CreateGrantInput): void {
  if (!input.storeId || input.storeId.trim() === '') {
    throw new Error('Store ID is required');
  }
  if (!input.missionId || input.missionId.trim() === '') {
    throw new Error('Mission ID is required');
  }
  if (!Array.isArray(input.decisionIds)) {
    throw new Error('Decision IDs must be an array');
  }
  if (!input.issuer) {
    throw new Error('Issuer is required');
  }
  if (!input.issuedBy || input.issuedBy.trim() === '') {
    throw new Error('Issued by is required');
  }
  if (!input.scope) {
    throw new Error('Scope is required');
  }
  if (!input.limits) {
    throw new Error('Limits are required');
  }
  if (!input.evidenceRequirement) {
    throw new Error('Evidence requirement is required');
  }
  if (!input.reason || input.reason.trim() === '') {
    throw new Error('Reason is required');
  }
  if (input.scope.currency !== 'USD') {
    throw new Error('Only USD currency is supported');
  }
  if (input.limits.maxSlots <= 0) {
    throw new Error('Max slots must be positive');
  }
}

/**
 * Build mission grant record
 */
export function buildMissionGrantRecord(
  grantId: string,
  input: CreateGrantInput
): MissionGrantRecord {
  validateCreateGrantInput(input);
  const contextSnapshot = normalizeStoreContextEnvelope(input.contextSnapshot);
  if (contextSnapshot.storeId !== input.storeId || contextSnapshot.sessionGeneration !== input.sessionGeneration) throw new Error('Grant context mismatch');
  const now = new Date().toISOString();
  return {
    contextSnapshot,
    grantId,
    storeId: input.storeId,
    missionId: input.missionId,
    missionRevision: input.missionRevision,
    decisionIds: input.decisionIds,
    issuer: input.issuer,
    issuedAt: now,
    expiresAt: input.expiresAt,
    issuedBy: input.issuedBy,
    scope: input.scope,
    limits: input.limits,
    evidenceRequirement: input.evidenceRequirement,
    sessionGeneration: input.sessionGeneration,
    adsAccountId: input.adsAccountId,
    status: 'issued',
    usedSlots: 0,
    createdAt: now,
    updatedAt: now,
    reason: input.reason,
  };
}

/**
 * Build grant lifecycle event
 */
export function buildGrantLifecycleEvent(params: {
  eventId: string;
  grantId: string;
  eventType: GrantLifecycleEventType;
  slotIndex?: number;
  executionId?: string;
  metadata?: Record<string, unknown>;
}): GrantLifecycleEvent {
  const now = new Date().toISOString();
  
  return {
    eventId: params.eventId,
    grantId: params.grantId,
    eventType: params.eventType,
    timestamp: now,
    slotIndex: params.slotIndex,
    executionId: params.executionId,
    metadata: params.metadata,
  };
}

/**
 * Check if grant is terminal (cannot be used)
 */
export function isGrantTerminal(status: GrantStatus): boolean {
  return ['fully_consumed', 'expired', 'revoked', 'invalidated'].includes(status);
}

/**
 * Check if grant can reserve slots
 */
export function canReserveSlot(grant: MissionGrantRecord): boolean {
  if (isGrantTerminal(grant.status)) {
    return false;
  }

  const residual = calculateResidualAuthority(grant);
  return residual.isValid && residual.remainingSlots > 0;
}
