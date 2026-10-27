// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import Database from 'better-sqlite3';
import type { StoreMigrationBackupManifest, StoreMigrationManifest, StoreMigrationQuarantineReason, StoreMigrationRecoveryPreflight, StoreMigrationRestoreResult, StoreMigrationResult, StoreMigrationTableResult, } from './types';

export const STORE_AUTHORITY_MIGRATION_VERSION = 1;

export const STORE_AUTHORITY_MIGRATION_NAME = 'store-authority-v1';

export const LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM = 'store-authority-v1-20260722-02';

export const STORE_AUTHORITY_MIGRATION_CHECKSUM = 'store-authority-v1-20260727-03';

export const STORE_SCOPED_LEGACY_TABLES = [
    'products',
    'product_costs',
    'ad_daily_metrics',
    'inventory_daily_metrics',
    'action_recommendations',
    'action_logs',
    'approval_tasks',
    'lingxing_report_batches',
    'lingxing_report_files',
    'report_files',
    'operation_events',
    'download_center_diagnostics',
    'listing_content',
    'listing_content_versions',
    'listing_drafts',
    'ai_call_logs',
    'ai_diagnosis_runs',
    'keyword_metrics',
    'keyword_coverage',
    'keyword_opportunities',
    'listing_suggestions',
] as const;

export type StoreScopedLegacyTable = typeof STORE_SCOPED_LEGACY_TABLES[number];

export type SqlRow = Record<string, unknown>;

export interface LegacyIdentity {
    storeName?: string;
    marketplaceCode?: string;
}

export interface CandidateResolution {
    storeIds: string[];
    reasonWhenEmpty: StoreMigrationQuarantineReason;
    source: string;
    forcedReason?: StoreMigrationQuarantineReason;
}

export interface StoreAuthorityMigrationDefinition {
    version: number;
    name: string;
    checksum: string;
    targetTables: readonly StoreScopedLegacyTable[];
    up(database: Database.Database, manifest: StoreMigrationManifest): StoreMigrationResult;
}

export interface StoreAuthorityQuarantineRepairResult {
    examinedRows: number;
    repairedRows: number;
    remainingPendingRows: number;
    passes: number;
}

export interface MigrationStateRow {
    checksum: string;
    status: string;
    manifest_json: string | null;
    result_json: string | null;
}

export interface StoreAuthorityLegacyChecksumProvenance {
    legacyChecksum: typeof LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM;
    promotedToChecksum: typeof STORE_AUTHORITY_MIGRATION_CHECKSUM;
    previousStatus: 'started' | 'failed';
    previousStartedAt: string;
    promotedAt: string;
}

export type StoreAuthorityMigrationManifest = StoreMigrationManifest & {
    legacyChecksumProvenance?: StoreAuthorityLegacyChecksumProvenance;
};

export type PendingQuarantineScope = 'v1' | 'all_versions';

export const DIRECT_IDENTITY_TABLES = new Set<StoreScopedLegacyTable>([
    'products',
    'ad_daily_metrics',
    'inventory_daily_metrics',
    'action_recommendations',
    'lingxing_report_batches',
    'operation_events',
    'download_center_diagnostics',
    'listing_content',
    'listing_content_versions',
    'listing_drafts',
]);

export const ASIN_SCOPE_AUTHORITY_TABLES = [
    'products',
    'listing_content',
    'listing_drafts',
] as const satisfies readonly StoreScopedLegacyTable[];

export class StoreAuthorityMigrationError extends Error {
    readonly version: number;
    constructor(version: number, message: string) {
        super(message);
        this.name = 'StoreAuthorityMigrationError';
        this.version = version;
    }
}
