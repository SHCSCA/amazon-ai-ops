// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import Database from 'better-sqlite3';
import type { StoreMigrationBackupManifest, StoreMigrationManifest, StoreMigrationQuarantineReason, StoreMigrationRecoveryPreflight, StoreMigrationRestoreResult, StoreMigrationResult, StoreMigrationTableResult, } from './types';
import { type StoreScopedLegacyTable, type SqlRow, type LegacyIdentity, type PendingQuarantineScope, type CandidateResolution, STORE_AUTHORITY_MIGRATION_VERSION, DIRECT_IDENTITY_TABLES } from './store-authority-v1-contracts';
import { normalizeStoreName, normalizeMarketplaceCode, quoteIdentifier, sqlStringLiteral, nonEmptyString } from './store-authority-v1-values';
import { tableExists, hasColumn } from './store-authority-v1-schema';

export function resolveRowStore(database: Database.Database, table: StoreScopedLegacyTable, row: SqlRow, identity: LegacyIdentity, pendingQuarantineScope: PendingQuarantineScope): CandidateResolution {
    const explicitParent = explicitParentCandidates(database, table, row, pendingQuarantineScope);
    const normalizedStoreName = normalizeStoreName(identity.storeName);
    const marketplaceCode = normalizeMarketplaceCode(identity.marketplaceCode);
    const hasPartialDirectIdentity = Boolean(identity.storeName || identity.marketplaceCode);
    const hasCompleteDirectIdentity = Boolean(normalizedStoreName && marketplaceCode);
    let direct: CandidateResolution | undefined;
    if (hasPartialDirectIdentity) {
        if (marketplaceCode && marketplaceCode !== 'US') {
            return {
                storeIds: explicitParent?.storeIds ?? [],
                reasonWhenEmpty: 'unsupported_marketplace',
                source: 'direct',
                forcedReason: 'unsupported_marketplace',
            };
        }
        direct = {
            storeIds: hasCompleteDirectIdentity
                ? findStoresForIdentity(database, normalizedStoreName, marketplaceCode)
                : [],
            reasonWhenEmpty: 'missing_store_identity',
            source: 'direct',
        };
    }
    if (direct && explicitParent) {
        if (direct.storeIds.length > 1)
            return direct;
        if (explicitParent.storeIds.length > 1)
            return explicitParent;
        if (direct.storeIds.length === 1 && explicitParent.storeIds.length === 1) {
            if (direct.storeIds[0] !== explicitParent.storeIds[0]) {
                return {
                    storeIds: [...new Set([...direct.storeIds, ...explicitParent.storeIds])],
                    reasonWhenEmpty: 'cross_store_conflict',
                    source: 'parent',
                    forcedReason: 'cross_store_conflict',
                };
            }
            return direct;
        }
        if (direct.storeIds.length === 1 && explicitParent.storeIds.length === 0) {
            return {
                ...direct,
                forcedReason: 'missing_parent_store',
            };
        }
        if (direct.storeIds.length === 0 && explicitParent.storeIds.length === 1) {
            if (hasCompleteDirectIdentity) {
                return {
                    storeIds: explicitParent.storeIds,
                    reasonWhenEmpty: 'missing_store_identity',
                    source: 'direct',
                    forcedReason: 'cross_store_conflict',
                };
            }
            return explicitParent;
        }
        return hasCompleteDirectIdentity ? direct : explicitParent;
    }
    if (direct)
        return direct;
    if (explicitParent)
        return explicitParent;
    const fileCandidates = fileScopeCandidates(database, table, row, pendingQuarantineScope);
    if (fileCandidates)
        return fileCandidates;
    const scopeIdentities = scopeJsonIdentities(table, row);
    if (scopeIdentities.length > 1) {
        const storeIds = scopeIdentities.flatMap((scopeIdentity) => {
            const marketplaceCode = normalizeMarketplaceCode(scopeIdentity.marketplaceCode);
            const storeName = normalizeStoreName(scopeIdentity.storeName);
            return storeName && marketplaceCode === 'US'
                ? findStoresForIdentity(database, storeName, marketplaceCode)
                : [];
        });
        return {
            storeIds: [...new Set(storeIds)],
            reasonWhenEmpty: 'ambiguous_store_identity',
            source: 'scope_json',
            forcedReason: 'ambiguous_store_identity',
        };
    }
    const scopeIdentity = scopeIdentities[0];
    if (scopeIdentity) {
        const marketplaceCode = normalizeMarketplaceCode(scopeIdentity.marketplaceCode);
        const storeName = normalizeStoreName(scopeIdentity.storeName);
        if (marketplaceCode && marketplaceCode !== 'US') {
            return { storeIds: [], reasonWhenEmpty: 'unsupported_marketplace', source: 'scope_json' };
        }
        if (!storeName || !marketplaceCode) {
            return { storeIds: [], reasonWhenEmpty: 'missing_store_identity', source: 'scope_json' };
        }
        return {
            storeIds: findStoresForIdentity(database, storeName, marketplaceCode),
            reasonWhenEmpty: 'missing_store_identity',
            source: 'scope_json',
        };
    }
    const asinCandidates = asinScopeCandidates(database, row, pendingQuarantineScope);
    if (asinCandidates)
        return asinCandidates;
    return { storeIds: [], reasonWhenEmpty: 'missing_store_identity', source: 'none' };
}

