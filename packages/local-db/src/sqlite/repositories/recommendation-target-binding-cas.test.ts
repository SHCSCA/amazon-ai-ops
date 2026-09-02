import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { RecommendationRepository } from './recommendation-repo';

function createRepository() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE action_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      store_name TEXT NOT NULL,
      marketplace_code TEXT NOT NULL,
      asin TEXT NOT NULL,
      msku TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      entity_name TEXT NOT NULL,
      action_type TEXT NOT NULL,
      current_value TEXT NOT NULL,
      recommended_value TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      risk_level TEXT NOT NULL,
      status TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return { db, repo: new RecommendationRepository(db) };
}

describe('recommendation writable target binding CAS', () => {
  it('refreshes an unbound pending duplicate from an over-limit bid to a safe bid', () => {
    const { db, repo } = createRepository();
    try {
      const evidence = {
        impressions: 1090,
        clicks: 6,
        cost: 13.91,
        orders: 1,
        sales: 32.96,
        acos: 0.422,
        cpc: 2.32,
        cvr: 0.0055,
        date: '2026-08-23',
        sourceFiles: ['D:/reports/keyword.xlsx'],
        sourceRow: 432,
        explanationSource: 'ai' as const,
        aiExplanation: '规则与 AI 均建议降低竞价。',
        aiStrategySource: 'ai' as const,
        aiEvidenceRefs: ['metric:1'],
      };
      const base = {
        taskId: 'task-safe-refresh',
        storeName: 'JF-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        msku: 'MSKU-safe-refresh',
        entityType: 'target' as const,
        entityId: 'campaign_adgroup_back-massager',
        entityName: 'back massager',
        actionType: 'lower_bid' as const,
        currentValue: '2.32',
        reason: 'ACOS above target.',
        evidence,
        confidence: 0.89,
        riskLevel: 'APPROVAL' as const,
        status: 'pending' as const,
      };
      const id = repo.insert({ ...base, recommendedValue: '1.85' });

      expect(repo.insertIfNoDuplicate({ ...base, recommendedValue: '2.09' }))
        .toEqual({ id, inserted: false, updated: true });
      expect(repo.findById(id)).toMatchObject({
        revision: 1,
        recommendedValue: '2.09',
      });
    } finally {
      db.close();
    }
  });

  it('sets verified status, increments revision once, and never overwrites an existing binding audit', () => {
    const { db, repo } = createRepository();
    try {
      const id = repo.insert({
        taskId: 'task-1',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        msku: 'MSKU-1',
        entityType: 'target',
        entityId: 'synthetic-target',
        entityName: 'door lock',
        actionType: 'lower_bid',
        currentValue: '1.49',
        recommendedValue: '1.00',
        reason: 'ACOS above target.',
        evidence: {
          impressions: 100,
          clicks: 20,
          cost: 30,
          orders: 1,
          sales: 50,
          acos: 0.6,
          cpc: 1.5,
          cvr: 0.05,
          date: '2026-06-23',
        },
        confidence: 0.8,
        riskLevel: 'APPROVAL',
        status: 'pending',
      });
      const firstPatch = {
        writableTarget: { entityId: 'opaque-1' },
        writableTargetBinding: { schemaVersion: 1, fromRevision: 0, boundRevision: 1 },
      };

      expect(repo.bindWritableTargetIfCurrent(id, 0, firstPatch)).toBe(true);
      expect(repo.findById(id)).toMatchObject({
        status: 'verified',
        revision: 1,
        evidence: firstPatch,
      });
      expect(repo.bindWritableTargetIfCurrent(id, 0, {
        writableTarget: { entityId: 'opaque-stale' },
        writableTargetBinding: { schemaVersion: 1, fromRevision: 0, boundRevision: 1 },
      })).toBe(false);
      expect(repo.bindWritableTargetIfCurrent(id, 1, {
        writableTarget: { entityId: 'opaque-overwrite' },
        writableTargetBinding: { schemaVersion: 1, fromRevision: 1, boundRevision: 2 },
      })).toBe(false);
      expect(repo.findById(id)).toMatchObject({
        status: 'verified',
        revision: 1,
        evidence: firstPatch,
      });
    } finally {
      db.close();
    }
  });

  it('does not let duplicate recommendation refresh overwrite a current immutable target binding', () => {
    const { db, repo } = createRepository();
    try {
      const base = {
        taskId: 'task-2',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        msku: 'MSKU-2',
        entityType: 'target' as const,
        entityId: 'synthetic-target-2',
        entityName: 'door lock',
        actionType: 'lower_bid' as const,
        currentValue: '1.49',
        recommendedValue: '1.00',
        reason: 'ACOS above target.',
        confidence: 0.8,
        riskLevel: 'APPROVAL' as const,
        status: 'pending' as const,
      };
      const writableTarget = {
        entityType: 'keyword' as const,
        entityId: 'opaque-2',
        entityName: 'door lock',
        campaignName: 'Campaign A',
        adGroupName: 'Ad Group A',
        metricDate: '2026-06-23',
        sourceFile: 'D:/reports/keyword.xlsx',
        sourceRow: 611,
        identitySource: 'ads_ui' as const,
        verifiedBy: 'Alice',
        verifiedAt: '2026-07-16T04:30:00.000Z',
        verificationNote: 'Matched the editable keyword row.',
        identityProofPath: 'D:/proof/keyword-2.png',
      };
      const binding = {
        schemaVersion: 1 as const,
        fromRevision: 0,
        boundRevision: 1,
        boundBy: 'Alice',
        boundAt: '2026-07-16T04:30:00.000Z',
        note: 'Verified in the authenticated Ads UI.',
        scope: {
          dateFrom: '2026-05-21',
          dateTo: '2026-06-23',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: 'B0TESTASIN',
          batchId: 'batch-current',
        },
        metricSource: {
          batchId: 'batch-current',
          sourceFiles: ['D:/reports/keyword.xlsx'],
          sourceRow: 611,
        },
        writableTarget,
      };
      const id = repo.insert({
        ...base,
        evidence: {
          impressions: 100,
          clicks: 20,
          cost: 30,
          orders: 1,
          sales: 50,
          acos: 0.6,
          cpc: 1.5,
          cvr: 0.05,
          date: '2026-06-23',
          asin: 'B0TESTASIN',
          batchId: 'batch-current',
          sourceFiles: ['D:/reports/keyword.xlsx'],
          sourceRow: 611,
          campaignName: 'Campaign A',
          adGroupName: 'Ad Group A',
        },
      });
      expect(repo.bindWritableTargetIfCurrent(id, 0, {
        writableTarget,
        writableTargetBinding: binding,
      })).toBe(true);

      const duplicate = repo.insertIfNoDuplicate({
        ...base,
        recommendedValue: '0.90',
        evidence: {
          impressions: 100,
          clicks: 20,
          cost: 30,
          orders: 1,
          sales: 50,
          acos: 0.6,
          cpc: 1.5,
          cvr: 0.05,
          date: '2026-06-23',
          sourceFiles: ['D:/reports/keyword.xlsx'],
          sourceRow: 611,
          explanationSource: 'ai',
          aiExplanation: 'New AI explanation must not replace bound authority.',
          aiStrategySource: 'ai',
          aiEvidenceRefs: ['metric:1'],
        },
      });

      expect(duplicate).toEqual({ id, inserted: false });
      expect(repo.findById(id)).toMatchObject({
        revision: 1,
        recommendedValue: '1.00',
        evidence: { writableTargetBinding: binding },
      });
    } finally {
      db.close();
    }
  });

  it('does not treat a stale or incomplete binding marker as immutable duplicate-refresh authority', () => {
    const { db, repo } = createRepository();
    try {
      const base = {
        taskId: 'task-invalid-binding',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        msku: 'MSKU-invalid-binding',
        entityType: 'target' as const,
        entityId: 'synthetic-target-invalid',
        entityName: 'door lock',
        actionType: 'lower_bid' as const,
        currentValue: '1.49',
        recommendedValue: '1.00',
        reason: 'ACOS above target.',
        confidence: 0.8,
        riskLevel: 'APPROVAL' as const,
        status: 'pending' as const,
      };
      const id = repo.insert({
        ...base,
        evidence: {
          impressions: 100,
          clicks: 20,
          cost: 30,
          orders: 1,
          sales: 50,
          acos: 0.6,
          cpc: 1.5,
          cvr: 0.05,
          date: '2026-06-23',
          sourceFiles: ['D:/reports/keyword.xlsx'],
          sourceRow: 611,
          writableTarget: { entityId: 'opaque-invalid' } as any,
          writableTargetBinding: { schemaVersion: 1, fromRevision: -1, boundRevision: 0 } as any,
        },
      });

      const duplicate = repo.insertIfNoDuplicate({
        ...base,
        recommendedValue: '0.90',
        evidence: {
          impressions: 100,
          clicks: 20,
          cost: 30,
          orders: 1,
          sales: 50,
          acos: 0.6,
          cpc: 1.5,
          cvr: 0.05,
          date: '2026-06-23',
          sourceFiles: ['D:/reports/keyword.xlsx'],
          sourceRow: 611,
          explanationSource: 'ai',
          aiExplanation: 'New authoritative explanation.',
          aiStrategySource: 'ai',
          aiEvidenceRefs: ['metric:1'],
        },
      });

      expect(duplicate).toEqual({ id, inserted: false, updated: true });
      expect(repo.findById(id)).toMatchObject({
        revision: 1,
        recommendedValue: '0.90',
        evidence: { aiExplanation: 'New authoritative explanation.' },
      });
    } finally {
      db.close();
    }
  });

  it('refuses to overwrite a legacy writable target that has no binding audit', () => {
    const { db, repo } = createRepository();
    try {
      const id = repo.insert({
        taskId: 'task-legacy',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        msku: 'MSKU-legacy',
        entityType: 'target',
        entityId: 'synthetic-target-legacy',
        entityName: 'door lock',
        actionType: 'lower_bid',
        currentValue: '1.49',
        recommendedValue: '1.00',
        reason: 'Legacy target fixture.',
        evidence: {
          impressions: 100,
          clicks: 20,
          cost: 30,
          orders: 1,
          sales: 50,
          acos: 0.6,
          cpc: 1.5,
          cvr: 0.05,
          writableTarget: { entityId: 'legacy-opaque-id' } as any,
        },
        confidence: 0.8,
        riskLevel: 'APPROVAL',
        status: 'pending',
      });

      expect(repo.bindWritableTargetIfCurrent(id, 0, {
        writableTarget: { entityId: 'replacement-id' },
        writableTargetBinding: { schemaVersion: 1, fromRevision: 0, boundRevision: 1 },
      })).toBe(false);
      expect(repo.findById(id)).toMatchObject({
        revision: 0,
        evidence: { writableTarget: { entityId: 'legacy-opaque-id' } },
      });
    } finally {
      db.close();
    }
  });
});
