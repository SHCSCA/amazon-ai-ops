import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import authoritySnapshotExporterModule from './export-mission-control-authority-snapshot.js';
import sqliteAuthorityCurrentnessModule from './sqlite-authority-currentness.js';
import verifierModule from './verify-s7-continuous-operation.js';

const { computeCanonicalPackageIdentity } = authoritySnapshotExporterModule;
const { runReadonlySqliteOnlineBackupSync } = sqliteAuthorityCurrentnessModule;
const {
  ACCEPTANCE_CONTRACT_VERSION,
  AUTHORITY_SNAPSHOT_KIND,
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  EXPECTED_REPORT_TYPES,
  US_BUSINESS_CALENDAR_VERSION,
  buildEvidenceManifest,
  evaluateContinuousOperationSnapshot,
  inclusiveDates,
  loadAuthoritySnapshotManifest,
  parseArgs,
  recentCompletedUsBusinessDates,
  run,
  usFederalBusinessDates,
  usWeekdayBusinessDates,
} = verifierModule;
const requireLocalDbDependency = createRequire(
  path.join(process.cwd(), 'packages', 'local-db', 'package.json'),
);
const Database = requireLocalDbDependency('better-sqlite3');

const dates = usWeekdayBusinessDates('2026-07-13', '2026-07-21');
const generatedAt = '2026-07-22T20:00:00.000Z';
const evaluationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-continuous-evaluation-'));
const evaluationStoresRoot = path.join(evaluationRoot, 'stores');
fs.mkdirSync(evaluationStoresRoot, { recursive: true });
afterAll(() => fs.rmSync(evaluationRoot, { recursive: true, force: true }));

function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

const input = {
  stores: ['shc001', 'shc002'],
  dates,
  dateFrom: dates[0],
  dateTo: dates[6],
  generatedAt,
  storesRoot: evaluationStoresRoot,
};

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function createAuthoritySnapshotFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-continuous-'));
  const userDataDir = path.join(tempDir, 'AppData', 'Amazon AI Ops');
  const sourcePath = path.join(userDataDir, 'amazon-ai-ops.db');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(path.join(userDataDir, 'stores'), { recursive: true });
  fs.writeFileSync(sourcePath, 'immutable live authority source');
  const sourceStat = fs.statSync(sourcePath);
  const sourceArtifact = {
    sha256: sha256File(sourcePath),
    sizeBytes: sourceStat.size,
    mtimeMs: sourceStat.mtimeMs,
  };
  const releaseRoot = path.join(tempDir, 'release');
  const executablePath = path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe');
  const appContentPath = path.join(releaseRoot, 'win-unpacked', 'resources', 'app');
  const mainBundlePath = path.join(appContentPath, 'dist', 'main', 'index.js');
  fs.mkdirSync(path.dirname(executablePath), { recursive: true });
  fs.mkdirSync(path.dirname(mainBundlePath), { recursive: true });
  fs.writeFileSync(executablePath, 'fixture executable');
  fs.writeFileSync(mainBundlePath, 'fixture main bundle');
  for (const [relativePath, contents] of [
    ['dist/preload/index.js', 'fixture preload'],
    ['dist/renderer/index.html', '<!doctype html><title>fixture</title>'],
    ['playwright-browsers/chrome-win64/chrome.exe', 'fixture chromium'],
  ]) {
    const targetPath = path.join(appContentPath, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, contents);
  }
  fs.writeFileSync(path.join(appContentPath, 'package.json'), `${JSON.stringify({
    main: 'dist/main/index.js',
    name: '@amazon-ai-ops/desktop',
    version: '1.5.0',
  })}\n`);
  const packageContext = {
    appContentPath,
    executablePath,
    mainBundlePath,
    releaseRoot,
    verifyPackageIdentity: true,
  };
  const fixturePackageIdentity = computeCanonicalPackageIdentity(packageContext);
  const authoritySnapshotRoot = path.join(tempDir, 'authority-snapshots');
  const runDir = path.join(authoritySnapshotRoot, 'run-1');
  fs.mkdirSync(runDir, { recursive: true });
  const databasePath = path.join(runDir, 'authority-snapshot.db');
  fs.writeFileSync(databasePath, 'immutable authority snapshot');
  const stat = fs.statSync(databasePath);
  const now = new Date().toISOString();
  const manifestPath = path.join(runDir, 'snapshot-manifest.json');
  const manifest = {
    kind: AUTHORITY_SNAPSHOT_KIND,
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    exportedAt: now,
    backup: {
      method: 'sqlite-online-backup',
      startedAt: now,
      completedAt: now,
      completed: true,
      totalPages: 1,
      remainingPages: 0,
    },
    source: {
      absolutePath: sourcePath,
      realPath: fs.realpathSync.native(sourcePath),
      openedReadOnly: true,
      queryOnly: true,
      integrityCheck: ['ok'],
      foreignKeyCheck: [],
      artifactBefore: { ...sourceArtifact },
      artifactAfter: { ...sourceArtifact },
    },
    snapshot: {
      absolutePath: databasePath,
      realPath: fs.realpathSync.native(databasePath),
      openedReadOnly: true,
      queryOnly: true,
      integrityCheck: ['ok'],
      foreignKeyCheck: [],
      sha256: sha256File(databasePath),
      sizeBytes: stat.size,
    },
    packageIdentity: fixturePackageIdentity,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    authoritySnapshotRoot,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
    databasePath,
    manifest,
    manifestPath,
    packageContext,
    packageIdentity: fixturePackageIdentity,
    sourcePath,
  };
}

