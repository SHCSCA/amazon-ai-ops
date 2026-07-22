import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Database } from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  BrowserProfileId,
  LingxingReportType,
  StoreContextEnvelope,
  StoreId,
} from '@amazon-ai-ops/shared-types';
import { initSqlite } from '@amazon-ai-ops/local-db/src/sqlite/db';
import { StoreRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/store-repo';
import {
  StoreCoordinator,
  type StoreSessionGenerationAuthority,
} from './store-coordinator';
import {
  StoreScopedAdListingService,
} from './store-scoped-ad-listing-service';

class MemorySessions implements StoreSessionGenerationAuthority {
  private readonly values = new Map<StoreId, number>();

  current(storeId: StoreId): number {
    return this.values.get(storeId) ?? 0;
  }

  advance(storeId: StoreId): number {
    const next = this.current(storeId) + 1;
    this.values.set(storeId, next);
    return next;
  }

  advanceMany(storeIds: readonly StoreId[]): ReadonlyMap<StoreId, number> {
    return new Map(storeIds.map((storeId) => [storeId, this.advance(storeId)]));
  }

  assertCurrent(context: StoreContextEnvelope): void {
    if (context.sessionGeneration !== this.current(context.storeId)) throw new Error('stale generation');
  }
}

type Harness = {
  db: Database;
  dir: string;
  coordinator: StoreCoordinator;
  service: StoreScopedAdListingService;
  firstStoreId: StoreId;
  secondStoreId: StoreId;
  switchFirst(): StoreContextEnvelope;
  switchSecond(): StoreContextEnvelope;
};

const harnesses: Harness[] = [];

const ALL_REPORT_TYPES: readonly LingxingReportType[] = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
];

afterEach(() => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop()!;
    if (harness.db.open) harness.db.close();
    fs.rmSync(harness.dir, { recursive: true, force: true });
  }
});

function createHarness(): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-ad-listing-'));
  const db = initSqlite(path.join(dir, 'ad-listing.db'));
  const coordinator = new StoreCoordinator({
    repository: new StoreRepository(db),
    sessions: new MemorySessions(),
    now: () => new Date('2026-07-22T18:00:00.000Z'),
    createStoreId: (() => {
      let sequence = 0;
      return () => `ad-listing-store-${++sequence}` as StoreId;
    })(),
    createBrowserProfileId: (storeId) => `profile-${storeId}` as BrowserProfileId,
  });
  const first = coordinator.createStore({ displayName: 'Same Display Name' });
  const second = coordinator.createStore({ displayName: 'Same Display Name' });
  const harness: Harness = {
    db,
    dir,
    coordinator,
    service: new StoreScopedAdListingService({ db, storeCoordinator: coordinator }),
    firstStoreId: first.storeId,
    secondStoreId: second.storeId,
    switchFirst: () => coordinator.switchStore(first.storeId).context,
    switchSecond: () => coordinator.switchStore(second.storeId).context,
  };
  harnesses.push(harness);
  return harness;
}

function insertAdMetric(
  harness: Harness,
  storeId: StoreId | null,
  input: {
    campaign: string;
    adGroup: string;
    targeting: string;
    searchTerm: string;
    spend: number;
    sales: number;
    sourceRow: number;
    batchId?: string;
    reportType?: LingxingReportType;
    date?: string;
  },
) {
  const result = harness.db.prepare(`
    INSERT INTO ad_daily_metrics (
      store_id, batch_id, date, store_name, marketplace_code, currency, asin,
      campaign_name, ad_group_name, targeting, search_term,
      report_type, impressions, clicks, cost, orders, sales,
      source_file, source_row
    ) VALUES (?, ?, ?, 'Same Display Name', 'US', 'USD', 'B0TEST001',
      ?, ?, ?, ?, ?, 1000, 100, ?, 10, ?, ?, ?)
  `).run(
    storeId,
    input.batchId ?? null,
    input.date ?? '2026-07-21',
    input.campaign,
    input.adGroup,
    input.targeting,
    input.searchTerm,
    input.reportType ?? 'user_search_term',
    input.spend,
    input.sales,
    `${input.batchId ?? 'legacy'}-${input.reportType ?? 'user_search_term'}-${input.sourceRow}.xlsx`,
    input.sourceRow,
  );
  return Number(result.lastInsertRowid);
}

