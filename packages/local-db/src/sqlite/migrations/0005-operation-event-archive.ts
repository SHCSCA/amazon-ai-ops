import Database from 'better-sqlite3';
import { ensureSchemaMigrationsTable } from './0001-store-authority';

export const OPERATION_EVENT_ARCHIVE_MIGRATION_VERSION = 5;
export const OPERATION_EVENT_ARCHIVE_MIGRATION_NAME = 'operation-event-archive-v5';
export const OPERATION_EVENT_ARCHIVE_MIGRATION_CHECKSUM = 'operation-event-archive-v5-20260722-01';
export const OPERATION_EVENT_ARCHIVE_INDEX = 'idx_operation_events_store_archive_date';

type MigrationStatus = 'started' | 'applied' | 'failed';

interface OperationEventArchiveManifest {
  version: number;
  name: string;
  checksum: string;
  startedAt: string;
  integrityCheck: string;
  operationEventRowCount: number;
}

export interface OperationEventArchiveMigrationResult {
  version: number;
  name: string;
  status: MigrationStatus;
  startedAt: string;
  finishedAt?: string;
  preservedEventRows: number;
  errorMessage?: string;
}

interface MigrationRow {
  checksum: string;
  status: MigrationStatus;
  manifest_json: string;
  result_json: string | null;
}

interface TableColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | number | null;
}

export class OperationEventArchiveMigrationError extends Error {
  readonly version = OPERATION_EVENT_ARCHIVE_MIGRATION_VERSION;

  constructor(message: string) {
    super(message);
    this.name = 'OperationEventArchiveMigrationError';
  }
}

/**
 * Adds reversible archival metadata to durable operation-event facts.
 *
 * This migration is intentionally additive: no event row is rewritten or
 * deleted. The row count is bound before DDL and checked again in the same
 * transaction so an upgrade can never silently trade history for schema.
 */
export function runOperationEventArchiveMigration(
  database: Database.Database,
): OperationEventArchiveMigrationResult {
  ensureSchemaMigrationsTable(database);
  assertListingStoreAuthorityApplied(database);

  const existing = readMigration(database);
  if (existing && existing.checksum !== OPERATION_EVENT_ARCHIVE_MIGRATION_CHECKSUM) {
    throw new OperationEventArchiveMigrationError(
      'Migration 5 checksum does not match the recorded migration.',
    );
  }
  if (existing?.status === 'applied') {
    verifyOperationEventArchiveSchema(database);
    return parseJson(existing.result_json, defaultResult('applied', '', 0));
  }

  assertSourceSchemaReady(database);
  const integrityCheck = database.pragma('integrity_check', { simple: true }) as string;
  if (integrityCheck !== 'ok') {
    throw new OperationEventArchiveMigrationError(
      `Source database integrity_check returned: ${integrityCheck}`,
    );
  }
  const manifest: OperationEventArchiveManifest = {
    version: OPERATION_EVENT_ARCHIVE_MIGRATION_VERSION,
    name: OPERATION_EVENT_ARCHIVE_MIGRATION_NAME,
    checksum: OPERATION_EVENT_ARCHIVE_MIGRATION_CHECKSUM,
    startedAt: new Date().toISOString(),
    integrityCheck,
    operationEventRowCount: countRows(database),
  };
  const started = defaultResult('started', manifest.startedAt, manifest.operationEventRowCount);
  writeStartedState(database, manifest, started);

  try {
    return database.transaction(() => {
      applyOperationEventArchiveSchema(database);
      if (countRows(database) !== manifest.operationEventRowCount) {
        throw new OperationEventArchiveMigrationError(
          'Operation-event row count changed while installing archive authority.',
        );
      }
      verifyOperationEventArchiveSchema(database);
      const result: OperationEventArchiveMigrationResult = {
        ...started,
        status: 'applied',
        finishedAt: new Date().toISOString(),
      };
      database.prepare(`
        UPDATE schema_migrations
        SET status = 'applied', applied_at = @appliedAt,
            error_message = NULL, result_json = @resultJson
        WHERE version = @version
      `).run({
        version: OPERATION_EVENT_ARCHIVE_MIGRATION_VERSION,
        appliedAt: result.finishedAt,
        resultJson: JSON.stringify(result),
      });
      return result;
    }).immediate();
  } catch (error) {
    const failed: OperationEventArchiveMigrationResult = {
      ...started,
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
      version: OPERATION_EVENT_ARCHIVE_MIGRATION_VERSION,
      errorMessage: failed.errorMessage,
      resultJson: JSON.stringify(failed),
    });
    if (error instanceof OperationEventArchiveMigrationError) throw error;
    throw new OperationEventArchiveMigrationError(
      failed.errorMessage ?? 'Migration 5 failed.',
    );
  }
}

