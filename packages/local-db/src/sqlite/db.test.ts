import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initGuardedExistingSqlite, initSqlite } from './db';
import { ProductRepository } from './repositories/product-repo';

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-local-db-'));
  tempDirs.push(dir);
  return path.join(dir, 'app.db');
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('initSqlite v1.5 schema', () => {
  it('creates product current price as a persisted product cost field', () => {
    const db = initSqlite(tempDbPath());
    try {
      const columns = db.prepare('PRAGMA table_info(product_costs)').all() as Array<{
        name: string;
        dflt_value: string | null;
      }>;

      expect(columns).toContainEqual(expect.objectContaining({
        name: 'current_price',
        dflt_value: '0',
      }));
    } finally {
      db.close();
    }
  });

  it('adds current price when upgrading a legacy product costs table', () => {
    const dbPath = tempDbPath();
    const legacyDb = new Database(dbPath);
    try {
      legacyDb.exec(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          marketplace_code TEXT,
          store_name TEXT,
          asin TEXT
        );
        CREATE TABLE product_costs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER,
          purchase_cost REAL DEFAULT 0
        );
        INSERT INTO products (id, marketplace_code, store_name, asin)
        VALUES (1, 'US', 'FT-US-US', 'B001');
        INSERT INTO product_costs (product_id, purchase_cost)
        VALUES (1, 12.5);
      `);
    } finally {
      legacyDb.close();
    }

    const upgradedDb = initSqlite(dbPath);
    try {
      const currentPriceColumn = (upgradedDb.prepare('PRAGMA table_info(product_costs)').all() as Array<{
        name: string;
        dflt_value: string | null;
      }>).find((column) => column.name === 'current_price');
      const row = upgradedDb.prepare(`
        SELECT purchase_cost AS purchaseCost, current_price AS currentPrice
        FROM product_costs
        WHERE product_id = 1
      `).get() as { purchaseCost: number; currentPrice: number };

      expect(currentPriceColumn).toMatchObject({ name: 'current_price', dflt_value: '0' });
      expect(row).toEqual({ purchaseCost: 12.5, currentPrice: 0 });
    } finally {
      upgradedDb.close();
    }
  });

  it('keeps current price after save, close, reopen, and product reload', () => {
    const dbPath = tempDbPath();
    const db = initSqlite(dbPath);
    try {
      const productRepo = new ProductRepository(db);
      const productId = productRepo.insert({
        marketplace_code: 'US',
        store_name: 'FT-US-US',
        asin: 'B0DBTEST01',
        parent_asin: '',
        msku: 'MSKU-1',
        sku: 'SKU-1',
        title: 'Current price persistence product',
        product_stage: 'scaling',
        status: 'active',
      });
      productRepo.updateCost(productId, {
        productId,
        currentPrice: 39.99,
        purchaseCost: 12.5,
      });
    } finally {
      db.close();
    }

    const reopenedDb = initSqlite(dbPath);
    try {
      const products = new ProductRepository(reopenedDb).findAllWithCosts('FT-US-US');

      expect(products).toEqual([
        expect.objectContaining({
          asin: 'B0DBTEST01',
          cost: expect.objectContaining({
            currentPrice: 39.99,
            purchaseCost: 12.5,
          }),
        }),
      ]);
    } finally {
      reopenedDb.close();
    }
  });

  it('rolls back every target ACOS update when one product in the batch is invalid', () => {
    const db = initSqlite(tempDbPath());
    try {
      const productRepo = new ProductRepository(db);
      const productId = productRepo.insert({
        marketplace_code: 'US', store_name: 'FT-US-US', asin: 'B0DBTEST01', parent_asin: '', msku: '', sku: '',
        title: 'Atomic batch product', product_stage: 'scaling', status: 'active',
      });
      productRepo.updateCost(productId, { productId, targetAcos: 0.25 });

      expect(() => productRepo.updateTargetAcosMany([
        { asin: 'B0DBTEST01', storeName: 'FT-US-US', marketplaceCode: 'US', targetAcos: 0.35 },
        { asin: 'MISSING', storeName: 'FT-US-US', marketplaceCode: 'US', targetAcos: 0.35 },
      ])).toThrow('MISSING');
      expect(productRepo.getCost(productId)?.targetAcos).toBe(0.25);
    } finally {
      db.close();
    }
  });

  it('creates recommendation revision as a non-null zero-based decision version', () => {
    const db = initSqlite(tempDbPath());
    try {
      const revisionColumn = (db.prepare('PRAGMA table_info(action_recommendations)').all() as Array<{
        name: string;
        notnull: number;
        dflt_value: string | null;
      }>).find((column) => column.name === 'revision');

      expect(revisionColumn).toMatchObject({
        name: 'revision',
        notnull: 1,
        dflt_value: '0',
      });
    } finally {
      db.close();
    }
  });

  it('upgrades legacy recommendations with revision zero without changing their decision status', () => {
    const dbPath = tempDbPath();
    const legacyDb = new Database(dbPath);
    try {
      legacyDb.exec(`
        CREATE TABLE action_recommendations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          risk_level TEXT DEFAULT 'APPROVAL',
          status TEXT DEFAULT 'pending'
        );
        INSERT INTO action_recommendations (risk_level, status)
        VALUES ('APPROVAL', 'approved');
      `);
    } finally {
      legacyDb.close();
    }

    const upgradedDb = initSqlite(dbPath);
    try {
      const row = upgradedDb.prepare(`
        SELECT status, revision
        FROM action_recommendations
        WHERE id = 1
      `).get() as { status: string; revision: number };

      expect(row).toEqual({ status: 'approved', revision: 0 });
    } finally {
      upgradedDb.close();
    }
  });

  it('keeps Lingxing report batch appVersion and store/site scope for final manifest audit traceability', () => {
    const db = initSqlite(tempDbPath());
    try {
      const columns = db.prepare('PRAGMA table_info(lingxing_report_batches)').all() as Array<{ name: string }>;

      expect(columns.map((column) => column.name)).toContain('app_version');
      expect(columns.map((column) => column.name)).toContain('store_name');
      expect(columns.map((column) => column.name)).toContain('marketplace_code');
      db.prepare(`
        INSERT INTO lingxing_report_batches
          (id, app_version, date_start, date_end, store_name, marketplace_code, status, download_dir, created_at)
        VALUES
          ('batch_1', '1.5.0-test', '2026-05-01', '2026-05-31', 'FT-US-US', 'US', 'completed', 'C:/tmp/downloads', '2026-06-01T00:00:00.000Z')
      `).run();

      const row = db.prepare('SELECT app_version AS appVersion, store_name AS storeName, marketplace_code AS marketplaceCode FROM lingxing_report_batches WHERE id = ?').get('batch_1') as { appVersion?: string; storeName?: string; marketplaceCode?: string };
      expect(row.appVersion).toBe('1.5.0-test');
      expect(row.storeName).toBe('FT-US-US');
      expect(row.marketplaceCode).toBe('US');
    } finally {
      db.close();
    }
  });

  it('keeps download-center diagnostic store/site scope for live proof traceability', () => {
    const db = initSqlite(tempDbPath());
    try {
      const columns = db.prepare('PRAGMA table_info(download_center_diagnostics)').all() as Array<{ name: string }>;

      expect(columns.map((column) => column.name)).toContain('store_name');
      expect(columns.map((column) => column.name)).toContain('marketplace_code');
    } finally {
      db.close();
    }
  });

  it('upgrades legacy keyword_metrics tables before duplicate safeguards run', () => {
    const dbPath = tempDbPath();
    const legacyDb = new Database(dbPath);
    try {
      legacyDb.exec(`
        CREATE TABLE keyword_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          report_type TEXT,
          source_type TEXT,
          normalized_keyword TEXT NOT NULL,
          keyword TEXT,
          asin TEXT,
          impressions INTEGER DEFAULT 0,
          clicks INTEGER DEFAULT 0,
          cost REAL DEFAULT 0,
          orders INTEGER DEFAULT 0,
          sales REAL DEFAULT 0,
          acos REAL DEFAULT 0,
          cvr REAL DEFAULT 0,
          source_file TEXT,
          source_row_number INTEGER,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      legacyDb.prepare(`
        INSERT INTO keyword_metrics
          (report_type, source_type, normalized_keyword, keyword, asin, source_file, source_row_number)
        VALUES
          ('keyword', 'lingxing_download_center', 'smart lock', 'Smart Lock', 'B001', 'C:/tmp/keyword.xlsx', 12)
      `).run();
    } finally {
      legacyDb.close();
    }

    const upgradedDb = initSqlite(dbPath);
    try {
      const columns = upgradedDb.prepare('PRAGMA table_info(keyword_metrics)').all() as Array<{ name: string }>;

      expect(columns.map((column) => column.name)).toContain('source_file');
      expect(columns.map((column) => column.name)).toContain('source_row');
      const row = upgradedDb.prepare(`
        SELECT raw_keyword AS rawKeyword, source, source_row AS sourceRow
        FROM keyword_metrics
        WHERE normalized_keyword = 'smart lock'
      `).get() as { rawKeyword?: string; source?: string; sourceRow?: number };
      expect(row).toEqual({
        rawKeyword: 'Smart Lock',
        source: 'keyword_report',
        sourceRow: 12,
      });
    } finally {
      upgradedDb.close();
    }
  });

  it('preserves conflicting legacy ad metrics in quarantine and blocks silent reauthorization', () => {
    const dbPath = tempDbPath();
    const legacyDb = new Database(dbPath);
    try {
      legacyDb.exec(`
        CREATE TABLE ad_daily_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
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
          acos REAL DEFAULT 0,
          cpc REAL DEFAULT 0,
          cvr REAL DEFAULT 0,
          source_file TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      const insert = legacyDb.prepare(`
        INSERT INTO ad_daily_metrics (
          batch_id, report_type, date, store_name, marketplace_code, asin, msku,
          campaign_name, ad_group_name, targeting, search_term, match_type,
          impressions, clicks, cost, orders, sales, acos, cpc, cvr, source_file
        ) VALUES (
          'batch_1', 'user_search_term', '2026-06-12', 'FT-US-US', 'US', 'B001', '',
          'Campaign', 'Ad group', '', 'smart lock outdoor', 'exact',
          1000, @clicks, @cost, 0, 0, 0, @cpc, 0, 'C:/reports/user-search-term.xlsx'
        )
      `);
      insert.run({ clicks: 32, cost: 41.5, cpc: 1.3 });
      insert.run({ clicks: 33, cost: 42.25, cpc: 1.28 });
    } finally {
      legacyDb.close();
    }

    const upgradedDb = initSqlite(dbPath);
    try {
      const row = upgradedDb.prepare(`
        SELECT COUNT(*) AS rowCount,
               SUM(cost) AS totalCost,
               SUM(clicks) AS totalClicks,
               SUM(store_authority_quarantined) AS quarantinedCount
        FROM ad_daily_metrics
        WHERE batch_id = 'batch_1'
          AND source_file = 'C:/reports/user-search-term.xlsx'
      `).get() as {
        rowCount: number;
        totalCost: number;
        totalClicks: number;
        quarantinedCount: number;
      };
      expect(row).toEqual({
        rowCount: 2,
        totalCost: 83.75,
        totalClicks: 65,
        quarantinedCount: 2,
      });
      expect(upgradedDb.prepare(`
        SELECT reason, COUNT(*) AS count
        FROM store_migration_quarantine
        WHERE source_table = 'ad_daily_metrics' AND status = 'pending'
        GROUP BY reason
      `).all()).toEqual([{ reason: 'identity_content_conflict', count: 2 }]);
      const { storeId } = upgradedDb.prepare(`
        SELECT store_id AS storeId
        FROM ad_daily_metrics
        WHERE batch_id = 'batch_1'
        LIMIT 1
      `).get() as { storeId: string };

      expect(() => upgradedDb.prepare(`
        INSERT INTO ad_daily_metrics (
          store_id, batch_id, report_type, date, store_name, marketplace_code, asin, msku,
          campaign_name, ad_group_name, targeting, search_term, match_type,
          impressions, clicks, cost, orders, sales, acos, cpc, cvr, source_file
        ) VALUES (
          ?, 'batch_1', 'user_search_term', '2026-06-12', 'FT-US-US', 'US', 'B001', '',
          'Campaign', 'Ad group', '', 'smart lock outdoor', 'exact',
          1000, 34, 43.00, 0, 0, 0, 1.26, 0, 'C:/reports/user-search-term.xlsx'
        )
      `).run(storeId)).toThrow(/pending ad metric identity conflict/i);
    } finally {
      upgradedDb.close();
    }
  });

  it('deduplicates scoped products and keeps product cost as editable AI context', () => {
    const dbPath = tempDbPath();
    const legacyDb = new Database(dbPath);
    try {
      legacyDb.exec(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          marketplace_code TEXT NOT NULL,
          store_name TEXT NOT NULL,
          asin TEXT NOT NULL,
          parent_asin TEXT,
          msku TEXT,
          sku TEXT,
          title TEXT,
          product_stage TEXT DEFAULT 'launch',
          status TEXT DEFAULT 'active',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE product_costs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          purchase_cost REAL DEFAULT 0,
          first_leg_cost REAL DEFAULT 0,
          fba_fee REAL DEFAULT 0,
          referral_fee_rate REAL DEFAULT 0,
          storage_fee REAL DEFAULT 0,
          other_cost REAL DEFAULT 0,
          min_price REAL DEFAULT 0,
          target_net_margin REAL DEFAULT 0,
          target_acos REAL DEFAULT 0,
          target_tacos REAL DEFAULT 0,
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `);
      legacyDb.prepare(`
        INSERT INTO products (marketplace_code, store_name, asin, parent_asin, msku, sku, title, product_stage, status)
        VALUES ('US', 'FT-US-US', 'B0DBTEST01', 'B0PARENT01', 'OLD-MSKU', 'OLD-SKU', 'Old product', 'launch', 'active')
      `).run();
      legacyDb.prepare(`
        INSERT INTO products (marketplace_code, store_name, asin, parent_asin, msku, sku, title, product_stage, status)
        VALUES ('US', 'FT-US-US', 'B0DBTEST01', 'B0PARENT02', 'KEEP-MSKU', 'KEEP-SKU', 'Keep product', 'scaling', 'active')
      `).run();
      legacyDb.prepare(`
        INSERT INTO product_costs (product_id, purchase_cost, target_acos)
        VALUES (2, 10, 0.25)
      `).run();
      legacyDb.prepare(`
        INSERT INTO product_costs (product_id, purchase_cost, target_acos)
        VALUES (2, 12, 0.3)
      `).run();
    } finally {
      legacyDb.close();
    }

    const upgradedDb = initSqlite(dbPath);
    try {
      const productRepo = new ProductRepository(upgradedDb);
      const products = upgradedDb.prepare(`
        SELECT asin, parent_asin AS parentAsin, title, product_stage AS productStage
        FROM products
        WHERE asin = 'B0DBTEST01' AND store_name = 'FT-US-US' AND marketplace_code = 'US'
      `).all() as Array<{ asin: string; parentAsin: string; title: string; productStage: string }>;

      expect(products).toEqual([
        {
          asin: 'B0DBTEST01',
          parentAsin: 'B0PARENT02',
          title: 'Keep product',
          productStage: 'scaling',
        },
      ]);

      productRepo.upsert({
        asin: 'B0DBTEST01',
        store_name: 'FT-US-US',
        marketplace_code: 'US',
        parent_asin: 'B0PARENT03',
        msku: 'NEW-MSKU',
        sku: 'NEW-SKU',
        title: 'Updated product',
        product_stage: 'harvest',
        status: 'paused',
      });
      const updated = productRepo.findByAsin('B0DBTEST01', 'FT-US-US', 'US');
      expect(updated?.parent_asin).toBe('B0PARENT03');
      expect(updated?.product_stage).toBe('harvest');
      expect(updated?.status).toBe('paused');

      productRepo.updateCost(updated?.id || 0, {
        productId: updated?.id || 0,
        purchaseCost: 13.5,
        firstLegCost: 1.2,
        fbaFee: 4.1,
        referralFeeRate: 0.15,
        storageFee: 0.2,
        otherCost: 0.3,
        minPrice: 29.99,
        targetNetMargin: 0.22,
        targetAcos: 0.35,
        targetTacos: 0.12,
      });

      const cost = productRepo.getCost(updated?.id || 0);
      expect(cost).toEqual(expect.objectContaining({
        productId: updated?.id,
        purchaseCost: 13.5,
        firstLegCost: 1.2,
        targetAcos: 0.35,
      }));

      const withCosts = productRepo.findAllWithCosts('FT-US-US');
      expect(withCosts).toEqual([
        expect.objectContaining({
          asin: 'B0DBTEST01',
          title: 'Updated product',
          cost: expect.objectContaining({
            purchaseCost: 13.5,
            targetAcos: 0.35,
          }),
        }),
      ]);
    } finally {
      upgradedDb.close();
    }
  });
});

