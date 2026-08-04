import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type LingxingCollectionProgressEvent,
  type LingxingCollectionRequestDto,
  type LingxingCollectionResumeState,
  type LingxingCreateReportOutcome,
  type LingxingCreatedReportIdentity,
  type LingxingReportDefinition,
} from '@amazon-ai-ops/shared-types';
import { runLingxingReportBatch, type RunBatchOptions } from './batch-runner';
import type { DownloadCenterAutomationPort } from './download-center-page';

const DATE_RANGE: { start: string; end: string } = {
  start: '2026-07-01',
  end: '2026-07-22',
};

const STORE_CONTEXT = normalizeStoreContextEnvelope({
  storeId: 'shc001',
  browserProfileId: 'profile-shc001',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 12,
});

function createdIdentity(
  report: LingxingReportDefinition,
  dateRange = DATE_RANGE,
): LingxingCreatedReportIdentity {
  return {
    provider: 'lingxing',
    reportType: report.type,
    externalReportName: `${report.type}-${dateRange.start}-${dateRange.end}`,
    externalReportId: `lingxing-${report.type}-42`,
    dateStart: dateRange.start,
    dateEnd: dateRange.end,
    createdAt: '2026-07-22T12:00:00.000Z',
  };
}

function writeValidReport(
  report: LingxingReportDefinition,
  downloadDir: string,
  dateRange = DATE_RANGE,
): string {
  fs.mkdirSync(downloadDir, { recursive: true });
  const filePath = path.join(
    downloadDir,
    `${report.expectedFilenameKeyword}_${dateRange.start}_${dateRange.end}_authority.xlsx`,
  );
  const dimensions: Record<LingxingReportDefinition['type'], string> = {
    campaign: '广告活动',
    ad_group: '广告组',
    placement: '广告位',
    advertised_product: '推广的商品',
    auto_targeting: '自动投放',
    keyword: '关键词',
    product_targeting: '商品投放',
    user_search_term: '用户搜索词',
  };
  const headers = ['日期', '广告活动'];
  if (report.type !== 'campaign') headers.push('广告组');
  if (!['campaign', 'ad_group'].includes(report.type)) headers.push(dimensions[report.type]);
  headers.push('展现量', '点击量', '花费', '订单', '销售额');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers]), 'Report');
  XLSX.writeFile(workbook, filePath);
  return filePath;
}

function automationWith(
  overrides: Partial<DownloadCenterAutomationPort> = {},
): DownloadCenterAutomationPort {
  return {
    async navigateToDownloadCenter() {
      return;
    },
    async createReport(report, dateRange) {
      return { status: 'created', identity: createdIdentity(report, dateRange) };
    },
    async waitForReportReady() {
      return;
    },
    async downloadReport(report, downloadDir, dateRange) {
      return writeValidReport(report, downloadDir, dateRange);
    },
    ...overrides,
  };
}

function runOptions(
  rootDownloadDir: string,
  automation: DownloadCenterAutomationPort,
  overrides: Partial<RunBatchOptions> = {},
): RunBatchOptions {
  return {
    requestId: 'authority-test-request',
    storeContext: STORE_CONTEXT,
    storeDisplayName: 'SHC001 · 美国站',
    dateStart: DATE_RANGE.start,
    dateEnd: DATE_RANGE.end,
    rootDownloadDir,
    reportTypes: ['keyword'],
    maxRetries: 0,
    automation,
    async progressSink() {
      return;
    },
    authorityGuard() {
      return { allowed: true };
    },
    cancellationGuard() {
      return { allowed: true };
    },
    ...overrides,
  };
}

