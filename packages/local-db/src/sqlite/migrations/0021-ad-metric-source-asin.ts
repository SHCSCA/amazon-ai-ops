import { AD_METRIC_SOURCE_METRIC_MASK_MIGRATION_VERSION, AD_METRIC_SOURCE_METRIC_MASK_MIGRATION_NAME, AD_METRIC_SOURCE_METRIC_MASK_MIGRATION_CHECKSUM } from './0022-ad-metric-source-metric-mask';
import type Database from 'better-sqlite3';
import { prepareUpgradeBackup } from './upgrade-backup';
import type { UpgradeBackupManifest } from './types';

export const AD_METRIC_SOURCE_ASIN_MIGRATION_VERSION = 21;
export const AD_METRIC_SOURCE_ASIN_MIGRATION_NAME = 'ad-metric-source-asin-v21';
export const AD_METRIC_SOURCE_ASIN_MIGRATION_CHECKSUM = 'ad-metric-source-asin-v21-20261029-01';

export function verifyAdMetricSourceAsinSchema(database: Database.Database): void {
  const columns = database.pragma('table_info(ad_daily_metrics)') as Array<{
    name: string; type: string; notnull: number; dflt_value: unknown;
  }>;
  const column = columns.find((item) => item.name === 'source_asin');
  if (!column || column.type.toUpperCase() !== 'TEXT' || column.notnull !== 0 || column.dflt_value !== null) {
    throw new Error('广告指标原生 ASIN 来源列不符合可空且无默认值的契约。');
  }
}

export function runAdMetricSourceAsinMigration(database: Database.Database, preparedBackup?: UpgradeBackupManifest): void {
  const version = AD_METRIC_SOURCE_ASIN_MIGRATION_VERSION;
  const existing = database.prepare('SELECT name,status,checksum FROM schema_migrations WHERE version=?').get(version) as {
    name: string; status: string; checksum: string;
  } | undefined;
  if (existing && (existing.name !== AD_METRIC_SOURCE_ASIN_MIGRATION_NAME || existing.checksum !== AD_METRIC_SOURCE_ASIN_MIGRATION_CHECKSUM)) {
    throw new Error('Migration 21 identity mismatch.');
  }
  if (existing?.status === 'applied') { verifyAdMetricSourceAsinSchema(database); return; }
  if ((database.prepare('SELECT status FROM schema_migrations WHERE version=20').get() as { status?: string })?.status !== 'applied') {
    throw new Error('Migration 20 must precede metric source ASIN provenance.');
  }
  const backup = preparedBackup ?? prepareUpgradeBackup(database, {
    targetVersion: version, targetName: AD_METRIC_SOURCE_ASIN_MIGRATION_NAME, targetChecksum: AD_METRIC_SOURCE_ASIN_MIGRATION_CHECKSUM,
  });
  const currentTarget = backup.targetVersion === version && backup.targetName === AD_METRIC_SOURCE_ASIN_MIGRATION_NAME && backup.targetChecksum === AD_METRIC_SOURCE_ASIN_MIGRATION_CHECKSUM;
  const nextTarget = backup.targetVersion === AD_METRIC_SOURCE_METRIC_MASK_MIGRATION_VERSION && backup.targetName === AD_METRIC_SOURCE_METRIC_MASK_MIGRATION_NAME && backup.targetChecksum === AD_METRIC_SOURCE_METRIC_MASK_MIGRATION_CHECKSUM;
  if (!currentTarget && !nextTarget) {
    throw new Error('Migration 21 backup target mismatch.');
  }
  database.prepare(`INSERT INTO schema_migrations(version,name,checksum,status,started_at,manifest_json) VALUES(?,?,?,'started',?,?)
    ON CONFLICT(version) DO UPDATE SET status='started',started_at=excluded.started_at,manifest_json=excluded.manifest_json,error_message=NULL`)
    .run(version, AD_METRIC_SOURCE_ASIN_MIGRATION_NAME, AD_METRIC_SOURCE_ASIN_MIGRATION_CHECKSUM, new Date().toISOString(), JSON.stringify({ version, upgradeBackup: backup }));
  try {
    database.transaction(() => {
      // 不回填历史值；NULL 保留无法区分原生与推断的事实。
      database.exec('ALTER TABLE ad_daily_metrics ADD COLUMN source_asin TEXT');
      verifyAdMetricSourceAsinSchema(database);
      database.prepare(`UPDATE schema_migrations SET status='applied',applied_at=?,result_json=? WHERE version=?`)
        .run(new Date().toISOString(), JSON.stringify({ version, status: 'applied' }), version);
    }).immediate();
  } catch (error) {
    database.prepare(`UPDATE schema_migrations SET status='failed',error_message=? WHERE version=?`)
      .run(error instanceof Error ? error.message : String(error), version);
    throw error;
  }
}
