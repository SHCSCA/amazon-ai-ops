import { DEFAULT_US_BUSINESS_TIMEZONE, normalizeBrowserProfileId, normalizeBusinessTimezone, normalizeLingxingCollectionStoreName, normalizeProviderExternalAccountId, normalizeSessionGeneration, normalizeStoreCapabilityId, normalizeStoreId, normalizeUsdCurrency, normalizeUsMarketplace, type ArchiveStoreInput, type BrowserProfileId, type CreateStoreConnectionInput, type CreateStoreInput, type ListStoresInput, type RemoveStoreConnectionInput, type RestoreStoreInput, type StoreCapabilityId, type StoreConnection, type StoreConnectionProvider, type StoreConnectionStatus, type StoreId, type StoreRecord, type StoreSessionMetadata, type StoreSessionStatus, type StoreStatus, type UpdateStoreConnectionInput, type UpdateStoreInput, } from '@amazon-ai-ops/shared-types';
import { STORE_AUTHORITY_MIGRATION_VERSION, STORE_PROVIDER_IDENTITY_UNIQUE_INDEX, STORE_SCOPED_LEGACY_TABLES, getStoreMigrationRecoveryPreflight, getUpgradeBackupRecoveryPreflight, restoreStoreMigrationBackupTo, restoreUpgradeBackupTo, installStoreProviderIdentitySqlFunction, upgradeBackupFromMigrationManifest, type SchemaMigrationRecord, type SchemaMigrationManifest, type StoreMigrationManifest, type StoreMigrationQuarantineReason, type StoreMigrationQuarantineRecord, type StoreMigrationRecoveryPreflight, type StoreMigrationRestoreResult, type StoreMigrationResult, } from '../migrations';
import { type StoreArchivePreflight, type StoreRestorePreflight, StoreRepositoryError } from './store-repository-contracts';
import { quoteIdentifier, assertExpectedUpdatedAt, nextTimestamp } from './store-repository-values';
import type { StoreRepositoryContext } from './store-repository-context';

export function getArchivePreflight(repositoryContext: StoreRepositoryContext, storeIdInput: StoreId): StoreArchivePreflight {
    const store = repositoryContext.methods.requireStore(normalizeStoreId(storeIdInput));
    const scopedRowCounts: Record<string, number> = {};
    for (const table of STORE_SCOPED_LEGACY_TABLES) {
        if (!repositoryContext.methods.tableHasColumn(table, 'store_id'))
            continue;
        scopedRowCounts[table] = Number((repositoryContext.db.prepare(`
        SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE store_id = ?
      `).get(store.storeId) as {
            count: number;
        }).count);
    }
    const sessionProvidersToInvalidate = (repositoryContext.db.prepare(`
      SELECT provider
      FROM store_session_metadata
      WHERE store_id = ? AND status IN ('checking', 'ready')
      ORDER BY provider
    `).all(store.storeId) as Array<{
        provider: StoreConnectionProvider;
    }>).map((row) => row.provider);
    return {
        storeId: store.storeId,
        canArchive: true,
        alreadyArchived: store.status === 'archived',
        scopedRowCounts,
        sessionProvidersToInvalidate,
        blockers: [],
    };
}

export function archiveStore(repositoryContext: StoreRepositoryContext, input: ArchiveStoreInput): StoreRecord {
    const storeId = normalizeStoreId(input.storeId);
    const archive = repositoryContext.db.transaction(() => {
        const existing = repositoryContext.methods.requireStore(storeId);
        assertExpectedUpdatedAt(existing, input.expectedUpdatedAt);
        if (existing.status === 'archived')
            return existing;
        const now = nextTimestamp(existing.updatedAt);
        repositoryContext.db.prepare(`
        UPDATE stores
        SET status = 'archived', archived_at = @archivedAt, updated_at = @updatedAt
        WHERE store_id = @storeId
      `).run({ storeId, archivedAt: now, updatedAt: now });
        repositoryContext.methods.invalidateStoreSessions(existing, 'store_archived', now);
        repositoryContext.methods.markStoreConnectionsAttentionRequired(storeId, 'store_archived', now);
        return repositoryContext.methods.requireStore(storeId);
    });
    return archive();
}

export function deleteStore(repositoryContext: StoreRepositoryContext, input: ArchiveStoreInput): StoreRecord {
    return repositoryContext.methods.archiveStore(input);
}

export function getRestorePreflight(repositoryContext: StoreRepositoryContext, storeIdInput: StoreId): StoreRestorePreflight {
    const store = repositoryContext.methods.requireStore(normalizeStoreId(storeIdInput));
    const blockers: string[] = [];
    const profileOwner = repositoryContext.db.prepare(`
      SELECT store_id
      FROM stores
      WHERE lower(browser_profile_id) = lower(?)
        AND store_id <> ?
        AND status <> 'archived'
      LIMIT 1
    `).get(store.browserProfileId, store.storeId) as {
        store_id: string;
    } | undefined;
    if (profileOwner) {
        blockers.push(`Browser profile is already active for store ${profileOwner.store_id}.`);
    }
    return {
        storeId: store.storeId,
        canRestore: blockers.length === 0,
        alreadyActive: store.status === 'active',
        blockers,
    };
}

export function restoreStore(repositoryContext: StoreRepositoryContext, input: RestoreStoreInput): StoreRecord {
    const storeId = normalizeStoreId(input.storeId);
    const restore = repositoryContext.db.transaction(() => {
        const existing = repositoryContext.methods.requireStore(storeId);
        assertExpectedUpdatedAt(existing, input.expectedUpdatedAt);
        if (existing.status === 'active')
            return existing;
        if (existing.status !== 'archived') {
            throw new StoreRepositoryError('STORE_CONFLICT', 'Only an archived store can be restored; activate an inactive store through updateStore.');
        }
        const preflight = repositoryContext.methods.getRestorePreflight(storeId);
        if (!preflight.canRestore) {
            throw new StoreRepositoryError('STORE_CONFLICT', preflight.blockers.join(' '));
        }
        repositoryContext.db.prepare(`
        UPDATE stores
        SET status = 'active', archived_at = NULL, updated_at = @updatedAt
        WHERE store_id = @storeId
      `).run({ storeId, updatedAt: nextTimestamp(existing.updatedAt) });
        return repositoryContext.methods.requireStore(storeId);
    });
    return restore();
}
