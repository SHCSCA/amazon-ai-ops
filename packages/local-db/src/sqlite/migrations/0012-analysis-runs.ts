import Database from 'better-sqlite3';
import { ensureSchemaMigrationsTable } from './0001-store-authority';

export const ANALYSIS_RUNS_MIGRATION_VERSION = 12;
export const ANALYSIS_RUNS_MIGRATION_NAME = 'analysis-runs-v12';
export const ANALYSIS_RUNS_MIGRATION_CHECKSUM = 'analysis-runs-v12-20260903-01';

export const ANALYSIS_RUNS_TABLES = [
  'analysis_runs',
] as const;

type MigrationStatus = 'started' | 'applied' | 'failed';

interface AnalysisRunsMigrationManifest {
  version: number;
  name: string;
  checksum: string;
  startedAt: string;
  integrityCheck: string;
  prerequisiteVersion: number;
  tables: readonly string[];
}

export interface AnalysisRunsMigrationResult {
  version: number;
  name: string;
  status: MigrationStatus;
  startedAt: string;
  finishedAt?: string;
  createdTables: number;
  errorMessage?: string;
}

interface MigrationRow {
  checksum: string;
  status: MigrationStatus;
  manifest_json: string;
  result_json: string | null;
}

export class AnalysisRunsMigrationError extends Error {
  readonly version = ANALYSIS_RUNS_MIGRATION_VERSION;

  constructor(message: string) {
    super(message);
    this.name = 'AnalysisRunsMigrationError';
  }
}

/** Installs the analysis_runs table for tracking analysis run lifecycle and recommendations. */
export function runAnalysisRunsMigration(
  database: Database.Database,
): AnalysisRunsMigrationResult {
  ensureSchemaMigrationsTable(database);
  assertPrerequisites(database);

  const existing = readMigration(database);
  if (existing && existing.checksum !== ANALYSIS_RUNS_MIGRATION_CHECKSUM) {
    throw new AnalysisRunsMigrationError('Migration 12 checksum does not match recorded history.');
  }
  if (existing?.status === 'applied') {
    verifyAnalysisRunsSchema(database);
    return parseJson(existing.result_json, defaultResult('applied', '', ANALYSIS_RUNS_TABLES.length));
  }

  const integrityCheck = database.pragma('integrity_check', { simple: true }) as string;
  if (integrityCheck !== 'ok') {
    throw new AnalysisRunsMigrationError(`Source database integrity_check returned: ${integrityCheck}`);
  }

  const manifest: AnalysisRunsMigrationManifest = {
    version: ANALYSIS_RUNS_MIGRATION_VERSION,
    name: ANALYSIS_RUNS_MIGRATION_NAME,
    checksum: ANALYSIS_RUNS_MIGRATION_CHECKSUM,
    startedAt: new Date().toISOString(),
    integrityCheck,
    prerequisiteVersion: 11,
    tables: ANALYSIS_RUNS_TABLES,
  };

  const started = defaultResult('started', manifest.startedAt, 0);
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
    version: ANALYSIS_RUNS_MIGRATION_VERSION,
    name: ANALYSIS_RUNS_MIGRATION_NAME,
    checksum: ANALYSIS_RUNS_MIGRATION_CHECKSUM,
    startedAt: manifest.startedAt,
    manifestJson: JSON.stringify(manifest),
    resultJson: JSON.stringify(started),
  });

  try {
    return database.transaction(() => {
      installAnalysisRunsSchema(database);
      verifyAnalysisRunsSchema(database);
      const result: AnalysisRunsMigrationResult = {
        ...started,
        status: 'applied',
        finishedAt: new Date().toISOString(),
        createdTables: ANALYSIS_RUNS_TABLES.length,
      };
      database.prepare(`
        UPDATE schema_migrations
        SET status = 'applied', applied_at = @appliedAt,
            error_message = NULL, result_json = @resultJson
        WHERE version = @version
      `).run({
        version: ANALYSIS_RUNS_MIGRATION_VERSION,
        appliedAt: result.finishedAt,
        resultJson: JSON.stringify(result),
      });
      return result;
    }).immediate();
  } catch (error) {
    const failed: AnalysisRunsMigrationResult = {
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
      version: ANALYSIS_RUNS_MIGRATION_VERSION,
      errorMessage: failed.errorMessage,
      resultJson: JSON.stringify(failed),
    });
    if (error instanceof AnalysisRunsMigrationError) throw error;
    throw new AnalysisRunsMigrationError(failed.errorMessage ?? 'Migration 12 failed.');
  }
}

function installAnalysisRunsSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS analysis_runs (
      run_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      mission_id TEXT,
      
      -- 8/8 报告快照绑定（必需）
      report_snapshot_id TEXT NOT NULL,
      
      -- 分析运行状态
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'analyzing', 'completed', 'failed', 'blocked')),
      
      -- 分析结果统计
      recommendations_count INTEGER NOT NULL DEFAULT 0 CHECK (recommendations_count >= 0),
      blocked_reason TEXT,
      
      -- 时间戳
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      
      -- 分析元数据（JSON: 分析参数、AI 调用等）
      metadata TEXT,
      
      -- 外键约束
      UNIQUE(store_id, run_id),
      FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT,
      FOREIGN KEY (store_id, mission_id) REFERENCES missions(store_id, id) ON DELETE SET NULL
    );

    -- 索引：按 store 查询最近的运行
    CREATE INDEX IF NOT EXISTS idx_analysis_runs_store_status
      ON analysis_runs(store_id, status, updated_at DESC, run_id);

    -- 索引：按 mission 查询关联的运行
    CREATE INDEX IF NOT EXISTS idx_analysis_runs_mission
      ON analysis_runs(store_id, mission_id, created_at DESC)
      WHERE mission_id IS NOT NULL;
  `);
}

export function verifyAnalysisRunsSchema(database: Database.Database): void {
  assertPrerequisites(database);
  
  const foreignKeys = database.pragma('foreign_keys', { simple: true }) as number;
  if (foreignKeys !== 1) {
    throw new AnalysisRunsMigrationError('SQLite foreign_keys must be enabled for analysis_runs.');
  }

  const tables = new Set((database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all() as Array<{ name: string }>).map((row) => row.name));
  
  for (const table of ANALYSIS_RUNS_TABLES) {
    if (!tables.has(table)) {
      throw new AnalysisRunsMigrationError(`Required table is missing: ${table}.`);
    }
  }

  const columns = new Set((database.prepare('PRAGMA table_info(analysis_runs)').all() as Array<{ name: string }>)
    .map((row) => row.name));
  
  for (const column of [
    'run_id', 'store_id', 'mission_id', 'report_snapshot_id',
    'status', 'recommendations_count', 'blocked_reason',
    'created_at', 'updated_at', 'started_at', 'completed_at', 'metadata',
  ]) {
    if (!columns.has(column)) {
      throw new AnalysisRunsMigrationError(`analysis_runs column is missing: ${column}.`);
    }
  }

  const violations = database.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new AnalysisRunsMigrationError('analysis_runs schema foreign-key check failed.');
  }
}

function assertPrerequisites(database: Database.Database): void {
  const prerequisite = database.prepare(`
    SELECT status FROM schema_migrations WHERE version = 11
  `).get() as { status: string } | undefined;
  
  if (prerequisite?.status !== 'applied') {
    throw new AnalysisRunsMigrationError('Migration 11 must be applied before analysis_runs migration 12.');
  }

  for (const table of ['stores', 'missions']) {
    const exists = database.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(table);
    if (!exists) {
      throw new AnalysisRunsMigrationError(`Required prerequisite table is missing: ${table}.`);
    }
  }
}

function readMigration(database: Database.Database): MigrationRow | undefined {
  return database.prepare(`
    SELECT checksum, status, manifest_json, result_json
    FROM schema_migrations WHERE version = ?
  `).get(ANALYSIS_RUNS_MIGRATION_VERSION) as MigrationRow | undefined;
}

function defaultResult(
  status: MigrationStatus,
  startedAt: string,
  createdTables: number,
): AnalysisRunsMigrationResult {
  return {
    version: ANALYSIS_RUNS_MIGRATION_VERSION,
    name: ANALYSIS_RUNS_MIGRATION_NAME,
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
