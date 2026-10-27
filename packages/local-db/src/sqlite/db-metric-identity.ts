// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { ensureColumn } from './db-columns';

const AD_METRIC_IDENTITY_INDEX_EXPRESSIONS = `
          store_id,
          COALESCE(batch_id, ''),
          COALESCE(report_type, ''),
          COALESCE(date, ''),
          COALESCE(asin, ''),
          COALESCE(msku, ''),
          COALESCE(campaign_name, ''),
          COALESCE(ad_group_name, ''),
          COALESCE(targeting, ''),
          COALESCE(search_term, ''),
          COALESCE(match_type, ''),
          COALESCE(source_file, ''),
          COALESCE(source_row, -1)
`;

export function installStoreScopedMetricIdentitySafeguards(database: Database.Database): void {
    for (const table of ['ad_daily_metrics', 'keyword_metrics', 'keyword_opportunities']) {
        ensureColumn(database, table, 'store_authority_quarantined', 'INTEGER NOT NULL DEFAULT 0 CHECK (store_authority_quarantined IN (0, 1))');
    }
    const install = database.transaction(() => {
        database.exec(`
      DROP TRIGGER IF EXISTS trg_ad_metrics_block_pending_identity_conflict_insert;
      DROP TRIGGER IF EXISTS trg_ad_metrics_block_pending_identity_conflict_update;
      DROP TRIGGER IF EXISTS trg_keyword_metrics_block_pending_identity_conflict_insert;
      DROP TRIGGER IF EXISTS trg_keyword_metrics_block_pending_identity_conflict_update;
      DROP TRIGGER IF EXISTS trg_keyword_opportunities_block_pending_identity_conflict_insert;
      DROP TRIGGER IF EXISTS trg_keyword_opportunities_block_pending_identity_conflict_update;

      UPDATE ad_daily_metrics
      SET store_authority_quarantined = CASE WHEN EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = 'ad_daily_metrics'
          AND quarantine.source_row_id = CAST(ad_daily_metrics.id AS TEXT)
          AND quarantine.status = 'pending'
      ) THEN 1 ELSE 0 END;

      UPDATE keyword_metrics
      SET store_authority_quarantined = CASE WHEN EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = 'keyword_metrics'
          AND quarantine.source_row_id = CAST(keyword_metrics.id AS TEXT)
          AND quarantine.status = 'pending'
      ) THEN 1 ELSE 0 END;

      UPDATE keyword_opportunities
      SET store_authority_quarantined = CASE WHEN EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = 'keyword_opportunities'
          AND quarantine.source_row_id = CAST(keyword_opportunities.id AS TEXT)
          AND quarantine.status = 'pending'
      ) THEN 1 ELSE 0 END;
    `);
        quarantineStoreScopedIdentityDuplicates(database);
        database.exec(`
      DROP INDEX IF EXISTS idx_ad_metrics_unique_daily_report_identity;
      DROP INDEX IF EXISTS idx_ad_metrics_unique_store_daily_report_identity;
      DROP INDEX IF EXISTS idx_ad_metrics_store_daily_report_identity_lookup;
      DROP INDEX IF EXISTS idx_ad_metrics_store_daily_report_raw_identity_lookup;
      DROP INDEX IF EXISTS idx_keyword_metrics_unique_source_file_row;
      DROP INDEX IF EXISTS idx_keyword_opportunities_unique_asin_keyword;

      CREATE UNIQUE INDEX idx_ad_metrics_unique_store_daily_report_identity
        ON ad_daily_metrics(
          ${AD_METRIC_IDENTITY_INDEX_EXPRESSIONS}
        )
        WHERE store_id IS NOT NULL AND store_authority_quarantined = 0;
      CREATE INDEX idx_ad_metrics_store_daily_report_identity_lookup
        ON ad_daily_metrics(${AD_METRIC_IDENTITY_INDEX_EXPRESSIONS});
      -- 原始列 IS 保留 NULL 与空值边界；旧 COALESCE lookup 继续服务导入去重。
      CREATE INDEX idx_ad_metrics_store_daily_report_raw_identity_lookup
        ON ad_daily_metrics(
          store_id, batch_id, report_type, date, asin, msku,
          campaign_name, ad_group_name, targeting, search_term, match_type,
          source_file, source_row
        );
      CREATE UNIQUE INDEX idx_keyword_metrics_unique_source_file_row
        ON keyword_metrics(store_id, source, source_file, source_row)
        WHERE store_id IS NOT NULL
          AND store_authority_quarantined = 0
          AND source_file IS NOT NULL
          AND source_row IS NOT NULL;
      CREATE UNIQUE INDEX idx_keyword_opportunities_unique_asin_keyword
        ON keyword_opportunities(store_id, COALESCE(asin, ''), normalized_keyword)
        WHERE store_id IS NOT NULL AND store_authority_quarantined = 0;

      CREATE TRIGGER trg_ad_metrics_block_pending_identity_conflict_insert
      BEFORE INSERT ON ad_daily_metrics
      WHEN COALESCE(NEW.store_authority_quarantined, 0) = 0
        AND NEW.store_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM ad_daily_metrics conflict
          INNER JOIN store_migration_quarantine quarantine
            ON quarantine.source_table = 'ad_daily_metrics'
           AND quarantine.source_row_id = CAST(conflict.id AS TEXT)
           AND quarantine.status = 'pending'
           AND quarantine.reason = 'identity_content_conflict'
          WHERE conflict.store_id IS NEW.store_id
            AND conflict.batch_id IS NEW.batch_id
            AND conflict.report_type IS NEW.report_type
            AND conflict.date IS NEW.date
            AND conflict.asin IS NEW.asin
            AND conflict.msku IS NEW.msku
            AND conflict.campaign_name IS NEW.campaign_name
            AND conflict.ad_group_name IS NEW.ad_group_name
            AND conflict.targeting IS NEW.targeting
            AND conflict.search_term IS NEW.search_term
            AND conflict.match_type IS NEW.match_type
            AND conflict.source_file IS NEW.source_file
            AND conflict.source_row IS NEW.source_row
        )
      BEGIN
        SELECT RAISE(ABORT, 'pending ad metric identity conflict');
      END;

      CREATE TRIGGER trg_ad_metrics_block_pending_identity_conflict_update
      BEFORE UPDATE OF store_id, batch_id, report_type, date, asin, msku,
        campaign_name, ad_group_name, targeting, search_term, match_type,
        source_file, source_row, store_authority_quarantined
      ON ad_daily_metrics
      WHEN COALESCE(NEW.store_authority_quarantined, 0) = 0
        AND NEW.store_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM ad_daily_metrics conflict
          INNER JOIN store_migration_quarantine quarantine
            ON quarantine.source_table = 'ad_daily_metrics'
           AND quarantine.source_row_id = CAST(conflict.id AS TEXT)
           AND quarantine.status = 'pending'
           AND quarantine.reason = 'identity_content_conflict'
          WHERE conflict.id <> NEW.id
            AND conflict.store_id IS NEW.store_id
            AND conflict.batch_id IS NEW.batch_id
            AND conflict.report_type IS NEW.report_type
            AND conflict.date IS NEW.date
            AND conflict.asin IS NEW.asin
            AND conflict.msku IS NEW.msku
            AND conflict.campaign_name IS NEW.campaign_name
            AND conflict.ad_group_name IS NEW.ad_group_name
            AND conflict.targeting IS NEW.targeting
            AND conflict.search_term IS NEW.search_term
            AND conflict.match_type IS NEW.match_type
            AND conflict.source_file IS NEW.source_file
            AND conflict.source_row IS NEW.source_row
        )
      BEGIN
        SELECT RAISE(ABORT, 'pending ad metric identity conflict');
      END;

      CREATE TRIGGER trg_keyword_metrics_block_pending_identity_conflict_insert
      BEFORE INSERT ON keyword_metrics
      WHEN COALESCE(NEW.store_authority_quarantined, 0) = 0
        AND NEW.store_id IS NOT NULL
        AND NEW.source_file IS NOT NULL
        AND NEW.source_row IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM keyword_metrics conflict
          INNER JOIN store_migration_quarantine quarantine
            ON quarantine.source_table = 'keyword_metrics'
           AND quarantine.source_row_id = CAST(conflict.id AS TEXT)
           AND quarantine.status = 'pending'
           AND quarantine.reason = 'identity_content_conflict'
          WHERE conflict.store_id IS NEW.store_id
            AND conflict.source IS NEW.source
            AND conflict.source_file IS NEW.source_file
            AND conflict.source_row IS NEW.source_row
        )
      BEGIN
        SELECT RAISE(ABORT, 'pending keyword metric identity conflict');
      END;

      CREATE TRIGGER trg_keyword_metrics_block_pending_identity_conflict_update
      BEFORE UPDATE OF store_id, source, source_file, source_row, store_authority_quarantined
      ON keyword_metrics
      WHEN COALESCE(NEW.store_authority_quarantined, 0) = 0
        AND NEW.store_id IS NOT NULL
        AND NEW.source_file IS NOT NULL
        AND NEW.source_row IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM keyword_metrics conflict
          INNER JOIN store_migration_quarantine quarantine
            ON quarantine.source_table = 'keyword_metrics'
           AND quarantine.source_row_id = CAST(conflict.id AS TEXT)
           AND quarantine.status = 'pending'
           AND quarantine.reason = 'identity_content_conflict'
          WHERE conflict.id <> NEW.id
            AND conflict.store_id IS NEW.store_id
            AND conflict.source IS NEW.source
            AND conflict.source_file IS NEW.source_file
            AND conflict.source_row IS NEW.source_row
        )
      BEGIN
        SELECT RAISE(ABORT, 'pending keyword metric identity conflict');
      END;

      CREATE TRIGGER trg_keyword_opportunities_block_pending_identity_conflict_insert
      BEFORE INSERT ON keyword_opportunities
      WHEN COALESCE(NEW.store_authority_quarantined, 0) = 0
        AND NEW.store_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM keyword_opportunities conflict
          INNER JOIN store_migration_quarantine quarantine
            ON quarantine.source_table = 'keyword_opportunities'
           AND quarantine.source_row_id = CAST(conflict.id AS TEXT)
           AND quarantine.status = 'pending'
           AND quarantine.reason = 'identity_content_conflict'
          WHERE conflict.store_id IS NEW.store_id
            AND conflict.asin IS NEW.asin
            AND conflict.normalized_keyword IS NEW.normalized_keyword
        )
      BEGIN
        SELECT RAISE(ABORT, 'pending keyword opportunity identity conflict');
      END;

      CREATE TRIGGER trg_keyword_opportunities_block_pending_identity_conflict_update
      BEFORE UPDATE OF store_id, asin, normalized_keyword, store_authority_quarantined
      ON keyword_opportunities
      WHEN COALESCE(NEW.store_authority_quarantined, 0) = 0
        AND NEW.store_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM keyword_opportunities conflict
          INNER JOIN store_migration_quarantine quarantine
            ON quarantine.source_table = 'keyword_opportunities'
           AND quarantine.source_row_id = CAST(conflict.id AS TEXT)
           AND quarantine.status = 'pending'
           AND quarantine.reason = 'identity_content_conflict'
          WHERE conflict.id <> NEW.id
            AND conflict.store_id IS NEW.store_id
            AND conflict.asin IS NEW.asin
            AND conflict.normalized_keyword IS NEW.normalized_keyword
        )
      BEGIN
        SELECT RAISE(ABORT, 'pending keyword opportunity identity conflict');
      END;
    `);
        verifyStoreScopedMetricIdentitySafeguards(database);
    });
    install();
}