describe('initGuardedExistingSqlite', () => {
  it('requires an existing database file and never creates a missing authority DB', () => {
    const dbPath = tempDbPath();
    const guard = vi.fn();

    expect(() => initGuardedExistingSqlite(dbPath, guard)).toThrow();
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(guard).not.toHaveBeenCalled();
  });

  it('rejects an asynchronous guard before any migration can run', () => {
    const dbPath = tempDbPath();
    const legacyDb = new Database(dbPath);
    legacyDb.close();
    let unexpected: ReturnType<typeof initGuardedExistingSqlite> | null = null;
    let failure: unknown = null;

    try {
      unexpected = initGuardedExistingSqlite(dbPath, async () => 'not-synchronous');
    } catch (error) {
      failure = error;
    } finally {
      unexpected?.database.close();
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/synchronous/i);
    const inspected = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      expect(inspected.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'table' AND name = 'schema_migrations'
      `).get()).toEqual({ count: 0 });
    } finally {
      inspected.close();
    }
  });

  it('runs the guard against the existing v0 database before migrations', () => {
    const dbPath = tempDbPath();
    const legacyDb = new Database(dbPath);
    try {
      legacyDb.exec(`
        CREATE TABLE legacy_probe (
          id INTEGER PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT INTO legacy_probe (id, value) VALUES (1, 'before-migration');
      `);
    } finally {
      legacyDb.close();
    }

    const observed = initGuardedExistingSqlite(dbPath, ({ database, resolvedPath }) => {
      const migrationsTable = database.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'table' AND name = 'schema_migrations'
      `).get() as { count: number };
      const probe = database.prepare(`
        SELECT value FROM legacy_probe WHERE id = 1
      `).get() as { value: string };

      return {
        migrationsTableCount: migrationsTable.count,
        probeValue: probe.value,
        resolvedPath,
      };
    });

    try {
      expect(observed.guardResult).toEqual({
        migrationsTableCount: 0,
        probeValue: 'before-migration',
        resolvedPath: path.resolve(dbPath),
      });
      expect(observed.database.prepare(`
        SELECT MAX(version) AS version
        FROM schema_migrations
        WHERE status = 'applied'
      `).get()).toEqual({ version: 9 });
    } finally {
      observed.database.close();
    }
  });

  it('denies a competing SQLite writer while the guard holds the takeover lock', () => {
    const dbPath = tempDbPath();
    const legacyDb = new Database(dbPath);
    try {
      legacyDb.exec(`
        CREATE TABLE legacy_probe (
          id INTEGER PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT INTO legacy_probe (id, value) VALUES (1, 'unchanged');
      `);
    } finally {
      legacyDb.close();
    }

    const initialized = initGuardedExistingSqlite(dbPath, () => {
      const competitor = new Database(dbPath, { fileMustExist: true, timeout: 0 });
      try {
        expect(() => competitor.prepare(`
          UPDATE legacy_probe SET value = 'competing-write' WHERE id = 1
        `).run()).toThrow(/locked/i);
      } finally {
        competitor.close();
      }
      return 'exclusive-writer-denied';
    });

    try {
      expect(initialized.guardResult).toBe('exclusive-writer-denied');
      expect(initialized.database.prepare(`
        SELECT value FROM legacy_probe WHERE id = 1
      `).get()).toEqual({ value: 'unchanged' });
    } finally {
      initialized.database.close();
    }
  });

  it('rolls back and closes without publishing a global database when the guard fails', async () => {
    const dbPath = tempDbPath();
    const legacyDb = new Database(dbPath);
    try {
      legacyDb.exec(`
        CREATE TABLE legacy_probe (
          id INTEGER PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT INTO legacy_probe (id, value) VALUES (1, 'original');
      `);
    } finally {
      legacyDb.close();
    }
    const before = fs.readFileSync(dbPath);
    vi.resetModules();
    const isolatedDbModule = await import('./db');

    expect(() => isolatedDbModule.initGuardedExistingSqlite(dbPath, ({ database }) => {
      database.prepare(`
        UPDATE legacy_probe SET value = 'must-rollback' WHERE id = 1
      `).run();
      throw new Error('synthetic guard rejection');
    })).toThrow(/synthetic guard rejection/);

    expect(fs.readFileSync(dbPath)).toEqual(before);
    expect(() => isolatedDbModule.getSqliteDb()).toThrow(/not initialized/i);

    const inspected = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      expect(inspected.prepare(`
        SELECT value FROM legacy_probe WHERE id = 1
      `).get()).toEqual({ value: 'original' });
      expect(inspected.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'table' AND name = 'schema_migrations'
      `).get()).toEqual({ count: 0 });
    } finally {
      inspected.close();
    }
  });

  it('returns the exact guarded connection and keeps its exclusive lock through initialization', () => {
    const dbPath = tempDbPath();
    const legacyDb = new Database(dbPath);
    try {
      legacyDb.exec('CREATE TABLE legacy_probe (id INTEGER PRIMARY KEY)');
    } finally {
      legacyDb.close();
    }

    let guardedConnection: Database.Database | null = null;
    const guardToken = { admitted: true };
    const initialized = initGuardedExistingSqlite(dbPath, ({ database }) => {
      guardedConnection = database;
      return { database, token: guardToken };
    });

    const competitor = new Database(dbPath, { fileMustExist: true, timeout: 0 });
    try {
      expect(initialized.database).toBe(guardedConnection);
      expect(initialized.guardResult).toEqual({
        database: initialized.database,
        token: guardToken,
      });
      expect(initialized.database.inTransaction).toBe(false);
      expect(initialized.database.pragma('locking_mode', { simple: true })).toBe('exclusive');
      expect(() => competitor.exec(`
        INSERT INTO legacy_probe (id) VALUES (1)
      `)).toThrow(/locked/i);
    } finally {
      competitor.close();
      initialized.database.close();
    }

    const afterClose = new Database(dbPath, { fileMustExist: true, timeout: 0 });
    try {
      expect(() => afterClose.exec(`
        INSERT INTO legacy_probe (id) VALUES (1)
      `)).not.toThrow();
    } finally {
      afterClose.close();
    }
  });
});
