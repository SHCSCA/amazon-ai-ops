import { DEFAULT_US_BUSINESS_TIMEZONE, normalizeBrowserProfileId, normalizeBusinessTimezone, normalizeLingxingCollectionStoreName, normalizeProviderExternalAccountId, normalizeSessionGeneration, normalizeStoreCapabilityId, normalizeStoreId, normalizeUsdCurrency, normalizeUsMarketplace, type ArchiveStoreInput, type BrowserProfileId, type CreateStoreConnectionInput, type CreateStoreInput, type ListStoresInput, type RemoveStoreConnectionInput, type RestoreStoreInput, type StoreCapabilityId, type StoreConnection, type StoreConnectionProvider, type StoreConnectionStatus, type StoreId, type StoreRecord, type StoreSessionMetadata, type StoreSessionStatus, type StoreStatus, type UpdateStoreConnectionInput, type UpdateStoreInput, } from '@amazon-ai-ops/shared-types';
import { type CreateStoreConnectionRecordInput, StoreRepositoryError, type UpdateStoreConnectionRecordInput, type EnrollLingxingStableExternalAccountInput, type ConnectionRow } from './store-repository-contracts';
import { normalizeProvider, normalizeConnectionStatus, nullableExternalAccountIdentity, nullableCollectionStoreName, nullableProviderIdentity, optionalTimestamp, nullableText, isSqliteConstraint, isExternalAccountAlreadyBoundConstraint, assertExpectedConnectionUpdatedAt, nextTimestamp, optionalText } from './store-repository-values';
import type { StoreRepositoryContext } from './store-repository-context';

export function createConnection(repositoryContext: StoreRepositoryContext, input: CreateStoreConnectionRecordInput): StoreConnection {
    const id = normalizeStoreCapabilityId(input.id);
    const store = repositoryContext.methods.requireWritableStore(input.storeId);
    const provider = normalizeProvider(input.provider);
    const status = normalizeConnectionStatus(input.status ?? 'not_configured');
    const externalIdentity = nullableExternalAccountIdentity(provider, input.externalAccountId);
    if (provider === 'lingxing' && externalIdentity.raw !== null) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Lingxing stable externalAccountId must be enrolled from trusted visible-page evidence.');
    }
    const collectionSelector = nullableCollectionStoreName(provider, input.collectionStoreName);
    const now = new Date().toISOString();
    try {
        repositoryContext.db.prepare(`
        INSERT INTO store_connections (
          id, store_id, provider, status, account_label, external_account_id,
          normalized_external_account_id, collection_store_name,
          normalized_collection_store_name, last_verified_at,
          last_failure_code, created_at, updated_at
        ) VALUES (
          @id, @storeId, @provider, @status, @accountLabel, @externalAccountId,
          @normalizedExternalAccountId, @collectionStoreName,
          @normalizedCollectionStoreName, @lastVerifiedAt,
          @lastFailureCode, @createdAt, @updatedAt
        )
      `).run({
            id,
            storeId: store.storeId,
            provider,
            status,
            accountLabel: nullableProviderIdentity(input.accountLabel, 'accountLabel'),
            externalAccountId: externalIdentity.raw,
            normalizedExternalAccountId: externalIdentity.normalized,
            collectionStoreName: collectionSelector.raw,
            normalizedCollectionStoreName: collectionSelector.normalized,
            lastVerifiedAt: optionalTimestamp(input.lastVerifiedAt),
            lastFailureCode: nullableText(input.lastFailureCode),
            createdAt: now,
            updatedAt: now,
        });
    }
    catch (error) {
        if (isSqliteConstraint(error)) {
            if (isExternalAccountAlreadyBoundConstraint(error)) {
                throw new StoreRepositoryError('EXTERNAL_ACCOUNT_ALREADY_BOUND', `The ${provider} external account is already bound to another store.`);
            }
            throw new StoreRepositoryError('CONNECTION_CONFLICT', `Store ${store.storeId} already has a ${provider} connection or the capability id is in use.`);
        }
        throw error;
    }
    return repositoryContext.methods.requireConnection(store.storeId, id);
}

