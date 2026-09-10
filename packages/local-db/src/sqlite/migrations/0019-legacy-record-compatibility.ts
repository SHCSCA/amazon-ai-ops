import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { prepareUpgradeBackup } from './upgrade-backup';
import type { UpgradeBackupManifest } from './types';

export const LEGACY_COMPATIBILITY_MIGRATION_VERSION = 19;
export const LEGACY_COMPATIBILITY_MIGRATION_NAME = 'legacy-record-compatibility-v19';
export const LEGACY_COMPATIBILITY_MIGRATION_CHECKSUM = 'legacy-record-compatibility-v19-20260908-01';
export const LEGACY_CLASSIFIER_REVISION = 'legacy-compatibility/1';
export type LegacyRecordClassification = 'validated-compatible' | 'historical-read-only' | 're-derivation-required' | 'quarantined';

const schema = {
  legacy_record_classifications: `CREATE TABLE legacy_record_classifications (
    source_table TEXT NOT NULL, record_key TEXT NOT NULL, record_id TEXT, store_id TEXT,
    source_schema INTEGER NOT NULL CHECK(source_schema>=0), classifier_revision TEXT NOT NULL,
    source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
    classification TEXT NOT NULL CHECK(classification IN ('validated-compatible','historical-read-only','re-derivation-required','quarantined')),
    reason TEXT NOT NULL CHECK(length(trim(reason))>0), classified_at TEXT NOT NULL,
    PRIMARY KEY(source_table,record_key,classifier_revision)
  )`,
  idx_legacy_record_classifications_store: `CREATE INDEX idx_legacy_record_classifications_store ON legacy_record_classifications(store_id,source_table,record_id)`,
  trg_legacy_record_classifications_update: `CREATE TRIGGER trg_legacy_record_classifications_update BEFORE UPDATE ON legacy_record_classifications
    BEGIN SELECT RAISE(ABORT, 'Legacy classifications are immutable'); END`,
  trg_legacy_record_classifications_delete: `CREATE TRIGGER trg_legacy_record_classifications_delete BEFORE DELETE ON legacy_record_classifications
    BEGIN SELECT RAISE(ABORT, 'Legacy classifications are immutable'); END`,
};
const quote = (identifier: string) => '"' + identifier.replaceAll('"', '""') + '"';
const hash = (record: Record<string, unknown>) => createHash('sha256').update(JSON.stringify(Object.fromEntries(
  Object.keys(record).sort().map(key => [key, Buffer.isBuffer(record[key]) ? { base64: record[key].toString('base64') } : record[key]]),
))).digest('hex');
const excluded = /^(?:sqlite_|schema_migrations$|legacy_record_classifications$)|secret|credential|settings/i;

export function verifyLegacyCompatibilitySchema(database: Database.Database): void {
  const normalized = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  for (const [name, sql] of Object.entries(schema)) {
    const actual = database.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(name) as { sql: string } | undefined;
    if (!actual || normalized(actual.sql) !== normalized(sql)) throw new Error(`Legacy compatibility schema mismatch: ${name}`);
  }
}

