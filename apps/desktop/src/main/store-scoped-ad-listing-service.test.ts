import { describe, expect, it } from 'vitest';
import { ALL_REPORT_TYPES, createHarness, insertAdMetric, insertProductionLineage, insertNewerCompletedReportRun, insertVerifiedAdEntityAuthority, insertKeywordMetric, quarantineRow } from './store-ad-listing.test-fixtures';

describe('StoreScopedAdListingService', () => {
it.each([
    {
      label: 'later completed_at',
      createdAt: '2026-07-22T01:01:30.000Z',
      completedAt: '2026-07-22T01:02:00.000Z',
      runPrefix: 'replacement-later-completed',
    },
    {
      label: 'equal completed_at and later created_at',
      createdAt: '2026-07-22T01:00:30.000Z',
      completedAt: '2026-07-22T01:01:00.000Z',
      runPrefix: 'replacement-later-created',
    },
    {
      label: 'equal timestamps and lexically later run_id',
      createdAt: '2026-07-22T01:00:00.000Z',
      completedAt: '2026-07-22T01:01:00.000Z',
      runPrefix: 'zz-replacement-run-id',
    },
  ])('rejects old stable authority after a newer completed report run by $label', ({
    createdAt,
    completedAt,
    runPrefix,
  }) => {
    const harness = createHarness();
    const batchId = `production-newer-run-${runPrefix}`;
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId,
      createdAt: '2026-07-22T01:00:00.000Z',
      importRunCreatedAt: '2026-07-22T01:00:00.000Z',
    });
    insertAdMetric(harness, harness.firstStoreId, {
      batchId,
      reportType: 'keyword',
      campaign: 'Reimport Campaign',
      adGroup: 'Reimport Group',
      targeting: 'reimport keyword',
      searchTerm: '',
      matchType: 'exact',
      spend: 12,
      sales: 120,
      sourceRow: 1481,
      sourceFile: `C:/reports/${batchId}/keyword.xlsx`,
    });
    insertVerifiedAdEntityAuthority(harness, {
      storeId: harness.firstStoreId,
      batchId,
      authorityId: `old-authority-${runPrefix}`,
      adEntityId: `opaque-keyword-${runPrefix}`,
      entityRevision: 1,
      entityType: 'keyword',
      entityName: 'reimport keyword',
      campaignName: 'Reimport Campaign',
      adGroupName: 'Reimport Group',
      sourceRow: 1481,
    });
    insertNewerCompletedReportRun(harness, {
      storeId: harness.firstStoreId,
      batchId,
      reportType: 'keyword',
      runId: `${runPrefix}-${batchId}`,
      createdAt,
      completedAt,
    });
    const orderedRuns = harness.db.prepare(`
      SELECT run_id
      FROM report_import_runs
      WHERE store_id = ? AND batch_id = ?
      ORDER BY completed_at DESC, created_at DESC, run_id DESC
    `).all(harness.firstStoreId, batchId) as Array<{ run_id: string }>;
    expect(orderedRuns[0]?.run_id).toBe(`${runPrefix}-${batchId}`);

    const [target] = harness.service.listAdObjects(harness.switchFirst(), { kind: 'target' });

    expect(target).toMatchObject({
      resolved: false,
      nonExecutable: true,
      resolutionReason: 'STABLE_ENTITY_ID_UNAVAILABLE',
    });
    expect(target).not.toHaveProperty('entityId');
  });

it('rejects stable authority whose exact evidence import run failed even when the same batch has another completed run', () => {
    const harness = createHarness();
    const batchId = 'production-failed-exact-import-authority';
    const exactRunId = `import-${batchId}`;
    const completedRunId = `completed-import-${batchId}`;
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId,
      createdAt: '2026-07-22T01:00:00.000Z',
    });
    insertAdMetric(harness, harness.firstStoreId, {
      batchId,
      reportType: 'keyword',
      campaign: 'Failed Evidence Campaign',
      adGroup: 'Failed Evidence Group',
      targeting: 'failed evidence keyword',
      searchTerm: '',
      matchType: 'exact',
      spend: 12,
      sales: 120,
      sourceRow: 1491,
      sourceFile: `C:/reports/${batchId}/keyword.xlsx`,
    });
    harness.db.prepare(`
      INSERT INTO report_import_runs (
        store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
        source_file_count, metric_row_count, reconciliation_count,
        started_at, completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'completed', 8, 8, 0,
        '2026-07-22T01:30:00.000Z', '2026-07-22T01:31:00.000Z', '2026-07-22T01:30:00.000Z')
    `).run(
      harness.firstStoreId,
      completedRunId,
      `idempotency-${completedRunId}`,
      `fingerprint-${completedRunId}`,
      batchId,
    );
    for (const reportType of ALL_REPORT_TYPES) {
      const reportFile = harness.db.prepare(`
        SELECT id, file_path, file_name, file_size, file_hash
        FROM report_files
        WHERE store_id = ? AND batch_id = ? AND report_type = ?
        LIMIT 1
      `).get(harness.firstStoreId, batchId, reportType) as {
        id: number; file_path: string; file_name: string; file_size: number; file_hash: string;
      };
      harness.db.prepare(`
        INSERT INTO report_import_file_snapshots (
          store_id, snapshot_id, run_id, batch_id, report_file_id, report_type,
          file_path, file_name, file_size_bytes, file_hash, imported_rows, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '2026-07-22T01:31:00.000Z')
      `).run(
        harness.firstStoreId,
        `snapshot-${completedRunId}-${reportType}`,
        completedRunId,
        batchId,
        reportFile.id,
        reportType,
        reportFile.file_path,
        reportFile.file_name,
        reportFile.file_size,
        reportFile.file_hash,
      );
    }
    // Simulate a legacy/corrupt checkpoint that the read boundary must reject.
    // Current writers cannot create this state because the table is immutable
    // and CHECK-constrained, but authority reads remain fail-closed if it is
    // encountered in an upgraded local database.
    harness.db.exec('DROP TRIGGER trg_report_import_runs_immutable_update');
    harness.db.pragma('ignore_check_constraints = ON');
    harness.db.prepare(`
      UPDATE report_import_runs SET status = 'failed' WHERE store_id = ? AND run_id = ?
    `).run(harness.firstStoreId, exactRunId);
    harness.db.pragma('ignore_check_constraints = OFF');
    insertVerifiedAdEntityAuthority(harness, {
      storeId: harness.firstStoreId,
      batchId,
      authorityId: 'failed-exact-import-authority-1491',
      adEntityId: 'opaque-keyword-1491',
      entityRevision: 1,
      entityType: 'keyword',
      entityName: 'failed evidence keyword',
      campaignName: 'Failed Evidence Campaign',
      adGroupName: 'Failed Evidence Group',
      sourceRow: 1491,
      evidenceImportRunId: exactRunId,
    });

    const [target] = harness.service.listAdObjects(harness.switchFirst(), { kind: 'target' });

    expect(target).toMatchObject({
      resolved: false,
      nonExecutable: true,
      resolutionReason: 'STABLE_ENTITY_ID_UNAVAILABLE',
    });
    expect(target).not.toHaveProperty('entityId');
  });

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
});