export function explicitParentCandidates(database: Database.Database, table: StoreScopedLegacyTable, row: SqlRow, pendingQuarantineScope: PendingQuarantineScope): CandidateResolution | undefined {
    const relationship: Partial<Record<StoreScopedLegacyTable, {
        parentTable: StoreScopedLegacyTable;
        localColumn: string;
        parentColumn: string;
    }>> = {
        product_costs: { parentTable: 'products', localColumn: 'product_id', parentColumn: 'id' },
        action_logs: { parentTable: 'action_recommendations', localColumn: 'recommendation_id', parentColumn: 'id' },
        approval_tasks: { parentTable: 'action_recommendations', localColumn: 'recommendation_id', parentColumn: 'id' },
        lingxing_report_files: { parentTable: 'lingxing_report_batches', localColumn: 'batch_id', parentColumn: 'id' },
        report_files: { parentTable: 'lingxing_report_batches', localColumn: 'batch_id', parentColumn: 'id' },
        listing_content_versions: { parentTable: 'listing_content', localColumn: 'listing_content_id', parentColumn: 'id' },
    };
    const link = relationship[table];
    if (!link || row[link.localColumn] === null || row[link.localColumn] === undefined)
        return undefined;
    if (!tableExists(database, link.parentTable) || !hasColumn(database, link.parentTable, 'store_id')) {
        return { storeIds: [], reasonWhenEmpty: 'missing_parent_store', source: 'parent' };
    }
    const candidates = database.prepare(`
    SELECT DISTINCT parent.store_id AS store_id
    FROM ${quoteIdentifier(link.parentTable)} parent
    JOIN stores authority ON authority.store_id = parent.store_id
    WHERE parent.${quoteIdentifier(link.parentColumn)} = ?
      AND NOT EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE ${pendingQuarantineVersionPredicate(pendingQuarantineScope)}
          quarantine.source_table = ${sqlStringLiteral(link.parentTable)}
          AND quarantine.source_row_id = CAST(parent.id AS TEXT)
          AND quarantine.status = 'pending'
      )
  `).all(row[link.localColumn]) as Array<{
        store_id: string;
    }>;
    return {
        storeIds: candidates.map((candidate) => candidate.store_id),
        reasonWhenEmpty: 'missing_parent_store',
        source: 'parent',
    };
}

