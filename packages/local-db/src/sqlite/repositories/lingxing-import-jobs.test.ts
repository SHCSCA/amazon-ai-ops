// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { type LingxingCollectionJobSnapshot, LingxingImportRepository, databases, describe, expect, initSqlite, it, normalizeStoreContextEnvelope } from './lingxing-import-test-environment';
import { collectionJob, createHarness, terminalCollection } from './lingxing-import-test-fixture';
describe('LingxingImportRepository', () => {
it('persists a full-job lineage and rejects unbound or cross-window continuations', () => {
    const { repository, storeA, storeB } = createHarness();
    const expectedReportTypes = [
        'campaign', 'ad_group', 'placement', 'advertised_product',
        'auto_targeting', 'keyword', 'product_targeting', 'user_search_term',
    ] as const;
    const rootBase = collectionJob(storeA, 'profile-a', 'queued', '2026-07-22T00:01:00.000Z');
    const root: LingxingCollectionJobSnapshot = {
        ...rootBase,
        request: { ...rootBase.request, reportTypes: expectedReportTypes },
        lineage: {
            lineageId: rootBase.jobId,
            rootJobId: rootBase.jobId,
            expectedReportTypes,
            purpose: 'production_full',
        },
        reports: expectedReportTypes.map((reportType) => ({
            reportType,
            state: 'queued' as const,
            attemptIndex: 0,
            autoRetryCount: 0,
            updatedAt: rootBase.updatedAt,
        })),
    };
    repository.upsertCollectionJobSnapshotForStore(storeA, root);
    const continuationBase = collectionJob(storeA, 'profile-a', 'queued', '2026-07-22T00:02:00.000Z');
    const continuation: LingxingCollectionJobSnapshot = {
        ...continuationBase,
        jobId: 'resume-job-1',
        request: { ...continuationBase.request, requestId: 'resume-request-1' },
        lineage: {
            lineageId: root.jobId,
            rootJobId: root.jobId,
            parentJobId: root.jobId,
            expectedReportTypes,
            purpose: 'resume',
        },
    };
    repository.upsertCollectionJobSnapshotForStore(storeA, continuation);
    expect(repository.getCollectionJobForStore(storeA, continuation.jobId)?.lineage)
        .toEqual(continuation.lineage);
    expect(() => repository.upsertCollectionJobSnapshotForStore(storeA, {
        ...continuation,
        jobId: 'unbound-resume',
        lineage: { ...continuation.lineage!, parentJobId: 'missing-parent' },
    })).toThrow('父任务不存在');
    expect(() => repository.upsertCollectionJobSnapshotForStore(storeA, {
        ...continuation,
        jobId: 'wrong-window-resume',
        request: { ...continuation.request, dateEnd: '2026-07-22' },
    })).toThrow('日期窗或授权范围不一致');
    expect(() => repository.upsertCollectionJobSnapshotForStore(storeB, {
        ...continuation,
        jobId: 'cross-store-resume',
        request: {
            ...continuation.request,
            storeContext: normalizeStoreContextEnvelope({
                ...continuation.request.storeContext,
                storeId: storeB,
                browserProfileId: 'profile-b',
            }),
        },
    })).toThrow('父任务不存在于当前店铺');
    expect(() => repository.upsertCollectionJobSnapshotForStore(storeA, {
        ...continuation,
        jobId: 'canary-class-resume',
        request: { ...continuation.request, requestId: 'canary:resume-request-1' },
    })).toThrow('日期窗或授权范围不一致');
});

it('atomically commits the completed job and its terminal batch/files without a nested transaction', () => {
    const { database, repository, storeA } = createHarness();
    const terminalBase = terminalCollection(storeA, 'profile-a', 'Shop Alpha', 'terminal-batch-a');
    const terminal = {
        ...terminalBase,
        job: { ...terminalBase.job, importState: 'pending' as const },
    };
    const running = {
        ...terminal.job,
        state: 'running' as const,
        reports: terminal.job.reports.map((checkpoint) => ({
            ...checkpoint,
            state: 'downloading' as const,
        })),
        completedAt: undefined,
        importState: undefined,
        updatedAt: '2026-07-22T00:04:00.000Z',
    };
    repository.upsertCollectionJobSnapshotForStore(storeA, running);
    const committed = repository.commitCollectionTerminalForStore(storeA, terminal);
    expect(committed.job).toEqual(expect.objectContaining({
        jobId: 'terminal-batch-a',
        state: 'completed',
        importState: 'pending',
        completedAt: '2026-07-22T00:05:00.000Z',
    }));
    expect(repository.getCollectionJobForStore(storeA, 'terminal-batch-a'))
        .toEqual(expect.objectContaining({ state: 'completed' }));
    expect(repository.getCollectionSnapshotForStore(storeA, 'terminal-batch-a')).toEqual({
        batch: expect.objectContaining({
            id: 'terminal-batch-a',
            storeId: storeA,
            requestId: 'request-1',
            status: 'completed',
        }),
        files: [expect.objectContaining({
                batchId: 'terminal-batch-a',
                storeId: storeA,
                status: 'downloaded',
            })],
    });
    expect(database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM lingxing_collection_jobs WHERE store_id = ?) AS jobs,
        (SELECT COUNT(*) FROM lingxing_report_batches WHERE store_id = ?) AS batches,
        (SELECT COUNT(*) FROM lingxing_report_files WHERE store_id = ?) AS files
    `).get(storeA, storeA, storeA)).toEqual({ jobs: 1, batches: 1, files: 1 });
    repository.upsertCollectionJobSnapshotForStore(storeA, {
        ...committed.job,
        importState: 'succeeded',
        importAttemptedAt: '2026-07-22T00:05:01.000Z',
        importCompletedAt: '2026-07-22T00:05:02.000Z',
        updatedAt: '2026-07-22T00:05:02.000Z',
    });
    expect(repository.getCollectionJobForStore(storeA, 'terminal-batch-a'))
        .toEqual(expect.objectContaining({
        importState: 'succeeded',
        importAttemptedAt: '2026-07-22T00:05:01.000Z',
        importCompletedAt: '2026-07-22T00:05:02.000Z',
    }));
});

it('pages a completed-with-errors job when at least one downloaded checkpoint has a verified file', () => {
    const { repository, storeA } = createHarness();
    const terminal = terminalCollection(storeA, 'profile-a', 'Shop Alpha', 'partial-terminal');
    const failedAt = '2026-07-22T00:05:00.000Z';
    const partial = {
        ...terminal,
        job: {
            ...terminal.job,
            state: 'completed_with_errors' as const,
            importState: 'pending' as const,
            request: {
                ...terminal.job.request,
                reportTypes: ['keyword', 'campaign'] as const,
            },
            reports: [
                ...terminal.job.reports,
                {
                    reportType: 'campaign' as const,
                    state: 'failed' as const,
                    attemptIndex: 2,
                    autoRetryCount: 2,
                    errorCode: 'LINGXING_COLLECTION_STEP_FAILED',
                    updatedAt: failedAt,
                },
            ],
        },
        batch: { ...terminal.batch, status: 'completed_with_errors' as const },
        files: [
            ...terminal.files,
            {
                id: 'partial-terminal-campaign',
                batchId: 'partial-terminal',
                reportType: 'campaign' as const,
                displayName: '广告活动报表',
                status: 'failed' as const,
                fileSizeBytes: 0,
                createdAt: failedAt,
                updatedAt: failedAt,
            },
        ],
    };
    repository.commitCollectionTerminalForStore(storeA, partial);
    const page = repository.listRecoverableCollectionImportsForStore(storeA, { limit: 10 });
    expect(page.jobs).toEqual([
        expect.objectContaining({
            jobId: 'partial-terminal',
            state: 'completed_with_errors',
            importState: 'pending',
        }),
    ]);
    expect(page.nextCursor).toBeUndefined();
});

it('walks every pending/failed recovery candidate by cursor instead of a recent-jobs cap', () => {
    const { repository, storeA } = createHarness();
    const expectedIds = ['recovery-a', 'recovery-b', 'recovery-c'];
    expectedIds.forEach((batchId, index) => {
        const terminal = terminalCollection(storeA, 'profile-a', 'Shop Alpha', batchId);
        const completedAt = `2026-07-22T00:0${index + 5}:00.000Z`;
        repository.commitCollectionTerminalForStore(storeA, {
            ...terminal,
            job: {
                ...terminal.job,
                importState: index === 1 ? 'failed' : 'pending',
                ...(index === 1 ? { importError: 'parser unavailable' } : {}),
                reports: terminal.job.reports.map((checkpoint) => ({ ...checkpoint, updatedAt: completedAt })),
                updatedAt: completedAt,
                completedAt,
            },
            batch: { ...terminal.batch, completedAt },
            files: terminal.files.map((file) => ({ ...file, updatedAt: completedAt })),
        });
    });
    const visited: string[] = [];
    let cursor: {
        updatedAt: string;
        jobId: string;
    } | undefined;
    do {
        const page = repository.listRecoverableCollectionImportsForStore(storeA, {
            limit: 1,
            ...(cursor ? { cursor } : {}),
        });
        visited.push(...page.jobs.map((job) => job.jobId));
        cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(visited)).toEqual(new Set(expectedIds));
    expect(visited).toHaveLength(expectedIds.length);
    expect(repository.listCollectionJobsForStore(storeA, 1)).toHaveLength(1);
});

it('does not offer an all-failed terminal job as a partial import recovery candidate', () => {
    const { repository, storeA } = createHarness();
    const terminal = terminalCollection(storeA, 'profile-a', 'Shop Alpha', 'all-failed-terminal');
    repository.commitCollectionTerminalForStore(storeA, {
        ...terminal,
        job: {
            ...terminal.job,
            state: 'completed_with_errors',
            importState: 'failed',
            importError: 'no verified report was downloaded',
            reports: terminal.job.reports.map((checkpoint) => ({ ...checkpoint, state: 'failed' as const })),
        },
        batch: { ...terminal.batch, status: 'completed_with_errors' },
        files: terminal.files.map((file) => ({ ...file, status: 'failed' as const })),
    });
    expect(repository.listRecoverableCollectionImportsForStore(storeA).jobs).toEqual([]);
});

it('rolls back terminal job, batch and prior file inserts when a later file identity mismatches', () => {
    const { database, repository, storeA } = createHarness();
    const terminal = terminalCollection(storeA, 'profile-a', 'Shop Alpha', 'terminal-rollback');
    const mismatched = {
        ...terminal,
        files: [{ ...terminal.files[0], batchId: 'foreign-batch' }],
    };
    expect(() => repository.commitCollectionTerminalForStore(storeA, mismatched))
        .toThrow(/batchId.*不一致/);
    expect(repository.getCollectionJobForStore(storeA, 'terminal-rollback')).toBeUndefined();
    expect(repository.getCollectionSnapshotForStore(storeA, 'terminal-rollback')).toBeUndefined();
    expect(database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM lingxing_collection_jobs) AS jobs,
        (SELECT COUNT(*) FROM lingxing_collection_report_checkpoints) AS checkpoints,
        (SELECT COUNT(*) FROM lingxing_report_batches) AS batches,
        (SELECT COUNT(*) FROM lingxing_report_files) AS files
    `).get()).toEqual({ jobs: 0, checkpoints: 0, batches: 0, files: 0 });
});

