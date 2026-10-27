// 各领域仓储保留各自原数据库连接与事务边界。
import type Database from 'better-sqlite3';

export interface PolicyVersionRow {
    readonly policy_version_id: string;
    readonly store_id: string;
    readonly mode: string;
    readonly status: string;
    readonly revision: number;
    readonly scope_json: string;
    readonly limits_json: string;
    readonly window_json: string;
    readonly evidence_json: string;
    readonly stops_json: string;
    readonly created_at: string;
    readonly enabled_at: string | null;
    readonly disabled_at: string | null;
    readonly enabled_by: string | null;
    readonly reason: string;
    readonly supersedes_policy_version_id: string | null;
}

export interface ModeChangeLogRow {
    readonly audit_id: string;
    readonly store_id: string;
    readonly from_mode: string | null;
    readonly to_mode: string;
    readonly authority_mode_revision_before: number;
    readonly authority_mode_revision_after: number;
    readonly previous_policy_version_id: string | null;
    readonly active_policy_version_id: string | null;
    readonly reason: string;
    readonly actor: string;
    readonly changed_at: string;
    readonly context_snapshot_json: string;
}

export interface AuthorityInvalidationRow {
    readonly invalidation_id: string;
    readonly store_id: string;
    readonly authority_mode_revision: number;
    readonly invalidates_grant_ids_json: string;
    readonly invalidates_batch_ids_json: string;
    readonly invalidates_slot_ids_json: string;
    readonly reason: string;
    readonly created_at: string;
    readonly terminal: number;
}

export class PolicyVersionRepository {
    constructor(private readonly db: Database.Database) { }
    upsertPolicyVersion(row: PolicyVersionRow): PolicyVersionRow {
        this.db.prepare(`
      INSERT INTO policy_versions_v16 (
        policy_version_id, store_id, mode, status, revision,
        scope_json, limits_json, window_json, evidence_json, stops_json,
        created_at, enabled_at, disabled_at, enabled_by, reason, supersedes_policy_version_id
      ) VALUES (
        @policy_version_id, @store_id, @mode, @status, @revision,
        @scope_json, @limits_json, @window_json, @evidence_json, @stops_json,
        @created_at, @enabled_at, @disabled_at, @enabled_by, @reason, @supersedes_policy_version_id
      )
      ON CONFLICT(policy_version_id) DO UPDATE SET
        status = excluded.status,
        enabled_at = excluded.enabled_at,
        disabled_at = excluded.disabled_at,
        enabled_by = excluded.enabled_by,
        reason = excluded.reason
    `).run({
            policy_version_id: row.policy_version_id,
            store_id: row.store_id,
            mode: row.mode,
            status: row.status,
            revision: row.revision,
            scope_json: row.scope_json,
            limits_json: row.limits_json,
            window_json: row.window_json,
            evidence_json: row.evidence_json,
            stops_json: row.stops_json,
            created_at: row.created_at,
            enabled_at: row.enabled_at ?? null,
            disabled_at: row.disabled_at ?? null,
            enabled_by: row.enabled_by ?? null,
            reason: row.reason,
            supersedes_policy_version_id: row.supersedes_policy_version_id ?? null,
        });
        return row;
    }
    findById(policyVersionId: string): PolicyVersionRow | null {
        const row = this.db.prepare(`SELECT * FROM policy_versions_v16 WHERE policy_version_id = ?`).get(policyVersionId);
        return (row as PolicyVersionRow | undefined) ?? null;
    }
    findByStore(storeId: string, limit = 50): PolicyVersionRow[] {
        return this.db.prepare(`
      SELECT * FROM policy_versions_v16
      WHERE store_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(storeId, limit) as PolicyVersionRow[];
    }
    findEnabledByStore(storeId: string): PolicyVersionRow | null {
        const row = this.db.prepare(`
      SELECT * FROM policy_versions_v16
      WHERE store_id = ? AND status = 'enabled'
      ORDER BY revision DESC
      LIMIT 1
    `).get(storeId);
        return (row as PolicyVersionRow | undefined) ?? null;
    }
    insertModeChangeLog(row: ModeChangeLogRow): ModeChangeLogRow {
        this.db.prepare(`
      INSERT INTO mode_change_log_v16 (
        audit_id, store_id, from_mode, to_mode,
        authority_mode_revision_before, authority_mode_revision_after,
        previous_policy_version_id, active_policy_version_id,
        reason, actor, changed_at, context_snapshot_json
      ) VALUES (
        @audit_id, @store_id, @from_mode, @to_mode,
        @authority_mode_revision_before, @authority_mode_revision_after,
        @previous_policy_version_id, @active_policy_version_id,
        @reason, @actor, @changed_at, @context_snapshot_json
      )
    `).run({
            audit_id: row.audit_id,
            store_id: row.store_id,
            from_mode: row.from_mode ?? null,
            to_mode: row.to_mode,
            authority_mode_revision_before: row.authority_mode_revision_before,
            authority_mode_revision_after: row.authority_mode_revision_after,
            previous_policy_version_id: row.previous_policy_version_id ?? null,
            active_policy_version_id: row.active_policy_version_id ?? null,
            reason: row.reason,
            actor: row.actor,
            changed_at: row.changed_at,
            context_snapshot_json: row.context_snapshot_json,
        });
        return row;
    }
    getModeChangeLog(storeId: string): ModeChangeLogRow[] {
        return this.db.prepare(`
      SELECT * FROM mode_change_log_v16
      WHERE store_id = ?
      ORDER BY changed_at ASC
    `).all(storeId) as ModeChangeLogRow[];
    }
    insertAuthorityInvalidation(row: AuthorityInvalidationRow): AuthorityInvalidationRow {
        this.db.prepare(`
      INSERT INTO authority_invalidation_v16 (
        invalidation_id, store_id, authority_mode_revision,
        invalidates_grant_ids_json, invalidates_batch_ids_json, invalidates_slot_ids_json,
        reason, created_at, terminal
      ) VALUES (
        @invalidation_id, @store_id, @authority_mode_revision,
        @invalidates_grant_ids_json, @invalidates_batch_ids_json, @invalidates_slot_ids_json,
        @reason, @created_at, @terminal
      )
    `).run({
            invalidation_id: row.invalidation_id,
            store_id: row.store_id,
            authority_mode_revision: row.authority_mode_revision,
            invalidates_grant_ids_json: row.invalidates_grant_ids_json,
            invalidates_batch_ids_json: row.invalidates_batch_ids_json,
            invalidates_slot_ids_json: row.invalidates_slot_ids_json,
            reason: row.reason,
            created_at: row.created_at,
            terminal: row.terminal,
        });
        return row;
    }
    getAuthorityInvalidations(storeId: string): AuthorityInvalidationRow[] {
        return this.db.prepare(`
      SELECT * FROM authority_invalidation_v16
      WHERE store_id = ?
      ORDER BY created_at ASC
    `).all(storeId) as AuthorityInvalidationRow[];
    }
    getCurrentAuthorityRevision(storeId: string): number {
        const row = this.db.prepare(`
      SELECT authority_mode_revision_after
      FROM mode_change_log_v16
      WHERE store_id = ?
      ORDER BY changed_at DESC
      LIMIT 1
    `).get(storeId) as {
            authority_mode_revision_after: number;
        } | undefined;
        return row?.authority_mode_revision_after ?? 0;
    }
}
