import Database from 'better-sqlite3';
import { ensureSchemaMigrationsTable } from './0001-store-authority';

export const MISSION_DOMAIN_MIGRATION_VERSION = 6;
export const MISSION_DOMAIN_MIGRATION_NAME = 'mission-domain-v6';
export const MISSION_DOMAIN_MIGRATION_CHECKSUM = 'mission-domain-v6-20260722-05';

export const MISSION_DOMAIN_TABLES = [
  'policies',
  'policy_versions',
  'policy_runtime',
  'missions',
  'mission_checkpoints',
  'mission_links',
  'mission_events',
  'mission_grants',
  'mission_grant_events',
  'decisions',
  'decision_history',
  'experiments',
  'experiment_records',
  'experiment_metric_snapshots',
  'causal_events',
  'causal_links',
  'evidence_refs',
] as const;

const APPEND_ONLY_TABLES = [
  'mission_checkpoints',
  'mission_links',
  'mission_events',
  'mission_grants',
  'mission_grant_events',
  'decision_history',
  'experiment_records',
  'experiment_metric_snapshots',
  'causal_events',
  'causal_links',
  'evidence_refs',
] as const;

type MigrationStatus = 'started' | 'applied' | 'failed';

interface MissionDomainMigrationManifest {
  version: number;
  name: string;
  checksum: string;
  startedAt: string;
  integrityCheck: string;
  prerequisiteVersion: number;
  tables: readonly string[];
}

export interface MissionDomainMigrationResult {
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

export class MissionDomainMigrationError extends Error {
  readonly version = MISSION_DOMAIN_MIGRATION_VERSION;

  constructor(message: string) {
    super(message);
    this.name = 'MissionDomainMigrationError';
  }
}

/** Installs the additive, store-scoped Mission Control authority schema. */
export function runMissionDomainMigration(
  database: Database.Database,
): MissionDomainMigrationResult {
  ensureSchemaMigrationsTable(database);
  assertPrerequisites(database);

  const existing = readMigration(database);
  if (existing && existing.checksum !== MISSION_DOMAIN_MIGRATION_CHECKSUM) {
    throw new MissionDomainMigrationError('Migration 6 checksum does not match recorded history.');
  }
  if (existing?.status === 'applied') {
    verifyMissionDomainSchema(database);
    return parseJson(existing.result_json, defaultResult('applied', '', MISSION_DOMAIN_TABLES.length));
  }

  const integrityCheck = database.pragma('integrity_check', { simple: true }) as string;
  if (integrityCheck !== 'ok') {
    throw new MissionDomainMigrationError(`Source database integrity_check returned: ${integrityCheck}`);
  }
  const manifest: MissionDomainMigrationManifest = {
    version: MISSION_DOMAIN_MIGRATION_VERSION,
    name: MISSION_DOMAIN_MIGRATION_NAME,
    checksum: MISSION_DOMAIN_MIGRATION_CHECKSUM,
    startedAt: new Date().toISOString(),
    integrityCheck,
    prerequisiteVersion: 5,
    tables: MISSION_DOMAIN_TABLES,
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
    version: MISSION_DOMAIN_MIGRATION_VERSION,
    name: MISSION_DOMAIN_MIGRATION_NAME,
    checksum: MISSION_DOMAIN_MIGRATION_CHECKSUM,
    startedAt: manifest.startedAt,
    manifestJson: JSON.stringify(manifest),
    resultJson: JSON.stringify(started),
  });

  try {
    return database.transaction(() => {
      installMissionDomainSchema(database);
      verifyMissionDomainSchema(database);
      const result: MissionDomainMigrationResult = {
        ...started,
        status: 'applied',
        finishedAt: new Date().toISOString(),
        createdTables: MISSION_DOMAIN_TABLES.length,
      };
      database.prepare(`
        UPDATE schema_migrations
        SET status = 'applied', applied_at = @appliedAt,
            error_message = NULL, result_json = @resultJson
        WHERE version = @version
      `).run({
        version: MISSION_DOMAIN_MIGRATION_VERSION,
        appliedAt: result.finishedAt,
        resultJson: JSON.stringify(result),
      });
      return result;
    }).immediate();
  } catch (error) {
    const failed: MissionDomainMigrationResult = {
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
      version: MISSION_DOMAIN_MIGRATION_VERSION,
      errorMessage: failed.errorMessage,
      resultJson: JSON.stringify(failed),
    });
    if (error instanceof MissionDomainMigrationError) throw error;
    throw new MissionDomainMigrationError(failed.errorMessage ?? 'Migration 6 failed.');
  }
}

