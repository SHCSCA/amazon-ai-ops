import Database from 'better-sqlite3';
import { ensureSchemaMigrationsTable } from './0001-store-authority';

export const V16_DOMAIN_MIGRATION_VERSION = 13;
export const V16_DOMAIN_MIGRATION_NAME = 'v16-domain-models-v13';
export const V16_DOMAIN_MIGRATION_CHECKSUM = 'v16-domain-models-v13-20260903-01';

/**
 * Tables introduced in V1.6 domain model migration.
 * V16 Mission, Decision, MissionGrant (v2), Execution, Experiment, Memory
 * Note: v1_5 missions, mission_grants, decisions, decision_history, experiments,
 * experiment_snapshots, causal_events all already exist from migration 6;
 * we use suffixed names to avoid schema conflict while preserving v1_5 data.
 */
export const V16_DOMAIN_TABLES = [
  'v16_missions',
  'decisions_v16',
  'decision_history_v16',
  'mission_grants_v16',
  'grant_lifecycle_events',
  'execution_slots',
  'execution_batches',
  'reconciliation_cases',
  'experiments_v16',
  'experiment_snapshots_v16',
  'causal_events_v16',
] as const;

type MigrationStatus = 'started' | 'applied' | 'failed';

interface V16DomainMigrationManifest {
  version: number;
  name: string;
  checksum: string;
  startedAt: string;
  integrityCheck: string;
  prerequisiteVersion: number;
  tables: readonly string[];
}

export interface V16DomainMigrationResult {
  version: number;
  name: string;
  status: MigrationStatus;
  startedAt: string;
  finishedAt?: string;
  createdTables: number;
  errorMessage?: string;
}

interface MigrationRow {
  checksum: string;
  status: MigrationStatus;
  manifest_json: string;
  result_json: string | null;
}

export class V16DomainMigrationError extends Error {
  readonly version = V16_DOMAIN_MIGRATION_VERSION;

  constructor(message: string) {
    super(message);
    this.name = 'V16DomainMigrationError';
  }
}

/** Install V1.6 domain tables. */
export function runV16DomainMigration(
  database: Database.Database,
): V16DomainMigrationResult {
  ensureSchemaMigrationsTable(database);
  assertPrerequisites(database);

  const existing = readMigration(database);
  if (existing && existing.checksum !== V16_DOMAIN_MIGRATION_CHECKSUM) {
    throw new V16DomainMigrationError('Migration 13 checksum does not match recorded history.');
  }
  if (existing?.status === 'applied') {
    verifyV16DomainSchema(database);
    return parseJson(existing.result_json, defaultResult('applied', '', V16_DOMAIN_TABLES.length));
  }

  const integrityCheck = database.pragma('integrity_check', { simple: true }) as string;
  if (integrityCheck !== 'ok') {
    throw new V16DomainMigrationError(`Source database integrity_check returned: ${integrityCheck}`);
  }

  const manifest: V16DomainMigrationManifest = {
    version: V16_DOMAIN_MIGRATION_VERSION,
    name: V16_DOMAIN_MIGRATION_NAME,
    checksum: V16_DOMAIN_MIGRATION_CHECKSUM,
    startedAt: new Date().toISOString(),
    integrityCheck,
    prerequisiteVersion: 12,
    tables: V16_DOMAIN_TABLES,
  };

  const started = defaultResult('started', manifest.startedAt, 0);
  database.prepare(`
    INSERT INTO schema_migrations (
      version, name, checksum, status, started_at, applied_at,
      error_message, manifest_json, result_json
    ) VALUES (
      @version, @name, @checksum, 'started', @startedAt, NULL,
      NULL, @manifestJson, @resultJson
    )
    ON CONFLICT(version) DO UPDATE SET
      name = excluded.name,
      checksum = excluded.checksum,
      status = 'started',
      started_at = excluded.started_at,
      applied_at = NULL,
      error_message = NULL,
      manifest_json = excluded.manifest_json,
      result_json = excluded.result_json
  `).run({
    version: V16_DOMAIN_MIGRATION_VERSION,
    name: V16_DOMAIN_MIGRATION_NAME,
    checksum: V16_DOMAIN_MIGRATION_CHECKSUM,
    startedAt: manifest.startedAt,
    manifestJson: JSON.stringify(manifest),
    resultJson: JSON.stringify(started),
  });

  try {
    return database.transaction(() => {
      installV16DomainSchema(database);
      verifyV16DomainSchema(database);
      const result: V16DomainMigrationResult = {
        ...started,
        status: 'applied',
        finishedAt: new Date().toISOString(),
        createdTables: V16_DOMAIN_TABLES.length,
      };
      database.prepare(`
        UPDATE schema_migrations
        SET status = 'applied', applied_at = @appliedAt,
            error_message = NULL, result_json = @resultJson
        WHERE version = @version
      `).run({
        version: V16_DOMAIN_MIGRATION_VERSION,
        appliedAt: result.finishedAt,
        resultJson: JSON.stringify(result),
      });
      return result;
    }).immediate();
  } catch (error) {
    const failed: V16DomainMigrationResult = {
      ...started,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      createdTables: 0,
      errorMessage: errorMessage(error),
    };
    database.prepare(`
      UPDATE schema_migrations
      SET status = 'failed', applied_at = NULL,
          error_message = @errorMessage, result_json = @resultJson
      WHERE version = @version
    `).run({
      version: V16_DOMAIN_MIGRATION_VERSION,
      errorMessage: failed.errorMessage,
      resultJson: JSON.stringify(failed),
    });
    if (error instanceof V16DomainMigrationError) throw error;
    throw new V16DomainMigrationError(failed.errorMessage ?? 'Migration 13 failed.');
  }
}

