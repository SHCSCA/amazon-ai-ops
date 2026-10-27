import { DEFAULT_US_BUSINESS_TIMEZONE, normalizeBrowserProfileId, normalizeBusinessTimezone, normalizeLingxingCollectionStoreName, normalizeProviderExternalAccountId, normalizeSessionGeneration, normalizeStoreCapabilityId, normalizeStoreId, normalizeUsdCurrency, normalizeUsMarketplace, type ArchiveStoreInput, type BrowserProfileId, type CreateStoreConnectionInput, type CreateStoreInput, type ListStoresInput, type RemoveStoreConnectionInput, type RestoreStoreInput, type StoreCapabilityId, type StoreConnection, type StoreConnectionProvider, type StoreConnectionStatus, type StoreId, type StoreRecord, type StoreSessionMetadata, type StoreSessionStatus, type StoreStatus, type UpdateStoreConnectionInput, type UpdateStoreInput, } from '@amazon-ai-ops/shared-types';
import { STORE_AUTHORITY_MIGRATION_VERSION, STORE_PROVIDER_IDENTITY_UNIQUE_INDEX, STORE_SCOPED_LEGACY_TABLES, getStoreMigrationRecoveryPreflight, getUpgradeBackupRecoveryPreflight, restoreStoreMigrationBackupTo, restoreUpgradeBackupTo, installStoreProviderIdentitySqlFunction, upgradeBackupFromMigrationManifest, type SchemaMigrationRecord, type SchemaMigrationManifest, type StoreMigrationManifest, type StoreMigrationQuarantineReason, type StoreMigrationQuarantineRecord, type StoreMigrationRecoveryPreflight, type StoreMigrationRestoreResult, type StoreMigrationResult, } from '../migrations';
import { StoreRepositoryError, MAX_PROVIDER_IDENTITY_LENGTH, PROVIDER_IDENTITY_CONTROL_CHARACTERS } from './store-repository-contracts';

export function assertExpectedUpdatedAt(store: StoreRecord, expectedUpdatedAt: unknown): void {
    if (typeof expectedUpdatedAt !== 'string' || expectedUpdatedAt.trim() === '') {
        throw new StoreRepositoryError('STORE_CONFLICT', `Store ${store.storeId} requires an exact expectedUpdatedAt revision.`);
    }
    if (expectedUpdatedAt !== store.updatedAt) {
        throw new StoreRepositoryError('STORE_CONFLICT', `Store ${store.storeId} changed after it was read; reload before retrying.`);
    }
}

export function assertExpectedConnectionUpdatedAt(connection: StoreConnection, expectedUpdatedAt: unknown): void {
    if (typeof expectedUpdatedAt !== 'string' || expectedUpdatedAt.trim() === '') {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', `Connection ${connection.id} requires an exact expectedUpdatedAt revision.`);
    }
    if (expectedUpdatedAt !== connection.updatedAt) {
        throw new StoreRepositoryError('CONNECTION_CONFLICT', `Connection ${connection.id} changed after it was read; reload before retrying.`);
    }
}

export function nextTimestamp(previous: string): string {
    const previousMillis = Date.parse(previous);
    const nextMillis = Number.isFinite(previousMillis)
        ? Math.max(Date.now(), previousMillis + 1)
        : Date.now();
    return new Date(nextMillis).toISOString();
}

export function normalizeDisplayName(value: unknown): string {
    if (typeof value !== 'string') {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Display name must be a string.');
    }
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Display name cannot be empty.');
    }
    if (normalized.length > 200) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Display name cannot exceed 200 characters.');
    }
    return normalized;
}

export function normalizeV1Marketplace(value: unknown = 'US'): 'US' {
    try {
        return normalizeUsMarketplace(value);
    }
    catch {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'V1 store authority supports the US marketplace only.');
    }
}

export function normalizeV1Currency(value: unknown = 'USD'): 'USD' {
    try {
        return normalizeUsdCurrency(value);
    }
    catch {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'V1 store authority supports USD only.');
    }
}

