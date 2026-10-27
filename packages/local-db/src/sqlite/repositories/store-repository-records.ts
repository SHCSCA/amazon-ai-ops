import { DEFAULT_US_BUSINESS_TIMEZONE, normalizeBrowserProfileId, normalizeBusinessTimezone, normalizeLingxingCollectionStoreName, normalizeProviderExternalAccountId, normalizeSessionGeneration, normalizeStoreCapabilityId, normalizeStoreId, normalizeUsdCurrency, normalizeUsMarketplace, type ArchiveStoreInput, type BrowserProfileId, type CreateStoreConnectionInput, type CreateStoreInput, type ListStoresInput, type RemoveStoreConnectionInput, type RestoreStoreInput, type StoreCapabilityId, type StoreConnection, type StoreConnectionProvider, type StoreConnectionStatus, type StoreId, type StoreRecord, type StoreSessionMetadata, type StoreSessionStatus, type StoreStatus, type UpdateStoreConnectionInput, type UpdateStoreInput, } from '@amazon-ai-ops/shared-types';
import { STORE_AUTHORITY_MIGRATION_VERSION, STORE_PROVIDER_IDENTITY_UNIQUE_INDEX, STORE_SCOPED_LEGACY_TABLES, getStoreMigrationRecoveryPreflight, getUpgradeBackupRecoveryPreflight, restoreStoreMigrationBackupTo, restoreUpgradeBackupTo, installStoreProviderIdentitySqlFunction, upgradeBackupFromMigrationManifest, type SchemaMigrationRecord, type SchemaMigrationManifest, type StoreMigrationManifest, type StoreMigrationQuarantineReason, type StoreMigrationQuarantineRecord, type StoreMigrationRecoveryPreflight, type StoreMigrationRestoreResult, type StoreMigrationResult, } from '../migrations';
import { type StoreRow, type SessionRow, type SchemaMigrationRow, StoreRepositoryError, type QuarantineRow } from './store-repository-contracts';
import { normalizeV1Marketplace, normalizeV1Currency, normalizeV1BusinessTimezone, optionalText, normalizeProvider, normalizeSessionStatus, parseJson } from './store-repository-values';

export function mapStore(row: StoreRow): StoreRecord {
    return {
        storeId: normalizeStoreId(row.store_id),
        browserProfileId: normalizeBrowserProfileId(row.browser_profile_id),
        marketplace: normalizeV1Marketplace(row.marketplace),
        currency: normalizeV1Currency(row.currency),
        displayName: row.display_name,
        status: row.status,
        businessTimezone: normalizeV1BusinessTimezone(row.business_timezone),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        archivedAt: optionalText(row.archived_at),
    };
}

export function mapSession(row: SessionRow): StoreSessionMetadata {
    return {
        storeId: normalizeStoreId(row.store_id),
        browserProfileId: normalizeBrowserProfileId(row.browser_profile_id),
        provider: normalizeProvider(row.provider),
        status: normalizeSessionStatus(row.status),
        sessionGeneration: normalizeSessionGeneration(row.session_generation),
        observedAt: row.observed_at,
        accountLabel: optionalText(row.account_label),
        externalAccountId: optionalText(row.external_account_id),
        verifiedAt: optionalText(row.verified_at),
        expiresAt: optionalText(row.expires_at),
        failureCode: optionalText(row.failure_code),
    };
}

export function mapSchemaMigration(row: SchemaMigrationRow): SchemaMigrationRecord {
    const manifest = parseJson<SchemaMigrationManifest>(row.manifest_json);
    if (!manifest) {
        throw new StoreRepositoryError('MIGRATION_NOT_FOUND', `Migration ${row.version} has an unreadable manifest.`);
    }
    return {
        version: row.version,
        name: row.name,
        checksum: row.checksum,
        status: row.status,
        startedAt: row.started_at,
        appliedAt: optionalText(row.applied_at),
        errorMessage: optionalText(row.error_message),
        manifest,
        result: parseJson<StoreMigrationResult>(row.result_json),
    };
}

export function isStoreMigrationManifest(manifest: SchemaMigrationManifest): manifest is StoreMigrationManifest {
    return 'backup' in manifest
        && 'schemaFingerprint' in manifest
        && 'tableRowCounts' in manifest
        && 'targetTables' in manifest;
}

export function mapQuarantine(row: QuarantineRow): StoreMigrationQuarantineRecord {
    return {
        id: row.id,
        migrationVersion: row.migration_version,
        sourceTable: row.source_table,
        sourceRowId: row.source_row_id,
        reason: row.reason as StoreMigrationQuarantineReason,
        normalizedStoreName: optionalText(row.normalized_store_name),
        normalizedMarketplaceCode: optionalText(row.normalized_marketplace_code),
        candidateStoreIds: parseJson<string[]>(row.candidate_store_ids_json) ?? [],
        sourceIdentity: parseJson<Record<string, unknown>>(row.source_identity_json) ?? {},
        status: row.status,
        resolvedStoreId: optionalText(row.resolved_store_id),
        resolutionNote: optionalText(row.resolution_note),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        resolvedAt: optionalText(row.resolved_at),
    };
}
