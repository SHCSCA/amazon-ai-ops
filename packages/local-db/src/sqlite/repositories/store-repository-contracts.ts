import { DEFAULT_US_BUSINESS_TIMEZONE, normalizeBrowserProfileId, normalizeBusinessTimezone, normalizeLingxingCollectionStoreName, normalizeProviderExternalAccountId, normalizeSessionGeneration, normalizeStoreCapabilityId, normalizeStoreId, normalizeUsdCurrency, normalizeUsMarketplace, type ArchiveStoreInput, type BrowserProfileId, type CreateStoreConnectionInput, type CreateStoreInput, type ListStoresInput, type RemoveStoreConnectionInput, type RestoreStoreInput, type StoreCapabilityId, type StoreConnection, type StoreConnectionProvider, type StoreConnectionStatus, type StoreId, type StoreRecord, type StoreSessionMetadata, type StoreSessionStatus, type StoreStatus, type UpdateStoreConnectionInput, type UpdateStoreInput, } from '@amazon-ai-ops/shared-types';
import { STORE_AUTHORITY_MIGRATION_VERSION, STORE_PROVIDER_IDENTITY_UNIQUE_INDEX, STORE_SCOPED_LEGACY_TABLES, getStoreMigrationRecoveryPreflight, getUpgradeBackupRecoveryPreflight, restoreStoreMigrationBackupTo, restoreUpgradeBackupTo, installStoreProviderIdentitySqlFunction, upgradeBackupFromMigrationManifest, type SchemaMigrationRecord, type SchemaMigrationManifest, type StoreMigrationManifest, type StoreMigrationQuarantineReason, type StoreMigrationQuarantineRecord, type StoreMigrationRecoveryPreflight, type StoreMigrationRestoreResult, type StoreMigrationResult, } from '../migrations';

export interface CreateStoreRecordInput extends CreateStoreInput {
    storeId: StoreId;
    browserProfileId: BrowserProfileId;
    status?: Exclude<StoreStatus, 'archived'>;
}

export interface CreateStoreConnectionRecordInput extends CreateStoreConnectionInput {
    id: StoreCapabilityId;
    status?: StoreConnectionStatus;
    lastVerifiedAt?: string;
    lastFailureCode?: string;
}

export interface UpdateStoreConnectionRecordInput extends UpdateStoreConnectionInput {
    status?: StoreConnectionStatus;
    lastVerifiedAt?: string;
    lastFailureCode?: string;
}

export interface EnrollLingxingStableExternalAccountInput {
    id: StoreCapabilityId;
    storeId: StoreId;
    provider: 'lingxing';
    externalAccountId: string;
    expectedUpdatedAt: string;
}

export interface StoreArchivePreflight {
    storeId: StoreId;
    canArchive: boolean;
    alreadyArchived: boolean;
    scopedRowCounts: Record<string, number>;
    sessionProvidersToInvalidate: StoreConnectionProvider[];
    blockers: string[];
}

export interface StoreRestorePreflight {
    storeId: StoreId;
    canRestore: boolean;
    alreadyActive: boolean;
    blockers: string[];
}

export interface StoreMigrationQuarantineFilter {
    migrationVersion?: number;
    status?: 'pending' | 'resolved';
    sourceTable?: string;
}

export interface ResolveStoreMigrationQuarantineInput {
    quarantineId: number;
    storeId: StoreId;
    resolutionNote: string;
}

export type StoreRepositoryErrorCode = 'STORE_NOT_FOUND' | 'STORE_ALREADY_EXISTS' | 'STORE_ARCHIVED' | 'STORE_NOT_ACTIVE' | 'STORE_CONFLICT' | 'INVALID_STORE_INPUT' | 'CONNECTION_NOT_FOUND' | 'CONNECTION_CONFLICT' | 'EXTERNAL_ACCOUNT_ALREADY_BOUND' | 'SESSION_GENERATION_STALE' | 'SESSION_PROFILE_MISMATCH' | 'MIGRATION_NOT_FOUND' | 'QUARANTINE_NOT_FOUND' | 'QUARANTINE_ALREADY_RESOLVED' | 'QUARANTINE_TARGET_CONFLICT';

