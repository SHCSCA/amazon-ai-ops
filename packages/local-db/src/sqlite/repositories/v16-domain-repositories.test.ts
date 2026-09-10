/**
 * Policy Version Repository Tests (Phase 6)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSqlite, closeSqlite } from '../db';
import { runPolicyAuthorityMigration } from '../migrations/0015-v16-policy-authority';
import {
  PolicyVersionRepository,
  ModeChangeLogRow,
  AuthorityInvalidationRow,
} from './v16-domain-repositories';

describe('PolicyVersionRepository', () => {
  let db: Database.Database;
  let repo: PolicyVersionRepository;

  beforeEach(() => {
    db = initSqlite(':memory:');
    runPolicyAuthorityMigration(db);
    repo = new PolicyVersionRepository(db);
  });

  afterEach(() => {
    closeSqlite();
  });

  describe('upsertPolicyVersion / findById', () => {
    it('inserts and retrieves a policy version', () => {
      const row = makePolicyRow('p1', 'store-a', 'policy_auto', 'enabled', 1);
      repo.upsertPolicyVersion(row);
      const found = repo.findById('p1');
      expect(found?.policy_version_id).toBe('p1');
      expect(found?.status).toBe('enabled');
      expect(found?.revision).toBe(1);
    });

    it('upsert updates existing row', () => {
      const row = makePolicyRow('p1', 'store-a', 'policy_auto', 'enabled', 1);
      repo.upsertPolicyVersion(row);
      const updated = { ...row, status: 'superseded' as const };
      repo.upsertPolicyVersion(updated);
      const found = repo.findById('p1');
      expect(found?.status).toBe('superseded');
    });

    it('findById returns null for unknown', () => {
      expect(repo.findById('nonexistent')).toBeNull();
    });
  });

  describe('findByStore', () => {
    it('returns policies for a store', () => {
      repo.upsertPolicyVersion(makePolicyRow('p1', 'store-a', 'policy_auto', 'enabled', 1));
      repo.upsertPolicyVersion(makePolicyRow('p2', 'store-a', 'manual_approval', 'draft', 1));
      repo.upsertPolicyVersion(makePolicyRow('p3', 'store-b', 'policy_auto', 'enabled', 1));
      const rows = repo.findByStore('store-a');
      expect(rows.length).toBe(2);
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        repo.upsertPolicyVersion(makePolicyRow(`p${i}`, 'store-a', 'policy_auto', 'enabled', 1));
      }
      const rows = repo.findByStore('store-a', 3);
      expect(rows.length).toBe(3);
    });
  });

  describe('findEnabledByStore', () => {
    it('returns the enabled policy with highest revision', () => {
      repo.upsertPolicyVersion(makePolicyRow('p1', 'store-a', 'policy_auto', 'enabled', 1));
      repo.upsertPolicyVersion(makePolicyRow('p2', 'store-a', 'policy_auto', 'enabled', 2));
      repo.upsertPolicyVersion(makePolicyRow('p3', 'store-a', 'policy_auto', 'draft', 3));
      const found = repo.findEnabledByStore('store-a');
      expect(found?.policy_version_id).toBe('p2');
    });

    it('returns null when no enabled policy', () => {
      repo.upsertPolicyVersion(makePolicyRow('p1', 'store-a', 'policy_auto', 'draft', 1));
      expect(repo.findEnabledByStore('store-a')).toBeNull();
    });
  });

  describe('insertModeChangeLog / getModeChangeLog', () => {
    it('inserts and retrieves audit rows in order', () => {
      const log1 = makeLogRow('audit1', 'store-a', null, 'manual_approval', 0, 1);
      const log2 = makeLogRow('audit2', 'store-a', 'manual_approval', 'policy_auto', 1, 2);
      repo.insertModeChangeLog(log1);
      repo.insertModeChangeLog(log2);
      const logs = repo.getModeChangeLog('store-a');
      expect(logs.length).toBe(2);
      expect(logs[0].audit_id).toBe('audit1');
      expect(logs[1].authority_mode_revision_after).toBe(2);
    });

    it('getModeChangeLog returns empty for unknown store', () => {
      expect(repo.getModeChangeLog('unknown-store')).toEqual([]);
    });
  });

  describe('insertAuthorityInvalidation / getAuthorityInvalidations', () => {
    it('inserts and retrieves invalidation records', () => {
      const inv = makeInvalidationRow('inv1', 'store-a', 2, ['grant-1'], ['batch-1'], ['slot-1']);
      repo.insertAuthorityInvalidation(inv);
      const rows = repo.getAuthorityInvalidations('store-a');
      expect(rows.length).toBe(1);
      expect(rows[0].authority_mode_revision).toBe(2);
      expect(JSON.parse(rows[0].invalidates_grant_ids_json)).toEqual(['grant-1']);
    });

    it('getAuthorityInvalidations returns empty for unknown store', () => {
      expect(repo.getAuthorityInvalidations('unknown-store')).toEqual([]);
    });
  });

  describe('getCurrentAuthorityRevision', () => {
    it('returns 0 when no log entries', () => {
      expect(repo.getCurrentAuthorityRevision('store-a')).toBe(0);
    });

    it('returns latest revision from log', () => {
      repo.insertModeChangeLog(makeLogRow('a1', 'store-a', null, 'manual_approval', 0, 1));
      repo.insertModeChangeLog(makeLogRow('a2', 'store-a', 'manual_approval', 'policy_auto', 1, 2));
      expect(repo.getCurrentAuthorityRevision('store-a')).toBe(2);
    });
  });
});

// ─── Test helpers ─────────────────────────────────────────────────────────

function makePolicyRow(
  id: string,
  storeId: string,
  mode: string,
  status: string,
  revision: number,
) {
  return {
    policy_version_id: id,
    store_id: storeId,
    mode,
    status,
    revision,
    scope_json: JSON.stringify({ actionTypes: ['adjust_keyword_bid'] }),
    limits_json: JSON.stringify({ maxChangePercent: 10, maxSlotsPerGrant: 3, maxDailyCount: 50, cooldownMinutes: 5 }),
    window_json: JSON.stringify({ activeFrom: '2026-09-01T00:00:00Z', businessHoursOnly: false, timezone: 'America/Los_Angeles' }),
    evidence_json: JSON.stringify({
      requiresBeforeScreenshot: true,
      requiresAfterScreenshot: true,
      requiresReloadScreenshot: true,
      requiresValueReadback: true,
      requiresOperatorNote: false,
    }),
    stops_json: JSON.stringify({ killSwitchOn: false, circuitBreakerTriggered: false }),
    created_at: '2026-09-04T00:00:00Z',
    enabled_at: status === 'enabled' ? '2026-09-04T00:00:00Z' : null,
    disabled_at: null,
    enabled_by: status === 'enabled' ? 'operator' : null,
    reason: 'test',
    supersedes_policy_version_id: null,
  };
}

function makeLogRow(
  id: string,
  storeId: string,
  fromMode: string | null,
  toMode: string,
  revBefore: number,
  revAfter: number,
): ModeChangeLogRow {
  return {
    audit_id: id,
    store_id: storeId,
    from_mode: fromMode,
    to_mode: toMode,
    authority_mode_revision_before: revBefore,
    authority_mode_revision_after: revAfter,
    previous_policy_version_id: null,
    active_policy_version_id: null,
    reason: 'test',
    actor: 'operator',
    changed_at: new Date().toISOString(),
    context_snapshot_json: JSON.stringify({ storeId, marketplace: 'US', currency: 'USD', businessDate: '2026-09-04', sessionGeneration: 1 }),
  };
}

function makeInvalidationRow(
  id: string,
  storeId: string,
  rev: number,
  grantIds: string[],
  batchIds: string[],
  slotIds: string[],
): AuthorityInvalidationRow {
  return {
    invalidation_id: id,
    store_id: storeId,
    authority_mode_revision: rev,
    invalidates_grant_ids_json: JSON.stringify(grantIds),
    invalidates_batch_ids_json: JSON.stringify(batchIds),
    invalidates_slot_ids_json: JSON.stringify(slotIds),
    reason: 'test',
    created_at: new Date().toISOString(),
    terminal: 1,
  };
}