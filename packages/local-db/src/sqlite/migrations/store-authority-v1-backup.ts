// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import type { StoreMigrationBackupManifest, StoreMigrationManifest, StoreMigrationQuarantineReason, StoreMigrationRecoveryPreflight, StoreMigrationRestoreResult, StoreMigrationResult, StoreMigrationTableResult, } from './types';
import { ensureSchemaMigrationsTable, checkDatabaseIntegrity, checkDatabaseFileIntegrity, verifyStoreAuthoritySchema, tableExists, countRows, schemaFingerprint } from './store-authority-v1-schema';
import { readMigrationState, assertMigrationChecksumCompatibility, createStartedResult, upsertMigrationState } from './store-authority-v1-ledger';
import { parseJson, errorMessage, hashFile, sameResolvedPath, sqlStringLiteral } from './store-authority-v1-values';
import { type StoreAuthorityMigrationManifest, LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM, StoreAuthorityMigrationError, type StoreAuthorityMigrationDefinition, type MigrationStateRow, STORE_AUTHORITY_MIGRATION_CHECKSUM, STORE_AUTHORITY_MIGRATION_VERSION, STORE_AUTHORITY_MIGRATION_NAME, STORE_SCOPED_LEGACY_TABLES } from './store-authority-v1-contracts';
import { applyStoreAuthorityMigration } from './store-authority-v1-assignment';

export function runStoreAuthorityMigrations(database: Database.Database): StoreMigrationResult[] {
    prepareStoreAuthorityMigrationBackup(database);
    return [runMigration(database, STORE_AUTHORITY_MIGRATION)];
}

export function prepareStoreAuthorityMigrationBackup(database: Database.Database): void {
    ensureSchemaMigrationsTable(database);
    const migration = STORE_AUTHORITY_MIGRATION;
    const existing = readMigrationState(database, migration.version);
    assertMigrationChecksumCompatibility(existing, migration);
    if (existing?.status === 'applied')
        return;
    const previousManifest = parseJson<StoreAuthorityMigrationManifest | undefined>(existing?.manifest_json, undefined);
    if (existing?.checksum === LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM) {
        promoteLegacyPendingMigration(database, migration, existing, previousManifest);
        return;
    }
    if (previousManifest && isBoundBackupManifest(database, previousManifest.backup)) {
        const verifiedBackup = createOrReuseBackup(database, migration.version, previousManifest.integrityCheck, previousManifest.backup);
        if (verifiedBackup.integrityCheck !== 'ok') {
            throw new StoreAuthorityMigrationError(migration.version, `Backup integrity_check returned: ${verifiedBackup.integrityCheck}`);
        }
        return;
    }
    const integrityCheck = checkDatabaseIntegrity(database);
    const pendingManifest = createPendingMigrationManifest(database, migration, integrityCheck);
    const priorPendingProof = matchingPendingBackup(previousManifest?.backup, pendingManifest.backup);
    assertPreparationBackupPathIsOwned(migration.version, pendingManifest.backup, priorPendingProof);
    const startedResult = createStartedResult(migration, pendingManifest.startedAt);
    upsertMigrationState(database, migration, pendingManifest, startedResult, 'started');
    try {
        if (integrityCheck !== 'ok') {
            throw new StoreAuthorityMigrationError(migration.version, `Source database integrity_check returned: ${integrityCheck}`);
        }
        const backup = createOrReuseBackup(database, migration.version, integrityCheck, previousManifest?.backup ?? pendingManifest.backup, priorPendingProof);
        if (backup.integrityCheck !== 'ok') {
            throw new StoreAuthorityMigrationError(migration.version, `Backup integrity_check returned: ${backup.integrityCheck}`);
        }
        const boundManifest = { ...pendingManifest, backup };
        database.prepare(`
      UPDATE schema_migrations
      SET manifest_json = @manifestJson
      WHERE version = @version AND status = 'started'
    `).run({
            version: migration.version,
            manifestJson: JSON.stringify(boundManifest),
        });
    }
    catch (error) {
        const failedResult: StoreMigrationResult = {
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
            version: migration.version,
            errorMessage: failedResult.errorMessage,
            resultJson: JSON.stringify(failedResult),
        });
        if (error instanceof StoreAuthorityMigrationError)
            throw error;
        throw new StoreAuthorityMigrationError(migration.version, failedResult.errorMessage || 'Backup preparation failed.');
    }
}