function validSnapshot({ storesRoot = evaluationStoresRoot } = {}) {
  const stores = ['shc001', 'shc002'].map((storeId) => ({
    storeId,
    browserProfileId: `profile-${storeId}`,
    marketplace: 'US',
    currency: 'USD',
    status: 'active',
    businessTimezone: 'America/Los_Angeles',
  }));
  const jobs = [];
  const checkpoints = [];
  const imports = [];
  const importFiles = [];
  const reconciliations = [];
  for (const store of stores) {
    for (const [dayIndex, businessDate] of dates.entries()) {
      const jobId = `job-${store.storeId}-${businessDate}`;
      const runId = `run-${store.storeId}-${businessDate}`;
      const inputFingerprint = sha256Text(`fingerprint:${store.storeId}:${businessDate}`);
      jobs.push({
        storeId: store.storeId,
        jobId,
        requestId: `request-${store.storeId}-${businessDate}`,
        browserProfileId: store.browserProfileId,
        marketplace: 'US',
        currency: 'USD',
        businessTimezone: 'America/Los_Angeles',
        businessDate,
        sessionGeneration: 3,
        dateStart: businessDate,
        dateEnd: businessDate,
        reportTypesJson: JSON.stringify(EXPECTED_REPORT_TYPES),
        state: 'completed',
        blockerCode: null,
        detail: '8/8 reports downloaded and imported',
        createdAt: `${businessDate}T15:00:00.000Z`,
        completedAt: `${businessDate}T16:00:00.000Z`,
        updatedAt: `${businessDate}T16:30:00.000Z`,
      });
      imports.push({
        storeId: store.storeId,
        runId,
        idempotencyKey: `idem-${store.storeId}-${dayIndex}`,
        inputFingerprint,
        batchId: jobId,
        status: 'completed',
        sourceFileCount: 8,
        metricRowCount: 120,
        reconciliationCount: 8,
        startedAt: `${businessDate}T15:50:00.000Z`,
        completedAt: `${businessDate}T16:15:00.000Z`,
        createdAt: `${businessDate}T16:15:00.000Z`,
        businessDate,
        batchRequestId: `request-${store.storeId}-${businessDate}`,
        batchBrowserProfileId: store.browserProfileId,
        batchBusinessDate: businessDate,
        batchSessionGeneration: 3,
        batchStatus: 'completed',
        batchCreatedAt: `${businessDate}T15:05:00.000Z`,
        batchCompletedAt: `${businessDate}T16:00:00.000Z`,
      });
      for (const [reportIndex, reportType] of EXPECTED_REPORT_TYPES.entries()) {
        const filePath = path.join(
          storesRoot,
          store.storeId,
          'downloads',
          businessDate,
          `${reportType}.csv`,
        );
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const fileContents = `store=${store.storeId};date=${businessDate};type=${reportType}\n`;
        fs.writeFileSync(filePath, fileContents);
        const fileSizeBytes = fs.statSync(filePath).size;
        const fileHash = sha256File(filePath);
        checkpoints.push({
          storeId: store.storeId,
          jobId,
          reportType,
          state: 'downloaded',
          fileSizeBytes,
          updatedAt: `${businessDate}T15:45:00.000Z`,
        });
        importFiles.push({
          storeId: store.storeId,
          runId,
          batchId: jobId,
          reportType,
          filePath,
          fileName: path.basename(filePath),
          fileSizeBytes,
          fileHash,
          importedRows: 15,
          capturedAt: `${businessDate}T16:15:00.000Z`,
        });
        reconciliations.push({
          storeId: store.storeId,
          runId,
          batchId: jobId,
          reportType,
          status: 'matched',
          withinTolerance: 1,
          reconciledAt: `${businessDate}T16:15:00.000Z`,
        });
      }
    }
  }
  return { stores, jobs, checkpoints, imports, importFiles, reconciliations };
}