function installV16DomainSchema(database: Database.Database): void {
  // ─── V1.6 Mission (V16_MISSIONS to avoid conflict with v1_5 missions table) ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS v16_missions (
      mission_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,

      mission_name TEXT NOT NULL,
      description TEXT,

      product_ids TEXT NOT NULL,                -- JSON array of product IDs
      report_snapshot_id TEXT,
      observation_window_start TEXT,
      observation_window_end TEXT,

      policy_version_id TEXT,
      policy_revision TEXT,

      stage TEXT NOT NULL DEFAULT 'analysis'
        CHECK (stage IN ('fact', 'analysis', 'decision', 'action', 'readback', 'effect')),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'paused', 'blocked', 'completed', 'archived')),
      revision INTEGER NOT NULL DEFAULT 1,

      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,

      created_by TEXT,
      last_modified_by TEXT,
      reason TEXT,
      metadata TEXT,

      FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_v16_missions_store_status
      ON v16_missions(store_id, status, updated_at DESC, mission_id);
    CREATE INDEX IF NOT EXISTS idx_v16_missions_store_stage
      ON v16_missions(store_id, stage, updated_at DESC) WHERE status = 'active';
  `);

  // ─── Decision (DECISIONS_V16) ──────────────────────────────────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS decisions_v16 (
      decision_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      marketplace TEXT NOT NULL DEFAULT 'US',
      currency TEXT NOT NULL DEFAULT 'USD',

      mission_id TEXT NOT NULL,
      mission_revision INTEGER NOT NULL,
      analysis_run_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      recommendation_id TEXT NOT NULL,

      action_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      current_value TEXT,
      target_value TEXT,
      change_reason TEXT,

      status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'needs_approval', 'approved', 'rejected', 'blocked', 'superseded', 'executed', 'verified')),
      issuer TEXT NOT NULL
        CHECK (issuer IN ('human_operator', 'policy_runtime')),
      revision INTEGER NOT NULL DEFAULT 1,

      approved_at TEXT,
      approved_by TEXT,
      rejection_reason TEXT,

      superseded_by TEXT,
      supersedes TEXT,

      executed_at TEXT,
      execution_evidence TEXT,

      verified_at TEXT,
      verification_result TEXT
        CHECK (verification_result IS NULL OR verification_result IN ('success', 'failure', 'unknown')),

      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,

      metadata TEXT,

      FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_decisions_v16_store_status
      ON decisions_v16(store_id, status, updated_at DESC, decision_id);
    CREATE INDEX IF NOT EXISTS idx_decisions_v16_mission
      ON decisions_v16(store_id, mission_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_decisions_v16_analysis_run
      ON decisions_v16(store_id, analysis_run_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_decisions_v16_batch
      ON decisions_v16(store_id, batch_id, status);
    CREATE INDEX IF NOT EXISTS idx_decisions_v16_entity
      ON decisions_v16(store_id, entity_type, entity_id, created_at DESC);
  `);

  // Decision history (append-only)
  database.exec(`
    CREATE TABLE IF NOT EXISTS decision_history_v16 (
      entry_id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      reason TEXT,
      triggered_by TEXT NOT NULL CHECK (triggered_by IN ('system', 'operator')),
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_decision_history_v16_decision
      ON decision_history_v16(decision_id, timestamp);
  `);

  // ─── MissionGrant (MISSION_GRANTS_V16 to avoid conflict) ───────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS mission_grants_v16 (
      grant_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,

      mission_id TEXT NOT NULL,
      mission_revision INTEGER NOT NULL,
      decision_ids TEXT NOT NULL,               -- JSON array

      issuer TEXT NOT NULL CHECK (issuer IN ('human_operator', 'policy_runtime')),
      issued_at TEXT NOT NULL,
      expires_at TEXT,
      issued_by TEXT NOT NULL,

      scope_json TEXT NOT NULL,                 -- JSON: GrantScope
      limits_json TEXT NOT NULL,                -- JSON: GrantLimits
      evidence_json TEXT NOT NULL,              -- JSON: GrantEvidenceRequirement

      session_generation INTEGER,
      ads_account_id TEXT,

      status TEXT NOT NULL DEFAULT 'issued'
        CHECK (status IN ('issued', 'active', 'partially_consumed', 'fully_consumed', 'expired', 'revoked', 'invalidated')),
      used_slots INTEGER NOT NULL DEFAULT 0,
      consumed_at TEXT,
      revoked_at TEXT,
      revoked_by TEXT,
      revocation_reason TEXT,

      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,

      reason TEXT NOT NULL,
      metadata TEXT,

      FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_mission_grants_v16_store_status
      ON mission_grants_v16(store_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mission_grants_v16_mission
      ON mission_grants_v16(store_id, mission_id, created_at DESC);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS grant_lifecycle_events (
      event_id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      event_type TEXT NOT NULL
        CHECK (event_type IN ('issued', 'slot_reserved', 'slot_consumed', 'expired', 'revoked', 'invalidated')),
      timestamp TEXT NOT NULL,
      slot_index INTEGER,
      execution_id TEXT,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_grant_lifecycle_grant
      ON grant_lifecycle_events(grant_id, timestamp);
  `);

  // ─── Execution (slots + batches) ─────────────────────────────────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS execution_slots (
      slot_id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      decision_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      store_id TEXT NOT NULL,

      intent_json TEXT NOT NULL,                -- JSON: ExecutionIntent
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'preflight_blocked', 'submit_intent_recorded', 'submitted', 'verified', 'failed', 'unknown')),

      expected_before TEXT NOT NULL,
      expected_after TEXT NOT NULL,
      expected_change_percent REAL,

      before_evidence_path TEXT,
      after_evidence_path TEXT,
      reload_evidence_path TEXT,

      readback_before_value TEXT,
      readback_after_value TEXT,
      readback_reload_value TEXT,

      verified_at TEXT,
      verification_result TEXT,

      reconciliation_case_id TEXT,
      reconciliation_outcome TEXT
        CHECK (reconciliation_outcome IS NULL OR reconciliation_outcome IN
          ('target_stably_observed', 'original_stably_observed', 'other_value', 'inconclusive_permanent')),

      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      submitted_at TEXT,

      FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_execution_slots_batch
      ON execution_slots(batch_id, status);
    CREATE INDEX IF NOT EXISTS idx_execution_slots_grant
      ON execution_slots(grant_id, status);
    CREATE INDEX IF NOT EXISTS idx_execution_slots_store_status
      ON execution_slots(store_id, status, updated_at DESC);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS execution_batches (
      batch_id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      store_id TEXT NOT NULL,

      slot_ids TEXT NOT NULL,                   -- JSON array
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'stopped_invalidated', 'stopped_unknown')),

      pending_count INTEGER NOT NULL DEFAULT 0,
      submitted_count INTEGER NOT NULL DEFAULT 0,
      verified_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      unknown_count INTEGER NOT NULL DEFAULT 0,

      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,

      FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_execution_batches_store_status
      ON execution_batches(store_id, status, updated_at DESC);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS reconciliation_cases (
      case_id TEXT PRIMARY KEY,
      slot_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      store_id TEXT NOT NULL,

      created_at TEXT NOT NULL,

      observation_1_timestamp TEXT,
      observation_1_value TEXT,
      observation_2_timestamp TEXT,
      observation_2_value TEXT,

      outcome TEXT
        CHECK (outcome IS NULL OR outcome IN
          ('target_stably_observed', 'original_stably_observed', 'other_value', 'inconclusive_permanent')),
      resolved_at TEXT,
      resolution_notes TEXT,

      FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_reconciliation_cases_slot
      ON reconciliation_cases(slot_id);
    CREATE INDEX IF NOT EXISTS idx_reconciliation_cases_batch
      ON reconciliation_cases(batch_id, created_at DESC);
  `);

  // ─── Experiment ──────────────────────────────────────────────────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS experiments_v16 (
      experiment_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      mission_id TEXT,
      decision_id TEXT,

      name TEXT NOT NULL,
      description TEXT,

      hypothesis_json TEXT NOT NULL,            -- JSON: ExperimentHypothesis

      product_ids TEXT NOT NULL,                -- JSON array
      entity_ids TEXT NOT NULL,                 -- JSON array

      baseline_snapshot_id TEXT,
      observation_window_start TEXT,
      observation_window_end TEXT,
      observation_snapshots TEXT NOT NULL DEFAULT '[]',  -- JSON array

      guardrails_json TEXT NOT NULL,            -- JSON: Guardrail[]
      conclusion_id TEXT,
      guardrails_triggered TEXT NOT NULL DEFAULT '[]',   -- JSON array

      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'running', 'paused', 'blocked', 'completed', 'archived')),
      revision INTEGER NOT NULL DEFAULT 1,

      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,

      metadata TEXT,

      FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_experiments_v16_store_status
      ON experiments_v16(store_id, status, updated_at DESC);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS experiment_snapshots_v16 (
      snapshot_id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('baseline', 'observation', 'result')),
      data_json TEXT NOT NULL,                  -- JSON: ExperimentMetrics
      data_source TEXT NOT NULL,
      proof_hash TEXT NOT NULL,

      FOREIGN KEY (experiment_id) REFERENCES experiments_v16(experiment_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_experiment_snapshots_v16_exp
      ON experiment_snapshots_v16(experiment_id, timestamp);
  `);

  // ─── Causal Memory (append-only) ─────────────────────────────────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS causal_events_v16 (
      event_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,

      stage TEXT NOT NULL
        CHECK (stage IN ('fact', 'analysis', 'decision', 'action', 'readback', 'effect')),

      mission_id TEXT,
      decision_id TEXT,
      grant_id TEXT,
      execution_id TEXT,
      experiment_id TEXT,
      analysis_run_id TEXT,

      entity_id TEXT,
      product_id TEXT,
      business_date TEXT NOT NULL,
      event_type TEXT NOT NULL,

      session_generation INTEGER NOT NULL,

      proof_hash TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL DEFAULT '[]',

      summary TEXT NOT NULL,
      details_json TEXT,

      status TEXT NOT NULL DEFAULT 'observed'
        CHECK (status IN ('observed', 'trusted', 'corrected', 'disputed')),
      memory_digest TEXT,

      created_at TEXT NOT NULL,

      correction_of TEXT,
      corrected_by TEXT,

      metadata TEXT,

      FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_causal_events_v16_store_date
      ON causal_events_v16(store_id, business_date DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_causal_events_v16_trust
      ON causal_events_v16(store_id, status, stage) WHERE status = 'trusted';
    CREATE INDEX IF NOT EXISTS idx_causal_events_v16_mission
      ON causal_events_v16(mission_id, created_at) WHERE mission_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_causal_events_v16_entity
      ON causal_events_v16(store_id, entity_id, created_at DESC);
  `);
}

