import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { countImportedRowsForReportFile } from './business-report-import-coverage';

describe('business report import coverage', () => {
  it('counts an imported aggregate report even when the operator scope locks an ASIN', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE ad_daily_metrics (
          store_id TEXT,
          date TEXT NOT NULL,
          store_name TEXT,
          marketplace_code TEXT,
          asin TEXT,
          source_file TEXT,
          batch_id TEXT
        );
      `);
      const insert = db.prepare(`
        INSERT INTO ad_daily_metrics
          (store_id, date, store_name, marketplace_code, asin, source_file, batch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run('store-one', '2026-06-01', 'FT-US-US', 'US', '', 'C:/reports/campaign.xlsx', 'batch_current');
      insert.run('store-one', '2026-06-01', 'FT-US-US', 'US', 'B0OTHER', 'C:/reports/campaign.xlsx', 'batch_old');
      insert.run('store-two', '2026-06-01', 'FT-US-US', 'US', '', 'C:/reports/campaign.xlsx', 'batch_current');

      expect(countImportedRowsForReportFile(db, {
        scope: {
          storeId: 'store-one',
          dateFrom: '2026-05-21',
          dateTo: '2026-06-23',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: 'B0LOCKED',
        },
        sourceFiles: ['C:/reports/campaign.xlsx'],
        batchId: 'batch_current',
      })).toBe(1);
    } finally {
      db.close();
    }
  });
});
