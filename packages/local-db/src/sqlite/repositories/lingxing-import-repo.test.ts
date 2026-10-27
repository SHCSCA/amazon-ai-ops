// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { AUTHORITY_REPORT_TYPES, type Database, type LingxingCollectionJobSnapshot, type StoreId, describe, expect, it } from './lingxing-import-test-environment';
import { collectionJob, createHarness, fullAuthorityTerminal, persistSucceededAuthorityProof } from './lingxing-import-test-fixture';
describe('LingxingImportRepository', () => {
it('reads an exact store/request uniquely and fails closed on duplicate durable jobs', () => {
    const { repository, storeA, storeB } = createHarness();
    const first = collectionJob(storeA, 'profile-a', 'queued', '2026-07-22T00:01:00.000Z');
    expect(repository.findUniqueCollectionJobForStoreByRequestId(storeA, first.request.requestId))
        .toBeUndefined();
    repository.upsertCollectionJobSnapshotForStore(storeA, first);
    expect(repository.findUniqueCollectionJobForStoreByRequestId(storeA, first.request.requestId))
        .toEqual(first);
    expect(repository.findUniqueCollectionJobForStoreByRequestId(storeB, first.request.requestId))
        .toBeUndefined();
    repository.upsertCollectionJobSnapshotForStore(storeA, {
        ...first,
        jobId: 'collection-job-duplicate',
        updatedAt: '2026-07-22T00:02:00.000Z',
        reports: first.reports.map((checkpoint) => ({
            ...checkpoint,
            updatedAt: '2026-07-22T00:02:00.000Z',
        })),
    });
    expect(() => repository.findUniqueCollectionJobForStoreByRequestId(storeA, first.request.requestId)).toThrow(/多个 durable 采集任务/);
});

it('finds an exact full-eight semantic collection scope while keeping every scope axis isolated', () => {
    const { repository, storeA, storeB } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-authority-batch');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    const exactScope = {
        storeId: storeA,
        browserProfileId: 'profile-a',
        businessDate: terminal.job.request.storeContext.businessDate,
        dateStart: terminal.job.request.dateStart,
        dateEnd: terminal.job.request.dateEnd,
        mode: 'create-and-download' as const,
        reportTypes: AUTHORITY_REPORT_TYPES,
    };
    expect(repository.inspectUniqueCollectionJobForSemanticScope(exactScope)?.job.jobId)
        .toBe(terminal.job.jobId);
    expect(repository.inspectUniqueCollectionJobForSemanticScope({
        ...exactScope,
        storeId: storeB,
        browserProfileId: 'profile-b',
    })).toBeUndefined();
    expect(repository.inspectUniqueCollectionJobForSemanticScope({
        ...exactScope,
        browserProfileId: 'profile-b',
    })).toBeUndefined();
    expect(repository.inspectUniqueCollectionJobForSemanticScope({
        ...exactScope,
        businessDate: '2026-07-23',
    })).toBeUndefined();
    expect(repository.inspectUniqueCollectionJobForSemanticScope({
        ...exactScope,
        dateStart: '2026-07-20',
    })).toBeUndefined();
    expect(repository.inspectUniqueCollectionJobForSemanticScope({
        ...exactScope,
        dateEnd: '2026-07-22',
    })).toBeUndefined();
    expect(repository.inspectUniqueCollectionJobForSemanticScope({
        ...exactScope,
        reportTypes: [...AUTHORITY_REPORT_TYPES].reverse(),
    })?.job.jobId).toBe(terminal.job.jobId);
    expect(() => repository.inspectUniqueCollectionJobForSemanticScope({
        ...exactScope,
        reportTypes: AUTHORITY_REPORT_TYPES.slice(0, 7),
    } as never)).toThrow(/严格且不重复的 8\/8/);
});

it('returns queued authority for an exact semantic scope regardless of durable state', () => {
    const { repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-queued');
    const queued: LingxingCollectionJobSnapshot = {
        ...terminal.job,
        state: 'queued',
        reports: terminal.job.reports.map((checkpoint) => ({
            reportType: checkpoint.reportType,
            state: 'queued',
            attemptIndex: checkpoint.attemptIndex,
            autoRetryCount: checkpoint.autoRetryCount,
            updatedAt: terminal.job.createdAt,
        })),
        updatedAt: terminal.job.createdAt,
    };
    delete queued.completedAt;
    delete queued.importState;
    delete queued.importAttemptedAt;
    delete queued.importCompletedAt;
    repository.upsertCollectionJobSnapshotForStore(storeA, queued);
    expect(repository.inspectUniqueCollectionJobForSemanticScope({
        storeId: storeA,
        browserProfileId: 'profile-a',
        businessDate: '2026-07-22',
        dateStart: '2026-07-21',
        dateEnd: '2026-07-21',
        mode: 'create-and-download',
        reportTypes: AUTHORITY_REPORT_TYPES,
    })?.job.state).toBe('queued');
});

it('matches the exact full-eight report set independent of durable JSON array order', () => {
    const { repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-reordered');
    const reversedTypes = [...AUTHORITY_REPORT_TYPES].reverse();
    repository.commitCollectionTerminalForStore(storeA, {
        ...terminal,
        job: {
            ...terminal.job,
            request: {
                ...terminal.job.request,
                reportTypes: reversedTypes,
            },
            lineage: terminal.job.lineage ? {
                ...terminal.job.lineage,
                expectedReportTypes: reversedTypes,
            } : undefined,
        },
    });
    expect(repository.inspectUniqueCollectionJobForSemanticScope({
        storeId: storeA,
        browserProfileId: 'profile-a',
        businessDate: '2026-07-22',
        dateStart: '2026-07-21',
        dateEnd: '2026-07-21',
        mode: 'create-and-download',
        reportTypes: AUTHORITY_REPORT_TYPES,
    })?.job.jobId).toBe(terminal.job.jobId);
});

it('does not treat wrong mode or a partial report set as the exact full-eight scope', () => {
    const { repository, storeA } = createHarness();
    const wrongModeBase = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-wrong-mode');
    repository.commitCollectionTerminalForStore(storeA, {
        ...wrongModeBase,
        job: {
            ...wrongModeBase.job,
            request: {
                ...wrongModeBase.job.request,
                requestId: 'semantic-wrong-mode-request',
                mode: 'download-existing',
            },
        },
        batch: {
            ...wrongModeBase.batch,
            requestId: 'semantic-wrong-mode-request',
        },
    });
    const partialBase = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-partial');
    repository.commitCollectionTerminalForStore(storeA, {
        ...partialBase,
        job: {
            ...partialBase.job,
            request: {
                ...partialBase.job.request,
                requestId: 'semantic-partial-request',
                reportTypes: AUTHORITY_REPORT_TYPES.slice(0, 7),
            },
            lineage: undefined,
            reports: partialBase.job.reports.slice(0, 7),
        },
        batch: {
            ...partialBase.batch,
            requestId: 'semantic-partial-request',
        },
        files: partialBase.files.slice(0, 7),
    });
    expect(repository.inspectUniqueCollectionJobForSemanticScope({
        storeId: storeA,
        browserProfileId: 'profile-a',
        businessDate: '2026-07-22',
        dateStart: '2026-07-21',
        dateEnd: '2026-07-21',
        mode: 'create-and-download',
        reportTypes: AUTHORITY_REPORT_TYPES,
    })).toBeUndefined();
});

it('fails closed when two durable jobs claim the same semantic collection scope', () => {
    const { repository, storeA } = createHarness();
    const first = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-duplicate-a');
    const secondBase = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-duplicate-b');
    const second = {
        ...secondBase,
        job: {
            ...secondBase.job,
            request: {
                ...secondBase.job.request,
                requestId: 'authority-request-2',
            },
        },
        batch: {
            ...secondBase.batch,
            requestId: 'authority-request-2',
        },
    };
    repository.commitCollectionTerminalForStore(storeA, first);
    repository.commitCollectionTerminalForStore(storeA, second);
    expect(() => repository.inspectUniqueCollectionJobForSemanticScope({
        storeId: storeA,
        browserProfileId: 'profile-a',
        businessDate: '2026-07-22',
        dateStart: '2026-07-21',
        dateEnd: '2026-07-21',
        mode: 'create-and-download',
        reportTypes: AUTHORITY_REPORT_TYPES,
    })).toThrow(/多个 durable 采集任务|拒绝歧义回读/);
});

it.each([
    {
        name: 'row/snapshot identity drift',
        tamper: (database: Database.Database, storeId: StoreId, terminal: ReturnType<typeof fullAuthorityTerminal>) => {
            const snapshot = {
                ...terminal.job,
                request: {
                    ...terminal.job.request,
                    storeContext: {
                        ...terminal.job.request.storeContext,
                        browserProfileId: 'profile-b',
                    },
                },
            };
            database.prepare(`
          UPDATE lingxing_collection_jobs
          SET snapshot_json = ?
          WHERE store_id = ? AND job_id = ?
        `).run(JSON.stringify(snapshot), storeId, terminal.job.jobId);
        },
    },
    {
        name: 'checkpoint mismatch',
        tamper: (database: Database.Database, storeId: StoreId, terminal: ReturnType<typeof fullAuthorityTerminal>) => {
            database.prepare(`
          DELETE FROM lingxing_collection_report_checkpoints
          WHERE store_id = ? AND job_id = ? AND report_type = 'keyword'
        `).run(storeId, terminal.job.jobId);
        },
    },
])('fails closed on semantic authority $name', ({ tamper }) => {
    const { database, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-tampered');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    tamper(database, storeA, terminal);
    expect(() => repository.inspectUniqueCollectionJobForSemanticScope({
        storeId: storeA,
        browserProfileId: 'profile-a',
        businessDate: '2026-07-22',
        dateStart: '2026-07-21',
        dateEnd: '2026-07-21',
        mode: 'create-and-download',
        reportTypes: AUTHORITY_REPORT_TYPES,
    })).toThrow(/authority proof.*不一致/);
});

it('fails closed when the exact core scope contains malformed durable report-set JSON', () => {
    const { database, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-malformed-report-set');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    database.prepare(`
      UPDATE lingxing_collection_jobs
      SET report_types_json = '{'
      WHERE store_id = ? AND job_id = ?
    `).run(storeA, terminal.job.jobId);
    expect(() => repository.inspectUniqueCollectionJobForSemanticScope({
        storeId: storeA,
        browserProfileId: 'profile-a',
        businessDate: '2026-07-22',
        dateStart: '2026-07-21',
        dateEnd: '2026-07-21',
        mode: 'create-and-download',
        reportTypes: AUTHORITY_REPORT_TYPES,
    })).toThrow(/损坏的 durable report-set/);
});

it('fails closed when a core-scope row carries a valid JSON report set that drifts from its snapshot', () => {
    const { database, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-valid-json-drift');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    database.prepare(`
      UPDATE lingxing_collection_jobs
      SET report_types_json = ?
      WHERE store_id = ? AND job_id = ?
    `).run(JSON.stringify(AUTHORITY_REPORT_TYPES.slice(0, 7)), storeA, terminal.job.jobId);
    expect(() => repository.inspectUniqueCollectionJobForSemanticScope({
        storeId: storeA,
        browserProfileId: 'profile-a',
        businessDate: '2026-07-22',
        dateStart: '2026-07-21',
        dateEnd: '2026-07-21',
        mode: 'create-and-download',
        reportTypes: AUTHORITY_REPORT_TYPES,
    })).toThrow(/authority proof.*不一致|损坏的 durable report-set/);
});

it('reads one transactionally coherent scheduler authority proof across job, 8 files and completed import evidence', () => {
    const { repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'authority-batch');
    const committed = repository.commitCollectionTerminalForStore(storeA, terminal);
    repository.commitImportForStore(storeA, {
        runId: 'authority-import-run',
        idempotencyKey: 'authority-import-key',
        batchId: terminal.batch.id,
        files: terminal.files.map((file, index) => ({
            lingxingFileId: file.id,
            reportType: file.reportType,
            filePath: file.filePath!,
            fileName: file.displayName,
            fileSizeBytes: file.fileSizeBytes!,
            fileHash: `${index + 1}`.repeat(64),
            importedRows: 0,
        })),
        metrics: [],
        reconciliations: AUTHORITY_REPORT_TYPES.map((reportType) => ({
            dateStart: '2026-07-21',
            dateEnd: '2026-07-21',
            metricDate: '2026-07-21',
            reportType,
            expectedRows: 0,
            expectedCost: 0,
        })),
        startedAt: '2026-07-22T00:05:01.000Z',
        completedAt: '2026-07-22T00:05:02.000Z',
    });
    repository.upsertCollectionJobSnapshotForStore(storeA, {
        ...committed.job,
        importState: 'succeeded',
        importAttemptedAt: '2026-07-22T00:05:01.000Z',
        importCompletedAt: '2026-07-22T00:05:02.000Z',
        updatedAt: '2026-07-22T00:05:02.000Z',
    });
    const proof = repository.readUniqueCollectionAuthorityProofForStoreByRequestId(storeA, terminal.job.request.requestId);
    expect(proof).toMatchObject({
        job: {
            jobId: terminal.job.jobId,
            state: 'completed',
            importState: 'succeeded',
        },
        jobRow: {
            storeId: storeA,
            jobId: terminal.job.jobId,
            requestId: terminal.job.request.requestId,
            browserProfileId: 'profile-a',
            state: 'completed',
        },
        checkpointCount: 8,
        batch: {
            id: terminal.batch.id,
            storeId: storeA,
            status: 'completed',
        },
        lingxingFileCount: 8,
        importRunCount: 1,
        importFileSnapshotCount: 8,
        importedReportFileCount: 8,
        reconciliationRowCount: 8,
    });
    expect(proof?.lingxingFiles.map((file) => file.reportType).sort())
        .toEqual([...AUTHORITY_REPORT_TYPES].sort());
    expect(proof?.importRuns).toEqual([
        expect.objectContaining({
            runId: 'authority-import-run',
            batchId: terminal.batch.id,
            status: 'completed',
            sourceFileCount: 8,
        }),
    ]);
    expect(proof?.importFileSnapshots.every((snapshot) => (snapshot.runId === 'authority-import-run'
        && snapshot.batchId === terminal.batch.id
        && snapshot.fileHash.length === 64
        && snapshot.fileSizeBytes === 2048
        && Boolean(snapshot.lingxingFileId)
        && Number.isInteger(snapshot.reportFileId)))).toBe(true);
    expect(proof?.importedReportFiles.every((file) => (file.status === 'imported'
        && file.fileHash?.length === 64
        && file.fileSizeBytes === 2048))).toBe(true);
    expect(proof?.reconciliations.every((row) => (row.runId === 'authority-import-run'
        && row.batchId === terminal.batch.id
        && row.status === 'matched'
        && row.withinTolerance))).toBe(true);
    proof!.lingxingFiles[0]!.displayName = 'caller-mutation.xlsx';
    expect(repository.readUniqueCollectionAuthorityProofForStoreByRequestId(storeA, terminal.job.request.requestId)?.lingxingFiles[0]?.displayName).not.toBe('caller-mutation.xlsx');
});

it.each([
    {
        name: 'SQL job identity drift',
        tamper: (database: Database.Database, storeId: StoreId, jobId: string) => {
            database.prepare(`
          UPDATE lingxing_collection_jobs
          SET browser_profile_id = 'profile-b'
          WHERE store_id = ? AND job_id = ?
        `).run(storeId, jobId);
        },
    },
    {
        name: 'checkpoint count drift',
        tamper: (database: Database.Database, storeId: StoreId, jobId: string) => {
            database.prepare(`
          DELETE FROM lingxing_collection_report_checkpoints
          WHERE store_id = ? AND job_id = ? AND report_type = 'keyword'
        `).run(storeId, jobId);
        },
    },
])('throws instead of returning a mixed authority proof after $name', ({ tamper }) => {
    const { database, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'tampered-authority-batch');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    tamper(database, storeA, terminal.job.jobId);
    expect(() => repository.readUniqueCollectionAuthorityProofForStoreByRequestId(storeA, terminal.job.request.requestId)).toThrow(/authority proof.*不一致/);
});

it.each([
    {
        name: 'batch created_at',
        tamper: (database: Database.Database, storeId: StoreId, jobId: string) => {
            database.prepare(`
          UPDATE lingxing_report_batches SET created_at = '1'
          WHERE store_id = ? AND id = ?
        `).run(storeId, jobId);
        },
    },
    {
        name: 'Lingxing file updated_at',
        tamper: (database: Database.Database, storeId: StoreId, jobId: string) => {
            database.prepare(`
          UPDATE lingxing_report_files SET updated_at = '1'
          WHERE store_id = ? AND batch_id = ? AND report_type = 'keyword'
        `).run(storeId, jobId);
        },
    },
])('rejects non-canonical UTC authority-proof $name', ({ tamper }) => {
    const { database, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'timestamp-authority-batch');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    tamper(database, storeA, terminal.job.jobId);
    expect(() => repository.readUniqueCollectionAuthorityProofForStoreByRequestId(storeA, terminal.job.request.requestId)).toThrow(/非规范 ISO-8601 UTC/);
});

it('rejects canonical succeeded-import timestamps when completed precedes started', () => {
    const { database, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'inverted-import-timeline');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    expect(() => repository.commitImportForStore(storeA, {
        runId: 'inverted-import-run',
        idempotencyKey: 'inverted-import-key',
        batchId: terminal.batch.id,
        files: terminal.files.map((file, index) => ({
            lingxingFileId: file.id,
            reportType: file.reportType,
            filePath: file.filePath!,
            fileName: file.displayName,
            fileSizeBytes: file.fileSizeBytes!,
            fileHash: `${index + 1}`.repeat(64),
            importedRows: 0,
        })),
        metrics: [],
        reconciliations: [],
        startedAt: '2026-07-22T00:05:03.000Z',
        completedAt: '2026-07-22T00:05:02.000Z',
    })).toThrow(/IMPORT_RUN_TIMELINE_INVALID/);
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM report_import_runs WHERE store_id = ? AND run_id = ?
    `).get(storeA, 'inverted-import-run')).toEqual({ count: 0 });
    expect(repository.readUniqueCollectionAuthorityProofForStoreByRequestId(storeA, terminal.job.request.requestId)).toMatchObject({ importRunCount: 0, importRuns: [] });
});

it.each([
    {
        name: 'run createdAt before completedAt',
        batchId: 'authority-timeline-run-created',
        tamper: (database: Database.Database, storeId: StoreId, batchId: string) => {
            database.exec('DROP TRIGGER trg_report_import_runs_immutable_update');
            database.prepare(`
          UPDATE report_import_runs
          SET created_at = '2026-07-22T00:06:59.000Z'
          WHERE store_id = ? AND batch_id = ?
        `).run(storeId, batchId);
        },
    },
    {
        name: 'imported file lastImportedAt before unique run start',
        batchId: 'authority-timeline-file-imported',
        tamper: (database: Database.Database, storeId: StoreId, batchId: string) => {
            database.prepare(`
          UPDATE report_files
          SET last_imported_at = '2026-07-22T00:05:30.000Z'
          WHERE store_id = ? AND batch_id = ?
        `).run(storeId, batchId);
        },
    },
])('rejects persisted succeeded authority proof with $name', ({ batchId, tamper }) => {
    const { database, repository, storeA } = createHarness();
    const terminal = persistSucceededAuthorityProof(repository, storeA, batchId);
    tamper(database, storeA, terminal.job.jobId);
    expect(() => repository.readUniqueCollectionAuthorityProofForStoreByRequestId(storeA, terminal.job.request.requestId)).toThrow(/authority proof.*时间顺序/);
});
});
