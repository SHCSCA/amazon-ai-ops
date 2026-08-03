import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import { ensureSchemaMigrationsTable } from './0001-store-authority';
import { prepareUpgradeBackup } from './upgrade-backup';
import type { UpgradeBackupManifest } from './types';

export const COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION = 10;
export const COLLECTION_RESUME_AUTHORITY_MIGRATION_NAME = 'collection-resume-authority-v10';
export const COLLECTION_RESUME_AUTHORITY_MIGRATION_CHECKSUM = 'collection-resume-authority-v10-20260803-01';

export const COLLECTION_RESUME_AUTHORITY_TABLES = [
  'report_import_metric_evidence',
  'lingxing_collection_resume_attempts',
  'lingxing_collection_resume_active_claims',
  'lingxing_collection_resume_events',
] as const;

const APPEND_ONLY_TABLES = [
  'report_import_metric_evidence',
  'lingxing_collection_resume_attempts',
  'lingxing_collection_resume_events',
] as const;

const BINDING_TRIGGER_SQL: Readonly<Record<string, string>> = {
  trg_report_import_metric_evidence_run_batch_insert: `
    CREATE TRIGGER trg_report_import_metric_evidence_run_batch_insert
    BEFORE INSERT ON report_import_metric_evidence
    WHEN NOT EXISTS (
      SELECT 1 FROM report_import_runs
      WHERE store_id = NEW.store_id
        AND run_id = NEW.run_id
        AND batch_id = NEW.batch_id
        AND status = 'completed'
    )
    BEGIN
      SELECT RAISE(ABORT, 'metric evidence must bind the completed import run batch');
    END
  `,
  trg_lingxing_collection_resume_active_claim_binding_update: `
    CREATE TRIGGER trg_lingxing_collection_resume_active_claim_binding_update
    BEFORE UPDATE ON lingxing_collection_resume_active_claims
    WHEN OLD.store_id <> NEW.store_id
      OR OLD.job_id <> NEW.job_id
      OR OLD.request_id <> NEW.request_id
      OR OLD.attempt_id <> NEW.attempt_id
      OR OLD.claimed_at <> NEW.claimed_at
    BEGIN
      SELECT RAISE(ABORT, 'resume active claim identity is immutable');
    END
  `,
  trg_lingxing_collection_resume_attempt_job_binding_insert: `
    CREATE TRIGGER trg_lingxing_collection_resume_attempt_job_binding_insert
    BEFORE INSERT ON lingxing_collection_resume_attempts
    WHEN NOT EXISTS (
      SELECT 1 FROM lingxing_collection_jobs
      WHERE store_id = NEW.store_id
        AND job_id = NEW.job_id
        AND request_id = NEW.request_id
        AND updated_at = NEW.base_job_updated_at
        AND session_generation = NEW.durable_session_generation
    )
    BEGIN
      SELECT RAISE(ABORT, 'resume attempt must bind the exact durable job authority');
    END
  `,
  trg_lingxing_collection_resume_active_claim_attempt_insert: `
    CREATE TRIGGER trg_lingxing_collection_resume_active_claim_attempt_insert
    BEFORE INSERT ON lingxing_collection_resume_active_claims
    WHEN NOT EXISTS (
      SELECT 1 FROM lingxing_collection_resume_attempts
      WHERE store_id = NEW.store_id
        AND attempt_id = NEW.attempt_id
        AND job_id = NEW.job_id
        AND request_id = NEW.request_id
        AND claimed_at = NEW.claimed_at
    )
    BEGIN
      SELECT RAISE(ABORT, 'resume active claim must bind its exact attempt');
    END
  `,
  trg_lingxing_collection_resume_event_attempt_insert: `
    CREATE TRIGGER trg_lingxing_collection_resume_event_attempt_insert
    BEFORE INSERT ON lingxing_collection_resume_events
    WHEN NOT EXISTS (
      SELECT 1 FROM lingxing_collection_resume_attempts
      WHERE store_id = NEW.store_id
        AND attempt_id = NEW.attempt_id
        AND job_id = NEW.job_id
        AND request_id = NEW.request_id
        AND base_job_updated_at = NEW.base_job_updated_at
        AND base_authority_proof_sha256 = NEW.base_authority_proof_sha256
    )
    BEGIN
      SELECT RAISE(ABORT, 'resume event must bind its exact attempt');
    END
  `,
};

