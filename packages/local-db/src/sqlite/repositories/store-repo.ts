import type { Database } from 'better-sqlite3';
import { DEFAULT_US_BUSINESS_TIMEZONE, normalizeBrowserProfileId, normalizeBusinessTimezone, normalizeLingxingCollectionStoreName, normalizeProviderExternalAccountId, normalizeSessionGeneration, normalizeStoreCapabilityId, normalizeStoreId, normalizeUsdCurrency, normalizeUsMarketplace, type ArchiveStoreInput, type BrowserProfileId, type CreateStoreConnectionInput, type CreateStoreInput, type ListStoresInput, type RemoveStoreConnectionInput, type RestoreStoreInput, type StoreCapabilityId, type StoreConnection, type StoreConnectionProvider, type StoreConnectionStatus, type StoreId, type StoreRecord, type StoreSessionMetadata, type StoreSessionStatus, type StoreStatus, type UpdateStoreConnectionInput, type UpdateStoreInput, } from '@amazon-ai-ops/shared-types';
import { STORE_AUTHORITY_MIGRATION_VERSION, STORE_PROVIDER_IDENTITY_UNIQUE_INDEX, STORE_SCOPED_LEGACY_TABLES, getStoreMigrationRecoveryPreflight, getUpgradeBackupRecoveryPreflight, restoreStoreMigrationBackupTo, restoreUpgradeBackupTo, installStoreProviderIdentitySqlFunction, upgradeBackupFromMigrationManifest, type SchemaMigrationRecord, type SchemaMigrationManifest, type StoreMigrationManifest, type StoreMigrationQuarantineReason, type StoreMigrationQuarantineRecord, type StoreMigrationRecoveryPreflight, type StoreMigrationRestoreResult, type StoreMigrationResult, } from '../migrations';
import { type CreateStoreRecordInput, type StoreArchivePreflight, type StoreRestorePreflight, type CreateStoreConnectionRecordInput, type UpdateStoreConnectionRecordInput, type EnrollLingxingStableExternalAccountInput, type StoreMigrationQuarantineFilter, type ResolveStoreMigrationQuarantineInput, type ConnectionRow } from './store-repository-contracts';
import type { StoreRepositoryContext } from './store-repository-context';
import * as operations0 from './store-repository-identity';
import * as operations1 from './store-repository-archive';
import * as operations2 from './store-repository-connections';
import * as operations3 from './store-repository-sessions';
import * as operations4 from './store-repository-migrations';
import * as operations5 from './store-repository-quarantine';

