import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type LingxingCollectionJobSnapshot,
  type LingxingCollectionProgressEvent,
} from '@amazon-ai-ops/shared-types';
import * as dataCollectionPage from './data-collection-page';
import {
  buildDataCollectionTaskState,
  buildCollectionMonitorState,
  buildAuthoritativeCollectionDateRange,
  buildCollectionProgressPresentation,
  buildCollectionImportPresentation,
  buildCollectionJobWorkspaceRow,
  CollectionJobWorkspace,
  collectionActionButtonDetail,
  collectionActionButtonLabel,
  collectionActionButtonView,
  collectionActionError,
  collectionActionGuide,
  collectionActionNextStep,
  collectionCompletionNotice,
  collectionProgressBelongsToAuthority,
  collectionJobBelongsToAuthority,
  collectionJobBelongsToStore,
  productionReportFileHasImportReceipt,
  collectionFeedbackActionButtonView,
  collectionOpenArtifactButtonView,
  collectionReportSelectionState,
  dataCollectionFirstViewportReportFolder,
  createLingxingCollectionRequestId,
  runCollectionDownloadAction,
  shouldOfferDownloadCenterVerification,
  upsertCollectionJobSnapshot,
} from './data-collection-page';
import { buildDataImportFeedback, buildDataImportTaskState, buildReportImportStatusDisplay, dataImportFirstViewportReportFolder } from './data-import-validation-page';

const storeContext = normalizeStoreContextEnvelope({
  storeId: 'store_us_primary',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  browserProfileId: 'profile_us_primary',
  sessionGeneration: 4,
});

function collectionProgressEvent(
  state: LingxingCollectionProgressEvent['job']['reports'][number]['state'] = 'downloading',
): LingxingCollectionProgressEvent {
  return {
    eventId: 'batch_1:3',
    emittedAt: '2026-07-22T08:00:00.000Z',
    changedReportType: 'campaign',
    externalStep: state === 'create_unknown' ? 'create' : 'download',
    job: {
      jobId: 'batch_1',
      request: {
        requestId: 'lx:recreate-full:test:abc',
        storeContext,
        dateStart: '2026-07-01',
        dateEnd: '2026-07-21',
        mode: 'create-and-download',
        reportTypes: ['campaign', 'keyword'],
      },
      state: state === 'create_unknown' ? 'completed_with_errors' : 'running',
      reports: [{
        reportType: 'campaign',
        state,
        attemptIndex: 0,
        autoRetryCount: 0,
        updatedAt: '2026-07-22T08:00:00.000Z',
      }],
      createdAt: '2026-07-22T07:59:00.000Z',
      updatedAt: '2026-07-22T08:00:00.000Z',
    },
  };
}

const allReportTypes: LingxingCollectionJobSnapshot['request']['reportTypes'] = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
];

function collectionJob(input: {
  jobId?: string;
  jobState?: LingxingCollectionJobSnapshot['state'];
  checkpointState?: LingxingCollectionJobSnapshot['reports'][number]['state'];
  downloadedCount?: number;
  context?: typeof storeContext;
  canary?: boolean;
  importState?: LingxingCollectionJobSnapshot['importState'];
  importError?: string;
} = {}): LingxingCollectionJobSnapshot {
  const downloadedCount = input.downloadedCount ?? 0;
  const checkpointState = input.checkpointState ?? 'failed';
  return {
    jobId: input.jobId || 'job_recent_1',
    request: {
      requestId: `${input.canary ? 'canary:' : 'lx:'}${input.jobId || 'job_recent_1'}`,
      storeContext: input.context || storeContext,
      dateStart: '2026-07-01',
      dateEnd: '2026-07-21',
      mode: 'create-and-download',
      reportTypes: allReportTypes,
    },
    state: input.jobState || 'failed',
    reports: allReportTypes.map((reportType, index) => ({
      reportType,
      state: index < downloadedCount ? 'downloaded' : index === downloadedCount ? checkpointState : 'queued',
      attemptIndex: 0,
      autoRetryCount: 0,
      updatedAt: `2026-07-22T08:0${Math.min(index, 9)}:00.000Z`,
    })),
    createdAt: '2026-07-22T07:59:00.000Z',
    updatedAt: '2026-07-22T08:10:00.000Z',
    blockerCode: input.jobState === 'failed' ? 'download_timeout' : undefined,
    ...(input.importState ? { importState: input.importState } : {}),
    ...(input.importError ? { importError: input.importError } : {}),
  };
}