export function promoteLegacyPendingMigration(database: Database.Database, migration: StoreAuthorityMigrationDefinition, existing: MigrationStateRow, previousManifest: StoreAuthorityMigrationManifest | undefined): void {
    if ((existing.status !== 'started' && existing.status !== 'failed')
        || !previousManifest
        || previousManifest.checksum !== LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM
        || !isBoundBackupManifest(database, previousManifest.backup)) {
        throw new StoreAuthorityMigrationError(migration.version, 'Legacy migration 1 can be promoted only from a started/failed state with its original bound backup.');
    }
    const verifiedBackup = createOrReuseBackup(database, migration.version, previousManifest.integrityCheck, previousManifest.backup);
    if (verifiedBackup.integrityCheck !== 'ok') {
        throw new StoreAuthorityMigrationError(migration.version, `Backup integrity_check returned: ${verifiedBackup.integrityCheck}`);
    }
    const promotedAt = new Date().toISOString();
    const promotedManifest: StoreAuthorityMigrationManifest = {
        ...previousManifest,
        checksum: migration.checksum,
        startedAt: promotedAt,
        backup: verifiedBackup,
        legacyChecksumProvenance: {
            legacyChecksum: LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM,
            promotedToChecksum: STORE_AUTHORITY_MIGRATION_CHECKSUM,
            previousStatus: existing.status,
            previousStartedAt: previousManifest.startedAt,
            promotedAt,
        },
    };
    const startedResult = createStartedResult(migration, promotedAt);
    upsertMigrationState(database, migration, promotedManifest, startedResult, 'started');
}

export function getStoreMigrationRecoveryPreflight(manifest: StoreMigrationManifest): StoreMigrationRecoveryPreflight {
    const blockers: string[] = [];
    const backupPath = manifest.backup.backupPath;
    let backupIntegrityCheck: string | undefined;
    let backupSha256: string | undefined;
    if (!backupPath) {
        blockers.push('No file-backed pre-migration backup is available.');
    }
    else if (!fs.existsSync(backupPath)) {
        blockers.push(`Pre-migration backup is missing: ${backupPath}`);
    }
    else {
        try {
            backupIntegrityCheck = checkDatabaseFileIntegrity(backupPath);
            if (backupIntegrityCheck !== 'ok') {
                blockers.push(`Pre-migration backup integrity_check returned: ${backupIntegrityCheck}`);
            }
            backupSha256 = hashFile(backupPath);
            if (!manifest.backup.sha256) {
                blockers.push('Pre-migration backup manifest does not contain a SHA-256 binding.');
            }
            else if (backupSha256 !== manifest.backup.sha256) {
                blockers.push('Pre-migration backup SHA-256 does not match its manifest.');
            }
        }
        catch (error) {
            blockers.push(`Pre-migration backup cannot be opened: ${errorMessage(error)}`);
        }
    }
    return {
        version: manifest.version,
        canRestore: blockers.length === 0,
        backupPath,
        backupIntegrityCheck,
        backupSha256,
        blockers,
    };
}

export function restoreStoreMigrationBackupTo(manifest: StoreMigrationManifest, destinationPath: string): StoreMigrationRestoreResult {
    const preflight = getStoreMigrationRecoveryPreflight(manifest);
    if (!preflight.canRestore || !preflight.backupPath || !manifest.backup.sha256) {
        throw new StoreAuthorityMigrationError(manifest.version, `Migration backup is not recoverable: ${preflight.blockers.join(' ')}`);
    }
    if (typeof destinationPath !== 'string' || destinationPath.trim() === '') {
        throw new StoreAuthorityMigrationError(manifest.version, 'Restore destination path is required.');
    }
    const sourcePath = path.resolve(preflight.backupPath);
    const resolvedDestination = path.resolve(destinationPath);
    if (resolvedDestination === sourcePath
        || (manifest.backup.databasePath && resolvedDestination === path.resolve(manifest.backup.databasePath))) {
        throw new StoreAuthorityMigrationError(manifest.version, 'Restore destination must be a new file, never the source database or backup.');
    }
    if (fs.existsSync(resolvedDestination)) {
        throw new StoreAuthorityMigrationError(manifest.version, `Restore destination already exists: ${resolvedDestination}`);
    }
    const restoreTempDirectory = fs.mkdtempSync(path.join(path.dirname(resolvedDestination), `${path.basename(resolvedDestination)}.restore-`));
    const restoreTempPath = path.join(restoreTempDirectory, 'backup.db');
    try {
        fs.copyFileSync(sourcePath, restoreTempPath, fs.constants.COPYFILE_EXCL);
        const integrityCheck = checkDatabaseFileIntegrity(restoreTempPath);
        const sha256 = hashFile(restoreTempPath);
        if (integrityCheck !== 'ok' || sha256 !== manifest.backup.sha256) {
            throw new StoreAuthorityMigrationError(manifest.version, `Restored copy verification failed (integrity=${integrityCheck}, sha256=${sha256}).`);
        }
        const sizeBytes = fs.statSync(restoreTempPath).size;
        fs.linkSync(restoreTempPath, resolvedDestination);
        return {
            version: manifest.version,
            sourceBackupPath: sourcePath,
            destinationPath: resolvedDestination,
            integrityCheck,
            sha256,
            sizeBytes,
        };
    }
    finally {
        fs.rmSync(restoreTempDirectory, { recursive: true, force: true });
    }
}

