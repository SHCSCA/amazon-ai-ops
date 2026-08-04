import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeStoreId,
  type ActionRecommendation,
  type AdDailyMetrics,
  type StoreId,
} from '@amazon-ai-ops/shared-types';
import { initSqlite } from '../db';
import { ActionLogRepository } from './action-log-repo';
import { AdMetricsRepository } from './ad-metrics-repo';
import { AiCallLogRepository } from './ai-call-log-repo';
import { AiDiagnosisRunRepository } from './ai-diagnosis-run-repo';
import { OperationEventRepository } from './operation-event-repo';
import { ProductRepository, type Product } from './product-repo';
import { RecommendationRepository } from './recommendation-repo';
import { ReportFileRepository } from './report-file-repo';

const tempDirs: string[] = [];
const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length) {
    const db = databases.pop();
    if (db?.open) db.close();
  }
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-store-scope-'));
  tempDirs.push(dir);
  const db = initSqlite(path.join(dir, 'store-scope.db'));
  databases.push(db);
  const storeA = normalizeStoreId('store-a');
  const storeB = normalizeStoreId('store-b');
  const inactiveStore = normalizeStoreId('store-inactive');
  insertStore(db, storeA, 'profile-a', 'Shop Alpha', 'active');
  insertStore(db, storeB, 'profile-b', 'Shop Beta', 'active');
  insertStore(db, inactiveStore, 'profile-inactive', 'Shop Inactive', 'inactive');
  return { db, inactiveStore, storeA, storeB };
}

function insertStore(
  db: Database.Database,
  storeId: StoreId,
  browserProfileId: string,
  displayName: string,
  status: 'active' | 'inactive' | 'archived',
): void {
  db.prepare(`
    INSERT INTO stores (
      store_id, browser_profile_id, marketplace, currency, display_name,
      status, business_timezone, created_at, updated_at
    ) VALUES (?, ?, 'US', 'USD', ?, ?, 'America/Los_Angeles', datetime('now'), datetime('now'))
  `).run(storeId, browserProfileId, displayName, status);
}

function insertReportBatch(
  db: Database.Database,
  id: string,
  storeId: StoreId,
  storeName: string,
): void {
  db.prepare(`
    INSERT INTO lingxing_report_batches (
      id, date_start, date_end, store_name, marketplace_code,
      status, download_dir, store_id
    ) VALUES (?, '2026-07-21', '2026-07-21', ?, 'US', 'completed', ?, ?)
  `).run(id, storeName, `C:/${id}`, storeId);
}

function product(storeName: string, title: string): Omit<Product, 'id' | 'created_at' | 'updated_at'> {
  return {
    marketplace_code: 'US',
    store_name: storeName,
    asin: 'B0SAMEASIN',
    parent_asin: '',
    msku: `${storeName}-MSKU`,
    sku: `${storeName}-SKU`,
    title,
    product_stage: 'growth',
    status: 'active',
  };
}

function metric(storeName: string, sourceFile: string): AdDailyMetrics {
  return {
    batchId: 'shared-batch',
    reportType: 'targeting',
    date: '2026-07-21',
    storeName,
    marketplaceCode: 'US',
    asin: 'B0SAMEASIN',
    msku: 'MSKU',
    campaignName: 'Shared campaign',
    adGroupName: 'Shared group',
    targeting: 'shared keyword',
    searchTerm: 'shared keyword',
    matchType: 'exact',
    impressions: 100,
    clicks: 10,
    cost: 5,
    orders: 2,
    sales: 20,
    currency: 'USD',
    acos: 0.25,
    cpc: 0.5,
    cvr: 0.2,
    sourceFile,
    sourceRow: 2,
  };
}

function recommendation(storeName: string, taskId: string): Omit<
  ActionRecommendation,
  'id' | 'createdAt' | 'updatedAt'