export function fileScopeCandidates(database: Database.Database, table: StoreScopedLegacyTable, row: SqlRow, pendingQuarantineScope: PendingQuarantineScope): CandidateResolution | undefined {
    if (table !== 'keyword_metrics')
        return undefined;
    const sourceFile = nonEmptyString(row.source_file);
    if (!sourceFile)
        return undefined;
    const candidates = database.prepare(`
    SELECT DISTINCT scoped.store_id AS store_id
    FROM (
      SELECT store_id, file_path, CAST(id AS TEXT) AS source_row_id, 'report_files' AS source_table
      FROM report_files
      UNION ALL
      SELECT store_id, file_path, CAST(id AS TEXT) AS source_row_id, 'lingxing_report_files' AS source_table
      FROM lingxing_report_files
    ) scoped
    JOIN stores authority ON authority.store_id = scoped.store_id
    WHERE scoped.file_path = ?
      AND NOT EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE ${pendingQuarantineVersionPredicate(pendingQuarantineScope)}
          quarantine.source_table = scoped.source_table
          AND quarantine.source_row_id = scoped.source_row_id
          AND quarantine.status = 'pending'
      )
  `).all(sourceFile) as Array<{
        store_id: string;
    }>;
    return {
        storeIds: candidates.map((candidate) => candidate.store_id),
        reasonWhenEmpty: 'missing_parent_store',
        source: 'source_file',
    };
}

export function asinScopeCandidates(database: Database.Database, row: SqlRow, pendingQuarantineScope: PendingQuarantineScope): CandidateResolution | undefined {
    const asin = nonEmptyString(row.asin);
    if (!asin)
        return undefined;
    const candidates = database.prepare(`
    SELECT DISTINCT scoped.store_id AS store_id
    FROM (
      SELECT store_id, asin, CAST(id AS TEXT) AS source_row_id, 'products' AS source_table
      FROM products
      UNION ALL
      SELECT store_id, asin, CAST(id AS TEXT) AS source_row_id, 'listing_content' AS source_table
      FROM listing_content
      UNION ALL
      SELECT store_id, asin, CAST(id AS TEXT) AS source_row_id, 'listing_drafts' AS source_table
      FROM listing_drafts
    ) scoped
    JOIN stores authority ON authority.store_id = scoped.store_id
    WHERE scoped.asin = ?
      AND NOT EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE ${pendingQuarantineVersionPredicate(pendingQuarantineScope)}
          quarantine.source_table = scoped.source_table
          AND quarantine.source_row_id = scoped.source_row_id
          AND quarantine.status = 'pending'
      )
  `).all(asin) as Array<{
        store_id: string;
    }>;
    return {
        storeIds: candidates.map((candidate) => candidate.store_id),
        reasonWhenEmpty: 'missing_parent_store',
        source: 'asin',
    };
}

export function pendingQuarantineVersionPredicate(scope: PendingQuarantineScope): string {
    return scope === 'v1'
        ? `quarantine.migration_version = ${STORE_AUTHORITY_MIGRATION_VERSION} AND`
        : '';
}

export function scopeJsonIdentities(table: StoreScopedLegacyTable, row: SqlRow): LegacyIdentity[] {
    if (table !== 'ai_diagnosis_runs')
        return [];
    const rawScope = nonEmptyString(row.scope_json);
    if (!rawScope)
        return [];
    try {
        const parsed = JSON.parse(rawScope) as unknown;
        const identities: LegacyIdentity[] = [];
        collectIdentitiesInObject(parsed, identities);
        const unique = new Map<string, LegacyIdentity>();
        for (const identity of identities) {
            const storeName = normalizeStoreName(identity.storeName);
            const marketplaceCode = normalizeMarketplaceCode(identity.marketplaceCode);
            unique.set(`${marketplaceCode}\u0000${storeName}`, identity);
        }
        return [...unique.values()];
    }
    catch {
        return [];
    }
}

