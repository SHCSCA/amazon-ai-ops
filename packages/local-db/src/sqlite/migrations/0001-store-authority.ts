// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。


export { STORE_AUTHORITY_MIGRATION_VERSION, STORE_AUTHORITY_MIGRATION_NAME, LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM, STORE_AUTHORITY_MIGRATION_CHECKSUM, STORE_SCOPED_LEGACY_TABLES, type StoreAuthorityQuarantineRepairResult, StoreAuthorityMigrationError } from './store-authority-v1-contracts';

export { ensureSchemaMigrationsTable } from './store-authority-v1-schema';

export { runStoreAuthorityMigrations, prepareStoreAuthorityMigrationBackup, getStoreMigrationRecoveryPreflight, restoreStoreMigrationBackupTo } from './store-authority-v1-backup';

export { repairPendingStoreAuthorityQuarantines } from './store-authority-v1-assignment';
