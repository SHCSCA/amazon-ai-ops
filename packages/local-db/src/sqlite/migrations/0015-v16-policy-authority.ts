/**
 * Migration 0015: V1.6 Policy Versioning & Authority Mode Tracking
 *
 * Phase 6: Tables for the policy / automation boundary system.
 *   - policy_versions_v16: every PolicyVersionRecord (draft / enabled / superseded)
 *   - mode_change_log_v16: every mode/policy change with reason + CAS metadata
 *   - authority_invalidation_v16: terminal invalidations of pending Grants/Batches/Slots
 *
 * Every change is append-only; the schema mirrors the in-memory store used
 * by `v16-policy-runtime.ts`. `expected_authority_mode_revision` is the CAS
 * value the runtime sends; `authority_mode_revision_after` is what the runtime
 * stamped. Equality implies the change took effect under expected revision.
 *
 * @module 0015-v16-policy-authority
 */

import type Database from 'better-sqlite3';
import { prepareUpgradeBackup } from './upgrade-backup';
import type { UpgradeBackupManifest } from './types';

export const POLICY_AUTHORITY_MIGRATION_VERSION = 15;
export const POLICY_AUTHORITY_MIGRATION_NAME = 'v16-policy-authority-v15';
export const POLICY_AUTHORITY_MIGRATION_CHECKSUM = 'v16-policy-authority-v15-20260904-01';

export const POLICY_AUTHORITY_TABLES = [
  'policy_versions_v16',
  'mode_change_log_v16',
  'authority_invalidation_v16',
] as const;

export class PolicyAuthorityMigrationError extends Error {
  readonly version = POLICY_AUTHORITY_MIGRATION_VERSION;
  constructor(message: string) {
    super(message);
    this.name = 'PolicyAuthorityMigrationError';
  }
}

export interface PolicyAuthorityMigrationResult {
  version: number;
  status: 'started' | 'applied' | 'failed' | 'skipped';
  startedAt: string;
  finishedAt?: string;
  createdTables: number;
  errorMessage?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function assertPrerequisites(database: Database.Database): void {
  const row = database
    .prepare(`SELECT status FROM schema_migrations WHERE version = ?`)
    .get(14) as { status: string } | undefined;
  if (!row) {
    throw new PolicyAuthorityMigrationError('Migration 14 must be applied first');
  }
  if (row.status !== 'applied') {
    throw new PolicyAuthorityMigrationError(
      `Migration 14 status is "${row.status}", expected "applied"`,
    );
  }
}

function readMigration(database: Database.Database): { status: string; checksum: string; result_json: string | null } | undefined {
  return database
    .prepare(`SELECT status, checksum, result_json FROM schema_migrations WHERE version = ?`)
    .get(POLICY_AUTHORITY_MIGRATION_VERSION) as { status: string; checksum: string; result_json: string | null } | undefined;
}

function parseResult(json: string | null): PolicyAuthorityMigrationResult | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as PolicyAuthorityMigrationResult;
  } catch {
    return null;
  }
}

function installSchema(database: Database.Database): void {
  // policy_versions_v16 — one row per PolicyVersionRecord (immutable; new
  // edits create a new supersedes version).
  database.exec(`
    CREATE TABLE IF NOT EXISTS policy_versions_v16 (
      policy_version_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('manual_approval', 'policy_auto')),
      status TEXT NOT NULL CHECK (status IN ('draft', 'enabled', 'disabled', 'superseded')),
      revision INTEGER NOT NULL CHECK (revision > 0),
      scope_json TEXT NOT NULL,
      limits_json TEXT NOT NULL,
      window_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      stops_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      enabled_at TEXT,
      disabled_at TEXT,
      enabled_by TEXT,
      reason TEXT NOT NULL,
      supersedes_policy_version_id TEXT,
      FOREIGN KEY (supersedes_policy_version_id) REFERENCES policy_versions_v16(policy_version_id)
    );
    CREATE INDEX IF NOT EXISTS idx_policy_versions_v16_store_status
      ON policy_versions_v16(store_id, status);
  `);

  // mode_change_log_v16 — append-only audit of every mode/policy change.
  database.exec(`
    CREATE TABLE IF NOT EXISTS mode_change_log_v16 (
      audit_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      from_mode TEXT CHECK (from_mode IN ('manual_approval', 'policy_auto')),
      to_mode TEXT NOT NULL CHECK (to_mode IN ('manual_approval', 'policy_auto')),
      authority_mode_revision_before INTEGER NOT NULL,
      authority_mode_revision_after INTEGER NOT NULL,
      previous_policy_version_id TEXT,
      active_policy_version_id TEXT,
      reason TEXT NOT NULL,
      actor TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      context_snapshot_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mode_change_log_v16_store
      ON mode_change_log_v16(store_id, changed_at);
  `);

  // authority_invalidation_v16 — terminal invalidations. The `terminal` flag
  // is part of the contract: even if the runtime later reverts to the previous
  // mode/policy, these Grants/Batches/Slots cannot be revived.
  database.exec(`
    CREATE TABLE IF NOT EXISTS authority_invalidation_v16 (
      invalidation_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      authority_mode_revision INTEGER NOT NULL,
      invalidates_grant_ids_json TEXT NOT NULL,
      invalidates_batch_ids_json TEXT NOT NULL,
      invalidates_slot_ids_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      terminal INTEGER NOT NULL DEFAULT 1 CHECK (terminal IN (0, 1))
    );
    CREATE INDEX IF NOT EXISTS idx_authority_invalidation_v16_store
      ON authority_invalidation_v16(store_id, created_at);
  `);
}

