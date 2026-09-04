/**
 * V1.6 MissionGrant Service
 *
 * Business logic for immutable authorization grants:
 * - issue (validate decisions belong to context + non-empty reason)
 * - append lifecycle events (issued -> active -> partially_consumed -> fully_consumed/expired/revoked/invalidated)
 * - reserve / spend / release slots
 * - derive residual authority for execution preflight
 *
 * @module v16-mission-grant-service
 */

import type {
  GrantIssuer,
  GrantStatus,
  MissionGrantRecord,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type {
  MissionGrantRepository,
  MissionGrantRow,
} from '@amazon-ai-ops/local-db/src/sqlite/repositories/v16-domain-repositories';

export class MissionGrantServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'STORE_MISMATCH'
      | 'GRANT_NOT_FOUND'
      | 'INVALID_TRANSITION'
      | 'TERMINAL_STATE'
      | 'REASON_REQUIRED'
      | 'SLOT_LIMIT_EXCEEDED'
      | 'GRANT_EXPIRED'
      | 'GRANT_REVOKED'
      | 'DECISION_NOT_APPROVED',
  ) {
    super(message);
    this.name = 'MissionGrantServiceError';
  }
}

export interface IssueGrantInput {
  storeContext: StoreContextEnvelope;
  missionId: string;
  missionRevision: number;
  decisionIds: string[];
  issuer: GrantIssuer;
  issuedBy: string;
  scope: MissionGrantRecord['scope'];
  limits: MissionGrantRecord['limits'];
  evidenceRequirement: MissionGrantRecord['evidenceRequirement'];
  expiresAt?: string;
  sessionGeneration?: number;
  adsAccountId?: string;
  reason: string;
}

export interface ReserveSlotInput {
  storeContext: StoreContextEnvelope;
  grantId: string;
  decisionId: string;
  slotIndex: number;
}

export interface ResidualAuthority {
  grantId: string;
  storeId: string;
  status: GrantStatus;
  totalSlots: number;
  usedSlots: number;
  remainingSlots: number;
  scope: MissionGrantRecord['scope'];
  limits: MissionGrantRecord['limits'];
  evidenceRequirement: MissionGrantRecord['evidenceRequirement'];
  isUsable: boolean;
  reason: string;
}

function validateStoreContext(grant: MissionGrantRow, ctx: StoreContextEnvelope): void {
  if (grant.store_id !== String(ctx.storeId)) {
    throw new MissionGrantServiceError(
      'Cannot operate on grant from different store',
      'STORE_MISMATCH',
    );
  }
}

function isTerminalGrant(status: GrantStatus): boolean {
  return status === 'fully_consumed' || status === 'expired' || status === 'revoked' || status === 'invalidated';
}