describe('DataCollectionPage store authority collection contract', () => {
  it('builds a safe request id and carries a captured US/USD StoreContext', () => {
    const requestId = createLingxingCollectionRequestId('recreate full', 123456, 'unsafe token/value');
    const range = buildAuthoritativeCollectionDateRange({
      action: 'recreate-full',
      dateStart: '2026-07-01',
      dateEnd: '2026-07-21',
      requestId,
      storeContext,
      storeName: 'SHC001',
    });

    expect(requestId).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
    expect(range.requestId).toBe(requestId);
    expect(range.storeContext).toEqual(storeContext);
    expect(range.storeContext).not.toBe(storeContext);
    expect(range.marketplaceCode).toBe('US');
  });

  it('drops delayed prior-store and prior-session progress before it reaches UI state', () => {
    const event = collectionProgressEvent();
    const otherStore = normalizeStoreContextEnvelope({
      ...storeContext,
      storeId: 'store_us_secondary',
      browserProfileId: 'profile_us_secondary',
    });
    const newerSession = normalizeStoreContextEnvelope({ ...storeContext, sessionGeneration: 5 });

    expect(collectionProgressBelongsToAuthority(event, storeContext, event.job.request.requestId)).toBe(true);
    expect(collectionProgressBelongsToAuthority(event, otherStore, event.job.request.requestId)).toBe(false);
    expect(collectionProgressBelongsToAuthority(event, newerSession, event.job.request.requestId)).toBe(false);
    expect(collectionProgressBelongsToAuthority(event, storeContext, 'lx:newer-request')).toBe(false);
  });

  it('surfaces create_unknown as manual reconciliation and never as retryable progress', () => {
    const presentation = buildCollectionProgressPresentation(collectionProgressEvent('create_unknown'));
    const source = readFileSync(new URL('./data-collection-page.tsx', import.meta.url), 'utf8');

    expect(presentation?.manualReconciliation).toBe(true);
    expect(presentation?.tone).toBe('blocked');
    expect(presentation?.statusLabel).toBe('需人工核对');
    expect(presentation?.detail).toContain('已停止本批次和自动重试');
    expect(presentation?.detail).toContain('领星下载中心');
    expect(source).toContain("manualReconciliationRequired && mode !== 'download-existing'");
    expect(source).toContain('disabled={recreateFullButton.disabled || manualReconciliationRequired}');
  });

  it('loads and mutates only job snapshots that belong to the complete current authority', () => {
    const current = collectionJob({ jobId: 'job-current' });
    const priorSession = collectionJob({
      jobId: 'job-prior-session',
      jobState: 'running',
      checkpointState: 'downloading',
      context: normalizeStoreContextEnvelope({ ...storeContext, sessionGeneration: 3 }),
    });

    expect(collectionJobBelongsToAuthority(current, storeContext)).toBe(true);
    expect(collectionJobBelongsToAuthority(priorSession, storeContext)).toBe(false);
    expect(collectionJobBelongsToStore(priorSession, storeContext)).toBe(true);
    expect(buildCollectionJobWorkspaceRow(priorSession, storeContext).action).toBe('resume');
    expect(upsertCollectionJobSnapshot([priorSession, current], {
      ...current,
      state: 'completed',
      updatedAt: '2026-07-22T09:00:00.000Z',
    })).toEqual([
      expect.objectContaining({ jobId: 'job-current', state: 'completed' }),
      priorSession,
    ]);
    expect(upsertCollectionJobSnapshot([{
      ...current,
      state: 'completed',
      updatedAt: '2026-07-22T09:00:00.000Z',
    }], current)[0]).toMatchObject({ state: 'completed', updatedAt: '2026-07-22T09:00:00.000Z' });
  });

  it('offers cancel for running, continue for recoverable jobs, and no recovery for creating or UNKNOWN', () => {
    const running = buildCollectionJobWorkspaceRow(collectionJob({
      jobId: 'job-running',
      jobState: 'running',
      checkpointState: 'downloading',
      downloadedCount: 5,
    }));
    const failed = buildCollectionJobWorkspaceRow(collectionJob({
      jobId: 'job-failed',
      jobState: 'failed',
      checkpointState: 'failed',
      downloadedCount: 6,
    }));
    const cancelled = buildCollectionJobWorkspaceRow(collectionJob({
      jobId: 'job-cancelled',
      jobState: 'cancelled',
      checkpointState: 'cancelled',
      downloadedCount: 4,
    }));
    const creating = buildCollectionJobWorkspaceRow(collectionJob({
      jobId: 'job-creating',
      jobState: 'running',
      checkpointState: 'creating',
      downloadedCount: 0,
    }));
    const unknown = buildCollectionJobWorkspaceRow(collectionJob({
      jobId: 'job-unknown',
      jobState: 'completed_with_errors',
      checkpointState: 'create_unknown',
      downloadedCount: 2,
    }));

    expect(running.action).toBe('cancel');
    expect(running.progressLabel).toBe('5/8 类');
    expect(failed.action).toBe('resume');
    expect(cancelled.action).toBe('resume');
    expect(creating.action).toBe('manual-reconciliation');
    expect(unknown.action).toBe('manual-reconciliation');
    expect(unknown.blockerText).toContain('禁止恢复或重复创建');
  });

  it('marks canary jobs as diagnostic-only and keeps them out of production 8/8 progress', () => {
    const canary = collectionJob({
      jobId: 'job-canary',
      jobState: 'failed',
      checkpointState: 'failed',
      downloadedCount: 1,
      canary: true,
    });
    const row = buildCollectionJobWorkspaceRow(canary, storeContext);
    const markup = renderToStaticMarkup(React.createElement(CollectionJobWorkspace, {
      actionBusyKey: null,
      currentContext: storeContext,
      error: null,
      jobs: [canary],
      loading: false,
      onCancel: vi.fn(),
      onRefresh: vi.fn(),
      onResume: vi.fn(),
    }));

    expect(row.canary).toBe(true);
    expect(row.progressLabel).toBe('1/8 类（Canary）');
    expect(row.progressDetail).toContain('不计入生产 8/8');
    expect(markup).toContain('Canary（不入生产）');
    expect(markup).toContain('继续采集');
  });

  it('does not declare business completion until the durable import lifecycle succeeds', () => {
    const pending = collectionJob({
      jobId: 'job-import-pending',
      jobState: 'completed',
      downloadedCount: 8,
      importState: 'pending',
    });
    const failed = collectionJob({
      jobId: 'job-import-failed',
      jobState: 'completed',
      downloadedCount: 8,
      importState: 'failed',
      importError: 'keyword 表头无法识别',
    });
    const succeeded = collectionJob({
      jobId: 'job-import-succeeded',
      jobState: 'completed',
      downloadedCount: 8,
      importState: 'succeeded',
    });
    const legacy = collectionJob({
      jobId: 'job-import-legacy',
      jobState: 'completed',
      downloadedCount: 8,
    });
    const canary = collectionJob({
      jobId: 'job-import-canary',
      jobState: 'completed',
      downloadedCount: 1,
      canary: true,
      importState: 'not_applicable',
    });

    expect(buildCollectionJobWorkspaceRow(pending).statusLabel).toBe('下载完成，正在导入');
    expect(buildCollectionJobWorkspaceRow(pending).action).toBe('none');
    expect(buildCollectionImportPresentation(pending).productionComplete).toBe(false);
    expect(buildCollectionJobWorkspaceRow(failed)).toMatchObject({
      statusLabel: '导入失败',
      action: 'supplement-import',
    });
    expect(buildCollectionJobWorkspaceRow(failed).blockerText).toContain('keyword 表头无法识别');
    expect(buildCollectionJobWorkspaceRow(succeeded)).toMatchObject({
      statusLabel: '采集与入库完成',
      action: 'none',
    });
    expect(buildCollectionImportPresentation(succeeded).productionComplete).toBe(true);
    expect(buildCollectionJobWorkspaceRow(legacy)).toMatchObject({
      statusLabel: '下载完成，入库待核对',
      action: 'supplement-import',
    });
    expect(buildCollectionImportPresentation(legacy).detail).toContain('不能宣称生产入库成功');
    expect(buildCollectionImportPresentation(canary).label).toBe('Canary 不写生产指标');
  });

  it('renders pending, failed, succeeded, legacy and canary import truth without false completion', () => {
    const pending = collectionJob({ jobId: 'pending', jobState: 'completed', downloadedCount: 8, importState: 'pending' });
    const failed = collectionJob({ jobId: 'failed', jobState: 'completed', downloadedCount: 8, importState: 'failed' });
    const succeeded = collectionJob({ jobId: 'succeeded', jobState: 'completed', downloadedCount: 8, importState: 'succeeded' });
    const legacy = collectionJob({ jobId: 'legacy', jobState: 'completed', downloadedCount: 8 });
    const canary = collectionJob({ jobId: 'canary', jobState: 'completed', downloadedCount: 1, canary: true, importState: 'not_applicable' });
    const markup = renderToStaticMarkup(React.createElement(CollectionJobWorkspace, {
      actionBusyKey: null,
      currentContext: storeContext,
      error: null,
      jobs: [pending, failed, succeeded, legacy, canary],
      loading: false,
      onCancel: vi.fn(),
      onRefresh: vi.fn(),
      onResume: vi.fn(),
    }));

    expect(markup).toContain('等待 / 正在导入');
    expect(markup).toContain('导入失败');
    expect(markup).toContain('补导数据');
    expect(markup).toContain('采集与入库完成');
    expect(markup).toContain('旧任务 · 入库待核对');
    expect(markup).toContain('Canary 不写生产指标');
    expect(buildCollectionProgressPresentation({ ...collectionProgressEvent(), job: pending })?.title).toContain('等待 / 正在导入');
    expect(buildCollectionProgressPresentation({ ...collectionProgressEvent(), job: failed })?.statusLabel).toBe('导入失败');
    expect(buildCollectionProgressPresentation({ ...collectionProgressEvent(), job: succeeded })?.statusLabel).toBe('采集与入库完成');
    expect(buildCollectionProgressPresentation({ ...collectionProgressEvent(), job: legacy })?.statusLabel).toBe('入库待核对');
    expect(buildCollectionProgressPresentation({ ...collectionProgressEvent(), job: canary })?.statusLabel).toBe('Canary 不入生产');
  });

  it('marks the browser development preview as an intentionally empty non-production task list', () => {
    const markup = renderToStaticMarkup(React.createElement(CollectionJobWorkspace, {
      actionBusyKey: null,
      currentContext: storeContext,
      error: null,
      jobs: [],
      loading: false,
      previewOnly: true,
      onCancel: vi.fn(),
      onRefresh: vi.fn(),
      onResume: vi.fn(),
    }));

    expect(markup).toContain('DEV 空任务预览');
    expect(markup).toContain('不会注入伪造采集任务或生产成功');
    expect(markup).toContain('未伪造真实采集、入库或生产成功记录');
  });

  it('renders loading, error, empty, resume-busy, cancel, and manual-reconciliation workspace states', () => {
    const renderWorkspace = (overrides: Partial<Parameters<typeof CollectionJobWorkspace>[0]> = {}) => renderToStaticMarkup(
      React.createElement(CollectionJobWorkspace, {
        actionBusyKey: null,
        error: null,
        jobs: [],
        loading: false,
        onCancel: vi.fn(),
        onRefresh: vi.fn(),
        onResume: vi.fn(),
        ...overrides,
      }),
    );

    const loadingMarkup = renderWorkspace({ loading: true });
    expect(loadingMarkup).toContain('aria-busy="true"');
    expect(loadingMarkup).toContain('正在读取当前店铺最近任务');

    const errorMarkup = renderWorkspace({ error: 'Main unavailable' });
    expect(errorMarkup).toContain('role="alert"');
    expect(errorMarkup).toContain('任务读取失败：Main unavailable');
    expect(errorMarkup).toContain('刷新任务');

    const emptyMarkup = renderWorkspace();
    expect(emptyMarkup).toContain('当前店铺还没有采集任务');

    const failed = collectionJob({ jobId: 'job-failed', jobState: 'failed', downloadedCount: 6 });
    const resumeBusyMarkup = renderWorkspace({ jobs: [failed], actionBusyKey: 'resume:job-failed' });
    expect(resumeBusyMarkup).toContain('6/8 类');
    expect(resumeBusyMarkup).toContain('恢复中...');
    expect(resumeBusyMarkup).toMatch(/<button[^>]*aria-busy="true"[^>]*disabled=""/);

    const runningMarkup = renderWorkspace({
      jobs: [collectionJob({ jobId: 'job-running', jobState: 'running', checkpointState: 'downloading' })],
    });
    expect(runningMarkup).toContain('取消任务');

    const unknownMarkup = renderWorkspace({
      jobs: [collectionJob({ jobId: 'job-unknown', jobState: 'completed_with_errors', checkpointState: 'create_unknown' })],
    });
    expect(unknownMarkup).toContain('人工核对（禁止恢复）');
    expect(unknownMarkup).not.toContain('>继续采集<');
  });

  it('captures storeContext for job and import mutations and drops responses after an authority change', () => {
    const source = readFileSync(new URL('./data-collection-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('listLingxingCollectionJobs({');
    expect(source).toContain('resumeLingxingCollection({');
    expect(source).toContain('cancelLingxingCollection({');
    expect(source).toContain('jobId: job.jobId');
    expect(source).toContain('requestId: job.request.requestId');
    expect(source).toContain('storeContext: captured.storeContext');
    expect(source).toContain("? `canary:${requestSeed}`.slice(0, 128)");
    expect(source).toContain('if (result?.job && !collectionJobBelongsToStore(result.job, captured.storeContext)) return;');
    expect(source).toContain('importCurrentBusinessReports(captured.input)');
    expect(source).toContain('importLocalBusinessReportFiles(captured.input)');
    expect(source).toContain('if (!isCapturedAuthorityCurrent(captured.authorityKey)) return;');
  });
});

describe('DataCollectionPage overlay focus contracts', () => {
  it('wires both modal dialogs to independent shared focus scopes', () => {
    const source = readFileSync(new URL('./data-collection-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const reportSelectorDialogFocus = useOverlayFocusScope');
    expect(source).toContain('open: reportSelectorOpen');
    expect(source).toContain('const reportFileDialogFocus = useOverlayFocusScope');
    expect(source).toContain('open: Boolean(selectedReportFile)');
    expect(source).toContain('ref={reportSelectorDialogFocus.overlayRootRef}');
    expect(source).toContain('ref={reportSelectorDialogFocus.surfaceRef}');
    expect(source).toContain('ref={reportFileDialogFocus.overlayRootRef}');
    expect(source).toContain('ref={reportFileDialogFocus.surfaceRef}');
  });

  it('keeps the monitor non-modal and renders it once', () => {
    const source = readFileSync(new URL('./data-collection-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const monitorDrawerFocus = useOverlayFocusScope');
    expect(source).toContain('modal: false');
    expect(source).toContain('dismissDisabled: !state.canClose');
    expect(source).toContain('ref={monitorDrawerFocus.surfaceRef}');
    expect(source.match(/<CollectionMonitorDrawer/g)).toHaveLength(1);
  });
});

describe('DataCollectionPage first-screen artifact disclosure', () => {
  it('uses business labels while keeping the primary report folder openable', () => {
    const source = readFileSync(new URL('./data-collection-page.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('compactPath(primaryReportFolder)');
    expect(source).toContain('当前范围原始报表目录');
    expect(source).toContain('已创建，可打开');
    expect(source).toContain("idleLabel: '打开目录', artifactId: primaryReportFolderArtifactId");
    expect(source).toContain("idleLabel: '打开报表目录', artifactId: primaryReportFolderArtifactId");
    expect(source).toContain('openReportArtifact');
    expect(source).not.toContain('openReportPath');
  });

  it('never consumes absolute-path fields from collection or import responses', () => {
    const source = readFileSync(new URL('./data-collection-page.tsx', import.meta.url), 'utf8');

    for (const forbidden of ['filePath', 'folderPath', 'downloadDir', 'manifestPath', 'screenshotPath', 'domSnapshotPath']) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain('artifactId');
    expect(source).toContain('folderArtifactId');
  });
});

describe('collectionActionNextStep', () => {
  it('routes a fully proven 8-type import to ad performance', () => {
    expect(collectionActionNextStep({
      canEnterDiagnosis: true,
      failedWithoutFiles: false,
      importedRows: 96,
      realFileCount: 8,
    })).toBe('下一步：查看广告表现，复核 ACOS、花费和订单口径。');
  });

  it('does not treat a non-zero global row total as full per-type readiness', () => {
    expect(collectionActionNextStep({
      canEnterDiagnosis: false,
      failedWithoutFiles: false,
      importedRows: 96,
      realFileCount: 8,
    })).toContain('只有完整 8 类逐类入库后');
  });
});

describe('collectionCompletionNotice', () => {
  it('does not claim a download action completed when no real file was produced by this action', () => {
    const notice = collectionCompletionNotice({
      title: '下载并导入已创建报表未完成',
      tone: 'blocked',
      mode: 'download-existing',
      batchIds: ['batch_1'],
      downloadedCount: 8,
      actionDownloadedFiles: [],
      failedCount: 0,
      parsedFiles: 0,
      insertedRows: 0,
      currentImportedRows: 96,
      nextStep: '下一步：检查下载中心页面、报表 ready 状态或失败报表后重试。',
      failedFiles: [],
    });

    expect(notice).toContain('本次没有新增真实原始报表文件');
    expect(notice).not.toContain('采集动作已完成');
  });

  it('allows ad quantification only after the current action produced real files and rows are imported', () => {
    const notice = collectionCompletionNotice({
      title: '下载并导入已创建报表完成',
      tone: 'success',
      mode: 'download-existing',
      batchIds: ['batch_1'],
      downloadedCount: 8,
      actionDownloadedFiles: [
        { label: '关键词报告', fileName: 'keyword.xlsx', fileExtension: '.xlsx', artifactId: 'artifact:v1:keyword', fileSizeBytes: 1024 },
      ],
      failedCount: 0,
      parsedFiles: 1,
      insertedRows: 96,
      currentImportedRows: 96,
      nextStep: '下一步：查看广告表现，复核 ACOS、花费和订单口径。',
      failedFiles: [],
    });

    expect(notice).toBe('采集动作已完成：本次新增 1 个真实原始报表文件，当前范围覆盖 8/8 类真实报表，已自动导入 96 行广告指标。');
  });

  it('records a partial header-only import as a receipt while keeping the full-lineage gate explicit', () => {
    const notice = collectionCompletionNotice({
      title: '真实报表导入完成',
      tone: 'success',
      mode: 'import',
      batchIds: ['batch_empty'],
      downloadedCount: 1,
      actionDownloadedFiles: [],
      failedCount: 0,
      parsedFiles: 1,
      insertedRows: 0,
      currentImportedRows: 0,
      nextStep: '下一步：补齐日级广告指标。',
      failedFiles: [],
    });

    expect(notice).toContain('零行回执已登记');
    expect(notice).toContain('完整 8 类任务血缘核对');
  });

  it('describes a fully proven zero-row lineage as a real zero-data state', () => {
    const notice = collectionCompletionNotice({
      title: '真实报表导入完成',
      tone: 'success',
      mode: 'import',
      batchIds: ['batch_empty'],
      downloadedCount: 8,
      actionDownloadedFiles: [],
      failedCount: 0,
      parsedFiles: 8,
      insertedRows: 0,
      currentImportedRows: 0,
      productionReady: true,
      nextStep: '下一步：查看广告表现。',
      failedFiles: [],
    });

    expect(notice).toContain('可进入广告表现查看零数据状态');
  });

  it('uses the exact production binding instead of row count for zero-row import display', () => {
    const file = { batchId: 'job_empty', importedRows: 0, status: 'downloaded' };
    expect(productionReportFileHasImportReceipt(file, {
      expectedBatchId: 'job_empty',
      fileBatchId: 'job_empty',
      state: 'imported',
    })).toBe(true);
    expect(productionReportFileHasImportReceipt(file, {
      expectedBatchId: 'job_other',
      fileBatchId: 'job_other',
      state: 'imported',
    })).toBe(false);
  });
});

describe('collectionActionError', () => {
  it('keeps download-existing and recreate failures action-specific for Chinese missing-report errors', () => {
    const downloadError = collectionActionError('download-existing', new Error('当前范围缺少可下载报表批次'));
    const recreateError = collectionActionError('recreate-full', new Error('当前范围缺少可下载报表批次'));

    expect(downloadError).toContain('没有可直接下载的已创建报表');
    expect(downloadError).toContain('不会创建新任务');
    expect(recreateError).toContain('重新创建后仍没有拿到可用的真实报表文件');
    expect(recreateError).not.toBe(downloadError);
  });

  it('marks page-model and diagnostic failures as directly verifiable', () => {
    expect(shouldOfferDownloadCenterVerification(
      collectionActionError('recreate-full', new Error('no matching download-center diagnostic exists for this page model')),
    )).toBe(true);
    expect(shouldOfferDownloadCenterVerification(
      collectionActionError('download-existing', new Error('当前范围缺少可下载报表批次')),
    )).toBe(true);
    expect(shouldOfferDownloadCenterVerification('领星浏览器会话未就绪：请先登录。')).toBe(false);
  });
});

describe('collectionActionGuide', () => {
  it('makes download-existing distinct from recreate actions', () => {
    const downloadExisting = collectionActionGuide('download-existing');
    const recreateSelected = collectionActionGuide('recreate-selected');
    const recreateFull = collectionActionGuide('recreate-full');
    const importLocal = collectionActionGuide('import');

    expect(downloadExisting.taskEffect).toBe('不会创建新任务');
    expect(downloadExisting.whenToUse).toContain('领星已经生成 ready 行');
    expect(downloadExisting.result).toContain('自动写入 DB');

    expect(recreateSelected.taskEffect).toBe('会创建当前勾选报表的新任务');
    expect(recreateSelected.whenToUse).toContain('已选报表');

    expect(recreateFull.taskEffect).toBe('会创建完整 8 类报表的新任务');
    expect(recreateFull.whenToUse).toContain('缺少完整 8 类');

    expect(importLocal.taskEffect).toBe('不访问领星下载中心');
    expect(importLocal.result).toContain('写入 DB 日级广告指标');
  });
});

describe('runCollectionDownloadAction', () => {
  it('auto-verifies the current download center scope before retrying full report recreation', async () => {
    const calls: string[] = [];
    const api = {
      collectLingxingReports: vi.fn()
        .mockImplementationOnce(async () => {
          calls.push('collect:first');
          throw new Error('下载中心页面模型缺少同模型、同日期范围、同店铺/站点的近期诊断证据，无法创建或下载');
        })
        .mockImplementationOnce(async () => {
          calls.push('collect:second');
          return { batch: { id: 'batch_1' }, files: [] };
        }),
      diagnoseLingxingDownloadCenter: vi.fn(async () => {
        calls.push('diagnose');
        return { ready: true, screenshotPath: 'C:/evidence/download-center.png' };
      }),
      downloadExistingLingxingReports: vi.fn(),
      retryLingxingReport: vi.fn(),
    };

    const result = await runCollectionDownloadAction({
      api,
      mode: 'recreate-full',
      dateRange: {
        start: '2026-05-21',
        end: '2026-06-23',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
      },
      targetTypes: ['campaign', 'keyword'],
    });

    expect(calls).toEqual(['collect:first', 'diagnose', 'collect:second']);
    expect(api.diagnoseLingxingDownloadCenter).toHaveBeenCalledWith({
      start: '2026-05-21',
      end: '2026-06-23',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
    });
    expect(result.autoVerified).toBe(true);
    expect(result.actionResults).toHaveLength(1);
  });
});

describe('task-first data page helpers', () => {
  it('opens a non-dismissible monitor state while full report recreation is running', () => {
    const monitor = buildCollectionMonitorState({
      runningAction: 'recreate-full',
      actionNotice: '正在重新创建全部 8 类报表、下载并自动导入：广告活动报告',
      actionError: null,
      lastActionResult: null,
      lastDiagnostic: null,
      realReportCount: 0,
      importedRowCount: 0,
    });

    expect(monitor?.tone).toBe('pending');
    expect(monitor?.statusLabel).toBe('处理中');
    expect(monitor?.headline).toBe('重新创建、下载并导入全部 8 类');
    expect(monitor?.detail).toContain('正在重新创建全部 8 类报表');
    expect(monitor?.canClose).toBe(false);
  });

  it('turns collection blockers into a visible monitor repair state', () => {
    const monitor = buildCollectionMonitorState({
      runningAction: null,
      actionNotice: '创建并下载未完成。',
      actionError: '页面验证未通过：缺少关键控件。',
      lastActionResult: null,
      lastDiagnostic: { ready: false, screenshotArtifactId: 'artifact:v1:diagnostic' },
      realReportCount: 0,
      importedRowCount: 0,
    });

    expect(monitor?.tone).toBe('blocked');
    expect(monitor?.statusLabel).toBe('需处理');
    expect(monitor?.detail).toContain('采集动作被阻断');
    expect(monitor?.previewDetail).toContain('诊断证据已登记');
    expect(monitor?.canClose).toBe(true);
  });

  it('summarizes successful collection results in the monitor', () => {
    const monitor = buildCollectionMonitorState({
      runningAction: null,
      actionNotice: '采集动作已完成：本次新增 1 个真实原始报表文件。',
      actionError: null,
      lastActionResult: {
        title: '重新创建、下载并导入全部 8 类报表完成',
        tone: 'success',
        mode: 'recreate-full',
        batchIds: ['batch_1'],
        downloadedCount: 8,
        actionDownloadedFiles: [
          { label: '关键词报告', fileName: 'keyword.xlsx', fileExtension: '.xlsx', artifactId: 'artifact:v1:keyword', fileSizeBytes: 1024 },
        ],
        failedCount: 0,
        parsedFiles: 1,
        insertedRows: 96,
        currentImportedRows: 96,
        nextStep: '下一步：查看广告表现。',
        failedFiles: [],
      },
      lastDiagnostic: null,
      realReportCount: 8,
      importedRowCount: 96,
    });

    expect(monitor?.tone).toBe('ready');
    expect(monitor?.statusLabel).toBe('已返回');
    expect(monitor?.headline).toContain('全部 8 类');
    expect(monitor?.previewDetail).toContain('当前范围覆盖 8/8 类');
    expect(monitor?.canClose).toBe(true);
  });

  it('renders an honest process-and-evidence state instead of an empty browser canvas', () => {
    const Drawer = dataCollectionPage.CollectionMonitorDrawer;
    expect(typeof Drawer).toBe('function');
    if (!Drawer) return;

    const state = buildCollectionMonitorState({
      runningAction: 'recreate-full',
      actionNotice: '正在重新创建全部 8 类报表、下载并自动导入。',
      actionError: null,
      lastActionResult: null,
      lastDiagnostic: null,
      realReportCount: 0,
      importedRowCount: 0,
    });
    expect(state).toBeTruthy();

    const markup = renderToStaticMarkup(React.createElement(Drawer, {
      state: state!,
      steps: [{ label: '1. 验证当前范围', description: '检查日期和店铺。', status: 'pending' }],
      evidenceAvailable: true,
      onClose: vi.fn(),
    }));
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(markup).not.toContain('<canvas');
    expect(markup).toContain('aria-label="采集流程状态与最近证据"');
    expect(markup).toContain('role="status"');
    expect(css).toContain('.collection-monitor-preview-canvas');
    expect(css).toContain('.collection-monitor-preview-overlay');
  });

  it('uses the full 8-report refresh as the data collection primary action until rows are imported', () => {
    const firstViewportFolder = dataCollectionFirstViewportReportFolder({
      realReportCount: 0,
      realFiles: [],
      evidenceFolderArtifactId: 'artifact:v1:evidence-folder',
      auditDownloadArtifactId: 'artifact:v1:report-folder',
    });
    const task = buildDataCollectionTaskState({
      realReportCount: 0,
      importedRowCount: 0,
      primaryReportFolderArtifactId: firstViewportFolder,
      runningAction: null,
      readiness: { status: 'blocked', canEnterDiagnosis: false, nextStep: 'collect' },
    });

    expect(firstViewportFolder).toBeUndefined();
    expect(task.title).toBe('真实报表 0/8，已导入 0 行');
    expect(task.primaryActionLabel).toBe('重新获取完整 8 类报表');
    expect(task.secondaryActionLabel).toBe('导入本地报表');
  });

  it('moves data collection to ad performance after full reports and imported rows exist', () => {
    const task = buildDataCollectionTaskState({
      realReportCount: 8,
      importedRowCount: 96,
      primaryReportFolderArtifactId: 'artifact:v1:report-folder',
      runningAction: null,
      readiness: { status: 'ready', canEnterDiagnosis: true, nextStep: 'diagnose' },
    });

    expect(task.title).toBe('真实报表 8/8，已导入 96 行');
    expect(task.primaryActionLabel).toBe('查看广告表现');
    expect(task.secondaryActionLabel).toBe('打开报表目录');
  });

  it('keeps the collection task blocked when one of eight report types has no imported rows', () => {
    const task = buildDataCollectionTaskState({
      realReportCount: 8,
      importedRowCount: 96,
      primaryReportFolderArtifactId: 'artifact:v1:report-folder',
      runningAction: null,
      readiness: { status: 'blocked', canEnterDiagnosis: false, nextStep: 'import' },
    });

    expect(task.isComplete).toBe(false);
    expect(task.primaryActionLabel).toBe('导入已下载表格');
    expect(task.detail).not.toContain('已闭合');
  });

  it('wires the collection task model into one first-screen TaskBanner', () => {
    const source = readFileSync(new URL('./data-collection-page.tsx', import.meta.url), 'utf8');
    const header = source.slice(source.indexOf('<PageHeader'), source.indexOf('/>', source.indexOf('<PageHeader')) + 2);
    const primaryPanel = source.slice(source.indexOf('className="data-collection-primary-panel"'), source.indexOf('data-collection-secondary-actions'));

    expect(source).toContain('const taskState = buildDataCollectionTaskState({');
    expect(source.match(/<TaskBanner/g)).toHaveLength(1);
    expect(source).toContain('title={taskState.title}');
    expect(source).toContain('description={taskState.detail}');
    expect(source).toContain('label: taskState.primaryActionLabel');
    expect(header).not.toContain('primaryAction=');
    expect(primaryPanel).not.toContain('className={runningAction ? \'primary-button button-loading\' : \'primary-button\'}');
  });

  it('shortens 8-report chooser action labels without changing action modes', () => {
    expect(collectionActionButtonLabel('download-existing')).toBe('下载已创建报表');
    expect(collectionActionButtonLabel('recreate-selected')).toBe('重新获取已选报表');
    expect(collectionActionButtonLabel('recreate-full')).toBe('重新获取完整 8 类报表');
    expect(collectionActionButtonLabel('import')).toBe('导入本地报表');
    expect(collectionActionButtonDetail('recreate-full')).toBe('创建、下载并导入完整 8 类');
    expect(collectionActionButtonDetail('import')).toBe('选择本地 xlsx/xls/csv');
  });

  it('keeps secondary report actions folded so the first screen has one primary collection action', () => {
    const source = readFileSync(new URL('./data-collection-page.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(source).toContain('更多报表操作');
    expect(source).toContain('data-collection-secondary-actions');
    expect(source).toContain('data-collection-secondary-action-row');
    expect(source).not.toContain('8 类报表选择与进度');
    expect(source).not.toContain('collection-action-grid');
    expect(source.indexOf('label: taskState.primaryActionLabel')).toBeLessThan(source.indexOf('data-collection-secondary-actions'));
    expect(css).toContain('.data-collection-secondary-actions');
    expect(css).toContain('.data-collection-secondary-action-row');
  });

  it('keeps collection evidence drawers at one disclosure level', () => {
    const source = readFileSync(new URL('./data-collection-page.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('<ProgressiveDetails title="辅助采集账本、流程和技术细节">');
    expect(source).toContain('<ProgressiveDetails title="当前范围数据账本">');
    expect(source).toContain('<ProgressiveDetails title="验收审计/技术细节">');
  });

  it('gives collection action buttons an explicit busy contract while a report action runs', () => {
    const running = collectionActionButtonView({
      mode: 'recreate-full',
      runningAction: 'recreate-full',
      selectedCount: 8,
    });
    const locked = collectionActionButtonView({
      mode: 'download-existing',
      runningAction: 'recreate-full',
      selectedCount: 8,
    });

    expect(running.label).toBe('处理中...');
    expect(running.detail).toBe('正在重新创建、下载并导入全部 8 类');
    expect(running.disabled).toBe(true);
    expect(running.ariaBusy).toBe(true);
    expect(running.className).toContain('collection-action-button-running');
    expect(running.className).toContain('button-loading');

    expect(locked.label).toBe('下载已创建报表');
    expect(locked.disabled).toBe(true);
    expect(locked.ariaBusy).toBe(false);
    expect(locked.className).not.toContain('collection-action-button-running');
  });

  it('keeps feedback repair action buttons visible with a focused busy contract', () => {
    const active = collectionFeedbackActionButtonView({
      idleLabel: '验证页面',
      runningAction: 'verify-page',
      targetAction: 'verify-page',
      variant: 'primary',
    });
    const locked = collectionFeedbackActionButtonView({
      idleLabel: '重试获取 8 类',
      runningAction: 'verify-page',
      targetAction: 'recreate-full',
      variant: 'secondary',
    });

    expect(active.label).toBe('处理中...');
    expect(active.disabled).toBe(true);
    expect(active.ariaBusy).toBe(true);
    expect(active.showSpinner).toBe(true);
    expect(active.className).toContain('primary-button');
    expect(active.className).toContain('button-loading');

    expect(locked.label).toBe('重试获取 8 类');
    expect(locked.disabled).toBe(true);
    expect(locked.ariaBusy).toBe(false);
    expect(locked.showSpinner).toBe(false);
    expect(locked.className).toContain('secondary-button');
    expect(locked.className).not.toContain('button-loading');
  });

  it('gives store-bound artifact buttons an explicit busy contract while opening a file or folder', () => {
    const active = collectionOpenArtifactButtonView({
      activeArtifactKey: '打开报表目录:artifact:v1:reports',
      idleLabel: '打开报表目录',
      artifactKey: '打开报表目录:artifact:v1:reports',
    });
    const locked = collectionOpenArtifactButtonView({
      activeArtifactKey: '打开报表目录:artifact:v1:reports',
      idleLabel: '打开采集清单',
      artifactKey: '打开采集清单:artifact:v1:manifest',
    });

    expect(active.label).toBe('打开中...');
    expect(active.disabled).toBe(true);
    expect(active.ariaBusy).toBe(true);
    expect(active.showSpinner).toBe(true);
    expect(active.className).toContain('button-loading');

    expect(locked.label).toBe('打开采集清单');
    expect(locked.disabled).toBe(true);
    expect(locked.ariaBusy).toBeUndefined();
    expect(locked.showSpinner).toBe(false);
    expect(locked.className).not.toContain('button-loading');
  });

  it('keeps per-file path operations behind a detail dialog instead of crowding the report table', () => {
    const source = readFileSync(new URL('./data-collection-page.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(source).toContain('selectedReportFile');
    expect(source).toContain('collection-file-modal');
    expect(source).toContain('查看${file.displayName}文件详情');
    expect(source).toContain('<th>文件</th>');
    expect(source).not.toContain('<th>文件路径</th>');
    expect(source).not.toContain('<th>文件指纹</th>');
    expect(source).not.toContain('<td><code>{file.filePath}</code></td>');
    expect(source).not.toContain('<td><code>{shortHash(file.fileHash)}</code></td>');
    expect(css).toContain('.collection-file-detail-grid');
    expect(css).toContain('.collection-file-path-block');
  });

  it('gives report checkbox selection an explicit count and progress response', async () => {
    expect(collectionReportSelectionState({
      selectedCount: 0,
      totalCount: 8,
      missingCount: 3,
      unimportedCount: 2,
    })).toMatchObject({
      ariaStatus: '当前未选择报表；可一键选择 3 个缺失报表或 2 个待入库报表。',
      countClassName: 'collection-selection-count',
      countLabel: '已选 0/8 类',
      progressPercent: 0,
      progressStyle: { '--collection-selection-progress': '0%' },
    });

    expect(collectionReportSelectionState({
      selectedCount: 5,
      totalCount: 8,
      missingCount: 3,
      unimportedCount: 2,
    })).toMatchObject({
      ariaStatus: '已选择 5 类报表，下载和重建只会作用于这些勾选项。',
      countClassName: 'collection-selection-count collection-selection-count-active',
      countLabel: '已选 5/8 类',
      progressPercent: 63,
      progressStyle: { '--collection-selection-progress': '63%' },
    });

    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    expect(css).toContain('.collection-selection-progress');
    expect(css).toContain('.collection-selection-count-active');
    expect(css).toContain('collection-report-check-pop');
    expect(css).toMatch(/\.report-option-selected\s*\{[^}]*box-shadow:/s);
    expect(css).toMatch(/\.report-option input:checked\s*\{[^}]*animation:\s*collection-report-check-pop/s);
    expect(css).toMatch(/\.report-option:focus-within\s*\{[^}]*box-shadow:/s);
  });

  it('aligns data import primary actions to report and row readiness', () => {
    const firstViewportFolder = dataImportFirstViewportReportFolder({
      realReportCount: 0,
      realFiles: [],
      auditDownloadArtifactId: 'artifact:v1:reports',
    });

    expect(firstViewportFolder).toBeUndefined();
    const collectReadiness = { status: 'blocked' as const, canEnterDiagnosis: false, nextStep: 'collect' as const };
    const importReadiness = { status: 'blocked' as const, canEnterDiagnosis: false, nextStep: 'import' as const };
    const readyReadiness = { status: 'ready' as const, canEnterDiagnosis: true, nextStep: 'diagnose' as const };
    expect(buildDataImportTaskState({ realReportCount: 0, importedRows: 0, reportFolderArtifactId: firstViewportFolder, readiness: collectReadiness }).primaryActionLabel).toBe('去数据采集');
    expect(buildDataImportTaskState({ realReportCount: 0, importedRows: 0, reportFolderArtifactId: firstViewportFolder, readiness: collectReadiness }).secondaryActionLabel).toBe('导入本地报表');
    expect(buildDataImportTaskState({ realReportCount: 8, importedRows: 0, reportFolderArtifactId: 'artifact:v1:reports', readiness: importReadiness }).primaryActionLabel).toBe('导入已下载表格');
    expect(buildDataImportTaskState({ realReportCount: 8, importedRows: 96, reportFolderArtifactId: 'artifact:v1:reports', readiness: readyReadiness }).primaryActionLabel).toBe('查看广告表现');
  });

  it('makes downloaded report files explicitly wait for DB import', () => {
    const status = buildReportImportStatusDisplay({
      status: 'downloaded',
      importedRows: 0,
      artifactId: 'artifact:v1:campaign',
    });

    expect(status.label).toBe('已下载待入库');
    expect(status.detail).toContain('导入已下载表格');
    expect(status.tone).toBe('warning');
  });

  it('shows first-viewport import feedback instead of hiding progress in details', () => {
    expect(buildDataImportFeedback({
      realReportCount: 8,
      importedRows: 0,
      runningImport: 'current',
      readiness: { status: 'blocked', canEnterDiagnosis: false, nextStep: 'import' },
    }).title).toBe('正在写入 SQLite');

    const ready = buildDataImportFeedback({
      realReportCount: 8,
      importedRows: 96,
      runningImport: null,
      readiness: { status: 'ready', canEnterDiagnosis: true, nextStep: 'diagnose' },
    });
    expect(ready.statusLabel).toBe('已入库');
    expect(ready.detail).toContain('96 行日级广告指标');

    const partial = buildDataImportFeedback({
      realReportCount: 8,
      importedRows: 72,
      runningImport: null,
      readiness: { status: 'blocked', canEnterDiagnosis: false, nextStep: 'import' },
    });
    expect(partial.title).toBe('部分报表已有入库回执');
    expect(partial.statusLabel).toBe('待补齐');
    expect(partial.tone).toBe('warning');
    expect(partial.detail).toContain('不能进入正式诊断');
  });
});