it('persists every path-free progress event and restores a store-scoped resume state after reopen', () => {
    const { database, databasePath, repository, storeA, storeB } = createHarness();
    const queued = collectionJob(storeA, 'profile-a', 'queued', '2026-07-22T00:00:01.000Z');
    const created = {
        ...collectionJob(storeA, 'profile-a', 'running', '2026-07-22T00:00:02.000Z'),
        detail: 'provider detail saved at C:\\private\\collector\\state.json',
    };
    repository.upsertCollectionProgressForStore(storeA, {
        eventId: 'event-1',
        emittedAt: queued.updatedAt,
        job: queued,
    });
    const saved = repository.upsertCollectionProgressForStore(storeA, {
        eventId: 'event-2',
        emittedAt: created.updatedAt,
        changedReportType: 'keyword',
        externalStep: 'create',
        job: created,
    });
    expect(saved.detail).toBe('provider detail saved at [local-path-redacted]');
    expect(() => repository.upsertCollectionProgressForStore(storeA, {
        eventId: 'event-stale',
        emittedAt: queued.updatedAt,
        job: queued,
    })).toThrow(/拒绝回退/);
    expect(repository.getCollectionJobForStore(storeB, created.jobId)).toBeUndefined();
    const raw = database.prepare(`
      SELECT snapshot_json AS snapshotJson FROM lingxing_collection_jobs
      WHERE store_id = ? AND job_id = ?
    `).get(storeA, created.jobId) as {
        snapshotJson: string;
    };
    expect(raw.snapshotJson).not.toMatch(/filePath|downloadDir|manifestPath|C:\\|C:\//);
    database.close();
    const reopened = initSqlite(databasePath);
    databases.push(reopened);
    const reopenedRepository = new LingxingImportRepository(reopened);
    expect(reopenedRepository.listCollectionJobsForStore(storeA)).toEqual([
        expect.objectContaining({ jobId: created.jobId, state: 'running' }),
    ]);
    expect(reopenedRepository.getCollectionResumeStateForStore(storeA, created.jobId)).toEqual({
        jobId: created.jobId,
        request: created.request,
        reports: [expect.objectContaining({
                reportType: 'keyword',
                state: 'created',
                createdReportIdentity: expect.objectContaining({ externalReportId: 'lx-report-1' }),
            })],
    });
    expect(reopenedRepository.findLatestCollectionResumeStateForStore(storeA, 'request-1'))
        .toEqual(expect.objectContaining({ jobId: created.jobId }));
});

it('persists cancellation before acknowledgement and keeps it terminal after immediate reopen', () => {
    const { database, databasePath, repository, storeA } = createHarness();
    const running = collectionJob(storeA, 'profile-a', 'running', '2026-07-22T00:01:00.000Z');
    repository.upsertCollectionJobSnapshotForStore(storeA, running);
    const cancelled = repository.cancelCollectionJobForStore(storeA, running.jobId, {
        requestId: running.request.requestId,
        completedAt: '2026-07-22T00:02:00.000Z',
    });
    expect(cancelled).toEqual(expect.objectContaining({
        state: 'cancelled',
        completedAt: '2026-07-22T00:02:00.000Z',
        blockerCode: 'LINGXING_COLLECTION_CANCELLED_BY_OPERATOR',
        importState: 'not_applicable',
    }));
    expect(cancelled.reports).toEqual([
        expect.objectContaining({ reportType: 'keyword', state: 'cancelled' }),
    ]);
    database.close();
    const reopened = initSqlite(databasePath);
    databases.push(reopened);
    const reopenedRepository = new LingxingImportRepository(reopened);
    expect(reopenedRepository.getCollectionJobForStore(storeA, running.jobId))
        .toEqual(expect.objectContaining({ state: 'cancelled' }));
    const lateRunning = {
        ...running,
        updatedAt: '2026-07-22T00:03:00.000Z',
        reports: running.reports.map((checkpoint) => ({
            ...checkpoint,
            updatedAt: '2026-07-22T00:03:00.000Z',
        })),
    };
    expect(reopenedRepository.upsertCollectionProgressForStore(storeA, {
        eventId: 'late-runner-progress',
        emittedAt: lateRunning.updatedAt,
        job: lateRunning,
    })).toEqual(expect.objectContaining({ state: 'cancelled' }));
    expect(reopenedRepository.getCollectionJobForStore(storeA, running.jobId))
        .toEqual(expect.objectContaining({ state: 'cancelled' }));
});

it('closes every queued/running orphan as cancelled during startup recovery', () => {
    const { repository, storeA } = createHarness();
    const queued = collectionJob(storeA, 'profile-a', 'queued', '2026-07-22T00:01:00.000Z');
    const runningBase = collectionJob(storeA, 'profile-a', 'running', '2026-07-22T00:01:30.000Z');
    const running = {
        ...runningBase,
        jobId: 'collection-job-2',
        request: { ...runningBase.request, requestId: 'request-2' },
    };
    repository.upsertCollectionJobSnapshotForStore(storeA, queued);
    repository.upsertCollectionJobSnapshotForStore(storeA, running);
    const recovered = repository.recoverInterruptedCollectionJobsForStore(storeA, {
        completedAt: '2026-07-22T00:02:00.000Z',
    });
    expect(recovered).toHaveLength(2);
    expect(recovered).toEqual(expect.arrayContaining([
        expect.objectContaining({
            jobId: queued.jobId,
            state: 'cancelled',
            blockerCode: 'LINGXING_COLLECTION_INTERRUPTED_BY_RESTART',
        }),
        expect.objectContaining({
            jobId: running.jobId,
            state: 'cancelled',
            blockerCode: 'LINGXING_COLLECTION_INTERRUPTED_BY_RESTART',
        }),
    ]));
    expect(repository.recoverInterruptedCollectionJobsForStore(storeA, {
        completedAt: '2026-07-22T00:03:00.000Z',
    })).toEqual([]);
});

it('accepts an older runner cancelled result without weakening the cancellation tombstone', () => {
    const { repository, storeA } = createHarness();
    const terminal = terminalCollection(storeA, 'profile-a', 'Shop Alpha', 'cancelled-runner-race');
    const running: LingxingCollectionJobSnapshot = {
        ...terminal.job,
        state: 'running',
        reports: terminal.job.reports.map((checkpoint) => ({
            ...checkpoint,
            state: 'created' as const,
            updatedAt: '2026-07-22T00:04:00.000Z',
        })),
        updatedAt: '2026-07-22T00:04:00.000Z',
    };
    delete running.completedAt;
    repository.upsertCollectionJobSnapshotForStore(storeA, running);
    repository.cancelCollectionJobForStore(storeA, running.jobId, {
        requestId: running.request.requestId,
        completedAt: '2026-07-22T00:06:00.000Z',
    });
    const runnerCancelled = {
        ...terminal,
        job: {
            ...terminal.job,
            state: 'cancelled' as const,
            importState: 'not_applicable' as const,
            blockerCode: 'LINGXING_COLLECTION_CANCELLED',
            updatedAt: '2026-07-22T00:05:00.000Z',
            completedAt: '2026-07-22T00:05:00.000Z',
        },
        batch: {
            ...terminal.batch,
            status: 'failed' as const,
            completedAt: '2026-07-22T00:05:00.000Z',
        },
    };
    const committed = repository.commitCollectionTerminalForStore(storeA, runnerCancelled);
    expect(committed.job).toEqual(expect.objectContaining({
        state: 'cancelled',
        blockerCode: 'LINGXING_COLLECTION_CANCELLED_BY_OPERATOR',
        completedAt: '2026-07-22T00:06:00.000Z',
    }));
    expect(committed.batch.status).toBe('failed');
    expect(() => repository.commitCollectionTerminalForStore(storeA, {
        ...terminal,
        job: {
            ...terminal.job,
            updatedAt: '2026-07-22T00:07:00.000Z',
            completedAt: '2026-07-22T00:07:00.000Z',
        },
        batch: { ...terminal.batch, completedAt: '2026-07-22T00:07:00.000Z' },
    })).toThrow(/已持久化取消终态/);
});
});
