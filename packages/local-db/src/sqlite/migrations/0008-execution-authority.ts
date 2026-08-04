import Database from 'better-sqlite3';
import { ensureSchemaMigrationsTable } from './0001-store-authority';
import { prepareUpgradeBackup } from './upgrade-backup';
import type { UpgradeBackupManifest } from './types';

export const EXECUTION_AUTHORITY_MIGRATION_VERSION = 8;
export const EXECUTION_AUTHORITY_MIGRATION_NAME = 'execution-authority-v8';
export const EXECUTION_AUTHORITY_MIGRATION_CHECKSUM = 'execution-authority-v8-20260723-08';

export const EXECUTION_AUTHORITY_TABLES = [
  'ad_keyword_identity_versions',
  'ad_keyword_alias_resolutions',
  'ad_execution_batches',
  'ad_execution_jobs',
  'ad_execution_events',
  'ad_execution_evidence',
  'ad_execution_domain_reconciliations',
] as const;

const APPEND_ONLY_TABLES = [
  'ad_keyword_identity_versions',
  'ad_keyword_alias_resolutions',
  'ad_execution_events',
  'ad_execution_evidence',
  'ad_execution_domain_reconciliations',
] as const;

const STATE_GUARD_TRIGGERS = [
  'trg_ad_execution_jobs_status_guard',
  'trg_ad_execution_batches_terminal_guard',
] as const;

const STATUS_CHECK = `(
  'queued', 'preflight', 'intent_written', 'submitted', 'verifying',
  'succeeded', 'blocked', 'unknown', 'cancelled'
)`;

type MigrationStatus = 'started' | 'applied' | 'failed';

interface MigrationRow {
  checksum: string;
  status: MigrationStatus;
  result_json: string | null;
}

export interface ExecutionAuthorityMigrationResult {
  version: number;
  name: string;
  status: MigrationStatus;
  startedAt: string;
  finishedAt?: string;
  createdTables: number;
  errorMessage?: string;
}

export class ExecutionAuthorityMigrationError extends Error {
  readonly version = EXECUTION_AUTHORITY_MIGRATION_VERSION;

  constructor(message: string) {
    super(message);
    this.name = 'ExecutionAuthorityMigrationError';
  }
}

export function runExecutionAuthorityMigration(
  database: Database.Database,
  preparedUpgradeBackup?: UpgradeBackupManifest,
): ExecutionAuthorityMigrationResult {
  ensureSchemaMigrationsTable(database);
  assertPrerequisites(database);

  const existing = readMigration(database);
  if (existing && existing.checksum !== EXECUTION_AUTHORITY_MIGRATION_CHECKSUM) {
    throw new ExecutionAuthorityMigrationError('Migration 8 checksum does not match recorded history.');
  }
  if (existing?.status === 'applied') {
    verifyExecutionAuthoritySchema(database);
    return parseJson(existing.result_json, defaultResult('applied', '', EXECUTION_AUTHORITY_TABLES.length));
  }

  const integrityCheck = database.pragma('integrity_check', { simple: true }) as string;
  if (integrityCheck !== 'ok') {
    throw new ExecutionAuthorityMigrationError(`Source database integrity_check returned: ${integrityCheck}`);
  }
  const startedAt = new Date().toISOString();
  const started = defaultResult('started', startedAt, 0);
  const upgradeBackup = preparedUpgradeBackup ?? prepareUpgradeBackup(database, {
    targetVersion: EXECUTION_AUTHORITY_MIGRATION_VERSION,
    targetName: EXECUTION_AUTHORITY_MIGRATION_NAME,
    targetChecksum: EXECUTION_AUTHORITY_MIGRATION_CHECKSUM,
  });
  const manifest = {
    version: EXECUTION_AUTHORITY_MIGRATION_VERSION,
    name: EXECUTION_AUTHORITY_MIGRATION_NAME,
    checksum: EXECUTION_AUTHORITY_MIGRATION_CHECKSUM,
    prerequisiteVersion: 7,
    integrityCheck,
    tables: EXECUTION_AUTHORITY_TABLES,
    startedAt,
    upgradeBackup,
  };
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
    version: EXECUTION_AUTHORITY_MIGRATION_VERSION,
    name: EXECUTION_AUTHORITY_MIGRATION_NAME,
    checksum: EXECUTION_AUTHORITY_MIGRATION_CHECKSUM,
    startedAt,
    manifestJson: JSON.stringify(manifest),
    resultJson: JSON.stringify(started),
  });

  try {
    return database.transaction(() => {
      installExecutionAuthoritySchema(database);
      verifyExecutionAuthoritySchema(database);
      const result: ExecutionAuthorityMigrationResult = {
        ...started,
        status: 'applied',
        finishedAt: new Date().toISOString(),
        createdTables: EXECUTION_AUTHORITY_TABLES.length,
      };
      database.prepare(`
        UPDATE schema_migrations
        SET status = 'applied', applied_at = @appliedAt,
            error_message = NULL, result_json = @resultJson
        WHERE version = @version
      `).run({
        version: EXECUTION_AUTHORITY_MIGRATION_VERSION,
        appliedAt: result.finishedAt,
        resultJson: JSON.stringify(result),
      });
      return result;
    }).immediate();
  } catch (error) {
    const failed: ExecutionAuthorityMigrationResult = {
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
      version: EXECUTION_AUTHORITY_MIGRATION_VERSION,
      errorMessage: failed.errorMessage,
      resultJson: JSON.stringify(failed),
    });
    if (error instanceof ExecutionAuthorityMigrationError) throw error;
    throw new ExecutionAuthorityMigrationError(failed.errorMessage ?? 'Migration 8 failed.');
  }
}

function installExecutionAuthoritySchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ad_keyword_identity_versions (
      identity_version_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      marketplace TEXT NOT NULL CHECK (marketplace = 'US'),
      currency TEXT NOT NULL CHECK (currency = 'USD'),
      canonical_keyword_id TEXT NOT NULL,
      ad_entity_id TEXT NOT NULL,
      entity_revision INTEGER NOT NULL CHECK (entity_revision >= 1),
      ads_account_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      ad_group_id TEXT NOT NULL,
      keyword_id TEXT NOT NULL,
      object_revision INTEGER NOT NULL CHECK (object_revision >= 1),
      observed_bid_cents INTEGER NOT NULL CHECK (observed_bid_cents >= 1),
      page_identity_hash TEXT NOT NULL CHECK (length(page_identity_hash) = 64),
      source_authority_id TEXT NOT NULL,
      source_authority_proof_sha256 TEXT NOT NULL CHECK (length(source_authority_proof_sha256) = 64),
      resolution_proof_sha256 TEXT NOT NULL CHECK (length(resolution_proof_sha256) = 64),
      resolved_session_generation INTEGER NOT NULL CHECK (resolved_session_generation >= 0),
      resolved_at TEXT NOT NULL,
      resolved_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(store_id, identity_version_id),
      UNIQUE(store_id, canonical_keyword_id, object_revision),
      UNIQUE(
        store_id, canonical_keyword_id, object_revision,
        ads_account_id, campaign_id, ad_group_id, keyword_id
      ),
      UNIQUE(store_id, ads_account_id, campaign_id, ad_group_id, keyword_id, object_revision),
      FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, ad_entity_id, entity_revision)
        REFERENCES verified_ad_entity_authority(store_id, ad_entity_id, entity_revision) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, source_authority_id)
        REFERENCES verified_ad_entity_authority(store_id, authority_id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_ad_keyword_identity_current
      ON ad_keyword_identity_versions(store_id, canonical_keyword_id, object_revision DESC);
    CREATE INDEX IF NOT EXISTS idx_ad_keyword_identity_exact
      ON ad_keyword_identity_versions(
        store_id, ads_account_id, campaign_id, ad_group_id, keyword_id, object_revision DESC
      );

    CREATE TABLE IF NOT EXISTS ad_keyword_alias_resolutions (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      alias_type TEXT NOT NULL CHECK (alias_type IN (
        'stage5_ad_entity', 'legacy_writable_target', 'operator_label'
      )),
      alias_hash TEXT NOT NULL CHECK (length(alias_hash) = 64),
      canonical_keyword_id TEXT NOT NULL,
      object_revision INTEGER NOT NULL CHECK (object_revision >= 1),
      resolution_revision INTEGER NOT NULL CHECK (resolution_revision >= 1),
      status TEXT NOT NULL CHECK (status IN ('resolved', 'rejected', 'superseded')),
      reason TEXT,
      resolved_session_generation INTEGER NOT NULL CHECK (resolved_session_generation >= 0),
      resolved_at TEXT NOT NULL,
      resolved_by TEXT NOT NULL,
      UNIQUE(store_id, id),
      UNIQUE(store_id, alias_type, alias_hash, resolution_revision),
      FOREIGN KEY (store_id, canonical_keyword_id, object_revision)
        REFERENCES ad_keyword_identity_versions(store_id, canonical_keyword_id, object_revision)
        ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_ad_keyword_alias_current
      ON ad_keyword_alias_resolutions(store_id, alias_type, alias_hash, resolution_revision DESC);

    CREATE TABLE IF NOT EXISTS ad_execution_batches (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      marketplace TEXT NOT NULL CHECK (marketplace = 'US'),
      currency TEXT NOT NULL CHECK (currency = 'USD'),
      mission_id TEXT NOT NULL,
      mission_revision INTEGER NOT NULL CHECK (mission_revision >= 1),
      grant_id TEXT NOT NULL,
      action_revision INTEGER NOT NULL CHECK (action_revision >= 1),
      status TEXT NOT NULL CHECK (status IN ${STATUS_CHECK}),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_session_generation INTEGER NOT NULL CHECK (created_session_generation >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      terminal_at TEXT,
      UNIQUE(store_id, id),
      UNIQUE(store_id, grant_id),
      FOREIGN KEY (store_id, mission_id) REFERENCES missions(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, grant_id) REFERENCES mission_grants(store_id, id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_ad_execution_batches_queue
      ON ad_execution_batches(store_id, status, created_at, id);

    CREATE TABLE IF NOT EXISTS ad_execution_jobs (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 10),
      mission_id TEXT NOT NULL,
      grant_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      decision_id TEXT NOT NULL,
      decision_revision INTEGER NOT NULL CHECK (decision_revision >= 1),
      action_revision INTEGER NOT NULL CHECK (action_revision >= 1),
      action_type TEXT NOT NULL CHECK (action_type = 'set_keyword_bid'),
      canonical_keyword_id TEXT NOT NULL,
      ad_entity_id TEXT NOT NULL,
      entity_revision INTEGER NOT NULL CHECK (entity_revision >= 1),
      ads_account_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      ad_group_id TEXT NOT NULL,
      keyword_id TEXT NOT NULL,
      object_revision INTEGER NOT NULL CHECK (object_revision >= 1),
      page_identity_hash TEXT NOT NULL CHECK (length(page_identity_hash) = 64),
      expected_bid_cents INTEGER NOT NULL CHECK (expected_bid_cents >= 1),
      target_bid_cents INTEGER NOT NULL CHECK (
        target_bid_cents >= 1 AND target_bid_cents < expected_bid_cents
      ),
      change_pct REAL NOT NULL CHECK (change_pct < 0 AND change_pct >= -10),
      idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) = 64),
      status TEXT NOT NULL CHECK (status IN ${STATUS_CHECK}),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_session_generation INTEGER NOT NULL CHECK (created_session_generation >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      submit_intent_id TEXT CHECK (
        submit_intent_id IS NULL OR length(submit_intent_id) BETWEEN 1 AND 240
      ),
      command_fingerprint TEXT CHECK (
        command_fingerprint IS NULL OR length(command_fingerprint) = 64
      ),
      intent_written_at TEXT,
      submitted_at TEXT,
      terminal_at TEXT,
      CHECK (
        (submit_intent_id IS NULL AND command_fingerprint IS NULL)
        OR (submit_intent_id IS NOT NULL AND command_fingerprint IS NOT NULL)
      ),
      CHECK (
        status NOT IN ('intent_written', 'submitted', 'verifying', 'succeeded', 'unknown')
        OR submit_intent_id IS NOT NULL
      ),
      UNIQUE(store_id, id),
      UNIQUE(store_id, batch_id, ordinal),
      UNIQUE(store_id, batch_id, proposal_id),
      UNIQUE(store_id, idempotency_key),
      UNIQUE(store_id, submit_intent_id),
      FOREIGN KEY (store_id, batch_id) REFERENCES ad_execution_batches(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, mission_id) REFERENCES missions(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, grant_id) REFERENCES mission_grants(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, proposal_id)
        REFERENCES analysis_proposal_snapshots(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, decision_id) REFERENCES decisions(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (
        store_id, canonical_keyword_id, object_revision,
        ads_account_id, campaign_id, ad_group_id, keyword_id
      ) REFERENCES ad_keyword_identity_versions(
        store_id, canonical_keyword_id, object_revision,
        ads_account_id, campaign_id, ad_group_id, keyword_id
      )
        ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_ad_execution_jobs_queue
      ON ad_execution_jobs(store_id, status, batch_id, ordinal);

    CREATE TABLE IF NOT EXISTS ad_execution_events (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence >= 1),
      event_type TEXT NOT NULL CHECK (event_type IN (
        'queued', 'started', 'preflight_verified', 'submit_intent_recorded',
        'submitted', 'after_recorded', 'reload_verified', 'blocked', 'unknown', 'cancelled'
      )),
      from_status TEXT NOT NULL CHECK (from_status IN ${STATUS_CHECK}),
      to_status TEXT NOT NULL CHECK (to_status IN ${STATUS_CHECK}),
      actor_id TEXT NOT NULL,
      reason_code TEXT,
      detail TEXT,
      session_generation INTEGER NOT NULL CHECK (session_generation >= 0),
      created_at TEXT NOT NULL,
      UNIQUE(store_id, id),
      UNIQUE(store_id, job_id, sequence),
      FOREIGN KEY (store_id, batch_id) REFERENCES ad_execution_batches(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, job_id) REFERENCES ad_execution_jobs(store_id, id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_ad_execution_events_job
      ON ad_execution_events(store_id, job_id, sequence);

    CREATE TABLE IF NOT EXISTS ad_execution_evidence (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      slot TEXT NOT NULL CHECK (slot IN ('before', 'after', 'reload')),
      artifact_ref TEXT NOT NULL,
      content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
      page_identity_hash TEXT NOT NULL CHECK (length(page_identity_hash) = 64),
      canonical_keyword_id TEXT NOT NULL,
      object_revision INTEGER NOT NULL CHECK (object_revision >= 1),
      observed_bid_cents INTEGER NOT NULL CHECK (observed_bid_cents >= 1),
      captured_session_generation INTEGER NOT NULL CHECK (captured_session_generation >= 0),
      captured_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(store_id, id),
      UNIQUE(store_id, job_id, slot),
      FOREIGN KEY (store_id, batch_id) REFERENCES ad_execution_batches(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, job_id) REFERENCES ad_execution_jobs(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, canonical_keyword_id, object_revision)
        REFERENCES ad_keyword_identity_versions(store_id, canonical_keyword_id, object_revision)
        ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS ad_execution_domain_reconciliations (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      batch_status TEXT NOT NULL CHECK (batch_status IN (
        'succeeded', 'blocked', 'unknown', 'cancelled'
      )),
      evidence_ref_count INTEGER NOT NULL CHECK (evidence_ref_count >= 0),
      completed_session_generation INTEGER NOT NULL CHECK (completed_session_generation >= 0),
      completed_at TEXT NOT NULL,
      UNIQUE(store_id, batch_id),
      FOREIGN KEY (store_id, batch_id)
        REFERENCES ad_execution_batches(store_id, id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_ad_execution_domain_reconciliations_batch
      ON ad_execution_domain_reconciliations(store_id, batch_id);
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

  database.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_ad_execution_jobs_status_guard
    BEFORE UPDATE OF status ON ad_execution_jobs
    WHEN NOT (
      NEW.status = OLD.status
      OR (OLD.status = 'queued' AND NEW.status IN ('preflight', 'blocked', 'cancelled'))
      OR (OLD.status = 'preflight' AND NEW.status IN ('intent_written', 'blocked', 'cancelled'))
      OR (OLD.status = 'intent_written' AND NEW.status IN ('submitted', 'blocked', 'unknown'))
      OR (OLD.status = 'submitted' AND NEW.status IN ('verifying', 'unknown'))
      OR (OLD.status = 'verifying' AND NEW.status IN ('succeeded', 'unknown'))
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid or terminal ad execution job transition');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_ad_execution_batches_terminal_guard
    BEFORE UPDATE OF status ON ad_execution_batches
    WHEN OLD.status IN ('succeeded', 'blocked', 'unknown', 'cancelled')
      AND NEW.status <> OLD.status
    BEGIN
      SELECT RAISE(ABORT, 'terminal ad execution batch status is immutable');
    END;
  `);
}

export function verifyExecutionAuthoritySchema(database: Database.Database): void {
  assertPrerequisites(database);
  if ((database.pragma('foreign_keys', { simple: true }) as number) !== 1) {
    throw new ExecutionAuthorityMigrationError('SQLite foreign_keys must be enabled for execution authority.');
  }
  const tables = new Set((database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all() as Array<{ name: string }>).map((row) => row.name));
  const triggers = new Map((database.prepare(`
    SELECT name, sql FROM sqlite_master WHERE type = 'trigger'
  `).all() as Array<{ name: string; sql: string }>).map((row) => [row.name, row.sql]));
  for (const table of EXECUTION_AUTHORITY_TABLES) {
    if (!tables.has(table)) {
      throw new ExecutionAuthorityMigrationError(`Required execution table is missing: ${table}.`);
    }
  }
  for (const table of APPEND_ONLY_TABLES) {
    for (const suffix of ['update', 'delete']) {
      const trigger = `trg_${table}_append_only_${suffix}`;
      const sql = triggers.get(trigger);
      if (!sql) {
        throw new ExecutionAuthorityMigrationError(`Required execution trigger is missing: ${trigger}.`);
      }
      const expectedSql = appendOnlyTriggerSql(table, suffix as 'update' | 'delete');
      if (normalizeSql(sql) !== normalizeSql(expectedSql)) {
        throw new ExecutionAuthorityMigrationError(`Required execution trigger definition changed: ${trigger}.`);
      }
    }
  }
  for (const trigger of STATE_GUARD_TRIGGERS) {
    const sql = triggers.get(trigger);
    if (!sql) {
      throw new ExecutionAuthorityMigrationError(`Required execution state guard is missing: ${trigger}.`);
    }
    const expectedSql = trigger === 'trg_ad_execution_jobs_status_guard'
      ? jobStatusGuardTriggerSql()
      : batchTerminalGuardTriggerSql();
    if (normalizeSql(sql) !== normalizeSql(expectedSql)) {
      throw new ExecutionAuthorityMigrationError(`Required execution state guard definition changed: ${trigger}.`);
    }
  }
  const identityColumns = new Set((database.pragma('table_info(ad_keyword_identity_versions)') as Array<{ name: string }>)
    .map((row) => row.name));
  for (const column of [
    'store_id', 'ads_account_id', 'campaign_id', 'ad_group_id', 'keyword_id',
    'object_revision', 'ad_entity_id', 'entity_revision', 'page_identity_hash',
    'source_authority_id', 'source_authority_proof_sha256', 'resolution_proof_sha256',
  ]) {
    if (!identityColumns.has(column)) {
      throw new ExecutionAuthorityMigrationError(`Canonical keyword authority column is missing: ${column}.`);
    }
  }
  const jobColumns = new Set((database.pragma('table_info(ad_execution_jobs)') as Array<{ name: string }>)
    .map((row) => row.name));
  for (const column of ['submit_intent_id', 'command_fingerprint']) {
    if (!jobColumns.has(column)) {
      throw new ExecutionAuthorityMigrationError(`Required execution intent column is missing: ${column}.`);
    }
  }
  const jobSql = String((database.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ad_execution_jobs'
  `).get() as { sql?: string } | undefined)?.sql ?? '');
  if (!/CHECK\s*\(action_type\s*=\s*'set_keyword_bid'\)/i.test(jobSql)
    || !/target_bid_cents\s*<\s*expected_bid_cents/i.test(jobSql)
    || !/ordinal\s+BETWEEN\s+1\s+AND\s+10/i.test(jobSql)
    || !/FOREIGN KEY\s*\(\s*store_id,\s*canonical_keyword_id,\s*object_revision,\s*ads_account_id,\s*campaign_id,\s*ad_group_id,\s*keyword_id\s*\)/i.test(jobSql)) {
    throw new ExecutionAuthorityMigrationError('Execution V1 lower-keyword-bid allowlist is missing.');
  }
  const evidenceColumns = new Set((database.pragma('table_info(ad_execution_evidence)') as Array<{ name: string }>)
    .map((row) => row.name));
  for (const forbidden of ['file_path', 'page_url', 'url_query', 'cookie', 'html']) {
    if (evidenceColumns.has(forbidden)) {
      throw new ExecutionAuthorityMigrationError(`Unsafe execution evidence column is present: ${forbidden}.`);
    }
  }
  const reconciliationColumns = new Set((database.pragma(
    'table_info(ad_execution_domain_reconciliations)',
  ) as Array<{ name: string }>).map((row) => row.name));
  for (const column of [
    'store_id', 'batch_id', 'batch_status', 'evidence_ref_count',
    'completed_session_generation', 'completed_at',
  ]) {
    if (!reconciliationColumns.has(column)) {
      throw new ExecutionAuthorityMigrationError(`Execution reconciliation column is missing: ${column}.`);
    }
  }
  const violations = database.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new ExecutionAuthorityMigrationError('Execution authority foreign-key check failed.');
  }
}

function appendOnlyTriggerSql(table: typeof APPEND_ONLY_TABLES[number], suffix: 'update' | 'delete'): string {
  const operation = suffix === 'update' ? 'UPDATE' : 'DELETE';
  return `
    CREATE TRIGGER trg_${table}_append_only_${suffix}
    BEFORE ${operation} ON ${table}
    BEGIN
      SELECT RAISE(ABORT, '${table} is append-only');
    END
  `;
}

function jobStatusGuardTriggerSql(): string {
  return `
    CREATE TRIGGER trg_ad_execution_jobs_status_guard
    BEFORE UPDATE OF status ON ad_execution_jobs
    WHEN NOT (
      NEW.status = OLD.status
      OR (OLD.status = 'queued' AND NEW.status IN ('preflight', 'blocked', 'cancelled'))
      OR (OLD.status = 'preflight' AND NEW.status IN ('intent_written', 'blocked', 'cancelled'))
      OR (OLD.status = 'intent_written' AND NEW.status IN ('submitted', 'blocked', 'unknown'))
      OR (OLD.status = 'submitted' AND NEW.status IN ('verifying', 'unknown'))
      OR (OLD.status = 'verifying' AND NEW.status IN ('succeeded', 'unknown'))
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid or terminal ad execution job transition');
    END
  `;
}

function batchTerminalGuardTriggerSql(): string {
  return `
    CREATE TRIGGER trg_ad_execution_batches_terminal_guard
    BEFORE UPDATE OF status ON ad_execution_batches
    WHEN OLD.status IN ('succeeded', 'blocked', 'unknown', 'cancelled')
      AND NEW.status <> OLD.status
    BEGIN
      SELECT RAISE(ABORT, 'terminal ad execution batch status is immutable');
    END
  `;
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim().toLowerCase();
}

function assertPrerequisites(database: Database.Database): void {
  const prerequisite = database.prepare(`
    SELECT status FROM schema_migrations WHERE version = 7
  `).get() as { status: string } | undefined;
  if (prerequisite?.status !== 'applied') {
    throw new ExecutionAuthorityMigrationError('Migration 7 must be applied before execution authority migration 8.');
  }
  for (const table of [
    'stores', 'store_connections', 'store_session_metadata', 'missions', 'mission_grants',
    'mission_grant_events', 'decisions', 'analysis_proposal_snapshots',
    'analysis_proposal_decision_links', 'verified_ad_entity_authority',
  ]) {
    const exists = database.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(table);
    if (!exists) {
      throw new ExecutionAuthorityMigrationError(`Required prerequisite table is missing: ${table}.`);
    }
  }
}

function readMigration(database: Database.Database): MigrationRow | undefined {
  return database.prepare(`
    SELECT checksum, status, result_json FROM schema_migrations WHERE version = ?
  `).get(EXECUTION_AUTHORITY_MIGRATION_VERSION) as MigrationRow | undefined;
}

function defaultResult(
  status: MigrationStatus,
  startedAt: string,
  createdTables: number,
): ExecutionAuthorityMigrationResult {
  return {
    version: EXECUTION_AUTHORITY_MIGRATION_VERSION,
    name: EXECUTION_AUTHORITY_MIGRATION_NAME,
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
