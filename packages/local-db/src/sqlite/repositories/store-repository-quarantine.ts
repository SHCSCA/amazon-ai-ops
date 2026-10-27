import { DEFAULT_US_BUSINESS_TIMEZONE, normalizeBrowserProfileId, normalizeBusinessTimezone, normalizeLingxingCollectionStoreName, normalizeProviderExternalAccountId, normalizeSessionGeneration, normalizeStoreCapabilityId, normalizeStoreId, normalizeUsdCurrency, normalizeUsMarketplace, type ArchiveStoreInput, type BrowserProfileId, type CreateStoreConnectionInput, type CreateStoreInput, type ListStoresInput, type RemoveStoreConnectionInput, type RestoreStoreInput, type StoreCapabilityId, type StoreConnection, type StoreConnectionProvider, type StoreConnectionStatus, type StoreId, type StoreRecord, type StoreSessionMetadata, type StoreSessionStatus, type StoreStatus, type UpdateStoreConnectionInput, type UpdateStoreInput, } from '@amazon-ai-ops/shared-types';
import { STORE_AUTHORITY_MIGRATION_VERSION, STORE_PROVIDER_IDENTITY_UNIQUE_INDEX, STORE_SCOPED_LEGACY_TABLES, getStoreMigrationRecoveryPreflight, getUpgradeBackupRecoveryPreflight, restoreStoreMigrationBackupTo, restoreUpgradeBackupTo, installStoreProviderIdentitySqlFunction, upgradeBackupFromMigrationManifest, type SchemaMigrationRecord, type SchemaMigrationManifest, type StoreMigrationManifest, type StoreMigrationQuarantineReason, type StoreMigrationQuarantineRecord, type StoreMigrationRecoveryPreflight, type StoreMigrationRestoreResult, type StoreMigrationResult, } from '../migrations';
import { type StoreMigrationQuarantineFilter, StoreRepositoryError, type QuarantineRow, type ResolveStoreMigrationQuarantineInput, QUARANTINE_PARENT_LINKS } from './store-repository-contracts';
import { mapQuarantine } from './store-repository-records';
import { normalizeDisplayName, quoteIdentifier, isSqliteConstraint } from './store-repository-values';
import type { StoreRepositoryContext } from './store-repository-context';

export function listMigrationQuarantine(repositoryContext: StoreRepositoryContext, filter: StoreMigrationQuarantineFilter = {}): StoreMigrationQuarantineRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.migrationVersion !== undefined) {
        clauses.push('migration_version = ?');
        params.push(filter.migrationVersion);
    }
    if (filter.status !== undefined) {
        clauses.push('status = ?');
        params.push(filter.status);
    }
    if (filter.sourceTable !== undefined) {
        if (!(STORE_SCOPED_LEGACY_TABLES as readonly string[]).includes(filter.sourceTable)) {
            throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Unknown store migration source table.');
        }
        clauses.push('source_table = ?');
        params.push(filter.sourceTable);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = repositoryContext.db.prepare(`
      SELECT * FROM store_migration_quarantine
      ${where}
      ORDER BY migration_version, source_table, source_row_id, id
    `).all(...params) as QuarantineRow[];
    return rows.map(mapQuarantine);
}

export function resolveMigrationQuarantine(repositoryContext: StoreRepositoryContext, input: ResolveStoreMigrationQuarantineInput): StoreMigrationQuarantineRecord {
    if (!Number.isSafeInteger(input.quarantineId) || input.quarantineId <= 0) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'quarantineId must be a positive integer.');
    }
    const store = repositoryContext.methods.requireStore(input.storeId);
    const resolutionNote = normalizeDisplayName(input.resolutionNote);
    const resolve = repositoryContext.db.transaction(() => {
        const row = repositoryContext.db.prepare(`
        SELECT * FROM store_migration_quarantine WHERE id = ?
      `).get(input.quarantineId) as QuarantineRow | undefined;
        if (!row) {
            throw new StoreRepositoryError('QUARANTINE_NOT_FOUND', 'Migration quarantine record was not found.');
        }
        if (row.status !== 'pending') {
            throw new StoreRepositoryError('QUARANTINE_ALREADY_RESOLVED', 'Migration quarantine record has already been resolved.');
        }
        if (!(STORE_SCOPED_LEGACY_TABLES as readonly string[]).includes(row.source_table)) {
            throw new StoreRepositoryError('QUARANTINE_TARGET_CONFLICT', 'Quarantine source table is not allowlisted.');
        }
        const sourceTable = row.source_table as typeof STORE_SCOPED_LEGACY_TABLES[number];
        const identityColumn = repositoryContext.methods.tableHasColumn(sourceTable, 'id') ? 'id' : 'rowid';
        const source = repositoryContext.db.prepare(`
        SELECT *
        FROM ${quoteIdentifier(sourceTable)}
        WHERE CAST(${quoteIdentifier(identityColumn)} AS TEXT) = ?
      `).get(row.source_row_id) as Record<string, unknown> | undefined;
        if (!source) {
            throw new StoreRepositoryError('QUARANTINE_TARGET_CONFLICT', 'Quarantined source row no longer exists.');
        }
        if (typeof source.store_id === 'string' && source.store_id && source.store_id !== store.storeId) {
            throw new StoreRepositoryError('QUARANTINE_TARGET_CONFLICT', `Source row is already assigned to store ${source.store_id}.`);
        }
        repositoryContext.methods.assertQuarantineParentAuthority(sourceTable, source, store.storeId);
        if (!source.store_id) {
            repositoryContext.db.prepare(`
          UPDATE ${quoteIdentifier(sourceTable)}
          SET store_id = ?
          WHERE CAST(${quoteIdentifier(identityColumn)} AS TEXT) = ? AND store_id IS NULL
        `).run(store.storeId, row.source_row_id);
        }
        if (repositoryContext.methods.tableHasColumn(sourceTable, 'store_authority_quarantined')) {
            repositoryContext.db.prepare(`
          UPDATE ${quoteIdentifier(sourceTable)}
          SET store_authority_quarantined = 0
          WHERE CAST(${quoteIdentifier(identityColumn)} AS TEXT) = ?
            AND store_authority_quarantined = 1
        `).run(row.source_row_id);
        }
        const now = new Date().toISOString();
        const resolution = repositoryContext.db.prepare(`
        UPDATE store_migration_quarantine
        SET status = 'resolved', resolved_store_id = @storeId,
            resolution_note = @resolutionNote, resolved_at = @resolvedAt,
            updated_at = @updatedAt
        WHERE id = @id AND status = 'pending'
      `).run({
            id: row.id,
            storeId: store.storeId,
            resolutionNote,
            resolvedAt: now,
            updatedAt: now,
        });
        if (resolution.changes !== 1) {
            throw new StoreRepositoryError('QUARANTINE_ALREADY_RESOLVED', 'Migration quarantine record was resolved concurrently.');
        }
        return mapQuarantine(repositoryContext.db.prepare(`
        SELECT * FROM store_migration_quarantine WHERE id = ?
      `).get(row.id) as QuarantineRow);
    });
    try {
        return resolve();
    }
    catch (error) {
        if (error instanceof StoreRepositoryError)
            throw error;
        if (isSqliteConstraint(error)) {
            throw new StoreRepositoryError('QUARANTINE_TARGET_CONFLICT', 'Resolving this row would conflict with existing store-scoped authority.');
        }
        throw error;
    }
}

