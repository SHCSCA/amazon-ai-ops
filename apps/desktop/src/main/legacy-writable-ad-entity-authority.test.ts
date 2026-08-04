import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initSqlite, RecommendationRepository } from '@amazon-ai-ops/local-db';
import {
  normalizeStoreContextEnvelope,
  type ActionRecommendation,
  type StoreContextEnvelope,
  type WritableAdTargetEvidence,
} from '@amazon-ai-ops/shared-types';
import {
  currentAdEntityBelongsToStore,
  legacyWritableAdEntityBelongsToStore,
} from './legacy-writable-ad-entity-authority';

const databases: Database.Database[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function createFixture(): {
  db: Database.Database;
  context: StoreContextEnvelope;
  proofPath: string;
  recommendationId: number;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-ad-authority-'));
  tempDirs.push(directory);
  const db = initSqlite(path.join(directory, 'app.db'));
  databases.push(db);
  const context = normalizeStoreContextEnvelope({
    storeId: 'store-one',
    browserProfileId: 'profile-one',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration: 4,
  });
  db.prepare(`
    INSERT INTO stores (
      store_id, browser_profile_id, marketplace, currency, display_name,
      status, business_timezone, created_at, updated_at
    ) VALUES ('store-one', 'profile-one', 'US', 'USD', 'US Store One',
      'active', 'America/Los_Angeles', '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z')
  `).run();
  const sourceFile = path.join(directory, 'keyword.xlsx');
  const proofPath = path.join(directory, 'ads-proof.png');
  fs.writeFileSync(sourceFile, 'keyword report');
  fs.writeFileSync(proofPath, 'visible ads identity proof');
  db.prepare(`
    INSERT INTO lingxing_report_batches (
      id, date_start, date_end, store_name, marketplace_code, status,
      download_dir, created_at, completed_at, store_id, request_id,
      browser_profile_id, business_date, session_generation
    ) VALUES ('batch-1', '2026-07-01', '2026-07-22', 'US Store One', 'US', 'completed',
      ?, '2026-07-22T00:00:00.000Z', '2026-07-22T00:05:00.000Z', 'store-one',
      'request-1', 'profile-one', '2026-07-22', 4)
  `).run(directory);
  db.prepare(`
    INSERT INTO report_import_runs (
      store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
      source_file_count, metric_row_count, reconciliation_count,
      started_at, completed_at, created_at
    ) VALUES ('store-one', 'run-1', 'idem-1', 'fingerprint-1', 'batch-1', 'completed',
      1, 1, 1, '2026-07-22T00:06:00.000Z', '2026-07-22T00:07:00.000Z', '2026-07-22T00:06:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO report_import_file_snapshots (
      store_id, snapshot_id, run_id, batch_id, report_type, file_path,
      file_name, file_size_bytes, file_hash, imported_rows, captured_at
    ) VALUES ('store-one', 'snapshot-1', 'run-1', 'batch-1', 'keyword', ?,
      'keyword.xlsx', 14, ?, 1, '2026-07-22T00:07:00.000Z')
  `).run(sourceFile, 'a'.repeat(64));
  db.prepare(`
    INSERT INTO ad_daily_metrics (
      store_id, batch_id, report_type, date, store_name, marketplace_code, asin,
      campaign_name, ad_group_name, targeting, match_type, source_file, source_row
    ) VALUES ('store-one', 'batch-1', 'keyword', '2026-07-22', 'US Store One', 'US', 'B0TEST',
      'Campaign A', 'Ad Group A', 'door lock', 'exact', ?, 7)
  `).run(sourceFile);
  const target: WritableAdTargetEvidence = {
    entityType: 'keyword',
    entityId: 'opaque-keyword-1',
    entityName: 'door lock',
    campaignName: 'Campaign A',
    adGroupName: 'Ad Group A',
    metricDate: '2026-07-22',
    sourceFile,
    sourceRow: 7,
    identitySource: 'ads_ui',
    verifiedBy: 'operator',
    verifiedAt: '2026-07-22T00:08:00.000Z',
    verificationNote: 'Matched authenticated editable Ads keyword row.',
    identityProofPath: proofPath,
  };
  const recommendation: Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'> = {
    taskId: 'task-1',
    storeName: 'US Store One',
    marketplaceCode: 'US',
    asin: 'B0TEST',
    msku: 'MSKU-1',
    entityType: 'target',
    entityId: 'synthetic-keyword-row',
    entityName: 'door lock',
    actionType: 'lower_bid',
    currentValue: '1.20',
    recommendedValue: '1.00',
    reason: 'ACOS exceeds target.',
    evidence: {
      impressions: 100,
      clicks: 10,
      cost: 20,
      orders: 1,
      sales: 30,
      acos: 66.67,
      cpc: 2,
      cvr: 10,
      batchId: 'batch-1',
      reportType: 'keyword',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      targeting: 'door lock',
      sourceFile,
      sourceFiles: [sourceFile],
      sourceRow: 7,
      writableTarget: target,
      writableTargetBinding: {
        schemaVersion: 1,
        fromRevision: 0,
        boundRevision: 1,
        boundBy: 'operator',
        boundAt: '2026-07-22T00:08:00.000Z',
        note: 'Verified in visible Ads UI.',
        scope: {
          dateFrom: '2026-07-01',
          dateTo: '2026-07-22',
          storeName: 'US Store One',
          marketplaceCode: 'US',
          asin: 'B0TEST',
          batchId: 'batch-1',
        },
        metricSource: { batchId: 'batch-1', sourceFiles: [sourceFile], sourceRow: 7 },
        writableTarget: target,
      },
    },
    confidence: 0.9,
    riskLevel: 'APPROVAL',
    status: 'pending',
    revision: 0,
  };
  const recommendationId = new RecommendationRepository(db).insertForStore(context.storeId, recommendation);
  db.prepare('UPDATE action_recommendations SET revision = 1 WHERE store_id = ? AND id = ?')
    .run(context.storeId, recommendationId);
  return { db, context, proofPath, recommendationId };
}