function installMissionDomainSchema(database: Database.Database): void {
  // Needed by store-consistent lineage foreign keys. Batch ids remain globally
  // unique, while this key additionally proves that the batch belongs to the
  // same store as the Mission/Decision that references it.
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lingxing_batches_store_identity
      ON lingxing_report_batches(store_id, id);

    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      name TEXT NOT NULL,
      scope TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'disabled', 'archived')),
      priority INTEGER NOT NULL DEFAULT 100 CHECK (priority >= 0),
      active_version_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      UNIQUE(store_id, id),
      FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, active_version_id)
        REFERENCES policy_versions(store_id, id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS policy_versions (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      policy_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'enabled', 'retired')),
      rules_json TEXT NOT NULL,
      valid_from TEXT,
      valid_until TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      enabled_at TEXT,
      retired_at TEXT,
      UNIQUE(store_id, id),
      UNIQUE(store_id, policy_id, version),
      FOREIGN KEY (store_id, policy_id) REFERENCES policies(store_id, id) ON DELETE RESTRICT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_versions_one_enabled
      ON policy_versions(store_id, policy_id)
      WHERE status = 'enabled';
    CREATE INDEX IF NOT EXISTS idx_policies_store_status
      ON policies(store_id, status, priority, id);

    CREATE TABLE IF NOT EXISTS policy_runtime (
      store_id TEXT PRIMARY KEY,
      autonomy_mode TEXT NOT NULL DEFAULT 'manual_approval'
        CHECK (autonomy_mode IN ('manual_approval', 'policy_auto')),
      kill_switch INTEGER NOT NULL DEFAULT 0 CHECK (kill_switch IN (0, 1)),
      circuit_breaker_state TEXT NOT NULL DEFAULT 'closed'
        CHECK (circuit_breaker_state IN ('closed', 'open', 'half_open')),
      active_policy_version_id TEXT,
      reason TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, active_policy_version_id)
        REFERENCES policy_versions(store_id, id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      marketplace TEXT NOT NULL CHECK (marketplace = 'US'),
      currency TEXT NOT NULL CHECK (currency = 'USD'),
      business_date TEXT NOT NULL,
      created_session_generation INTEGER NOT NULL CHECK (created_session_generation >= 0),
      data_batch_id TEXT NOT NULL,
      policy_version_id TEXT NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'paused', 'blocked', 'completed', 'archived')),
      phase TEXT NOT NULL DEFAULT 'fact'
        CHECK (phase IN ('fact', 'analysis', 'decision', 'action', 'readback', 'effect')),
      priority TEXT NOT NULL DEFAULT 'P2' CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
      product_id TEXT,
      observation_starts_at TEXT NOT NULL,
      observation_ends_at TEXT NOT NULL,
      success_criteria_json TEXT NOT NULL,
      guardrails_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      UNIQUE(store_id, id),
      FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, data_batch_id)
        REFERENCES lingxing_report_batches(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, policy_version_id)
        REFERENCES policy_versions(store_id, id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_missions_store_status
      ON missions(store_id, status, updated_at DESC, id);

    CREATE TABLE IF NOT EXISTS mission_checkpoints (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      stage TEXT NOT NULL CHECK (stage IN ('FACT', 'ANALYSIS', 'DECISION', 'ACTION', 'READBACK', 'EFFECT')),
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
      actor_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(store_id, id),
      FOREIGN KEY (store_id, mission_id) REFERENCES missions(store_id, id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS mission_links (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      link_type TEXT NOT NULL CHECK (link_type IN (
        'data_batch', 'policy_version', 'decision', 'experiment',
        'execution', 'result', 'product', 'ad_entity'
      )),
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(store_id, mission_id, link_type, target_id, relation),
      FOREIGN KEY (store_id, mission_id) REFERENCES missions(store_id, id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS mission_events (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      mission_revision INTEGER NOT NULL CHECK (mission_revision >= 1),
      event_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      reason TEXT,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(store_id, mission_id, mission_revision, event_type, id),
      FOREIGN KEY (store_id, mission_id) REFERENCES missions(store_id, id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS mission_grants (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      marketplace TEXT NOT NULL CHECK (marketplace = 'US'),
      currency TEXT NOT NULL CHECK (currency = 'USD'),
      mission_id TEXT NOT NULL,
      mission_revision INTEGER NOT NULL CHECK (mission_revision >= 1),
      decision_ids_json TEXT NOT NULL,
      action_revision INTEGER NOT NULL CHECK (action_revision >= 1),
      allowed_action_types_json TEXT NOT NULL,
      allowed_ad_entity_ids_json TEXT NOT NULL,
      max_change_pct REAL NOT NULL CHECK (max_change_pct > 0 AND max_change_pct <= 100),
      total_impact_budget REAL NOT NULL CHECK (total_impact_budget >= 0),
      expires_at TEXT NOT NULL,
      policy_version_id TEXT NOT NULL,
      policy_revision INTEGER NOT NULL CHECK (policy_revision >= 1),
      required_evidence_json TEXT NOT NULL,
      stop_conditions_json TEXT NOT NULL,
      issuer_type TEXT NOT NULL CHECK (issuer_type IN ('human', 'policy')),
      issuer_actor_id TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      created_session_generation INTEGER NOT NULL CHECK (created_session_generation >= 0),
      UNIQUE(store_id, id),
      UNIQUE(store_id, mission_id, action_revision),
      FOREIGN KEY (store_id, mission_id) REFERENCES missions(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, policy_version_id)
        REFERENCES policy_versions(store_id, id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS mission_grant_events (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      grant_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('issued', 'revoked', 'consumed', 'expired')),
      actor_id TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(store_id, id),
      FOREIGN KEY (store_id, grant_id) REFERENCES mission_grants(store_id, id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      data_batch_id TEXT NOT NULL,
      policy_version_id TEXT NOT NULL,
      policy_revision INTEGER NOT NULL CHECK (policy_revision >= 1),
      action_revision INTEGER NOT NULL CHECK (action_revision >= 1),
      title TEXT NOT NULL,
      rationale TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      facts_json TEXT NOT NULL,
      alternatives_json TEXT NOT NULL,
      expected_effect TEXT,
      valid_until TEXT,
      action_type TEXT NOT NULL,
      ad_entity_id TEXT,
      product_id TEXT,
      current_value_json TEXT,
      recommended_value_json TEXT,
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      status TEXT NOT NULL CHECK (status IN (
        'proposed', 'needs_approval', 'approved', 'rejected', 'blocked',
        'superseded', 'executed', 'verified'
      )),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(store_id, id),
      FOREIGN KEY (store_id, mission_id) REFERENCES missions(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, data_batch_id)
        REFERENCES lingxing_report_batches(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, policy_version_id)
        REFERENCES policy_versions(store_id, id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_decisions_store_mission_status
      ON decisions(store_id, mission_id, status, updated_at DESC, id);

    CREATE INDEX IF NOT EXISTS idx_decisions_store_mission_action_revision
      ON decisions(store_id, mission_id, action_revision, id);

    CREATE TABLE IF NOT EXISTS decision_history (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      decision_id TEXT NOT NULL,
      decision_revision INTEGER NOT NULL CHECK (decision_revision >= 1),
      event_type TEXT NOT NULL CHECK (event_type IN (
        'created', 'revised', 'approved', 'rejected', 'blocked', 'superseded',
        'executed', 'verified'
      )),
      actor_id TEXT NOT NULL,
      reason TEXT,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(store_id, decision_id, decision_revision, event_type),
      FOREIGN KEY (store_id, decision_id) REFERENCES decisions(store_id, id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      name TEXT NOT NULL,
      hypothesis TEXT NOT NULL,
      primary_metric TEXT NOT NULL,
      guardrail_metrics_json TEXT NOT NULL,
      guardrail_criteria_json TEXT NOT NULL,
      product_id TEXT,
      ad_entity_id TEXT,
      baseline_json TEXT NOT NULL,
      variant_json TEXT NOT NULL,
      observation_starts_at TEXT NOT NULL,
      observation_ends_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'running', 'paused', 'completed', 'archived')),
      conclusion TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      UNIQUE(store_id, id),
      FOREIGN KEY (store_id, mission_id) REFERENCES missions(store_id, id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_experiments_store_mission_status
      ON experiments(store_id, mission_id, status, updated_at DESC, id);

    CREATE TABLE IF NOT EXISTS experiment_records (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      experiment_id TEXT NOT NULL,
      observation_type TEXT NOT NULL CHECK (observation_type IN (
        'baseline', 'observation', 'result', 'correction'
      )),
      title TEXT NOT NULL,
      observation TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      corrects_record_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(store_id, id),
      FOREIGN KEY (store_id, experiment_id) REFERENCES experiments(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, corrects_record_id)
        REFERENCES experiment_records(store_id, id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS experiment_metric_snapshots (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      experiment_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      currency TEXT CHECK (currency IS NULL OR currency = 'USD'),
      observed_at TEXT NOT NULL,
      data_batch_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(store_id, id),
      FOREIGN KEY (store_id, experiment_id) REFERENCES experiments(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, data_batch_id)
        REFERENCES lingxing_report_batches(store_id, id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS causal_events (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      stage TEXT NOT NULL CHECK (stage IN ('FACT', 'ANALYSIS', 'DECISION', 'ACTION', 'READBACK', 'EFFECT')),
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      mission_id TEXT,
      title TEXT NOT NULL,
      signal TEXT,
      intervention TEXT,
      expected_effect TEXT,
      observed_effect TEXT,
      confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      session_generation INTEGER NOT NULL CHECK (session_generation >= 0),
      corrects_event_id TEXT,
      sequence INTEGER NOT NULL CHECK (sequence >= 1),
      created_at TEXT NOT NULL,
      UNIQUE(store_id, id),
      UNIQUE(store_id, sequence),
      FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, mission_id) REFERENCES missions(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, corrects_event_id) REFERENCES causal_events(store_id, id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_causal_events_store_time
      ON causal_events(store_id, sequence DESC, created_at DESC, id);
    CREATE INDEX IF NOT EXISTS idx_causal_events_store_mission
      ON causal_events(store_id, mission_id, sequence DESC);

    CREATE TABLE IF NOT EXISTS causal_links (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(store_id, source_event_id, target_type, target_id, relation),
      FOREIGN KEY (store_id, source_event_id) REFERENCES causal_events(store_id, id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS evidence_refs (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      evidence_type TEXT NOT NULL,
      evidence_ref TEXT NOT NULL,
      sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
      created_at TEXT NOT NULL,
      UNIQUE(store_id, event_id, evidence_type, evidence_ref),
      FOREIGN KEY (store_id, event_id) REFERENCES causal_events(store_id, id) ON DELETE RESTRICT
    );
  `);

  const now = new Date().toISOString();
  database.prepare(`
    INSERT OR IGNORE INTO policy_runtime (
      store_id, autonomy_mode, kill_switch, circuit_breaker_state,
      active_policy_version_id, reason, revision, created_at, updated_at
    )
    SELECT store_id, 'manual_approval', 0, 'closed', NULL, NULL, 1, @now, @now
    FROM stores
  `).run({ now });

  database.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_stores_create_policy_runtime
    AFTER INSERT ON stores
    BEGIN
      INSERT OR IGNORE INTO policy_runtime (
        store_id, autonomy_mode, kill_switch, circuit_breaker_state,
        active_policy_version_id, reason, revision, created_at, updated_at
      ) VALUES (
        NEW.store_id, 'manual_approval', 0, 'closed', NULL, NULL, 1,
        NEW.created_at, NEW.created_at
      );
    END;
  `);

  // A policy version becomes content-immutable once enabled. Its lifecycle may
  // only move enabled -> retired; a replacement must be inserted as a new row.
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_policy_versions_immutable_content
    BEFORE UPDATE ON policy_versions
    WHEN OLD.status IN ('enabled', 'retired') AND (
      NEW.id IS NOT OLD.id OR
      NEW.store_id IS NOT OLD.store_id OR
      NEW.policy_id IS NOT OLD.policy_id OR
      NEW.version IS NOT OLD.version OR
      NEW.rules_json IS NOT OLD.rules_json OR
      NEW.valid_from IS NOT OLD.valid_from OR
      NEW.valid_until IS NOT OLD.valid_until OR
      NEW.revision IS NOT OLD.revision OR
      NEW.created_at IS NOT OLD.created_at OR
      NEW.enabled_at IS NOT OLD.enabled_at OR
      NOT (
        (OLD.status = 'enabled' AND NEW.status IN ('enabled', 'retired')) OR
        (OLD.status = 'retired' AND NEW.status = 'retired')
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'enabled policy version is immutable; create a new version');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_policy_versions_block_historical_delete
    BEFORE DELETE ON policy_versions
    WHEN OLD.status IN ('enabled', 'retired')
    BEGIN
      SELECT RAISE(ABORT, 'historical policy version cannot be deleted');
    END;
  `);

  for (const table of APPEND_ONLY_TABLES) {
    database.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_${table}_append_only_update
      BEFORE UPDATE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS trg_${table}_append_only_delete
      BEFORE DELETE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} is append-only');
      END;
    `);
  }
}

export function verifyMissionDomainSchema(database: Database.Database): void {
  assertPrerequisites(database);
  const foreignKeys = database.pragma('foreign_keys', { simple: true }) as number;
  if (foreignKeys !== 1) {
    throw new MissionDomainMigrationError('SQLite foreign_keys must be enabled for Mission authority.');
  }
  const tables = new Set((database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all() as Array<{ name: string }>).map((row) => row.name));
  for (const table of MISSION_DOMAIN_TABLES) {
    if (!tables.has(table)) throw new MissionDomainMigrationError(`Required Mission table is missing: ${table}.`);
  }
  const triggers = new Set((database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'trigger'
  `).all() as Array<{ name: string }>).map((row) => row.name));
  for (const table of APPEND_ONLY_TABLES) {
    for (const suffix of ['update', 'delete']) {
      const name = `trg_${table}_append_only_${suffix}`;
      if (!triggers.has(name)) throw new MissionDomainMigrationError(`Required append-only trigger is missing: ${name}.`);
    }
  }
  for (const name of [
    'trg_policy_versions_immutable_content',
    'trg_policy_versions_block_historical_delete',
    'trg_stores_create_policy_runtime',
  ]) {
    if (!triggers.has(name)) throw new MissionDomainMigrationError(`Required policy trigger is missing: ${name}.`);
  }
  const missionColumns = new Set((database.prepare('PRAGMA table_info(missions)').all() as Array<{ name: string }>)
    .map((row) => row.name));
  for (const column of [
    'store_id', 'marketplace', 'currency', 'business_date',
    'created_session_generation', 'data_batch_id', 'policy_version_id', 'revision',
  ]) {
    if (!missionColumns.has(column)) {
      throw new MissionDomainMigrationError(`Mission authority column is missing: missions.${column}.`);
    }
  }
  const violations = database.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) throw new MissionDomainMigrationError('Mission schema foreign-key check failed.');
}

function assertPrerequisites(database: Database.Database): void {
  const prerequisite = database.prepare(`
    SELECT status FROM schema_migrations WHERE version = 5
  `).get() as { status: string } | undefined;
  if (prerequisite?.status !== 'applied') {
    throw new MissionDomainMigrationError('Migration 5 must be applied before Mission domain migration 6.');
  }
  for (const table of ['stores', 'lingxing_report_batches']) {
    const exists = database.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(table);
    if (!exists) throw new MissionDomainMigrationError(`Required prerequisite table is missing: ${table}.`);
  }
  const batchColumns = new Set((database.prepare('PRAGMA table_info(lingxing_report_batches)').all() as Array<{ name: string }>)
    .map((row) => row.name));
  if (!batchColumns.has('store_id')) {
    throw new MissionDomainMigrationError('lingxing_report_batches.store_id authority is missing.');
  }
}

function readMigration(database: Database.Database): MigrationRow | undefined {
  return database.prepare(`
    SELECT checksum, status, manifest_json, result_json
    FROM schema_migrations WHERE version = ?
  `).get(MISSION_DOMAIN_MIGRATION_VERSION) as MigrationRow | undefined;
}

function defaultResult(
  status: MigrationStatus,
  startedAt: string,
  createdTables: number,
): MissionDomainMigrationResult {
  return {
    version: MISSION_DOMAIN_MIGRATION_VERSION,
    name: MISSION_DOMAIN_MIGRATION_NAME,
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
