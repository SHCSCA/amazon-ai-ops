
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope, type LingxingCollectionJobSnapshot } from '@amazon-ai-ops/shared-types';

import { buildAuthoritativeCollectionDateRange, buildCollectionProgressPresentation, buildCollectionImportPresentation, buildCollectionJobLineagePresentation, buildCollectionJobWorkspaceRow, CollectionJobWorkspace, collectionActionFeedbackBelongsToAuthority, collectionProgressBelongsToAuthority, collectionJobBelongsToAuthority, collectionJobBelongsToStore, createLingxingCollectionRequestId, resolveAuthoritativeCollectionCapture, retainCollectionActionFeedback, upsertCollectionJobSnapshot } from './data-collection-page';

import { storeContext, collectionProgressEvent, collectionJob } from './collection.test-fixtures';
import { collectionCompositionSource } from './collection-composition.test-support';

describe('DataCollectionPage store authority collection contract', () => {
  it('keeps operator failure feedback when only the same store session generation moves forward', () => {
    const nextGeneration = normalizeStoreContextEnvelope({
      ...storeContext,
      sessionGeneration: storeContext.sessionGeneration + 1,
    });

    expect(collectionActionFeedbackBelongsToAuthority(storeContext, nextGeneration)).toBe(true);
  });

  it('drops operator feedback when store, profile, site, currency, business date, timezone, or generation lineage changes', () => {
    const nextGeneration = storeContext.sessionGeneration + 1;
    const changedContexts = [
      normalizeStoreContextEnvelope({ ...storeContext, storeId: 'store_us_secondary', sessionGeneration: nextGeneration }),
      normalizeStoreContextEnvelope({ ...storeContext, browserProfileId: 'profile_us_secondary', sessionGeneration: nextGeneration }),
      { ...storeContext, marketplace: 'CA', sessionGeneration: nextGeneration } as unknown as typeof storeContext,
      { ...storeContext, currency: 'CAD', sessionGeneration: nextGeneration } as unknown as typeof storeContext,
      normalizeStoreContextEnvelope({ ...storeContext, businessDate: '2026-07-23', sessionGeneration: nextGeneration }),
      normalizeStoreContextEnvelope({ ...storeContext, businessTimezone: 'UTC', sessionGeneration: nextGeneration }),
      normalizeStoreContextEnvelope({ ...storeContext, sessionGeneration: storeContext.sessionGeneration - 1 }),
    ];

    expect(changedContexts.map((current) => (
      collectionActionFeedbackBelongsToAuthority(storeContext, current)
    ))).toEqual([false, false, false, false, false, false, false]);
    expect(collectionActionFeedbackBelongsToAuthority(storeContext, null)).toBe(false);
  });

  it('retains the current Chinese action failure only across a forward generation transition', () => {
    const failure = {
      notice: '创建并下载未完成。',
      error: '当前领星会话需要重新确认，请重试连接后再采集。',
    };
    const nextGeneration = normalizeStoreContextEnvelope({
      ...storeContext,
      sessionGeneration: storeContext.sessionGeneration + 1,
    });
    const nextBusinessDate = normalizeStoreContextEnvelope({
      ...nextGeneration,
      businessDate: '2026-07-23',
    });

    expect(retainCollectionActionFeedback(storeContext, nextGeneration, failure)).toBe(failure);
    expect(retainCollectionActionFeedback(storeContext, nextBusinessDate, failure)).toBeNull();
  });

  it('creates its runtime UUID inside the function body instead of a default-parameter optional chain', () => {
    const source = collectionCompositionSource();
    const requestIdFunction = source.slice(
      source.indexOf('export function createLingxingCollectionRequestId'),
      source.indexOf('export function buildAuthoritativeCollectionDateRange'),
    );
    expect(requestIdFunction).toContain('const resolvedRandomToken = randomToken ?? createCollectionRandomToken()');
    expect(requestIdFunction).toContain("typeof cryptoApi.randomUUID === 'function'");
    expect(requestIdFunction).not.toMatch(/randomToken:\s*string\s*=|randomUUID\?\./);
  });

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

  it('replaces a stale page range with the current Main schedule before collection', async () => {
    const calls: string[] = [];
    const captured = await resolveAuthoritativeCollectionCapture({
      action: 'recreate-full',
      api: {
        getStoreCollectionSchedule: async () => {
          calls.push('schedule');
          return {
            storeId: storeContext.storeId,
            businessDate: storeContext.businessDate,
            enabled: true,
            state: 'due',
            detail: '可采集',
            dateStart: '2026-07-08',
            dateEnd: '2026-07-21',
          };
        },
      },
      scope: {
        dateFrom: '2026-07-01',
        dateTo: '2026-07-14',
        storeName: '旧店铺名',
        marketplaceCode: 'US',
        currency: 'USD',
      },
      storeContext,
      storeName: 'SHC001',
    });

    expect(calls).toEqual(['schedule']);
    expect(captured.dateRange).toMatchObject({ start: '2026-07-08', end: '2026-07-21' });
    expect(captured.refreshScope).toMatchObject({
      dateFrom: '2026-07-08', dateTo: '2026-07-21', storeName: 'SHC001', marketplaceCode: 'US', currency: 'USD',
    });
  });

  it('rejects a collection schedule from another authority before any collection action', async () => {
    const anotherStore = normalizeStoreContextEnvelope({
      ...storeContext,
      storeId: 'another-store',
      browserProfileId: 'another-profile',
    });
    await expect(resolveAuthoritativeCollectionCapture({
      action: 'recreate-full',
      api: {
        getStoreCollectionSchedule: async () => ({
          storeId: anotherStore.storeId,
          businessDate: storeContext.businessDate,
          enabled: true,
          state: 'due',
          detail: '可采集',
          dateStart: '2026-07-08',
          dateEnd: '2026-07-21',
        }),
      },
      scope: {
        dateFrom: '2026-07-01', dateTo: '2026-07-14', storeName: 'SHC001', marketplaceCode: 'US', currency: 'USD',
      },
      storeContext,
      storeName: 'SHC001',
    })).rejects.toThrow(/当前店铺不一致/);
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
    const source = collectionCompositionSource();

    expect(presentation?.manualReconciliation).toBe(true);
    expect(presentation?.tone).toBe('blocked');
    expect(presentation?.statusLabel).toBe('需人工核对');
    expect(presentation?.detail).toContain('已停止本批次和自动重试');
    expect(presentation?.detail).toContain('领星下载中心');
    expect(source).toContain("manualReconciliationRequired && mode !== 'download-existing'");
    expect(source).toContain('disabled={(recreateFullButton.disabled || manualReconciliationRequired) || actionPending}');
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

  it('offers a safe remaining-report action separately from recreating a reconciled-absent report', () => {
    const source = collectionJob({
      jobId: 'job-reconciled-absent',
      jobState: 'failed',
      checkpointState: 'failed',
      downloadedCount: 6,
    });
    const job: LingxingCollectionJobSnapshot = {
      ...source,
      blockerCode: 'LINGXING_CREATE_CONFIRMED_ABSENT',
      detail: '已确认商品投放原创建记录不存在。',
      reports: source.reports.map((checkpoint) => (
        checkpoint.reportType === 'product_targeting'
          ? { ...checkpoint, errorCode: 'LINGXING_CREATE_CONFIRMED_ABSENT' }
          : checkpoint
      )),
    };
    const row = buildCollectionJobWorkspaceRow(job, storeContext);
    const markup = renderToStaticMarkup(React.createElement(CollectionJobWorkspace, {
      actionBusyKey: null,
      currentContext: storeContext,
      error: null,
      jobs: [job],
      loading: false,
      onCancel: vi.fn(),
      onRefresh: vi.fn(),
      onResume: vi.fn(),
      onResumeSafeRemainder: vi.fn(),
    } as Parameters<typeof CollectionJobWorkspace>[0] & {
      onResumeSafeRemainder: (target: LingxingCollectionJobSnapshot) => void;
    }));

    expect(row.safeRemainderAvailable).toBe(true);
    expect(row.blockerText).toContain('可先完成其余排队报表');
    expect(row.blockerText).not.toContain('LINGXING_CREATE_CONFIRMED_ABSENT');
    expect(markup).toContain('先完成其余报表');
    expect(markup).toContain('重新创建缺失报表');
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

  it('presents a completed standalone partial download as waiting for the original full eight-report task', () => {
    const partial = collectionJob({
      jobId: 'job-standalone-partial',
      jobState: 'completed',
      reportTypes: ['campaign', 'keyword'],
      downloadedCount: 2,
      importState: 'not_applicable',
    });
    const row = buildCollectionJobWorkspaceRow(partial, storeContext);
    const progress = buildCollectionProgressPresentation({
      ...collectionProgressEvent(),
      job: partial,
    });
    const markup = renderToStaticMarkup(React.createElement(CollectionJobWorkspace, {
      actionBusyKey: null,
      currentContext: storeContext,
      error: null,
      jobs: [partial],
      loading: false,
      onCancel: vi.fn(),
      onRefresh: vi.fn(),
      onResume: vi.fn(),
    }));

    expect(row.canary).toBe(false);
    expect(row.statusLabel).toBe('部分报表已下载，等待完整 8 类');
    expect(row.progressLabel).toBe('2/2 类（本任务）');
    expect(row.import.label).toBe('等待完整 8 类后入库');
    expect(row.import.detail).toContain('未写生产指标');
    expect(row.import.detail).toContain('不会跨独立批次拼接');
    expect(buildCollectionJobLineagePresentation(partial).label).toBe('独立部分任务');
    expect(progress?.statusLabel).toBe('等待完整 8 类');
    expect(progress?.title).toContain('部分报表已下载');
    expect(markup).not.toContain('Canary');
    expect(markup).toContain('重新获取完整 8 类');
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

    const reconcilableMarkup = renderWorkspace({
      jobs: [collectionJob({ jobId: 'job-reconcile', jobState: 'completed_with_errors', checkpointState: 'create_unknown' })],
      onReconcile: vi.fn(),
    });
    expect(reconcilableMarkup).toContain('仅核对创建结果');
    expect(reconcilableMarkup).not.toContain('人工核对（禁止恢复）');
  });

  it('does not create a report from the create-unknown reconciliation button', () => {
    const source = collectionCompositionSource();
    const resumeSource = source.slice(
      source.indexOf('async function resumeCollectionJob('),
      source.indexOf('async function cancelCollectionJob('),
    );

    expect(resumeSource).toContain('reconcileOnly: true');
    expect(resumeSource).toContain('创建结果核对已完成；请根据核对结果单独点击“继续采集”');
  });

  it('keeps collection task ids and internal failure terms out of the ordinary workspace surface', () => {
    const markup = renderToStaticMarkup(React.createElement(CollectionJobWorkspace, {
      actionBusyKey: null,
      currentContext: storeContext,
      error: 'Main unavailable',
      jobs: [collectionJob({ jobId: 'job-internal-opaque', jobState: 'completed_with_errors', checkpointState: 'create_unknown' })],
      loading: false,
      onCancel: vi.fn(),
      onRefresh: vi.fn(),
      onResume: vi.fn(),
    }));
    const ordinaryText = markup
      .replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    expect(ordinaryText).toContain('当前店铺会话');
    expect(ordinaryText).toContain('人工核对');
    expect(ordinaryText).not.toMatch(/StoreContext|UNKNOWN|Main unavailable|job-internal-opaque/);
  });

  it('does not interpolate internal job ids into operator action notices', () => {
    const source = collectionCompositionSource();
    expect(source).not.toMatch(/setActionNotice\(`[^`]*\$\{job\.jobId\}/);
  });

  it('captures storeContext for job and import mutations and drops responses after an authority change', () => {
    const source = collectionCompositionSource();

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

  it('wires generation-only feedback retention while successful stale responses stay fully authority guarded', () => {
    const source = collectionCompositionSource();

    expect(source).toContain('retainCollectionActionFeedback(previousFeedbackContext, nextFeedbackContext, currentNotice)');
    expect(source).toContain('retainCollectionActionFeedback(previousFeedbackContext, nextFeedbackContext, currentError)');
    expect(source).toContain('!isCapturedFeedbackAuthorityCurrent(dateRange.storeContext)');
    expect(source).toContain('if (!isCapturedAuthorityCurrent(authorityKey)) return;');
  });

  it('keeps same-store resume failures visible after a forward session generation transition', () => {
    const source = collectionCompositionSource();
    const resumeSource = source.slice(
      source.indexOf('async function resumeCollectionJob('),
      source.indexOf('async function cancelCollectionJob('),
    );
    const catchSource = resumeSource.slice(
      resumeSource.indexOf('} catch (caught) {', resumeSource.indexOf('setCollectionMonitorOpen(true)')),
      resumeSource.indexOf('} finally {'),
    );

    expect(catchSource).toContain('isCapturedFeedbackAuthorityCurrent(captured.storeContext)');
    expect(catchSource).not.toContain('isCapturedAuthorityCurrent(captured.authorityKey)');
  });

  it('does not clear the in-flight resume token during a same-store forward generation transition', () => {
    const source = collectionCompositionSource();
    const authorityEffect = source.slice(
      source.indexOf('const previousFeedbackContext = collectionFeedbackAuthorityContextRef.current;'),
      source.indexOf('}, [storeAuthority.authorityKey]);'),
    );
    const preservationGuard = authorityEffect.indexOf(
      'if (collectionActionFeedbackBelongsToAuthority(previousFeedbackContext, nextFeedbackContext))',
    );
    const tokenReset = authorityEffect.indexOf('collectionJobActionTokenRef.current = null;');

    expect(preservationGuard).toBeGreaterThan(-1);
    expect(tokenReset).toBeGreaterThan(preservationGuard);
  });
});