function insertProductionLineage(
  harness: Harness,
  input: {
    storeId: StoreId;
    batchId: string;
    createdAt: string;
    dateStart?: string;
    dateEnd?: string;
    state?: 'completed' | 'completed_with_errors' | 'failed';
    proofReportTypes?: readonly LingxingReportType[];
  },
): void {
  const dateStart = input.dateStart ?? '2026-07-01';
  const dateEnd = input.dateEnd ?? '2026-07-21';
  const completedAt = new Date(Date.parse(input.createdAt) + 60_000).toISOString();
  const state = input.state ?? 'completed';
  const proofReportTypes = input.proofReportTypes ?? ALL_REPORT_TYPES;
  const context = harness.coordinator.switchStore(input.storeId).context;
  harness.db.prepare(`
    INSERT INTO lingxing_report_batches (
      id, request_id, store_id, browser_profile_id, business_date, session_generation,
      date_start, date_end, store_name, marketplace_code, status, download_dir,
      created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Same Display Name', 'US', 'completed', ?, ?, ?)
  `).run(
    input.batchId,
    `request-${input.batchId}`,
    input.storeId,
    context.browserProfileId,
    context.businessDate,
    context.sessionGeneration,
    dateStart,
    dateEnd,
    `C:/reports/${input.batchId}`,
    input.createdAt,
    completedAt,
  );
  const lineage = {
    lineageId: input.batchId,
    rootJobId: input.batchId,
    expectedReportTypes: [...ALL_REPORT_TYPES],
    purpose: 'production_full',
  };
  harness.db.prepare(`
    INSERT INTO lingxing_collection_jobs (
      store_id, job_id, request_id, browser_profile_id, marketplace, currency,
      business_timezone, business_date, session_generation, date_start, date_end,
      mode, report_types_json, state, snapshot_json, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, 'US', 'USD', ?, ?, ?, ?, ?, 'create-and-download', ?,
      ?, ?, ?, ?, ?)
  `).run(
    input.storeId,
    input.batchId,
    `request-${input.batchId}`,
    context.browserProfileId,
    context.businessTimezone,
    context.businessDate,
    context.sessionGeneration,
    dateStart,
    dateEnd,
    JSON.stringify(ALL_REPORT_TYPES),
    state,
    JSON.stringify({ lineage }),
    input.createdAt,
    completedAt,
    completedAt,
  );
  const runId = `import-${input.batchId}`;
  harness.db.prepare(`
    INSERT INTO report_import_runs (
      store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
      source_file_count, metric_row_count, reconciliation_count,
      started_at, completed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, 0, ?, ?, ?)
  `).run(
    input.storeId,
    runId,
    `idempotency-${input.batchId}`,
    `fingerprint-${input.batchId}`,
    input.batchId,
    proofReportTypes.length,
    proofReportTypes.length,
    input.createdAt,
    completedAt,
    completedAt,
  );
  for (const [index, reportType] of proofReportTypes.entries()) {
    const filePath = `C:/reports/${input.batchId}/${reportType}.xlsx`;
    const reportFileId = Number(harness.db.prepare(`
      INSERT INTO report_files (
        store_id, batch_id, report_type, file_path, file_name, file_size,
        status, imported_rows, file_hash, last_imported_at
      ) VALUES (?, ?, ?, ?, ?, 1024, 'imported', 1, ?, ?)
    `).run(
      input.storeId,
      input.batchId,
      reportType,
      filePath,
      `${reportType}.xlsx`,
      `hash-${input.batchId}-${reportType}`,
      completedAt,
    ).lastInsertRowid);
    harness.db.prepare(`
      INSERT INTO report_import_file_snapshots (
        store_id, snapshot_id, run_id, batch_id, report_file_id, report_type,
        file_path, file_name, file_size_bytes, file_hash, imported_rows, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1024, ?, 1, ?)
    `).run(
      input.storeId,
      `snapshot-${input.batchId}-${index}`,
      runId,
      input.batchId,
      reportFileId,
      reportType,
      filePath,
      `${reportType}.xlsx`,
      `hash-${input.batchId}-${reportType}`,
      completedAt,
    );
  }
}

