import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeSqlite, initSqlite } from '../db';
import {
  CollectionResumeAuthorityMigrationError,
  COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION,
  COLLECTION_RESUME_AUTHORITY_TABLES,
  runCollectionResumeAuthorityMigration,
  verifyCollectionResumeAuthoritySchema,
} from '.';

afterEach(() => {
  closeSqlite();
});

describe('collection resume authority migration v10', () => {
  it('creates the metric-evidence and append-only resume authority schema across reopen', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-resume-v10-'));
    const dbPath = path.join(directory, 'authority.db');
    try {
      let database = initSqlite(dbPath);
      expect(database.prepare(`
        SELECT status FROM schema_migrations WHERE version = ?
      `).get(COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION)).toEqual({ status: 'applied' });
      const tables = database.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (${COLLECTION_RESUME_AUTHORITY_TABLES.map(() => '?').join(',')})
        ORDER BY name
      `).all(...COLLECTION_RESUME_AUTHORITY_TABLES).map((row: any) => row.name);
      expect(tables).toEqual([...COLLECTION_RESUME_AUTHORITY_TABLES].sort());

      closeSqlite();
      database = initSqlite(dbPath);
      expect(database.pragma('foreign_key_check')).toEqual([]);
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      closeSqlite();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when a same-named v10 table has an incomplete shape', () => {
    const database = initSqlite(':memory:');
    database.prepare('DELETE FROM schema_migrations WHERE version = ?')
      .run(COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION);
    database.exec(`
      DROP TABLE lingxing_collection_resume_events;
      DROP TABLE lingxing_collection_resume_active_claims;
      DROP TABLE lingxing_collection_resume_attempts;
      DROP TABLE report_import_metric_evidence;
      CREATE TABLE report_import_metric_evidence (
        store_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        PRIMARY KEY (store_id, run_id)
      );
    `);

    expect(() => runCollectionResumeAuthorityMigration(database))
      .toThrow(CollectionResumeAuthorityMigrationError);
    expect(database.prepare(`
      SELECT status FROM schema_migrations WHERE version = ?
    `).get(COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION)).toEqual({ status: 'failed' });
  });

  it('rejects a full-name table contract with a nullable evidence digest and missing FKs', () => {
    const database = initSqlite(':memory:');
    database.prepare('DELETE FROM schema_migrations WHERE version = ?')
      .run(COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION);
    database.exec(`
      DROP TABLE report_import_metric_evidence;
      CREATE TABLE report_import_metric_evidence (
        store_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        payload_sha256 TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (store_id, run_id)
      );
    `);

    expect(() => runCollectionResumeAuthorityMigration(database))
      .toThrow(/exact column contract/);
  });

  it('rejects an ineffective WHEN 0 replacement for an append-only trigger', () => {
    const database = initSqlite(':memory:');
    database.exec(`
      DROP TRIGGER trg_lingxing_collection_resume_events_immutable_update;
      CREATE TRIGGER trg_lingxing_collection_resume_events_immutable_update
      BEFORE UPDATE ON lingxing_collection_resume_events
      WHEN 0
      BEGIN
        SELECT RAISE(ABORT, 'lingxing_collection_resume_events is append-only');
      END;
    `);

    expect(() => verifyCollectionResumeAuthoritySchema(database))
      .toThrow(/append-only trigger.*missing or invalid/);
  });

  it('rejects an ineffective WHEN 0 replacement for the metric-evidence binding trigger', () => {
    const database = initSqlite(':memory:');
    database.exec(`
      DROP TRIGGER trg_report_import_metric_evidence_run_batch_insert;
      CREATE TRIGGER trg_report_import_metric_evidence_run_batch_insert
      BEFORE INSERT ON report_import_metric_evidence
      WHEN 0
        OR NEW.store_id IS NULL
        OR NEW.run_id IS NULL
        OR NEW.batch_id IS NULL
        OR 'status = ''completed''' = ''
      BEGIN
        SELECT RAISE(ABORT, 'metric evidence must bind the completed import run batch');
      END;
    `);

    expect(() => verifyCollectionResumeAuthoritySchema(database))
      .toThrow(/binding trigger.*missing or invalid/);
  });

  it('rejects a resume-attempt binding trigger whose RAISE is guarded by a constant false predicate', () => {
    const database = initSqlite(':memory:');
    database.exec(`
      DROP TRIGGER trg_lingxing_collection_resume_attempt_job_binding_insert;
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
        SELECT RAISE(ABORT, 'resume attempt must bind the exact durable job authority')
        WHERE 0;
      END;
    `);

    expect(() => verifyCollectionResumeAuthoritySchema(database))
      .toThrow(/binding trigger.*missing or invalid/);
  });

  it('rejects a resume-event binding trigger that only mentions NEW fields in self-comparisons', () => {
    const database = initSqlite(':memory:');
    database.exec(`
      DROP TRIGGER trg_lingxing_collection_resume_event_attempt_insert;
      CREATE TRIGGER trg_lingxing_collection_resume_event_attempt_insert
      BEFORE INSERT ON lingxing_collection_resume_events
      WHEN NEW.store_id <> NEW.store_id
        OR NEW.attempt_id <> NEW.attempt_id
        OR NEW.job_id <> NEW.job_id
        OR NEW.request_id <> NEW.request_id
        OR NEW.base_job_updated_at <> NEW.base_job_updated_at
        OR NEW.base_authority_proof_sha256 <> NEW.base_authority_proof_sha256
      BEGIN
        SELECT RAISE(ABORT, 'resume event must bind its exact attempt');
      END;
    `);

    expect(() => verifyCollectionResumeAuthoritySchema(database))
      .toThrow(/binding trigger.*missing or invalid/);
  });

  it('rejects a binding trigger that replaces the RAISE function with an inert string SELECT', () => {
    const database = initSqlite(':memory:');
    database.exec(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency, display_name,
        status, business_timezone, created_at, updated_at
      ) VALUES (
        'trigger-token-store', 'trigger-token-profile', 'US', 'USD', 'Trigger Token Store',
        'active', 'America/Los_Angeles', '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z'
      );
      INSERT INTO lingxing_report_batches (
        id, date_start, date_end, store_name, marketplace_code, status,
        download_dir, created_at, completed_at, store_id, request_id,
        browser_profile_id, business_date, session_generation
      ) VALUES
        ('trigger-batch-a', '2026-08-02', '2026-08-02', 'Trigger Token Store', 'US',
          'completed', 'D:/reports/a', '2026-08-03T00:00:00.000Z',
          '2026-08-03T00:01:00.000Z', 'trigger-token-store', 'trigger-request-a',
          'trigger-token-profile', '2026-08-03', 1),
        ('trigger-batch-b', '2026-08-02', '2026-08-02', 'Trigger Token Store', 'US',
          'completed', 'D:/reports/b', '2026-08-03T00:00:00.000Z',
          '2026-08-03T00:01:00.000Z', 'trigger-token-store', 'trigger-request-b',
          'trigger-token-profile', '2026-08-03', 1);
      INSERT INTO report_import_runs (
        store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
        source_file_count, metric_row_count, reconciliation_count,
        started_at, completed_at, created_at
      ) VALUES (
        'trigger-token-store', 'trigger-run-a', 'trigger-idempotency-a',
        '${'a'.repeat(64)}', 'trigger-batch-a', 'completed', 0, 0, 0,
        '2026-08-03T00:00:00.000Z', '2026-08-03T00:01:00.000Z',
        '2026-08-03T00:01:00.000Z'
      );

      DROP TRIGGER trg_report_import_metric_evidence_run_batch_insert;
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
        SELECT 'RAISE(ABORT, metric evidence must bind the completed import run batch)';
      END;
    `);

    const illegalInsert = database.prepare(`
      INSERT INTO report_import_metric_evidence (
        store_id, run_id, batch_id, row_count, payload_sha256, created_at
      ) VALUES (?, ?, ?, 0, ?, ?)
    `).run(
      'trigger-token-store',
      'trigger-run-a',
      'trigger-batch-b',
      'b'.repeat(64),
      '2026-08-03T00:02:00.000Z',
    );
    expect(illegalInsert.changes).toBe(1);
    expect(() => verifyCollectionResumeAuthoritySchema(database))
      .toThrow(/binding trigger.*missing or invalid/);
  });

  it("rejects an active-claim trigger that replaces the attempt claimed_at column with a quoted literal", () => {
    const database = initSqlite(':memory:');
    database.exec(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency, display_name,
        status, business_timezone, created_at, updated_at
      ) VALUES (
        'claim-literal-store', 'claim-literal-profile', 'US', 'USD', 'Claim Literal Store',
        'active', 'America/Los_Angeles', '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z'
      );
      INSERT INTO lingxing_collection_jobs (
        store_id, job_id, request_id, browser_profile_id, marketplace,
        currency, business_timezone, business_date, session_generation,
        date_start, date_end, mode, report_types_json, state, snapshot_json,
        created_at, updated_at
      ) VALUES (
        'claim-literal-store', 'claim-literal-job', 'claim-literal-request',
        'claim-literal-profile', 'US', 'USD', 'America/Los_Angeles', '2026-08-03', 2,
        '2026-08-02', '2026-08-02', 'create-and-download', '[]', 'downloading', '{}',
        '2026-08-03T00:00:00.000Z', '2026-08-03T00:01:00.000Z'
      );
      INSERT INTO lingxing_collection_resume_attempts (
        store_id, attempt_id, job_id, request_id, base_job_updated_at,
        base_authority_proof_sha256, durable_session_generation,
        execution_session_generation, execution_context_sha256, claimed_at
      ) VALUES (
        'claim-literal-store', 'claim-literal-attempt', 'claim-literal-job',
        'claim-literal-request', '2026-08-03T00:01:00.000Z', '${'c'.repeat(64)}',
        2, 2, '${'d'.repeat(64)}', '2026-08-03T00:02:00.000Z'
      );

      DROP TRIGGER trg_lingxing_collection_resume_active_claim_attempt_insert;
      CREATE TRIGGER trg_lingxing_collection_resume_active_claim_attempt_insert
      BEFORE INSERT ON lingxing_collection_resume_active_claims
      WHEN NOT EXISTS (
        SELECT 1 FROM lingxing_collection_resume_attempts
        WHERE store_id = NEW.store_id
          AND attempt_id = NEW.attempt_id
          AND job_id = NEW.job_id
          AND request_id = NEW.request_id
          AND ('claimed_at') = (NEW.claimed_at)
      )
      BEGIN
        SELECT RAISE(ABORT, 'resume active claim must bind its exact attempt');
      END;
    `);

    const illegalInsert = database.prepare(`
      INSERT INTO lingxing_collection_resume_active_claims (
        store_id, job_id, request_id, attempt_id, claim_token_sha256,
        expected_job_updated_at, expected_authority_proof_sha256,
        version, claimed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      'claim-literal-store',
      'claim-literal-job',
      'claim-literal-request',
      'claim-literal-attempt',
      'e'.repeat(64),
      '2026-08-03T00:01:00.000Z',
      'f'.repeat(64),
      'claimed_at',
      '2026-08-03T00:03:00.000Z',
    );
    expect(illegalInsert.changes).toBe(1);
    expect(() => verifyCollectionResumeAuthoritySchema(database))
      .toThrow(/binding trigger.*missing or invalid/);
  });
});