describe('legacy writable Ads entity bootstrap authority', () => {
  it('accepts an exact current store-scoped binding revalidated from the completed import', () => {
    const fixture = createFixture();
    expect(legacyWritableAdEntityBelongsToStore(
      fixture.db,
      fixture.context,
      'opaque-keyword-1',
    )).toBe(true);
  });

  it('fails closed for another id, a stale revision, or missing visible-Ads proof', () => {
    const fixture = createFixture();
    expect(legacyWritableAdEntityBelongsToStore(fixture.db, fixture.context, 'another-id')).toBe(false);
    fixture.db.prepare('UPDATE action_recommendations SET revision = 2 WHERE id = ?')
      .run(fixture.recommendationId);
    expect(legacyWritableAdEntityBelongsToStore(fixture.db, fixture.context, 'opaque-keyword-1')).toBe(false);
    fixture.db.prepare('UPDATE action_recommendations SET revision = 1 WHERE id = ?')
      .run(fixture.recommendationId);
    fs.rmSync(fixture.proofPath);
    expect(legacyWritableAdEntityBelongsToStore(fixture.db, fixture.context, 'opaque-keyword-1')).toBe(false);
  });

  it('never treats another store context as authority for the same opaque id', () => {
    const fixture = createFixture();
    const other = normalizeStoreContextEnvelope({
      ...fixture.context,
      storeId: 'store-two',
      browserProfileId: 'profile-two',
    });
    expect(legacyWritableAdEntityBelongsToStore(fixture.db, other, 'opaque-keyword-1')).toBe(false);
  });

  it('does not fall back to legacy evidence when the registered authority query fails', () => {
    const fixture = createFixture();
    const reader = {
      getLatestVerifiedAdEntityById: vi.fn(() => { throw new Error('registry corruption'); }),
    };
    expect(() => currentAdEntityBelongsToStore(
      reader,
      fixture.db,
      fixture.context,
      'opaque-keyword-1',
    )).toThrow('registry corruption');
    expect(reader.getLatestVerifiedAdEntityById).toHaveBeenCalledOnce();
  });

  it.each([
    ['entity name', "'$.writableTarget.entityName'", 'forged'],
    ['source row', "'$.writableTarget.sourceRow'", 99],
  ])('fails closed when the stored %s is tampered', (_label, jsonPath, value) => {
    const fixture = createFixture();
    fixture.db.prepare(`
      UPDATE action_recommendations
      SET evidence_json = json_set(evidence_json, ${jsonPath}, ?)
      WHERE id = ?
    `).run(value, fixture.recommendationId);
    expect(legacyWritableAdEntityBelongsToStore(
      fixture.db,
      fixture.context,
      'opaque-keyword-1',
    )).toBe(false);
  });
});
