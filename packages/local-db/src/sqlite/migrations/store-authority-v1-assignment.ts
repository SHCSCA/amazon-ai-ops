// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import type { StoreMigrationBackupManifest, StoreMigrationManifest, StoreMigrationQuarantineReason, StoreMigrationRecoveryPreflight, StoreMigrationRestoreResult, StoreMigrationResult, StoreMigrationTableResult, } from './types';
import { createStoreAuthorityTables, addLegacyStoreIdColumns, verifyStoreAuthoritySchema, tableExists, hasColumn, storeExists } from './store-authority-v1-schema';
import { STORE_SCOPED_LEGACY_TABLES, STORE_AUTHORITY_MIGRATION_VERSION, STORE_AUTHORITY_MIGRATION_NAME, type StoreAuthorityQuarantineRepairResult, type StoreScopedLegacyTable, type SqlRow, StoreAuthorityMigrationError, ASIN_SCOPE_AUTHORITY_TABLES, DIRECT_IDENTITY_TABLES } from './store-authority-v1-contracts';
import { quoteIdentifier, nonEmptyString, isSqliteConstraintError, normalizeStoreName, normalizeMarketplaceCode, identityKey, sqlStringLiteral } from './store-authority-v1-values';
import { identityFromRow, resolveRowStore, findStoresForIdentity, quarantineRow } from './store-authority-v1-resolution';

export function applyStoreAuthorityMigration(database: Database.Database, manifest: StoreMigrationManifest): StoreMigrationResult {
    createStoreAuthorityTables(database);
    const storeIdColumnAdditions = addLegacyStoreIdColumns(database);
    const createdStores = seedLegacyStores(database);
    primeDirectStoreOwnership(database);
    const tableResults = STORE_SCOPED_LEGACY_TABLES.map((table) => migrateLegacyTable(database, table, storeIdColumnAdditions.get(table) ?? false));
    verifyStoreAuthoritySchema(database, STORE_SCOPED_LEGACY_TABLES);
    return {
        version: STORE_AUTHORITY_MIGRATION_VERSION,
        name: STORE_AUTHORITY_MIGRATION_NAME,
        status: 'applied',
        startedAt: manifest.startedAt,
        finishedAt: new Date().toISOString(),
        tableResults,
        mappedRows: tableResults.reduce((total, result) => total + result.mappedRows, 0),
        quarantinedRows: tableResults.reduce((total, result) => total + result.quarantinedRows, 0),
        createdStores,
    };
}