export class StoreRepositoryError extends Error {
    readonly code: StoreRepositoryErrorCode;
    constructor(code: StoreRepositoryErrorCode, message: string) {
        super(message);
        this.name = 'StoreRepositoryError';
        this.code = code;
    }
}

export interface StoreRow {
    store_id: string;
    browser_profile_id: string;
    marketplace: string;
    currency: string;
    display_name: string;
    status: StoreStatus;
    business_timezone: string;
    created_at: string;
    updated_at: string;
    archived_at: string | null;
}

export interface ConnectionRow {
    id: string;
    store_id: string;
    provider: string;
    status: string;
    account_label: string | null;
    external_account_id: string | null;
    normalized_external_account_id: string | null;
    collection_store_name: string | null;
    normalized_collection_store_name: string | null;
    last_verified_at: string | null;
    last_failure_code: string | null;
    created_at: string;
    updated_at: string;
}

export interface SessionRow {
    store_id: string;
    provider: string;
    browser_profile_id: string;
    status: string;
    session_generation: number;
    observed_at: string;
    account_label: string | null;
    external_account_id: string | null;
    verified_at: string | null;
    expires_at: string | null;
    failure_code: string | null;
}

export interface SchemaMigrationRow {
    version: number;
    name: string;
    checksum: string;
    status: 'started' | 'applied' | 'failed';
    started_at: string;
    applied_at: string | null;
    error_message: string | null;
    manifest_json: string;
    result_json: string | null;
}

export interface QuarantineRow {
    id: number;
    migration_version: number;
    source_table: string;
    source_row_id: string;
    reason: string;
    normalized_store_name: string | null;
    normalized_marketplace_code: string | null;
    candidate_store_ids_json: string;
    source_identity_json: string;
    status: 'pending' | 'resolved';
    resolved_store_id: string | null;
    resolution_note: string | null;
    created_at: string;
    updated_at: string;
    resolved_at: string | null;
}

export interface QuarantineParentLink {
    parentTable: typeof STORE_SCOPED_LEGACY_TABLES[number];
    localColumn: string;
    parentColumn: string;
    parentIdentityColumn: string;
}

export const QUARANTINE_PARENT_LINKS: Partial<Record<typeof STORE_SCOPED_LEGACY_TABLES[number], QuarantineParentLink>> = {
    product_costs: {
        parentTable: 'products',
        localColumn: 'product_id',
        parentColumn: 'id',
        parentIdentityColumn: 'id',
    },
    action_logs: {
        parentTable: 'action_recommendations',
        localColumn: 'recommendation_id',
        parentColumn: 'id',
        parentIdentityColumn: 'id',
    },
    approval_tasks: {
        parentTable: 'action_recommendations',
        localColumn: 'recommendation_id',
        parentColumn: 'id',
        parentIdentityColumn: 'id',
    },
    lingxing_report_files: {
        parentTable: 'lingxing_report_batches',
        localColumn: 'batch_id',
        parentColumn: 'id',
        parentIdentityColumn: 'id',
    },
    report_files: {
        parentTable: 'lingxing_report_batches',
        localColumn: 'batch_id',
        parentColumn: 'id',
        parentIdentityColumn: 'id',
    },
    ad_daily_metrics: {
        parentTable: 'lingxing_report_batches',
        localColumn: 'batch_id',
        parentColumn: 'id',
        parentIdentityColumn: 'id',
    },
    listing_content_versions: {
        parentTable: 'listing_content',
        localColumn: 'listing_content_id',
        parentColumn: 'id',
        parentIdentityColumn: 'id',
    },
};

export const MAX_PROVIDER_IDENTITY_LENGTH = 256;

export const PROVIDER_IDENTITY_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
