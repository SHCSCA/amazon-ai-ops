import Database from 'better-sqlite3';
import {
  ensureSchemaMigrationsTable,
  repairPendingStoreAuthorityQuarantines,
} from './0001-store-authority';
import { prepareUpgradeBackup } from './upgrade-backup';
import type { UpgradeBackupManifest } from './types';

export const STORE_AUTHORITY_REPAIR_MIGRATION_VERSION = 9;
export const STORE_AUTHORITY_REPAIR_MIGRATION_NAME = 'store-authority-quarantine-repair-v9';
export const STORE_AUTHORITY_REPAIR_MIGRATION_CHECKSUM = 'store-authority-quarantine-repair-v9-20260727-02';

type MigrationStatus = 'started' | 'applied' | 'failed';

interface MigrationRow {
  checksum: string;
  status: MigrationStatus;
  result_json: string | null;
}

export interface StoreAuthorityRepairMigrationResult {
  version: number;
  name: string;
  status: MigrationStatus;
  startedAt: string;
  finishedAt?: string;
  examinedRows: number;
  repairedRows: number;
  remainingPendingRows: number;
  passes: number;
  errorMessage?: string;
}

export class StoreAuthorityRepairMigrationError extends Error {
  readonly version = STORE_AUTHORITY_REPAIR_MIGRATION_VERSION;

  constructor(message: string) {
    super(message);
    this.name = 'StoreAuthorityRepairMigrationError';
  }
}

export function runStoreAuthorityRepairMigration(
  database: Database.Database,
  preparedUpgradeBackup?: UpgradeBackupManifest,
): StoreAuthorityRepairMigrationResult {
  ensureSchemaMigrationsTable(database);
  assertPrerequisites(database);
  const existing = readMigration(database);
  if (existing && existing.checksum !== STORE_AUTHORITY_REPAIR_MIGRATION_CHECKSUM) {
    throw new StoreAuthorityRepairMigrationError('Migration 9 checksum does not match recorded history.');
  }
  if (existing?.status === 'applied') {
    return parseResult(existing.result_json);
  }

  const integrityCheck = database.pragma('integrity_check', { simple: true }) as string;
  if (integrityCheck !== 'ok') {
    throw new StoreAuthorityRepairMigrationError(
      `Source database integrity_check returned: ${integrityCheck}`,
    );
  }
  const startedAt = new Date().toISOString();
  const started = defaultResult('started', startedAt);
  const upgradeBackup = preparedUpgradeBackup ?? prepareUpgradeBackup(database, {
    targetVersion: STORE_AUTHORITY_REPAIR_MIGRATION_VERSION,
    targetName: STORE_AUTHORITY_REPAIR_MIGRATION_NAME,
    targetChecksum: STORE_AUTHORITY_REPAIR_MIGRATION_CHECKSUM,
  });
  const manifest = {
    version: STORE_AUTHORITY_REPAIR_MIGRATION_VERSION,
    name: STORE_AUTHORITY_REPAIR_MIGRATION_NAME,
    checksum: STORE_AUTHORITY_REPAIR_MIGRATION_CHECKSUM,
    prerequisiteVersion: 8,
    integrityCheck,
    startedAt,
    repairPolicy: {
      sourceMigrationVersion: 1,
      eligibleReasons: ['missing_store_identity', 'missing_parent_store'],
      ambiguousOrConflictingRowsRemainPending: true,
      candidatePendingScope: 'all_versions',
      targetWithAnyOtherPendingRemainsPending: true,
    },
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
    version: STORE_AUTHORITY_REPAIR_MIGRATION_VERSION,
    name: STORE_AUTHORITY_REPAIR_MIGRATION_NAME,
    checksum: STORE_AUTHORITY_REPAIR_MIGRATION_CHECKSUM,
    startedAt,
    manifestJson: JSON.stringify(manifest),
    resultJson: JSON.stringify(started),
  });

  try {
    return database.transaction(() => {
      const repaired = repairPendingStoreAuthorityQuarantines(database);
      const result: StoreAuthorityRepairMigrationResult = {
        ...started,
        ...repaired,
        status: 'applied',
        finishedAt: new Date().toISOString(),
      };
      database.prepare(`
        UPDATE schema_migrations
        SET status = 'applied',
            applied_at = @appliedAt,
            error_message = NULL,
            result_json = @resultJson
        WHERE version = @version
      `).run({
        version: STORE_AUTHORITY_REPAIR_MIGRATION_VERSION,
        appliedAt: result.finishedAt,
        resultJson: JSON.stringify(result),
      });
      return result;
    }).immediate();
  } catch (error) {
    const failed: StoreAuthorityRepairMigrationResult = {
      ...started,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      errorMessage: errorMessage(error),
    };
    database.prepare(`
      UPDATE schema_migrations
      SET status = 'failed',
          applied_at = NULL,
          error_message = @errorMessage,
          result_json = @resultJson
      WHERE version = @version
    `).run({
      version: STORE_AUTHORITY_REPAIR_MIGRATION_VERSION,
      errorMessage: failed.errorMessage,
      resultJson: JSON.stringify(failed),
    });
    if (error instanceof StoreAuthorityRepairMigrationError) throw error;
    throw new StoreAuthorityRepairMigrationError(failed.errorMessage ?? 'Migration 9 failed.');
  }
}

function assertPrerequisites(database: Database.Database): void {
  const prerequisite = database.prepare(`
    SELECT status
    FROM schema_migrations
    WHERE version = 8
  `).get() as { status: string } | undefined;
  if (prerequisite?.status !== 'applied') {
    throw new StoreAuthorityRepairMigrationError(
      'Migration 8 must be applied before store authority repair migration 9.',
    );
  }
}

function readMigration(database: Database.Database): MigrationRow | undefined {
  return database.prepare(`
    SELECT checksum, status, result_json
    FROM schema_migrations
    WHERE version = ?
  `).get(STORE_AUTHORITY_REPAIR_MIGRATION_VERSION) as MigrationRow | undefined;
}

function defaultResult(
  status: MigrationStatus,
  startedAt: string,
): StoreAuthorityRepairMigrationResult {
  return {
    version: STORE_AUTHORITY_REPAIR_MIGRATION_VERSION,
    name: STORE_AUTHORITY_REPAIR_MIGRATION_NAME,
    status,
    startedAt,
    examinedRows: 0,
    repairedRows: 0,
    remainingPendingRows: 0,
    passes: 0,
  };
}

function parseResult(value: string | null): StoreAuthorityRepairMigrationResult {
  if (!value) return defaultResult('applied', '');
  try {
    return JSON.parse(value) as StoreAuthorityRepairMigrationResult;
  } catch {
    return defaultResult('applied', '');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
