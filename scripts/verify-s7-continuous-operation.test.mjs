// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { ACCEPTANCE_CONTRACT_VERSION, Database, US_BUSINESS_CALENDAR_VERSION, buildEvidenceManifest, dates, describe, evaluateContinuousOperationSnapshot, evaluationRoot, evaluationStoresRoot, expect, fs, generatedAt, inclusiveDates, input, it, loadAuthoritySnapshotManifest, parseArgs, path, readContinuousOperationSnapshot, recentCompletedUsBusinessDates, run, usFederalBusinessDates } from './s7-continuous-test-environment.mjs';
import { seedContinuousDatabase, validSnapshot } from './s7-continuous-test-lineage.mjs';
import { sha256File } from './s7-continuous-test-artifacts.mjs';
import { createAuthoritySnapshotFixture, createRunnableAuthoritySnapshotFixture, runnableArgs } from './s7-continuous-test-authority.mjs';
describe('S7 continuous operation verifier', () => {
it('accepts two isolated US/USD stores with seven complete 8/8 days', () => {
    const result = evaluateContinuousOperationSnapshot(validSnapshot(), input);
    expect(result.passed).toBe(true);
    expect(result.acceptanceContractVersion).toBe(ACCEPTANCE_CONTRACT_VERSION);
    expect(result.businessCalendarVersion).toBe(US_BUSINESS_CALENDAR_VERSION);
    expect(result.globalActiveUsUsdStoreCount).toBe(2);
    expect(result.violations).toEqual([]);
    expect(result.stores).toHaveLength(2);
    expect(result.stores.every((store) => store.acceptedDayCount === 7)).toBe(true);
    expect(result.stores.flatMap((store) => store.days).every((day) => day.outcome === 'SUCCESS_8_OF_8')).toBe(true);
});

it('rejects two selected stores when a third active US/USD store exists globally', () => {
    const database = new Database(':memory:');
    seedContinuousDatabase(database, evaluationStoresRoot);
    database.prepare(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency, status, business_timezone
      ) VALUES ('shc003', 'profile-shc003', 'US', 'USD', 'active', 'America/Los_Angeles')
    `).run();
    const snapshot = readContinuousOperationSnapshot(database, input);
    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    expect(snapshot.globalActiveUsUsdStoreCount).toBe(3);
    expect(result).toMatchObject({
        globalActiveUsUsdStoreCount: 3,
        passed: false,
    });
    expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({
            actualCount: 3,
            code: 'ACTIVE_US_USD_STORE_COUNT_NOT_TWO',
            expectedCount: 2,
        }),
    ]));
    database.close();
});

it('records an actionable blocked day but refuses production-readiness credit', () => {
    const snapshot = validSnapshot();
    const blockedJob = snapshot.jobs.find((job) => job.storeId === 'shc002' && job.businessDate === dates[3]);
    blockedJob.state = 'failed';
    blockedJob.blockerCode = 'LINGXING_LOGIN_EXPIRED';
    blockedJob.detail = '重新登录当前店铺独立 Profile 后从同一 job 恢复。';
    const blockedRun = snapshot.imports.find((run) => run.storeId === 'shc002' && run.businessDate === dates[3]);
    snapshot.imports = snapshot.imports.filter((run) => run !== blockedRun);
    snapshot.importFiles = snapshot.importFiles.filter((row) => row.runId !== blockedRun.runId);
    snapshot.reconciliations = snapshot.reconciliations.filter((row) => row.runId !== blockedRun.runId);
    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    expect(result.passed).toBe(false);
    expect(result.stores[1].days[3]).toMatchObject({
        outcome: 'EXPLICIT_BLOCKED',
        accepted: false,
        blockerCode: 'LINGXING_LOGIN_EXPIRED',
    });
    expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'DAY_BLOCKED', storeId: 'shc002', businessDate: dates[3] }),
    ]));
});

it('rejects a 14-of-14 window made entirely of explicit blockers', () => {
    const snapshot = validSnapshot();
    for (const job of snapshot.jobs) {
        job.state = 'failed';
        job.blockerCode = 'LINGXING_LOGIN_EXPIRED';
        job.detail = '重新登录当前店铺独立 Profile 后恢复同一 job。';
    }
    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    expect(result.passed).toBe(false);
    expect(result.stores.every((store) => store.acceptedDayCount === 0)).toBe(true);
    expect(result.violations.filter(({ code }) => code === 'DAY_BLOCKED')).toHaveLength(14);
});

it('uses the latest store-day job so a newer failure overrides an older success', () => {
    const snapshot = validSnapshot();
    const oldSuccess = snapshot.jobs.find((job) => job.storeId === 'shc001' && job.businessDate === dates[0]);
    snapshot.jobs.push({
        ...oldSuccess,
        jobId: `${oldSuccess.jobId}-retry`,
        requestId: `${oldSuccess.requestId}-retry`,
        state: 'failed',
        blockerCode: 'LINGXING_SESSION_EXPIRED',
        detail: '刷新当前店铺 Profile 会话后恢复该 retry job。',
        completedAt: `${dates[0]}T17:00:00.000Z`,
        updatedAt: `${dates[0]}T17:00:01.000Z`,
    });
    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    expect(result.passed).toBe(false);
    expect(result.stores[0].days[0]).toMatchObject({
        outcome: 'EXPLICIT_BLOCKED',
        accepted: false,
        jobId: `${oldSuccess.jobId}-retry`,
    });
});

it('fails closed when any competing store-day job has a malformed latest-order timestamp', () => {
    const snapshot = validSnapshot();
    const oldSuccess = snapshot.jobs.find((job) => job.storeId === 'shc001' && job.businessDate === dates[0]);
    snapshot.jobs.push({
        ...oldSuccess,
        jobId: `${oldSuccess.jobId}-unknown-order`,
        requestId: `${oldSuccess.requestId}-unknown-order`,
        state: 'failed',
        blockerCode: 'LINGXING_SESSION_EXPIRED',
        detail: 'This attempt cannot be ordered because its durable updatedAt is malformed.',
        updatedAt: 'not-a-timestamp',
    });
    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    expect(result.passed).toBe(false);
    expect(result.stores[0].days[0]).toMatchObject({
        outcome: 'INCOMPLETE',
        accepted: false,
        jobId: null,
    });
    expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({
            code: 'LATEST_JOB_IDENTITY_AMBIGUOUS',
            storeId: 'shc001',
            businessDate: dates[0],
        }),
    ]));
});

it('accepts a newer successful authoritative lineage after an older failed import attempt', () => {
    const snapshot = validSnapshot();
    const successfulJob = snapshot.jobs.find((job) => job.storeId === 'shc001' && job.businessDate === dates[0]);
    const successfulRun = snapshot.imports.find((run) => (run.storeId === successfulJob.storeId
        && run.batchId === successfulJob.jobId));
    const failedRunId = `${successfulRun.runId}-failed-old`;
    snapshot.imports.push({
        ...successfulRun,
        runId: failedRunId,
        idempotencyKey: `${successfulRun.idempotencyKey}-failed-old`,
        status: 'failed',
        startedAt: `${dates[0]}T15:10:00.000Z`,
        completedAt: `${dates[0]}T15:20:00.000Z`,
        createdAt: `${dates[0]}T15:20:00.000Z`,
    });
    snapshot.importFiles.push(...snapshot.importFiles
        .filter((file) => file.storeId === successfulJob.storeId && file.runId === successfulRun.runId)
        .map((file) => ({
        ...file,
        runId: failedRunId,
        capturedAt: `${dates[0]}T15:20:00.000Z`,
    })));
    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.stores[0].days[0]).toMatchObject({
        outcome: 'SUCCESS_8_OF_8',
        accepted: true,
        jobId: successfulJob.jobId,
        importRunId: successfulRun.runId,
    });
});

it('fails closed when any competing import has a malformed latest-order timestamp', () => {
    const snapshot = validSnapshot();
    const successfulJob = snapshot.jobs.find((job) => job.storeId === 'shc001' && job.businessDate === dates[0]);
    const successfulRun = snapshot.imports.find((run) => (run.storeId === successfulJob.storeId
        && run.batchId === successfulJob.jobId));
    snapshot.imports.push({
        ...successfulRun,
        runId: `${successfulRun.runId}-unknown-order`,
        idempotencyKey: `${successfulRun.idempotencyKey}-unknown-order`,
        status: 'failed',
        completedAt: 'not-a-timestamp',
    });
    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({
            code: 'LATEST_IMPORT_IDENTITY_AMBIGUOUS',
            storeId: 'shc001',
            businessDate: dates[0],
        }),
    ]));
});

it('accepts identical empty-report bytes from independent store lineages', () => {
    const snapshot = validSnapshot();
    const firstFile = snapshot.importFiles.find((file) => (file.storeId === 'shc001'
        && file.reportType === 'campaign'
        && file.runId === `run-shc001-${dates[0]}`));
    const secondFile = snapshot.importFiles.find((file) => (file.storeId === 'shc002'
        && file.reportType === 'campaign'
        && file.runId === `run-shc002-${dates[0]}`));
    const emptyReportBytes = 'campaign_id,campaign_name,spend,sales\n';
    for (const file of [firstFile, secondFile]) {
        fs.writeFileSync(file.filePath, emptyReportBytes);
        file.fileSizeBytes = fs.statSync(file.filePath).size;
        file.fileHash = sha256File(file.filePath);
        file.importedRows = 0;
        const checkpoint = snapshot.checkpoints.find((row) => (row.storeId === file.storeId
            && row.jobId === file.batchId
            && row.reportType === file.reportType));
        checkpoint.fileSizeBytes = file.fileSizeBytes;
    }
    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    expect(result.passed).toBe(true);
    expect(result.violations.map(({ code }) => code)).not.toEqual(expect.arrayContaining([
        'DUPLICATE_IMPORT_FILE_HASH',
        'DUPLICATE_IMPORT_FILE',
        'CROSS_STORE_IMPORT_FILE_HASH',
    ]));
});

it('rejects identical non-empty report bytes even when every other lineage identity differs', () => {
    const snapshot = validSnapshot();
    const firstFile = snapshot.importFiles.find((file) => (file.storeId === 'shc001'
        && file.reportType === 'campaign'
        && file.runId === `run-shc001-${dates[0]}`));
    const secondFile = snapshot.importFiles.find((file) => (file.storeId === 'shc002'
        && file.reportType === 'campaign'
        && file.runId === `run-shc002-${dates[0]}`));
    fs.copyFileSync(firstFile.filePath, secondFile.filePath);
    secondFile.fileSizeBytes = fs.statSync(secondFile.filePath).size;
    secondFile.fileHash = sha256File(secondFile.filePath);
    const secondCheckpoint = snapshot.checkpoints.find((row) => (row.storeId === secondFile.storeId
        && row.jobId === secondFile.batchId
        && row.reportType === secondFile.reportType));
    secondCheckpoint.fileSizeBytes = secondFile.fileSizeBytes;
    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({
            code: 'DUPLICATE_IMPORT_FILE_HASH',
            conflicts: expect.arrayContaining(['content:non-empty']),
        }),
        expect.objectContaining({ code: 'CROSS_STORE_IMPORT_FILE_HASH' }),
    ]));
});

it('rejects incomplete, out-of-order, cross-day and unbounded terminal timestamps', () => {
    const missingTerminal = validSnapshot();
    delete missingTerminal.jobs[0].completedAt;
    expect(evaluateContinuousOperationSnapshot(missingTerminal, input).violations)
        .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'JOB_TIME_INVALID' })]));
    const crossDay = validSnapshot();
    crossDay.jobs[0].completedAt = `${dates[1]}T08:00:00.000Z`;
    crossDay.jobs[0].updatedAt = `${dates[1]}T08:00:01.000Z`;
    expect(evaluateContinuousOperationSnapshot(crossDay, input).violations)
        .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'JOB_BUSINESS_DATE_MISMATCH' })]));
    const unboundedTail = validSnapshot();
    unboundedTail.jobs[0].updatedAt = `${dates[1]}T00:00:01.000Z`;
    expect(evaluateContinuousOperationSnapshot(unboundedTail, input).violations)
        .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'JOB_TERMINAL_TAIL_EXCEEDED' })]));
    const outOfRangeCheckpoint = validSnapshot();
    outOfRangeCheckpoint.checkpoints[0].updatedAt = `${dates[0]}T14:59:59.000Z`;
    expect(evaluateContinuousOperationSnapshot(outOfRangeCheckpoint, input).violations)
        .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CHECKPOINT_TIME_INVALID' })]));
});

it('does not splice a completed job with an import from another batch lineage', () => {
    const snapshot = validSnapshot();
    snapshot.imports[0].batchId = 'unrelated-older-batch';
    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'IMPORT_LINEAGE_MISMATCH', storeId: 'shc001', businessDate: dates[0] }),
    ]));
});

it('fails silent missing days, partial reports and non-actionable blockers', () => {
    const snapshot = validSnapshot();
    snapshot.jobs = snapshot.jobs.filter((job) => !(job.storeId === 'shc001' && job.businessDate === dates[0]));
    snapshot.checkpoints = snapshot.checkpoints.filter((row) => !(row.storeId === 'shc002'
        && row.jobId === `job-shc002-${dates[1]}`
        && row.reportType === 'keyword'));
    const incomplete = snapshot.jobs.find((job) => job.storeId === 'shc002' && job.businessDate === dates[2]);
    incomplete.state = 'running';
    incomplete.blockerCode = null;
    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    expect(result.passed).toBe(false);
    expect(result.violations.map(({ code }) => code)).toEqual(expect.arrayContaining([
        'SILENT_MISSING_DAY',
        'REPORT_SET_INCOMPLETE',
        'BLOCKER_NOT_ACTIONABLE',
    ]));
});

it('fails duplicate fingerprints/files and cross-store profile identities', () => {
    const snapshot = validSnapshot();
    snapshot.imports[1].inputFingerprint = snapshot.imports[0].inputFingerprint;
    Object.assign(snapshot.importFiles[8], {
        filePath: snapshot.importFiles[0].filePath,
        fileName: snapshot.importFiles[0].fileName,
        fileSizeBytes: snapshot.importFiles[0].fileSizeBytes,
        fileHash: snapshot.importFiles[0].fileHash,
        reportType: snapshot.importFiles[0].reportType,
    });
    snapshot.jobs[0].browserProfileId = 'profile-shc002';
    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    expect(result.passed).toBe(false);
    expect(result.violations.map(({ code }) => code)).toEqual(expect.arrayContaining([
        'DUPLICATE_IMPORT_FINGERPRINT',
        'DUPLICATE_IMPORT_FILE',
        'CROSS_STORE_JOB_IDENTITY',
    ]));
});

it('rejects malformed, cross-day and cross-type import replay identities', () => {
    const malformed = validSnapshot();
    malformed.imports[0].inputFingerprint = '';
    malformed.importFiles[0].fileHash = 'not-a-sha';
    expect(evaluateContinuousOperationSnapshot(malformed, input).violations.map(({ code }) => code))
        .toEqual(expect.arrayContaining([
        'IMPORT_FINGERPRINT_INVALID',
        'IMPORT_FILE_HASH_INVALID',
    ]));
    const crossDay = validSnapshot();
    Object.assign(crossDay.importFiles[8], {
        filePath: crossDay.importFiles[0].filePath,
        fileName: crossDay.importFiles[0].fileName,
        fileSizeBytes: crossDay.importFiles[0].fileSizeBytes,
        fileHash: crossDay.importFiles[0].fileHash,
    });
    expect(evaluateContinuousOperationSnapshot(crossDay, input).violations.map(({ code }) => code))
        .toEqual(expect.arrayContaining([
        'DUPLICATE_IMPORT_FILE_HASH',
        'DUPLICATE_IMPORT_FILE_PATH',
    ]));
    const sameLineage = validSnapshot();
    const firstLineageFile = sameLineage.importFiles[0];
    const secondLineageFile = sameLineage.importFiles[1];
    expect(secondLineageFile.runId).toBe(firstLineageFile.runId);
    expect(secondLineageFile.filePath).not.toBe(firstLineageFile.filePath);
    fs.writeFileSync(secondLineageFile.filePath, fs.readFileSync(firstLineageFile.filePath));
    secondLineageFile.fileSizeBytes = fs.statSync(secondLineageFile.filePath).size;
    secondLineageFile.fileHash = sha256File(secondLineageFile.filePath);
    const sameLineageCodes = evaluateContinuousOperationSnapshot(sameLineage, input)
        .violations.map(({ code }) => code);
    expect(sameLineageCodes).toEqual(expect.arrayContaining([
        'DUPLICATE_IMPORT_FILE_HASH',
        'DUPLICATE_IMPORT_FILE',
    ]));
    expect(sameLineageCodes).not.toContain('DUPLICATE_IMPORT_FILE_PATH');
    const crossTypePath = validSnapshot();
    crossTypePath.importFiles[1].filePath = crossTypePath.importFiles[0].filePath;
    crossTypePath.importFiles[1].fileSizeBytes = crossTypePath.importFiles[0].fileSizeBytes;
    crossTypePath.importFiles[1].fileHash = crossTypePath.importFiles[0].fileHash;
    expect(evaluateContinuousOperationSnapshot(crossTypePath, input).violations.map(({ code }) => code))
        .toEqual(expect.arrayContaining([
        'DUPLICATE_IMPORT_FILE_HASH',
        'DUPLICATE_IMPORT_FILE_PATH',
    ]));
});

it('rejects Store Capsule escape, byte mismatch and batch profile/session mismatch', () => {
    const escaped = validSnapshot();
    const outsidePath = path.join(evaluationRoot, 'outside.csv');
    fs.writeFileSync(outsidePath, 'outside\n');
    escaped.importFiles[0].filePath = outsidePath;
    escaped.importFiles[0].fileSizeBytes = fs.statSync(outsidePath).size;
    escaped.importFiles[0].fileHash = sha256File(outsidePath);
    expect(evaluateContinuousOperationSnapshot(escaped, input).violations.map(({ code }) => code))
        .toContain('FILE_PATH_OUTSIDE_STORE_CAPSULE');
    const byteMismatch = validSnapshot();
    byteMismatch.importFiles[0].fileSizeBytes += 1;
    expect(evaluateContinuousOperationSnapshot(byteMismatch, input).violations.map(({ code }) => code))
        .toContain('IMPORT_FILE_BYTES_MISMATCH');
    const authorityMismatch = validSnapshot();
    authorityMismatch.imports[0].batchBrowserProfileId = 'profile-shc002';
    authorityMismatch.imports[0].batchSessionGeneration += 1;
    expect(evaluateContinuousOperationSnapshot(authorityMismatch, input).violations.map(({ code }) => code))
        .toEqual(expect.arrayContaining([
        'BATCH_PROFILE_MISMATCH',
        'BATCH_SESSION_MISMATCH',
    ]));
});

it('requires all eight matched reconciliations and rejects identities reused across stores', () => {
    const snapshot = validSnapshot();
    const firstRun = snapshot.imports[0];
    snapshot.reconciliations = snapshot.reconciliations.filter((row) => row.runId !== firstRun.runId);
    snapshot.stores[1].browserProfileId = snapshot.stores[0].browserProfileId;
    const firstStoreOneRun = snapshot.imports.find((row) => row.storeId === 'shc001');
    const firstStoreTwoRun = snapshot.imports.find((row) => row.storeId === 'shc002');
    firstStoreTwoRun.inputFingerprint = firstStoreOneRun.inputFingerprint;
    firstStoreTwoRun.batchRequestId = firstStoreOneRun.batchRequestId;
    const firstStoreOneFile = snapshot.importFiles.find((row) => row.storeId === 'shc001');
    const firstStoreTwoFile = snapshot.importFiles.find((row) => row.storeId === 'shc002');
    fs.writeFileSync(firstStoreTwoFile.filePath, fs.readFileSync(firstStoreOneFile.filePath));
    firstStoreTwoFile.fileSizeBytes = fs.statSync(firstStoreTwoFile.filePath).size;
    firstStoreTwoFile.fileHash = sha256File(firstStoreTwoFile.filePath);
    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    expect(result.passed).toBe(false);
    expect(result.violations.map(({ code }) => code)).toEqual(expect.arrayContaining([
        'IMPORT_NOT_VERIFIED',
        'CROSS_STORE_PROFILE_IDENTITY',
        'CROSS_STORE_IMPORT_FINGERPRINT',
        'CROSS_STORE_IMPORT_FILE_HASH',
    ]));
});

it('uses seven versioned US federal business dates when the window spans a weekend', () => {
    expect(inclusiveDates('2026-07-13', '2026-07-21')).toHaveLength(9);
    expect(dates).toEqual([
        '2026-07-13',
        '2026-07-14',
        '2026-07-15',
        '2026-07-16',
        '2026-07-17',
        '2026-07-20',
        '2026-07-21',
    ]);
    expect(recentCompletedUsBusinessDates(generatedAt)).toEqual(dates);
    expect(parseArgs([
        '--authority-snapshot-manifest', 'snapshot-manifest.json',
        '--store', 'SHC001',
        '--store', 'SHC002',
        '--date-from', '2026-07-13',
        '--date-to', '2026-07-21',
    ], { now: () => new Date(generatedAt) })).toMatchObject({
        dates,
        generatedAt,
        businessCalendarVersion: US_BUSINESS_CALENDAR_VERSION,
    });
    expect(() => parseArgs([
        '--authority-snapshot-manifest', 'snapshot-manifest.json',
        '--store', 'SHC001',
        '--store', 'SHC002',
        '--date-from', '2026-07-10',
        '--date-to', '2026-07-20',
    ], { now: () => new Date(generatedAt) })).toThrow(/most recent seven completed/);
});

it('excludes federal holidays and weekend-observed holidays from the acceptance window', () => {
    expect(usFederalBusinessDates('2026-07-01', '2026-07-10')).toEqual([
        '2026-07-01',
        '2026-07-02',
        '2026-07-06',
        '2026-07-07',
        '2026-07-08',
        '2026-07-09',
        '2026-07-10',
    ]);
    expect(() => parseArgs([
        '--authority-snapshot-manifest', 'snapshot-manifest.json',
        '--store', 'SHC001',
        '--store', 'SHC002',
        '--date-from', '2026-07-01',
        '--date-to', '2026-07-09',
    ])).toThrow(new RegExp(US_BUSINESS_CALENDAR_VERSION));
    expect(usFederalBusinessDates('2026-11-23', '2026-12-02')).not.toContain('2026-11-26');
});

it('requires exactly two stores and exactly seven federal business dates', () => {
    expect(() => parseArgs([
        '--authority-snapshot-manifest', 'snapshot-manifest.json',
        '--store', 'SHC001',
        '--date-from', '2026-07-13',
        '--date-to', '2026-07-21',
    ])).toThrow(/Exactly two distinct/);
    expect(() => parseArgs([
        '--authority-snapshot-manifest', 'snapshot-manifest.json',
        '--store', 'SHC001',
        '--store', 'SHC002',
        '--date-from', '2026-07-15',
        '--date-to', '2026-07-20',
    ])).toThrow(/exactly seven/);
    expect(() => parseArgs([
        '--authority-snapshot-manifest', 'snapshot-manifest.json',
        '--store', 'SHC001',
        '--store', 'SHC002',
        '--date-from', '2026-07-13',
        '--date-to', '2026-07-22',
    ])).toThrow(/exactly seven/);
});

it('rejects a raw live database input without an authority snapshot manifest', () => {
    expect(() => parseArgs([
        '--database', 'live.db',
        '--store', 'SHC001',
        '--store', 'SHC002',
        '--date-from', '2026-07-13',
        '--date-to', '2026-07-21',
    ])).toThrow(/Unknown argument --database/);
});

it('loads one immutable v2 authority snapshot and binds its package identity', () => {
    const fixture = createAuthoritySnapshotFixture();
    try {
        const selection = loadAuthoritySnapshotManifest(fixture.manifestPath, {
            authoritySnapshotRoot: fixture.authoritySnapshotRoot,
            ...fixture.packageContext,
        });
        expect(selection).toMatchObject({
            databasePath: fixture.databasePath,
            manifestPath: fixture.manifestPath,
            packageIdentity: fixture.packageIdentity,
        });
        expect(selection.snapshotManifestSha256).toMatch(/^[A-F0-9]{64}$/);
        const evidence = buildEvidenceManifest(fixture.databasePath, input, {
            passed: true,
            acceptanceContractVersion: ACCEPTANCE_CONTRACT_VERSION,
            businessCalendarVersion: US_BUSINESS_CALENDAR_VERSION,
            expected: { storeCount: 2, businessDayCount: 7, reportTypeCount: 8 },
            stores: [],
            violations: [],
        }, ['ok'], selection);
        expect(evidence.packageIdentity).toEqual(fixture.packageIdentity);
        expect(evidence.database).toMatchObject({
            absolutePath: fixture.databasePath,
            openedReadOnly: true,
            packageIdentity: fixture.packageIdentity,
            snapshotManifestSha256: selection.snapshotManifestSha256,
        });
        expect(evidence.authoritySnapshotManifest).toEqual({
            absolutePath: fixture.manifestPath,
            sha256: selection.snapshotManifestSha256,
        });
    }
    finally {
        fixture.cleanup();
    }
});

it('rejects snapshot byte tampering and incomplete online-backup provenance', () => {
    const fixture = createAuthoritySnapshotFixture();
    try {
        fs.appendFileSync(fixture.databasePath, 'tampered');
        expect(() => loadAuthoritySnapshotManifest(fixture.manifestPath, {
            authoritySnapshotRoot: fixture.authoritySnapshotRoot,
            ...fixture.packageContext,
        })).toThrow(/bytes do not match/);
    }
    finally {
        fixture.cleanup();
    }
    const incomplete = createAuthoritySnapshotFixture();
    try {
        incomplete.manifest.backup.completed = false;
        fs.writeFileSync(incomplete.manifestPath, `${JSON.stringify(incomplete.manifest, null, 2)}\n`);
        expect(() => loadAuthoritySnapshotManifest(incomplete.manifestPath, {
            authoritySnapshotRoot: incomplete.authoritySnapshotRoot,
            ...incomplete.packageContext,
        })).toThrow(/completed SQLite online backup/);
    }
    finally {
        incomplete.cleanup();
    }
});

it('rejects changed live source bytes, divergent source artifacts and package replay', () => {
    const changedSource = createAuthoritySnapshotFixture();
    try {
        fs.appendFileSync(changedSource.sourcePath, 'changed');
        expect(() => loadAuthoritySnapshotManifest(changedSource.manifestPath, {
            authoritySnapshotRoot: changedSource.authoritySnapshotRoot,
            ...changedSource.packageContext,
        })).toThrow(/source.*bytes|artifactAfter/i);
    }
    finally {
        changedSource.cleanup();
    }
    const divergentProof = createAuthoritySnapshotFixture();
    try {
        divergentProof.manifest.source.artifactBefore.sha256 = 'D'.repeat(64);
        fs.writeFileSync(divergentProof.manifestPath, `${JSON.stringify(divergentProof.manifest, null, 2)}\n`);
        expect(() => loadAuthoritySnapshotManifest(divergentProof.manifestPath, {
            authoritySnapshotRoot: divergentProof.authoritySnapshotRoot,
            ...divergentProof.packageContext,
        })).toThrow(/changed during snapshot export/);
    }
    finally {
        divergentProof.cleanup();
    }
    const packageReplay = createAuthoritySnapshotFixture();
    try {
        fs.appendFileSync(packageReplay.packageContext.executablePath, 'changed');
        expect(() => loadAuthoritySnapshotManifest(packageReplay.manifestPath, {
            authoritySnapshotRoot: packageReplay.authoritySnapshotRoot,
            ...packageReplay.packageContext,
        })).toThrow(/packageIdentity.*current canonical package/i);
    }
    finally {
        packageReplay.cleanup();
    }
});

it('fails closed when a formal recomputation omits generatedAt or the canonical storesRoot', () => {
    const result = evaluateContinuousOperationSnapshot(validSnapshot(), {
        stores: input.stores,
        dates: input.dates,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
    });
    expect(result.passed).toBe(false);
    expect(result.violations.map(({ code }) => code)).toEqual(expect.arrayContaining([
        'WINDOW_NOT_RECENT_COMPLETED',
        'STORES_ROOT_INVALID',
    ]));
});

it('writes one passed manifest only to the canonical continuous-operation root', () => {
    const fixture = createRunnableAuthoritySnapshotFixture();
    try {
        const outputPath = path.join(fixture.context.continuousOperationOutputRoot, 'continuous-success.json');
        expect(run(runnableArgs(fixture, outputPath), fixture.context)).toBe(0);
        const evidence = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        expect(evidence).toMatchObject({
            generatedAt,
            status: 'PASSED',
            storesRoot: path.join(path.dirname(fixture.sourcePath), 'stores'),
            storeCapsule: {
                verifiedFileCount: 112,
            },
            publication: {
                state: 'atomic-published',
                outputPath,
                stagedVerificationCaptureLabel: 'continuous-after-staging-output',
            },
        });
        expect(evidence.authorityCurrentness.captures.map(({ captureLabel }) => captureLabel)).toEqual([
            'continuous-before-work',
            'continuous-before-final-output',
            'continuous-after-staging-output',
        ]);
        expect(fs.readdirSync(path.dirname(outputPath)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
        expect(() => run(runnableArgs(fixture, outputPath), fixture.context)).toThrow(/already exists/);
    }
    finally {
        fixture.cleanup();
    }
});
});