type MigrationStatus = 'started' | 'applied' | 'failed';

interface MigrationRow {
  checksum: string;
  status: MigrationStatus;
  result_json: string | null;
}

export interface CollectionResumeAuthorityMigrationResult {
  version: number;
  name: string;
  status: MigrationStatus;
  startedAt: string;
  finishedAt?: string;
  createdTables: number;
  backfilledMetricEvidence: number;
  errorMessage?: string;
}

export class CollectionResumeAuthorityMigrationError extends Error {
  readonly version = COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION;

  constructor(message: string) {
    super(message);
    this.name = 'CollectionResumeAuthorityMigrationError';
  }
}

export function runCollectionResumeAuthorityMigration(
  database: Database.Database,
  preparedUpgradeBackup?: UpgradeBackupManifest,
): CollectionResumeAuthorityMigrationResult {
  ensureSchemaMigrationsTable(database);
  assertPrerequisite(database);
  const existing = database.prepare(`
    SELECT checksum, status, result_json
    FROM schema_migrations WHERE version = ?
  `).get(COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION) as MigrationRow | undefined;
  if (existing && existing.checksum !== COLLECTION_RESUME_AUTHORITY_MIGRATION_CHECKSUM) {
    throw new CollectionResumeAuthorityMigrationError(
      'Migration 10 checksum does not match recorded history.',
    );
  }
  if (existing?.status === 'applied') {
    verifyCollectionResumeAuthoritySchema(database);
    return parseResult(existing.result_json);
  }

  const integrityCheck = database.pragma('integrity_check', { simple: true }) as string;
  if (integrityCheck !== 'ok') {
    throw new CollectionResumeAuthorityMigrationError(
      `Source database integrity_check returned: ${integrityCheck}`,
    );
  }
  const startedAt = new Date().toISOString();
  const started = defaultResult('started', startedAt);
  const upgradeBackup = preparedUpgradeBackup ?? prepareUpgradeBackup(database, {
    targetVersion: COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION,
    targetName: COLLECTION_RESUME_AUTHORITY_MIGRATION_NAME,
    targetChecksum: COLLECTION_RESUME_AUTHORITY_MIGRATION_CHECKSUM,
  });
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
    version: COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION,
    name: COLLECTION_RESUME_AUTHORITY_MIGRATION_NAME,
    checksum: COLLECTION_RESUME_AUTHORITY_MIGRATION_CHECKSUM,
    startedAt,
    manifestJson: JSON.stringify({
      version: COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION,
      name: COLLECTION_RESUME_AUTHORITY_MIGRATION_NAME,
      checksum: COLLECTION_RESUME_AUTHORITY_MIGRATION_CHECKSUM,
      prerequisiteVersion: 9,
      integrityCheck,
      tables: COLLECTION_RESUME_AUTHORITY_TABLES,
      appendOnlyTables: APPEND_ONLY_TABLES,
      upgradeBackup,
      startedAt,
    }),
    resultJson: JSON.stringify(started),
  });

  try {
    return database.transaction(() => {
      createSchema(database);
      const backfilledMetricEvidence = backfillMetricEvidence(database);
      verifyCollectionResumeAuthoritySchema(database);
      const result: CollectionResumeAuthorityMigrationResult = {
        ...started,
        status: 'applied',
        finishedAt: new Date().toISOString(),
        createdTables: COLLECTION_RESUME_AUTHORITY_TABLES.length,
        backfilledMetricEvidence,
      };
      database.prepare(`
        UPDATE schema_migrations
        SET status = 'applied', applied_at = @appliedAt,
            error_message = NULL, result_json = @resultJson
        WHERE version = @version
      `).run({
        version: COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION,
        appliedAt: result.finishedAt,
        resultJson: JSON.stringify(result),
      });
      return result;
    }).immediate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed: CollectionResumeAuthorityMigrationResult = {
      ...started,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      errorMessage: message,
    };
    database.prepare(`
      UPDATE schema_migrations
      SET status = 'failed', applied_at = NULL,
          error_message = @errorMessage, result_json = @resultJson
      WHERE version = @version
    `).run({
      version: COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION,
      errorMessage: message,
      resultJson: JSON.stringify(failed),
    });
    if (error instanceof CollectionResumeAuthorityMigrationError) throw error;
    throw new CollectionResumeAuthorityMigrationError(message);
  }
}

