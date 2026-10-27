// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { StoreRepository, describe, expect, it, normalizeStoreCapabilityId, reconcileUsdAmount } from './lingxing-import-test-environment';
import { collectionSnapshot, createHarness, importInput, metric, terminalCollection } from './lingxing-import-test-fixture';
describe('LingxingImportRepository', () => {
it('isolates two stores with the same business date and filename across every import table', () => {
    const { repository, storeA, storeB } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-a'));
    repository.saveCollectionSnapshotForStore(storeB, collectionSnapshot(storeB, 'Shop Beta', 'batch-b'));
    repository.commitImportForStore(storeA, importInput('Shop Alpha', 'batch-a'));
    repository.commitImportForStore(storeB, importInput('Shop Beta', 'batch-b'));
    expect(repository.listBatchesForStore(storeA)).toEqual([
        expect.objectContaining({ storeId: storeA, id: 'batch-a', dateStart: '2026-07-21' }),
    ]);
    expect(repository.getCollectionSnapshotForStore(storeA, 'batch-b')).toBeUndefined();
    expect(repository.listReportFilesForStore(storeA, 'batch-a')).toEqual([
        expect.objectContaining({ storeId: storeA, fileName: 'keyword-2026-07-21.xlsx' }),
    ]);
    expect(repository.listReportFilesForStore(storeB, 'batch-b')).toEqual([
        expect.objectContaining({ storeId: storeB, fileName: 'keyword-2026-07-21.xlsx' }),
    ]);
    expect(repository.listAdMetricsForStore(storeA, 'batch-a')).toEqual([
        expect.objectContaining({ storeId: storeA, storeName: 'Shop Alpha', cost: 10.01 }),
    ]);
    expect(repository.listAdMetricsForStore(storeB, 'batch-b')).toEqual([
        expect.objectContaining({ storeId: storeB, storeName: 'Shop Beta', cost: 10.01 }),
    ]);
    expect(repository.listImportRunsForStore(storeA)).toHaveLength(1);
    expect(repository.listImportRunsForStore(storeB)).toHaveLength(1);
    expect(repository.listFileSnapshotsForStore(storeA, 'run-shared')).toEqual([
        expect.objectContaining({ storeId: storeA, batchId: 'batch-a', fileName: 'keyword-2026-07-21.xlsx' }),
    ]);
});

it('binds new batches to the current Lingxing selector while preserving historical selector snapshots', () => {
    const { database, repository, storeA, storeB } = createHarness();
    const storeRepository = new StoreRepository(database);
    const connection = storeRepository.createConnection({
        id: normalizeStoreCapabilityId('cap-selector-snapshot-a'),
        storeId: storeA,
        provider: 'lingxing',
        collectionStoreName: 'Lingxing US Store',
    });
    const historical = terminalCollection(storeA, 'profile-a', 'Lingxing US Store', 'batch-selector-history');
    const committed = repository.commitCollectionTerminalForStore(storeA, historical);
    expect(committed.batch).toMatchObject({
        storeId: storeA,
        storeName: 'Lingxing US Store',
        browserProfileId: 'profile-a',
        sessionGeneration: 3,
        marketplaceCode: 'US',
    });
    storeRepository.updateConnection({
        id: connection.id,
        storeId: storeA,
        expectedUpdatedAt: connection.updatedAt,
        collectionStoreName: 'Lingxing US Store Renamed',
    });
    expect(repository.getCollectionSnapshotForStore(storeA, historical.batch.id)?.batch.storeName)
        .toBe('Lingxing US Store');
    expect(repository.saveCollectionSnapshotForStore(storeA, historical).batch.storeName)
        .toBe('Lingxing US Store');
    expect(() => repository.saveCollectionSnapshotForStore(storeA, {
        ...historical,
        batch: {
            ...historical.batch,
            storeName: 'Lingxing US Store Renamed',
        },
    })).toThrow(/LINGXING_BATCH_AUTHORITY_IMMUTABLE/);
    expect(repository.commitImportForStore(storeA, importInput('Lingxing US Store', historical.batch.id, {
        runId: 'run-selector-history',
        idempotencyKey: 'selector-history-key',
    })).deduplicated).toBe(false);
    expect(repository.listAdMetricsForStore(storeA, historical.batch.id)).toEqual([
        expect.objectContaining({
            storeId: storeA,
            storeName: 'Lingxing US Store',
        }),
    ]);
    expect(() => repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Lingxing US Store', 'batch-stale-selector-forged'))).toThrow(/既不匹配当前 collection selector.*本地逻辑店铺名/);
    expect(() => repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Arbitrary Third Name', 'batch-third-name-forged'))).toThrow(/既不匹配当前 collection selector.*本地逻辑店铺名/);
    expect(repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Lingxing US Store Renamed', 'batch-current-selector')).batch.storeName).toBe('Lingxing US Store Renamed');
    expect(repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-logical-local-import')).batch.storeName).toBe('Shop Alpha');
    expect(repository.getCollectionSnapshotForStore(storeB, historical.batch.id)).toBeUndefined();
    expect(() => repository.commitImportForStore(storeB, importInput('Lingxing US Store', historical.batch.id, {
        runId: 'run-cross-store-selector-history',
        idempotencyKey: 'cross-store-selector-history-key',
    }))).toThrow(/不属于店铺/);
});

it('deduplicates an identical import by store and rejects idempotency-key payload drift', () => {
    const { database, repository, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-a'));
    const input = importInput('Shop Alpha', 'batch-a');
    expect(repository.commitImportForStore(storeA, input).deduplicated).toBe(false);
    expect(repository.commitImportForStore(storeA, {
        ...input,
        runId: 'retry-run-id-is-deduplicated-by-key',
        files: [...input.files].reverse(),
        metrics: [...input.metrics].reverse(),
    }).deduplicated).toBe(true);
    expect(() => repository.commitImportForStore(storeA, {
        ...input,
        metrics: [{ ...input.metrics[0], clicks: 11 }],
    })).toThrow(/幂等键.*不同输入|不可变历史/);
    expect(database.prepare('SELECT COUNT(*) AS count FROM report_import_runs').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM report_import_file_snapshots').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM ad_daily_metrics').get()).toEqual({ count: 1 });
});

it('keeps implicit import completion/creation at or after an explicit future startedAt', () => {
    const { repository, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-future-start'));
    const startedAt = new Date(Date.now() + 60000).toISOString();
    const result = repository.commitImportForStore(storeA, importInput('Shop Alpha', 'batch-future-start', {
        runId: 'run-future-start',
        idempotencyKey: 'future-start-key',
        startedAt,
        completedAt: undefined,
    }));
    expect(Date.parse(result.run.completedAt)).toBeGreaterThanOrEqual(Date.parse(startedAt));
    expect(Date.parse(result.run.createdAt)).toBeGreaterThanOrEqual(Date.parse(result.run.completedAt));
});

it('rejects a past explicit completedAt when startedAt defaults to now without durable side effects', () => {
    const { database, repository, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-reversed-run'));
    const completedAt = new Date(Date.now() - 60000).toISOString();
    expect(() => repository.commitImportForStore(storeA, importInput('Shop Alpha', 'batch-reversed-run', {
        runId: 'run-reversed',
        idempotencyKey: 'reversed-key',
        startedAt: undefined,
        completedAt,
    }))).toThrow(/IMPORT_RUN_TIMELINE_INVALID/);
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM report_import_runs WHERE store_id = ? AND run_id = ?
    `).get(storeA, 'run-reversed')).toEqual({ count: 0 });
});

it('rolls back run, report file, immutable snapshot and metrics when a later metric is invalid', () => {
    const { database, repository, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-a'));
    const valid = metric('Shop Alpha', 'batch-a');
    const invalid = metric('Shop Beta', 'batch-a', { sourceRow: 3, searchTerm: 'invalid store row' });
    expect(() => repository.commitImportForStore(storeA, importInput('Shop Alpha', 'batch-a', {
        metrics: [valid, invalid],
        reconciliations: [],
    }))).toThrow(/权威记录不一致/);
    for (const table of [
        'report_import_runs',
        'report_import_file_snapshots',
        'report_import_reconciliations',
        'report_files',
        'ad_daily_metrics',
    ]) {
        expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
});

it('reconciles one control-total across the complete two-day batch window', () => {
    const { repository, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-two-day', { dateStart: '2026-07-20', dateEnd: '2026-07-21' }));
    repository.commitImportForStore(storeA, importInput('Shop Alpha', 'batch-two-day', {
        runId: 'run-two-day',
        idempotencyKey: 'two-day-window',
        files: [{
                ...importInput('Shop Alpha', 'batch-two-day').files[0]!,
                lingxingFileId: 'batch-two-day-keyword',
                importedRows: 2,
            }],
        metrics: [
            metric('Shop Alpha', 'batch-two-day', {
                date: '2026-07-20',
                cost: 4,
                sourceRow: 2,
            }),
            metric('Shop Alpha', 'batch-two-day', {
                date: '2026-07-21',
                cost: 6,
                searchTerm: 'smart lock second day',
                sourceRow: 3,
            }),
        ],
        reconciliations: [{
                dateStart: '2026-07-20',
                dateEnd: '2026-07-21',
                metricDate: '2026-07-21',
                reportType: 'keyword',
                expectedRows: 2,
                expectedCost: 10,
            }],
    }));
    expect(repository.listReconciliationsForStore(storeA, 'run-two-day')).toEqual([
        expect.objectContaining({
            dateStart: '2026-07-20',
            dateEnd: '2026-07-21',
            metricDate: '2026-07-21',
            actualRows: 2,
            actualCost: 10,
            status: 'matched',
        }),
    ]);
});

it('keeps an imported two-day batch window immutable when the same batch id is replayed as one day', () => {
    const { repository, storeA } = createHarness();
    const original = collectionSnapshot(storeA, 'Shop Alpha', 'batch-two-day-immutable', { dateStart: '2026-07-20', dateEnd: '2026-07-21' });
    repository.saveCollectionSnapshotForStore(storeA, original);
    repository.commitImportForStore(storeA, importInput('Shop Alpha', original.batch.id, {
        runId: 'run-two-day-immutable',
        idempotencyKey: 'two-day-immutable',
        files: [{
                ...importInput('Shop Alpha', original.batch.id).files[0]!,
                lingxingFileId: `${original.batch.id}-keyword`,
                importedRows: 2,
            }],
        metrics: [
            metric('Shop Alpha', original.batch.id, { date: '2026-07-20', cost: 4, sourceRow: 2 }),
            metric('Shop Alpha', original.batch.id, {
                date: '2026-07-21',
                cost: 6,
                sourceRow: 3,
                searchTerm: 'immutable second day',
            }),
        ],
        reconciliations: [{
                dateStart: '2026-07-20',
                dateEnd: '2026-07-21',
                metricDate: '2026-07-21',
                reportType: 'keyword',
                expectedRows: 2,
                expectedCost: 10,
            }],
    }));
    expect(() => repository.saveCollectionSnapshotForStore(storeA, {
        ...original,
        batch: {
            ...original.batch,
            dateStart: '2026-07-21',
            dateEnd: '2026-07-21',
        },
    })).toThrow(/LINGXING_BATCH_AUTHORITY_IMMUTABLE/);
    expect(() => repository.saveCollectionSnapshotForStore(storeA, {
        ...original,
        batch: {
            ...original.batch,
            downloadDir: 'C:/drifted-download-directory',
            manifestPath: 'C:/drifted-download-directory/manifest.json',
        },
    })).toThrow(/IMPORTED_BATCH_AUTHORITY_IMMUTABLE/);
    expect(repository.listBatchesForStore(storeA)).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: original.batch.id,
            dateStart: '2026-07-20',
            dateEnd: '2026-07-21',
        }),
    ]));
    expect(repository.listReconciliationsForStore(storeA, 'run-two-day-immutable')).toEqual([
        expect.objectContaining({
            dateStart: '2026-07-20',
            dateEnd: '2026-07-21',
            actualRows: 2,
            actualCost: 10,
        }),
    ]);
    expect(repository.getImportRunForStore(storeA, 'run-two-day-immutable')).toMatchObject({
        batchId: original.batch.id,
        status: 'completed',
        sourceFileCount: 1,
        reconciliationCount: 1,
    });
});

it.each([
    {
        label: 'partial control-total window',
        reconciliation: {
            dateStart: '2026-07-21',
            dateEnd: '2026-07-21',
            metricDate: '2026-07-21',
            reportType: 'keyword',
            expectedRows: 1,
            expectedCost: 6,
        },
        error: /IMPORT_RECONCILIATION_WINDOW_MISMATCH/,
    },
    {
        label: 'wrong complete-window total',
        reconciliation: {
            dateStart: '2026-07-20',
            dateEnd: '2026-07-21',
            metricDate: '2026-07-21',
            reportType: 'keyword',
            expectedRows: 2,
            expectedCost: 9,
        },
        error: /IMPORT_RECONCILIATION_MISMATCH/,
    },
])('atomically rejects a two-day import with $label', ({ reconciliation, error }) => {
    const { database, repository, storeA } = createHarness();
    const batchId = `batch-two-day-failure-${reconciliation.expectedCost}`;
    const runId = `run-two-day-failure-${reconciliation.expectedCost}`;
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', batchId, { dateStart: '2026-07-20', dateEnd: '2026-07-21' }));
    const input = importInput('Shop Alpha', batchId, {
        runId,
        idempotencyKey: `${runId}-key`,
        metrics: [
            metric('Shop Alpha', batchId, { date: '2026-07-20', cost: 4, sourceRow: 2 }),
            metric('Shop Alpha', batchId, {
                date: '2026-07-21',
                cost: 6,
                searchTerm: 'smart lock second day',
                sourceRow: 3,
            }),
        ],
        reconciliations: [reconciliation],
    });
    expect(() => repository.commitImportForStore(storeA, input)).toThrow(error);
    for (const [table, predicate] of [
        ['report_import_runs', 'run_id = ?'],
        ['report_import_file_snapshots', 'run_id = ?'],
        ['report_import_reconciliations', 'run_id = ?'],
        ['report_files', 'batch_id = ?'],
        ['ad_daily_metrics', 'batch_id = ?'],
    ] as const) {
        const identity = predicate.startsWith('run_id') ? runId : batchId;
        expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE store_id = ? AND ${predicate}`).get(storeA, identity)).toEqual({ count: 0 });
    }
});

it.each([
    {
        label: 'an extra metric report type without a reconciliation',
        build: (batchId: string) => importInput('Shop Alpha', batchId, {
            runId: 'run-extra-report-type',
            idempotencyKey: 'extra-report-type',
            metrics: [
                metric('Shop Alpha', batchId),
                metric('Shop Alpha', batchId, {
                    reportType: 'campaign',
                    campaignName: 'uncovered campaign',
                    searchTerm: 'uncovered campaign metric',
                    sourceRow: 3,
                }),
            ],
        }),
        error: /IMPORT_METRIC_REPORT_TYPE_UNCOVERED/,
    },
    {
        label: 'a file imported-row count that differs from its metrics and reconciliation',
        build: (batchId: string) => importInput('Shop Alpha', batchId, {
            runId: 'run-file-row-drift',
            idempotencyKey: 'file-row-drift',
            files: [{
                    ...importInput('Shop Alpha', batchId).files[0]!,
                    importedRows: 2,
                }],
        }),
        error: /IMPORT_REPORT_ROW_COUNT_MISMATCH/,
    },
])('atomically rejects exact-count drift from $label', ({ build, error }) => {
    const { database, repository, storeA } = createHarness();
    const batchId = 'batch-exact-count-drift';
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', batchId));
    expect(() => repository.commitImportForStore(storeA, build(batchId))).toThrow(error);
    for (const table of [
        'report_import_runs',
        'report_import_file_snapshots',
        'report_import_reconciliations',
        'report_files',
        'ad_daily_metrics',
    ]) {
        expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
});

it('treats exactly USD 0.01 as matched and USD 0.0101 as a mismatch', () => {
    expect(reconcileUsdAmount(10, 10.01)).toEqual(expect.objectContaining({
        absoluteDelta1e4: 100,
        tolerance1e4: 100,
        withinTolerance: true,
    }));
    expect(reconcileUsdAmount(10, 10.0101)).toEqual(expect.objectContaining({
        absoluteDelta1e4: 101,
        tolerance1e4: 100,
        withinTolerance: false,
    }));
    const { repository, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-a'));
    repository.commitImportForStore(storeA, importInput('Shop Alpha', 'batch-a', {
        metrics: [metric('Shop Alpha', 'batch-a', { cost: 10.01 })],
        reconciliations: [
            {
                dateStart: '2026-07-21', dateEnd: '2026-07-21', metricDate: '2026-07-21',
                reportType: 'keyword', expectedRows: 1, expectedCost: 10,
            },
        ],
    }));
    expect(repository.listReconciliationsForStore(storeA, 'run-shared')).toEqual([
        expect.objectContaining({ metricDate: '2026-07-21', absoluteCostDelta: 0.01, status: 'matched' }),
    ]);
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-b'));
    expect(() => repository.commitImportForStore(storeA, importInput('Shop Alpha', 'batch-b', {
        runId: 'run-mismatch',
        idempotencyKey: 'mismatch-key',
        metrics: [metric('Shop Alpha', 'batch-b', { cost: 10.0101 })],
        reconciliations: [
            {
                dateStart: '2026-07-21', dateEnd: '2026-07-21', metricDate: '2026-07-21',
                reportType: 'keyword', expectedRows: 1, expectedCost: 10,
            },
        ],
    }))).toThrow(/IMPORT_RECONCILIATION_MISMATCH/);
    expect(repository.getImportRunForStore(storeA, 'run-mismatch')).toBeUndefined();
    expect(repository.listReportFilesForStore(storeA, 'batch-b')).toEqual([]);
    expect(repository.listAdMetricsForStore(storeA, 'batch-b')).toEqual([]);
    expect(repository.listFileSnapshotsForStore(storeA, 'run-mismatch')).toEqual([]);
});

it('protects completed run, file snapshot and reconciliation rows from update or delete', () => {
    const { database, repository, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-a'));
    repository.commitImportForStore(storeA, importInput('Shop Alpha', 'batch-a'));
    expect(() => database.prepare(`
      UPDATE report_import_runs SET completed_at = '2099-01-01' WHERE store_id = ?
    `).run(storeA)).toThrow(/immutable/);
    expect(() => database.prepare(`
      DELETE FROM report_import_file_snapshots WHERE store_id = ?
    `).run(storeA)).toThrow(/immutable/);
    expect(() => database.prepare(`
      UPDATE report_import_reconciliations SET status = 'mismatch' WHERE store_id = ?
    `).run(storeA)).toThrow(/immutable/);
});
});
