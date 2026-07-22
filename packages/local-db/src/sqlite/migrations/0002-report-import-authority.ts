import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

export const REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION = 2;
export const REPORT_IMPORT_AUTHORITY_MIGRATION_NAME = 'report-import-authority-v2';
export const REPORT_IMPORT_AUTHORITY_MIGRATION_CHECKSUM = 'report-import-authority-v2-20260722-02';

export const REPORT_IMPORT_AUTHORITY_TABLES = [
  'report_import_runs',
  'report_import_file_snapshots',
  'report_import_reconciliations',
] as const;

export const REPORT_IMPORT_PROGRESS_TABLES = [
  'lingxing_collection_jobs',
  'lingxing_collection_report_checkpoints',
] as const;

type MigrationStatus = 'started' | 'applied' | 'failed';

interface MigrationBackupManifest {
  status: 'pending' | 'created' | 'reused' | 'not_applicable';
  databasePath?: string;
  backupPath?: string;
  integrityCheck: string;
  sha256?: string;
  sizeBytes?: number;
}

interface ReportImportMigrationManifest {
  version: number;
  name: string;
  checksum: string;
  startedAt: string;
  schemaFingerprint: string;
  integrityCheck: string;
  tableRowCounts: Record<string, number>;
  targetTables: string[];
  backup: MigrationBackupManifest;
}

export interface ReportImportAuthorityMigrationResult {
  version: number;
  name: string;
  status: MigrationStatus;
  startedAt: string;
  finishedAt?: string;
  createdTables: string[];
  errorMessage?: string;
}

interface MigrationRow {
  checksum: string;
  status: MigrationStatus;
  manifest_json: string;
  result_json: string | null;
}

export class ReportImportAuthorityMigrationError extends Error {
  readonly version = REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION;

  constructor(message: string) {
    super(message);
    this.name = 'ReportImportAuthorityMigrationError';
  }
}

/**
 * Adds the immutable import evidence ledger after the legacy Store Authority
 * migration has assigned or quarantined every legacy owner. The file-backed
 * database is bound to a version-specific backup before any v2 DDL runs.
 */
export function runReportImportAuthorityMigration(
  database: Database.Database,
): ReportImportAuthorityMigrationResult {
  ensureSchemaMigrationsTable(database);
  assertStoreAuthorityApplied(database);

  const existing = readMigration(database);
  if (existing && existing.checksum !== REPORT_IMPORT_AUTHORITY_MIGRATION_CHECKSUM) {
    throw new ReportImportAuthorityMigrationError('Migration 2 checksum does not match the recorded migration.');
  }
  if (existing?.status === 'applied') {
    verifyReportImportAuthoritySchema(database);
    return parseJson(existing.result_json, {
      version: REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION,
      name: REPORT_IMPORT_AUTHORITY_MIGRATION_NAME,
      status: 'applied',
      startedAt: '',
      createdTables: [...REPORT_IMPORT_PROGRESS_TABLES, ...REPORT_IMPORT_AUTHORITY_TABLES],
    });
  }

  const manifest = prepareBoundBackup(database, existing);
  const startedResult: ReportImportAuthorityMigrationResult = {
    version: REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION,
    name: REPORT_IMPORT_AUTHORITY_MIGRATION_NAME,
    status: 'started',
    startedAt: manifest.startedAt,
    createdTables: [],
  };
  writeMigrationState(database, manifest, startedResult, 'started');

  try {
    verifyBoundBackup(database, manifest.backup);
    const apply = database.transaction(() => {
      applyReportImportAuthoritySchema(database);
      verifyReportImportAuthoritySchema(database);
      const result: ReportImportAuthorityMigrationResult = {
        ...startedResult,
        status: 'applied',
        finishedAt: new Date().toISOString(),
        createdTables: [...REPORT_IMPORT_PROGRESS_TABLES, ...REPORT_IMPORT_AUTHORITY_TABLES],
      };
      database.prepare(`
        UPDATE schema_migrations
        SET status = 'applied', applied_at = @appliedAt,
            error_message = NULL, result_json = @resultJson
        WHERE version = @version
      `).run({
        version: REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION,
        appliedAt: result.finishedAt,
        resultJson: JSON.stringify(result),
      });
      return result;
    });
    return apply();
  } catch (error) {
    const failed: ReportImportAuthorityMigrationResult = {
      ...startedResult,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      errorMessage: errorMessage(error),
    };
    database.prepare(`
      UPDATE schema_migrations
      SET status = 'failed', applied_at = NULL,
          error_message = @errorMessage, result_json = @resultJson
      WHERE version = @version
    `).run({
      version: REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION,
      errorMessage: failed.errorMessage,
      resultJson: JSON.stringify(failed),
    });
    if (error instanceof ReportImportAuthorityMigrationError) throw error;
    throw new ReportImportAuthorityMigrationError(failed.errorMessage ?? 'Migration 2 failed.');
  }
}

