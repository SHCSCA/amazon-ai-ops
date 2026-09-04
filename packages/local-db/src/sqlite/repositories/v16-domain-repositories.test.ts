/**
 * V1.6 Domain Repositories Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runStoreAuthorityMigrations } from '../migrations/0001-store-authority';
import { runMissionDomainMigration } from '../migrations/0006-mission-domain';
import { runAnalysisRunsMigration } from '../migrations/0012-analysis-runs';
import { runV16DomainMigration } from '../migrations/0013-v16-domain';
import {
  MissionRepository,
  DecisionRepository,
  MissionGrantRepository,
  ExecutionRepository,
  ExperimentRepository,
  MemoryRepository,
} from './v16-domain-repositories';

function setupDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  runStoreAuthorityMigrations(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS lingxing_report_batches (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (store_id) REFERENCES stores(store_id)
    );
  `);

  for (let v = 2; v <= 5; v++) {
    db.prepare(`
      INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
      VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
    `).run(v, `migration-${v}`, `checksum-${v}`);
  }

  runMissionDomainMigration(db);

  for (let v = 7; v <= 11; v++) {
    db.prepare(`
      INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
      VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
    `).run(v, `migration-${v}`, `checksum-${v}`);
  }

  runAnalysisRunsMigration(db);
  runV16DomainMigration(db);

  // Insert test store
  db.prepare(`
    INSERT INTO stores (
      store_id, browser_profile_id, marketplace, currency, display_name, status, business_timezone, created_at, updated_at
    ) VALUES (?, ?, 'US', 'USD', ?, 'active', 'America/Los_Angeles', ?, ?)
  `).run('store-a', 'profile-a', 'Test Store', new Date().toISOString(), new Date().toISOString());

  return db;
}

describe('V16DomainRepositories', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDatabase();
  });

  afterEach(() => {
    db.close();
  });

  describe('MissionRepository', () => {
    it('creates and retrieves a mission', () => {
      const repo = new MissionRepository(db);
      const now = new Date().toISOString();
      const mission = repo.create({
        mission_id: 'mission-1',
        store_id: 'store-a',
        mission_name: 'Test mission',
        description: 'Test description',
        product_ids: '["product-1"]',
        report_snapshot_id: 'snapshot-1',
        observation_window_start: null,
        observation_window_end: null,
        policy_version_id: 'policy-1',
        policy_revision: '1',
        stage: 'analysis',
        status: 'active',
        created_at: now,
        started_at: null,
        completed_at: null,
        created_by: 'operator-1',
        last_modified_by: null,
        reason: null,
        metadata: null,
      });

      expect(mission.mission_id).toBe('mission-1');
      expect(mission.revision).toBe(1);

      const fetched = repo.findById('mission-1');
      expect(fetched).toEqual(mission);
    });

    it('finds missions by store', () => {
      const repo = new MissionRepository(db);
      const now = new Date().toISOString();

      repo.create({
        mission_id: 'mission-1',
        store_id: 'store-a',
        mission_name: 'Mission 1',
        description: null,
        product_ids: '[]',
        report_snapshot_id: null,
        observation_window_start: null,
        observation_window_end: null,
        policy_version_id: null,
        policy_revision: null,
        stage: 'analysis',
        status: 'active',
        created_at: now,
        started_at: null,
        completed_at: null,
        created_by: null,
        last_modified_by: null,
        reason: null,
        metadata: null,
      });

      repo.create({
        mission_id: 'mission-2',
        store_id: 'store-a',
        mission_name: 'Mission 2',
        description: null,
        product_ids: '[]',
        report_snapshot_id: null,
        observation_window_start: null,
        observation_window_end: null,
        policy_version_id: null,
        policy_revision: null,
        stage: 'analysis',
        status: 'paused',
        created_at: now,
        started_at: null,
        completed_at: null,
        created_by: null,
        last_modified_by: null,
        reason: null,
        metadata: null,
      });

      expect(repo.findByStoreId('store-a')).toHaveLength(2);
      expect(repo.findByStatus('store-a', 'active')).toHaveLength(1);
    });

    it('updates a mission', () => {
      const repo = new MissionRepository(db);
      const now = new Date().toISOString();
      repo.create({
        mission_id: 'mission-1',
        store_id: 'store-a',
        mission_name: 'Test',
        description: null,
        product_ids: '[]',
        report_snapshot_id: null,
        observation_window_start: null,
        observation_window_end: null,
        policy_version_id: null,
        policy_revision: null,
        stage: 'analysis',
        status: 'active',
        created_at: now,
        started_at: null,
        completed_at: null,
        created_by: null,
        last_modified_by: null,
        reason: null,
        metadata: null,
      });

      const updated = repo.update('mission-1', { status: 'completed', stage: 'effect' });
      expect(updated?.status).toBe('completed');
      expect(updated?.stage).toBe('effect');
    });
  });

  describe('DecisionRepository', () => {
    it('creates a decision and appends history', () => {
      const repo = new DecisionRepository(db);
      const now = new Date().toISOString();
      const decision = repo.create({
        decision_id: 'dec-1',
        store_id: 'store-a',
        marketplace: 'US',
        currency: 'USD',
        mission_id: 'mission-1',
        mission_revision: 1,
        analysis_run_id: 'run-1',
        batch_id: 'batch-1',
        recommendation_id: 'rec-1',
        action_type: 'adjust_keyword_bid',
        entity_type: 'keyword',
        entity_id: 'kw-1',
        current_value: '1.00',
        target_value: '0.90',
        change_reason: 'lower bid',
        status: 'proposed',
        issuer: 'human_operator',
        approved_at: null,
        approved_by: null,
        rejection_reason: null,
        superseded_by: null,
        supersedes: null,
        executed_at: null,
        execution_evidence: null,
        verified_at: null,
        verification_result: null,
        created_at: now,
        metadata: null,
      });

      expect(decision.decision_id).toBe('dec-1');

      repo.appendHistory({
        entry_id: 'h-1',
        decision_id: 'dec-1',
        from_status: 'proposed',
        to_status: 'approved',
        timestamp: now,
        reason: 'approved by operator',
        triggered_by: 'operator',
      });

      const history = repo.getHistory('dec-1');
      expect(history).toHaveLength(1);
      expect(history[0].from_status).toBe('proposed');
      expect(history[0].to_status).toBe('approved');
    });

    it('updates decision status', () => {
      const repo = new DecisionRepository(db);
      const now = new Date().toISOString();
      repo.create({
        decision_id: 'dec-1',
        store_id: 'store-a',
        marketplace: 'US',
        currency: 'USD',
        mission_id: 'mission-1',
        mission_revision: 1,
        analysis_run_id: 'run-1',
        batch_id: 'batch-1',
        recommendation_id: 'rec-1',
        action_type: 'adjust_keyword_bid',
        entity_type: 'keyword',
        entity_id: 'kw-1',
        current_value: null,
        target_value: null,
        change_reason: null,
        status: 'proposed',
        issuer: 'human_operator',
        approved_at: null,
        approved_by: null,
        rejection_reason: null,
        superseded_by: null,
        supersedes: null,
        executed_at: null,
        execution_evidence: null,
        verified_at: null,
        verification_result: null,
        created_at: now,
        metadata: null,
      });

      const updated = repo.update('dec-1', {
        status: 'approved',
        approved_at: now,
        approved_by: 'operator-1',
      });
      expect(updated?.status).toBe('approved');
    });
  });

  describe('MissionGrantRepository', () => {
    it('creates a grant and appends lifecycle events', () => {
      const repo = new MissionGrantRepository(db);
      const now = new Date().toISOString();
      repo.create({
        grant_id: 'grant-1',
        store_id: 'store-a',
        mission_id: 'mission-1',
        mission_revision: 1,
        decision_ids: '["dec-1"]',
        issuer: 'human_operator',
        issued_at: now,
        expires_at: null,
        issued_by: 'operator-1',
        scope_json: '{"actionType":"adjust_keyword_bid"}',
        limits_json: '{"maxSlots":5}',
        evidence_json: '{"requiresBeforeScreenshot":true}',
        session_generation: 1,
        ads_account_id: 'acct-1',
        status: 'active',
        used_slots: 0,
        consumed_at: null,
        revoked_at: null,
        revoked_by: null,
        revocation_reason: null,
        created_at: now,
        updated_at: now,
        reason: 'test grant',
        metadata: null,
      });

      repo.appendLifecycleEvent({
        event_id: 'evt-1',
        grant_id: 'grant-1',
        event_type: 'issued',
        timestamp: now,
      });

      const events = repo.getLifecycleEvents('grant-1');
      expect(events).toHaveLength(1);
    });

    it('finds active grants by store', () => {
      const repo = new MissionGrantRepository(db);
      const now = new Date().toISOString();
      repo.create({
        grant_id: 'grant-1',
        store_id: 'store-a',
        mission_id: 'mission-1',
        mission_revision: 1,
        decision_ids: '[]',
        issuer: 'human_operator',
        issued_at: now,
        expires_at: null,
        issued_by: 'op',
        scope_json: '{}',
        limits_json: '{}',
        evidence_json: '{}',
        session_generation: 1,
        ads_account_id: null,
        status: 'active',
        used_slots: 0,
        consumed_at: null,
        revoked_at: null,
        revoked_by: null,
        revocation_reason: null,
        created_at: now,
        updated_at: now,
        reason: '',
        metadata: null,
      });

      repo.create({
        grant_id: 'grant-2',
        store_id: 'store-a',
        mission_id: 'mission-1',
        mission_revision: 1,
        decision_ids: '[]',
        issuer: 'human_operator',
        issued_at: now,
        expires_at: null,
        issued_by: 'op',
        scope_json: '{}',
        limits_json: '{}',
        evidence_json: '{}',
        session_generation: 1,
        ads_account_id: null,
        status: 'revoked',
        used_slots: 0,
        consumed_at: null,
        revoked_at: now,
        revoked_by: 'op',
        revocation_reason: 'test',
        created_at: now,
        updated_at: now,
        reason: '',
        metadata: null,
      });

      const active = repo.findActiveByStore('store-a');
      expect(active).toHaveLength(1);
      expect(active[0].grant_id).toBe('grant-1');
    });
  });

  describe('ExecutionRepository', () => {
    it('creates slot and batch', () => {
      const repo = new ExecutionRepository(db);
      const now = new Date().toISOString();

      const batch = repo.createBatch({
        batch_id: 'batch-1',
        grant_id: 'grant-1',
        mission_id: 'mission-1',
        store_id: 'store-a',
        slot_ids: '["slot-1"]',
        status: 'running',
        pending_count: 1,
        submitted_count: 0,
        verified_count: 0,
        failed_count: 0,
        unknown_count: 0,
        created_at: now,
        updated_at: now,
        completed_at: null,
      });

      repo.createSlot({
        slot_id: 'slot-1',
        grant_id: 'grant-1',
        decision_id: 'dec-1',
        batch_id: 'batch-1',
        store_id: 'store-a',
        intent_json: '{"action":"adjust_keyword_bid"}',
        status: 'pending',
        expected_before: '1.00',
        expected_after: '0.90',
        expected_change_percent: -10,
        before_evidence_path: null,
        after_evidence_path: null,
        reload_evidence_path: null,
        readback_before_value: null,
        readback_after_value: null,
        readback_reload_value: null,
        verified_at: null,
        verification_result: null,
        reconciliation_case_id: null,
        reconciliation_outcome: null,
        created_at: now,
        updated_at: now,
        submitted_at: null,
      });

      expect(batch.batch_id).toBe('batch-1');
      expect(repo.findSlotsByBatchId('batch-1')).toHaveLength(1);
    });

    it('updates slot status', () => {
      const repo = new ExecutionRepository(db);
      const now = new Date().toISOString();

      repo.createSlot({
        slot_id: 'slot-1',
        grant_id: 'grant-1',
        decision_id: 'dec-1',
        batch_id: 'batch-1',
        store_id: 'store-a',
        intent_json: '{}',
        status: 'pending',
        expected_before: '1.00',
        expected_after: '0.90',
        expected_change_percent: null,
        before_evidence_path: null,
        after_evidence_path: null,
        reload_evidence_path: null,
        readback_before_value: null,
        readback_after_value: null,
        readback_reload_value: null,
        verified_at: null,
        verification_result: null,
        reconciliation_case_id: null,
        reconciliation_outcome: null,
        created_at: now,
        updated_at: now,
        submitted_at: null,
      });

      const updated = repo.updateSlot('slot-1', { status: 'submitted', submitted_at: now });
      expect(updated?.status).toBe('submitted');
    });
  });

  describe('ExperimentRepository', () => {
    it('creates and retrieves experiment', () => {
      const repo = new ExperimentRepository(db);
      const now = new Date().toISOString();
      const exp = repo.create({
        experiment_id: 'exp-1',
        store_id: 'store-a',
        mission_id: 'mission-1',
        decision_id: 'dec-1',
        name: 'Test experiment',
        description: 'Test',
        hypothesis_json: '{"statement":"test","expectedEffect":"+10%"}',
        product_ids: '["product-1"]',
        entity_ids: '["kw-1"]',
        baseline_snapshot_id: null,
        observation_window_start: now,
        observation_window_end: now,
        observation_snapshots: '[]',
        guardrails_json: '[]',
        conclusion_id: null,
        guardrails_triggered: '[]',
        status: 'running',
        created_at: now,
        started_at: now,
        completed_at: null,
        metadata: null,
      });

      expect(exp.experiment_id).toBe('exp-1');
      expect(repo.findById('exp-1')).toEqual(exp);
    });
  });

  describe('MemoryRepository', () => {
    it('appends and finds events', () => {
      const repo = new MemoryRepository(db);
      const now = new Date().toISOString();
      repo.append({
        event_id: 'evt-1',
        store_id: 'store-a',
        stage: 'effect',
        mission_id: 'mission-1',
        decision_id: null,
        grant_id: null,
        execution_id: null,
        experiment_id: null,
        analysis_run_id: null,
        entity_id: 'kw-1',
        product_id: 'product-1',
        business_date: '2026-09-03',
        event_type: 'effect_observed',
        session_generation: 1,
        proof_hash: 'a'.repeat(64),
        evidence_refs_json: '[]',
        summary: 'test event',
        details_json: null,
        status: 'trusted',
        memory_digest: 'abcd1234',
        created_at: now,
        correction_of: null,
        corrected_by: null,
        metadata: null,
      });

      const events = repo.findByStore('store-a');
      expect(events).toHaveLength(1);

      const trusted = repo.findTrustedByStore('store-a');
      expect(trusted).toHaveLength(1);

      expect(repo.countByStore('store-a')).toBe(1);
    });

    it('does not return non-trusted events from findTrustedByStore', () => {
      const repo = new MemoryRepository(db);
      const now = new Date().toISOString();
      repo.append({
        event_id: 'evt-1',
        store_id: 'store-a',
        stage: 'analysis', // Not in 'readback' or 'effect'
        mission_id: 'mission-1',
        decision_id: null,
        grant_id: null,
        execution_id: null,
        experiment_id: null,
        analysis_run_id: null,
        entity_id: null,
        product_id: null,
        business_date: '2026-09-03',
        event_type: 'analysis_started',
        session_generation: 1,
        proof_hash: 'a'.repeat(64),
        evidence_refs_json: '[]',
        summary: 'analysis started',
        details_json: null,
        status: 'trusted',
        memory_digest: null,
        created_at: now,
        correction_of: null,
        corrected_by: null,
        metadata: null,
      });

      const trusted = repo.findTrustedByStore('store-a');
      expect(trusted).toHaveLength(0);
    });
  });
});
