import { DEFAULT_US_BUSINESS_TIMEZONE, normalizeBrowserProfileId, normalizeBusinessTimezone, normalizeLingxingCollectionStoreName, normalizeProviderExternalAccountId, normalizeSessionGeneration, normalizeStoreCapabilityId, normalizeStoreId, normalizeUsdCurrency, normalizeUsMarketplace, type ArchiveStoreInput, type BrowserProfileId, type CreateStoreConnectionInput, type CreateStoreInput, type ListStoresInput, type RemoveStoreConnectionInput, type RestoreStoreInput, type StoreCapabilityId, type StoreConnection, type StoreConnectionProvider, type StoreConnectionStatus, type StoreId, type StoreRecord, type StoreSessionMetadata, type StoreSessionStatus, type StoreStatus, type UpdateStoreConnectionInput, type UpdateStoreInput, } from '@amazon-ai-ops/shared-types';
import { StoreRepositoryError, type SessionRow } from './store-repository-contracts';
import { normalizeProvider, normalizeSessionStatus, requiredTimestamp, nullableProviderIdentity, optionalTimestamp, nullableText } from './store-repository-values';
import { mapSession } from './store-repository-records';
import type { StoreRepositoryContext } from './store-repository-context';

export function saveSessionMetadata(repositoryContext: StoreRepositoryContext, input: StoreSessionMetadata): StoreSessionMetadata {
    const store = repositoryContext.methods.requireWritableStore(input.storeId);
    const browserProfileId = normalizeBrowserProfileId(input.browserProfileId);
    if (browserProfileId !== store.browserProfileId) {
        throw new StoreRepositoryError('SESSION_PROFILE_MISMATCH', 'Session metadata browserProfileId does not match the store authority record.');
    }
    const provider = normalizeProvider(input.provider);
    if (!repositoryContext.methods.getConnection(store.storeId, provider)) {
        throw new StoreRepositoryError('CONNECTION_NOT_FOUND', `Store ${store.storeId} has no ${provider} connection binding.`);
    }
    const status = normalizeSessionStatus(input.status);
    const sessionGeneration = normalizeSessionGeneration(input.sessionGeneration);
    const observedAt = requiredTimestamp(input.observedAt, 'observedAt');
    const previous = repositoryContext.methods.getSessionMetadata(store.storeId, provider);
    if (previous && sessionGeneration < previous.sessionGeneration) {
        throw new StoreRepositoryError('SESSION_GENERATION_STALE', `Session generation ${sessionGeneration} is older than ${previous.sessionGeneration}.`);
    }
    const now = new Date().toISOString();
    const saved = repositoryContext.db.prepare(`
      INSERT INTO store_session_metadata (
        store_id, provider, browser_profile_id, status, session_generation,
        observed_at, account_label, external_account_id, verified_at,
        expires_at, failure_code, updated_at
      ) VALUES (
        @storeId, @provider, @browserProfileId, @status, @sessionGeneration,
        @observedAt, @accountLabel, @externalAccountId, @verifiedAt,
        @expiresAt, @failureCode, @updatedAt
      )
      ON CONFLICT(store_id, provider) DO UPDATE SET
        browser_profile_id = excluded.browser_profile_id,
        status = excluded.status,
        session_generation = excluded.session_generation,
        observed_at = excluded.observed_at,
        account_label = excluded.account_label,
        external_account_id = excluded.external_account_id,
        verified_at = excluded.verified_at,
        expires_at = excluded.expires_at,
        failure_code = excluded.failure_code,
        updated_at = excluded.updated_at
      WHERE excluded.session_generation >= store_session_metadata.session_generation
    `).run({
        storeId: store.storeId,
        provider,
        browserProfileId,
        status,
        sessionGeneration,
        observedAt,
        accountLabel: nullableProviderIdentity(input.accountLabel, 'accountLabel'),
        externalAccountId: nullableProviderIdentity(input.externalAccountId, 'externalAccountId'),
        verifiedAt: optionalTimestamp(input.verifiedAt),
        expiresAt: optionalTimestamp(input.expiresAt),
        failureCode: nullableText(input.failureCode),
        updatedAt: now,
    });
    if (saved.changes !== 1) {
        const current = repositoryContext.methods.getSessionMetadata(store.storeId, provider);
        throw new StoreRepositoryError('SESSION_GENERATION_STALE', `Session generation ${sessionGeneration} is older than ${current?.sessionGeneration ?? 'the current value'}.`);
    }
    return repositoryContext.methods.requireSessionMetadata(store.storeId, provider);
}

