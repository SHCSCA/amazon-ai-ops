// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import Database from 'better-sqlite3';
import * as path from 'path';
import * as sqliteMigrations from './migrations';
import { AI_SPEND_MIGRATION_CHECKSUM, AI_SPEND_MIGRATION_NAME, AI_SPEND_MIGRATION_VERSION, runMissionWriteAuthorityMigration, runGrantSlotLedgerMigration, runLegacyCompatibilityMigration, runAiSpendMigration, runExecutionReconciliationMigration, runAnalysisAuthorityMigration, runAnalysisRunsMigration, runCollectionResumeAuthorityMigration, runStoreProviderIdentityAuthorityMigration, prepareUpgradeBackup, runExecutionAuthorityMigration, prepareStoreAuthorityMigrationBackup, runListingStoreAuthorityMigration, runMissionDomainMigration, runOperationEventArchiveMigration, runProductStoreAuthorityMigration, runReportImportAuthorityMigration, runStoreAuthorityMigrations, runStoreAuthorityRepairMigration, runV16DomainMigration, applyContextBindingMigration, runPolicyAuthorityMigration, type UpgradeBackupManifest, } from './migrations';
import { SQLITE_MIGRATION_CONTRACT } from './db-migration-contract';
import { runMigrations } from './db-migration-runner';

function getUserDataPath(): string {
    return process.env.AMAZON_AI_OPS_USER_DATA
        || (process.env.APPDATA
            ? path.join(process.env.APPDATA, 'AmazonAIOps')
            : path.join(process.env.HOME || '', 'AmazonAIOps'));
}

let db: Database.Database | null = null;

export interface GuardedSqliteContext {
    database: Database.Database;
    resolvedPath: string;
}

export interface GuardedSqliteInitialization<T> {
    database: Database.Database;
    guardResult: T;
}

export function initSqlite(dbPath?: string): Database.Database {
    const finalPath = dbPath || path.join(getUserDataPath(), 'app-data', 'app.db');
    const opened = new Database(finalPath);
    db = opened;
    try {
        initializeSqlite(opened);
        return opened;
    }
    catch (error) {
        if (opened.open)
            opened.close();
        if (db === opened)
            db = null;
        throw error;
    }
}

export function initGuardedExistingSqlite<T>(dbPath: string, guard: (context: GuardedSqliteContext) => T): GuardedSqliteInitialization<T> {
    const resolvedPath = path.resolve(dbPath);
    const opened = new Database(resolvedPath, { fileMustExist: true });
    let guardTransactionActive = false;
    try {
        opened.pragma('busy_timeout = 0');
        const lockingMode = opened.pragma('locking_mode = EXCLUSIVE', { simple: true });
        if (String(lockingMode).toLowerCase() !== 'exclusive') {
            throw new Error('SQLite guarded initialization could not acquire exclusive locking mode.');
        }
        opened.exec('BEGIN EXCLUSIVE');
        guardTransactionActive = true;
        const guardResult = guard({ database: opened, resolvedPath });
        if (guardResult !== null
            && (typeof guardResult === 'object' || typeof guardResult === 'function')
            && typeof (guardResult as {
                then?: unknown;
            }).then === 'function') {
            throw new Error('SQLite guarded initialization guard must be synchronous.');
        }
        opened.exec('COMMIT');
        guardTransactionActive = false;
        initializeSqlite(opened);
        db = opened;
        return { database: opened, guardResult };
    }
    catch (error) {
        if (guardTransactionActive && opened.inTransaction) {
            try {
                opened.exec('ROLLBACK');
            }
            catch {
            }
        }
        if (opened.open)
            opened.close();
        if (db === opened)
            db = null;
        throw error;
    }
}

export function getSqliteDb(): Database.Database {
    if (!db) {
        throw new Error('SQLite not initialized. Call initSqlite() first.');
    }
    return db;
}

function initializeSqlite(database: Database.Database): void {
    if (database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()) {
        const ledger = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
            version: number | null;
        };
        if (Number(ledger.version) > AI_SPEND_MIGRATION_VERSION)
            throw new Error('Database uses a newer schema; install the matching application version.');
        const contracts = new Map(SQLITE_MIGRATION_CONTRACT.map(row => [row.version, row]));
        const rows = database.prepare('SELECT version,name,checksum,status FROM schema_migrations ORDER BY version').all() as Array<{
            version: number;
            name: string;
            checksum: string;
            status: string;
        }>;
        let applied = 0;
        for (const row of rows) {
            const contract = contracts.get(row.version);
            const legacyV1 = row.version === 1 && row.checksum === sqliteMigrations.LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM;
            if (!contract || row.name !== contract.name || (!legacyV1 && row.checksum !== contract.checksum)
                || !['applied', 'started', 'failed'].includes(row.status)
                || (row.status === 'applied' && row.version !== ++applied)) {
                throw new Error('Migration ledger name/checksum/status contract is unknown or incomplete; restore the verified backup or use the matching application.');
            }
        }
    }
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    const upgradeBackup = prepareUpgradeBackup(database, {
        targetVersion: AI_SPEND_MIGRATION_VERSION,
        targetName: AI_SPEND_MIGRATION_NAME,
        targetChecksum: AI_SPEND_MIGRATION_CHECKSUM,
    });
    prepareStoreAuthorityMigrationBackup(database);
    runMigrations(database, upgradeBackup);
}

export function closeSqlite(): void {
    if (db) {
        db.close();
        db = null;
    }
}

export { SQLITE_MIGRATION_CONTRACT, SQLITE_SCHEMA_VERSION } from './db-migration-contract';