function insertKeywordMetric(
  harness: Harness,
  storeId: StoreId | null,
  asin: string,
  keyword: string,
  sourceRow: number,
) {
  const result = harness.db.prepare(`
    INSERT INTO keyword_metrics (
      store_id, normalized_keyword, raw_keyword, source, source_type,
      asin, impressions, clicks, cost, orders, sales, source_file, source_row
    ) VALUES (?, ?, ?, 'lingxing', 'search_term', ?, 500, 25, 30, 5, 150, ?, ?)
  `).run(storeId, keyword, keyword, asin, `keyword-${sourceRow}.xlsx`, sourceRow);
  return Number(result.lastInsertRowid);
}

function quarantineRow(
  harness: Harness,
  sourceTable: 'ad_daily_metrics' | 'keyword_metrics' | 'keyword_opportunities',
  sourceRowId: number,
): void {
  harness.db.prepare(`
    INSERT INTO store_migration_quarantine (
      migration_version, source_table, source_row_id, reason,
      candidate_store_ids_json, source_identity_json, status,
      created_at, updated_at
    ) VALUES (
      98, ?, ?, 'ambiguous_store_identity', '[]', '{}', 'pending',
      datetime('now'), datetime('now')
    )
  `).run(sourceTable, String(sourceRowId));
}

