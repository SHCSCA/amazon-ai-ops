import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initSqlite } from './db';

const tempDirs: string[] = [];

function tempDbPath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-store-indexes-'));
  tempDirs.push(directory);
  return path.join(directory, 'app.db');
}

function insertStore(database: Database.Database, storeId: string, profileId: string): void {
  database.prepare(`
    INSERT INTO stores (
      store_id, browser_profile_id, marketplace, currency, display_name,
      status, business_timezone, created_at, updated_at
    ) VALUES (?, ?, 'US', 'USD', 'Shared Display', 'active',
      'America/Los_Angeles', datetime('now'), datetime('now'))
  `).run(storeId, profileId);
}

function insertBusinessIdentityRows(
  database: Database.Database,
  storeId: string,
  suffix: string,
): void {
  database.prepare(`
    INSERT INTO ad_daily_metrics (
      store_id, batch_id, report_type, date, store_name, marketplace_code,
      asin, msku, campaign_name, ad_group_name, targeting, search_term,
      match_type, source_file, source_row
    ) VALUES (
      ?, NULL, 'user_search_term', '2026-07-22', 'Shared Legacy', 'US',
      ?, 'MSKU-SHARED', 'Campaign', 'Ad Group', 'Target', 'Search Term',
      'exact', ?, 7
    )
  `).run(storeId, `B0AD${suffix}`, `C:/reports/ad-${suffix}.xlsx`);

  database.prepare(`
    INSERT INTO keyword_metrics (
      store_id, normalized_keyword, raw_keyword, source, asin,
      source_file, source_row
    ) VALUES (?, ?, 'Shared Keyword', 'keyword_report', ?, ?, 9)
  `).run(storeId, `shared-keyword-${suffix}`, `B0KW${suffix}`, `C:/reports/keyword-${suffix}.xlsx`);

  database.prepare(`
    INSERT INTO keyword_opportunities (
      store_id, asin, normalized_keyword, opportunity_level, status
    ) VALUES (?, ?, ?, 'high', 'pending')
  `).run(storeId, `B0OP${suffix}`, `opportunity-${suffix}`);
}