export const STORE_IDENTITY_SAFEGUARD_QUARANTINE_VERSION = 1001;

export type StoreScopedIdentityTable = 'ad_daily_metrics' | 'keyword_metrics' | 'keyword_opportunities';

export interface StoreScopedIdentityConfig {
    table: StoreScopedIdentityTable;
    identityColumns: string[];
    eligibilitySql: string;
}

export const STORE_SCOPED_IDENTITY_CONFIGS: StoreScopedIdentityConfig[] = [
    {
        table: 'ad_daily_metrics',
        identityColumns: [
            'store_id',
            'batch_id',
            'report_type',
            'date',
            'asin',
            'msku',
            'campaign_name',
            'ad_group_name',
            'targeting',
            'search_term',
            'match_type',
            'source_file',
            'source_row',
        ],
        eligibilitySql: 'store_id IS NOT NULL AND store_authority_quarantined = 0',
    },
    {
        table: 'keyword_metrics',
        identityColumns: ['store_id', 'source', 'source_file', 'source_row'],
        eligibilitySql: `store_id IS NOT NULL
      AND store_authority_quarantined = 0
      AND source_file IS NOT NULL
      AND source_row IS NOT NULL`,
    },
    {
        table: 'keyword_opportunities',
        identityColumns: ['store_id', 'asin', 'normalized_keyword'],
        eligibilitySql: 'store_id IS NOT NULL AND store_authority_quarantined = 0',
    },
];

