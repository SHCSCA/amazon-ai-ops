import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runAdMetricSourceMetricMaskMigration } from './0022-ad-metric-source-metric-mask';

describe('第 22 步隔离文件数据库备份', () => {
  it('升级前字节备份仍保留旧 NULL 未存在的原始 schema', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-metric-mask-'));
    const file = path.join(dir, 'fixture.db');
    const db = new Database(file);
    try {
      db.exec(`CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,name TEXT,checksum TEXT,status TEXT,started_at TEXT,
        manifest_json TEXT,error_message TEXT,applied_at TEXT,result_json TEXT
      ); INSERT INTO schema_migrations(version,status) VALUES(21,'applied');
      CREATE TABLE ad_daily_metrics(id INTEGER PRIMARY KEY,asin TEXT);
      INSERT INTO ad_daily_metrics(asin) VALUES('legacy');`);
      runAdMetricSourceMetricMaskMigration(db);
      const record = db.prepare('SELECT manifest_json FROM schema_migrations WHERE version=22').get() as { manifest_json: string };
      const manifest = JSON.parse(record.manifest_json).upgradeBackup;
      expect(manifest.status).toBe('created');
      expect(manifest.sourceVersion).toBe(21);
      expect(manifest.targetVersion).toBe(22);
      expect(fs.existsSync(manifest.backupPath)).toBe(true);
      const backup = new Database(manifest.backupPath, { readonly: true });
      try {
        expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
        expect(backup.prepare('SELECT * FROM ad_daily_metrics').all()).toEqual([{ id: 1, asin: 'legacy' }]);
        expect((backup.pragma('table_info(ad_daily_metrics)') as Array<{ name: string }>).some(column => column.name === 'source_metric_mask')).toBe(false);
      } finally { backup.close(); }
      expect(db.prepare('SELECT source_metric_mask FROM ad_daily_metrics').get()).toEqual({ source_metric_mask: null });
      for (const mask of [-1, 32, 1.5]) expect(() => db.prepare('INSERT INTO ad_daily_metrics(source_metric_mask) VALUES(?)').run(mask)).toThrow();
    } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