export function updateConnection(repositoryContext: StoreRepositoryContext, input: UpdateStoreConnectionRecordInput): StoreConnection {
    const id = normalizeStoreCapabilityId(input.id);
    const storeId = normalizeStoreId(input.storeId);
    const store = repositoryContext.methods.requireWritableStore(storeId);
    const existing = repositoryContext.methods.requireConnection(store.storeId, id);
    assertExpectedConnectionUpdatedAt(existing, input.expectedUpdatedAt);
    const submittedAccountLabel = input.accountLabel === undefined
        ? existing.accountLabel ?? null
        : nullableProviderIdentity(input.accountLabel, 'accountLabel');
    const submittedExternalIdentity = input.externalAccountId === undefined
        ? {
            raw: existing.externalAccountId ?? null,
            normalized: existing.normalizedExternalAccountId ?? null,
        }
        : nullableExternalAccountIdentity(existing.provider, input.externalAccountId);
    if (existing.provider === 'lingxing'
        && input.externalAccountId !== undefined
        && submittedExternalIdentity.raw !== null) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Lingxing stable externalAccountId must be enrolled from trusted visible-page evidence.');
    }
    const submittedCollectionSelector = input.collectionStoreName === undefined
        ? {
            raw: existing.collectionStoreName ?? null,
            normalized: existing.normalizedCollectionStoreName ?? null,
        }
        : nullableCollectionStoreName(existing.provider, input.collectionStoreName);
    const accountLabelChanged = input.accountLabel !== undefined
        && submittedAccountLabel !== (existing.accountLabel ?? null);
    const externalAccountIdChanged = input.externalAccountId !== undefined
        && submittedExternalIdentity.normalized
            !== (existing.normalizedExternalAccountId ?? null);
    const collectionStoreNameChanged = input.collectionStoreName !== undefined
        && submittedCollectionSelector.normalized
            !== (existing.normalizedCollectionStoreName ?? null);
    const stableExternalIdentityRequiresReset = accountLabelChanged
        || (existing.provider === 'lingxing' && collectionStoreNameChanged);
    const identityChanged = accountLabelChanged
        || externalAccountIdChanged
        || collectionStoreNameChanged;
    const fields: string[] = [];
    const params: Record<string, unknown> = {
        id,
        storeId: store.storeId,
        expectedRevision: existing.updatedAt,
        updatedAt: nextTimestamp(existing.updatedAt),
    };
    if (input.accountLabel !== undefined) {
        fields.push('account_label = @accountLabel');
        params.accountLabel = submittedAccountLabel;
    }
    if (stableExternalIdentityRequiresReset) {
        if (input.externalAccountId === undefined) {
            fields.push('external_account_id = NULL', 'normalized_external_account_id = NULL');
        }
        else {
            fields.push('external_account_id = @externalAccountId', 'normalized_external_account_id = @normalizedExternalAccountId');
            params.externalAccountId = submittedExternalIdentity.raw;
            params.normalizedExternalAccountId = submittedExternalIdentity.normalized;
        }
    }
    else if (input.externalAccountId !== undefined) {
        fields.push('external_account_id = @externalAccountId', 'normalized_external_account_id = @normalizedExternalAccountId');
        params.externalAccountId = submittedExternalIdentity.raw;
        params.normalizedExternalAccountId = submittedExternalIdentity.normalized;
    }
    if (accountLabelChanged) {
        if (input.collectionStoreName === undefined) {
            fields.push('collection_store_name = NULL', 'normalized_collection_store_name = NULL');
        }
        else {
            fields.push('collection_store_name = @collectionStoreName', 'normalized_collection_store_name = @normalizedCollectionStoreName');
            params.collectionStoreName = submittedCollectionSelector.raw;
            params.normalizedCollectionStoreName = submittedCollectionSelector.normalized;
        }
    }
    else if (input.collectionStoreName !== undefined) {
        fields.push('collection_store_name = @collectionStoreName', 'normalized_collection_store_name = @normalizedCollectionStoreName');
        params.collectionStoreName = submittedCollectionSelector.raw;
        params.normalizedCollectionStoreName = submittedCollectionSelector.normalized;
    }
    if (identityChanged) {
        fields.push("status = 'not_configured'", 'last_verified_at = NULL', "last_failure_code = 'connection_identity_changed'");
    }
    else {
        if (input.lastFailureCode !== undefined) {
            fields.push('last_failure_code = @lastFailureCode');
            params.lastFailureCode = nullableText(input.lastFailureCode);
        }
        if (input.lastVerifiedAt !== undefined) {
            fields.push('last_verified_at = @lastVerifiedAt');
            params.lastVerifiedAt = optionalTimestamp(input.lastVerifiedAt);
        }
        if (input.status !== undefined) {
            fields.push('status = @status');
            params.status = normalizeConnectionStatus(input.status);
        }
    }
    if (fields.length === 0) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Connection update cannot be empty.');
    }
    fields.push('updated_at = @updatedAt');
    const update = repositoryContext.db.transaction(() => {
        const currentStore = repositoryContext.methods.requireWritableStore(storeId);
        const updated = repositoryContext.db.prepare(`
        UPDATE store_connections
        SET ${fields.join(', ')}
        WHERE id = @id AND store_id = @storeId AND updated_at = @expectedRevision
      `).run(params);
        if (updated.changes !== 1) {
            throw new StoreRepositoryError('CONNECTION_CONFLICT', `Connection ${id} changed after it was read; reload before retrying.`);
        }
        if (identityChanged) {
            repositoryContext.methods.invalidateProviderSession(currentStore, existing.provider, 'connection_identity_changed', String(params.updatedAt));
        }
        return repositoryContext.methods.requireConnection(currentStore.storeId, id);
    });
    try {
        return update();
    }
    catch (error) {
        if (error instanceof StoreRepositoryError)
            throw error;
        if (isSqliteConstraint(error)) {
            if (isExternalAccountAlreadyBoundConstraint(error)) {
                throw new StoreRepositoryError('EXTERNAL_ACCOUNT_ALREADY_BOUND', 'The provider external account is already bound to another store.');
            }
            throw new StoreRepositoryError('CONNECTION_CONFLICT', `Connection ${id} could not be updated because its authority changed.`);
        }
        throw error;
    }
}

