// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { AUTHORITY_REPORT_TYPES, type AdDailyMetrics, type CommitReportImportInput, type Database, type LingxingCollectionJobSnapshot, LingxingImportRepository, type LingxingReportBatch, type LingxingReportFile, type StoreId, databases, fs, initSqlite, normalizeStoreContextEnvelope, normalizeStoreId, os, path, tempDirectories } from './lingxing-import-test-environment';
function createHarness(): { database: Database.Database; databasePath: string; repository: LingxingImportRepository; storeA: StoreId; storeB: StoreId } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-lingxing-import-'));
    tempDirectories.push(directory);
    const database = initSqlite(path.join(directory, 'import.db'));
    databases.push(database);
    const storeA = normalizeStoreId('store-a');
    const storeB = normalizeStoreId('store-b');
    insertStore(database, storeA, 'profile-a', 'Shop Alpha');
    insertStore(database, storeB, 'profile-b', 'Shop Beta');
    return {
        database,
        databasePath: path.join(directory, 'import.db'),
        repository: new LingxingImportRepository(database),
        storeA,
        storeB,
    };
}

function collectionJob(storeId: StoreId, browserProfileId: string, state: LingxingCollectionJobSnapshot['state'], updatedAt: string): LingxingCollectionJobSnapshot {
    return {
        jobId: 'collection-job-1',
        request: {
            requestId: 'request-1',
            storeContext: normalizeStoreContextEnvelope({
                storeId,
                browserProfileId,
                marketplace: 'US',
                currency: 'USD',
                businessTimezone: 'America/Los_Angeles',
                businessDate: '2026-07-22',
                sessionGeneration: 3,
            }),
            dateStart: '2026-07-21',
            dateEnd: '2026-07-21',
            mode: 'create-and-download',
            reportTypes: ['keyword'],
        },
        state,
        reports: [{
                reportType: 'keyword',
                state: state === 'queued' ? 'queued' : 'created',
                attemptIndex: 0,
                autoRetryCount: 0,
                ...(state === 'queued' ? {} : {
                    createdReportIdentity: {
                        provider: 'lingxing' as const,
                        reportType: 'keyword' as const,
                        externalReportName: 'keyword-2026-07-21',
                        externalReportId: 'lx-report-1',
                        dateStart: '2026-07-21',
                        dateEnd: '2026-07-21',
                        createdAt: updatedAt,
                    },
                }),
                updatedAt,
            }],
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt,
    };
}

function terminalCollection(storeId: StoreId, browserProfileId: string, storeName: string, batchId: string) {
    const completedAt = '2026-07-22T00:05:00.000Z';
    const baseJob = collectionJob(storeId, browserProfileId, 'running', completedAt);
    const source = collectionSnapshot(storeId, storeName, batchId);
    return {
        job: {
            ...baseJob,
            jobId: batchId,
            state: 'completed' as const,
            reports: baseJob.reports.map((checkpoint) => ({
                ...checkpoint,
                state: 'downloaded' as const,
                fileSizeBytes: 2048,
                updatedAt: completedAt,
            })),
            updatedAt: completedAt,
            completedAt,
        },
        batch: {
            ...source.batch,
            requestId: baseJob.request.requestId,
            browserProfileId: baseJob.request.storeContext.browserProfileId,
            businessDate: baseJob.request.storeContext.businessDate,
            sessionGeneration: baseJob.request.storeContext.sessionGeneration,
            status: 'completed' as const,
            completedAt,
        },
        files: source.files.map((file) => ({
            ...file,
            status: 'downloaded' as const,
            updatedAt: completedAt,
        })),
    };
}

