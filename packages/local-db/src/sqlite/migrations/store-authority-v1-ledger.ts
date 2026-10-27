// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import Database from 'better-sqlite3';
import type { StoreMigrationBackupManifest, StoreMigrationManifest, StoreMigrationQuarantineReason, StoreMigrationRecoveryPreflight, StoreMigrationRestoreResult, StoreMigrationResult, StoreMigrationTableResult, } from './types';
import { type MigrationStateRow, type StoreAuthorityMigrationDefinition, LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM, StoreAuthorityMigrationError } from './store-authority-v1-contracts';

export function readMigrationState(database: Database.Database, version: number): MigrationStateRow | undefined {
    return database.prepare(`
    SELECT checksum, status, manifest_json, result_json
    FROM schema_migrations
    WHERE version = ?
  `).get(version) as MigrationStateRow | undefined;
}

export function assertMigrationChecksumCompatibility(existing: MigrationStateRow | undefined, migration: StoreAuthorityMigrationDefinition): void {
    if (existing
        && existing.checksum !== migration.checksum
        && existing.checksum !== LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM) {
        throw new StoreAuthorityMigrationError(migration.version, `Migration ${migration.version} checksum does not match the recorded migration.`);
    }
}

export function createStartedResult(migration: StoreAuthorityMigrationDefinition, startedAt: string): StoreMigrationResult {
    return {
        version: migration.version,
        name: migration.name,
        status: 'started',
        startedAt,
        tableResults: [],
        mappedRows: 0,
        quarantinedRows: 0,
        createdStores: 0,
    };
}

export function upsertMigrationState(database: Database.Database, migration: StoreAuthorityMigrationDefinition, manifest: StoreMigrationManifest, result: StoreMigrationResult, status: 'started'): void {
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
        version: migration.version,
        name: migration.name,
        checksum: migration.checksum,
        status,
        startedAt: manifest.startedAt,
        manifestJson: JSON.stringify(manifest),
        resultJson: JSON.stringify(result),
    });
}