export function enrollLingxingStableExternalAccount(repositoryContext: StoreRepositoryContext, input: EnrollLingxingStableExternalAccountInput): StoreConnection {
    const id = normalizeStoreCapabilityId(input.id);
    const storeId = normalizeStoreId(input.storeId);
    if (input.provider !== 'lingxing') {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Stable Lingxing identity enrollment requires provider lingxing.');
    }
    if (typeof input.expectedUpdatedAt !== 'string' || !input.expectedUpdatedAt) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Stable Lingxing identity enrollment requires an exact connection revision.');
    }
    const externalIdentity = nullableExternalAccountIdentity('lingxing', input.externalAccountId);
    if (externalIdentity.raw === null || externalIdentity.normalized === null) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Stable Lingxing externalAccountId cannot be empty.');
    }
    const enroll = repositoryContext.db.transaction(() => {
        const store = repositoryContext.methods.requireWritableStore(storeId);
        const existing = repositoryContext.methods.requireConnection(store.storeId, id);
        if (existing.provider !== 'lingxing') {
            throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Stable Lingxing identity enrollment cannot target another provider.');
        }
        if (existing.externalAccountId !== undefined
            || existing.normalizedExternalAccountId !== undefined
            || existing.updatedAt !== input.expectedUpdatedAt) {
            throw new StoreRepositoryError('CONNECTION_CONFLICT', `Connection ${id} is no longer eligible for first stable identity enrollment.`);
        }
        const updatedAt = nextTimestamp(existing.updatedAt);
        const updated = repositoryContext.db.prepare(`
        UPDATE store_connections
        SET external_account_id = @externalAccountId,
            normalized_external_account_id = @normalizedExternalAccountId,
            updated_at = @updatedAt
        WHERE id = @id
          AND store_id = @storeId
          AND provider = 'lingxing'
          AND updated_at = @expectedUpdatedAt
          AND external_account_id IS NULL
          AND normalized_external_account_id IS NULL
      `).run({
            id,
            storeId: store.storeId,
            expectedUpdatedAt: input.expectedUpdatedAt,
            externalAccountId: externalIdentity.raw,
            normalizedExternalAccountId: externalIdentity.normalized,
            updatedAt,
        });
        if (updated.changes !== 1) {
            throw new StoreRepositoryError('CONNECTION_CONFLICT', `Connection ${id} changed before stable identity enrollment completed.`);
        }
        return repositoryContext.methods.requireConnection(store.storeId, id);
    });
    try {
        return enroll();
    }
    catch (error) {
        if (error instanceof StoreRepositoryError)
            throw error;
        if (isSqliteConstraint(error) && isExternalAccountAlreadyBoundConstraint(error)) {
            throw new StoreRepositoryError('EXTERNAL_ACCOUNT_ALREADY_BOUND', 'The Lingxing stable external account is already bound to another store.');
        }
        if (isSqliteConstraint(error)) {
            throw new StoreRepositoryError('CONNECTION_CONFLICT', `Connection ${id} could not complete stable identity enrollment.`);
        }
        throw error;
    }
}