function fullAuthorityTerminal(storeId: StoreId, browserProfileId: string, batchId: string) {
    const completedAt = '2026-07-22T00:05:00.000Z';
    const context = normalizeStoreContextEnvelope({
        storeId,
        browserProfileId,
        marketplace: 'US',
        currency: 'USD',
        businessTimezone: 'America/Los_Angeles',
        businessDate: '2026-07-22',
        sessionGeneration: 3,
    });
    const reports = AUTHORITY_REPORT_TYPES.map((reportType) => ({
        reportType,
        state: 'downloaded' as const,
        attemptIndex: 0,
        autoRetryCount: 0,
        createdReportIdentity: {
            provider: 'lingxing' as const,
            reportType,
            externalReportName: `${reportType}-2026-07-21`,
            externalReportId: `external-${reportType}`,
            dateStart: '2026-07-21',
            dateEnd: '2026-07-21',
            createdAt: '2026-07-22T00:02:00.000Z',
        },
        fileSizeBytes: 2048,
        updatedAt: completedAt,
    }));
    const job: LingxingCollectionJobSnapshot = {
        jobId: batchId,
        request: {
            requestId: 'authority-request-1',
            storeContext: context,
            dateStart: '2026-07-21',
            dateEnd: '2026-07-21',
            mode: 'create-and-download',
            reportTypes: AUTHORITY_REPORT_TYPES,
        },
        lineage: {
            lineageId: batchId,
            rootJobId: batchId,
            expectedReportTypes: AUTHORITY_REPORT_TYPES,
            purpose: 'production_full',
        },
        state: 'completed',
        reports,
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: completedAt,
        completedAt,
        importState: 'pending',
    };
    const batch: LingxingReportBatch = {
        id: batchId,
        requestId: job.request.requestId,
        storeId,
        browserProfileId: context.browserProfileId,
        businessDate: context.businessDate,
        sessionGeneration: context.sessionGeneration,
        dateStart: job.request.dateStart,
        dateEnd: job.request.dateEnd,
        storeName: 'Shop Alpha',
        marketplaceCode: 'US',
        status: 'completed',
        downloadDir: `C:/${batchId}`,
        manifestPath: `C:/${batchId}/manifest.json`,
        createdAt: job.createdAt,
        completedAt,
    };
    const files: LingxingReportFile[] = AUTHORITY_REPORT_TYPES.map((reportType) => ({
        id: `${batchId}-${reportType}`,
        batchId,
        reportType,
        displayName: `${reportType}.xlsx`,
        status: 'downloaded',
        filePath: `C:/${batchId}/${reportType}.xlsx`,
        fileSizeBytes: 2048,
        createdAt: '2026-07-22T00:01:00.000Z',
        updatedAt: completedAt,
    }));
    return { job, batch, files };
}

function failedFullAuthorityTerminal(storeId: StoreId, batchId: string, downloadedCount = 3) {
    const terminal = fullAuthorityTerminal(storeId, 'profile-a', batchId);
    const failedAt = '2026-07-22T00:05:00.000Z';
    terminal.job = {
        ...terminal.job,
        state: 'failed',
        reports: terminal.job.reports.map((checkpoint, index) => (index < downloadedCount
            ? checkpoint
            : {
                reportType: checkpoint.reportType,
                state: 'failed' as const,
                attemptIndex: 0,
                autoRetryCount: 0,
                errorCode: 'LINGXING_COLLECTION_STEP_FAILED',
                detail: 'safe failure before report creation',
                updatedAt: failedAt,
            })),
        blockerCode: 'LINGXING_COLLECTION_STEP_FAILED',
        detail: 'resume fixture',
        updatedAt: failedAt,
        completedAt: failedAt,
        importState: 'not_applicable',
    };
    terminal.batch = {
        ...terminal.batch,
        status: 'failed',
        completedAt: failedAt,
    };
    terminal.files = terminal.files.slice(0, downloadedCount);
    return terminal;
}

function insertStore(database: Database.Database, storeId: StoreId, browserProfileId: string, displayName: string): void {
    database.prepare(`
    INSERT INTO stores (
      store_id, browser_profile_id, marketplace, currency, display_name,
      status, business_timezone, created_at, updated_at
    ) VALUES (?, ?, 'US', 'USD', ?, 'active', 'America/Los_Angeles', ?, ?)
  `).run(storeId, browserProfileId, displayName, '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z');
}

function collectionSnapshot(storeId: StoreId, storeName: string, batchId: string, window: {
    dateStart: string;
    dateEnd: string;
} = {
    dateStart: '2026-07-21',
    dateEnd: '2026-07-21',
}): {
    batch: LingxingReportBatch;
    files: LingxingReportFile[];
} {
    const fileId = `${batchId}-keyword`;
    return {
        batch: {
            id: batchId,
            storeId,
            dateStart: window.dateStart,
            dateEnd: window.dateEnd,
            storeName,
            marketplaceCode: 'US',
            status: 'completed',
            downloadDir: `C:/${batchId}`,
            manifestPath: `C:/${batchId}/manifest.json`,
            createdAt: '2026-07-22T00:00:00.000Z',
            completedAt: '2026-07-22T00:05:00.000Z',
        },
        files: [{
                id: fileId,
                batchId,
                reportType: 'keyword',
                displayName: '关键词报表',
                status: 'downloaded',
                filePath: 'C:/shared/keyword-2026-07-21.xlsx',
                fileSizeBytes: 2048,
                createdAt: '2026-07-22T00:01:00.000Z',
                updatedAt: '2026-07-22T00:04:00.000Z',
            }],
    };
}

