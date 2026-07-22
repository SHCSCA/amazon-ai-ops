import { describe, expect, it } from 'vitest';
import verifierModule from './verify-s7-continuous-operation.js';

const {
  EXPECTED_REPORT_TYPES,
  evaluateContinuousOperationSnapshot,
  inclusiveDates,
  parseArgs,
} = verifierModule;

const dates = inclusiveDates('2026-07-15', '2026-07-21');
const input = {
  stores: ['shc001', 'shc002'],
  dates,
  dateFrom: dates[0],
  dateTo: dates[6],
};

function validSnapshot() {
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
      jobs.push({
        storeId: store.storeId,
        jobId,
        requestId: `request-${store.storeId}-${businessDate}`,
        browserProfileId: store.browserProfileId,
        marketplace: 'US',
        currency: 'USD',
        businessDate,
        state: 'completed',
        blockerCode: null,
        detail: '8/8 reports downloaded and imported',
        updatedAt: `${businessDate}T16:00:00.000Z`,
      });
      imports.push({
        storeId: store.storeId,
        runId,
        idempotencyKey: `idem-${store.storeId}-${dayIndex}`,
        inputFingerprint: `fingerprint-${store.storeId}-${dayIndex}`,
        batchId: `batch-${store.storeId}-${dayIndex}`,
        status: 'completed',
        sourceFileCount: 8,
        metricRowCount: 120,
        reconciliationCount: 8,
        completedAt: `${businessDate}T16:10:00.000Z`,
        businessDate,
      });
      for (const [reportIndex, reportType] of EXPECTED_REPORT_TYPES.entries()) {
        checkpoints.push({ storeId: store.storeId, jobId, reportType, state: 'downloaded' });
        importFiles.push({
          storeId: store.storeId,
          runId,
          reportType,
          fileHash: `hash-${store.storeId}-${dayIndex}-${reportIndex}`,
          importedRows: 15,
        });
        reconciliations.push({
          storeId: store.storeId,
          runId,
          reportType,
          status: 'matched',
          withinTolerance: 1,
        });
      }
    }
  }
  return { stores, jobs, checkpoints, imports, importFiles, reconciliations };
}

describe('S7 continuous operation verifier', () => {
  it('accepts two isolated US/USD stores with seven complete 8/8 days', () => {
    const result = evaluateContinuousOperationSnapshot(validSnapshot(), input);
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.stores).toHaveLength(2);
    expect(result.stores.every((store) => store.acceptedDayCount === 7)).toBe(true);
    expect(result.stores.flatMap((store) => store.days).every((day) => day.outcome === 'SUCCESS_8_OF_8')).toBe(true);
  });

  it('accepts an explicitly blocked day only when terminal state, code and repair detail are durable', () => {
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
    expect(result.passed).toBe(true);
    expect(result.stores[1].days[3]).toMatchObject({ outcome: 'EXPLICIT_BLOCKED', accepted: true });
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
    snapshot.imports[1].businessDate = snapshot.imports[0].businessDate;
    snapshot.importFiles[8].fileHash = snapshot.importFiles[0].fileHash;
    snapshot.importFiles[8].reportType = snapshot.importFiles[0].reportType;
    snapshot.jobs[0].browserProfileId = 'profile-shc002';

    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    expect(result.passed).toBe(false);
    expect(result.violations.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'DUPLICATE_IMPORT_FINGERPRINT',
      'DUPLICATE_IMPORT_FILE',
      'CROSS_STORE_JOB_IDENTITY',
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
    const firstStoreOneFile = snapshot.importFiles.find((row) => row.storeId === 'shc001');
    const firstStoreTwoFile = snapshot.importFiles.find((row) => row.storeId === 'shc002');
    firstStoreTwoFile.fileHash = firstStoreOneFile.fileHash;

    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    expect(result.passed).toBe(false);
    expect(result.violations.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'IMPORT_NOT_VERIFIED',
      'CROSS_STORE_PROFILE_IDENTITY',
      'CROSS_STORE_IMPORT_FINGERPRINT',
      'CROSS_STORE_IMPORT_FILE_HASH',
    ]));
  });

  it('requires exactly two stores and exactly seven inclusive business dates', () => {
    expect(() => parseArgs([
      '--database', 'test.db',
      '--store', 'SHC001',
      '--date-from', '2026-07-15',
      '--date-to', '2026-07-21',
    ])).toThrow(/Exactly two distinct/);
    expect(() => parseArgs([
      '--database', 'test.db',
      '--store', 'SHC001',
      '--store', 'SHC002',
      '--date-from', '2026-07-15',
      '--date-to', '2026-07-20',
    ])).toThrow(/exactly seven/);
  });
});