export function repairPendingStoreAuthorityQuarantines(database: Database.Database): StoreAuthorityQuarantineRepairResult {
    const eligibleReasons = new Set<StoreMigrationQuarantineReason>([
        'missing_store_identity',
        'missing_parent_store',
    ]);
    const pending = database.prepare(`
    SELECT id, source_table, source_row_id, reason
    FROM store_migration_quarantine
    WHERE migration_version = ?
      AND status = 'pending'
    ORDER BY id
  `).all(STORE_AUTHORITY_MIGRATION_VERSION) as Array<{
        id: number;
        source_table: string;
        source_row_id: string;
        reason: StoreMigrationQuarantineReason;
    }>;
    const eligible = pending.filter((item) => ((STORE_SCOPED_LEGACY_TABLES as readonly string[]).includes(item.source_table)
        && eligibleReasons.has(item.reason)));
    const repaired = new Set<number>();
    let passes = 0;
    let changed = true;
    const maximumPasses = Math.max(1, eligible.length + 1);
    while (changed && passes < maximumPasses) {
        changed = false;
        passes += 1;
        for (const quarantine of eligible) {
            if (repaired.has(quarantine.id))
                continue;
            const table = quarantine.source_table as StoreScopedLegacyTable;
            if (!tableExists(database, table) || !hasColumn(database, table, 'store_id'))
                continue;
            const identityColumn = hasColumn(database, table, 'id') ? 'id' : 'rowid';
            const row = database.prepare(`
        SELECT rowid AS __migration_rowid, *
        FROM ${quoteIdentifier(table)}
        WHERE CAST(${quoteIdentifier(identityColumn)} AS TEXT) = ?
        LIMIT 1
      `).get(quarantine.source_row_id) as SqlRow | undefined;
            if (!row)
                continue;
            const otherPendingQuarantine = database.prepare(`
        SELECT 1
        FROM store_migration_quarantine
        WHERE source_table = ?
          AND source_row_id = ?
          AND status = 'pending'
          AND id <> ?
        LIMIT 1
      `).get(table, quarantine.source_row_id, quarantine.id);
            if (otherPendingQuarantine)
                continue;
            const identity = identityFromRow(table, row);
            const resolution = resolveRowStore(database, table, row, identity, 'all_versions');
            if (resolution.forcedReason)
                continue;
            const existingStoreId = nonEmptyString(row.store_id);
            const existingIsValid = existingStoreId ? storeExists(database, existingStoreId) : false;
            const uniqueCandidates = [...new Set(resolution.storeIds)];
            let resolvedStoreId: string | undefined;
            if (existingStoreId && existingIsValid) {
                if (uniqueCandidates.length > 0 && uniqueCandidates.some((candidate) => candidate !== existingStoreId)) {
                    continue;
                }
                resolvedStoreId = existingStoreId;
            }
            else if (!existingStoreId && uniqueCandidates.length === 1) {
                resolvedStoreId = uniqueCandidates[0];
            }
            if (!resolvedStoreId)
                continue;
            const hasQuarantineMarker = hasColumn(database, table, 'store_authority_quarantined');
            const quarantineMarkerSet = hasQuarantineMarker
                && Number(row.store_authority_quarantined ?? 0) !== 0;
            if (!existingStoreId || quarantineMarkerSet) {
                try {
                    const write = database.prepare(`
            UPDATE ${quoteIdentifier(table)}
            SET store_id = @resolvedStoreId
              ${hasQuarantineMarker ? ', store_authority_quarantined = 0' : ''}
            WHERE rowid = @rowId
              AND (store_id IS NULL OR store_id = @resolvedStoreId)
          `).run({
                        resolvedStoreId,
                        rowId: row.__migration_rowid,
                    });
                    if (write.changes !== 1)
                        continue;
                }
                catch (error) {
                    if (isSqliteConstraintError(error))
                        continue;
                    throw error;
                }
            }
            const resolvedAt = new Date().toISOString();
            const quarantineResolution = database.prepare(`
        UPDATE store_migration_quarantine
        SET status = 'resolved',
            resolved_store_id = @resolvedStoreId,
            resolution_note = @resolutionNote,
            resolved_at = @resolvedAt,
            updated_at = @resolvedAt
        WHERE id = @id
          AND migration_version = @migrationVersion
          AND status = 'pending'
      `).run({
                id: quarantine.id,
                migrationVersion: STORE_AUTHORITY_MIGRATION_VERSION,
                resolvedAt,
                resolvedStoreId,
                resolutionNote: 'Automatically repaired by store-authority quarantine repair v9 from current unique authority evidence.',
            });
            if (quarantineResolution.changes !== 1) {
                throw new StoreAuthorityMigrationError(STORE_AUTHORITY_MIGRATION_VERSION, `Store authority quarantine ${quarantine.id} changed concurrently during v9 repair.`);
            }
            repaired.add(quarantine.id);
            changed = true;
        }
    }
    const remainingPendingRows = Number((database.prepare(`
    SELECT COUNT(*) AS count
    FROM store_migration_quarantine
    WHERE migration_version = ? AND status = 'pending'
  `).get(STORE_AUTHORITY_MIGRATION_VERSION) as {
        count: number;
    }).count);
    return {
        examinedRows: eligible.length,
        repairedRows: repaired.size,
        remainingPendingRows,
        passes,
    };
}