export function assertQuarantineParentAuthority(repositoryContext: StoreRepositoryContext, sourceTable: typeof STORE_SCOPED_LEGACY_TABLES[number], source: Record<string, unknown>, storeId: StoreId): void {
    const link = QUARANTINE_PARENT_LINKS[sourceTable];
    if (link) {
        const parentId = source[link.localColumn];
        if (parentId !== null && parentId !== undefined && String(parentId).trim()) {
            const parents = repositoryContext.db.prepare(`
          SELECT parent.store_id AS store_id,
                 CASE WHEN EXISTS (
                   SELECT 1
                   FROM store_migration_quarantine quarantine
                   WHERE quarantine.source_table = ?
                     AND quarantine.source_row_id = CAST(parent.${quoteIdentifier(link.parentIdentityColumn)} AS TEXT)
                     AND quarantine.status = 'pending'
                 ) THEN 1 ELSE 0 END AS pending
          FROM ${quoteIdentifier(link.parentTable)} parent
          WHERE parent.${quoteIdentifier(link.parentColumn)} = ?
        `).all(link.parentTable, parentId) as Array<{
                store_id: string | null;
                pending: number;
            }>;
            repositoryContext.methods.assertParentRowsMatchStore(sourceTable, link.parentTable, parents, storeId);
        }
    }
    if (sourceTable === 'keyword_metrics') {
        const sourceFile = typeof source.source_file === 'string' ? source.source_file.trim() : '';
        if (sourceFile) {
            const parents = repositoryContext.db.prepare(`
          SELECT parent.store_id, parent.pending
          FROM (
            SELECT report.store_id AS store_id,
                   CASE WHEN EXISTS (
                     SELECT 1 FROM store_migration_quarantine quarantine
                     WHERE quarantine.source_table = 'report_files'
                       AND quarantine.source_row_id = CAST(report.id AS TEXT)
                       AND quarantine.status = 'pending'
                   ) THEN 1 ELSE 0 END AS pending
            FROM report_files report
            WHERE report.file_path = ?
            UNION ALL
            SELECT report.store_id AS store_id,
                   CASE WHEN EXISTS (
                     SELECT 1 FROM store_migration_quarantine quarantine
                     WHERE quarantine.source_table = 'lingxing_report_files'
                       AND quarantine.source_row_id = CAST(report.id AS TEXT)
                       AND quarantine.status = 'pending'
                   ) THEN 1 ELSE 0 END AS pending
            FROM lingxing_report_files report
            WHERE report.file_path = ?
          ) parent
        `).all(sourceFile, sourceFile) as Array<{
                store_id: string | null;
                pending: number;
            }>;
            repositoryContext.methods.assertParentRowsMatchStore(sourceTable, 'report_files', parents, storeId);
        }
    }
}

export function assertParentRowsMatchStore(repositoryContext: StoreRepositoryContext, sourceTable: string, parentTable: string, parents: Array<{
    store_id: string | null;
    pending: number;
}>, storeId: StoreId): void {
    if (parents.length === 0 || parents.some((parent) => parent.pending === 1 || !parent.store_id)) {
        throw new StoreRepositoryError('QUARANTINE_TARGET_CONFLICT', `${sourceTable} cannot be resolved before its ${parentTable} parent has authoritative store ownership.`);
    }
    const conflictingParent = parents.find((parent) => parent.store_id !== storeId);
    if (conflictingParent) {
        throw new StoreRepositoryError('QUARANTINE_TARGET_CONFLICT', `${sourceTable} parent belongs to store ${conflictingParent.store_id}, not ${storeId}.`);
    }
}

export function tableHasColumn(repositoryContext: StoreRepositoryContext, table: string, column: string): boolean {
    if (!(STORE_SCOPED_LEGACY_TABLES as readonly string[]).includes(table))
        return false;
    const rows = repositoryContext.db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{
        name: string;
    }>;
    return rows.some((row) => row.name === column);
}
