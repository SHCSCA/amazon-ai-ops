import { STORE_AUTHORITY_MIGRATION_VERSION, STORE_PROVIDER_IDENTITY_UNIQUE_INDEX, STORE_SCOPED_LEGACY_TABLES, getStoreMigrationRecoveryPreflight, getUpgradeBackupRecoveryPreflight, restoreStoreMigrationBackupTo, restoreUpgradeBackupTo, installStoreProviderIdentitySqlFunction, upgradeBackupFromMigrationManifest, type SchemaMigrationRecord, type SchemaMigrationManifest, type StoreMigrationManifest, type StoreMigrationQuarantineReason, type StoreMigrationQuarantineRecord, type StoreMigrationRecoveryPreflight, type StoreMigrationRestoreResult, type StoreMigrationResult, } from '../migrations';
import { type SchemaMigrationRow, StoreRepositoryError } from './store-repository-contracts';
import { mapSchemaMigration, isStoreMigrationManifest } from './store-repository-records';
import type { StoreRepositoryContext } from './store-repository-context';

export function listSchemaMigrations(repositoryContext: StoreRepositoryContext): SchemaMigrationRecord[] {
    const rows = repositoryContext.db.prepare(`
      SELECT * FROM schema_migrations ORDER BY version
    `).all() as SchemaMigrationRow[];
    return rows.map(mapSchemaMigration);
}

export function getSchemaMigration(repositoryContext: StoreRepositoryContext, version = STORE_AUTHORITY_MIGRATION_VERSION): SchemaMigrationRecord | undefined {
    const row = repositoryContext.db.prepare(`
      SELECT * FROM schema_migrations WHERE version = ?
    `).get(version) as SchemaMigrationRow | undefined;
    return row ? mapSchemaMigration(row) : undefined;
}

export function getMigrationManifest(repositoryContext: StoreRepositoryContext, version = STORE_AUTHORITY_MIGRATION_VERSION): SchemaMigrationManifest | undefined {
    return repositoryContext.methods.getSchemaMigration(version)?.manifest;
}

export function getMigrationResult(repositoryContext: StoreRepositoryContext, version = STORE_AUTHORITY_MIGRATION_VERSION): StoreMigrationResult | undefined {
    return repositoryContext.methods.getSchemaMigration(version)?.result;
}

export function getMigrationRecoveryPreflight(repositoryContext: StoreRepositoryContext, version = STORE_AUTHORITY_MIGRATION_VERSION): StoreMigrationRecoveryPreflight {
    const migration = repositoryContext.methods.getSchemaMigration(version);
    if (!migration) {
        throw new StoreRepositoryError('MIGRATION_NOT_FOUND', `Migration ${version} was not found.`);
    }
    if (version === STORE_AUTHORITY_MIGRATION_VERSION && isStoreMigrationManifest(migration.manifest)) {
        return getStoreMigrationRecoveryPreflight(migration.manifest);
    }
    const upgradeBackup = upgradeBackupFromMigrationManifest(migration.manifest);
    if (!upgradeBackup) {
        throw new StoreRepositoryError('MIGRATION_NOT_FOUND', `Migration ${version} does not contain a recoverable upgrade backup.`);
    }
    return getUpgradeBackupRecoveryPreflight(upgradeBackup);
}

export function restoreMigrationBackupTo(repositoryContext: StoreRepositoryContext, destinationPath: string, version = STORE_AUTHORITY_MIGRATION_VERSION): StoreMigrationRestoreResult {
    const migration = repositoryContext.methods.getSchemaMigration(version);
    if (!migration) {
        throw new StoreRepositoryError('MIGRATION_NOT_FOUND', `Migration ${version} was not found.`);
    }
    if (version === STORE_AUTHORITY_MIGRATION_VERSION && isStoreMigrationManifest(migration.manifest)) {
        return restoreStoreMigrationBackupTo(migration.manifest, destinationPath);
    }
    const upgradeBackup = upgradeBackupFromMigrationManifest(migration.manifest);
    if (!upgradeBackup) {
        throw new StoreRepositoryError('MIGRATION_NOT_FOUND', `Migration ${version} does not contain a recoverable upgrade backup.`);
    }
    return restoreUpgradeBackupTo(upgradeBackup, destinationPath);
}