function prepareBoundBackup(
  database: Database.Database,
  existing: MigrationRow | undefined,
): ReportImportMigrationManifest {
  const previous = parseJson<ReportImportMigrationManifest | undefined>(existing?.manifest_json, undefined);
  if (previous?.backup && isBoundBackup(database, previous.backup)) {
    verifyBoundBackup(database, previous.backup);
    return {
      ...previous,
      backup: previous.backup.status === 'created'
        ? { ...previous.backup, status: 'reused' }
        : previous.backup,
    };
  }

  const integrityCheck = database.pragma('integrity_check', { simple: true }) as string;
  if (integrityCheck !== 'ok') {
    throw new ReportImportAuthorityMigrationError(`Source database integrity_check returned: ${integrityCheck}`);
  }
  const databasePath = fileBackedDatabasePath(database);
  const backupPath = databasePath ? `${databasePath}.pre-report-import-v2.bak` : undefined;
  const pendingBackup: MigrationBackupManifest = databasePath && backupPath
    ? { status: 'pending', databasePath, backupPath, integrityCheck }
    : { status: 'not_applicable', integrityCheck };
  const manifest: ReportImportMigrationManifest = {
    version: REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION,
    name: REPORT_IMPORT_AUTHORITY_MIGRATION_NAME,
    checksum: REPORT_IMPORT_AUTHORITY_MIGRATION_CHECKSUM,
    startedAt: new Date().toISOString(),
    schemaFingerprint: schemaFingerprint(database),
    integrityCheck,
    tableRowCounts: Object.fromEntries([
      'lingxing_report_batches',
      'lingxing_report_files',
      'report_files',
      'ad_daily_metrics',
    ].map((table) => [table, tableExists(database, table) ? countRows(database, table) : 0])),
    targetTables: [...REPORT_IMPORT_PROGRESS_TABLES, ...REPORT_IMPORT_AUTHORITY_TABLES],
    backup: pendingBackup,
  };

  const previousWasMatchingPending = previous?.backup.status === 'pending'
    && previous.backup.backupPath === pendingBackup.backupPath
    && previous.backup.databasePath === pendingBackup.databasePath;
  if (backupPath && fs.existsSync(backupPath) && !previousWasMatchingPending) {
    throw new ReportImportAuthorityMigrationError(
      'An unbound report-import migration backup already exists; refusing to replace it.',
    );
  }

  writeMigrationState(database, manifest, {
    version: REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION,
    name: REPORT_IMPORT_AUTHORITY_MIGRATION_NAME,
    status: 'started',
    startedAt: manifest.startedAt,
    createdTables: [],
  }, 'started');

  if (!databasePath || !backupPath) return manifest;
  if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  database.pragma('wal_checkpoint(FULL)');
  database.exec(`VACUUM INTO ${sqlStringLiteral(backupPath)}`);
  const boundBackup: MigrationBackupManifest = {
    status: 'created',
    databasePath,
    backupPath,
    integrityCheck: checkDatabaseFileIntegrity(backupPath),
    sha256: hashFile(backupPath),
    sizeBytes: fs.statSync(backupPath).size,
  };
  if (boundBackup.integrityCheck !== 'ok') {
    throw new ReportImportAuthorityMigrationError(
      `Backup integrity_check returned: ${boundBackup.integrityCheck}`,
    );
  }
  const boundManifest = { ...manifest, backup: boundBackup };
  database.prepare(`
    UPDATE schema_migrations SET manifest_json = ? WHERE version = ?
  `).run(JSON.stringify(boundManifest), REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION);
  return boundManifest;
}

