/**
 * Migration 0014 Tests: V1.6 Context Binding Fields
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSqlite, closeSqlite } from '../db';
import {
  applyContextBindingMigration,
  verifyContextBindingSchema,
  ContextBindingMigrationError,
  CONTEXT_BINDING_MIGRATION_VERSION,
} from './0014-v16-context-binding';

describe('Migration 0014: V1.6 Context Binding', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Initialize with all previous migrations
    db = initSqlite(':memory:');
  });

  afterEach(() => {
    closeSqlite();
  });

  it('applies successfully after migration 13', () => {
    const result = applyContextBindingMigration(db);
    
    expect(result.version).toBe(CONTEXT_BINDING_MIGRATION_VERSION);
    // First call might return 'success' or 'skipped' if already applied
    expect(['success', 'skipped']).toContain(result.status);
    
    if (result.status === 'success') {
      expect(result.addedColumns).toBeGreaterThan(0);
    }
  });

  it('adds session_generation to v16_missions', () => {
    applyContextBindingMigration(db);
    
    const columns = db.pragma('table_info(v16_missions)') as Array<{ name: string }>;
    const columnNames = columns.map((col: { name: string }) => col.name);
    
    expect(columnNames).toContain('session_generation');
  });

  it('adds context_snapshot to v16_missions', () => {
    applyContextBindingMigration(db);
    
    const columns = db.pragma('table_info(v16_missions)') as Array<{ name: string }>;
    const columnNames = columns.map((col: { name: string }) => col.name);
    
    expect(columnNames).toContain('context_snapshot');
  });

  it('adds context_snapshot to mission_grants_v16', () => {
    applyContextBindingMigration(db);
    
    const columns = db.pragma('table_info(mission_grants_v16)') as Array<{ name: string }>;
    const columnNames = columns.map((col: { name: string }) => col.name);
    
    expect(columnNames).toContain('context_snapshot');
  });

  it('skips if already applied', () => {
    applyContextBindingMigration(db);
    const result = applyContextBindingMigration(db);
    
    expect(result.status).toBe('skipped');
  });

  it('verifies schema after migration', () => {
    applyContextBindingMigration(db);
    
    expect(() => verifyContextBindingSchema(db)).not.toThrow();
  });

  it('throws if migration 13 not applied', () => {
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
    
    expect(() => applyContextBindingMigration(freshDb)).toThrow(
      ContextBindingMigrationError
    );
    
    freshDb.close();
  });

  it('preserves existing mission data', () => {
    // Create store first to satisfy foreign key
    db.exec(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency, 
        display_name, status, business_timezone, created_at, updated_at
      ) VALUES (
        'store-a', 'profile-a', 'US', 'USD', 
        'Store A', 'active', 'America/Los_Angeles', 
        '2026-09-04T10:00:00Z', '2026-09-04T10:00:00Z'
      );
    `);
    
    // Create a mission before migration
    db.exec(`
      INSERT INTO v16_missions (
        mission_id, store_id, mission_name, product_ids,
        stage, status, created_at, updated_at
      ) VALUES (
        'mission-1', 'store-a', 'Test Mission', '["prod-1"]',
        'analysis', 'active', '2026-09-04T10:00:00Z', '2026-09-04T10:00:00Z'
      )
    `);
    
    applyContextBindingMigration(db);
    
    const mission = db.prepare('SELECT * FROM v16_missions WHERE mission_id = ?')
      .get('mission-1') as { mission_id: string; mission_name: string };
    
    expect(mission.mission_id).toBe('mission-1');
    expect(mission.mission_name).toBe('Test Mission');
  });

  it('preserves existing grant data', () => {
    // Create store first
    db.exec(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency, 
        display_name, status, business_timezone, created_at, updated_at
      ) VALUES (
        'store-b', 'profile-b', 'US', 'USD', 
        'Store B', 'active', 'America/Los_Angeles', 
        '2026-09-04T10:00:00Z', '2026-09-04T10:00:00Z'
      );
    `);
    
    // Create mission first (grant references mission)
    db.exec(`
      INSERT INTO v16_missions (
        mission_id, store_id, mission_name, product_ids,
        stage, status, created_at, updated_at
      ) VALUES (
        'mission-1', 'store-b', 'Test Mission', '["prod-1"]',
        'analysis', 'active', '2026-09-04T10:00:00Z', '2026-09-04T10:00:00Z'
      )
    `);
    
    // Create a grant before migration
    db.exec(`
      INSERT INTO mission_grants_v16 (
        grant_id, store_id, mission_id, mission_revision, decision_ids,
        issuer, issued_at, issued_by, scope_json, limits_json, evidence_json,
        session_generation, status, used_slots, created_at, updated_at, reason
      ) VALUES (
        'grant-1', 'store-b', 'mission-1', 1, '["dec-1"]',
        'human_operator', '2026-09-04T10:00:00Z', 'operator-1',
        '{"entityIds":["kw-1"],"actionType":"adjust_keyword_bid","currency":"USD"}',
        '{"maxSlots":1}',
        '{"requiresBeforeScreenshot":true,"requiresAfterScreenshot":true,"requiresReloadScreenshot":true,"requiresValueReadback":true}',
        1, 'issued', 0, '2026-09-04T10:00:00Z', '2026-09-04T10:00:00Z', 'Test grant'
      )
    `);
    
    applyContextBindingMigration(db);
    
    const grant = db.prepare('SELECT * FROM mission_grants_v16 WHERE grant_id = ?')
      .get('grant-1') as { grant_id: string; session_generation: number };
    
    expect(grant.grant_id).toBe('grant-1');
    expect(grant.session_generation).toBe(1);
  });

  it('allows inserting missions with context fields', () => {
    // Create store first
    db.exec(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency, 
        display_name, status, business_timezone, created_at, updated_at
      ) VALUES (
        'store-c', 'profile-c', 'US', 'USD', 
        'Store C', 'active', 'America/Los_Angeles', 
        '2026-09-04T10:00:00Z', '2026-09-04T10:00:00Z'
      );
    `);
    
    applyContextBindingMigration(db);
    
    const contextSnapshot = JSON.stringify({
      storeId: 'store-c',
      marketplace: 'US',
      currency: 'USD',
      businessDate: '2026-09-04',
      sessionGeneration: 1,
    });
    
    db.exec(`
      INSERT INTO v16_missions (
        mission_id, store_id, mission_name, product_ids,
        session_generation, context_snapshot,
        stage, status, created_at, updated_at
      ) VALUES (
        'mission-2', 'store-c', 'Context Mission', '["prod-1"]',
        1, '${contextSnapshot}',
        'analysis', 'active', '2026-09-04T11:00:00Z', '2026-09-04T11:00:00Z'
      )
    `);
    
    const mission = db.prepare('SELECT * FROM v16_missions WHERE mission_id = ?')
      .get('mission-2') as { 
        mission_id: string;
        session_generation: number;
        context_snapshot: string;
      };
    
    expect(mission.mission_id).toBe('mission-2');
    expect(mission.session_generation).toBe(1);
    expect(mission.context_snapshot).toBe(contextSnapshot);
  });

  it('allows inserting grants with context_snapshot', () => {
    // Create store first
    db.exec(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency, 
        display_name, status, business_timezone, created_at, updated_at
      ) VALUES (
        'store-d', 'profile-d', 'US', 'USD', 
        'Store D', 'active', 'America/Los_Angeles', 
        '2026-09-04T10:00:00Z', '2026-09-04T10:00:00Z'
      );
    `);
    
    // Create mission first
    db.exec(`
      INSERT INTO v16_missions (
        mission_id, store_id, mission_name, product_ids,
        stage, status, created_at, updated_at
      ) VALUES (
        'mission-3', 'store-d', 'Test Mission', '["prod-1"]',
        'analysis', 'active', '2026-09-04T10:00:00Z', '2026-09-04T10:00:00Z'
      )
    `);
    
    applyContextBindingMigration(db);
    
    const contextSnapshot = JSON.stringify({
      storeId: 'store-d',
      marketplace: 'US',
      currency: 'USD',
      businessDate: '2026-09-04',
      sessionGeneration: 1,
    });
    
    db.exec(`
      INSERT INTO mission_grants_v16 (
        grant_id, store_id, mission_id, mission_revision, decision_ids,
        issuer, issued_at, issued_by, scope_json, limits_json, evidence_json,
        session_generation, context_snapshot,
        status, used_slots, created_at, updated_at, reason
      ) VALUES (
        'grant-2', 'store-d', 'mission-3', 1, '["dec-1"]',
        'human_operator', '2026-09-04T11:00:00Z', 'operator-1',
        '{"entityIds":["kw-1"],"actionType":"adjust_keyword_bid","currency":"USD"}',
        '{"maxSlots":1}',
        '{"requiresBeforeScreenshot":true,"requiresAfterScreenshot":true,"requiresReloadScreenshot":true,"requiresValueReadback":true}',
        1, '${contextSnapshot}',
        'issued', 0, '2026-09-04T11:00:00Z', '2026-09-04T11:00:00Z', 'Test with snapshot'
      )
    `);
    
    const grant = db.prepare('SELECT * FROM mission_grants_v16 WHERE grant_id = ?')
      .get('grant-2') as {
        grant_id: string;
        session_generation: number;
        context_snapshot: string;
      };
    
    expect(grant.grant_id).toBe('grant-2');
    expect(grant.session_generation).toBe(1);
    expect(grant.context_snapshot).toBe(contextSnapshot);
  });
});
