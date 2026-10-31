import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  AD_METRIC_SOURCE_METRIC_MASK_MIGRATION_NAME,
  AD_METRIC_SOURCE_METRIC_MASK_MIGRATION_CHECKSUM,
  runAdMetricSourceMetricMaskMigration,
} from './0022-ad-metric-source-metric-mask';

function isolatedLegacyFixture() {
  const db = new Database(':memory:');
  // 仅覆盖第 22 步升级；不是完整历史迁移或正式数据库。
  db.exec(`CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT, checksum TEXT, status TEXT,
    started_at TEXT, manifest_json TEXT, error_message TEXT, applied_at TEXT, result_json TEXT
  ); INSERT INTO schema_migrations(version,status) VALUES(21,'applied');
  CREATE TABLE ad_daily_metrics(id INTEGER PRIMARY KEY,asin TEXT);
  INSERT INTO ad_daily_metrics(asin) VALUES('HISTORICAL_INFERRED');`);
  return db;
}

describe('第 22 步指标单元格 证据迁移', () => {
  it('历史字段不回填，NULL、零位图与指标单元格 三态独立保存', () => {
    const db = isolatedLegacyFixture();
    try {
      runAdMetricSourceMetricMaskMigration(db);
      runAdMetricSourceMetricMaskMigration(db);
      db.prepare('INSERT INTO ad_daily_metrics(asin,source_metric_mask) VALUES(?,?)').run('INFERRED', 0);
      db.prepare('INSERT INTO ad_daily_metrics(asin,source_metric_mask) VALUES(?,?)').run('B000000001', 31);
      expect(db.prepare('SELECT asin,source_metric_mask FROM ad_daily_metrics ORDER BY id').all()).toEqual([
        { asin: 'HISTORICAL_INFERRED', source_metric_mask: null },
        { asin: 'INFERRED', source_metric_mask: 0 },
        { asin: 'B000000001', source_metric_mask: 31 },
      ]);
    } finally { db.close(); }
  });
  it('拒绝缺失前序迁移和错误身份', () => {
    const db = isolatedLegacyFixture();
    try {
      db.exec('DELETE FROM schema_migrations');
      expect(() => runAdMetricSourceMetricMaskMigration(db)).toThrow();
      db.prepare('INSERT INTO schema_migrations(version,name,checksum,status) VALUES(22,?,?,?)')
        .run(AD_METRIC_SOURCE_METRIC_MASK_MIGRATION_NAME, 'wrong', 'applied');
      expect(() => runAdMetricSourceMetricMaskMigration(db)).toThrow();
    } finally { db.close(); }
  });
  it('已应用标记不能掩盖默认零位图造成的来源伪造', () => {
    const db = isolatedLegacyFixture();
    try {
      db.exec("ALTER TABLE ad_daily_metrics ADD COLUMN source_metric_mask INTEGER NOT NULL DEFAULT 0");
      db.prepare('INSERT INTO schema_migrations(version,name,checksum,status) VALUES(22,?,?,?)')
        .run(AD_METRIC_SOURCE_METRIC_MASK_MIGRATION_NAME, AD_METRIC_SOURCE_METRIC_MASK_MIGRATION_CHECKSUM, 'applied');
      expect(() => runAdMetricSourceMetricMaskMigration(db)).toThrow();
    } finally { db.close(); }
  });
});

describe('第 22 步备份与事务失败', () => {
  it('DDL 失败回滚，保留失败状态且允许重新执行', () => {
    const db = isolatedLegacyFixture();
    try {
      const original = db.exec.bind(db);
      let fail = true;
      db.exec = ((sql: string) => {
        const result = original(sql);
        if (fail && sql.startsWith('ALTER TABLE ad_daily_metrics')) { fail = false; throw new Error('isolated injected failure'); }
        return result;
      }) as typeof db.exec;
      expect(() => runAdMetricSourceMetricMaskMigration(db)).toThrow('isolated injected failure');
      expect((db.pragma('table_info(ad_daily_metrics)') as Array<{ name: string }>).some(column => column.name === 'source_metric_mask')).toBe(false);
      expect(db.prepare('SELECT status FROM schema_migrations WHERE version=22').get()).toEqual({ status: 'failed' });
      runAdMetricSourceMetricMaskMigration(db);
      expect(db.prepare('SELECT source_metric_mask FROM ad_daily_metrics').get()).toEqual({ source_metric_mask: null });
    } finally { db.close(); }
  });
});