export function collectIdentitiesInObject(value: unknown, identities: LegacyIdentity[], depth = 0): void {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3)
        return;
    const record = value as Record<string, unknown>;
    const storeName = nonEmptyString(record.storeName ?? record.store_name);
    const marketplaceCode = nonEmptyString(record.marketplaceCode ?? record.marketplace_code ?? record.marketplace);
    if (storeName || marketplaceCode)
        identities.push({ storeName, marketplaceCode });
    for (const child of Object.values(record)) {
        collectIdentitiesInObject(child, identities, depth + 1);
    }
}

export function identityFromRow(table: StoreScopedLegacyTable, row: SqlRow): LegacyIdentity {
    if (!DIRECT_IDENTITY_TABLES.has(table))
        return {};
    return {
        storeName: nonEmptyString(row.store_name),
        marketplaceCode: nonEmptyString(row.marketplace_code),
    };
}

export function quarantineRow(database: Database.Database, table: StoreScopedLegacyTable, sourceRowId: string, reason: StoreMigrationQuarantineReason, identity: LegacyIdentity, candidateStoreIds: string[], row: SqlRow): void {
    const now = new Date().toISOString();
    database.prepare(`
    INSERT INTO store_migration_quarantine (
      migration_version, source_table, source_row_id, reason,
      normalized_store_name, normalized_marketplace_code,
      candidate_store_ids_json, source_identity_json,
      status, created_at, updated_at
    ) VALUES (
      @migrationVersion, @sourceTable, @sourceRowId, @reason,
      @normalizedStoreName, @normalizedMarketplaceCode,
      @candidateStoreIdsJson, @sourceIdentityJson,
      'pending', @createdAt, @updatedAt
    )
    ON CONFLICT(migration_version, source_table, source_row_id) DO NOTHING
  `).run({
        migrationVersion: STORE_AUTHORITY_MIGRATION_VERSION,
        sourceTable: table,
        sourceRowId,
        reason,
        normalizedStoreName: normalizeStoreName(identity.storeName) || null,
        normalizedMarketplaceCode: normalizeMarketplaceCode(identity.marketplaceCode) || null,
        candidateStoreIdsJson: JSON.stringify([...new Set(candidateStoreIds)].sort()),
        sourceIdentityJson: JSON.stringify(sourceIdentitySnapshot(table, row, identity)),
        createdAt: now,
        updatedAt: now,
    });
}

export function sourceIdentitySnapshot(table: StoreScopedLegacyTable, row: SqlRow, identity: LegacyIdentity): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {
        storeName: identity.storeName,
        marketplaceCode: identity.marketplaceCode,
    };
    for (const column of [
        'product_id', 'recommendation_id', 'batch_id', 'listing_content_id',
        'asin', 'source_file',
    ]) {
        if (row[column] !== null && row[column] !== undefined && row[column] !== '') {
            snapshot[column] = row[column];
        }
    }
    if (table === 'ai_diagnosis_runs' && nonEmptyString(row.scope_json)) {
        snapshot.scopeIdentities = scopeJsonIdentities(table, row);
    }
    return snapshot;
}

export function findStoresForIdentity(database: Database.Database, normalizedStoreName: string, normalizedMarketplaceCode: string): string[] {
    if (!normalizedStoreName || !normalizedMarketplaceCode)
        return [];
    const rows = database.prepare(`
    SELECT store_id, display_name, legacy_store_name_normalized,
           legacy_marketplace_code_normalized
    FROM stores
    WHERE marketplace = @marketplaceCode
    ORDER BY store_id
  `).all({
        marketplaceCode: normalizedMarketplaceCode,
    }) as Array<{
        store_id: string;
        display_name: string;
        legacy_store_name_normalized: string | null;
        legacy_marketplace_code_normalized: string | null;
    }>;
    return [...new Set(rows.filter((row) => (row.legacy_store_name_normalized === normalizedStoreName
            && row.legacy_marketplace_code_normalized === normalizedMarketplaceCode) || (row.legacy_store_name_normalized === null
            && normalizeStoreName(row.display_name) === normalizedStoreName)).map((row) => row.store_id))];
}
