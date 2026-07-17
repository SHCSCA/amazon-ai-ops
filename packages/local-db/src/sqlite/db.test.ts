import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initSqlite } from './db';
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
        asin: 'B001',
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
          asin: 'B001',
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
        marketplace_code: 'US', store_name: 'FT-US-US', asin: 'B001', parent_asin: '', msku: '', sku: '',
        title: 'Atomic batch product', product_stage: 'scaling', status: 'active',
      });
      productRepo.updateCost(productId, { productId, targetAcos: 0.25 });

      expect(() => productRepo.updateTargetAcosMany([
        { asin: 'B001', storeName: 'FT-US-US', marketplaceCode: 'US', targetAcos: 0.35 },
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

  it('deduplicates legacy ad_daily_metrics rows and enforces unique daily report identity', () => {
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
        SELECT COUNT(*) AS rowCount, SUM(cost) AS totalCost, SUM(clicks) AS totalClicks
        FROM ad_daily_metrics
        WHERE batch_id = 'batch_1'
          AND source_file = 'C:/reports/user-search-term.xlsx'
      `).get() as { rowCount: number; totalCost: number; totalClicks: number };
      expect(row).toEqual({ rowCount: 1, totalCost: 42.25, totalClicks: 33 });

      expect(() => upgradedDb.prepare(`
        INSERT INTO ad_daily_metrics (
          batch_id, report_type, date, store_name, marketplace_code, asin, msku,
          campaign_name, ad_group_name, targeting, search_term, match_type,
          impressions, clicks, cost, orders, sales, acos, cpc, cvr, source_file
        ) VALUES (
          'batch_1', 'user_search_term', '2026-06-12', 'FT-US-US', 'US', 'B001', '',
          'Campaign', 'Ad group', '', 'smart lock outdoor', 'exact',
          1000, 34, 43.00, 0, 0, 0, 1.26, 0, 'C:/reports/user-search-term.xlsx'
        )
      `).run()).toThrow(/UNIQUE|constraint/i);
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
        VALUES ('US', 'FT-US-US', 'B001', 'OLD-PARENT', 'OLD-MSKU', 'OLD-SKU', 'Old product', 'launch', 'active')
      `).run();
      legacyDb.prepare(`
        INSERT INTO products (marketplace_code, store_name, asin, parent_asin, msku, sku, title, product_stage, status)
        VALUES ('US', 'FT-US-US', 'B001', 'KEEP-PARENT', 'KEEP-MSKU', 'KEEP-SKU', 'Keep product', 'scaling', 'active')
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
        WHERE asin = 'B001' AND store_name = 'FT-US-US' AND marketplace_code = 'US'
      `).all() as Array<{ asin: string; parentAsin: string; title: string; productStage: string }>;

      expect(products).toEqual([
        {
          asin: 'B001',
          parentAsin: 'KEEP-PARENT',
          title: 'Keep product',
          productStage: 'scaling',
        },
      ]);

      productRepo.upsert({
        asin: 'B001',
        store_name: 'FT-US-US',
        marketplace_code: 'US',
        parent_asin: 'NEW-PARENT',
        msku: 'NEW-MSKU',
        sku: 'NEW-SKU',
        title: 'Updated product',
        product_stage: 'harvest',
        status: 'paused',
      });
      const updated = productRepo.findByAsin('B001', 'FT-US-US', 'US');
      expect(updated?.parent_asin).toBe('NEW-PARENT');
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
          asin: 'B001',
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
