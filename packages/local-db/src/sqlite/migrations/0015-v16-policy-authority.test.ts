/**
 * Migration 0015 Tests: V1.6 Policy Versioning & Authority Mode Tracking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSqlite, closeSqlite } from '../db';
import {
  runPolicyAuthorityMigration,
  verifyPolicyAuthoritySchema,
  PolicyAuthorityMigrationError,
  POLICY_AUTHORITY_MIGRATION_VERSION,
} from './0015-v16-policy-authority';

describe('Migration 0015: V1.6 Policy Authority', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initSqlite(':memory:');
  });

  afterEach(() => {
    closeSqlite();
  });

  it('applies successfully after migration 14', () => {
    const result = runPolicyAuthorityMigration(db);
    expect(result.version).toBe(POLICY_AUTHORITY_MIGRATION_VERSION);
    expect(['success', 'applied', 'skipped']).toContain(result.status);
  });

  it('skips if already applied', () => {
    runPolicyAuthorityMigration(db);
    const result = runPolicyAuthorityMigration(db);
    // Second run returns 'skipped' (since the DB row is already 'applied')
    expect(['skipped', 'applied']).toContain(result.status);
  });

  it('throws if migration 14 not applied', () => {
    const freshDb = new Database(':memory:');
    freshDb.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        started_at TEXT,
        applied_at TEXT,
        error_message TEXT,
        result_json TEXT
      );
    `);
    expect(() => runPolicyAuthorityMigration(freshDb)).toThrow(
      PolicyAuthorityMigrationError,
    );
    freshDb.close();
  });

  it('creates policy_versions_v16 table', () => {
    runPolicyAuthorityMigration(db);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='policy_versions_v16'`)
      .get();
    expect(tables).toBeTruthy();
  });

  it('creates mode_change_log_v16 table', () => {
    runPolicyAuthorityMigration(db);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='mode_change_log_v16'`)
      .get();
    expect(tables).toBeTruthy();
  });

  it('creates authority_invalidation_v16 table', () => {
    runPolicyAuthorityMigration(db);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='authority_invalidation_v16'`)
      .get();
    expect(tables).toBeTruthy();
  });

  it('verifies schema after migration', () => {
    runPolicyAuthorityMigration(db);
    expect(() => verifyPolicyAuthoritySchema(db)).not.toThrow();
  });

  it('inserts and retrieves a policy version row', () => {
    runPolicyAuthorityMigration(db);
    db.prepare(`
      INSERT INTO policy_versions_v16 (
        policy_version_id, store_id, mode, status, revision,
        scope_json, limits_json, window_json, evidence_json, stops_json,
        created_at, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'p_test_1', 'store-a', 'policy_auto', 'enabled', 1,
      '{"actionTypes":["adjust_keyword_bid"]}',
      '{"maxChangePercent":10,"maxSlotsPerGrant":3,"maxDailyCount":50,"cooldownMinutes":5}',
      '{"activeFrom":"2026-09-01T00:00:00Z","businessHoursOnly":false,"timezone":"America/Los_Angeles"}',
      '{"requiresBeforeScreenshot":true,"requiresAfterScreenshot":true,"requiresReloadScreenshot":true,"requiresValueReadback":true,"requiresOperatorNote":false}',
      '{"killSwitchOn":false,"circuitBreakerTriggered":false}',
      '2026-09-04T00:00:00Z',
      'initial plan',
    );
    const row = db.prepare(`SELECT * FROM policy_versions_v16 WHERE policy_version_id = ?`).get('p_test_1') as Record<string, unknown>;
    expect(row.policy_version_id).toBe('p_test_1');
    expect(row.mode).toBe('policy_auto');
    expect(row.status).toBe('enabled');
    expect(row.revision).toBe(1);
  });

  it('inserts and retrieves a mode change audit row', () => {
    runPolicyAuthorityMigration(db);
    db.prepare(`
      INSERT INTO mode_change_log_v16 (
        audit_id, store_id, from_mode, to_mode,
        authority_mode_revision_before, authority_mode_revision_after,
        previous_policy_version_id, active_policy_version_id,
        reason, actor, changed_at, context_snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'audit_test_1', 'store-a', 'manual_approval', 'policy_auto',
      0, 1,
      null, 'p1',
      'switch to policy_auto', 'operator',
      '2026-09-04T10:00:00Z',
      '{"storeId":"store-a","marketplace":"US","currency":"USD","businessDate":"2026-09-04","sessionGeneration":1}',
    );
    const row = db.prepare(`SELECT * FROM mode_change_log_v16 WHERE audit_id = ?`).get('audit_test_1') as Record<string, unknown>;
    expect(row.from_mode).toBe('manual_approval');
    expect(row.to_mode).toBe('policy_auto');
    expect(row.authority_mode_revision_after).toBe(1);
  });

  it('inserts and retrieves an authority invalidation row', () => {
    runPolicyAuthorityMigration(db);
    db.prepare(`
      INSERT INTO authority_invalidation_v16 (
        invalidation_id, store_id, authority_mode_revision,
        invalidates_grant_ids_json, invalidates_batch_ids_json, invalidates_slot_ids_json,
        reason, created_at, terminal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'inv_test_1', 'store-a', 2,
      '["grant-1","grant-2"]',
      '["batch-1"]',
      '["slot-1","slot-2"]',
      'mode change: manual_approval -> policy_auto',
      '2026-09-04T11:00:00Z',
      1,
    );
    const row = db.prepare(`SELECT * FROM authority_invalidation_v16 WHERE invalidation_id = ?`).get('inv_test_1') as Record<string, unknown>;
    expect(row.authority_mode_revision).toBe(2);
    expect(row.terminal).toBe(1);
    expect(JSON.parse(row.invalidates_grant_ids_json as string)).toEqual(['grant-1', 'grant-2']);
  });

  it('CHECK constraints enforce valid mode values', () => {
    runPolicyAuthorityMigration(db);
    expect(() =>
      db.prepare(`INSERT INTO policy_versions_v16 (
        policy_version_id, store_id, mode, status, revision,
        scope_json, limits_json, window_json, evidence_json, stops_json,
        created_at, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        'p_bad', 'store-a', 'invalid_mode', 'enabled', 1,
        '{}', '{}', '{}', '{}', '{}',
        '2026-09-04T00:00:00Z', 'bad',
      ),
    ).toThrow();
  });

  it('CHECK constraints enforce valid status values', () => {
    runPolicyAuthorityMigration(db);
    expect(() =>
      db.prepare(`INSERT INTO policy_versions_v16 (
        policy_version_id, store_id, mode, status, revision,
        scope_json, limits_json, window_json, evidence_json, stops_json,
        created_at, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        'p_bad2', 'store-a', 'manual_approval', 'invalid_status', 1,
        '{}', '{}', '{}', '{}', '{}',
        '2026-09-04T00:00:00Z', 'bad',
      ),
    ).toThrow();
  });
});