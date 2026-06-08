import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initSqlite } from './db';

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
  it('keeps Lingxing report batch appVersion for final manifest audit traceability', () => {
    const db = initSqlite(tempDbPath());
    try {
      const columns = db.prepare('PRAGMA table_info(lingxing_report_batches)').all() as Array<{ name: string }>;

      expect(columns.map((column) => column.name)).toContain('app_version');
      db.prepare(`
        INSERT INTO lingxing_report_batches
          (id, app_version, date_start, date_end, status, download_dir, created_at)
        VALUES
          ('batch_1', '1.5.0-test', '2026-05-01', '2026-05-31', 'completed', 'C:/tmp/downloads', '2026-06-01T00:00:00.000Z')
      `).run();

      const row = db.prepare('SELECT app_version AS appVersion FROM lingxing_report_batches WHERE id = ?').get('batch_1') as { appVersion?: string };
      expect(row.appVersion).toBe('1.5.0-test');
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
});