export function isBoundBackupManifest(database: Database.Database, backup: StoreMigrationBackupManifest): boolean {
    const databasePath = database.name;
    if (!databasePath || databasePath === ':memory:' || databasePath.startsWith('file::memory:')) {
        return backup.status === 'not_applicable';
    }
    const absoluteDatabasePath = path.resolve(databasePath);
    const expectedBackupPath = `${absoluteDatabasePath}.pre-store-authority-v${STORE_AUTHORITY_MIGRATION_VERSION}.bak`;
    return (backup.status === 'created' || backup.status === 'reused')
        && Boolean(backup.sha256)
        && sameResolvedPath(backup.databasePath, absoluteDatabasePath)
        && sameResolvedPath(backup.backupPath, expectedBackupPath);
}

export function runMigration(database: Database.Database, migration: StoreAuthorityMigrationDefinition): StoreMigrationResult {
    const existing = readMigrationState(database, migration.version);
    assertMigrationChecksumCompatibility(existing, migration);
    if (existing?.status === 'applied') {
        const appliedManifest = parseJson<StoreAuthorityMigrationManifest | undefined>(existing.manifest_json, undefined);
        if (!appliedManifest || appliedManifest.checksum !== existing.checksum) {
            throw new StoreAuthorityMigrationError(migration.version, `Migration ${migration.version} applied manifest checksum does not match recorded history.`);
        }
        verifyStoreAuthoritySchema(database, migration.targetTables);
        return parseJson<StoreMigrationResult>(existing.result_json, {
            version: migration.version,
            name: migration.name,
            status: 'applied',
            startedAt: '',
            tableResults: [],
            mappedRows: 0,
            quarantinedRows: 0,
            createdStores: 0,
        });
    }
    if (existing?.checksum === LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM) {
        throw new StoreAuthorityMigrationError(migration.version, 'Legacy migration 1 must be promoted with its bound backup before execution.');
    }
    const manifest = parseJson<StoreAuthorityMigrationManifest | undefined>(existing?.manifest_json, undefined);
    if (!manifest
        || manifest.checksum !== migration.checksum
        || !isBoundBackupManifest(database, manifest.backup)) {
        throw new StoreAuthorityMigrationError(migration.version, `Migration ${migration.version} does not have a bound pre-migration backup.`);
    }
    const startedResult = createStartedResult(migration, manifest.startedAt);
    upsertMigrationState(database, migration, manifest, startedResult, 'started');
    try {
        if (manifest.integrityCheck !== 'ok') {
            throw new StoreAuthorityMigrationError(migration.version, `Source database integrity_check returned: ${manifest.integrityCheck}`);
        }
        if (manifest.backup.backupPath && manifest.backup.integrityCheck !== 'ok') {
            throw new StoreAuthorityMigrationError(migration.version, `Backup integrity_check returned: ${manifest.backup.integrityCheck}`);
        }
        const apply = database.transaction(() => {
            const result = migration.up(database, manifest);
            database.prepare(`
        UPDATE schema_migrations
        SET status = 'applied', applied_at = @appliedAt,
            error_message = NULL, result_json = @resultJson
        WHERE version = @version
      `).run({
                version: migration.version,
                appliedAt: result.finishedAt,
                resultJson: JSON.stringify(result),
            });
            return result;
        });
        return apply();
    }
    catch (error) {
        const failedResult: StoreMigrationResult = {
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
            version: migration.version,
            errorMessage: failedResult.errorMessage,
            resultJson: JSON.stringify(failedResult),
        });
        if (error instanceof StoreAuthorityMigrationError)
            throw error;
        throw new StoreAuthorityMigrationError(migration.version, failedResult.errorMessage || 'Migration failed.');
    }
}

export function createPendingMigrationManifest(database: Database.Database, migration: StoreAuthorityMigrationDefinition, integrityCheck: string): StoreMigrationManifest {
    const tableRowCounts = Object.fromEntries(migration.targetTables.map((table) => [table, tableExists(database, table) ? countRows(database, table) : 0]));
    return {
        version: migration.version,
        name: migration.name,
        checksum: migration.checksum,
        startedAt: new Date().toISOString(),
        schemaFingerprint: schemaFingerprint(database),
        integrityCheck,
        tableRowCounts,
        targetTables: [...migration.targetTables],
        backup: pendingBackupManifest(database, migration.version, integrityCheck),
    };
}