export function verifyV16DomainSchema(database: Database.Database): void {
  assertPrerequisites(database);

  const foreignKeys = database.pragma('foreign_keys', { simple: true }) as number;
  if (foreignKeys !== 1) {
    throw new V16DomainMigrationError('SQLite foreign_keys must be enabled for V16 domain tables.');
  }

  const tables = new Set((database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all() as Array<{ name: string }>).map((row) => row.name));

  for (const table of V16_DOMAIN_TABLES) {
    if (!tables.has(table)) {
      throw new V16DomainMigrationError(`Required table is missing: ${table}.`);
    }
  }

  const requiredColumns: Record<string, string[]> = {
    v16_missions: ['mission_id', 'store_id', 'stage', 'status', 'revision', 'created_at', 'updated_at'],
    decisions_v16: ['decision_id', 'store_id', 'marketplace', 'currency', 'mission_id', 'mission_revision', 'analysis_run_id', 'status', 'revision', 'created_at', 'updated_at'],
    decision_history_v16: ['entry_id', 'decision_id', 'from_status', 'to_status', 'timestamp'],
    mission_grants_v16: ['grant_id', 'store_id', 'mission_id', 'status', 'used_slots', 'created_at'],
    grant_lifecycle_events: ['event_id', 'grant_id', 'event_type', 'timestamp'],
    execution_slots: ['slot_id', 'grant_id', 'batch_id', 'status', 'created_at', 'updated_at'],
    execution_batches: ['batch_id', 'grant_id', 'mission_id', 'status', 'created_at'],
    reconciliation_cases: ['case_id', 'slot_id', 'batch_id', 'store_id'],
    experiments_v16: ['experiment_id', 'store_id', 'name', 'status', 'revision', 'created_at'],
    experiment_snapshots_v16: ['snapshot_id', 'experiment_id', 'timestamp', 'snapshot_type', 'proof_hash'],
    causal_events_v16: ['event_id', 'store_id', 'stage', 'event_type', 'proof_hash', 'created_at'],
  };

  for (const [table, columns] of Object.entries(requiredColumns)) {
    const columnSet = new Set((database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
      .map((row) => row.name));
    for (const column of columns) {
      if (!columnSet.has(column)) {
        throw new V16DomainMigrationError(`${table} column is missing: ${column}.`);
      }
    }
  }

  const violations = database.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new V16DomainMigrationError('V16 domain schema foreign-key check failed.');
  }
}

function assertPrerequisites(database: Database.Database): void {
  const prerequisite = database.prepare(`
    SELECT status FROM schema_migrations WHERE version = 12
  `).get() as { status: string } | undefined;

  if (prerequisite?.status !== 'applied') {
    throw new V16DomainMigrationError('Migration 12 must be applied before V16 domain migration 13.');
  }

  for (const table of ['stores']) {
    const exists = database.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(table);
    if (!exists) {
      throw new V16DomainMigrationError(`Required prerequisite table is missing: ${table}.`);
    }
  }
}

function readMigration(database: Database.Database): MigrationRow | undefined {
  return database.prepare(`
    SELECT checksum, status, manifest_json, result_json
    FROM schema_migrations WHERE version = ?
  `).get(V16_DOMAIN_MIGRATION_VERSION) as MigrationRow | undefined;
}

function defaultResult(
  status: MigrationStatus,
  startedAt: string,
  createdTables: number,
): V16DomainMigrationResult {
  return {
    version: V16_DOMAIN_MIGRATION_VERSION,
    name: V16_DOMAIN_MIGRATION_NAME,
    status,
    startedAt,
    createdTables,
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