export function primeDirectStoreOwnership(database: Database.Database): void {
    for (const table of ASIN_SCOPE_AUTHORITY_TABLES) {
        if (!tableExists(database, table)
            || !hasColumn(database, table, 'store_id')
            || !hasColumn(database, table, 'store_name')
            || !hasColumn(database, table, 'marketplace_code')) {
            continue;
        }
        const rows = database.prepare(`
      SELECT rowid AS __migration_rowid, store_id, store_name, marketplace_code
      FROM ${quoteIdentifier(table)}
      WHERE store_id IS NULL
        AND store_name IS NOT NULL AND trim(store_name) <> ''
        AND marketplace_code IS NOT NULL AND trim(marketplace_code) <> ''
    `).all() as SqlRow[];
        for (const row of rows) {
            const storeName = normalizeStoreName(row.store_name);
            const marketplaceCode = normalizeMarketplaceCode(row.marketplace_code);
            if (!storeName || marketplaceCode !== 'US')
                continue;
            const candidates = findStoresForIdentity(database, storeName, marketplaceCode);
            if (candidates.length !== 1)
                continue;
            database.prepare(`
        UPDATE ${quoteIdentifier(table)}
        SET store_id = ?
        WHERE rowid = ? AND store_id IS NULL
      `).run(candidates[0], row.__migration_rowid);
        }
    }
}