function applyReportImportAuthoritySchema(database: Database.Database): void {
  for (const table of [
    'lingxing_report_batches',
    'lingxing_report_files',
    'report_files',
    'ad_daily_metrics',
  ]) {
    if (!tableExists(database, table) || !hasColumn(database, table, 'store_id')) {
      throw new ReportImportAuthorityMigrationError(`Store-scoped source table is not ready: ${table}.`);
    }
  }

  ensureColumn(database, 'lingxing_report_batches', 'request_id', 'TEXT');
  ensureColumn(database, 'lingxing_report_batches', 'browser_profile_id', 'TEXT');
  ensureColumn(database, 'lingxing_report_batches', 'business_date', 'TEXT');
  ensureColumn(database, 'lingxing_report_batches', 'session_generation', 'INTEGER');

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lingxing_report_batches_store_batch
      ON lingxing_report_batches(store_id, id);
    CREATE INDEX IF NOT EXISTS idx_lingxing_report_batches_store_dates
      ON lingxing_report_batches(store_id, date_start, date_end, created_at);
    CREATE INDEX IF NOT EXISTS idx_lingxing_report_batches_store_request
      ON lingxing_report_batches(store_id, request_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_lingxing_report_files_store_batch
      ON lingxing_report_files(store_id, batch_id, report_type, updated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_report_files_store_identity
      ON report_files(store_id, batch_id, report_type, file_path)
      WHERE store_id IS NOT NULL;

    DROP INDEX IF EXISTS idx_ad_metrics_unique_daily_report_identity;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_metrics_unique_store_daily_report_identity
      ON ad_daily_metrics(
        COALESCE(store_id, ''),
        COALESCE(batch_id, ''),
        COALESCE(report_type, ''),
        COALESCE(date, ''),
        COALESCE(asin, ''),
        COALESCE(msku, ''),
        COALESCE(campaign_name, ''),
        COALESCE(ad_group_name, ''),
        COALESCE(targeting, ''),
        COALESCE(search_term, ''),
        COALESCE(match_type, ''),
        COALESCE(source_file, ''),
        COALESCE(source_row, -1)
      );

    CREATE TABLE IF NOT EXISTS lingxing_collection_jobs (
      store_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      browser_profile_id TEXT NOT NULL,
      marketplace TEXT NOT NULL CHECK (marketplace = 'US'),
      currency TEXT NOT NULL CHECK (currency = 'USD'),
      business_timezone TEXT NOT NULL,
      business_date TEXT NOT NULL,
      session_generation INTEGER NOT NULL CHECK (session_generation >= 0),
      date_start TEXT NOT NULL,
      date_end TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('create-and-download', 'download-existing')),
      report_types_json TEXT NOT NULL,
      state TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      last_event_id TEXT,
      last_event_emitted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      blocker_code TEXT,
      detail TEXT,
      PRIMARY KEY (store_id, job_id),
      FOREIGN KEY (store_id) REFERENCES stores(store_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lingxing_collection_jobs_store_request_job
      ON lingxing_collection_jobs(store_id, request_id, job_id);
    CREATE INDEX IF NOT EXISTS idx_lingxing_collection_jobs_store_updated
      ON lingxing_collection_jobs(store_id, updated_at DESC, job_id);

    CREATE TABLE IF NOT EXISTS lingxing_collection_report_checkpoints (
      store_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      state TEXT NOT NULL,
      attempt_index INTEGER NOT NULL CHECK (attempt_index >= 0),
      auto_retry_count INTEGER NOT NULL CHECK (auto_retry_count >= 0),
      created_report_identity_json TEXT,
      file_size_bytes INTEGER CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
      error_code TEXT,
      detail TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (store_id, job_id, report_type),
      FOREIGN KEY (store_id, job_id)
        REFERENCES lingxing_collection_jobs(store_id, job_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lingxing_collection_checkpoints_state
      ON lingxing_collection_report_checkpoints(store_id, job_id, state);

    CREATE TABLE IF NOT EXISTS report_import_runs (
      store_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status = 'completed'),
      source_file_count INTEGER NOT NULL CHECK (source_file_count >= 0),
      metric_row_count INTEGER NOT NULL CHECK (metric_row_count >= 0),
      reconciliation_count INTEGER NOT NULL CHECK (reconciliation_count >= 0),
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (store_id, run_id),
      UNIQUE (store_id, idempotency_key),
      FOREIGN KEY (store_id) REFERENCES stores(store_id),
      FOREIGN KEY (store_id, batch_id)
        REFERENCES lingxing_report_batches(store_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_report_import_runs_store_completed
      ON report_import_runs(store_id, completed_at DESC);

    CREATE TABLE IF NOT EXISTS report_import_file_snapshots (
      store_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      lingxing_file_id TEXT,
      report_file_id INTEGER,
      report_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes >= 0),
      file_hash TEXT NOT NULL,
      imported_rows INTEGER NOT NULL CHECK (imported_rows >= 0),
      captured_at TEXT NOT NULL,
      PRIMARY KEY (store_id, snapshot_id),
      UNIQUE (store_id, run_id, report_type, file_path, file_hash),
      FOREIGN KEY (store_id, run_id)
        REFERENCES report_import_runs(store_id, run_id),
      FOREIGN KEY (store_id, batch_id)
        REFERENCES lingxing_report_batches(store_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_report_import_file_snapshots_run
      ON report_import_file_snapshots(store_id, run_id, report_type);

    CREATE TABLE IF NOT EXISTS report_import_reconciliations (
      store_id TEXT NOT NULL,
      reconciliation_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      report_type TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
      expected_rows INTEGER NOT NULL CHECK (expected_rows >= 0),
      actual_rows INTEGER NOT NULL CHECK (actual_rows >= 0),
      expected_cost_1e4 INTEGER NOT NULL,
      actual_cost_1e4 INTEGER NOT NULL,
      absolute_cost_delta_1e4 INTEGER NOT NULL CHECK (absolute_cost_delta_1e4 >= 0),
      tolerance_1e4 INTEGER NOT NULL CHECK (tolerance_1e4 >= 0),
      within_tolerance INTEGER NOT NULL CHECK (within_tolerance IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('matched', 'mismatch')),
      reconciled_at TEXT NOT NULL,
      PRIMARY KEY (store_id, reconciliation_id),
      UNIQUE (store_id, run_id, metric_date, report_type),
      FOREIGN KEY (store_id, run_id)
        REFERENCES report_import_runs(store_id, run_id),
      FOREIGN KEY (store_id, batch_id)
        REFERENCES lingxing_report_batches(store_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_report_import_reconciliations_run
      ON report_import_reconciliations(store_id, run_id, status);

    CREATE TRIGGER IF NOT EXISTS trg_lingxing_report_files_store_batch_insert
    BEFORE INSERT ON lingxing_report_files
    WHEN NEW.store_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM lingxing_report_batches WHERE id = NEW.batch_id)
      AND NOT EXISTS (
        SELECT 1 FROM lingxing_report_batches
        WHERE id = NEW.batch_id AND store_id = NEW.store_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'lingxing report file batch belongs to another store');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_report_files_store_batch_insert
    BEFORE INSERT ON report_files
    WHEN NEW.store_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM lingxing_report_batches WHERE id = NEW.batch_id)
      AND NOT EXISTS (
        SELECT 1 FROM lingxing_report_batches
        WHERE id = NEW.batch_id AND store_id = NEW.store_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'report file batch belongs to another store');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_ad_metrics_store_batch_insert
    BEFORE INSERT ON ad_daily_metrics
    WHEN NEW.store_id IS NOT NULL
      AND NEW.batch_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM lingxing_report_batches WHERE id = NEW.batch_id)
      AND NOT EXISTS (
        SELECT 1 FROM lingxing_report_batches
        WHERE id = NEW.batch_id AND store_id = NEW.store_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'ad metric batch belongs to another store');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_ad_metrics_legacy_identity_insert
    BEFORE INSERT ON ad_daily_metrics
    WHEN NEW.store_id IS NULL
      AND EXISTS (
        SELECT 1 FROM ad_daily_metrics existing
        WHERE COALESCE(existing.batch_id, '') = COALESCE(NEW.batch_id, '')
          AND COALESCE(existing.report_type, '') = COALESCE(NEW.report_type, '')
          AND COALESCE(existing.date, '') = COALESCE(NEW.date, '')
          AND COALESCE(existing.store_name, '') = COALESCE(NEW.store_name, '')
          AND COALESCE(existing.marketplace_code, '') = COALESCE(NEW.marketplace_code, '')
          AND COALESCE(existing.asin, '') = COALESCE(NEW.asin, '')
          AND COALESCE(existing.msku, '') = COALESCE(NEW.msku, '')
          AND COALESCE(existing.campaign_name, '') = COALESCE(NEW.campaign_name, '')
          AND COALESCE(existing.ad_group_name, '') = COALESCE(NEW.ad_group_name, '')
          AND COALESCE(existing.targeting, '') = COALESCE(NEW.targeting, '')
          AND COALESCE(existing.search_term, '') = COALESCE(NEW.search_term, '')
          AND COALESCE(existing.match_type, '') = COALESCE(NEW.match_type, '')
          AND COALESCE(existing.source_file, '') = COALESCE(NEW.source_file, '')
          AND COALESCE(existing.source_row, -1) = COALESCE(NEW.source_row, -1)
      )
    BEGIN
      SELECT RAISE(ABORT, 'legacy ad metric identity constraint');
    END;
  `);

  for (const table of REPORT_IMPORT_AUTHORITY_TABLES) {
    database.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_${table}_immutable_update
      BEFORE UPDATE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} is immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS trg_${table}_immutable_delete
      BEFORE DELETE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} is immutable');
      END;
    `);
  }
}

export function verifyReportImportAuthoritySchema(database: Database.Database): void {
  for (const table of REPORT_IMPORT_PROGRESS_TABLES) {
    if (!tableExists(database, table)) {
      throw new ReportImportAuthorityMigrationError(`Required collection progress table is missing: ${table}.`);
    }
  }
  for (const table of REPORT_IMPORT_AUTHORITY_TABLES) {
    if (!tableExists(database, table)) {
      throw new ReportImportAuthorityMigrationError(`Required import authority table is missing: ${table}.`);
    }
    for (const operation of ['update', 'delete']) {
      const trigger = `trg_${table}_immutable_${operation}`;
      if (!database.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?
      `).get(trigger)) {
        throw new ReportImportAuthorityMigrationError(`Required immutable trigger is missing: ${trigger}.`);
      }
    }
  }
  if (!database.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_ad_metrics_unique_store_daily_report_identity'
  `).get()) {
    throw new ReportImportAuthorityMigrationError('Store-scoped ad metric identity index is missing.');
  }
}

function ensureSchemaMigrationsTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('started', 'applied', 'failed')),
      started_at TEXT NOT NULL,
      applied_at TEXT,
      error_message TEXT,
      manifest_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT
    )
  `);
}

function assertStoreAuthorityApplied(database: Database.Database): void {
  const migration = database.prepare(`
    SELECT status FROM schema_migrations WHERE version = 1
  `).get() as { status: string } | undefined;
  if (migration?.status !== 'applied') {
    throw new ReportImportAuthorityMigrationError('Store Authority migration v1 must be applied before migration v2.');
  }
}

function readMigration(database: Database.Database): MigrationRow | undefined {
  return database.prepare(`
    SELECT checksum, status, manifest_json, result_json
    FROM schema_migrations WHERE version = ?
  `).get(REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION) as MigrationRow | undefined;
}

function writeMigrationState(
  database: Database.Database,
  manifest: ReportImportMigrationManifest,
  result: ReportImportAuthorityMigrationResult,
  status: 'started',
): void {
  database.prepare(`
    INSERT INTO schema_migrations (
      version, name, checksum, status, started_at, applied_at,
      error_message, manifest_json, result_json
    ) VALUES (
      @version, @name, @checksum, @status, @startedAt, NULL,
      NULL, @manifestJson, @resultJson
    )
    ON CONFLICT(version) DO UPDATE SET
      name = excluded.name,
      checksum = excluded.checksum,
      status = excluded.status,
      started_at = excluded.started_at,
      applied_at = NULL,
      error_message = NULL,
      manifest_json = excluded.manifest_json,
      result_json = excluded.result_json
  `).run({
    version: REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION,
    name: REPORT_IMPORT_AUTHORITY_MIGRATION_NAME,
    checksum: REPORT_IMPORT_AUTHORITY_MIGRATION_CHECKSUM,
    status,
    startedAt: manifest.startedAt,
    manifestJson: JSON.stringify(manifest),
    resultJson: JSON.stringify(result),
  });
}

function verifyBoundBackup(database: Database.Database, backup: MigrationBackupManifest): void {
  if (backup.status === 'not_applicable') return;
  if (!isBoundBackup(database, backup) || !backup.backupPath || !fs.existsSync(backup.backupPath)) {
    throw new ReportImportAuthorityMigrationError('Migration 2 does not have a valid bound pre-migration backup.');
  }
  const integrityCheck = checkDatabaseFileIntegrity(backup.backupPath);
  const sha256 = hashFile(backup.backupPath);
  if (integrityCheck !== 'ok' || sha256 !== backup.sha256) {
    throw new ReportImportAuthorityMigrationError('Migration 2 backup integrity or SHA-256 binding failed.');
  }
}

function isBoundBackup(database: Database.Database, backup: MigrationBackupManifest): boolean {
  const databasePath = fileBackedDatabasePath(database);
  if (!databasePath) return backup.status === 'not_applicable';
  return (backup.status === 'created' || backup.status === 'reused')
    && backup.databasePath === databasePath
    && backup.backupPath === `${databasePath}.pre-report-import-v2.bak`
    && Boolean(backup.sha256);
}

function fileBackedDatabasePath(database: Database.Database): string | undefined {
  const name = database.name;
  if (!name || name === ':memory:' || name.startsWith('file::memory:')) return undefined;
  return path.resolve(name);
}

function checkDatabaseFileIntegrity(filePath: string): string {
  const backup = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return backup.pragma('integrity_check', { simple: true }) as string;
  } finally {
    backup.close();
  }
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function schemaFingerprint(database: Database.Database): string {
  const schema = database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all();
  return createHash('sha256').update(JSON.stringify(schema)).digest('hex');
}

function tableExists(database: Database.Database, table: string): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table));
}

function hasColumn(database: Database.Database, table: string, column: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((candidate) => candidate.name === column);
}

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  if (!hasColumn(database, table, column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function countRows(database: Database.Database, table: string): number {
  return Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