/** Classifies the untouched upgrade snapshot; it never copies identity, approvals or defaults into old records. */
function classifySnapshot(database: Database.Database, backup: UpgradeBackupManifest): Record<string, number> {
  const counts: Record<LegacyRecordClassification, number> = {
    'validated-compatible': 0, 'historical-read-only': 0, 're-derivation-required': 0, quarantined: 0,
  };
  if (!Object.keys(backup.tableRowCounts).length) return counts;
  if (!backup.backupPath) throw new Error('Legacy classification requires a verified persistent upgrade snapshot.');
  const source = new Database(backup.backupPath, { readonly: true, fileMustExist: true });
  try {
    const tables = source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const names = new Set(tables.map(table => table.name));
    const stores = names.has('stores') ? source.prepare('SELECT * FROM stores').all() as Array<Record<string, unknown>> : [];
    const storeById = new Map(stores.map(store => [store.store_id, store]));
    const invalidRows = source.pragma('foreign_key_check') as Array<{ table: string; rowid: number | null }>;
    const at = new Date().toISOString();
    const insert = database.prepare(`INSERT INTO legacy_record_classifications
      (source_table,record_key,record_id,store_id,source_schema,classifier_revision,source_sha256,classification,reason,classified_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    for (const { name } of tables) {
      if (excluded.test(name)) continue;
      const columns = source.pragma(`table_info(${quote(name)})`) as Array<{ name: string; pk: number }>;
      const keys = columns.filter(column => column.pk).sort((a,b) => a.pk-b.pk).map(column => column.name);
      const foreignKeys = source.pragma(`foreign_key_list(${quote(name)})`) as Array<{ id: number; table: string; from: string; to: string }>;
      const scopedParents = [...new Set(foreignKeys.map(key => key.id))].map(id => foreignKeys.filter(key => key.id === id))
        .filter(keys => keys.every(key => key.to) && names.has(keys[0].table)
          && (source.pragma(`table_info(${quote(keys[0].table)})`) as Array<{ name: string }>).some(column => column.name === 'store_id'));
      const withoutRowId = /WITHOUT\s+ROWID/i.test(String((source.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(name) as { sql: string }).sql));
      for (const raw of source.prepare(`SELECT ${withoutRowId ? 'NULL' : 'rowid'} AS __legacy_rowid,* FROM ${quote(name)}`).iterate() as Iterable<Record<string, unknown>>) {
        const { __legacy_rowid: rowid, ...row } = raw;
        const key = keys.length ? JSON.stringify(keys.map(column => row[column])) : JSON.stringify([rowid]);
        const storeId = typeof row.store_id === 'string' && row.store_id.trim() ? row.store_id : null;
        const store = storeById.get(storeId);
        let classification: LegacyRecordClassification = 'historical-read-only';
        let reason = '保留原始历史供查阅；迁移不赋予当前分析、审批或执行权限。';
        let damaged = !store || store.marketplace !== 'US' || store.currency !== 'USD'
          || typeof store.browser_profile_id !== 'string' || !store.browser_profile_id.trim()
          || invalidRows.some(issue => issue.table === name && (issue.rowid === null || issue.rowid === rowid))
          || row.store_authority_quarantined === 1;
        if (name === 'evidence_refs' || /(?:_evidence|_evidence_packages)$/.test(name)) {
          if (!['sha256','content_sha256','evidence_hash','proof_hash','proof_sha256','snapshot_sha256'].some(key => /^[a-f0-9]{64}$/i.test(String(row[key] ?? '')))) damaged = true;
        }
        try {
          if (!store?.business_timezone) damaged = true;
          else new Intl.DateTimeFormat('en-US', { timeZone: String(store.business_timezone) }).format(0);
          for (const [column, value] of Object.entries(row)) {
            if (value != null && /(?:_json|metadata)$/.test(column)) JSON.parse(String(value));
            if (value != null && /(?:_sha256|_hash)$/.test(column) && !/^[a-f0-9]{64}$/i.test(String(value))) damaged = true;
          }
          for (const parent of scopedParents) {
            if (parent.some(key => row[key.from] == null)) continue;
            const linked = source.prepare(`SELECT store_id FROM ${quote(parent[0].table)} WHERE ${parent.map(key => `${quote(key.to)}=?`).join(' AND ')}`)
              .all(...parent.map(key => row[key.from])) as Array<{ store_id: string }>;
            if (linked.some(record => record.store_id !== storeId)) damaged = true;
          }
        } catch { damaged = true; }
        if (damaged) {
          classification = 'quarantined';
          reason = '原始记录的店铺归属、结构或证明无法验证；仅保留隔离审计，需从真实来源修复。';
        } else if (name === 'stores') {
          classification = 'validated-compatible';
          reason = '原始 US/USD 店铺、独立 Profile 和时区字段兼容；仅作店铺配置，连接和当前会话须重新核验。';
        } else if (['products','product_costs','keyword_metrics','ad_daily_metrics','inventory_daily_metrics','sales_daily_metrics','analysis_runs','action_recommendations'].includes(name)) {
          classification = 're-derivation-required';
          reason = '原始经营记录可供重新校验和派生；须创建新的当前分析记录，禁止提升旧结果为当前授权。';
        }
        insert.run(name, key, row.id == null ? null : String(row.id), storeId, backup.sourceVersion,
          LEGACY_CLASSIFIER_REVISION, hash(row), classification, reason, at);
        counts[classification]++;
      }
    }
  } finally { source.close(); }
  return counts;
}

export function runLegacyCompatibilityMigration(database: Database.Database, preparedBackup?: UpgradeBackupManifest): void {
  const version = LEGACY_COMPATIBILITY_MIGRATION_VERSION;
  const existing = database.prepare('SELECT checksum,status,result_json FROM schema_migrations WHERE version=?').get(version) as { checksum: string; status: string; result_json: string } | undefined;
  if (existing && existing.checksum !== LEGACY_COMPATIBILITY_MIGRATION_CHECKSUM) throw new Error('Migration 19 checksum mismatch.');
  if (existing?.status === 'applied') {
    verifyLegacyCompatibilitySchema(database);
    const receipt = JSON.parse(existing.result_json) as { classifications: Record<string, number>; sourceSchema: number; classifierRevision: string };
    if (receipt.classifierRevision !== LEGACY_CLASSIFIER_REVISION || !Number.isSafeInteger(receipt.sourceSchema)) throw new Error('Legacy classification receipt is incompatible.');
    const counts = database.prepare(`SELECT classification,COUNT(*) AS count FROM legacy_record_classifications
      WHERE classifier_revision=? AND source_schema=? GROUP BY classification`).all(LEGACY_CLASSIFIER_REVISION, receipt.sourceSchema) as Array<{ classification: string; count: number }>;
    for (const category of ['validated-compatible','historical-read-only','re-derivation-required','quarantined']) {
      if (receipt.classifications?.[category] !== (counts.find(row => row.classification === category)?.count ?? 0)) throw new Error('Legacy classification receipt count mismatch.');
    }
    return;
  }
  if (!(database.prepare("SELECT 1 FROM schema_migrations WHERE version=18 AND status='applied'").get())) throw new Error('Migration 18 must be applied before migration 19.');
  const upgradeBackup = preparedBackup ?? prepareUpgradeBackup(database, {
    targetVersion: version, targetName: LEGACY_COMPATIBILITY_MIGRATION_NAME, targetChecksum: LEGACY_COMPATIBILITY_MIGRATION_CHECKSUM,
  });
  database.prepare(`INSERT INTO schema_migrations(version,name,checksum,status,started_at,manifest_json) VALUES(?,?,?,'started',?,?)
    ON CONFLICT(version) DO UPDATE SET status='started',started_at=excluded.started_at,manifest_json=excluded.manifest_json,error_message=NULL`)
    .run(version, LEGACY_COMPATIBILITY_MIGRATION_NAME, LEGACY_COMPATIBILITY_MIGRATION_CHECKSUM, new Date().toISOString(), JSON.stringify({ version, upgradeBackup }));
  try {
    database.transaction(() => {
      for (const sql of Object.values(schema)) database.exec(sql);
      const classifications = classifySnapshot(database, upgradeBackup);
      verifyLegacyCompatibilitySchema(database);
      database.prepare("UPDATE schema_migrations SET status='applied',applied_at=?,result_json=? WHERE version=?")
        .run(new Date().toISOString(), JSON.stringify({ version, classifications, sourceSchema: upgradeBackup.sourceVersion, classifierRevision: LEGACY_CLASSIFIER_REVISION }), version);
    }).immediate();
  } catch (error) {
    database.prepare("UPDATE schema_migrations SET status='failed',error_message=? WHERE version=?")
      .run(error instanceof Error ? error.message : String(error), version);
    throw error;
  }
}