export function seedLegacyStores(database: Database.Database): number {
    const identities = new Map<string, {
        storeName: string;
        marketplaceCode: string;
    }>();
    for (const table of DIRECT_IDENTITY_TABLES) {
        if (!tableExists(database, table)
            || !hasColumn(database, table, 'store_name')
            || !hasColumn(database, table, 'marketplace_code')) {
            continue;
        }
        const rows = database.prepare(`
      SELECT DISTINCT store_name, marketplace_code
      FROM ${quoteIdentifier(table)}
      WHERE store_name IS NOT NULL AND trim(store_name) <> ''
        AND marketplace_code IS NOT NULL AND trim(marketplace_code) <> ''
    `).all() as Array<{
            store_name: unknown;
            marketplace_code: unknown;
        }>;
        for (const row of rows) {
            const storeName = normalizeStoreName(row.store_name);
            const marketplaceCode = normalizeMarketplaceCode(row.marketplace_code);
            if (!storeName || marketplaceCode !== 'US')
                continue;
            const key = identityKey(storeName, marketplaceCode);
            const displayName = String(row.store_name).trim().replace(/\s+/g, ' ');
            const previous = identities.get(key);
            if (!previous || displayName.localeCompare(previous.storeName) < 0) {
                identities.set(key, { storeName: displayName, marketplaceCode });
            }
        }
    }
    let created = 0;
    const now = new Date().toISOString();
    for (const [key, identity] of [...identities.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        const normalizedStoreName = normalizeStoreName(identity.storeName);
        const candidates = findStoresForIdentity(database, normalizedStoreName, identity.marketplaceCode);
        if (candidates.length === 1) {
            database.prepare(`
        UPDATE stores
        SET legacy_store_name_normalized = COALESCE(legacy_store_name_normalized, @storeName),
            legacy_marketplace_code_normalized = COALESCE(legacy_marketplace_code_normalized, @marketplaceCode)
        WHERE store_id = @storeId
      `).run({
                storeId: candidates[0],
                storeName: normalizedStoreName,
                marketplaceCode: identity.marketplaceCode,
            });
            continue;
        }
        if (candidates.length > 1)
            continue;
        const hash = createHash('sha256').update(key).digest('hex').slice(0, 16);
        const storeId = `legacy-${hash}`;
        database.prepare(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency, display_name,
        status, business_timezone, legacy_store_name_normalized,
        legacy_marketplace_code_normalized, created_at, updated_at
      ) VALUES (
        @storeId, @browserProfileId, 'US', 'USD', @displayName,
        'active', 'America/Los_Angeles', @normalizedStoreName,
        @marketplaceCode, @createdAt, @updatedAt
      )
      ON CONFLICT(store_id) DO NOTHING
    `).run({
            storeId,
            browserProfileId: `${storeId}-profile`,
            displayName: identity.storeName,
            normalizedStoreName,
            marketplaceCode: identity.marketplaceCode,
            createdAt: now,
            updatedAt: now,
        });
        if (findStoresForIdentity(database, normalizedStoreName, identity.marketplaceCode).length === 1) {
            created += 1;
        }
    }
    return created;
}

export function migrateLegacyTable(database: Database.Database, table: StoreScopedLegacyTable, storeIdColumnAdded: boolean): StoreMigrationTableResult {
    const indexName = `idx_${table}_store_id`;
    if (!tableExists(database, table)) {
        return {
            table,
            totalRows: 0,
            mappedRows: 0,
            quarantinedRows: 0,
            storeIdColumnAdded: false,
            indexName,
            skipped: true,
        };
    }
    database.exec(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${quoteIdentifier(table)}(store_id)`);
    const rows = database.prepare(`SELECT rowid AS __migration_rowid, * FROM ${quoteIdentifier(table)}`).all() as SqlRow[];
    for (const row of rows)
        migrateLegacyRow(database, table, row);
    const totalRows = rows.length;
    const identityColumn = hasColumn(database, table, 'id') ? 'id' : 'rowid';
    const mappedRows = Number((database.prepare(`
    SELECT COUNT(*) AS count
    FROM ${quoteIdentifier(table)} legacy
    JOIN stores authority ON authority.store_id = legacy.store_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM store_migration_quarantine quarantine
      WHERE quarantine.migration_version = ${STORE_AUTHORITY_MIGRATION_VERSION}
        AND quarantine.source_table = ${sqlStringLiteral(table)}
        AND quarantine.source_row_id = CAST(legacy.${quoteIdentifier(identityColumn)} AS TEXT)
        AND quarantine.status = 'pending'
    )
  `).get() as {
        count: number;
    }).count);
    const quarantinedRows = Number((database.prepare(`
    SELECT COUNT(*) AS count
    FROM store_migration_quarantine
    WHERE migration_version = ? AND source_table = ? AND status = 'pending'
  `).get(STORE_AUTHORITY_MIGRATION_VERSION, table) as {
        count: number;
    }).count);
    if (totalRows !== mappedRows + quarantinedRows) {
        throw new StoreAuthorityMigrationError(STORE_AUTHORITY_MIGRATION_VERSION, `Store migration accounting failed for ${table}: ${totalRows} != ${mappedRows} + ${quarantinedRows}.`);
    }
    return {
        table,
        totalRows,
        mappedRows,
        quarantinedRows,
        storeIdColumnAdded,
        indexName,
        skipped: false,
    };
}

export function migrateLegacyRow(database: Database.Database, table: StoreScopedLegacyTable, row: SqlRow): void {
    const rowId = String(row.id ?? row.__migration_rowid);
    const identity = identityFromRow(table, row);
    const existingStoreId = nonEmptyString(row.store_id);
    const existingIsValid = existingStoreId ? storeExists(database, existingStoreId) : false;
    const resolution = resolveRowStore(database, table, row, identity, 'v1');
    if (existingStoreId && !existingIsValid) {
        quarantineRow(database, table, rowId, 'invalid_existing_store_id', identity, [], row);
        return;
    }
    if (existingStoreId && existingIsValid && resolution.forcedReason) {
        quarantineRow(database, table, rowId, resolution.forcedReason, identity, [...new Set([existingStoreId, ...resolution.storeIds])], row);
        return;
    }
    if (existingStoreId && resolution.storeIds.length === 1 && resolution.storeIds[0] !== existingStoreId) {
        quarantineRow(database, table, rowId, 'cross_store_conflict', identity, [...new Set([existingStoreId, ...resolution.storeIds])], row);
        return;
    }
    if (existingStoreId && existingIsValid)
        return;
    if (resolution.forcedReason) {
        quarantineRow(database, table, rowId, resolution.forcedReason, identity, resolution.storeIds, row);
        return;
    }
    if (resolution.storeIds.length === 1) {
        database.prepare(`
      UPDATE ${quoteIdentifier(table)}
      SET store_id = ?
      WHERE rowid = ? AND store_id IS NULL
    `).run(resolution.storeIds[0], row.__migration_rowid);
        return;
    }
    const reason = resolution.forcedReason ?? (resolution.storeIds.length > 1
        ? (resolution.source === 'direct' ? 'ambiguous_store_identity' : 'ambiguous_parent_store')
        : resolution.reasonWhenEmpty);
    quarantineRow(database, table, rowId, reason, identity, resolution.storeIds, row);
}