describe('StoreScopedAdListingService', () => {
  it('uses only the canonical campaign report from the latest successful production lineage', () => {
    const harness = createHarness();
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId: 'production-old',
      createdAt: '2026-07-22T01:00:00.000Z',
    });
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId: 'production-current',
      createdAt: '2026-07-22T02:00:00.000Z',
    });
    for (const [index, reportType] of ALL_REPORT_TYPES.entries()) {
      insertAdMetric(harness, harness.firstStoreId, {
        batchId: 'production-old',
        reportType,
        campaign: 'Shared Campaign',
        adGroup: 'Shared Ad Group',
        targeting: `old ${reportType}`,
        searchTerm: `old ${reportType}`,
        spend: 100 + index,
        sales: 1_000 + index,
        sourceRow: 100 + index,
      });
      insertAdMetric(harness, harness.firstStoreId, {
        batchId: 'production-current',
        reportType,
        campaign: 'Shared Campaign',
        adGroup: 'Shared Ad Group',
        targeting: `current ${reportType}`,
        searchTerm: `current ${reportType}`,
        spend: 10 + index,
        sales: 100 + index,
        sourceRow: 200 + index,
      });
    }

    const context = harness.switchFirst();
    expect(harness.service.listAdObjects(context, {
      kind: 'campaign',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-21',
    })).toEqual([
      expect.objectContaining({
        name: 'Shared Campaign',
        spend: 10,
        sales: 100,
        sourceRowCount: 1,
        reportTypeCount: 1,
      }),
    ]);
    expect(harness.service.listAdObjects(context, {
      kind: 'campaign',
      dateFrom: '2026-06-30',
      dateTo: '2026-07-21',
    })).toEqual([]);
  });

  it.each(['completed_with_errors', 'failed'])(
    'fails closed instead of falling back when the latest production root is %s and incomplete',
    (latestState) => {
      const harness = createHarness();
      insertProductionLineage(harness, {
        storeId: harness.firstStoreId,
        batchId: 'production-complete-old',
        createdAt: '2026-07-22T01:00:00.000Z',
      });
      insertAdMetric(harness, harness.firstStoreId, {
        batchId: 'production-complete-old',
        reportType: 'campaign',
        campaign: 'Stale Complete Campaign',
        adGroup: 'Old Ad Group',
        targeting: 'old target',
        searchTerm: 'old query',
        spend: 88,
        sales: 400,
        sourceRow: 250,
      });
      insertProductionLineage(harness, {
        storeId: harness.firstStoreId,
        batchId: 'production-incomplete-current',
        createdAt: '2026-07-22T02:00:00.000Z',
        state: latestState as 'completed_with_errors' | 'failed',
        proofReportTypes: ALL_REPORT_TYPES.filter((reportType) => reportType !== 'user_search_term'),
      });
      insertAdMetric(harness, harness.firstStoreId, {
        batchId: 'production-incomplete-current',
        reportType: 'campaign',
        campaign: 'Current Partial Campaign',
        adGroup: 'Current Ad Group',
        targeting: 'current target',
        searchTerm: 'current query',
        spend: 12,
        sales: 120,
        sourceRow: 251,
      });

      expect(harness.service.listAdObjects(harness.switchFirst(), { kind: 'campaign' })).toEqual([]);
    },
  );

  it('binds ad groups, search terms, and target subtypes to disjoint authoritative report grains', () => {
    const harness = createHarness();
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId: 'production-grains',
      createdAt: '2026-07-22T03:00:00.000Z',
    });
    for (const [index, reportType] of ALL_REPORT_TYPES.entries()) {
      insertAdMetric(harness, harness.firstStoreId, {
        batchId: 'production-grains',
        reportType,
        campaign: 'Canonical Campaign',
        adGroup: 'Canonical Ad Group',
        targeting: reportType === 'keyword'
          || reportType === 'product_targeting'
          || reportType === 'auto_targeting'
          ? 'shared target'
          : `non-target ${reportType}`,
        searchTerm: reportType === 'user_search_term' ? 'customer query' : `non-search ${reportType}`,
        spend: 10 + index,
        sales: 100 + index,
        sourceRow: 300 + index,
      });
    }
    const context = harness.switchFirst();

    expect(harness.service.listAdObjects(context, { kind: 'ad_group' })).toEqual([
      expect.objectContaining({ name: 'Canonical Ad Group', spend: 11, reportTypeCount: 1 }),
    ]);
    expect(harness.service.listAdObjects(context, { kind: 'search_term' })).toEqual([
      expect.objectContaining({ name: 'customer query', spend: 17, reportTypeCount: 1 }),
    ]);
    const targets = harness.service.listAdObjects(context, { kind: 'target' });
    expect(targets).toHaveLength(3);
    expect(targets.map((target) => target.spend)).toEqual([16, 15, 14]);
    expect(targets.every((target) => target.name === 'shared target' && target.reportTypeCount === 1)).toBe(true);
    expect(new Set(targets.map((target) => target.objectKey)).size).toBe(3);
    expect(targets.map((target) => target.objectKey).join('\n')).toContain('product_targeting');
    expect(targets.map((target) => target.objectKey).join('\n')).toContain('keyword');
    expect(targets.map((target) => target.objectKey).join('\n')).toContain('auto_targeting');
  });

  it('projects only current-store advertising objects and never exposes source paths', () => {
    const harness = createHarness();
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId: 'first-store-production',
      createdAt: '2026-07-22T01:00:00.000Z',
      dateEnd: '2026-07-22',
    });
    insertProductionLineage(harness, {
      storeId: harness.secondStoreId,
      batchId: 'second-store-production',
      createdAt: '2026-07-22T01:00:00.000Z',
      dateEnd: '2026-07-22',
    });
    const firstContext = harness.switchFirst();
    insertAdMetric(harness, harness.firstStoreId, {
      batchId: 'first-store-production',
      reportType: 'campaign',
      campaign: 'First Campaign',
      adGroup: 'First Ad Group',
      targeting: 'first target',
      searchTerm: 'first search term',
      spend: 50,
      sales: 200,
      sourceRow: 1,
    });
    insertAdMetric(harness, harness.secondStoreId, {
      batchId: 'second-store-production',
      reportType: 'campaign',
      campaign: 'Second Campaign',
      adGroup: 'Second Ad Group',
      targeting: 'second target',
      searchTerm: 'second search term',
      spend: 99,
      sales: 100,
      sourceRow: 2,
    });
    insertAdMetric(harness, null, {
      campaign: 'Quarantined Campaign',
      adGroup: 'Unknown',
      targeting: 'unknown',
      searchTerm: 'unknown',
      spend: 999,
      sales: 1,
      sourceRow: 3,
    });
    const pendingOwnedAdId = insertAdMetric(harness, harness.firstStoreId, {
      batchId: 'first-store-production',
      reportType: 'campaign',
      campaign: 'Pending Owned Campaign',
      adGroup: 'Pending Owned Ad Group',
      targeting: 'pending owned target',
      searchTerm: 'pending owned search term',
      spend: 2_000,
      sales: 1,
      sourceRow: 6,
    });
    quarantineRow(harness, 'ad_daily_metrics', pendingOwnedAdId);
    insertAdMetric(harness, harness.firstStoreId, {
      batchId: 'first-store-production',
      reportType: 'campaign',
      campaign: 'Missing Currency Campaign',
      adGroup: 'Unverified',
      targeting: 'unverified currency',
      searchTerm: 'unverified currency',
      spend: 500,
      sales: 1,
      sourceRow: 4,
    });
    harness.db.prepare(`
      UPDATE ad_daily_metrics
      SET currency = NULL
      WHERE store_id = ? AND source_row = 4
    `).run(harness.firstStoreId);
    insertAdMetric(harness, harness.firstStoreId, {
      batchId: 'first-store-production',
      reportType: 'campaign',
      campaign: 'Missing Marketplace Campaign',
      adGroup: 'Unverified',
      targeting: 'unverified marketplace',
      searchTerm: 'unverified marketplace',
      spend: 500,
      sales: 1,
      sourceRow: 5,
    });
    harness.db.prepare(`
      UPDATE ad_daily_metrics
      SET marketplace_code = NULL
      WHERE store_id = ? AND source_row = 5
    `).run(harness.firstStoreId);
    insertAdMetric(harness, harness.firstStoreId, {
      batchId: 'first-store-production',
      reportType: 'keyword',
      campaign: 'First Campaign',
      adGroup: 'First Ad Group',
      targeting: 'first target',
      searchTerm: '',
      spend: 5,
      sales: 20,
      sourceRow: 7,
    });

    expect(harness.service.listAdObjects(firstContext, { kind: 'campaign' })).toEqual([
      expect.objectContaining({
        storeId: harness.firstStoreId,
        marketplace: 'US',
        currency: 'USD',
        kind: 'campaign',
        resolved: false,
        nonExecutable: true,
        resolutionReason: 'STABLE_ENTITY_ID_UNAVAILABLE',
        name: 'First Campaign',
        spend: 50,
        sales: 200,
        acos: 0.25,
        sourceFileCount: 1,
      }),
    ]);
    const target = harness.service.listAdObjects(firstContext, {
      kind: 'target',
      query: 'first',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-22',
    })[0];
    expect(target).toMatchObject({ name: 'first target', campaignName: 'First Campaign' });
    expect(JSON.stringify(target)).not.toContain('report-1.xlsx');
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count
      FROM ad_daily_metrics
      WHERE id = ? AND store_id = ?
    `).get(pendingOwnedAdId, harness.firstStoreId)).toEqual({ count: 1 });
  });

  it('merges store-owned keyword metrics and opportunities while preserving quarantined rows', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    insertKeywordMetric(harness, harness.firstStoreId, 'B0TEST001', 'smart lock', 1);
    insertKeywordMetric(harness, harness.secondStoreId, 'B0OTHER01', 'other keyword', 2);
    insertKeywordMetric(harness, null, 'B0UNKNOWN1', 'quarantined keyword', 3);
    const pendingOwnedMetricId = insertKeywordMetric(
      harness,
      harness.firstStoreId,
      'B0PENDING1',
      'pending owned keyword',
      4,
    );
    quarantineRow(harness, 'keyword_metrics', pendingOwnedMetricId);
    harness.db.prepare(`
      INSERT INTO keyword_opportunities (
        store_id, asin, normalized_keyword, opportunity_level, score,
        evidence, risk_flags_json, recommended_sections_json, status
      ) VALUES (?, 'B0TEST001', 'smart lock', 'high', 0.92,
        '25 clicks and 5 orders', '["brand-risk"]', '["title","bullet"]', 'pending')
    `).run(harness.firstStoreId);
    const pendingOwnedOpportunityId = Number(harness.db.prepare(`
      INSERT INTO keyword_opportunities (
        store_id, asin, normalized_keyword, opportunity_level, score,
        evidence, risk_flags_json, recommended_sections_json, status
      ) VALUES (?, 'B0PENDING1', 'pending owned opportunity', 'high', 1,
        'must remain isolated', '[]', '[]', 'pending')
    `).run(harness.firstStoreId).lastInsertRowid);
    quarantineRow(harness, 'keyword_opportunities', pendingOwnedOpportunityId);

    expect(harness.service.listKeywordFacts(context)).toEqual([
      expect.objectContaining({
        storeId: harness.firstStoreId,
        keyword: 'smart lock',
        asin: 'B0TEST001',
        spend: 30,
        sales: 150,
        acos: 0.2,
        opportunityLevel: 'high',
        opportunityScore: 0.92,
        riskFlags: ['brand-risk'],
        recommendedSections: ['title', 'bullet'],
      }),
    ]);
    expect(harness.db.prepare('SELECT COUNT(*) AS count FROM keyword_metrics WHERE store_id IS NULL').get())
      .toEqual({ count: 1 });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count
      FROM keyword_metrics
      WHERE id = ? AND store_id = ?
    `).get(pendingOwnedMetricId, harness.firstStoreId)).toEqual({ count: 1 });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count
      FROM keyword_opportunities
      WHERE id = ? AND store_id = ?
    `).get(pendingOwnedOpportunityId, harness.firstStoreId)).toEqual({ count: 1 });
  });

  it('supports isolated Listing CRUD with revision CAS and durable store-owned versions', () => {
    const harness = createHarness();
    const firstContext = harness.switchFirst();
    const first = harness.service.createListingContent(firstContext, {
      asin: 'B0LIST0001',
      title: 'First store title',
      bullets: ['One', 'Two'],
      backendTerms: 'smart lock',
      versionLabel: 'v1',
      marketplace: 'US',
      currency: 'USD',
    });
    expect(first).toMatchObject({
      storeId: harness.firstStoreId,
      marketplace: 'US',
      currency: 'USD',
      asin: 'B0LIST0001',
      asinValid: true,
      title: 'First store title',
      bullets: ['One', 'Two'],
    });
    expect(first.revision).toMatch(/^listing-content-v1:[a-f0-9]{64}$/);

    const secondContext = harness.switchSecond();
    const second = harness.service.createListingContent(secondContext, {
      asin: 'B0LIST0001',
      title: 'Second store title',
    });
    expect(second.storeId).toBe(harness.secondStoreId);
    expect(() => harness.service.getListingContent(secondContext, { id: first.id }))
      .toThrowError(expect.objectContaining({ code: 'OBJECT_NOT_FOUND' }));

    const refreshedFirst = harness.switchFirst();
    const updated = harness.service.updateListingContent(refreshedFirst, {
      id: first.id,
      expectedRevision: first.revision,
      patch: {
        title: 'Updated first title',
        changeSummary: 'Operator reviewed title',
        marketplace: 'US',
        currency: 'USD',
      },
    });
    expect(updated.title).toBe('Updated first title');
    expect(updated.revision).not.toBe(first.revision);
    expect(() => harness.service.updateListingContent(refreshedFirst, {
      id: first.id,
      expectedRevision: first.revision,
      patch: { title: 'Stale overwrite' },
    })).toThrowError(expect.objectContaining({ code: 'OBJECT_CONFLICT' }));
    expect(harness.service.listListingVersions(refreshedFirst, { listingContentId: first.id }))
      .toHaveLength(2);

    expect(harness.service.deleteListingContent(refreshedFirst, {
      id: first.id,
      expectedRevision: updated.revision,
    })).toEqual({ id: first.id, deleted: true });
    expect(harness.service.listListingContent(refreshedFirst)).toEqual([]);
    expect(harness.service.listListingVersions(refreshedFirst, { listingContentId: first.id }))
      .toHaveLength(2);
    expect(harness.service.listListingVersions(refreshedFirst, { limit: 1, offset: 0 }))
      .toEqual([expect.objectContaining({
        listingContentId: first.id,
        storeId: harness.firstStoreId,
        title: 'Updated first title',
      })]);
    expect(harness.service.listListingVersions(refreshedFirst, { limit: 1, offset: 1 }))
      .toEqual([expect.objectContaining({
        listingContentId: first.id,
        storeId: harness.firstStoreId,
        title: 'First store title',
      })]);

    const backToSecond = harness.switchSecond();
    expect(harness.service.listListingContent(backToSecond)).toEqual([
      expect.objectContaining({ id: second.id, title: 'Second store title' }),
    ]);
    expect(harness.service.listListingVersions(backToSecond, { limit: 100, offset: 0 }))
      .toEqual([expect.objectContaining({
        listingContentId: second.id,
        storeId: harness.secondStoreId,
        title: 'Second store title',
      })]);
  });

  it('uses IMMEDIATE transactions for every Listing mutation and rejects invalid ASIN writes', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const transactionModes: string[] = [];
    const originalTransaction = harness.db.transaction.bind(harness.db) as (...args: unknown[]) => any;
    (harness.db as any).transaction = (operation: (...args: unknown[]) => unknown) => {
      const transaction = originalTransaction(operation);
      const wrapped = (...args: unknown[]) => {
        transactionModes.push('deferred');
        return transaction(...args);
      };
      wrapped.deferred = (...args: unknown[]) => {
        transactionModes.push('deferred');
        return transaction.deferred(...args);
      };
      wrapped.immediate = (...args: unknown[]) => {
        transactionModes.push('immediate');
        return transaction.immediate(...args);
      };
      wrapped.exclusive = (...args: unknown[]) => {
        transactionModes.push('exclusive');
        return transaction.exclusive(...args);
      };
      return wrapped;
    };

    expect(() => harness.service.createListingContent(context, {
      asin: 'B0SHORT1',
      title: 'Invalid Listing',
    })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    const created = harness.service.createListingContent(context, {
      asin: 'b0list0002',
      title: 'Transactional Listing',
    });
    const updated = harness.service.updateListingContent(context, {
      id: created.id,
      expectedRevision: created.revision,
      patch: { title: 'Transactional Listing updated' },
    });
    harness.service.deleteListingContent(context, {
      id: updated.id,
      expectedRevision: updated.revision,
    });

    expect(transactionModes).toEqual(['immediate', 'immediate', 'immediate']);
  });

  it('keeps legacy invalid Listing ASINs readable but read-only', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const result = harness.db.prepare(`
      INSERT INTO listing_content (
        store_id, asin, store_name, marketplace_code, title
      ) VALUES (?, 'B0-OLD_01', 'Same Display Name', 'US', 'Legacy invalid Listing')
    `).run(harness.firstStoreId);

    const legacy = harness.service.getListingContent(context, {
      id: Number(result.lastInsertRowid),
    });
    expect(legacy).toMatchObject({ asin: 'B0-OLD_01', asinValid: false });
    harness.db.prepare(`
      INSERT INTO listing_content_versions (
        store_id, listing_content_id, asin, store_name, marketplace_code,
        title, version_label, created_at
      ) VALUES (?, ?, 'B0-OLD_01', 'Same Display Name', 'US',
        'Legacy invalid Listing', 'legacy-v1', '2026-07-22 01:00:00.000')
    `).run(harness.firstStoreId, legacy.id);
    expect(harness.service.listListingVersions(context, {
      listingContentId: legacy.id,
      // The historical ASIN is deliberately invalid. listingContentId is the
      // durable authority and must prevent ASIN normalization from blocking
      // the operator's read-only history inspection.
      asin: legacy.asin,
      limit: 10,
    })).toEqual([expect.objectContaining({
      listingContentId: legacy.id,
      storeId: harness.firstStoreId,
      asin: 'B0-OLD_01',
      asinValid: false,
      versionLabel: 'legacy-v1',
    })]);
    expect(() => harness.service.updateListingContent(context, {
      id: legacy.id,
      expectedRevision: legacy.revision,
      patch: { title: 'Must remain read-only' },
    })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => harness.service.deleteListingContent(context, {
      id: legacy.id,
      expectedRevision: legacy.revision,
    })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(harness.db.prepare(`
      SELECT title FROM listing_content WHERE id = ?
    `).get(legacy.id)).toEqual({ title: 'Legacy invalid Listing' });
  });

  it('keeps pending-quarantined Listing objects and versions invisible and immutable', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const listing = harness.service.createListingContent(context, {
      asin: 'B0PENDING1',
      title: 'Pending authority Listing',
    });
    const version = harness.db.prepare(`
      SELECT id
      FROM listing_content_versions
      WHERE listing_content_id = ?
      ORDER BY id
      LIMIT 1
    `).get(listing.id) as { id: number };
    const insertPending = harness.db.prepare(`
      INSERT INTO store_migration_quarantine (
        migration_version, source_table, source_row_id, reason,
        candidate_store_ids_json, source_identity_json, status,
        created_at, updated_at
      ) VALUES (1, ?, ?, 'ambiguous_store_identity', '[]', '{}',
        'pending', datetime('now'), datetime('now'))
    `);
    insertPending.run('listing_content', String(listing.id));
    insertPending.run('listing_content_versions', String(version.id));

    expect(harness.service.listListingContent(context)).toEqual([]);
    expect(() => harness.service.getListingContent(context, { id: listing.id }))
      .toThrowError(expect.objectContaining({ code: 'OBJECT_NOT_FOUND' }));
    expect(() => harness.service.updateListingContent(context, {
      id: listing.id,
      expectedRevision: listing.revision,
      patch: { title: 'Must not mutate pending authority' },
    })).toThrowError(expect.objectContaining({ code: 'OBJECT_NOT_FOUND' }));
    expect(() => harness.service.deleteListingContent(context, {
      id: listing.id,
      expectedRevision: listing.revision,
    })).toThrowError(expect.objectContaining({ code: 'OBJECT_NOT_FOUND' }));
    expect(harness.service.listListingVersions(context, {
      listingContentId: listing.id,
    })).toEqual([]);
    expect(harness.db.prepare(`
      SELECT title FROM listing_content WHERE id = ?
    `).get(listing.id)).toEqual({ title: 'Pending authority Listing' });

    expect(() => harness.service.createListingContent(context, {
      asin: 'B0FORGED01',
      currency: 'USDT',
    })).toThrowError(expect.objectContaining({ code: 'STORE_IDENTITY_MISMATCH' }));
    expect(() => harness.service.listAdObjects(context, {
      kind: 'campaign',
      unsupported: true,
    } as never)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });

  it('filters a pending version without hiding its reconciled Listing object', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const created = harness.service.createListingContent(context, {
      asin: 'B0PENDING2',
      title: 'Reconciled Listing',
    });
    harness.service.updateListingContent(context, {
      id: created.id,
      expectedRevision: created.revision,
      patch: { title: 'Reconciled Listing v2' },
    });
    const versions = harness.db.prepare(`
      SELECT id
      FROM listing_content_versions
      WHERE listing_content_id = ?
      ORDER BY id
    `).all(created.id) as Array<{ id: number }>;
    expect(versions).toHaveLength(2);
    harness.db.prepare(`
      INSERT INTO store_migration_quarantine (
        migration_version, source_table, source_row_id, reason,
        candidate_store_ids_json, source_identity_json, status,
        created_at, updated_at
      ) VALUES (1, 'listing_content_versions', ?, 'ambiguous_parent_store',
        '[]', '{}', 'pending', datetime('now'), datetime('now'))
    `).run(String(versions[0].id));

    expect(harness.service.listListingContent(context)).toEqual([
      expect.objectContaining({ id: created.id, title: 'Reconciled Listing v2' }),
    ]);
    expect(harness.service.listListingVersions(context, {
      listingContentId: created.id,
    })).toEqual([
      expect.objectContaining({ id: versions[1].id, title: 'Reconciled Listing v2' }),
    ]);
  });
});