export function quarantineStoreScopedIdentityDuplicates(database: Database.Database): void {
    const now = new Date().toISOString();
    const quarantineRow = database.prepare(`
    INSERT INTO store_migration_quarantine (
      migration_version,
      source_table,
      source_row_id,
      reason,
      normalized_store_name,
      normalized_marketplace_code,
      candidate_store_ids_json,
      source_identity_json,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(migration_version, source_table, source_row_id) DO UPDATE SET
      reason = excluded.reason,
      normalized_store_name = excluded.normalized_store_name,
      normalized_marketplace_code = excluded.normalized_marketplace_code,
      candidate_store_ids_json = excluded.candidate_store_ids_json,
      source_identity_json = excluded.source_identity_json,
      status = 'pending',
      resolved_store_id = NULL,
      resolution_note = NULL,
      resolved_at = NULL,
      updated_at = excluded.updated_at
  `);
    for (const config of STORE_SCOPED_IDENTITY_CONFIGS) {
        const rows = database.prepare(`
      SELECT scoped.*
      FROM ${config.table} scoped
      INNER JOIN (
        SELECT id
        FROM (
          SELECT id,
                 COUNT(*) OVER (
                   PARTITION BY ${config.identityColumns.join(', ')}
                 ) AS identity_count
          FROM ${config.table}
          WHERE ${config.eligibilitySql}
        ) duplicate_candidates
        WHERE identity_count > 1
      ) duplicates ON duplicates.id = scoped.id
      ORDER BY scoped.id
    `).all() as Array<Record<string, unknown> & {
            id: number;
            store_id: string;
        }>;
        const groups = new Map<string, Array<Record<string, unknown> & {
            id: number;
            store_id: string;
        }>>();
        for (const row of rows) {
            const identity = config.identityColumns.map((column) => normalizeIdentityValue(row[column]));
            const key = JSON.stringify(identity);
            const group = groups.get(key) ?? [];
            group.push(row);
            groups.set(key, group);
        }
        const markQuarantined = database.prepare(`
      UPDATE ${config.table}
      SET store_authority_quarantined = 1
      WHERE id = ?
    `);
        for (const group of groups.values()) {
            if (group.length < 2)
                continue;
            const signatures = new Set(group.map((row) => storeScopedRowContentSignature(row)));
            const conflicting = signatures.size > 1;
            const rowsToQuarantine = conflicting ? group : group.slice(1);
            const reason = conflicting ? 'identity_content_conflict' : 'duplicate_identity';
            for (const row of rowsToQuarantine) {
                const identity = Object.fromEntries(config.identityColumns
                    .filter((column) => column !== 'source_file')
                    .map((column) => [column, row[column] ?? null]));
                const sourceFile = typeof row.source_file === 'string' ? row.source_file : undefined;
                quarantineRow.run(STORE_IDENTITY_SAFEGUARD_QUARANTINE_VERSION, config.table, String(row.id), reason, typeof row.store_name === 'string' ? row.store_name : null, typeof row.marketplace_code === 'string' ? row.marketplace_code : null, JSON.stringify([row.store_id]), JSON.stringify({
                    identity,
                    ...(sourceFile
                        ? { sourceFileSha256: createHash('sha256').update(sourceFile).digest('hex') }
                        : {}),
                    rowContentSha256: createHash('sha256')
                        .update(storeScopedRowContentSignature(row))
                        .digest('hex'),
                    conflictRowIds: group.map((candidate) => candidate.id),
                }), now, now);
                markQuarantined.run(row.id);
            }
        }
    }
}