export function getConnection(repositoryContext: StoreRepositoryContext, storeIdInput: StoreId, provider: StoreConnectionProvider): StoreConnection | undefined {
    const storeId = normalizeStoreId(storeIdInput);
    const normalizedProvider = normalizeProvider(provider);
    const row = repositoryContext.db.prepare(`
      SELECT * FROM store_connections WHERE store_id = ? AND provider = ?
    `).get(storeId, normalizedProvider) as ConnectionRow | undefined;
    return row ? repositoryContext.methods.mapConnection(row) : undefined;
}

export function listConnections(repositoryContext: StoreRepositoryContext, storeIdInput: StoreId): StoreConnection[] {
    const storeId = normalizeStoreId(storeIdInput);
    repositoryContext.methods.requireStore(storeId);
    return (repositoryContext.db.prepare(`
      SELECT * FROM store_connections WHERE store_id = ? ORDER BY provider
    `).all(storeId) as ConnectionRow[]).map((row) => repositoryContext.methods.mapConnection(row));
}

export function removeConnection(repositoryContext: StoreRepositoryContext, input: RemoveStoreConnectionInput): void {
    const id = normalizeStoreCapabilityId(input.id);
    const storeId = normalizeStoreId(input.storeId);
    const remove = repositoryContext.db.transaction(() => {
        const store = repositoryContext.methods.requireWritableStore(storeId);
        const connection = repositoryContext.methods.requireConnection(storeId, id);
        assertExpectedConnectionUpdatedAt(connection, input.expectedUpdatedAt);
        const now = new Date().toISOString();
        repositoryContext.methods.invalidateProviderSession(store, connection.provider, 'connection_removed', now);
        const result = repositoryContext.db.prepare(`
        DELETE FROM store_connections
        WHERE id = @id AND store_id = @storeId AND updated_at = @expectedUpdatedAt
      `).run({ id, storeId, expectedUpdatedAt: connection.updatedAt });
        if (result.changes !== 1) {
            throw new StoreRepositoryError('CONNECTION_CONFLICT', `Connection ${id} changed before it could be removed.`);
        }
    });
    remove();
}

export function requireConnection(repositoryContext: StoreRepositoryContext, storeId: StoreId, id: StoreCapabilityId): StoreConnection {
    const row = repositoryContext.db.prepare(`
      SELECT * FROM store_connections WHERE id = ? AND store_id = ?
    `).get(id, storeId) as ConnectionRow | undefined;
    if (!row) {
        throw new StoreRepositoryError('CONNECTION_NOT_FOUND', `Connection ${id} was not found for store ${storeId}.`);
    }
    return repositoryContext.methods.mapConnection(row);
}

export function markStoreConnectionsAttentionRequired(repositoryContext: StoreRepositoryContext, storeId: StoreId, failureCode: 'store_inactive' | 'store_archived', updatedAt: string): void {
    repositoryContext.db.prepare(`
      UPDATE store_connections
      SET status = CASE
            WHEN status = 'not_configured' THEN status
            ELSE 'attention_required'
          END,
          last_failure_code = CASE
            WHEN status = 'not_configured' THEN last_failure_code
            ELSE @failureCode
          END,
          updated_at = CASE
            WHEN status = 'not_configured' THEN updated_at
            ELSE @updatedAt
          END
      WHERE store_id = @storeId
    `).run({ storeId, failureCode, updatedAt });
}

export function mapConnection(repositoryContext: StoreRepositoryContext, row: ConnectionRow): StoreConnection {
    const storeId = normalizeStoreId(row.store_id);
    const provider = normalizeProvider(row.provider);
    return {
        id: normalizeStoreCapabilityId(row.id),
        storeId,
        provider,
        status: normalizeConnectionStatus(row.status),
        accountLabel: optionalText(row.account_label),
        externalAccountId: optionalText(row.external_account_id),
        normalizedExternalAccountId: optionalText(row.normalized_external_account_id),
        collectionStoreName: optionalText(row.collection_store_name),
        normalizedCollectionStoreName: optionalText(row.normalized_collection_store_name),
        lastVerifiedAt: optionalText(row.last_verified_at),
        lastFailureCode: optionalText(row.last_failure_code),
        session: repositoryContext.methods.getSessionMetadata(storeId, provider),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