export function normalizeV1BusinessTimezone(value: unknown): string {
    let normalized: string;
    try {
        normalized = normalizeBusinessTimezone(value);
    }
    catch {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', `V1 store authority requires ${DEFAULT_US_BUSINESS_TIMEZONE}.`);
    }
    if (normalized !== DEFAULT_US_BUSINESS_TIMEZONE) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', `V1 store authority requires ${DEFAULT_US_BUSINESS_TIMEZONE}.`);
    }
    return normalized;
}

export function normalizeProvider(value: unknown): StoreConnectionProvider {
    if (value !== 'lingxing' && value !== 'amazon_ads') {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Unsupported store connection provider.');
    }
    return value;
}

export function normalizeConnectionStatus(value: unknown): StoreConnectionStatus {
    if (!['not_configured', 'checking', 'ready', 'attention_required', 'blocked'].includes(String(value))) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Unsupported store connection status.');
    }
    return value as StoreConnectionStatus;
}

export function normalizeSessionStatus(value: unknown): StoreSessionStatus {
    if (!['unknown', 'signed_out', 'checking', 'ready', 'expired', 'blocked'].includes(String(value))) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Unsupported store session status.');
    }
    return value as StoreSessionStatus;
}

export function requiredTimestamp(value: unknown, label: string): string {
    const normalized = optionalTimestamp(value);
    if (!normalized) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', `${label} must be an ISO timestamp.`);
    }
    return normalized;
}

export function optionalTimestamp(value: unknown): string | null {
    const normalized = optionalText(value);
    if (!normalized)
        return null;
    if (Number.isNaN(Date.parse(normalized))) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Timestamp must be parseable ISO date-time text.');
    }
    return normalized;
}

export function optionalText(value: unknown): string | undefined {
    if (value === undefined || value === null)
        return undefined;
    const normalized = String(value).trim();
    return normalized || undefined;
}

export function nullableText(value: unknown): string | null {
    return optionalText(value) ?? null;
}

export function nullableProviderIdentity(value: unknown, label: string): string | null {
    const normalized = nullableText(value);
    if (normalized === null)
        return null;
    if (normalized.length > MAX_PROVIDER_IDENTITY_LENGTH
        || PROVIDER_IDENTITY_CONTROL_CHARACTERS.test(normalized)) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', `${label} must be at most ${MAX_PROVIDER_IDENTITY_LENGTH} characters without control characters.`);
    }
    return normalized;
}

export function nullableExternalAccountIdentity(provider: StoreConnectionProvider, value: unknown): {
    raw: string | null;
    normalized: string | null;
} {
    const raw = nullableProviderIdentity(value, 'externalAccountId');
    try {
        return {
            raw,
            normalized: normalizeProviderExternalAccountId(provider, raw) ?? null,
        };
    }
    catch {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'externalAccountId could not be normalized for the selected provider.');
    }
}

export function nullableCollectionStoreName(provider: StoreConnectionProvider, value: unknown): {
    raw: string | null;
    normalized: string | null;
} {
    const raw = nullableProviderIdentity(value, 'collectionStoreName');
    if (provider === 'amazon_ads' && raw !== null) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'collectionStoreName is available for Lingxing connections only.');
    }
    try {
        return {
            raw,
            normalized: normalizeLingxingCollectionStoreName(raw) ?? null,
        };
    }
    catch {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'collectionStoreName could not be normalized for Lingxing collection.');
    }
}

export function parseJson<T>(value: string | null | undefined): T | undefined {
    if (!value)
        return undefined;
    try {
        return JSON.parse(value) as T;
    }
    catch {
        return undefined;
    }
}

export function isSqliteConstraint(error: unknown): boolean {
    return Boolean(error
        && typeof error === 'object'
        && 'code' in error
        && String((error as {
            code?: unknown;
        }).code).startsWith('SQLITE_CONSTRAINT'));
}

export function isExternalAccountAlreadyBoundConstraint(error: unknown): boolean {
    if (!isSqliteConstraint(error))
        return false;
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('store_connections.provider, store_connections.normalized_external_account_id') || message.includes(STORE_PROVIDER_IDENTITY_UNIQUE_INDEX);
}

export function quoteIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}