export function normalizeIdentityValue(value: unknown): unknown {
    if (value === null || value === undefined)
        return '';
    return value;
}

export function storeScopedRowContentSignature(row: Record<string, unknown>): string {
    const ignored = new Set(['id', 'created_at', 'updated_at', 'store_authority_quarantined']);
    return JSON.stringify(Object.fromEntries(Object.entries(row)
        .filter(([column]) => !ignored.has(column))
        .sort(([left], [right]) => left.localeCompare(right))));
}

export function verifyStoreScopedMetricIdentitySafeguards(database: Database.Database): void {
    const legacyGlobalIndex = database.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_ad_metrics_unique_daily_report_identity'
  `).get();
    if (legacyGlobalIndex) {
        throw new Error('Legacy global ad metric identity index is still installed.');
    }
    const expectations = [
        ['ad_daily_metrics', 'idx_ad_metrics_unique_store_daily_report_identity'],
        ['keyword_metrics', 'idx_keyword_metrics_unique_source_file_row'],
        ['keyword_opportunities', 'idx_keyword_opportunities_unique_asin_keyword'],
    ] as const;
    for (const [table, indexName] of expectations) {
        const index = database.prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'index' AND name = ?
    `).get(indexName) as {
            sql: string | null;
        } | undefined;
        const metadata = (database.prepare(`PRAGMA index_list(${table})`).all() as Array<{
            name: string;
            unique: number;
            partial: number;
        }>).find((candidate) => candidate.name === indexName);
        const normalizedSql = (index?.sql || '').toLowerCase().replace(/\s+/g, '');
        if (!normalizedSql.includes(`on${table}(store_id,`)
            || !normalizedSql.includes('wherestore_idisnotnull')
            || !normalizedSql.includes('store_authority_quarantined=0')
            || metadata?.unique !== 1
            || metadata.partial !== 1) {
            throw new Error(`Store-scoped identity index verification failed: ${indexName}.`);
        }
        const markerMismatch = database.prepare(`
      SELECT scoped.id
      FROM ${table} scoped
      WHERE scoped.store_authority_quarantined <> CASE WHEN EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = ?
          AND quarantine.source_row_id = CAST(scoped.id AS TEXT)
          AND quarantine.status = 'pending'
      ) THEN 1 ELSE 0 END
      ORDER BY scoped.id
      LIMIT 1
    `).get(table) as {
            id: number;
        } | undefined;
        if (markerMismatch) {
            throw new Error(`Store-scoped quarantine marker verification failed: ${table} row ${markerMismatch.id}.`);
        }
    }
}