export function verifyCollectionResumeAuthoritySchema(database: Database.Database): void {
  for (const table of COLLECTION_RESUME_AUTHORITY_TABLES) {
    const exists = database.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(table);
    if (!exists) {
      throw new CollectionResumeAuthorityMigrationError(`Migration 10 table ${table} is missing.`);
    }
  }
  for (const table of APPEND_ONLY_TABLES) {
    for (const operation of ['update', 'delete']) {
      const trigger = `trg_${table}_immutable_${operation}`;
      const row = database.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?
      `).get(trigger) as { sql: string | null } | undefined;
      const expectedSql = canonicalTriggerSql(`
        CREATE TRIGGER ${trigger}
        BEFORE ${operation.toUpperCase()} ON ${table}
        BEGIN
          SELECT RAISE(ABORT, '${table} is append-only');
        END
      `);
      if (canonicalTriggerSql(row?.sql ?? '') !== expectedSql) {
        throw new CollectionResumeAuthorityMigrationError(
          `Migration 10 append-only trigger ${trigger} is missing or invalid.`,
        );
      }
    }
  }
  const exactColumns: Record<string, readonly [string, string, number, number][]> = {
    report_import_metric_evidence: [
      ['store_id', 'TEXT', 1, 1], ['run_id', 'TEXT', 1, 2],
      ['batch_id', 'TEXT', 1, 0], ['row_count', 'INTEGER', 1, 0],
      ['payload_sha256', 'TEXT', 1, 0], ['created_at', 'TEXT', 1, 0],
    ],
    lingxing_collection_resume_attempts: [
      ['store_id', 'TEXT', 1, 1], ['attempt_id', 'TEXT', 1, 2],
      ['job_id', 'TEXT', 1, 0], ['request_id', 'TEXT', 1, 0],
      ['base_job_updated_at', 'TEXT', 1, 0],
      ['base_authority_proof_sha256', 'TEXT', 1, 0],
      ['durable_session_generation', 'INTEGER', 1, 0],
      ['execution_session_generation', 'INTEGER', 1, 0],
      ['execution_context_sha256', 'TEXT', 1, 0], ['claimed_at', 'TEXT', 1, 0],
    ],
    lingxing_collection_resume_active_claims: [
      ['store_id', 'TEXT', 1, 1], ['job_id', 'TEXT', 1, 2],
      ['request_id', 'TEXT', 1, 0], ['attempt_id', 'TEXT', 1, 0],
      ['claim_token_sha256', 'TEXT', 1, 0],
      ['expected_job_updated_at', 'TEXT', 1, 0],
      ['expected_authority_proof_sha256', 'TEXT', 1, 0],
      ['version', 'INTEGER', 1, 0], ['claimed_at', 'TEXT', 1, 0],
      ['updated_at', 'TEXT', 1, 0],
    ],
    lingxing_collection_resume_events: [
      ['store_id', 'TEXT', 1, 1], ['event_id', 'TEXT', 1, 2],
      ['attempt_id', 'TEXT', 1, 0], ['job_id', 'TEXT', 1, 0],
      ['request_id', 'TEXT', 1, 0], ['event_kind', 'TEXT', 1, 0],
      ['consumed_claim_token_sha256', 'TEXT', 0, 0],
      ['next_claim_token_sha256', 'TEXT', 0, 0],
      ['base_job_updated_at', 'TEXT', 1, 0],
      ['final_job_updated_at', 'TEXT', 1, 0],
      ['base_authority_proof_sha256', 'TEXT', 1, 0],
      ['final_authority_proof_sha256', 'TEXT', 1, 0],
      ['detail', 'TEXT', 0, 0], ['created_at', 'TEXT', 1, 0],
    ],
  };
  for (const table of COLLECTION_RESUME_AUTHORITY_TABLES) {
    const columns = database.pragma(`table_info('${table}')`) as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    const actual = columns.map((column) => [
      column.name,
      String(column.type).toUpperCase(),
      column.notnull,
      column.pk,
    ]);
    if (stableJson(actual) !== stableJson(exactColumns[table])) {
      throw new CollectionResumeAuthorityMigrationError(
        `Migration 10 table ${table} has an invalid exact column contract.`,
      );
    }
  }
  const exactIndexes: Record<string, {
    table: string;
    unique: number;
    partial: number;
    columns: readonly [string, number][];
  }> = {
    idx_report_import_metric_evidence_batch: {
      table: 'report_import_metric_evidence', unique: 0, partial: 0,
      columns: [['store_id', 0], ['batch_id', 0], ['run_id', 0]],
    },
    idx_lingxing_collection_resume_attempt_job: {
      table: 'lingxing_collection_resume_attempts', unique: 0, partial: 0,
      columns: [['store_id', 0], ['job_id', 0], ['request_id', 0], ['claimed_at', 0], ['attempt_id', 0]],
    },
    idx_lingxing_collection_resume_active_token: {
      table: 'lingxing_collection_resume_active_claims', unique: 1, partial: 0,
      columns: [['store_id', 0], ['claim_token_sha256', 0]],
    },
    idx_lingxing_collection_resume_event_job: {
      table: 'lingxing_collection_resume_events', unique: 0, partial: 0,
      columns: [['store_id', 0], ['job_id', 0], ['request_id', 0], ['created_at', 1], ['event_id', 1]],
    },
    idx_lingxing_collection_resume_terminal_kind: {
      table: 'lingxing_collection_resume_events', unique: 1, partial: 1,
      columns: [['store_id', 0], ['attempt_id', 0], ['event_kind', 0]],
    },
    idx_lingxing_collection_resume_consumed_token: {
      table: 'lingxing_collection_resume_events', unique: 1, partial: 1,
      columns: [['store_id', 0], ['consumed_claim_token_sha256', 0]],
    },
  };
  for (const [index, expected] of Object.entries(exactIndexes)) {
    const listed = (database.pragma(`index_list('${expected.table}')`) as Array<{
      name: string;
      unique: number;
      partial: number;
    }>).find((candidate) => candidate.name === index);
    const columns = (database.pragma(`index_xinfo('${index}')`) as Array<{
      name: string | null;
      key: number;
      desc: number;
      seqno: number;
    }>).filter((column) => column.key === 1)
      .sort((left, right) => left.seqno - right.seqno)
      .map((column) => [column.name, column.desc]);
    if (!listed
      || listed.unique !== expected.unique
      || listed.partial !== expected.partial
      || stableJson(columns) !== stableJson(expected.columns)) {
      throw new CollectionResumeAuthorityMigrationError(
        `Migration 10 index ${index} has an invalid exact contract.`,
      );
    }
  }
  for (const [trigger, expectedSql] of Object.entries(BINDING_TRIGGER_SQL)) {
    const row = database.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?
    `).get(trigger) as { sql: string | null } | undefined;
    if (canonicalTriggerSql(row?.sql ?? '') !== canonicalTriggerSql(expectedSql)) {
      throw new CollectionResumeAuthorityMigrationError(
        `Migration 10 binding trigger ${trigger} is missing or invalid.`,
      );
    }
  }
  const exactForeignKeys: Record<string, readonly string[]> = {
    report_import_metric_evidence: [
      'lingxing_report_batches|store_id->store_id,batch_id->id',
      'report_import_runs|store_id->store_id,run_id->run_id',
    ],
    lingxing_collection_resume_attempts: [
      'lingxing_collection_jobs|store_id->store_id,job_id->job_id',
    ],
    lingxing_collection_resume_active_claims: [
      'lingxing_collection_jobs|store_id->store_id,job_id->job_id',
      'lingxing_collection_resume_attempts|store_id->store_id,attempt_id->attempt_id',
    ],
    lingxing_collection_resume_events: [
      'lingxing_collection_jobs|store_id->store_id,job_id->job_id',
      'lingxing_collection_resume_attempts|store_id->store_id,attempt_id->attempt_id',
    ],
  };
  for (const table of COLLECTION_RESUME_AUTHORITY_TABLES) {
    const foreignKeys = database.pragma(`foreign_key_list('${table}')`) as Array<{
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
    }>;
    const groups = new Map<number, typeof foreignKeys>();
    for (const foreignKey of foreignKeys) {
      const group = groups.get(foreignKey.id) ?? [];
      group.push(foreignKey);
      groups.set(foreignKey.id, group);
    }
    const actual = [...groups.values()].map((group) => {
      const ordered = [...group].sort((left, right) => left.seq - right.seq);
      return `${ordered[0].table}|${ordered.map((row) => `${row.from}->${row.to}`).join(',')}`;
    }).sort();
    if (stableJson(actual) !== stableJson([...exactForeignKeys[table]].sort())) {
      throw new CollectionResumeAuthorityMigrationError(
        `Migration 10 table ${table} has an invalid exact foreign-key contract.`,
      );
    }
  }
  const foreignKeyCheck = database.pragma('foreign_key_check') as unknown[];
  if (foreignKeyCheck.length > 0) {
    throw new CollectionResumeAuthorityMigrationError(
      'Migration 10 foreign_key_check found authority violations.',
    );
  }
}

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS report_import_metric_evidence (
      store_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      row_count INTEGER NOT NULL CHECK (row_count >= 0),
      payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
      created_at TEXT NOT NULL,
      PRIMARY KEY (store_id, run_id),
      FOREIGN KEY (store_id, run_id)
        REFERENCES report_import_runs(store_id, run_id),
      FOREIGN KEY (store_id, batch_id)
        REFERENCES lingxing_report_batches(store_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_report_import_metric_evidence_batch
      ON report_import_metric_evidence(store_id, batch_id, run_id);

    CREATE TABLE IF NOT EXISTS lingxing_collection_resume_attempts (
      store_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      base_job_updated_at TEXT NOT NULL,
      base_authority_proof_sha256 TEXT NOT NULL CHECK (length(base_authority_proof_sha256) = 64),
      durable_session_generation INTEGER NOT NULL CHECK (durable_session_generation >= 0),
      execution_session_generation INTEGER NOT NULL CHECK (
        execution_session_generation >= durable_session_generation
      ),
      execution_context_sha256 TEXT NOT NULL CHECK (length(execution_context_sha256) = 64),
      claimed_at TEXT NOT NULL,
      PRIMARY KEY (store_id, attempt_id),
      FOREIGN KEY (store_id, job_id)
        REFERENCES lingxing_collection_jobs(store_id, job_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lingxing_collection_resume_attempt_job
      ON lingxing_collection_resume_attempts(store_id, job_id, request_id, claimed_at, attempt_id);
    CREATE TABLE IF NOT EXISTS lingxing_collection_resume_active_claims (
      store_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      claim_token_sha256 TEXT NOT NULL CHECK (length(claim_token_sha256) = 64),
      expected_job_updated_at TEXT NOT NULL,
      expected_authority_proof_sha256 TEXT NOT NULL CHECK (length(expected_authority_proof_sha256) = 64),
      version INTEGER NOT NULL CHECK (version >= 1),
      claimed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (store_id, job_id),
      UNIQUE (store_id, attempt_id),
      FOREIGN KEY (store_id, attempt_id)
        REFERENCES lingxing_collection_resume_attempts(store_id, attempt_id),
      FOREIGN KEY (store_id, job_id)
        REFERENCES lingxing_collection_jobs(store_id, job_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lingxing_collection_resume_active_token
      ON lingxing_collection_resume_active_claims(store_id, claim_token_sha256);

    CREATE TABLE IF NOT EXISTS lingxing_collection_resume_events (
      store_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      event_kind TEXT NOT NULL CHECK (event_kind IN (
        'claimed', 'progress', 'succeeded', 'failed', 'interrupted'
      )),
      consumed_claim_token_sha256 TEXT,
      next_claim_token_sha256 TEXT,
      base_job_updated_at TEXT NOT NULL,
      final_job_updated_at TEXT NOT NULL,
      base_authority_proof_sha256 TEXT NOT NULL CHECK (length(base_authority_proof_sha256) = 64),
      final_authority_proof_sha256 TEXT NOT NULL CHECK (length(final_authority_proof_sha256) = 64),
      detail TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (store_id, event_id),
      FOREIGN KEY (store_id, attempt_id)
        REFERENCES lingxing_collection_resume_attempts(store_id, attempt_id),
      FOREIGN KEY (store_id, job_id)
        REFERENCES lingxing_collection_jobs(store_id, job_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lingxing_collection_resume_event_job
      ON lingxing_collection_resume_events(
        store_id, job_id, request_id, created_at DESC, event_id DESC
      );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lingxing_collection_resume_terminal_kind
      ON lingxing_collection_resume_events(store_id, attempt_id, event_kind)
      WHERE event_kind IN ('succeeded', 'failed', 'interrupted');
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lingxing_collection_resume_consumed_token
      ON lingxing_collection_resume_events(store_id, consumed_claim_token_sha256)
      WHERE consumed_claim_token_sha256 IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS trg_report_import_metric_evidence_run_batch_insert
    BEFORE INSERT ON report_import_metric_evidence
    WHEN NOT EXISTS (
      SELECT 1 FROM report_import_runs
      WHERE store_id = NEW.store_id
        AND run_id = NEW.run_id
        AND batch_id = NEW.batch_id
        AND status = 'completed'
    )
    BEGIN
      SELECT RAISE(ABORT, 'metric evidence must bind the completed import run batch');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_lingxing_collection_resume_active_claim_binding_update
    BEFORE UPDATE ON lingxing_collection_resume_active_claims
    WHEN OLD.store_id <> NEW.store_id
      OR OLD.job_id <> NEW.job_id
      OR OLD.request_id <> NEW.request_id
      OR OLD.attempt_id <> NEW.attempt_id
      OR OLD.claimed_at <> NEW.claimed_at
    BEGIN
      SELECT RAISE(ABORT, 'resume active claim identity is immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_lingxing_collection_resume_attempt_job_binding_insert
    BEFORE INSERT ON lingxing_collection_resume_attempts
    WHEN NOT EXISTS (
      SELECT 1 FROM lingxing_collection_jobs
      WHERE store_id = NEW.store_id
        AND job_id = NEW.job_id
        AND request_id = NEW.request_id
        AND updated_at = NEW.base_job_updated_at
        AND session_generation = NEW.durable_session_generation
    )
    BEGIN
      SELECT RAISE(ABORT, 'resume attempt must bind the exact durable job authority');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_lingxing_collection_resume_active_claim_attempt_insert
    BEFORE INSERT ON lingxing_collection_resume_active_claims
    WHEN NOT EXISTS (
      SELECT 1 FROM lingxing_collection_resume_attempts
      WHERE store_id = NEW.store_id
        AND attempt_id = NEW.attempt_id
        AND job_id = NEW.job_id
        AND request_id = NEW.request_id
        AND claimed_at = NEW.claimed_at
    )
    BEGIN
      SELECT RAISE(ABORT, 'resume active claim must bind its exact attempt');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_lingxing_collection_resume_event_attempt_insert
    BEFORE INSERT ON lingxing_collection_resume_events
    WHEN NOT EXISTS (
      SELECT 1 FROM lingxing_collection_resume_attempts
      WHERE store_id = NEW.store_id
        AND attempt_id = NEW.attempt_id
        AND job_id = NEW.job_id
        AND request_id = NEW.request_id
        AND base_job_updated_at = NEW.base_job_updated_at
        AND base_authority_proof_sha256 = NEW.base_authority_proof_sha256
    )
    BEGIN
      SELECT RAISE(ABORT, 'resume event must bind its exact attempt');
    END;
  `);
  for (const table of APPEND_ONLY_TABLES) {
    database.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_${table}_immutable_update
      BEFORE UPDATE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS trg_${table}_immutable_delete
      BEFORE DELETE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} is append-only');
      END;
    `);
  }
}

function backfillMetricEvidence(database: Database.Database): number {
  const runs = database.prepare(`
    SELECT store_id AS storeId, run_id AS runId, batch_id AS batchId,
           metric_row_count AS metricRowCount, created_at AS createdAt
    FROM report_import_runs AS runs
    WHERE status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM report_import_metric_evidence AS evidence
        WHERE evidence.store_id = runs.store_id AND evidence.run_id = runs.run_id
      )
    ORDER BY store_id, run_id
  `).all() as Array<{
    storeId: string;
    runId: string;
    batchId: string;
    metricRowCount: number;
    createdAt: string;
  }>;
  for (const run of runs) {
    const metrics = readCanonicalMetrics(database, run.storeId, run.batchId);
    if (metrics.length !== run.metricRowCount) {
      throw new CollectionResumeAuthorityMigrationError(
        `Import run ${run.runId} metric count no longer matches its durable row count.`,
      );
    }
    database.prepare(`
      INSERT INTO report_import_metric_evidence (
        store_id, run_id, batch_id, row_count, payload_sha256, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      run.storeId,
      run.runId,
      run.batchId,
      metrics.length,
      hashCanonicalMetrics(metrics),
      run.createdAt,
    );
  }
  return runs.length;
}

export function readCanonicalMetrics(
  database: Database.Database,
  storeId: string,
  batchId: string,
): unknown[] {
  return database.prepare(`
    SELECT * FROM ad_daily_metrics
    WHERE store_id = ? AND batch_id = ?
    ORDER BY date, report_type, source_file, source_row, id
  `).all(storeId, batchId).map((row: any) => ({
    batchId: row.batch_id ?? undefined,
    reportType: row.report_type ?? undefined,
    portfolioName: row.portfolio_name ?? undefined,
    date: row.date,
    storeName: row.store_name,
    marketplaceCode: row.marketplace_code,
    asin: row.asin,
    msku: row.msku,
    campaignName: row.campaign_name,
    adGroupName: row.ad_group_name,
    targeting: row.targeting,
    searchTerm: row.search_term,
    matchType: row.match_type,
    impressions: row.impressions,
    clicks: row.clicks,
    cost: row.cost,
    orders: row.orders,
    sales: row.sales,
    currency: row.currency ?? 'USD',
    acos: row.acos,
    cpc: row.cpc,
    cvr: row.cvr,
    sourceFile: row.source_file,
    sourceRow: row.source_row ?? undefined,
  }));
}

export function hashCanonicalMetrics(metrics: readonly unknown[]): string {
  return createHash('sha256')
    .update(stableJson([...metrics].sort(compareByStableJson)))
    .digest('hex');
}

function compareByStableJson(left: unknown, right: unknown): number {
  return stableJson(left).localeCompare(stableJson(right));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalTriggerSql(value: string): string {
  const tokens: string[] = [];
  let index = 0;
  while (index < value.length) {
    const character = value[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      const quote = character;
      const start = index;
      index += 1;
      let closed = false;
      while (index < value.length) {
        if (value[index] !== quote) {
          index += 1;
          continue;
        }
        if (value[index + 1] === quote) {
          index += 2;
          continue;
        }
        index += 1;
        closed = true;
        break;
      }
      tokens.push(`${closed ? 'quoted' : 'unterminated'}:${value.slice(start, index)}`);
      continue;
    }
    if (character === '[') {
      const start = index;
      index += 1;
      while (index < value.length && value[index] !== ']') index += 1;
      if (index < value.length) index += 1;
      tokens.push(`bracketed:${value.slice(start, index)}`);
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(character)) {
      const start = index;
      index += 1;
      while (index < value.length && /[A-Za-z0-9_$]/.test(value[index])) index += 1;
      tokens.push(`bare:${value.slice(start, index)}`);
      continue;
    }
    const compoundOperator = ['->>', '<>', '<=', '>=', '!=', '==', '||', '<<', '>>', '->']
      .find((operator) => value.startsWith(operator, index));
    if (compoundOperator) {
      tokens.push(`operator:${compoundOperator}`);
      index += compoundOperator.length;
      continue;
    }
    tokens.push(`symbol:${character}`);
    index += 1;
  }
  while (tokens.at(-1) === 'symbol:;') tokens.pop();
  return JSON.stringify(tokens);
}

function assertPrerequisite(database: Database.Database): void {
  const prerequisite = database.prepare(`
    SELECT status FROM schema_migrations WHERE version = 9
  `).get() as { status: string } | undefined;
  if (prerequisite?.status !== 'applied') {
    throw new CollectionResumeAuthorityMigrationError(
      'Migration 9 must be applied before collection resume authority migration 10.',
    );
  }
}

function defaultResult(
  status: MigrationStatus,
  startedAt: string,
): CollectionResumeAuthorityMigrationResult {
  return {
    version: COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION,
    name: COLLECTION_RESUME_AUTHORITY_MIGRATION_NAME,
    status,
    startedAt,
    createdTables: 0,
    backfilledMetricEvidence: 0,
  };
}

function parseResult(value: string | null): CollectionResumeAuthorityMigrationResult {
  if (!value) return defaultResult('applied', '');
  try {
    return JSON.parse(value) as CollectionResumeAuthorityMigrationResult;
  } catch {
    return defaultResult('applied', '');
  }
}