function metric(storeName: string, batchId: string, overrides: Partial<AdDailyMetrics> = {}): AdDailyMetrics {
    return {
        batchId,
        reportType: 'keyword',
        date: '2026-07-21',
        storeName,
        marketplaceCode: 'US',
        asin: 'B0SHARED',
        msku: 'SHARED-MSKU',
        campaignName: 'Shared campaign',
        adGroupName: 'Shared group',
        targeting: 'smart lock',
        searchTerm: 'smart lock',
        matchType: 'exact',
        impressions: 100,
        clicks: 10,
        cost: 10.01,
        orders: 1,
        sales: 30,
        currency: 'USD',
        acos: 0.3337,
        cpc: 1.001,
        cvr: 0.1,
        sourceFile: 'C:/shared/keyword-2026-07-21.xlsx',
        sourceRow: 2,
        ...overrides,
    };
}

function importInput(storeName: string, batchId: string, overrides: Partial<CommitReportImportInput> = {}): CommitReportImportInput {
    return {
        runId: 'run-shared',
        idempotencyKey: 'daily-keyword-2026-07-21',
        batchId,
        files: [{
                lingxingFileId: `${batchId}-keyword`,
                reportType: 'keyword',
                filePath: 'C:/shared/keyword-2026-07-21.xlsx',
                fileName: 'keyword-2026-07-21.xlsx',
                fileSizeBytes: 2048,
                fileHash: 'abc123',
                importedRows: 1,
            }],
        metrics: [metric(storeName, batchId)],
        reconciliations: [{
                dateStart: '2026-07-21',
                dateEnd: '2026-07-21',
                metricDate: '2026-07-21',
                reportType: 'keyword',
                expectedRows: 1,
                expectedCost: 10,
            }],
        startedAt: '2026-07-22T00:06:00.000Z',
        completedAt: '2026-07-22T00:07:00.000Z',
        ...overrides,
    };
}

function fullAuthorityImportInput(terminal: ReturnType<typeof fullAuthorityTerminal>, startedAt: string, completedAt: string): CommitReportImportInput {
    return {
        runId: `import_${terminal.job.jobId}`,
        idempotencyKey: `lingxing:${terminal.job.jobId}`,
        batchId: terminal.job.jobId,
        files: terminal.files.map((file) => ({
            lingxingFileId: file.id,
            reportType: file.reportType,
            filePath: file.filePath!,
            fileName: path.basename(file.filePath!),
            fileSizeBytes: file.fileSizeBytes!,
            fileHash: 'a'.repeat(64),
            importedRows: 1,
        })),
        metrics: terminal.files.map((file, index) => metric('Shop Alpha', terminal.job.jobId, {
            reportType: file.reportType,
            sourceFile: file.filePath,
            sourceRow: index + 2,
            searchTerm: `authority-${file.reportType}`,
            cost: index + 1,
        })),
        reconciliations: terminal.files.map((file, index) => ({
            dateStart: terminal.job.request.dateStart,
            dateEnd: terminal.job.request.dateEnd,
            metricDate: terminal.job.request.dateEnd,
            reportType: file.reportType,
            expectedRows: 1,
            expectedCost: index + 1,
        })),
        startedAt,
        completedAt,
    };
}

function persistSucceededAuthorityProof(repository: LingxingImportRepository, storeId: StoreId, batchId: string): ReturnType<typeof fullAuthorityTerminal> {
    const terminal = fullAuthorityTerminal(storeId, 'profile-a', batchId);
    const attemptedAt = '2026-07-22T00:06:00.000Z';
    terminal.job = {
        ...terminal.job,
        importState: 'pending',
        importAttemptedAt: attemptedAt,
        updatedAt: attemptedAt,
    };
    repository.commitCollectionTerminalForStore(storeId, terminal);
    const commit = repository.commitImportForStore(storeId, fullAuthorityImportInput(terminal, attemptedAt, '2026-07-22T00:07:00.000Z'));
    const completedAt = new Date(Date.parse(commit.run.createdAt) + 1).toISOString();
    terminal.job = repository.upsertCollectionJobSnapshotForStore(storeId, {
        ...terminal.job,
        importState: 'succeeded',
        importCompletedAt: completedAt,
        updatedAt: completedAt,
    });
    return terminal;
}
export { createHarness, collectionJob, terminalCollection, fullAuthorityTerminal, failedFullAuthorityTerminal, insertStore, collectionSnapshot, metric, importInput, fullAuthorityImportInput, persistSucceededAuthorityProof };
