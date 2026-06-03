import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
});
