import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  AD_METRIC_SOURCE_ASIN_MIGRATION_NAME,
  AD_METRIC_SOURCE_ASIN_MIGRATION_CHECKSUM,
  runAdMetricSourceAsinMigration,
} from './0021-ad-metric-source-asin';

function isolatedLegacyFixture() {
  const db = new Database(':memory:');
  // 仅覆盖第 21 步升级；不是完整历史迁移或正式数据库。
  db.exec(`CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT, checksum TEXT, status TEXT,
    started_at TEXT, manifest_json TEXT, error_message TEXT, applied_at TEXT, result_json TEXT
  ); INSERT INTO schema_migrations(version,status) VALUES(20,'applied');
  CREATE TABLE ad_daily_metrics(id INTEGER PRIMARY KEY,asin TEXT);
  INSERT INTO ad_daily_metrics(asin) VALUES('HISTORICAL_INFERRED');`);
  return db;
}

describe('第 21 步原生 ASIN 证据迁移', () => {
  it('历史字段不回填，NULL、空串与原生 ASIN 三态独立保存', () => {
    const db = isolatedLegacyFixture();
    try {
      runAdMetricSourceAsinMigration(db);
      runAdMetricSourceAsinMigration(db);
      db.prepare('INSERT INTO ad_daily_metrics(asin,source_asin) VALUES(?,?)').run('INFERRED', '');
      db.prepare('INSERT INTO ad_daily_metrics(asin,source_asin) VALUES(?,?)').run('B000000001', 'B000000001');
      expect(db.prepare('SELECT asin,source_asin FROM ad_daily_metrics ORDER BY id').all()).toEqual([
        { asin: 'HISTORICAL_INFERRED', source_asin: null },
        { asin: 'INFERRED', source_asin: '' },
        { asin: 'B000000001', source_asin: 'B000000001' },
      ]);
    } finally { db.close(); }
  });
  it('拒绝缺失前序迁移和错误身份', () => {
    const db = isolatedLegacyFixture();
    try {
      db.exec('DELETE FROM schema_migrations');
      expect(() => runAdMetricSourceAsinMigration(db)).toThrow();
      db.prepare('INSERT INTO schema_migrations(version,name,checksum,status) VALUES(21,?,?,?)')
        .run(AD_METRIC_SOURCE_ASIN_MIGRATION_NAME, 'wrong', 'applied');
      expect(() => runAdMetricSourceAsinMigration(db)).toThrow();
    } finally { db.close(); }
  });
  it('已应用标记不能掩盖默认空串造成的来源伪造', () => {
    const db = isolatedLegacyFixture();
    try {
      db.exec("ALTER TABLE ad_daily_metrics ADD COLUMN source_asin TEXT NOT NULL DEFAULT ''");
      db.prepare('INSERT INTO schema_migrations(version,name,checksum,status) VALUES(21,?,?,?)')
        .run(AD_METRIC_SOURCE_ASIN_MIGRATION_NAME, AD_METRIC_SOURCE_ASIN_MIGRATION_CHECKSUM, 'applied');
      expect(() => runAdMetricSourceAsinMigration(db)).toThrow();
    } finally { db.close(); }
  });
});