export function verifyOperationEventArchiveSchema(database: Database.Database): void {
  assertSourceSchemaReady(database);
  const columns = database.prepare('PRAGMA table_info(operation_events)').all() as TableColumn[];
  const archivedAt = columns.find((column) => column.name === 'archived_at');
  const archiveRevision = columns.find((column) => column.name === 'archive_revision');
  if (!archivedAt || archivedAt.type.toUpperCase() !== 'TEXT') {
    throw new OperationEventArchiveMigrationError(
      'operation_events.archived_at is missing or malformed.',
    );
  }
  if (!archiveRevision
    || archiveRevision.type.toUpperCase() !== 'INTEGER'
    || archiveRevision.notnull !== 1
    || normalizeDefault(archiveRevision.dflt_value) !== '0') {
    throw new OperationEventArchiveMigrationError(
      'operation_events.archive_revision is missing or malformed.',
    );
  }

  const index = database.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'index' AND name = ?
  `).get(OPERATION_EVENT_ARCHIVE_INDEX) as { sql: string | null } | undefined;
  const metadata = (database.prepare('PRAGMA index_list(operation_events)').all() as Array<{
    name: string;
    unique: number;
  }>).find((candidate) => candidate.name === OPERATION_EVENT_ARCHIVE_INDEX);
  const normalizedSql = (index?.sql ?? '').toLowerCase().replace(/[\s"`\[\]]+/g, '');
  if (metadata?.unique !== 0
    || !normalizedSql.includes(
      'onoperation_events(store_id,archived_at,event_datedesc,iddesc)',
    )) {
    throw new OperationEventArchiveMigrationError(
      `Required operation-event archive index is missing or malformed: ${OPERATION_EVENT_ARCHIVE_INDEX}.`,
    );
  }

  const invalidRevision = database.prepare(`
    SELECT id
    FROM operation_events
    WHERE archive_revision IS NULL
       OR typeof(archive_revision) <> 'integer'
       OR archive_revision < 0
       OR (archived_at IS NOT NULL AND archive_revision < 1)
    ORDER BY id
    LIMIT 1
  `).get() as { id: number } | undefined;
  if (invalidRevision) {
    throw new OperationEventArchiveMigrationError(
      `Operation-event archive revision is invalid for row ${invalidRevision.id}.`,
    );
  }
}

function applyOperationEventArchiveSchema(database: Database.Database): void {
  const columns = database.prepare('PRAGMA table_info(operation_events)').all() as TableColumn[];
  if (!columns.some((column) => column.name === 'archived_at')) {
    database.exec('ALTER TABLE operation_events ADD COLUMN archived_at TEXT');
  }
  if (!columns.some((column) => column.name === 'archive_revision')) {
    database.exec(
      'ALTER TABLE operation_events ADD COLUMN archive_revision INTEGER NOT NULL DEFAULT 0',
    );
  }
  database.exec(`
    DROP INDEX IF EXISTS ${OPERATION_EVENT_ARCHIVE_INDEX};
    CREATE INDEX ${OPERATION_EVENT_ARCHIVE_INDEX}
      ON operation_events(store_id, archived_at, event_date DESC, id DESC);
  `);
}

function assertSourceSchemaReady(database: Database.Database): void {
  const table = database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'operation_events'
  `).get();
  if (!table) {
    throw new OperationEventArchiveMigrationError('Required table is missing: operation_events.');
  }
  const columns = database.prepare('PRAGMA table_info(operation_events)').all() as TableColumn[];
  for (const name of ['id', 'store_id', 'event_date', 'updated_at']) {
    if (!columns.some((column) => column.name === name)) {
      throw new OperationEventArchiveMigrationError(
        `operation_events.${name} is required before migration 5.`,
      );
    }
  }
}

function assertListingStoreAuthorityApplied(database: Database.Database): void {
  const migration = database.prepare(`
    SELECT status FROM schema_migrations WHERE version = 4
  `).get() as { status: string } | undefined;
  if (migration?.status !== 'applied') {
    throw new OperationEventArchiveMigrationError(
      'Listing Store Authority migration v4 must be applied before migration v5.',
    );
  }
}

function readMigration(database: Database.Database): MigrationRow | undefined {
  return database.prepare(`
    SELECT checksum, status, manifest_json, result_json
    FROM schema_migrations WHERE version = ?
  `).get(OPERATION_EVENT_ARCHIVE_MIGRATION_VERSION) as MigrationRow | undefined;
}

function writeStartedState(
  database: Database.Database,
  manifest: OperationEventArchiveManifest,
  result: OperationEventArchiveMigrationResult,
): void {
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
    version: OPERATION_EVENT_ARCHIVE_MIGRATION_VERSION,
    name: OPERATION_EVENT_ARCHIVE_MIGRATION_NAME,
    checksum: OPERATION_EVENT_ARCHIVE_MIGRATION_CHECKSUM,
    startedAt: manifest.startedAt,
    manifestJson: JSON.stringify(manifest),
    resultJson: JSON.stringify(result),
  });
}

function defaultResult(
  status: MigrationStatus,
  startedAt: string,
  preservedEventRows: number,
): OperationEventArchiveMigrationResult {
  return {
    version: OPERATION_EVENT_ARCHIVE_MIGRATION_VERSION,
    name: OPERATION_EVENT_ARCHIVE_MIGRATION_NAME,
    status,
    startedAt,
    preservedEventRows,
  };
}

function countRows(database: Database.Database): number {
  return Number((database.prepare(`
    SELECT COUNT(*) AS count FROM operation_events
  `).get() as { count: number }).count);
}

function normalizeDefault(value: string | number | null): string {
  return String(value ?? '').trim().replace(/^\((.*)\)$/u, '$1').replace(/^['"]|['"]$/gu, '');
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
