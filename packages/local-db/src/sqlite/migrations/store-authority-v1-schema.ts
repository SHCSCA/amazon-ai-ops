// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import { type StoreScopedLegacyTable, STORE_SCOPED_LEGACY_TABLES, StoreAuthorityMigrationError, STORE_AUTHORITY_MIGRATION_VERSION } from './store-authority-v1-contracts';
import { quoteIdentifier } from './store-authority-v1-values';

export function ensureSchemaMigrationsTable(database: Database.Database): void {
    database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('started', 'applied', 'failed')),
      started_at TEXT NOT NULL,
      applied_at TEXT,
      error_message TEXT,
      manifest_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT
    )
  `);
}

export function createStoreAuthorityTables(database: Database.Database): void {
    database.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      store_id TEXT PRIMARY KEY NOT NULL,
      browser_profile_id TEXT NOT NULL,
      marketplace TEXT NOT NULL DEFAULT 'US' CHECK (marketplace = 'US'),
      currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
      business_timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
      legacy_store_name_normalized TEXT,
      legacy_marketplace_code_normalized TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_store_id_nocase
      ON stores(lower(store_id));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_browser_profile_id_nocase
      ON stores(lower(browser_profile_id));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_legacy_identity
      ON stores(legacy_store_name_normalized, legacy_marketplace_code_normalized)
      WHERE legacy_store_name_normalized IS NOT NULL
        AND legacy_marketplace_code_normalized IS NOT NULL;

    CREATE TABLE IF NOT EXISTS store_connections (
      id TEXT PRIMARY KEY NOT NULL,
      store_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('lingxing', 'amazon_ads')),
      status TEXT NOT NULL DEFAULT 'not_configured'
        CHECK (status IN ('not_configured', 'checking', 'ready', 'attention_required', 'blocked')),
      account_label TEXT,
      external_account_id TEXT,
      last_verified_at TEXT,
      last_failure_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (store_id) REFERENCES stores(store_id),
      UNIQUE (store_id, provider)
    );
    CREATE INDEX IF NOT EXISTS idx_store_connections_store_id
      ON store_connections(store_id);

    CREATE TABLE IF NOT EXISTS store_session_metadata (
      store_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('lingxing', 'amazon_ads')),
      browser_profile_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (status IN ('unknown', 'signed_out', 'checking', 'ready', 'expired', 'blocked')),
      session_generation INTEGER NOT NULL DEFAULT 0 CHECK (session_generation >= 0),
      observed_at TEXT NOT NULL,
      account_label TEXT,
      external_account_id TEXT,
      verified_at TEXT,
      expires_at TEXT,
      failure_code TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (store_id, provider),
      FOREIGN KEY (store_id) REFERENCES stores(store_id)
    );
    CREATE INDEX IF NOT EXISTS idx_store_session_metadata_store_generation
      ON store_session_metadata(store_id, session_generation);

    CREATE TABLE IF NOT EXISTS store_migration_quarantine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_version INTEGER NOT NULL,
      source_table TEXT NOT NULL,
      source_row_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      normalized_store_name TEXT,
      normalized_marketplace_code TEXT,
      candidate_store_ids_json TEXT NOT NULL DEFAULT '[]',
      source_identity_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
      resolved_store_id TEXT,
      resolution_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      UNIQUE (migration_version, source_table, source_row_id),
      FOREIGN KEY (resolved_store_id) REFERENCES stores(store_id)
    );
    CREATE INDEX IF NOT EXISTS idx_store_migration_quarantine_status
      ON store_migration_quarantine(migration_version, status, source_table);
  `);
}

export function addLegacyStoreIdColumns(database: Database.Database): ReadonlyMap<StoreScopedLegacyTable, boolean> {
    const additions = new Map<StoreScopedLegacyTable, boolean>();
    for (const table of STORE_SCOPED_LEGACY_TABLES) {
        if (!tableExists(database, table)) {
            additions.set(table, false);
            continue;
        }
        const added = !hasColumn(database, table, 'store_id');
        if (added) {
            database.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN store_id TEXT`);
        }
        additions.set(table, added);
    }
    return additions;
}

export function verifyStoreAuthoritySchema(database: Database.Database, targetTables: readonly StoreScopedLegacyTable[]): void {
    for (const table of [
        'schema_migrations',
        'stores',
        'store_connections',
        'store_session_metadata',
        'store_migration_quarantine',
    ]) {
        if (!tableExists(database, table)) {
            throw new StoreAuthorityMigrationError(STORE_AUTHORITY_MIGRATION_VERSION, `Required store authority table is missing: ${table}.`);
        }
    }
    for (const table of targetTables) {
        if (tableExists(database, table) && !hasColumn(database, table, 'store_id')) {
            throw new StoreAuthorityMigrationError(STORE_AUTHORITY_MIGRATION_VERSION, `Required nullable store_id column is missing from ${table}.`);
        }
    }
}

export function tableExists(database: Database.Database, table: string): boolean {
    return Boolean(database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table));
}

export function hasColumn(database: Database.Database, table: string, column: string): boolean {
    const rows = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{
        name: string;
    }>;
    return rows.some((row) => row.name === column);
}

export function countRows(database: Database.Database, table: string): number {
    return Number((database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get() as {
        count: number;
    }).count);
}

export function storeExists(database: Database.Database, storeId: string): boolean {
    return Boolean(database.prepare('SELECT 1 FROM stores WHERE store_id = ?').get(storeId));
}

export function checkDatabaseIntegrity(database: Database.Database): string {
    const rows = database.pragma('integrity_check') as Array<Record<string, unknown>>;
    return rows.map((row) => String(row.integrity_check ?? Object.values(row)[0] ?? '')).join('; ');
}

export function checkDatabaseFileIntegrity(filePath: string): string {
    const backup = new Database(filePath, { readonly: true, fileMustExist: true });
    try {
        return checkDatabaseIntegrity(backup);
    }
    finally {
        backup.close();
    }
}

export function schemaFingerprint(database: Database.Database): string {
    const schema = database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all();
    return createHash('sha256').update(JSON.stringify(schema)).digest('hex');
}
