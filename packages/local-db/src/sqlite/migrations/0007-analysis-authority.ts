import Database from 'better-sqlite3';
import { ensureSchemaMigrationsTable } from './0001-store-authority';

export const ANALYSIS_AUTHORITY_MIGRATION_VERSION = 7;
export const ANALYSIS_AUTHORITY_MIGRATION_NAME = 'analysis-authority-v7';
export const ANALYSIS_AUTHORITY_MIGRATION_CHECKSUM = 'analysis-authority-v7-20260722-03';

export const ANALYSIS_AUTHORITY_TABLES = [
  'analysis_evidence_packages',
  'analysis_action_batches',
  'verified_ad_entity_authority',
  'analysis_proposal_snapshots',
  'analysis_proposal_decision_links',
] as const;

type MigrationStatus = 'started' | 'applied' | 'failed';

interface MigrationRow {
  checksum: string;
  status: MigrationStatus;
  result_json: string | null;
}

export interface AnalysisAuthorityMigrationResult {
  version: number;
  name: string;
  status: MigrationStatus;
  startedAt: string;
  finishedAt?: string;
  createdTables: number;
  errorMessage?: string;
}

export class AnalysisAuthorityMigrationError extends Error {
  readonly version = ANALYSIS_AUTHORITY_MIGRATION_VERSION;

  constructor(message: string) {
    super(message);
    this.name = 'AnalysisAuthorityMigrationError';
  }
}

export function runAnalysisAuthorityMigration(
  database: Database.Database,
): AnalysisAuthorityMigrationResult {
  ensureSchemaMigrationsTable(database);
  assertPrerequisites(database);

  const existing = readMigration(database);
  if (existing && existing.checksum !== ANALYSIS_AUTHORITY_MIGRATION_CHECKSUM) {
    throw new AnalysisAuthorityMigrationError('Migration 7 checksum does not match recorded history.');
  }
  if (existing?.status === 'applied') {
    verifyAnalysisAuthoritySchema(database);
    return parseJson(existing.result_json, defaultResult('applied', '', ANALYSIS_AUTHORITY_TABLES.length));
  }

  const integrityCheck = database.pragma('integrity_check', { simple: true }) as string;
  if (integrityCheck !== 'ok') {
    throw new AnalysisAuthorityMigrationError(`Source database integrity_check returned: ${integrityCheck}`);
  }
  const startedAt = new Date().toISOString();
  const manifest = {
    version: ANALYSIS_AUTHORITY_MIGRATION_VERSION,
    name: ANALYSIS_AUTHORITY_MIGRATION_NAME,
    checksum: ANALYSIS_AUTHORITY_MIGRATION_CHECKSUM,
    prerequisiteVersion: 6,
    integrityCheck,
    tables: ANALYSIS_AUTHORITY_TABLES,
    startedAt,
  };
  const started = defaultResult('started', startedAt, 0);
  database.prepare(`
    INSERT INTO schema_migrations (
      version, name, checksum, status, started_at, applied_at,
      error_message, manifest_json, result_json
    ) VALUES (
      @version, @name, @checksum, 'started', @startedAt, NULL,
      NULL, @manifestJson, @resultJson
    )
    ON CONFLICT(version) DO UPDATE SET
      name = excluded.name,
      checksum = excluded.checksum,
      status = 'started',
      started_at = excluded.started_at,
      applied_at = NULL,
      error_message = NULL,
      manifest_json = excluded.manifest_json,
      result_json = excluded.result_json
  `).run({
    version: ANALYSIS_AUTHORITY_MIGRATION_VERSION,
    name: ANALYSIS_AUTHORITY_MIGRATION_NAME,
    checksum: ANALYSIS_AUTHORITY_MIGRATION_CHECKSUM,
    startedAt,
    manifestJson: JSON.stringify(manifest),
    resultJson: JSON.stringify(started),
  });

  try {
    return database.transaction(() => {
      installAnalysisAuthoritySchema(database);
      verifyAnalysisAuthoritySchema(database);
      const result: AnalysisAuthorityMigrationResult = {
        ...started,
        status: 'applied',
        finishedAt: new Date().toISOString(),
        createdTables: ANALYSIS_AUTHORITY_TABLES.length,
      };
      database.prepare(`
        UPDATE schema_migrations
        SET status = 'applied', applied_at = @appliedAt,
            error_message = NULL, result_json = @resultJson
        WHERE version = @version
      `).run({
        version: ANALYSIS_AUTHORITY_MIGRATION_VERSION,
        appliedAt: result.finishedAt,
        resultJson: JSON.stringify(result),
      });
      return result;
    }).immediate();
  } catch (error) {
    const failed: AnalysisAuthorityMigrationResult = {
      ...started,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      createdTables: 0,
      errorMessage: errorMessage(error),
    };
    database.prepare(`
      UPDATE schema_migrations
      SET status = 'failed', applied_at = NULL,
          error_message = @errorMessage, result_json = @resultJson
      WHERE version = @version
    `).run({
      version: ANALYSIS_AUTHORITY_MIGRATION_VERSION,
      errorMessage: failed.errorMessage,
      resultJson: JSON.stringify(failed),
    });
    if (error instanceof AnalysisAuthorityMigrationError) throw error;
    throw new AnalysisAuthorityMigrationError(failed.errorMessage ?? 'Migration 7 failed.');
  }
}

function installAnalysisAuthoritySchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS analysis_evidence_packages (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      marketplace TEXT NOT NULL CHECK (marketplace = 'US'),
      currency TEXT NOT NULL CHECK (currency = 'USD'),
      mission_id TEXT NOT NULL,
      data_batch_id TEXT NOT NULL,
      import_run_id TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      asin TEXT,
      report_types_json TEXT NOT NULL CHECK (json_valid(report_types_json)),
      sources_json TEXT NOT NULL CHECK (json_valid(sources_json)),
      metric_row_count INTEGER NOT NULL CHECK (metric_row_count >= 0),
      reconciliation_hash TEXT NOT NULL CHECK (length(reconciliation_hash) = 64),
      rule_revision TEXT NOT NULL CHECK (length(rule_revision) = 64),
      model_revision TEXT NOT NULL,
      package_hash TEXT NOT NULL CHECK (length(package_hash) = 64),
      imported_at TEXT NOT NULL,
      fresh_until TEXT NOT NULL,
      sealed_at TEXT NOT NULL,
      created_session_generation INTEGER NOT NULL CHECK (created_session_generation >= 0),
      UNIQUE(store_id, id),
      UNIQUE(store_id, package_hash),
      FOREIGN KEY (store_id, mission_id) REFERENCES missions(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, data_batch_id)
        REFERENCES lingxing_report_batches(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, import_run_id)
        REFERENCES report_import_runs(store_id, run_id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_analysis_evidence_store_mission
      ON analysis_evidence_packages(store_id, mission_id, sealed_at DESC, id);
    CREATE INDEX IF NOT EXISTS idx_analysis_evidence_store_batch
      ON analysis_evidence_packages(store_id, data_batch_id, sealed_at DESC, id);

    CREATE TABLE IF NOT EXISTS analysis_action_batches (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      mission_revision INTEGER NOT NULL CHECK (mission_revision >= 1),
      evidence_package_id TEXT NOT NULL,
      rule_revision TEXT NOT NULL CHECK (length(rule_revision) = 64),
      model_revision TEXT NOT NULL,
      action_revision INTEGER NOT NULL CHECK (action_revision >= 1),
      created_at TEXT NOT NULL,
      created_session_generation INTEGER NOT NULL CHECK (created_session_generation >= 0),
      UNIQUE(store_id, id),
      UNIQUE(store_id, mission_id, action_revision),
      FOREIGN KEY (store_id, mission_id) REFERENCES missions(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, evidence_package_id)
        REFERENCES analysis_evidence_packages(store_id, id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS verified_ad_entity_authority (
      authority_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      ad_entity_id TEXT NOT NULL,
      entity_revision INTEGER NOT NULL CHECK (entity_revision >= 1),
      entity_type TEXT NOT NULL CHECK (entity_type IN ('keyword', 'auto_targeting', 'product_targeting')),
      entity_name TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      ad_group_name TEXT NOT NULL,
      evidence_package_id TEXT NOT NULL,
      source_report_type TEXT NOT NULL CHECK (source_report_type IN ('keyword', 'auto_targeting', 'product_targeting')),
      source_file_hash TEXT NOT NULL CHECK (length(source_file_hash) = 64),
      source_row INTEGER NOT NULL CHECK (source_row >= 1),
      identity_source TEXT NOT NULL CHECK (identity_source IN ('ads_ui', 'ads_api')),
      proof_sha256 TEXT NOT NULL CHECK (length(proof_sha256) = 64),
      verified_by TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(store_id, authority_id),
      UNIQUE(store_id, ad_entity_id, entity_revision),
      FOREIGN KEY (store_id, evidence_package_id)
        REFERENCES analysis_evidence_packages(store_id, id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_verified_ad_entity_current
      ON verified_ad_entity_authority(store_id, ad_entity_id, entity_revision DESC);
    CREATE INDEX IF NOT EXISTS idx_verified_ad_entity_scope
      ON verified_ad_entity_authority(store_id, campaign_name, ad_group_name, entity_type, entity_name);

    CREATE TABLE IF NOT EXISTS analysis_proposal_snapshots (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      marketplace TEXT NOT NULL CHECK (marketplace = 'US'),
      currency TEXT NOT NULL CHECK (currency = 'USD'),
      mission_id TEXT NOT NULL,
      mission_revision INTEGER NOT NULL CHECK (mission_revision >= 1),
      evidence_package_id TEXT NOT NULL,
      evidence_package_hash TEXT NOT NULL CHECK (length(evidence_package_hash) = 64),
      data_batch_id TEXT NOT NULL,
      policy_version_id TEXT NOT NULL,
      policy_revision INTEGER NOT NULL CHECK (policy_revision >= 1),
      rule_revision TEXT NOT NULL CHECK (length(rule_revision) = 64),
      model_revision TEXT NOT NULL,
      action_batch_id TEXT NOT NULL,
      action_revision INTEGER NOT NULL CHECK (action_revision >= 1),
      legacy_recommendation_id INTEGER NOT NULL CHECK (legacy_recommendation_id >= 1),
      action_type TEXT NOT NULL CHECK (action_type = 'set_keyword_bid'),
      entity_type TEXT NOT NULL CHECK (entity_type = 'keyword'),
      entity_name TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      ad_group_name TEXT NOT NULL,
      ad_entity_authority_id TEXT,
      ad_entity_id TEXT,
      ad_entity_revision INTEGER CHECK (ad_entity_revision IS NULL OR ad_entity_revision >= 1),
      current_bid_cents INTEGER NOT NULL CHECK (current_bid_cents >= 1),
      proposed_bid_cents INTEGER NOT NULL CHECK (proposed_bid_cents >= 1),
      change_pct REAL NOT NULL CHECK (change_pct < 0),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      source TEXT NOT NULL CHECK (source IN ('rule', 'rule_ai', 'ai', 'rule_fallback')),
      explanation TEXT NOT NULL,
      authorization_json TEXT NOT NULL CHECK (json_valid(authorization_json)),
      valid_until TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_session_generation INTEGER NOT NULL CHECK (created_session_generation >= 0),
      UNIQUE(store_id, id),
      UNIQUE(store_id, action_batch_id, legacy_recommendation_id),
      FOREIGN KEY (store_id, mission_id) REFERENCES missions(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, evidence_package_id)
        REFERENCES analysis_evidence_packages(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, policy_version_id)
        REFERENCES policy_versions(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, action_batch_id)
        REFERENCES analysis_action_batches(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, ad_entity_authority_id)
        REFERENCES verified_ad_entity_authority(store_id, authority_id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_analysis_proposals_store_mission
      ON analysis_proposal_snapshots(store_id, mission_id, action_revision DESC, created_at DESC, id);
    CREATE INDEX IF NOT EXISTS idx_analysis_proposals_store_entity
      ON analysis_proposal_snapshots(store_id, ad_entity_id, ad_entity_revision DESC);

    CREATE TABLE IF NOT EXISTS analysis_proposal_decision_links (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      decision_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(store_id, id),
      UNIQUE(store_id, proposal_id),
      UNIQUE(store_id, decision_id),
      FOREIGN KEY (store_id, proposal_id)
        REFERENCES analysis_proposal_snapshots(store_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, decision_id) REFERENCES decisions(store_id, id) ON DELETE RESTRICT
    );
  `);

  for (const table of ANALYSIS_AUTHORITY_TABLES) {
    database.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_${table}_append_only_update
      BEFORE UPDATE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS trg_${table}_append_only_delete
      BEFORE DELETE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} is append-only');
      END;
    `);
  }
}

export function verifyAnalysisAuthoritySchema(database: Database.Database): void {
  assertPrerequisites(database);
  if ((database.pragma('foreign_keys', { simple: true }) as number) !== 1) {
    throw new AnalysisAuthorityMigrationError('SQLite foreign_keys must be enabled for analysis authority.');
  }
  const tables = new Set((database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all() as Array<{ name: string }>).map((row) => row.name));
  const triggers = new Set((database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'trigger'
  `).all() as Array<{ name: string }>).map((row) => row.name));
  for (const table of ANALYSIS_AUTHORITY_TABLES) {
    if (!tables.has(table)) throw new AnalysisAuthorityMigrationError(`Required analysis table is missing: ${table}.`);
    for (const suffix of ['update', 'delete']) {
      const trigger = `trg_${table}_append_only_${suffix}`;
      if (!triggers.has(trigger)) throw new AnalysisAuthorityMigrationError(`Required analysis trigger is missing: ${trigger}.`);
    }
  }
  const evidenceColumns = new Set((database.pragma('table_info(analysis_evidence_packages)') as Array<{ name: string }>)
    .map((row) => row.name));
  for (const column of ['store_id', 'mission_id', 'data_batch_id', 'package_hash', 'fresh_until', 'rule_revision']) {
    if (!evidenceColumns.has(column)) {
      throw new AnalysisAuthorityMigrationError(`Analysis evidence authority column is missing: ${column}.`);
    }
  }
  const proposalSql = String((database.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'analysis_proposal_snapshots'
  `).get() as { sql?: string } | undefined)?.sql ?? '');
  if (!/CHECK\s*\(action_type\s*=\s*'set_keyword_bid'\)/i.test(proposalSql)) {
    throw new AnalysisAuthorityMigrationError('Analysis proposal V1 action allowlist is missing.');
  }
  if (!/CHECK\s*\(entity_type\s*=\s*'keyword'\)/i.test(proposalSql)) {
    throw new AnalysisAuthorityMigrationError('Analysis proposal V1 entity allowlist is missing.');
  }
  const proposalColumns = new Set((database.pragma('table_info(analysis_proposal_snapshots)') as Array<{ name: string }>)
    .map((row) => row.name));
  if (!proposalColumns.has('mission_revision')) {
    throw new AnalysisAuthorityMigrationError('Analysis proposal mission revision authority is missing.');
  }
  const actionBatchColumns = new Set((database.pragma('table_info(analysis_action_batches)') as Array<{ name: string }>)
    .map((row) => row.name));
  for (const column of ['mission_revision', 'rule_revision', 'model_revision']) {
    if (!actionBatchColumns.has(column)) {
      throw new AnalysisAuthorityMigrationError(`Analysis action batch authority column is missing: ${column}.`);
    }
  }
  const violations = database.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) throw new AnalysisAuthorityMigrationError('Analysis authority foreign-key check failed.');
}

function assertPrerequisites(database: Database.Database): void {
  const prerequisite = database.prepare(`
    SELECT status FROM schema_migrations WHERE version = 6
  `).get() as { status: string } | undefined;
  if (prerequisite?.status !== 'applied') {
    throw new AnalysisAuthorityMigrationError('Migration 6 must be applied before analysis authority migration 7.');
  }
  for (const table of [
    'stores', 'missions', 'policy_versions', 'decisions',
    'lingxing_report_batches', 'report_import_runs', 'report_import_file_snapshots',
  ]) {
    const exists = database.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(table);
    if (!exists) throw new AnalysisAuthorityMigrationError(`Required prerequisite table is missing: ${table}.`);
  }
}

function readMigration(database: Database.Database): MigrationRow | undefined {
  return database.prepare(`
    SELECT checksum, status, result_json FROM schema_migrations WHERE version = ?
  `).get(ANALYSIS_AUTHORITY_MIGRATION_VERSION) as MigrationRow | undefined;
}

function defaultResult(
  status: MigrationStatus,
  startedAt: string,
  createdTables: number,
): AnalysisAuthorityMigrationResult {
  return {
    version: ANALYSIS_AUTHORITY_MIGRATION_VERSION,
    name: ANALYSIS_AUTHORITY_MIGRATION_NAME,
    status,
    startedAt,
    createdTables,
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