function seedContinuousDatabase(database, storesRoot) {
  database.exec(`
    CREATE TABLE stores (
      store_id TEXT PRIMARY KEY,
      browser_profile_id TEXT NOT NULL,
      marketplace TEXT NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      business_timezone TEXT NOT NULL
    );
    CREATE TABLE lingxing_collection_jobs (
      store_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      browser_profile_id TEXT NOT NULL,
      marketplace TEXT NOT NULL,
      currency TEXT NOT NULL,
      business_timezone TEXT NOT NULL,
      business_date TEXT NOT NULL,
      session_generation INTEGER NOT NULL,
      date_start TEXT NOT NULL,
      date_end TEXT NOT NULL,
      report_types_json TEXT NOT NULL,
      state TEXT NOT NULL,
      blocker_code TEXT,
      detail TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (store_id, job_id)
    );
    CREATE TABLE lingxing_collection_report_checkpoints (
      store_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      state TEXT NOT NULL,
      file_size_bytes INTEGER,
      error_code TEXT,
      detail TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (store_id, job_id, report_type)
    );
    CREATE TABLE lingxing_report_batches (
      store_id TEXT NOT NULL,
      id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      browser_profile_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      session_generation INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      PRIMARY KEY (store_id, id)
    );
    CREATE TABLE report_import_runs (
      store_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      status TEXT NOT NULL,
      source_file_count INTEGER NOT NULL,
      metric_row_count INTEGER NOT NULL,
      reconciliation_count INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (store_id, run_id)
    );
    CREATE TABLE report_import_file_snapshots (
      store_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      file_hash TEXT NOT NULL,
      imported_rows INTEGER NOT NULL,
      captured_at TEXT NOT NULL,
      PRIMARY KEY (store_id, snapshot_id)
    );
    CREATE TABLE report_import_reconciliations (
      store_id TEXT NOT NULL,
      reconciliation_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      status TEXT NOT NULL,
      within_tolerance INTEGER NOT NULL,
      reconciled_at TEXT NOT NULL,
      PRIMARY KEY (store_id, reconciliation_id)
    );
  `);
  const snapshot = validSnapshot({ storesRoot });
  const insertStore = database.prepare(`
    INSERT INTO stores (
      store_id, browser_profile_id, marketplace, currency, status, business_timezone
    ) VALUES (
      @storeId, @browserProfileId, @marketplace, @currency, @status, @businessTimezone
    )
  `);
  const insertJob = database.prepare(`
    INSERT INTO lingxing_collection_jobs (
      store_id, job_id, request_id, browser_profile_id, marketplace, currency,
      business_timezone, business_date, session_generation, date_start, date_end,
      report_types_json, state, blocker_code, detail, created_at, updated_at, completed_at
    ) VALUES (
      @storeId, @jobId, @requestId, @browserProfileId, @marketplace, @currency,
      @businessTimezone, @businessDate, @sessionGeneration, @dateStart, @dateEnd,
      @reportTypesJson, @state, @blockerCode, @detail, @createdAt, @updatedAt, @completedAt
    )
  `);
  const insertCheckpoint = database.prepare(`
    INSERT INTO lingxing_collection_report_checkpoints (
      store_id, job_id, report_type, state, file_size_bytes, error_code, detail, updated_at
    ) VALUES (
      @storeId, @jobId, @reportType, @state, @fileSizeBytes, NULL, NULL, @updatedAt
    )
  `);
  const insertBatch = database.prepare(`
    INSERT INTO lingxing_report_batches (
      store_id, id, request_id, browser_profile_id, business_date,
      session_generation, status, created_at, completed_at
    ) VALUES (
      @storeId, @batchId, @batchRequestId, @batchBrowserProfileId, @batchBusinessDate,
      @batchSessionGeneration, @batchStatus, @batchCreatedAt, @batchCompletedAt
    )
  `);
  const insertRun = database.prepare(`
    INSERT INTO report_import_runs (
      store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
      source_file_count, metric_row_count, reconciliation_count,
      started_at, completed_at, created_at
    ) VALUES (
      @storeId, @runId, @idempotencyKey, @inputFingerprint, @batchId, @status,
      @sourceFileCount, @metricRowCount, @reconciliationCount,
      @startedAt, @completedAt, @createdAt
    )
  `);
  const insertFile = database.prepare(`
    INSERT INTO report_import_file_snapshots (
      store_id, snapshot_id, run_id, batch_id, report_type, file_path, file_name,
      file_size_bytes, file_hash, imported_rows, captured_at
    ) VALUES (
      @storeId, @snapshotId, @runId, @batchId, @reportType, @filePath, @fileName,
      @fileSizeBytes, @fileHash, @importedRows, @capturedAt
    )
  `);
  const insertReconciliation = database.prepare(`
    INSERT INTO report_import_reconciliations (
      store_id, reconciliation_id, run_id, batch_id, report_type,
      status, within_tolerance, reconciled_at
    ) VALUES (
      @storeId, @reconciliationId, @runId, @batchId, @reportType,
      @status, @withinTolerance, @reconciledAt
    )
  `);
  database.transaction(() => {
    snapshot.stores.forEach((row) => insertStore.run(row));
    snapshot.jobs.forEach((row) => insertJob.run(row));
    snapshot.checkpoints.forEach((row) => insertCheckpoint.run(row));
    snapshot.imports.forEach((row) => {
      insertBatch.run(row);
      insertRun.run(row);
    });
    snapshot.importFiles.forEach((row, index) => insertFile.run({
      ...row,
      snapshotId: `snapshot-${index}`,
    }));
    snapshot.reconciliations.forEach((row, index) => insertReconciliation.run({
      ...row,
      reconciliationId: `reconciliation-${index}`,
    }));
  })();
}