export function pendingBackupManifest(database: Database.Database, version: number, sourceIntegrityCheck: string): StoreMigrationBackupManifest {
    const databasePath = database.name;
    if (!databasePath || databasePath === ':memory:' || databasePath.startsWith('file::memory:')) {
        return { status: 'not_applicable', integrityCheck: sourceIntegrityCheck };
    }
    const absoluteDatabasePath = path.resolve(databasePath);
    return {
        status: 'pending',
        databasePath: absoluteDatabasePath,
        backupPath: `${absoluteDatabasePath}.pre-store-authority-v${version}.bak`,
        integrityCheck: sourceIntegrityCheck,
    };
}

export function matchingPendingBackup(previousBackup: StoreMigrationBackupManifest | undefined, pendingBackup: StoreMigrationBackupManifest): boolean {
    return previousBackup?.status === 'pending'
        && pendingBackup.status === 'pending'
        && Boolean(previousBackup.databasePath && pendingBackup.databasePath)
        && Boolean(previousBackup.backupPath && pendingBackup.backupPath)
        && sameResolvedPath(previousBackup.databasePath, pendingBackup.databasePath!)
        && sameResolvedPath(previousBackup.backupPath, pendingBackup.backupPath!);
}

export function assertPreparationBackupPathIsOwned(version: number, pendingBackup: StoreMigrationBackupManifest, priorPendingProof: boolean): void {
    if (pendingBackup.status !== 'pending' || !pendingBackup.backupPath)
        return;
    if (fs.existsSync(pendingBackup.backupPath) && !priorPendingProof) {
        throw new StoreAuthorityMigrationError(version, 'An unbound pre-migration backup already exists; refusing to replace or reuse it.');
    }
}

export function createOrReuseBackup(database: Database.Database, version: number, sourceIntegrityCheck: string, previousBackup?: StoreMigrationBackupManifest, allowPendingCleanup = false): StoreMigrationBackupManifest {
    const databasePath = database.name;
    if (!databasePath || databasePath === ':memory:' || databasePath.startsWith('file::memory:')) {
        return { status: 'not_applicable', integrityCheck: sourceIntegrityCheck };
    }
    const absoluteDatabasePath = path.resolve(databasePath);
    const backupPath = `${absoluteDatabasePath}.pre-store-authority-v${version}.bak`;
    if (fs.existsSync(backupPath)) {
        if (previousBackup?.sha256) {
            const sha256 = hashFile(backupPath);
            if (previousBackup.sha256 !== sha256) {
                throw new StoreAuthorityMigrationError(version, 'The bound pre-migration backup changed; refusing to reuse it.');
            }
            return {
                status: 'reused',
                databasePath: absoluteDatabasePath,
                backupPath,
                integrityCheck: checkDatabaseFileIntegrity(backupPath),
                sha256,
                sizeBytes: fs.statSync(backupPath).size,
            };
        }
        const pendingPathMatches = previousBackup?.status === 'pending'
            && sameResolvedPath(previousBackup.databasePath, absoluteDatabasePath)
            && sameResolvedPath(previousBackup.backupPath, backupPath);
        if (!pendingPathMatches || !allowPendingCleanup) {
            throw new StoreAuthorityMigrationError(version, 'An unbound pre-migration backup already exists; refusing to reuse it.');
        }
        fs.unlinkSync(backupPath);
    }
    else if (previousBackup?.sha256) {
        throw new StoreAuthorityMigrationError(version, `The bound pre-migration backup is missing: ${backupPath}`);
    }
    if (sourceIntegrityCheck !== 'ok') {
        throw new StoreAuthorityMigrationError(version, `Source database integrity_check returned: ${sourceIntegrityCheck}`);
    }
    database.pragma('wal_checkpoint(FULL)');
    database.exec(`VACUUM INTO ${sqlStringLiteral(backupPath)}`);
    const backup: StoreMigrationBackupManifest = {
        status: 'created',
        databasePath: absoluteDatabasePath,
        backupPath,
        integrityCheck: checkDatabaseFileIntegrity(backupPath),
        sha256: hashFile(backupPath),
        sizeBytes: fs.statSync(backupPath).size,
    };
    if (backup.integrityCheck !== 'ok') {
        throw new StoreAuthorityMigrationError(version, `Backup integrity_check returned: ${backup.integrityCheck}`);
    }
    return backup;
}

export const STORE_AUTHORITY_MIGRATION: StoreAuthorityMigrationDefinition = {
    version: STORE_AUTHORITY_MIGRATION_VERSION,
    name: STORE_AUTHORITY_MIGRATION_NAME,
    checksum: STORE_AUTHORITY_MIGRATION_CHECKSUM,
    targetTables: STORE_SCOPED_LEGACY_TABLES,
    up: applyStoreAuthorityMigration,
};