function expectStoreScopedIdentityIndexes(database: Database.Database): void {
  const expected = [
    ['ad_daily_metrics', 'idx_ad_metrics_unique_store_daily_report_identity'],
    ['keyword_metrics', 'idx_keyword_metrics_unique_source_file_row'],
    ['keyword_opportunities', 'idx_keyword_opportunities_unique_asin_keyword'],
  ] as const;

  expect(database.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_ad_metrics_unique_daily_report_identity'
  `).get()).toBeUndefined();

  for (const [table, indexName] of expected) {
    const index = database.prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'index' AND name = ?
    `).get(indexName) as { sql: string } | undefined;
    const metadata = (database.prepare(`PRAGMA index_list(${table})`).all() as Array<{
      name: string;
      unique: number;
      partial: number;
    }>).find((candidate) => candidate.name === indexName);

    expect(index?.sql).toMatch(new RegExp(`ON\\s+${table}\\s*\\(\\s*store_id\\s*,`, 'i'));
    expect(index?.sql).toMatch(/WHERE\s+store_id\s+IS\s+NOT\s+NULL/i);
    expect(index?.sql).toMatch(/store_authority_quarantined\s*=\s*0/i);
    expect(metadata).toMatchObject({ name: indexName, unique: 1, partial: 1 });
    expect((database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
      .some((column) => column.name === 'store_authority_quarantined')).toBe(true);
  }

  const triggerNames = (database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'trigger' AND name LIKE '%block_pending_identity_conflict%'
    ORDER BY name
  `).all() as Array<{ name: string }>).map((row) => row.name);
  expect(triggerNames).toEqual([
    'trg_ad_metrics_block_pending_identity_conflict_insert',
    'trg_ad_metrics_block_pending_identity_conflict_update',
    'trg_keyword_metrics_block_pending_identity_conflict_insert',
    'trg_keyword_metrics_block_pending_identity_conflict_update',
    'trg_keyword_opportunities_block_pending_identity_conflict_insert',
    'trg_keyword_opportunities_block_pending_identity_conflict_update',
  ]);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('store-scoped metric identity safeguards', () => {
  it('preserves duplicate rows in quarantine while keeping one active identity per store', () => {
    const databasePath = tempDbPath();
    const storeA = 'store-a';
    const storeB = 'store-b';
    const database = initSqlite(databasePath);
    try {
      insertStore(database, storeA, 'profile-a');
      insertStore(database, storeB, 'profile-b');

      // Seed a database state produced while the legacy global indexes were
      // absent. Reopen must partition cleanup by authoritative store_id.
      database.exec(`
        DROP INDEX IF EXISTS idx_ad_metrics_unique_store_daily_report_identity;
        DROP INDEX IF EXISTS idx_keyword_metrics_unique_source_file_row;
        DROP INDEX IF EXISTS idx_keyword_opportunities_unique_asin_keyword;
      `);
      insertBusinessIdentityRows(database, storeA, 'EXISTING');
      insertBusinessIdentityRows(database, storeA, 'EXISTING');
      insertBusinessIdentityRows(database, storeB, 'EXISTING');
      insertBusinessIdentityRows(database, storeB, 'EXISTING');
    } finally {
      database.close();
    }

    const reopened = initSqlite(databasePath);
    try {
      for (const table of ['ad_daily_metrics', 'keyword_metrics', 'keyword_opportunities']) {
        expect(reopened.prepare(`
          SELECT store_id AS storeId,
                 COUNT(*) AS count,
                 SUM(CASE WHEN store_authority_quarantined = 0 THEN 1 ELSE 0 END) AS active,
                 SUM(CASE WHEN store_authority_quarantined = 1 THEN 1 ELSE 0 END) AS quarantined
          FROM ${table}
          GROUP BY store_id
          ORDER BY store_id
        `).all()).toEqual([
          { storeId: storeA, count: 2, active: 1, quarantined: 1 },
          { storeId: storeB, count: 2, active: 1, quarantined: 1 },
        ]);
        expect(reopened.prepare(`
          SELECT reason, COUNT(*) AS count,
                 SUM(CASE WHEN source_identity_json LIKE '%C:/reports/%' THEN 1 ELSE 0 END) AS leakedPaths
          FROM store_migration_quarantine
          WHERE source_table = ? AND status = 'pending'
          GROUP BY reason
        `).all(table)).toEqual([{ reason: 'duplicate_identity', count: 2, leakedPaths: 0 }]);
      }

      insertBusinessIdentityRows(reopened, storeA, 'NEW');
      insertBusinessIdentityRows(reopened, storeB, 'NEW');

      expect(() => insertBusinessIdentityRows(reopened, storeA, 'NEW')).toThrow(/UNIQUE|constraint/i);
      expect(reopened.prepare('SELECT COUNT(*) AS count FROM ad_daily_metrics').get()).toEqual({ count: 6 });
      expect(reopened.prepare('SELECT COUNT(*) AS count FROM keyword_metrics').get()).toEqual({ count: 6 });
      expect(reopened.prepare('SELECT COUNT(*) AS count FROM keyword_opportunities').get()).toEqual({ count: 6 });
      expectStoreScopedIdentityIndexes(reopened);
    } finally {
      reopened.close();
    }
  });

  it('quarantines every row in a conflicting identity group without deleting evidence', () => {
    const databasePath = tempDbPath();
    const storeId = 'store-conflict';
    const database = initSqlite(databasePath);
    try {
      insertStore(database, storeId, 'profile-conflict');
      database.exec(`
        DROP INDEX IF EXISTS idx_ad_metrics_unique_store_daily_report_identity;
        DROP INDEX IF EXISTS idx_keyword_metrics_unique_source_file_row;
        DROP INDEX IF EXISTS idx_keyword_opportunities_unique_asin_keyword;
      `);
      insertBusinessIdentityRows(database, storeId, 'CONFLICT');
      insertBusinessIdentityRows(database, storeId, 'CONFLICT');
      database.exec(`
        UPDATE ad_daily_metrics SET cost = 99 WHERE id = 2;
        UPDATE keyword_metrics SET sales = 88 WHERE id = 2;
        UPDATE keyword_opportunities SET status = 'accepted' WHERE id = 2;
      `);
    } finally {
      database.close();
    }

    const reopened = initSqlite(databasePath);
    try {
      for (const table of ['ad_daily_metrics', 'keyword_metrics', 'keyword_opportunities']) {
        expect(reopened.prepare(`
          SELECT COUNT(*) AS count,
                 SUM(CASE WHEN store_authority_quarantined = 1 THEN 1 ELSE 0 END) AS quarantined
          FROM ${table}
        `).get()).toEqual({ count: 2, quarantined: 2 });
        expect(reopened.prepare(`
          SELECT reason, COUNT(*) AS count,
                 SUM(CASE WHEN source_identity_json LIKE '%C:/reports/%' THEN 1 ELSE 0 END) AS leakedPaths
          FROM store_migration_quarantine
          WHERE source_table = ? AND status = 'pending'
          GROUP BY reason
        `).all(table)).toEqual([{
          reason: 'identity_content_conflict',
          count: 2,
          leakedPaths: 0,
        }]);
      }
      expect(() => reopened.prepare(`
        INSERT INTO ad_daily_metrics (
          store_id, batch_id, report_type, date, store_name, marketplace_code,
          asin, msku, campaign_name, ad_group_name, targeting, search_term,
          match_type, source_file, source_row
        ) VALUES (
          ?, NULL, 'user_search_term', '2026-07-22', 'Shared Legacy', 'US',
          'B0ADCONFLICT', 'MSKU-SHARED', 'Campaign', 'Ad Group', 'Target', 'Search Term',
          'exact', 'C:/reports/ad-CONFLICT.xlsx', 7
        )
      `).run(storeId)).toThrow(/pending ad metric identity conflict/i);
      expect(() => reopened.prepare(`
        INSERT INTO keyword_metrics (
          store_id, normalized_keyword, raw_keyword, source, asin,
          source_file, source_row
        ) VALUES (
          ?, 'shared-keyword-CONFLICT', 'Shared Keyword', 'keyword_report',
          'B0KWCONFLICT', 'C:/reports/keyword-CONFLICT.xlsx', 9
        )
      `).run(storeId)).toThrow(/pending keyword metric identity conflict/i);
      expect(() => reopened.prepare(`
        INSERT INTO keyword_opportunities (
          store_id, asin, normalized_keyword, opportunity_level, status
        ) VALUES (?, 'B0OPCONFLICT', 'opportunity-CONFLICT', 'high', 'pending')
      `).run(storeId)).toThrow(/pending keyword opportunity identity conflict/i);
      expectStoreScopedIdentityIndexes(reopened);
    } finally {
      reopened.close();
    }
  });

  it('keeps duplicate unowned legacy rows separate from scoped rows through v1 and v2', () => {
    const databasePath = tempDbPath();
    const legacy = new Database(databasePath);
    try {
      legacy.exec(`
        CREATE TABLE stores (
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
        INSERT INTO stores (
          store_id, browser_profile_id, marketplace, currency, display_name,
          status, business_timezone, created_at, updated_at
        ) VALUES (
          'store-a', 'profile-a', 'US', 'USD', 'Store A', 'active',
          'America/Los_Angeles', datetime('now'), datetime('now')
        );

        CREATE TABLE ad_daily_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          store_id TEXT,
          batch_id TEXT,
          report_type TEXT,
          portfolio_name TEXT,
          date TEXT,
          store_name TEXT,
          marketplace_code TEXT,
          asin TEXT,
          msku TEXT,
          campaign_name TEXT,
          ad_group_name TEXT,
          targeting TEXT,
          search_term TEXT,
          match_type TEXT,
          impressions INTEGER DEFAULT 0,
          clicks INTEGER DEFAULT 0,
          cost REAL DEFAULT 0,
          orders INTEGER DEFAULT 0,
          sales REAL DEFAULT 0,
          currency TEXT DEFAULT 'USD',
          acos REAL DEFAULT 0,
          cpc REAL DEFAULT 0,
          cvr REAL DEFAULT 0,
          source_file TEXT,
          source_row INTEGER,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE keyword_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          store_id TEXT,
          normalized_keyword TEXT NOT NULL,
          raw_keyword TEXT NOT NULL,
          source TEXT NOT NULL,
          asin TEXT,
          impressions INTEGER DEFAULT 0,
          clicks INTEGER DEFAULT 0,
          cost REAL DEFAULT 0,
          orders INTEGER DEFAULT 0,
          sales REAL DEFAULT 0,
          acos REAL DEFAULT 0,
          cvr REAL DEFAULT 0,
          source_file TEXT,
          source_row INTEGER,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE keyword_opportunities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          store_id TEXT,
          asin TEXT,
          normalized_keyword TEXT NOT NULL,
          opportunity_level TEXT NOT NULL,
          score REAL DEFAULT 0,
          evidence TEXT,
          risk_flags_json TEXT DEFAULT '[]',
          recommended_sections_json TEXT DEFAULT '[]',
          status TEXT DEFAULT 'pending',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        INSERT INTO ad_daily_metrics (
          store_id, report_type, date, store_name, asin, campaign_name, ad_group_name, search_term,
          match_type, source_file, source_row, cost
        ) VALUES
          (NULL, 'user_search_term', '2026-07-22', 'Legacy Unowned', 'B0UNOWNED', 'Campaign', 'Ad Group',
            'legacy term', 'exact', 'C:/legacy/ad.xlsx', 4, 10),
          (NULL, 'user_search_term', '2026-07-22', 'Legacy Unowned', 'B0UNOWNED', 'Campaign', 'Ad Group',
            'legacy term', 'exact', 'C:/legacy/ad.xlsx', 4, 20),
          ('store-a', 'user_search_term', '2026-07-22', 'Legacy Unowned', 'B0UNOWNED', 'Campaign', 'Ad Group',
            'legacy term', 'exact', 'C:/legacy/ad.xlsx', 4, 30);
        INSERT INTO keyword_metrics (
          store_id, normalized_keyword, raw_keyword, source, asin, source_file, source_row
        ) VALUES
          (NULL, 'legacy keyword', 'Legacy Keyword', 'keyword_report', 'B0UNOWNED', 'C:/legacy/keyword.xlsx', 5),
          (NULL, 'legacy keyword', 'Legacy Keyword', 'keyword_report', 'B0UNOWNED', 'C:/legacy/keyword.xlsx', 5),
          ('store-a', 'legacy keyword', 'Legacy Keyword', 'keyword_report', 'B0UNOWNED', 'C:/legacy/keyword.xlsx', 5);
        INSERT INTO keyword_opportunities (
          store_id, asin, normalized_keyword, opportunity_level, status
        ) VALUES
          (NULL, 'B0UNOWNED', 'legacy opportunity', 'high', 'ignored'),
          (NULL, 'B0UNOWNED', 'legacy opportunity', 'high', 'accepted'),
          ('store-a', 'B0UNOWNED', 'legacy opportunity', 'high', 'pending');
      `);
    } finally {
      legacy.close();
    }

    const migrated = initSqlite(databasePath);
    try {
      for (const table of ['ad_daily_metrics', 'keyword_metrics', 'keyword_opportunities']) {
        expect(migrated.prepare(`
          SELECT COUNT(*) AS count,
                 SUM(CASE WHEN store_id IS NULL THEN 1 ELSE 0 END) AS unowned
          FROM ${table}
        `).get()).toEqual({ count: 3, unowned: 2 });

        expect(migrated.prepare(`
          SELECT COUNT(*) AS count
          FROM ${table}
          WHERE store_id = 'store-a'
        `).get()).toEqual({ count: 1 });

        expect(migrated.prepare(`
          SELECT COUNT(*) AS count
          FROM store_migration_quarantine
          WHERE source_table = ? AND status = 'pending'
        `).get(table)).toEqual({ count: 2 });
      }

      expect(migrated.prepare(`
        SELECT status
        FROM keyword_opportunities
        ORDER BY id
      `).all()).toEqual([{ status: 'ignored' }, { status: 'accepted' }, { status: 'pending' }]);
      expectStoreScopedIdentityIndexes(migrated);
    } finally {
      migrated.close();
    }
  });

  it('replaces legacy global indexes when reopening an already-v2 database', () => {
    const databasePath = tempDbPath();
    const database = initSqlite(databasePath);
    try {
      insertStore(database, 'store-a', 'profile-a');
      insertStore(database, 'store-b', 'profile-b');
      insertBusinessIdentityRows(database, 'store-a', 'V2');
    } finally {
      database.close();
    }

    const legacyIndexed = new Database(databasePath);
    try {
      legacyIndexed.exec(`
        DROP INDEX idx_ad_metrics_unique_store_daily_report_identity;
        DROP INDEX idx_keyword_metrics_unique_source_file_row;
        DROP INDEX idx_keyword_opportunities_unique_asin_keyword;

        CREATE UNIQUE INDEX idx_ad_metrics_unique_daily_report_identity
          ON ad_daily_metrics(
            COALESCE(batch_id, ''), COALESCE(report_type, ''), COALESCE(date, ''),
            COALESCE(store_name, ''), COALESCE(marketplace_code, ''), COALESCE(asin, ''),
            COALESCE(msku, ''), COALESCE(campaign_name, ''), COALESCE(ad_group_name, ''),
            COALESCE(targeting, ''), COALESCE(search_term, ''), COALESCE(match_type, ''),
            COALESCE(source_file, ''), COALESCE(source_row, -1)
          );
        CREATE UNIQUE INDEX idx_keyword_metrics_unique_source_file_row
          ON keyword_metrics(source, source_file, source_row)
          WHERE source_file IS NOT NULL AND source_row IS NOT NULL;
        CREATE UNIQUE INDEX idx_keyword_opportunities_unique_asin_keyword
          ON keyword_opportunities(COALESCE(asin, ''), normalized_keyword);
      `);
    } finally {
      legacyIndexed.close();
    }

    const repaired = initSqlite(databasePath);
    try {
      expectStoreScopedIdentityIndexes(repaired);
      insertBusinessIdentityRows(repaired, 'store-b', 'V2');

      expect(repaired.prepare('SELECT COUNT(*) AS count FROM ad_daily_metrics').get()).toEqual({ count: 2 });
      expect(repaired.prepare('SELECT COUNT(*) AS count FROM keyword_metrics').get()).toEqual({ count: 2 });
      expect(repaired.prepare('SELECT COUNT(*) AS count FROM keyword_opportunities').get()).toEqual({ count: 2 });
    } finally {
      repaired.close();
    }
  });

  it('keeps non-NULL pending-quarantined duplicates intact while excluding them from identity indexes', () => {
    const databasePath = tempDbPath();
    const storeId = 'store-pending';
    const database = initSqlite(databasePath);
    try {
      insertStore(database, storeId, 'profile-pending');
      database.exec(`
        DROP INDEX IF EXISTS idx_ad_metrics_unique_store_daily_report_identity;
        DROP INDEX IF EXISTS idx_keyword_metrics_unique_source_file_row;
        DROP INDEX IF EXISTS idx_keyword_opportunities_unique_asin_keyword;
      `);
      insertBusinessIdentityRows(database, storeId, 'PENDING');
      insertBusinessIdentityRows(database, storeId, 'PENDING');

      const insertQuarantine = database.prepare(`
        INSERT INTO store_migration_quarantine (
          migration_version, source_table, source_row_id, reason,
          candidate_store_ids_json, source_identity_json, status,
          created_at, updated_at
        ) VALUES (
          99, ?, ?, 'ambiguous_store_identity', ?, '{}', 'pending',
          datetime('now'), datetime('now')
        )
      `);
      for (const table of ['ad_daily_metrics', 'keyword_metrics', 'keyword_opportunities']) {
        const rows = database.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as Array<{ id: number }>;
        expect(rows).toHaveLength(2);
        insertQuarantine.run(table, String(rows[1].id), JSON.stringify([storeId, 'store-other']));
      }
    } finally {
      database.close();
    }

    const reopened = initSqlite(databasePath);
    try {
      for (const table of ['ad_daily_metrics', 'keyword_metrics', 'keyword_opportunities']) {
        expect(reopened.prepare(`
          SELECT id, store_id AS storeId,
                 store_authority_quarantined AS quarantined
          FROM ${table}
          ORDER BY id
        `).all()).toEqual([
          { id: 1, storeId, quarantined: 0 },
          { id: 2, storeId, quarantined: 1 },
        ]);
        expect(reopened.prepare(`
          SELECT status
          FROM store_migration_quarantine
          WHERE source_table = ? AND source_row_id = '2'
        `).get(table)).toEqual({ status: 'pending' });
      }

      expectStoreScopedIdentityIndexes(reopened);
      expect(() => insertBusinessIdentityRows(reopened, storeId, 'PENDING'))
        .toThrow(/UNIQUE|constraint/i);
    } finally {
      reopened.close();
    }
  });
});