function rewriteSnapshotManifestArtifact(fixture) {
  const stat = fs.statSync(fixture.databasePath);
  fixture.manifest.snapshot.sha256 = sha256File(fixture.databasePath);
  fixture.manifest.snapshot.sizeBytes = stat.size;
  fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
}

function createRunnableAuthoritySnapshotFixture() {
  const fixture = createAuthoritySnapshotFixture();
  fs.rmSync(fixture.sourcePath);
  let database = new Database(fixture.sourcePath);
  try {
    seedContinuousDatabase(database, path.join(path.dirname(fixture.sourcePath), 'stores'));
  } finally {
    database.close();
  }
  fs.rmSync(fixture.databasePath);
  const onlineBackup = runReadonlySqliteOnlineBackupSync({
    sourceDatabasePath: fixture.sourcePath,
    destinationPath: fixture.databasePath,
    ownedTempRoot: path.dirname(fixture.databasePath),
  });
  const sourceStat = fs.statSync(fixture.sourcePath);
  const sourceArtifact = {
    sha256: sha256File(fixture.sourcePath),
    sizeBytes: sourceStat.size,
    mtimeMs: sourceStat.mtimeMs,
  };
  fixture.manifest.exportedAt = '2026-07-22T19:59:00.000Z';
  fixture.manifest.backup.startedAt = '2026-07-22T19:58:00.000Z';
  fixture.manifest.backup.completedAt = fixture.manifest.exportedAt;
  fixture.manifest.backup.totalPages = onlineBackup.observedBackup.totalPages;
  fixture.manifest.backup.remainingPages = onlineBackup.observedBackup.remainingPages;
  fixture.manifest.source.realPath = fs.realpathSync.native(fixture.sourcePath);
  fixture.manifest.source.artifactBefore = { ...sourceArtifact };
  fixture.manifest.source.artifactAfter = { ...sourceArtifact };
  fixture.manifest.snapshot.realPath = fs.realpathSync.native(fixture.databasePath);
  rewriteSnapshotManifestArtifact(fixture);
  const canonicalEvidenceRoot = path.join(fixture.authoritySnapshotRoot, '..', 'codex-evidence');
  return {
    ...fixture,
    canonicalEvidenceRoot,
    context: {
      ...fixture.packageContext,
      Database,
      authoritySnapshotRoot: fixture.authoritySnapshotRoot,
      canonicalEvidenceRoot,
      continuousOperationOutputRoot: path.join(canonicalEvidenceRoot, 'continuous-operation'),
      now: () => new Date(generatedAt),
      randomUUID: () => '00000000-0000-4000-8000-000000000001',
      writeStdout: () => {},
    },
  };
}