export function advanceSessionGeneration(repositoryContext: StoreRepositoryContext, storeIdInput: StoreId, providerInput: StoreConnectionProvider, statusInput: StoreSessionStatus = 'checking'): StoreSessionMetadata {
    const store = repositoryContext.methods.requireWritableStore(storeIdInput);
    const provider = normalizeProvider(providerInput);
    if (!repositoryContext.methods.getConnection(store.storeId, provider)) {
        throw new StoreRepositoryError('CONNECTION_NOT_FOUND', `Store ${store.storeId} has no ${provider} connection binding.`);
    }
    const status = normalizeSessionStatus(statusInput);
    const now = new Date().toISOString();
    const row = repositoryContext.db.prepare(`
      INSERT INTO store_session_metadata (
        store_id, provider, browser_profile_id, status, session_generation,
        observed_at, account_label, external_account_id, verified_at,
        expires_at, failure_code, updated_at
      ) VALUES (
        @storeId, @provider, @browserProfileId, @status, 0,
        @observedAt, NULL, NULL, NULL,
        NULL, NULL, @updatedAt
      )
      ON CONFLICT(store_id, provider) DO UPDATE SET
        browser_profile_id = excluded.browser_profile_id,
        status = excluded.status,
        session_generation = store_session_metadata.session_generation + 1,
        observed_at = excluded.observed_at,
        verified_at = NULL,
        expires_at = NULL,
        updated_at = excluded.updated_at
      WHERE store_session_metadata.session_generation < @maxGeneration
      RETURNING *
    `).get({
        storeId: store.storeId,
        browserProfileId: store.browserProfileId,
        provider,
        status,
        observedAt: now,
        updatedAt: now,
        maxGeneration: Number.MAX_SAFE_INTEGER,
    }) as SessionRow | undefined;
    if (!row) {
        throw new StoreRepositoryError('SESSION_GENERATION_STALE', `Session generation for store ${store.storeId} cannot advance beyond ${Number.MAX_SAFE_INTEGER}.`);
    }
    return mapSession(row);
}

export function getSessionMetadata(repositoryContext: StoreRepositoryContext, storeIdInput: StoreId, providerInput: StoreConnectionProvider): StoreSessionMetadata | undefined {
    const storeId = normalizeStoreId(storeIdInput);
    const provider = normalizeProvider(providerInput);
    const row = repositoryContext.db.prepare(`
      SELECT * FROM store_session_metadata WHERE store_id = ? AND provider = ?
    `).get(storeId, provider) as SessionRow | undefined;
    return row ? mapSession(row) : undefined;
}

export function listSessionMetadata(repositoryContext: StoreRepositoryContext, storeIdInput: StoreId): StoreSessionMetadata[] {
    const storeId = normalizeStoreId(storeIdInput);
    repositoryContext.methods.requireStore(storeId);
    return (repositoryContext.db.prepare(`
      SELECT * FROM store_session_metadata WHERE store_id = ? ORDER BY provider
    `).all(storeId) as SessionRow[]).map(mapSession);
}

export function requireSessionMetadata(repositoryContext: StoreRepositoryContext, storeId: StoreId, provider: StoreConnectionProvider): StoreSessionMetadata {
    const session = repositoryContext.methods.getSessionMetadata(storeId, provider);
    if (!session)
        throw new StoreRepositoryError('CONNECTION_NOT_FOUND', 'Session metadata was not found.');
    return session;
}

export function invalidateStoreSessions(repositoryContext: StoreRepositoryContext, store: StoreRecord, failureCode: 'store_inactive' | 'store_archived', observedAt: string): void {
    const providers = repositoryContext.db.prepare(`
      SELECT provider FROM store_connections WHERE store_id = ?
      UNION
      SELECT provider FROM store_session_metadata WHERE store_id = ?
      ORDER BY provider
    `).all(store.storeId, store.storeId) as Array<{
        provider: StoreConnectionProvider;
    }>;
    for (const row of providers) {
        repositoryContext.methods.invalidateProviderSession(store, normalizeProvider(row.provider), failureCode, observedAt);
    }
}

export function invalidateProviderSession(repositoryContext: StoreRepositoryContext, store: StoreRecord, provider: StoreConnectionProvider, failureCode: 'connection_identity_changed' | 'connection_removed' | 'store_inactive' | 'store_archived', observedAt: string): void {
    const tombstone = repositoryContext.db.prepare(`
      INSERT INTO store_session_metadata (
        store_id, provider, browser_profile_id, status, session_generation,
        observed_at, account_label, external_account_id, verified_at,
        expires_at, failure_code, updated_at
      ) VALUES (
        @storeId, @provider, @browserProfileId, 'signed_out', 0,
        @observedAt, NULL, NULL, NULL,
        NULL, @failureCode, @updatedAt
      )
      ON CONFLICT(store_id, provider) DO UPDATE SET
        browser_profile_id = excluded.browser_profile_id,
        status = 'signed_out',
        session_generation = store_session_metadata.session_generation + 1,
        observed_at = excluded.observed_at,
        account_label = NULL,
        external_account_id = NULL,
        verified_at = NULL,
        expires_at = NULL,
        failure_code = excluded.failure_code,
        updated_at = excluded.updated_at
      WHERE store_session_metadata.session_generation < @maxGeneration
      RETURNING session_generation
    `).get({
        storeId: store.storeId,
        provider,
        browserProfileId: store.browserProfileId,
        observedAt,
        failureCode,
        updatedAt: observedAt,
        maxGeneration: Number.MAX_SAFE_INTEGER,
    }) as {
        session_generation: number;
    } | undefined;
    if (!tombstone) {
        throw new StoreRepositoryError('SESSION_GENERATION_STALE', `Session generation for store ${store.storeId} cannot advance beyond ${Number.MAX_SAFE_INTEGER}.`);
    }
}