/**
 * Apply migration 15: V1.6 policy/authority tables.
 */
export function runPolicyAuthorityMigration(
  database: Database.Database,
  preparedBackup?: UpgradeBackupManifest,
): PolicyAuthorityMigrationResult {
  assertPrerequisites(database);

  const existing = readMigration(database);
  if (existing && existing.checksum !== POLICY_AUTHORITY_MIGRATION_CHECKSUM) throw new PolicyAuthorityMigrationError('Migration 15 checksum mismatch');
  if (existing?.status === 'applied') {
    verifyPolicyAuthoritySchema(database);
    const parsed = parseResult(existing.result_json);
    return (
      parsed ?? {
        version: POLICY_AUTHORITY_MIGRATION_VERSION,
        status: 'skipped',
        startedAt: '',
        createdTables: 0,
      }
    );
  }

  const upgradeBackup = preparedBackup ?? prepareUpgradeBackup(database, { targetVersion: POLICY_AUTHORITY_MIGRATION_VERSION, targetName: POLICY_AUTHORITY_MIGRATION_NAME, targetChecksum: POLICY_AUTHORITY_MIGRATION_CHECKSUM });
  const started: PolicyAuthorityMigrationResult = {
    version: POLICY_AUTHORITY_MIGRATION_VERSION,
    status: 'started',
    startedAt: new Date().toISOString(),
    createdTables: 0,
  };

  database
    .prepare(
      `INSERT INTO schema_migrations (version, name, checksum, status, started_at, result_json, manifest_json)
       VALUES (?, ?, ?, 'started', ?, ?, ?)
       ON CONFLICT(version) DO UPDATE SET
         status = 'started', started_at = excluded.started_at,
         result_json = excluded.result_json, manifest_json = excluded.manifest_json`,
    )
    .run(
      POLICY_AUTHORITY_MIGRATION_VERSION,
      POLICY_AUTHORITY_MIGRATION_NAME,
      POLICY_AUTHORITY_MIGRATION_CHECKSUM,
      started.startedAt,
      JSON.stringify(started),
      JSON.stringify({ version: POLICY_AUTHORITY_MIGRATION_VERSION, tables: POLICY_AUTHORITY_TABLES, upgradeBackup }),
    );

  try {
    const finished = database.transaction(() => {
      installSchema(database);
      const result: PolicyAuthorityMigrationResult = {
        version: POLICY_AUTHORITY_MIGRATION_VERSION,
        status: 'applied',
        startedAt: started.startedAt,
        finishedAt: new Date().toISOString(),
        createdTables: POLICY_AUTHORITY_TABLES.length,
      };
      database
        .prepare(
          `UPDATE schema_migrations
           SET status = 'applied', applied_at = @appliedAt, result_json = @resultJson
           WHERE version = @version`,
        )
        .run({
          appliedAt: result.finishedAt,
          resultJson: JSON.stringify(result),
          version: POLICY_AUTHORITY_MIGRATION_VERSION,
        });
      return result;
    }).immediate();
    return finished;
  } catch (error) {
    const failed: PolicyAuthorityMigrationResult = {
      version: POLICY_AUTHORITY_MIGRATION_VERSION,
      status: 'failed',
      startedAt: started.startedAt,
      finishedAt: new Date().toISOString(),
      createdTables: 0,
      errorMessage: errorMessage(error),
    };
    database
        .prepare(
          `UPDATE schema_migrations
           SET status = 'failed', applied_at = NULL, error_message = @errorMessage,
               result_json = @resultJson
           WHERE version = @version`,
        )
        .run({
          errorMessage: failed.errorMessage,
          resultJson: JSON.stringify(failed),
          version: POLICY_AUTHORITY_MIGRATION_VERSION,
        });
    if (error instanceof PolicyAuthorityMigrationError) throw error;
    throw new PolicyAuthorityMigrationError(failed.errorMessage ?? 'Migration 15 failed');
  }
}

/**
 * Verify that all expected tables exist with the required columns.
 */
export function verifyPolicyAuthoritySchema(database: Database.Database): void {
  for (const table of POLICY_AUTHORITY_TABLES) {
    const info = database.pragma(`table_info(${table})`);
    if (!Array.isArray(info) || info.length === 0) {
      throw new PolicyAuthorityMigrationError(`Table ${table} missing`);
    }
  }
}