// 所有职责共享同一数据库连接，事务仍由原操作边界控制。
export class StoreRepository {
 private readonly operations: StoreRepositoryContext;
 constructor(private readonly db: Database) {
installStoreProviderIdentitySqlFunction(db);
  this.operations = { db: this.db, methods: {
transaction: (...args) => this.transaction(...args),
createStore: (...args) => this.createStore(...args),
getStore: (...args) => this.getStore(...args),
listStores: (...args) => this.listStores(...args),
updateStore: (...args) => this.updateStore(...args),
getArchivePreflight: (...args) => this.getArchivePreflight(...args),
archiveStore: (...args) => this.archiveStore(...args),
deleteStore: (...args) => this.deleteStore(...args),
getRestorePreflight: (...args) => this.getRestorePreflight(...args),
restoreStore: (...args) => this.restoreStore(...args),
createConnection: (...args) => this.createConnection(...args),
updateConnection: (...args) => this.updateConnection(...args),
enrollLingxingStableExternalAccount: (...args) => this.enrollLingxingStableExternalAccount(...args),
getConnection: (...args) => this.getConnection(...args),
listConnections: (...args) => this.listConnections(...args),
removeConnection: (...args) => this.removeConnection(...args),
saveSessionMetadata: (...args) => this.saveSessionMetadata(...args),
advanceSessionGeneration: (...args) => this.advanceSessionGeneration(...args),
getSessionMetadata: (...args) => this.getSessionMetadata(...args),
listSessionMetadata: (...args) => this.listSessionMetadata(...args),
listSchemaMigrations: (...args) => this.listSchemaMigrations(...args),
getSchemaMigration: (...args) => this.getSchemaMigration(...args),
getMigrationManifest: (...args) => this.getMigrationManifest(...args),
getMigrationResult: (...args) => this.getMigrationResult(...args),
getMigrationRecoveryPreflight: (...args) => this.getMigrationRecoveryPreflight(...args),
restoreMigrationBackupTo: (...args) => this.restoreMigrationBackupTo(...args),
listMigrationQuarantine: (...args) => this.listMigrationQuarantine(...args),
resolveMigrationQuarantine: (...args) => this.resolveMigrationQuarantine(...args),
assertQuarantineParentAuthority: (...args) => this.assertQuarantineParentAuthority(...args),
assertParentRowsMatchStore: (...args) => this.assertParentRowsMatchStore(...args),
requireStore: (...args) => this.requireStore(...args),
requireWritableStore: (...args) => this.requireWritableStore(...args),
requireConnection: (...args) => this.requireConnection(...args),
requireSessionMetadata: (...args) => this.requireSessionMetadata(...args),
invalidateStoreSessions: (...args) => this.invalidateStoreSessions(...args),
invalidateProviderSession: (...args) => this.invalidateProviderSession(...args),
markStoreConnectionsAttentionRequired: (...args) => this.markStoreConnectionsAttentionRequired(...args),
mapConnection: (...args) => this.mapConnection(...args),
tableHasColumn: (...args) => this.tableHasColumn(...args),
} };
}
transaction<T>(work: () => T): T {
    return operations0.transaction(this.operations, work);
}

createStore(input: CreateStoreRecordInput): StoreRecord {
    return operations0.createStore(this.operations, input);
}

getStore(storeIdInput: StoreId): StoreRecord | undefined {
    return operations0.getStore(this.operations, storeIdInput);
}

listStores(input: ListStoresInput = {}): StoreRecord[] {
    return operations0.listStores(this.operations, input);
}

updateStore(input: UpdateStoreInput): StoreRecord {
    return operations0.updateStore(this.operations, input);
}

getArchivePreflight(storeIdInput: StoreId): StoreArchivePreflight {
    return operations1.getArchivePreflight(this.operations, storeIdInput);
}

archiveStore(input: ArchiveStoreInput): StoreRecord {
    return operations1.archiveStore(this.operations, input);
}

deleteStore(input: ArchiveStoreInput): StoreRecord {
    return operations1.deleteStore(this.operations, input);
}

getRestorePreflight(storeIdInput: StoreId): StoreRestorePreflight {
    return operations1.getRestorePreflight(this.operations, storeIdInput);
}

restoreStore(input: RestoreStoreInput): StoreRecord {
    return operations1.restoreStore(this.operations, input);
}

createConnection(input: CreateStoreConnectionRecordInput): StoreConnection {
    return operations2.createConnection(this.operations, input);
}

updateConnection(input: UpdateStoreConnectionRecordInput): StoreConnection {
    return operations2.updateConnection(this.operations, input);
}

enrollLingxingStableExternalAccount(input: EnrollLingxingStableExternalAccountInput): StoreConnection {
    return operations2.enrollLingxingStableExternalAccount(this.operations, input);
}

getConnection(storeIdInput: StoreId, provider: StoreConnectionProvider): StoreConnection | undefined {
    return operations2.getConnection(this.operations, storeIdInput, provider);
}

listConnections(storeIdInput: StoreId): StoreConnection[] {
    return operations2.listConnections(this.operations, storeIdInput);
}

removeConnection(input: RemoveStoreConnectionInput): void {
    return operations2.removeConnection(this.operations, input);
}

saveSessionMetadata(input: StoreSessionMetadata): StoreSessionMetadata {
    return operations3.saveSessionMetadata(this.operations, input);
}

advanceSessionGeneration(storeIdInput: StoreId, providerInput: StoreConnectionProvider, statusInput: StoreSessionStatus = 'checking'): StoreSessionMetadata {
    return operations3.advanceSessionGeneration(this.operations, storeIdInput, providerInput, statusInput);
}

getSessionMetadata(storeIdInput: StoreId, providerInput: StoreConnectionProvider): StoreSessionMetadata | undefined {
    return operations3.getSessionMetadata(this.operations, storeIdInput, providerInput);
}

listSessionMetadata(storeIdInput: StoreId): StoreSessionMetadata[] {
    return operations3.listSessionMetadata(this.operations, storeIdInput);
}

listSchemaMigrations(): SchemaMigrationRecord[] {
    return operations4.listSchemaMigrations(this.operations);
}

getSchemaMigration(version = STORE_AUTHORITY_MIGRATION_VERSION): SchemaMigrationRecord | undefined {
    return operations4.getSchemaMigration(this.operations, version);
}

getMigrationManifest(version = STORE_AUTHORITY_MIGRATION_VERSION): SchemaMigrationManifest | undefined {
    return operations4.getMigrationManifest(this.operations, version);
}

getMigrationResult(version = STORE_AUTHORITY_MIGRATION_VERSION): StoreMigrationResult | undefined {
    return operations4.getMigrationResult(this.operations, version);
}

getMigrationRecoveryPreflight(version = STORE_AUTHORITY_MIGRATION_VERSION): StoreMigrationRecoveryPreflight {
    return operations4.getMigrationRecoveryPreflight(this.operations, version);
}

restoreMigrationBackupTo(destinationPath: string, version = STORE_AUTHORITY_MIGRATION_VERSION): StoreMigrationRestoreResult {
    return operations4.restoreMigrationBackupTo(this.operations, destinationPath, version);
}

listMigrationQuarantine(filter: StoreMigrationQuarantineFilter = {}): StoreMigrationQuarantineRecord[] {
    return operations5.listMigrationQuarantine(this.operations, filter);
}

resolveMigrationQuarantine(input: ResolveStoreMigrationQuarantineInput): StoreMigrationQuarantineRecord {
    return operations5.resolveMigrationQuarantine(this.operations, input);
}

private assertQuarantineParentAuthority(sourceTable: typeof STORE_SCOPED_LEGACY_TABLES[number], source: Record<string, unknown>, storeId: StoreId): void {
    return operations5.assertQuarantineParentAuthority(this.operations, sourceTable, source, storeId);
}

private assertParentRowsMatchStore(sourceTable: string, parentTable: string, parents: Array<{
    store_id: string | null;
    pending: number;
}>, storeId: StoreId): void {
    return operations5.assertParentRowsMatchStore(this.operations, sourceTable, parentTable, parents, storeId);
}

private requireStore(storeIdInput: StoreId): StoreRecord {
    return operations0.requireStore(this.operations, storeIdInput);
}

private requireWritableStore(storeIdInput: StoreId): StoreRecord {
    return operations0.requireWritableStore(this.operations, storeIdInput);
}

private requireConnection(storeId: StoreId, id: StoreCapabilityId): StoreConnection {
    return operations2.requireConnection(this.operations, storeId, id);
}

private requireSessionMetadata(storeId: StoreId, provider: StoreConnectionProvider): StoreSessionMetadata {
    return operations3.requireSessionMetadata(this.operations, storeId, provider);
}

private invalidateStoreSessions(store: StoreRecord, failureCode: 'store_inactive' | 'store_archived', observedAt: string): void {
    return operations3.invalidateStoreSessions(this.operations, store, failureCode, observedAt);
}

private invalidateProviderSession(store: StoreRecord, provider: StoreConnectionProvider, failureCode: 'connection_identity_changed' | 'connection_removed' | 'store_inactive' | 'store_archived', observedAt: string): void {
    return operations3.invalidateProviderSession(this.operations, store, provider, failureCode, observedAt);
}

private markStoreConnectionsAttentionRequired(storeId: StoreId, failureCode: 'store_inactive' | 'store_archived', updatedAt: string): void {
    return operations2.markStoreConnectionsAttentionRequired(this.operations, storeId, failureCode, updatedAt);
}

private mapConnection(row: ConnectionRow): StoreConnection {
    return operations2.mapConnection(this.operations, row);
}

private tableHasColumn(table: string, column: string): boolean {
    return operations5.tableHasColumn(this.operations, table, column);
}
}
export { type CreateStoreRecordInput, type CreateStoreConnectionRecordInput, type UpdateStoreConnectionRecordInput, type EnrollLingxingStableExternalAccountInput, type StoreArchivePreflight, type StoreRestorePreflight, type StoreMigrationQuarantineFilter, type ResolveStoreMigrationQuarantineInput, type StoreRepositoryErrorCode, StoreRepositoryError } from './store-repository-contracts';
export { StoreRepository as StoreRepo };