> {
  return {
    taskId,
    storeName,
    marketplaceCode: 'US',
    asin: 'B0SAMEASIN',
    msku: 'MSKU',
    entityType: 'target',
    entityId: 'shared-entity',
    entityName: 'shared keyword',
    actionType: 'lower_bid',
    currentValue: '1.00',
    recommendedValue: '0.90',
    reason: 'scope test',
    evidence: {
      date: '2026-07-21',
      impressions: 100,
      clicks: 10,
      cost: 5,
      orders: 2,
      sales: 20,
      acos: 0.25,
      cpc: 0.5,
      cvr: 0.2,
    },
    confidence: 0.9,
    riskLevel: 'AUTO',
    status: 'pending',
  };
}

describe('store-scoped legacy repositories', () => {
  it('isolates same-ASIN products and product-cost mutations by store_id', () => {
    const { db, inactiveStore, storeA, storeB } = createHarness();
    const repo = new ProductRepository(db);
    const productA = repo.insertForStore(storeA, product('Shop Alpha', 'Alpha product'));
    const productB = repo.insertForStore(storeB, product('Shop Beta', 'Beta product'));

    expect(repo.findByAsinForStore(storeA, 'B0SAMEASIN')).toEqual(expect.objectContaining({
      id: productA,
      storeId: storeA,
      title: 'Alpha product',
    }));
    expect(repo.findByAsinForStore(storeB, 'B0SAMEASIN')).toEqual(expect.objectContaining({
      id: productB,
      storeId: storeB,
      title: 'Beta product',
    }));
    expect(repo.updateCostForStore(storeB, productA, { targetAcos: 0.3 })).toBe(false);
    expect(repo.getCostForStore(storeB, productA)).toBeUndefined();
    expect(repo.updateCostForStore(storeA, productA, { targetAcos: 0.3 })).toBe(true);
    expect(repo.getCostForStore(storeA, productA)?.targetAcos).toBe(0.3);
    expect(db.prepare('SELECT store_id FROM product_costs WHERE product_id = ?').get(productA))
      .toEqual({ store_id: storeA });

    expect(() => repo.updateCostForStore(storeA, productA, {
      productId: productB,
      targetAcos: 0.4,
    })).toThrow(/元数据不可由调用方覆盖.*productId/);
    expect(db.prepare(`
      SELECT product_id
      FROM product_costs
      WHERE store_id = ? AND product_id = ?
    `).get(storeA, productB)).toBeUndefined();
    expect(repo.getCostForStore(storeA, productA)?.targetAcos).toBe(0.3);

    expect(() => repo.insertForStore(storeA, product('Shop Beta', 'split brain')))
      .toThrow(/权威记录不一致/);
    expect(() => repo.insertForStore(inactiveStore, product('Shop Inactive', 'inactive')))
      .toThrow(/inactive.*禁止写入/);

    const storeC = normalizeStoreId('store-c');
    insertStore(db, storeC, 'profile-c', 'Shop Alpha', 'active');
    const productC = repo.insertForStore(storeC, product('Shop Alpha', 'Same-name store product'));
    expect(repo.findByAsinForStore(storeC, 'B0SAMEASIN')).toEqual(expect.objectContaining({
      id: productC,
      storeId: storeC,
      title: 'Same-name store product',
    }));
    expect(repo.findByAsinForStore(storeA, 'B0SAMEASIN')?.title).toBe('Alpha product');
    expect(() => repo.insertForStore(storeA, {
      ...product('Shop Alpha', 'Invalid parent ASIN'),
      asin: 'B0PARENT01',
      parent_asin: 'ßßßßß',
    })).toThrow(/ASIN must be exactly 10 ASCII/);
    expect(repo.findByAsinForStore(storeA, 'B0PARENT01')).toBeUndefined();

    const updatedProductC = repo.upsertForStore(storeC, {
      ...product('Shop Alpha', 'Updated in same store'),
      asin: '  b0sameasin  ',
    });
    expect(updatedProductC).toBe(productC);
    expect(repo.findAllForStore(storeC)).toHaveLength(1);
    expect(repo.findByAsinForStore(storeC, 'B0SAMEASIN')?.title).toBe('Updated in same store');
    expect(() => repo.insertForStore(storeC, {
      ...product('Shop Alpha', 'Duplicate in same store'),
      asin: ' b0sameasin ',
    })).toThrow(/UNIQUE|constraint/i);
    expect(repo.findByAsinForStore(storeA, 'B0SAMEASIN')?.title).toBe('Alpha product');
  });

  it('rolls back combined product and cost writes when the cost payload is rejected', () => {
    const { db, storeA } = createHarness();
    const repo = new ProductRepository(db);
    const invalidCost = {
      targetAcos: 0.3,
      unsupportedCostField: 1,
    } as unknown as { targetAcos: number };

    expect(() => repo.insertWithCostForStore(
      storeA,
      product('Shop Alpha', 'Must roll back'),
      invalidCost,
    )).toThrow(/不支持的产品成本字段/);
    expect(repo.findAllForStore(storeA)).toHaveLength(0);

    const productId = repo.insertWithCostForStore(
      storeA,
      product('Shop Alpha', 'Original title'),
      { targetAcos: 0.25 },
    );
    expect(repo.getCostForStore(storeA, productId)?.targetAcos).toBe(0.25);

    expect(() => repo.upsertWithCostForStore(
      storeA,
      product('Shop Alpha', 'Must not persist'),
      invalidCost,
    )).toThrow(/不支持的产品成本字段/);
    expect(repo.findByAsinForStore(storeA, 'B0SAMEASIN')?.title).toBe('Original title');
    expect(repo.getCostForStore(storeA, productId)?.targetAcos).toBe(0.25);
  });

  it('isolates same-batch ad metrics for reads and deletes', () => {
    const { db, storeA, storeB } = createHarness();
    const repo = new AdMetricsRepository(db);
    repo.insertForStore(storeA, metric('Shop Alpha', 'C:/alpha.xlsx'));
    repo.insertForStore(storeB, metric('Shop Beta', 'C:/beta.xlsx'));

    expect(repo.findByDateRangeForStore(storeA, '2026-07-21', '2026-07-21'))
      .toEqual([expect.objectContaining({ storeId: storeA, sourceFile: 'C:/alpha.xlsx' })]);
    expect(repo.deleteByBatchForStore(storeA, 'shared-batch')).toBe(1);
    expect(repo.findByDateRangeForStore(storeA, '2026-07-21', '2026-07-21')).toHaveLength(0);
    expect(repo.findByDateRangeForStore(storeB, '2026-07-21', '2026-07-21'))
      .toEqual([expect.objectContaining({ storeId: storeB, sourceFile: 'C:/beta.xlsx' })]);
  });

  it('rejects non-USD currency atomically for store-scoped ad metric writes', () => {
    const { db, storeA } = createHarness();
    const repo = new AdMetricsRepository(db);
    const invalid = {
      ...metric('Shop Alpha', 'C:/invalid.xlsx'),
      currency: 'EUR',
      sourceRow: 3,
    };

    expect(() => repo.insertForStore(storeA, invalid)).toThrow(/权威记录不一致/);
    expect(() => repo.insertBatchForStore(storeA, [
      metric('Shop Alpha', 'C:/valid-before-rollback.xlsx'),
      invalid,
    ])).toThrow(/权威记录不一致/);
    expect(repo.findByDateRangeForStore(storeA, '2026-07-21', '2026-07-21')).toHaveLength(0);
  });

  it('isolates same-entity recommendations and rejects cross-store status changes', () => {
    const { db, storeA, storeB } = createHarness();
    const repo = new RecommendationRepository(db);
    const idA = repo.insertForStore(storeA, recommendation('Shop Alpha', 'task-a'));
    const idB = repo.insertForStore(storeB, recommendation('Shop Beta', 'task-b'));

    expect(repo.findByIdForStore(storeB, idA)).toBeUndefined();
    expect(repo.updateStatusForStore(storeB, idA, 'approved')).toBe(false);
    expect(repo.findByIdForStore(storeA, idA)?.status).toBe('pending');
    expect(repo.findDuplicateForStore(storeA, recommendation('Shop Alpha', 'task-a'))?.id).toBe(idA);
    expect(repo.findDuplicateForStore(storeB, recommendation('Shop Beta', 'task-b'))?.id).toBe(idB);
  });

  it('validates recommendation batch ownership and every evidence patch before writing', () => {
    const { db, storeA, storeB } = createHarness();
    insertReportBatch(db, 'batch-a', storeA, 'Shop Alpha');
    insertReportBatch(db, 'batch-b', storeB, 'Shop Beta');
    const repo = new RecommendationRepository(db);
    const recA = recommendation('Shop Alpha', 'task-a');
    recA.evidence.batchId = 'batch-a';
    const idA = repo.insertForStore(storeA, recA);

    const foreignBatch = recommendation('Shop Alpha', 'task-foreign-batch');
    foreignBatch.evidence.batchId = 'batch-b';
    expect(() => repo.insertForStore(storeA, foreignBatch)).toThrow(/不属于店铺/);
    expect(() => repo.updateStatusWithEvidenceForStore(storeA, idA, 'approved', {
      approvalDecision: { scope: { storeName: 'Shop Beta', marketplaceCode: 'US' } },
    })).toThrow(/建议证据.*权威记录不一致/);
    expect(() => repo.updateStatusWithEvidenceIfCurrentForStore(
      storeA,
      idA,
      'pending',
      0,
      'approved',
      { batchId: 'batch-b' },
    )).toThrow(/不属于店铺/);
    expect(() => repo.bindWritableTargetIfCurrentForStore(storeA, idA, 0, {
      writableTargetBinding: { scope: { storeName: 'Shop Beta', marketplaceCode: 'US' } },
    })).toThrow(/建议证据.*权威记录不一致/);
    expect(repo.findByIdForStore(storeA, idA)).toEqual(expect.objectContaining({
      status: 'pending',
      revision: 0,
      evidence: expect.objectContaining({ batchId: 'batch-a' }),
    }));
  });

  it('prevents cross-store operation-event reads, updates, and deletes', () => {
    const { db, storeA, storeB } = createHarness();
    const repo = new OperationEventRepository(db);
    const idA = repo.createForStore(storeA, {
      eventDate: '2026-07-21',
      storeName: 'Shop Alpha',
      marketplaceCode: 'US',
      asin: 'B0SAMEASIN',
      eventType: 'coupon',
      title: 'Alpha event',
    });
    const idB = repo.createForStore(storeB, {
      eventDate: '2026-07-21',
      storeName: 'Shop Beta',
      marketplaceCode: 'US',
      asin: 'B0SAMEASIN',
      eventType: 'coupon',
      title: 'Beta event',
    });

    expect(repo.getByIdForStore(storeB, idA)).toBeNull();
    expect(repo.updateForStore(storeB, idA, { title: 'cross-store update' })).toBe(false);
    expect(repo.deleteForStore(storeB, idA)).toBe(false);
    expect(repo.getByIdForStore(storeA, idA)?.title).toBe('Alpha event');
    expect(repo.getByIdForStore(storeB, idB)?.title).toBe('Beta event');
  });

  it('isolates report files sharing a batch and refuses cross-store deletion', () => {
    const { db, storeA, storeB } = createHarness();
    const repo = new ReportFileRepository(db);
    repo.upsertForStore(storeA, {
      batchId: 'shared-batch', reportType: 'targeting', filePath: 'C:/alpha.xlsx',
      fileName: 'alpha.xlsx', fileSize: 100, status: 'downloaded', importedRows: 0,
    });
    repo.upsertForStore(storeB, {
      batchId: 'shared-batch', reportType: 'targeting', filePath: 'C:/beta.xlsx',
      fileName: 'beta.xlsx', fileSize: 100, status: 'downloaded', importedRows: 0,
    });
    const alpha = repo.findForStore(storeA, { batchId: 'shared-batch' })[0];
    const beta = repo.findForStore(storeB, { batchId: 'shared-batch' })[0];

    expect(alpha).toEqual(expect.objectContaining({ storeId: storeA, fileName: 'alpha.xlsx' }));
    expect(beta).toEqual(expect.objectContaining({ storeId: storeB, fileName: 'beta.xlsx' }));
    expect(repo.deleteForStore(storeB, alpha.id!)).toBe(false);
    expect(repo.getByIdForStore(storeA, alpha.id!)).toBeDefined();
    expect(() => repo.upsertForStore(storeB, {
      batchId: 'shared-batch', reportType: 'targeting', filePath: 'C:/alpha.xlsx',
      fileName: 'must-not-overwrite-alpha.xlsx', fileSize: 100,
      status: 'downloaded', importedRows: 0,
    })).toThrow();
    expect(repo.getByIdForStore(storeA, alpha.id!)?.fileName).toBe('alpha.xlsx');
  });

  it('isolates execution and AI history projections by store_id', () => {
    const { db, storeA, storeB } = createHarness();
    const actions = new ActionLogRepository(db);
    const aiCalls = new AiCallLogRepository(db);
    const diagnoses = new AiDiagnosisRunRepository(db);
    const action = {
      taskId: 'task', actionType: 'lower_bid' as const, entityType: 'target',
      entityId: 'shared-entity', entityName: 'shared keyword', beforeValue: '1.00',
      afterValue: '0.90', executionStatus: 'success' as const,
    };
    const actionA = actions.insertForStore(storeA, action);
    actions.insertForStore(storeB, action);
    const aiInput = {
      promptKey: 'diagnose', promptVersion: '1', model: 'local', inputHash: 'same',
      outputJson: '{}', success: true,
    };
    const aiA = aiCalls.insertForStore(storeA, aiInput);
    aiCalls.insertForStore(storeB, aiInput);
    const diagnosisInput = {
      promptKey: 'diagnose', promptVersion: '1', model: 'local',
      scope: { storeName: 'Shop Alpha', marketplaceCode: 'US', asin: 'B0SAMEASIN' },
      evidencePackSummary: {}, diagnosis: {}, insights: [], formalRecommendationCount: 0,
      success: true,
    };
    const diagnosisA = diagnoses.insertForStore(storeA, diagnosisInput);
    diagnoses.insertForStore(storeB, {
      ...diagnosisInput,
      scope: { ...diagnosisInput.scope, storeName: 'Shop Beta' },
    });

    expect(actions.findByIdForStore(storeB, actionA)).toBeUndefined();
    expect(actions.findByDateRangeForStore(storeA, '2020-01-01', '2099-12-31'))
      .toEqual([expect.objectContaining({ storeId: storeA, entityId: 'shared-entity' })]);
    expect(aiCalls.findByIdForStore(storeB, aiA)).toBeUndefined();
    expect(aiCalls.findRecentForStore(storeA)).toHaveLength(1);
    expect(diagnoses.findByIdForStore(storeB, diagnosisA)).toBeUndefined();
    expect(diagnoses.findRecentForStore(storeA)).toEqual([
      expect.objectContaining({ storeId: storeA, scope: expect.objectContaining({ storeName: 'Shop Alpha' }) }),
    ]);
  });

  it('requires diagnosis scope store and known batch ownership to match authority', () => {
    const { db, storeA, storeB } = createHarness();
    insertReportBatch(db, 'batch-a', storeA, 'Shop Alpha');
    insertReportBatch(db, 'batch-b', storeB, 'Shop Beta');
    const diagnoses = new AiDiagnosisRunRepository(db);
    const input = {
      promptKey: 'diagnose', promptVersion: '1', model: 'local',
      scope: {
        storeId: storeA,
        storeName: 'Shop Alpha',
        marketplaceCode: 'US',
        currency: 'USD',
        batchId: 'batch-a',
      },
      evidencePackSummary: {}, diagnosis: {}, insights: [], formalRecommendationCount: 0,
      success: true,
    };

    expect(() => diagnoses.insertForStore(storeA, {
      ...input,
      scope: { ...input.scope, storeId: storeB },
    })).toThrow(/诊断范围.*权威记录不一致/);
    expect(() => diagnoses.insertForStore(storeA, {
      ...input,
      scope: { ...input.scope, batchId: 'batch-b' },
    })).toThrow(/不属于店铺/);

    const id = diagnoses.insertForStore(storeA, input);
    expect(diagnoses.findByIdForStore(storeA, id)).toEqual(expect.objectContaining({
      storeId: storeA,
      scope: expect.objectContaining({ storeId: storeA, batchId: 'batch-a', currency: 'USD' }),
    }));
  });
});
