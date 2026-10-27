import type { Database } from 'better-sqlite3';
import { DEFAULT_US_BUSINESS_TIMEZONE, normalizeBrowserProfileId, normalizeBusinessTimezone, normalizeLingxingCollectionStoreName, normalizeProviderExternalAccountId, normalizeSessionGeneration, normalizeStoreCapabilityId, normalizeStoreId, normalizeUsdCurrency, normalizeUsMarketplace, type ArchiveStoreInput, type BrowserProfileId, type CreateStoreConnectionInput, type CreateStoreInput, type ListStoresInput, type RemoveStoreConnectionInput, type RestoreStoreInput, type StoreCapabilityId, type StoreConnection, type StoreConnectionProvider, type StoreConnectionStatus, type StoreId, type StoreRecord, type StoreSessionMetadata, type StoreSessionStatus, type StoreStatus, type UpdateStoreConnectionInput, type UpdateStoreInput, } from '@amazon-ai-ops/shared-types';
import { STORE_AUTHORITY_MIGRATION_VERSION, STORE_PROVIDER_IDENTITY_UNIQUE_INDEX, STORE_SCOPED_LEGACY_TABLES, getStoreMigrationRecoveryPreflight, getUpgradeBackupRecoveryPreflight, restoreStoreMigrationBackupTo, restoreUpgradeBackupTo, installStoreProviderIdentitySqlFunction, upgradeBackupFromMigrationManifest, type SchemaMigrationRecord, type SchemaMigrationManifest, type StoreMigrationManifest, type StoreMigrationQuarantineReason, type StoreMigrationQuarantineRecord, type StoreMigrationRecoveryPreflight, type StoreMigrationRestoreResult, type StoreMigrationResult, } from '../migrations';
import { type CreateStoreRecordInput, type StoreArchivePreflight, type StoreRestorePreflight, type CreateStoreConnectionRecordInput, type UpdateStoreConnectionRecordInput, type EnrollLingxingStableExternalAccountInput, type StoreMigrationQuarantineFilter, type ResolveStoreMigrationQuarantineInput, type ConnectionRow } from './store-repository-contracts';

export interface StoreRepositoryMethods {
transaction<T>(work: () => T): T;
createStore(input: CreateStoreRecordInput): StoreRecord;
getStore(storeIdInput: StoreId): StoreRecord | undefined;
listStores(input?: ListStoresInput): StoreRecord[];
updateStore(input: UpdateStoreInput): StoreRecord;
getArchivePreflight(storeIdInput: StoreId): StoreArchivePreflight;
archiveStore(input: ArchiveStoreInput): StoreRecord;
deleteStore(input: ArchiveStoreInput): StoreRecord;
getRestorePreflight(storeIdInput: StoreId): StoreRestorePreflight;
restoreStore(input: RestoreStoreInput): StoreRecord;
createConnection(input: CreateStoreConnectionRecordInput): StoreConnection;
updateConnection(input: UpdateStoreConnectionRecordInput): StoreConnection;
enrollLingxingStableExternalAccount(input: EnrollLingxingStableExternalAccountInput): StoreConnection;
getConnection(storeIdInput: StoreId, provider: StoreConnectionProvider): StoreConnection | undefined;
listConnections(storeIdInput: StoreId): StoreConnection[];
removeConnection(input: RemoveStoreConnectionInput): void;
saveSessionMetadata(input: StoreSessionMetadata): StoreSessionMetadata;
advanceSessionGeneration(storeIdInput: StoreId, providerInput: StoreConnectionProvider, statusInput?: StoreSessionStatus): StoreSessionMetadata;
getSessionMetadata(storeIdInput: StoreId, providerInput: StoreConnectionProvider): StoreSessionMetadata | undefined;
listSessionMetadata(storeIdInput: StoreId): StoreSessionMetadata[];
listSchemaMigrations(): SchemaMigrationRecord[];
getSchemaMigration(version?: number): SchemaMigrationRecord | undefined;
getMigrationManifest(version?: number): SchemaMigrationManifest | undefined;
getMigrationResult(version?: number): StoreMigrationResult | undefined;
getMigrationRecoveryPreflight(version?: number): StoreMigrationRecoveryPreflight;
restoreMigrationBackupTo(destinationPath: string, version?: number): StoreMigrationRestoreResult;
listMigrationQuarantine(filter?: StoreMigrationQuarantineFilter): StoreMigrationQuarantineRecord[];
resolveMigrationQuarantine(input: ResolveStoreMigrationQuarantineInput): StoreMigrationQuarantineRecord;
assertQuarantineParentAuthority(sourceTable: typeof STORE_SCOPED_LEGACY_TABLES[number], source: Record<string, unknown>, storeId: StoreId): void;
assertParentRowsMatchStore(sourceTable: string, parentTable: string, parents: Array<{
    store_id: string | null;
    pending: number;
}>, storeId: StoreId): void;
requireStore(storeIdInput: StoreId): StoreRecord;
requireWritableStore(storeIdInput: StoreId): StoreRecord;
requireConnection(storeId: StoreId, id: StoreCapabilityId): StoreConnection;
requireSessionMetadata(storeId: StoreId, provider: StoreConnectionProvider): StoreSessionMetadata;
invalidateStoreSessions(store: StoreRecord, failureCode: 'store_inactive' | 'store_archived', observedAt: string): void;
invalidateProviderSession(store: StoreRecord, provider: StoreConnectionProvider, failureCode: 'connection_identity_changed' | 'connection_removed' | 'store_inactive' | 'store_archived', observedAt: string): void;
markStoreConnectionsAttentionRequired(storeId: StoreId, failureCode: 'store_inactive' | 'store_archived', updatedAt: string): void;
mapConnection(row: ConnectionRow): StoreConnection;
tableHasColumn(table: string, column: string): boolean;
}
export interface StoreRepositoryContext {
 readonly db: Database;
 readonly methods: StoreRepositoryMethods;
}