function runnableArgs(fixture, outputPath) {
  return [
    '--authority-snapshot-manifest', fixture.manifestPath,
    '--store', 'shc001',
    '--store', 'shc002',
    '--date-from', dates[0],
    '--date-to', dates.at(-1),
    ...(outputPath ? ['--output', outputPath] : []),
  ];
}

describe('S7 continuous operation verifier', () => {
  it('accepts two isolated US/USD stores with seven complete 8/8 days', () => {
    const result = evaluateContinuousOperationSnapshot(validSnapshot(), input);
    expect(result.passed).toBe(true);
    expect(result.acceptanceContractVersion).toBe(ACCEPTANCE_CONTRACT_VERSION);
    expect(result.businessCalendarVersion).toBe(US_BUSINESS_CALENDAR_VERSION);
    expect(result.violations).toEqual([]);
    expect(result.stores).toHaveLength(2);
    expect(result.stores.every((store) => store.acceptedDayCount === 7)).toBe(true);
    expect(result.stores.flatMap((store) => store.days).every((day) => day.outcome === 'SUCCESS_8_OF_8')).toBe(true);
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
    const successfulRun = snapshot.imports.find((run) => (
      run.storeId === successfulJob.storeId
      && run.batchId === successfulJob.jobId
    ));
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
    const successfulRun = snapshot.imports.find((run) => (
      run.storeId === successfulJob.storeId
      && run.batchId === successfulJob.jobId
    ));
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
    const firstFile = snapshot.importFiles.find((file) => (
      file.storeId === 'shc001'
      && file.reportType === 'campaign'
      && file.runId === `run-shc001-${dates[0]}`
    ));
    const secondFile = snapshot.importFiles.find((file) => (
      file.storeId === 'shc002'
      && file.reportType === 'campaign'
      && file.runId === `run-shc002-${dates[0]}`
    ));
    const emptyReportBytes = 'campaign_id,campaign_name,spend,sales\n';
    for (const file of [firstFile, secondFile]) {
      fs.writeFileSync(file.filePath, emptyReportBytes);
      file.fileSizeBytes = fs.statSync(file.filePath).size;
      file.fileHash = sha256File(file.filePath);
      file.importedRows = 0;
      const checkpoint = snapshot.checkpoints.find((row) => (
        row.storeId === file.storeId
        && row.jobId === file.batchId
        && row.reportType === file.reportType
      ));
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
    const firstFile = snapshot.importFiles.find((file) => (
      file.storeId === 'shc001'
      && file.reportType === 'campaign'
      && file.runId === `run-shc001-${dates[0]}`
    ));
    const secondFile = snapshot.importFiles.find((file) => (
      file.storeId === 'shc002'
      && file.reportType === 'campaign'
      && file.runId === `run-shc002-${dates[0]}`
    ));
    fs.copyFileSync(firstFile.filePath, secondFile.filePath);
    secondFile.fileSizeBytes = fs.statSync(secondFile.filePath).size;
    secondFile.fileHash = sha256File(secondFile.filePath);
    const secondCheckpoint = snapshot.checkpoints.find((row) => (
      row.storeId === secondFile.storeId
      && row.jobId === secondFile.batchId
      && row.reportType === secondFile.reportType
    ));
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
    snapshot.checkpoints = snapshot.checkpoints.filter((row) => !(
      row.storeId === 'shc002'
      && row.jobId === `job-shc002-${dates[1]}`
      && row.reportType === 'keyword'
    ));
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

      const evidence = buildEvidenceManifest(
        fixture.databasePath,
        input,
        {
          passed: true,
          acceptanceContractVersion: ACCEPTANCE_CONTRACT_VERSION,
          businessCalendarVersion: US_BUSINESS_CALENDAR_VERSION,
          expected: { storeCount: 2, businessDayCount: 7, reportTypeCount: 8 },
          stores: [],
          violations: [],
        },
        ['ok'],
        selection,
      );
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
    } finally {
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
    } finally {
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
    } finally {
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
    } finally {
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
    } finally {
      divergentProof.cleanup();
    }

    const packageReplay = createAuthoritySnapshotFixture();
    try {
      fs.appendFileSync(packageReplay.packageContext.executablePath, 'changed');
      expect(() => loadAuthoritySnapshotManifest(packageReplay.manifestPath, {
        authoritySnapshotRoot: packageReplay.authoritySnapshotRoot,
        ...packageReplay.packageContext,
      })).toThrow(/packageIdentity.*current canonical package/i);
    } finally {
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
      const outputPath = path.join(
        fixture.context.continuousOperationOutputRoot,
        'continuous-success.json',
      );
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
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects protected or nested output paths without creating evidence', () => {
    const fixture = createRunnableAuthoritySnapshotFixture();
    try {
      const protectedOutput = path.join(
        path.dirname(fixture.sourcePath),
        'stores',
        'shc001',
        'continuous.json',
      );
      expect(() => run(runnableArgs(fixture, protectedOutput), fixture.context))
        .toThrow(/direct child|canonical continuous-operation/);
      expect(fs.existsSync(protectedOutput)).toBe(false);

      const nestedOutput = path.join(
        fixture.context.continuousOperationOutputRoot,
        'nested',
        'continuous.json',
      );
      expect(() => run(runnableArgs(fixture, nestedOutput), fixture.context))
        .toThrow(/direct child/);
      expect(fs.existsSync(nestedOutput)).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });

  it('never publishes final output when source, snapshot or package bytes change after the staging write', () => {
    for (const target of ['source', 'snapshot', 'package']) {
      const fixture = createRunnableAuthoritySnapshotFixture();
      try {
        const outputPath = path.join(
          fixture.context.continuousOperationOutputRoot,
          `changed-${target}.json`,
        );
        const mutationPath = target === 'source'
          ? fixture.sourcePath
          : target === 'snapshot'
            ? fixture.databasePath
            : fixture.packageContext.executablePath;
        const context = {
          ...fixture.context,
          afterOutputWritten: ({ outputPath: finalPath, stagingPath, finalPathPublished }) => {
            expect(fs.existsSync(stagingPath)).toBe(true);
            expect(fs.existsSync(finalPath)).toBe(false);
            expect(finalPathPublished).toBe(false);
            fs.appendFileSync(mutationPath, `changed-${target}`);
          },
        };
        expect(() => run(runnableArgs(fixture, outputPath), context))
          .toThrow(/changed|package identity/i);
        expect(fs.existsSync(outputPath)).toBe(false);
        const outputRoot = path.dirname(outputPath);
        expect(
          fs.existsSync(outputRoot)
            ? fs.readdirSync(outputRoot).filter((name) => name.endsWith('.tmp'))
            : [],
        ).toEqual([]);
      } finally {
        fixture.cleanup();
      }
    }
  });

  it('fails closed on a missing authority table and leaves no output', () => {
    const fixture = createRunnableAuthoritySnapshotFixture();
    try {
      const database = new Database(fixture.sourcePath);
      database.exec('DROP TABLE report_import_reconciliations');
      database.close();
      fs.rmSync(fixture.databasePath);
      const onlineBackup = runReadonlySqliteOnlineBackupSync({
        sourceDatabasePath: fixture.sourcePath,
        destinationPath: fixture.databasePath,
        ownedTempRoot: path.dirname(fixture.databasePath),
      });
      const sourceStat = fs.statSync(fixture.sourcePath);
      const sourceArtifact = {
        sha256: sha256File(fixture.sourcePath),
        sizeBytes: sourceStat.size,
        mtimeMs: sourceStat.mtimeMs,
      };
      fixture.manifest.source.artifactBefore = sourceArtifact;
      fixture.manifest.source.artifactAfter = sourceArtifact;
      fixture.manifest.backup.totalPages = onlineBackup.observedBackup.totalPages;
      rewriteSnapshotManifestArtifact(fixture);
      const outputPath = path.join(
        fixture.context.continuousOperationOutputRoot,
        'missing-table.json',
      );
      expect(() => run(runnableArgs(fixture, outputPath), fixture.context))
        .toThrow(/no such table/i);
      expect(fs.existsSync(outputPath)).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects a committed WAL-only live authority change after the selected snapshot', () => {
    const fixture = createRunnableAuthoritySnapshotFixture();
    let database;
    try {
      database = new Database(fixture.sourcePath);
      database.pragma('journal_mode = WAL');
      database.pragma('wal_autocheckpoint = 0');
      database.pragma('wal_checkpoint(TRUNCATE)');
      fs.rmSync(fixture.databasePath);
      const onlineBackup = runReadonlySqliteOnlineBackupSync({
        sourceDatabasePath: fixture.sourcePath,
        destinationPath: fixture.databasePath,
        ownedTempRoot: path.dirname(fixture.databasePath),
      });
      const sourceStat = fs.statSync(fixture.sourcePath);
      const sourceArtifact = {
        sha256: sha256File(fixture.sourcePath),
        sizeBytes: sourceStat.size,
        mtimeMs: sourceStat.mtimeMs,
      };
      fixture.manifest.source.artifactBefore = sourceArtifact;
      fixture.manifest.source.artifactAfter = sourceArtifact;
      fixture.manifest.backup.totalPages = onlineBackup.observedBackup.totalPages;
      rewriteSnapshotManifestArtifact(fixture);

      const mainHashBefore = sha256File(fixture.sourcePath);
      const mainMtimeBefore = fs.statSync(fixture.sourcePath).mtimeMs;
      database.exec(`
        CREATE TABLE authority_currentness_drift (
          id TEXT PRIMARY KEY,
          revoked INTEGER NOT NULL
        );
        INSERT INTO authority_currentness_drift VALUES ('grant-1', 1);
      `);
      expect(fs.statSync(`${fixture.sourcePath}-wal`).size).toBeGreaterThan(0);
      expect(sha256File(fixture.sourcePath)).toBe(mainHashBefore);
      expect(fs.statSync(fixture.sourcePath).mtimeMs).toBe(mainMtimeBefore);

      const outputPath = path.join(
        fixture.context.continuousOperationOutputRoot,
        'wal-drift.json',
      );
      expect(() => run(runnableArgs(fixture, outputPath), fixture.context))
        .toThrow(/online backup does not match the selected authority snapshot/i);
      expect(fs.existsSync(outputPath)).toBe(false);
    } finally {
      if (database) database.close();
      fixture.cleanup();
    }
  });
});
