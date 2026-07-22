import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeStoreId } from '@amazon-ai-ops/shared-types';
import { initSqlite } from '../db';
import { ProductRepository } from '../repositories/product-repo';
import {
  PRODUCT_STORE_AUTHORITY_MIGRATION_CHECKSUM,
  PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION,
  ProductStoreAuthorityMigrationError,
} from './0003-product-store-authority';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-product-migration-'));
  tempDirs.push(directory);
  return path.join(directory, 'app.db');
}

describe('product store authority migration v3', () => {
  it('installs store-scoped normalized ASIN identity and survives reopen', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    try {
      const migration = database.prepare(`
        SELECT checksum, status
        FROM schema_migrations
        WHERE version = ?
      `).get(PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION);
      const index = database.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_products_unique_store_asin'
      `).get() as { sql: string };

      expect(migration).toEqual({
        checksum: PRODUCT_STORE_AUTHORITY_MIGRATION_CHECKSUM,
        status: 'applied',
      });
      expect(index.sql).toMatch(/store_id, upper\(trim\(asin\)\)/i);
      expect(database.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_products_unique_scope_asin'
      `).get()).toBeUndefined();
    } finally {
      database.close();
    }

    const reopened = initSqlite(databasePath);
    try {
      expect(reopened.prepare(`
        SELECT status FROM schema_migrations WHERE version = 3
      `).get()).toEqual({ status: 'applied' });
    } finally {
      reopened.close();
    }
  });

  it('keeps same-name stores with the same ASIN isolated after reopen', () => {
    const databasePath = tempDatabasePath();
    const storeA = normalizeStoreId('same-name-a');
    const storeB = normalizeStoreId('same-name-b');
    const database = initSqlite(databasePath);
    try {
      const insertStore = database.prepare(`
        INSERT INTO stores (
          store_id, browser_profile_id, marketplace, currency, display_name,
          status, business_timezone, created_at, updated_at
        ) VALUES (?, ?, 'US', 'USD', 'Shared Display', 'active',
          'America/Los_Angeles', datetime('now'), datetime('now'))
      `);
      insertStore.run(storeA, 'same-name-profile-a');
      insertStore.run(storeB, 'same-name-profile-b');
      const products = new ProductRepository(database);
      products.insertForStore(storeA, {
        marketplace_code: 'US', store_name: 'Shared Display', asin: 'B0SHARED01',
        parent_asin: '', msku: 'A', sku: 'A', title: 'Store A',
        product_stage: 'growth', status: 'active',
      });
      products.insertForStore(storeB, {
        marketplace_code: 'US', store_name: 'Shared Display', asin: 'b0shared01',
        parent_asin: '', msku: 'B', sku: 'B', title: 'Store B',
        product_stage: 'growth', status: 'active',
      });
    } finally {
      database.close();
    }

    const reopened = initSqlite(databasePath);
    try {
      const products = new ProductRepository(reopened);
      expect(products.findByAsinForStore(storeA, 'B0SHARED01')?.title).toBe('Store A');
      expect(products.findByAsinForStore(storeB, 'B0SHARED01')?.title).toBe('Store B');
      expect(reopened.prepare('SELECT COUNT(*) AS count FROM products').get()).toEqual({ count: 2 });
    } finally {
      reopened.close();
    }
  });

  it('explicitly merges legacy same-store duplicates and records the removed row', () => {
    const databasePath = tempDatabasePath();
    const legacy = new Database(databasePath);
    try {
      legacy.exec(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          marketplace_code TEXT,
          store_name TEXT,
          asin TEXT,
          parent_asin TEXT,
          msku TEXT,
          sku TEXT,
          title TEXT,
          product_stage TEXT,
          status TEXT DEFAULT 'active',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO products (marketplace_code, store_name, asin, title)
        VALUES ('US', 'Legacy Shop', 'B0DUPLICATE', 'First');
        INSERT INTO products (marketplace_code, store_name, asin, title)
        VALUES ('US', 'Legacy Shop', '  b0duplicate  ', 'Second');
      `);
    } finally {
      legacy.close();
    }

    const inspected = initSqlite(databasePath);
    try {
      expect(inspected.prepare('SELECT id, asin, title FROM products').all()).toEqual([
        { id: 2, asin: 'B0DUPLICATE', title: 'Second' },
      ]);
      expect(inspected.prepare(`
        SELECT status, result_json AS resultJson
        FROM schema_migrations WHERE version = 3
      `).get()).toEqual(expect.objectContaining({ status: 'applied' }));
      const migration = inspected.prepare(`
        SELECT result_json AS resultJson FROM schema_migrations WHERE version = 3
      `).get() as { resultJson: string };
      expect(JSON.parse(migration.resultJson)).toEqual(expect.objectContaining({ mergedDuplicateRows: 1 }));
      expect(inspected.prepare(`
        SELECT reason, status, resolved_store_id AS resolvedStoreId, resolution_note AS resolutionNote
        FROM store_migration_quarantine
        WHERE migration_version = 3 AND source_table = 'products' AND source_row_id = '1'
      `).get()).toEqual(expect.objectContaining({
        reason: 'duplicate_normalized_asin_merged',
        status: 'resolved',
        resolvedStoreId: expect.stringMatching(/^legacy-/),
        resolutionNote: expect.stringMatching(/product 2/i),
      }));
    } finally {
      inspected.close();
    }
  });

  it('fails closed when duplicate products contain conflicting cost records', () => {
    const databasePath = tempDatabasePath();
    const legacy = new Database(databasePath);
    try {
      legacy.exec(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          marketplace_code TEXT,
          store_name TEXT,
          asin TEXT,
          title TEXT
        );
        CREATE TABLE product_costs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER,
          purchase_cost REAL DEFAULT 0
        );
        INSERT INTO products (id, marketplace_code, store_name, asin, title)
        VALUES (1, 'US', 'Legacy Shop', 'B0CONFLICT', 'First');
        INSERT INTO products (id, marketplace_code, store_name, asin, title)
        VALUES (2, 'US', 'Legacy Shop', 'b0conflict', 'Second');
        INSERT INTO product_costs (product_id, purchase_cost) VALUES (1, 10);
        INSERT INTO product_costs (product_id, purchase_cost) VALUES (2, 20);
      `);
    } finally {
      legacy.close();
    }

    expect(() => initSqlite(databasePath)).toThrow(ProductStoreAuthorityMigrationError);
    const inspected = new Database(databasePath, { readonly: true });
    try {
      expect(inspected.prepare('SELECT COUNT(*) AS count FROM products').get()).toEqual({ count: 2 });
      expect(inspected.prepare(`
        SELECT status, error_message AS errorMessage
        FROM schema_migrations WHERE version = 3
      `).get()).toEqual(expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringMatching(/conflicting cost records/i),
      }));
    } finally {
      inspected.close();
    }
  });

  it('keeps unowned legacy products quarantined instead of assigning a store', () => {
    const databasePath = tempDatabasePath();
    const legacy = new Database(databasePath);
    try {
      legacy.exec(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          marketplace_code TEXT,
          store_name TEXT,
          asin TEXT,
          title TEXT
        );
        INSERT INTO products (marketplace_code, store_name, asin, title)
        VALUES ('US', NULL, 'B0UNOWNED', 'Unowned legacy product');
      `);
    } finally {
      legacy.close();
    }

    const upgraded = initSqlite(databasePath);
    try {
      expect(upgraded.prepare(`
        SELECT store_id AS storeId, title FROM products WHERE asin = 'B0UNOWNED'
      `).get()).toEqual({ storeId: null, title: 'Unowned legacy product' });
      expect(upgraded.prepare(`
        SELECT migration_version AS migrationVersion, reason, status
        FROM store_migration_quarantine
        WHERE source_table = 'products' AND source_row_id = '1'
        ORDER BY migration_version DESC
        LIMIT 1
      `).get()).toEqual({
        migrationVersion: 1,
        reason: 'missing_store_identity',
        status: 'pending',
      });
    } finally {
      upgraded.close();
    }
  });
});