function generateGrantId(): string {
  return `grant_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateEventId(): string {
  return `gevt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function rowToRecord(row: MissionGrantRow): MissionGrantRecord {
  return {
    grantId: row.grant_id,
    storeId: row.store_id,
    missionId: row.mission_id,
    missionRevision: row.mission_revision,
    decisionIds: JSON.parse(row.decision_ids),
    issuer: row.issuer as GrantIssuer,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at ?? undefined,
    issuedBy: row.issued_by,
    scope: JSON.parse(row.scope_json),
    limits: JSON.parse(row.limits_json),
    evidenceRequirement: JSON.parse(row.evidence_json),
    sessionGeneration: row.session_generation ?? undefined,
    adsAccountId: row.ads_account_id ?? undefined,
    status: row.status as GrantStatus,
    usedSlots: row.used_slots,
    consumedAt: row.consumed_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    revokedBy: row.revoked_by ?? undefined,
    revocationReason: row.revocation_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reason: row.reason,
  };
}

/**
 * MissionGrantService — immutable grant lifecycle and slot bookkeeping.
 */
export class MissionGrantService {
  constructor(private readonly repo: MissionGrantRepository) {}

  issue(input: IssueGrantInput): MissionGrantRecord {
    if (!input.reason?.trim()) {
      throw new MissionGrantServiceError('Grant issuance requires a non-empty reason', 'REASON_REQUIRED');
    }
    if (input.decisionIds.length === 0) {
      throw new MissionGrantServiceError('Grant must authorize at least one decision', 'REASON_REQUIRED');
    }
    if (input.limits.maxSlots <= 0) {
      throw new MissionGrantServiceError('Grant maxSlots must be positive', 'SLOT_LIMIT_EXCEEDED');
    }

    const now = new Date().toISOString();
    const row: MissionGrantRow = {
      grant_id: generateGrantId(),
      store_id: String(input.storeContext.storeId),
      mission_id: input.missionId,
      mission_revision: input.missionRevision,
      decision_ids: JSON.stringify(input.decisionIds),
      issuer: input.issuer,
      issued_at: now,
      expires_at: input.expiresAt ?? null,
      issued_by: input.issuedBy,
      scope_json: JSON.stringify(input.scope),
      limits_json: JSON.stringify(input.limits),
      evidence_json: JSON.stringify(input.evidenceRequirement),
      session_generation: input.sessionGeneration ?? null,
      ads_account_id: input.adsAccountId ?? null,
      status: 'active',
      used_slots: 0,
      consumed_at: null,
      revoked_at: null,
      revoked_by: null,
      revocation_reason: null,
      created_at: now,
      updated_at: now,
      reason: input.reason,
      metadata: null,
    };

    const created = this.repo.create(row);
    this.repo.appendLifecycleEvent({
      event_id: generateEventId(),
      grant_id: created.grant_id,
      event_type: 'issued',
      timestamp: now,
    });
    return rowToRecord(created);
  }

  getGrant(params: { storeContext: StoreContextEnvelope; grantId: string }): MissionGrantRecord | null {
    const row = this.repo.findById(params.grantId);
    if (!row) return null;
    validateStoreContext(row, params.storeContext);
    return rowToRecord(row);
  }

  listGrants(params: {
    storeContext: StoreContextEnvelope;
    activeOnly?: boolean;
    limit?: number;
  }): MissionGrantRecord[] {
    const storeId = String(params.storeContext.storeId);
    const rows = params.activeOnly
      ? this.repo.findActiveByStore(storeId)
      : this.repo.findByStoreId(storeId, params.limit ?? 50);
    return rows.map(rowToRecord);
  }

  /**
   * Reserve a slot before submit. Slot must be within limits.
   * Increments used_slots and flips to partially_consumed if not yet set.
   */
  reserveSlot(input: ReserveSlotInput): MissionGrantRecord | null {
    const row = this.repo.findById(input.grantId);
    if (!row) return null;
    validateStoreContext(row, input.storeContext);
    const status = row.status as GrantStatus;
    if (status === 'expired') {
      throw new MissionGrantServiceError('Cannot reserve slot on expired grant', 'GRANT_EXPIRED');
    }
    if (status === 'revoked') {
      throw new MissionGrantServiceError('Cannot reserve slot on revoked grant', 'GRANT_REVOKED');
    }
    if (isTerminalGrant(status) && status !== 'partially_consumed') {
      throw new MissionGrantServiceError(
        `Cannot reserve slot on terminal grant (${status})`,
        'TERMINAL_STATE',
      );
    }
    const limits = JSON.parse(row.limits_json) as MissionGrantRecord['limits'];
    if (row.used_slots >= limits.maxSlots) {
      throw new MissionGrantServiceError(
        `Grant slot limit exceeded (${row.used_slots}/${limits.maxSlots})`,
        'SLOT_LIMIT_EXCEEDED',
      );
    }

    const now = new Date().toISOString();
    const newUsed = row.used_slots + 1;
    const newStatus: GrantStatus = newUsed >= limits.maxSlots ? 'fully_consumed' : 'partially_consumed';
    const updated = this.repo.update(input.grantId, {
      used_slots: newUsed,
      status: newStatus,
      consumed_at: newStatus === 'fully_consumed' ? now : row.consumed_at,
    });
    if (!updated) return null;
    this.repo.appendLifecycleEvent({
      event_id: generateEventId(),
      grant_id: input.grantId,
      event_type: 'slot_reserved',
      timestamp: now,
      slot_index: input.slotIndex,
    });
    if (newStatus === 'fully_consumed') {
      this.repo.appendLifecycleEvent({
        event_id: generateEventId(),
        grant_id: input.grantId,
        event_type: 'consumed',
        timestamp: now,
      });
    }
    return rowToRecord(updated);
  }

  /**
   * Release a slot back to the grant (e.g., execution preflight failed and slot not used).
   */
  releaseSlot(params: { storeContext: StoreContextEnvelope; grantId: string; slotIndex: number; reason: string }): MissionGrantRecord | null {
    const row = this.repo.findById(params.grantId);
    if (!row) return null;
    validateStoreContext(row, params.storeContext);
    if (row.used_slots <= 0) return rowToRecord(row);
    const now = new Date().toISOString();
    const newUsed = row.used_slots - 1;
    const newStatus: GrantStatus = newUsed === 0 ? 'active' : 'partially_consumed';
    const updated = this.repo.update(params.grantId, {
      used_slots: newUsed,
      status: newStatus,
    });
    if (!updated) return null;
    this.repo.appendLifecycleEvent({
      event_id: generateEventId(),
      grant_id: params.grantId,
      event_type: 'slot_released',
      timestamp: now,
      slot_index: params.slotIndex,
      metadata: JSON.stringify({ reason: params.reason }),
    });
    return rowToRecord(updated);
  }

  revoke(params: { storeContext: StoreContextEnvelope; grantId: string; revokedBy: string; reason: string }): MissionGrantRecord | null {
    const row = this.repo.findById(params.grantId);
    if (!row) return null;
    validateStoreContext(row, params.storeContext);
    const status = row.status as GrantStatus;
    if (status === 'revoked') return rowToRecord(row);
    if (isTerminalGrant(status)) {
      throw new MissionGrantServiceError(
        `Cannot revoke terminal grant (${status})`,
        'TERMINAL_STATE',
      );
    }
    if (!params.reason?.trim()) {
      throw new MissionGrantServiceError('Revocation requires a non-empty reason', 'REASON_REQUIRED');
    }
    const now = new Date().toISOString();
    const updated = this.repo.update(params.grantId, {
      status: 'revoked',
      revoked_at: now,
      revoked_by: params.revokedBy,
      revocation_reason: params.reason,
    });
    if (!updated) return null;
    this.repo.appendLifecycleEvent({
      event_id: generateEventId(),
      grant_id: params.grantId,
      event_type: 'revoked',
      timestamp: now,
      metadata: JSON.stringify({ reason: params.reason, revokedBy: params.revokedBy }),
    });
    return rowToRecord(updated);
  }

  invalidate(params: { storeContext: StoreContextEnvelope; grantId: string; reason: string }): MissionGrantRecord | null {
    const row = this.repo.findById(params.grantId);
    if (!row) return null;
    validateStoreContext(row, params.storeContext);
    const status = row.status as GrantStatus;
    if (isTerminalGrant(status)) return rowToRecord(row);
    const now = new Date().toISOString();
    const updated = this.repo.update(params.grantId, { status: 'invalidated' });
    if (!updated) return null;
    this.repo.appendLifecycleEvent({
      event_id: generateEventId(),
      grant_id: params.grantId,
      event_type: 'invalidated',
      timestamp: now,
      metadata: JSON.stringify({ reason: params.reason }),
    });
    return rowToRecord(updated);
  }

  /**
   * Compute residual authority for execution preflight.
   * Used by ExecutionService before submit.
   */
  deriveResidualAuthority(params: { storeContext: StoreContextEnvelope; grantId: string }): ResidualAuthority | null {
    const record = this.getGrant({ storeContext: params.storeContext, grantId: params.grantId });
    if (!record) return null;

    let isUsable = true;
    let reason = 'Grant is active';

    if (record.status === 'expired') {
      isUsable = false;
      reason = 'Grant expired';
    } else if (record.status === 'revoked' || record.status === 'invalidated') {
      isUsable = false;
      reason = `Grant ${record.status}`;
    } else if (record.status === 'fully_consumed') {
      isUsable = false;
      reason = 'Grant fully consumed';
    } else if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
      isUsable = false;
      reason = 'Grant past expiry';
    }

    const remaining = record.limits.maxSlots - record.usedSlots;

    return {
      grantId: record.grantId,
      storeId: record.storeId,
      status: record.status,
      totalSlots: record.limits.maxSlots,
      usedSlots: record.usedSlots,
      remainingSlots: Math.max(0, remaining),
      scope: record.scope,
      limits: record.limits,
      evidenceRequirement: record.evidenceRequirement,
      isUsable,
      reason,
    };
  }

  getLifecycleEvents(params: { storeContext: StoreContextEnvelope; grantId: string }) {
    const row = this.repo.findById(params.grantId);
    if (!row) return [];
    validateStoreContext(row, params.storeContext);
    return this.repo.getLifecycleEvents(params.grantId);
  }
}
