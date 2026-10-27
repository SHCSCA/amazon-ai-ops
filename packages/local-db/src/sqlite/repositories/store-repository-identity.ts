import { DEFAULT_US_BUSINESS_TIMEZONE, normalizeBrowserProfileId, normalizeBusinessTimezone, normalizeLingxingCollectionStoreName, normalizeProviderExternalAccountId, normalizeSessionGeneration, normalizeStoreCapabilityId, normalizeStoreId, normalizeUsdCurrency, normalizeUsMarketplace, type ArchiveStoreInput, type BrowserProfileId, type CreateStoreConnectionInput, type CreateStoreInput, type ListStoresInput, type RemoveStoreConnectionInput, type RestoreStoreInput, type StoreCapabilityId, type StoreConnection, type StoreConnectionProvider, type StoreConnectionStatus, type StoreId, type StoreRecord, type StoreSessionMetadata, type StoreSessionStatus, type StoreStatus, type UpdateStoreConnectionInput, type UpdateStoreInput, } from '@amazon-ai-ops/shared-types';
import { type CreateStoreRecordInput, StoreRepositoryError, type StoreRow } from './store-repository-contracts';
import { normalizeDisplayName, normalizeV1Marketplace, normalizeV1Currency, normalizeV1BusinessTimezone, isSqliteConstraint, assertExpectedUpdatedAt, nextTimestamp } from './store-repository-values';
import { mapStore } from './store-repository-records';
import type { StoreRepositoryContext } from './store-repository-context';

export function transaction<T>(repositoryContext: StoreRepositoryContext, work: () => T): T {
    return repositoryContext.db.transaction(work).immediate();
}

export function createStore(repositoryContext: StoreRepositoryContext, input: CreateStoreRecordInput): StoreRecord {
    const storeId = normalizeStoreId(input.storeId);
    const browserProfileId = normalizeBrowserProfileId(input.browserProfileId);
    const displayName = normalizeDisplayName(input.displayName);
    const marketplace = normalizeV1Marketplace(input.marketplace);
    const currency = normalizeV1Currency(input.currency);
    const businessTimezone = normalizeV1BusinessTimezone(input.businessTimezone ?? DEFAULT_US_BUSINESS_TIMEZONE);
    const status = input.status ?? 'active';
    if (status !== 'active' && status !== 'inactive') {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'A new store must be active or inactive.');
    }
    const now = new Date().toISOString();
    try {
        repositoryContext.db.prepare(`
        INSERT INTO stores (
          store_id, browser_profile_id, marketplace, currency, display_name,
          status, business_timezone, created_at, updated_at, archived_at
        ) VALUES (
          @storeId, @browserProfileId, @marketplace, @currency, @displayName,
          @status, @businessTimezone, @createdAt, @updatedAt, NULL
        )
      `).run({
            storeId,
            browserProfileId,
            marketplace,
            currency,
            displayName,
            status,
            businessTimezone,
            createdAt: now,
            updatedAt: now,
        });
    }
    catch (error) {
        if (isSqliteConstraint(error)) {
            throw new StoreRepositoryError('STORE_ALREADY_EXISTS', 'The store id or browser profile is already bound to another store.');
        }
        throw error;
    }
    return repositoryContext.methods.requireStore(storeId);
}

export function getStore(repositoryContext: StoreRepositoryContext, storeIdInput: StoreId): StoreRecord | undefined {
    const storeId = normalizeStoreId(storeIdInput);
    const row = repositoryContext.db.prepare('SELECT * FROM stores WHERE store_id = ?').get(storeId) as StoreRow | undefined;
    return row ? mapStore(row) : undefined;
}

export function listStores(repositoryContext: StoreRepositoryContext, input: ListStoresInput = {}): StoreRecord[] {
    const requestedStatuses = input.statuses ? [...new Set(input.statuses)] : undefined;
    const statuses = requestedStatuses?.length
        ? requestedStatuses
        : (input.includeArchived ? undefined : ['active', 'inactive'] as StoreStatus[]);
    if (!statuses) {
        return (repositoryContext.db.prepare(`
        SELECT * FROM stores
        ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END,
                 lower(display_name), store_id
      `).all() as StoreRow[]).map(mapStore);
    }
    if (statuses.length === 0)
        return [];
    const placeholders = statuses.map(() => '?').join(', ');
    return (repositoryContext.db.prepare(`
      SELECT * FROM stores
      WHERE status IN (${placeholders})
      ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END,
               lower(display_name), store_id
    `).all(...statuses) as StoreRow[]).map(mapStore);
}

export function updateStore(repositoryContext: StoreRepositoryContext, input: UpdateStoreInput): StoreRecord {
    const storeId = normalizeStoreId(input.storeId);
    const existing = repositoryContext.methods.requireStore(storeId);
    if (existing.status === 'archived') {
        throw new StoreRepositoryError('STORE_ARCHIVED', 'Restore an archived store before editing it.');
    }
    assertExpectedUpdatedAt(existing, input.expectedUpdatedAt);
    const fields: string[] = [];
    const updatedAt = nextTimestamp(existing.updatedAt);
    const params: Record<string, unknown> = {
        storeId,
        expectedRevision: existing.updatedAt,
        updatedAt,
    };
    if (input.patch.displayName !== undefined) {
        fields.push('display_name = @displayName');
        params.displayName = normalizeDisplayName(input.patch.displayName);
    }
    if (input.patch.businessTimezone !== undefined) {
        fields.push('business_timezone = @businessTimezone');
        params.businessTimezone = normalizeV1BusinessTimezone(input.patch.businessTimezone);
    }
    if (input.patch.status !== undefined) {
        if (input.patch.status !== 'active' && input.patch.status !== 'inactive') {
            throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Use archiveStore to archive a store.');
        }
        fields.push('status = @status');
        params.status = input.patch.status;
    }
    if (fields.length === 0) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Store update patch cannot be empty.');
    }
    fields.push('updated_at = @updatedAt');
    const update = repositoryContext.db.transaction(() => {
        const updated = repositoryContext.db.prepare(`
        UPDATE stores
        SET ${fields.join(', ')}
        WHERE store_id = @storeId
          AND updated_at = @expectedRevision
          AND status <> 'archived'
      `).run(params);
        if (updated.changes !== 1) {
            throw new StoreRepositoryError('STORE_CONFLICT', `Store ${storeId} changed after it was read; reload before retrying.`);
        }
        if (existing.status === 'active' && input.patch.status === 'inactive') {
            repositoryContext.methods.invalidateStoreSessions(existing, 'store_inactive', updatedAt);
            repositoryContext.methods.markStoreConnectionsAttentionRequired(storeId, 'store_inactive', updatedAt);
        }
        return repositoryContext.methods.requireStore(storeId);
    });
    return update();
}

export function requireStore(repositoryContext: StoreRepositoryContext, storeIdInput: StoreId): StoreRecord {
    const storeId = normalizeStoreId(storeIdInput);
    const store = repositoryContext.methods.getStore(storeId);
    if (!store) {
        throw new StoreRepositoryError('STORE_NOT_FOUND', `Store ${storeId} was not found.`);
    }
    return store;
}

export function requireWritableStore(repositoryContext: StoreRepositoryContext, storeIdInput: StoreId): StoreRecord {
    const store = repositoryContext.methods.requireStore(storeIdInput);
    if (store.status !== 'active') {
        throw new StoreRepositoryError('STORE_NOT_ACTIVE', `Store ${store.storeId} is ${store.status}; connection and session writes require an active store.`);
    }
    return store;
}