describe('store-authoritative Lingxing collection runner', () => {
  it('accepts only a safe Main-supplied store display label for the legacy batch manifest field', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-store-label-'));
    const automation = automationWith();

    await expect(runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      storeDisplayName: 'C:\\private\\wrong-store',
    }))).rejects.toThrow('storeDisplayName must be a safe');

    const result = await runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      storeDisplayName: '  SHC001   ·   美国站  ',
    }));
    expect(result.batch.storeName).toBe('SHC001 · 美国站');
  });

  it.each([
    {
      label: 'provider reports UNKNOWN',
      outcome: {
        status: 'unknown',
        detail: 'submit clicked but confirmation row was not observed',
      } satisfies LingxingCreateReportOutcome,
      blockerCode: 'LINGXING_CREATE_OUTCOME_UNKNOWN',
    },
    {
      label: 'legacy adapter returns no outcome',
      outcome: undefined,
      blockerCode: 'LINGXING_CREATE_OUTCOME_INVALID',
    },
  ])('stops without a blind create retry when $label', async ({ outcome, blockerCode }) => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-create-unknown-'));
    let createCalls = 0;
    let waitCalls = 0;
    const progress: LingxingCollectionProgressEvent[] = [];
    const automation = automationWith({
      async createReport() {
        createCalls += 1;
        return outcome as LingxingCreateReportOutcome;
      },
      async waitForReportReady() {
        waitCalls += 1;
      },
    });

    const result = await runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      maxRetries: 3,
      progressSink(event) {
        progress.push(event);
      },
    }));

    expect(createCalls).toBe(1);
    expect(waitCalls).toBe(0);
    expect(result.batch.status).toBe('failed');
    expect(result.job.state).toBe('failed');
    expect(result.job.reports[0]).toMatchObject({
      reportType: 'keyword',
      state: 'create_unknown',
      attemptIndex: 0,
      autoRetryCount: 0,
      errorCode: blockerCode,
    });
    expect(result.job.reports[0].createdReportIdentity).toBeUndefined();
    expect(progress.some((event) => event.job.reports[0].state === 'create_unknown')).toBe(true);
  });

  it('stops the whole batch at the first create_unknown and leaves later reports untouched', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-create-unknown-batch-'));
    const automationSteps: string[] = [];
    const automation = automationWith({
      async navigateToDownloadCenter() {
        automationSteps.push('navigate');
      },
      async createReport(report) {
        automationSteps.push(`create:${report.type}`);
        return {
          status: 'unknown',
          detail: 'provider response disappeared at C:\\private\\state.json token=secret-value',
          blockerCode: 'LINGXING_CREATE_RECONCILIATION_REQUIRED',
        };
      },
      async waitForReportReady(report) {
        automationSteps.push(`wait:${report.type}`);
      },
      async downloadReport(report, downloadDir, dateRange) {
        automationSteps.push(`download:${report.type}`);
        return writeValidReport(report, downloadDir, dateRange);
      },
    });

    const result = await runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      reportTypes: ['campaign', 'keyword'],
      maxRetries: 3,
    }));

    expect(automationSteps).toEqual(['navigate', 'create:campaign']);
    expect(result.files).toHaveLength(1);
    expect(result.job).toMatchObject({
      state: 'failed',
      blockerCode: 'LINGXING_CREATE_RECONCILIATION_REQUIRED',
    });
    expect(result.job.detail).toContain('人工核对');
    expect(JSON.stringify(result.job)).not.toContain('C:\\private');
    expect(JSON.stringify(result.job)).not.toContain('secret-value');
    expect(result.job.detail).toContain('[local-path-redacted]');
    expect(result.job.detail).toContain('token=[redacted]');
    expect(result.job.reports.map((report) => report.state)).toEqual([
      'create_unknown',
      'queued',
    ]);
  });

  it('keeps create_unknown as the primary blocker if authority changes before evidence capture', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-unknown-evidence-stale-'));
    let evidenceCalls = 0;
    const automation = automationWith({
      async createReport() {
        return {
          status: 'unknown',
          detail: 'creation may have reached Lingxing',
          blockerCode: 'LINGXING_CREATE_RECONCILIATION_REQUIRED',
        };
      },
      async captureFailureEvidence() {
        evidenceCalls += 1;
        return {};
      },
    });

    const result = await runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      authorityGuard(context) {
        if (context.step === 'capture_failure_evidence') {
          return {
            allowed: false,
            blockerCode: 'STORE_CONTEXT_STALE',
            detail: 'store switched before evidence capture',
          };
        }
        return { allowed: true };
      },
    }));

    expect(evidenceCalls).toBe(0);
    expect(result.job).toMatchObject({
      state: 'failed',
      blockerCode: 'LINGXING_CREATE_RECONCILIATION_REQUIRED',
    });
    expect(result.job.reports[0]).toMatchObject({
      state: 'create_unknown',
      errorCode: 'LINGXING_CREATE_RECONCILIATION_REQUIRED',
    });
    expect(result.batch.manifestPath).toBeUndefined();
  });

  it('persists the confirmed create identity and retries from it without creating twice', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-create-resume-'));
    let createCalls = 0;
    let waitCalls = 0;
    const identitiesSeen: LingxingCreatedReportIdentity[] = [];
    const progress: LingxingCollectionProgressEvent[] = [];
    const automation = automationWith({
      async createReport(report, dateRange) {
        createCalls += 1;
        return { status: 'created', identity: createdIdentity(report, dateRange) };
      },
      async waitForReportReady(_report, _dateRange, identity) {
        waitCalls += 1;
        if (identity) identitiesSeen.push(identity);
        if (waitCalls === 1) throw new Error('download center still generating');
      },
      async downloadReport(report, downloadDir, dateRange, identity) {
        if (identity) identitiesSeen.push(identity);
        return writeValidReport(report, downloadDir, dateRange);
      },
    });

    const result = await runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      maxRetries: 1,
      progressSink(event) {
        progress.push(event);
      },
    }));

    expect(result.batch.status).toBe('completed');
    expect(createCalls).toBe(1);
    expect(waitCalls).toBe(2);
    expect(identitiesSeen).toHaveLength(3);
    expect(new Set(identitiesSeen.map((identity) => identity.externalReportId))).toEqual(
      new Set(['lingxing-keyword-42']),
    );
    expect(result.job.reports[0]).toMatchObject({
      state: 'downloaded',
      attemptIndex: 1,
      autoRetryCount: 1,
      createdReportIdentity: { externalReportId: 'lingxing-keyword-42' },
    });
    const persistedCreated = progress.find((event) => event.job.reports[0].state === 'created');
    expect(persistedCreated?.job.reports[0].createdReportIdentity?.externalReportId).toBe(
      'lingxing-keyword-42',
    );
  });

  it('resumes an exact store-authoritative checkpoint and rejects a changed session generation', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-durable-resume-'));
    const request: LingxingCollectionRequestDto = {
      requestId: 'durable-resume-request',
      storeContext: STORE_CONTEXT,
      dateStart: DATE_RANGE.start,
      dateEnd: DATE_RANGE.end,
      mode: 'create-and-download',
      reportTypes: ['keyword'],
    };
    const identity = createdIdentity({ type: 'keyword' } as LingxingReportDefinition);
    const resumeFrom: LingxingCollectionResumeState = {
      jobId: 'batch_durable_resume',
      request,
      reports: [{
        reportType: 'keyword',
        state: 'created',
        attemptIndex: 0,
        autoRetryCount: 0,
        createdReportIdentity: identity,
        updatedAt: '2026-07-22T12:01:00.000Z',
      }],
    };
    let createCalls = 0;
    const identitiesSeen: string[] = [];
    const automation = automationWith({
      async createReport(report, dateRange) {
        createCalls += 1;
        return { status: 'created', identity: createdIdentity(report, dateRange) };
      },
      async waitForReportReady(_report, _dateRange, createdReport) {
        identitiesSeen.push(createdReport?.externalReportId ?? 'missing');
      },
      async downloadReport(report, downloadDir, dateRange, createdReport) {
        identitiesSeen.push(createdReport?.externalReportId ?? 'missing');
        return writeValidReport(report, downloadDir, dateRange);
      },
    });

    const result = await runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      requestId: request.requestId,
      resumeFrom,
    }));

    expect(result.job.jobId).toBe('batch_durable_resume');
    expect(createCalls).toBe(0);
    expect(identitiesSeen).toEqual(['lingxing-keyword-42', 'lingxing-keyword-42']);
    expect(result.job.reports[0].state).toBe('downloaded');

    const changedContext = normalizeStoreContextEnvelope({
      ...STORE_CONTEXT,
      sessionGeneration: STORE_CONTEXT.sessionGeneration + 1,
    });
    await expect(runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      requestId: request.requestId,
      storeContext: changedContext,
      resumeFrom,
    }))).rejects.toThrow('resume state does not match');
    expect(createCalls).toBe(0);

    const downloadedResume: LingxingCollectionResumeState = {
      ...resumeFrom,
      reports: resumeFrom.reports.map((report) => ({ ...report, state: 'downloaded' as const })),
    };
    await expect(runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      requestId: request.requestId,
      resumeFrom: downloadedResume,
    }))).rejects.toThrow('never redownloaded automatically');
    expect(createCalls).toBe(0);
  });

  it('ignores untouched queued checkpoints while resuming reports with confirmed identities', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-partial-resume-'));
    const request: LingxingCollectionRequestDto = {
      requestId: 'partial-resume-request',
      storeContext: STORE_CONTEXT,
      dateStart: DATE_RANGE.start,
      dateEnd: DATE_RANGE.end,
      mode: 'create-and-download',
      reportTypes: ['campaign', 'keyword'],
    };
    const keywordIdentity: LingxingCreatedReportIdentity = {
      provider: 'lingxing',
      reportType: 'keyword',
      externalReportName: `keyword-${DATE_RANGE.start}-${DATE_RANGE.end}`,
      externalReportId: 'lingxing-keyword-resume',
      dateStart: DATE_RANGE.start,
      dateEnd: DATE_RANGE.end,
      createdAt: '2026-07-22T12:00:00.000Z',
    };
    const resumeFrom: LingxingCollectionResumeState = {
      jobId: 'batch_partial_resume',
      request,
      reports: [
        {
          reportType: 'campaign',
          state: 'queued',
          attemptIndex: 0,
          autoRetryCount: 0,
          updatedAt: '2026-07-22T12:00:00.000Z',
        },
        {
          reportType: 'keyword',
          state: 'navigating',
          attemptIndex: 0,
          autoRetryCount: 0,
          createdReportIdentity: keywordIdentity,
          updatedAt: '2026-07-22T12:01:00.000Z',
        },
      ],
    };
    const createdTypes: string[] = [];
    const automation = automationWith({
      async createReport(report, dateRange) {
        createdTypes.push(report.type);
        return { status: 'created', identity: createdIdentity(report, dateRange) };
      },
    });

    const result = await runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      requestId: request.requestId,
      reportTypes: request.reportTypes,
      resumeFrom,
    }));

    expect(result.job.state).toBe('completed');
    expect(createdTypes).toEqual(['campaign']);
    expect(result.job.reports.map((report) => report.state)).toEqual([
      'downloaded',
      'downloaded',
    ]);
    expect(result.job.reports[1].createdReportIdentity?.externalReportId).toBe(
      'lingxing-keyword-resume',
    );

    const corruptedQueuedResume: LingxingCollectionResumeState = {
      ...resumeFrom,
      reports: resumeFrom.reports.map((report) => (
        report.reportType === 'campaign'
          ? {
              ...report,
              createdReportIdentity: {
                provider: 'lingxing' as const,
                reportType: 'campaign' as const,
                externalReportName: 'campaign-corrupted-queued-identity',
                externalReportId: 'campaign-corrupted',
                dateStart: DATE_RANGE.start,
                dateEnd: DATE_RANGE.end,
                createdAt: '2026-07-22T12:00:00.000Z',
              },
            }
          : report
      )),
    };
    await expect(runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      requestId: request.requestId,
      reportTypes: request.reportTypes,
      resumeFrom: corruptedQueuedResume,
    }))).rejects.toThrow('queued resume checkpoints must not contain');
    expect(createdTypes).toEqual(['campaign']);
  });

  it('checks both guards before every successful browser and filesystem step', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-all-guards-'));
    const authoritySteps: string[] = [];
    const cancellationSteps: string[] = [];
    const automationSteps: string[] = [];
    const automation = automationWith({
      async startAttemptTrace() {
        automationSteps.push('start_trace');
      },
      async navigateToDownloadCenter() {
        automationSteps.push('navigate');
      },
      async createReport(report, dateRange) {
        automationSteps.push('create');
        return { status: 'created', identity: createdIdentity(report, dateRange) };
      },
      async waitForReportReady() {
        automationSteps.push('wait_ready');
      },
      async downloadReport(report, downloadDir, dateRange) {
        automationSteps.push('download');
        return writeValidReport(report, downloadDir, dateRange);
      },
      async stopAttemptTrace(_report, _dateRange, _attempt, retain) {
        automationSteps.push(`stop_trace:${retain}`);
        return undefined;
      },
    });

    const result = await runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      authorityGuard(context) {
        authoritySteps.push(context.step);
        return { allowed: true };
      },
      cancellationGuard(context) {
        cancellationSteps.push(context.step);
        return { allowed: true };
      },
    }));

    expect(result.job.state).toBe('completed');
    expect(authoritySteps).toEqual([
      'start_trace',
      'navigate',
      'create',
      'wait_ready',
      'download',
      'verify',
      'stop_trace',
      'write_manifest',
    ]);
    expect(cancellationSteps).toEqual(authoritySteps);
    expect(automationSteps).toEqual([
      'start_trace',
      'navigate',
      'create',
      'wait_ready',
      'download',
      'stop_trace:false',
    ]);
  });

  it('does not touch trace or failure-evidence automation after authority becomes stale', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-stale-authority-'));
    const automationSteps: string[] = [];
    const progress: LingxingCollectionProgressEvent[] = [];
    let currentSessionGeneration = STORE_CONTEXT.sessionGeneration;
    const automation = automationWith({
      async startAttemptTrace() {
        automationSteps.push('start_trace');
      },
      async navigateToDownloadCenter() {
        automationSteps.push('navigate');
      },
      async createReport(report, dateRange) {
        automationSteps.push('create');
        return { status: 'created', identity: createdIdentity(report, dateRange) };
      },
      async stopAttemptTrace() {
        automationSteps.push('stop_trace');
        return undefined;
      },
      async captureFailureEvidence() {
        automationSteps.push('capture_failure_evidence');
        return {};
      },
    });

    const result = await runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      progressSink(event) {
        progress.push(event);
        if (event.job.reports[0].state === 'creating') {
          currentSessionGeneration += 1;
        }
      },
      authorityGuard(context) {
        if (context.storeContext.sessionGeneration !== currentSessionGeneration) {
          return {
            allowed: false,
            blockerCode: 'STORE_CONTEXT_STALE',
            detail: 'session generation changed while the creating checkpoint was persisted',
          };
        }
        return { allowed: true };
      },
    }));

    expect(automationSteps).toEqual(['start_trace', 'navigate']);
    expect(result.job).toMatchObject({
      state: 'stale_authority',
      blockerCode: 'STORE_CONTEXT_STALE',
    });
    expect(result.job.reports[0]).toMatchObject({
      state: 'stale_authority',
      errorCode: 'STORE_CONTEXT_STALE',
    });
    expect(result.batch.manifestPath).toBeUndefined();
    expect(JSON.stringify(result.job)).not.toContain(rootDownloadDir);
    expect(JSON.stringify(progress)).not.toContain(rootDownloadDir);
    expect(progress.at(-1)?.job.state).toBe('stale_authority');
  });

  it('stops before download and skips evidence when cancellation is observed', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-cancelled-'));
    const automationSteps: string[] = [];
    const automation = automationWith({
      async navigateToDownloadCenter() {
        automationSteps.push('navigate');
      },
      async createReport(report, dateRange) {
        automationSteps.push('create');
        return { status: 'created', identity: createdIdentity(report, dateRange) };
      },
      async waitForReportReady() {
        automationSteps.push('wait_ready');
      },
      async downloadReport(report, downloadDir, dateRange) {
        automationSteps.push('download');
        return writeValidReport(report, downloadDir, dateRange);
      },
      async captureFailureEvidence() {
        automationSteps.push('capture_failure_evidence');
        return {};
      },
    });

    const result = await runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      cancellationGuard(context) {
        if (context.step === 'download') {
          return {
            allowed: false,
            blockerCode: 'COLLECTION_CANCELLED_BY_OPERATOR',
            detail: 'operator cancelled the job',
          };
        }
        return { allowed: true };
      },
    }));

    expect(automationSteps).toEqual(['navigate', 'create', 'wait_ready']);
    expect(result.job).toMatchObject({
      state: 'cancelled',
      blockerCode: 'COLLECTION_CANCELLED_BY_OPERATOR',
    });
    expect(result.job.reports[0].state).toBe('cancelled');
    expect(result.batch.manifestPath).toBeUndefined();
  });

  it('stops after a non-durable created checkpoint and retains the identity for explicit resume', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-progress-failure-'));
    let createCalls = 0;
    let waitCalls = 0;
    let evidenceCalls = 0;
    const guardedSteps: string[] = [];
    const automation = automationWith({
      async createReport(report, dateRange) {
        createCalls += 1;
        return { status: 'created', identity: createdIdentity(report, dateRange) };
      },
      async waitForReportReady() {
        waitCalls += 1;
      },
      async captureFailureEvidence() {
        evidenceCalls += 1;
        return {};
      },
    });

    const result = await runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      maxRetries: 3,
      progressSink(event) {
        if (event.job.reports[0].state === 'created') {
          throw new Error('authority database is unavailable');
        }
      },
      authorityGuard(context) {
        guardedSteps.push(context.step);
        return { allowed: true };
      },
    }));

    expect(createCalls).toBe(1);
    expect(waitCalls).toBe(0);
    expect(evidenceCalls).toBe(0);
    expect(guardedSteps).not.toContain('capture_failure_evidence');
    expect(guardedSteps).not.toContain('write_manifest');
    expect(result.job).toMatchObject({
      state: 'failed',
      blockerCode: 'LINGXING_COLLECTION_PROGRESS_NOT_DURABLE',
    });
    expect(result.job.reports[0]).toMatchObject({
      state: 'failed',
      attemptIndex: 0,
      createdReportIdentity: { externalReportId: 'lingxing-keyword-42' },
    });
    expect(result.batch.manifestPath).toBeUndefined();
  });

  it('preserves a verified downloaded checkpoint when its final progress write fails', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-downloaded-progress-failure-'));
    let createCalls = 0;
    let downloadCalls = 0;
    const automation = automationWith({
      async createReport(report, dateRange) {
        createCalls += 1;
        return { status: 'created', identity: createdIdentity(report, dateRange) };
      },
      async downloadReport(report, downloadDir, dateRange) {
        downloadCalls += 1;
        return writeValidReport(report, downloadDir, dateRange);
      },
    });

    const result = await runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      progressSink(event) {
        if (event.job.reports[0].state === 'downloaded') {
          throw new Error('downloaded checkpoint database write failed');
        }
      },
    }));

    expect(createCalls).toBe(1);
    expect(downloadCalls).toBe(1);
    expect(result.job).toMatchObject({
      state: 'failed',
      blockerCode: 'LINGXING_COLLECTION_PROGRESS_NOT_DURABLE',
    });
    expect(result.job.reports[0]).toMatchObject({
      state: 'downloaded',
      errorCode: 'LINGXING_COLLECTION_PROGRESS_NOT_DURABLE',
      fileSizeBytes: expect.any(Number),
    });
    expect(result.files[0]).toMatchObject({ status: 'downloaded', fileSizeBytes: expect.any(Number) });
    expect(result.files[0].fileSizeBytes).toBeGreaterThan(128);
    expect(fs.existsSync(result.files[0].filePath!)).toBe(true);
    expect(result.batch.manifestPath).toBeUndefined();

    const resumeFrom: LingxingCollectionResumeState = {
      jobId: result.job.jobId,
      request: result.job.request,
      reports: result.job.reports,
    };
    await expect(runLingxingReportBatch(runOptions(rootDownloadDir, automation, {
      requestId: result.job.request.requestId,
      resumeFrom,
    }))).rejects.toThrow('never redownloaded automatically');
    expect(createCalls).toBe(1);
    expect(downloadCalls).toBe(1);
  });
});
