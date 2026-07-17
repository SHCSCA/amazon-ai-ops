import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import * as dataCollectionPage from './data-collection-page';
import {
  buildDataCollectionTaskState,
  buildCollectionMonitorState,
  collectionActionButtonDetail,
  collectionActionButtonLabel,
  collectionActionButtonView,
  collectionActionError,
  collectionActionGuide,
  collectionActionNextStep,
  collectionCompletionNotice,
  collectionFeedbackActionButtonView,
  collectionOpenPathButtonView,
  collectionReportSelectionState,
  dataCollectionFirstViewportReportFolder,
  runCollectionDownloadAction,
  shouldOfferDownloadCenterVerification,
} from './data-collection-page';
import { buildDataImportFeedback, buildDataImportTaskState, buildReportImportStatusDisplay, dataImportFirstViewportReportFolder } from './data-import-validation-page';

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

describe('DataCollectionPage first-screen path disclosure', () => {
  it('uses business labels while keeping the primary report folder openable', () => {
    const source = readFileSync(new URL('./data-collection-page.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('compactPath(primaryReportFolder)');
    expect(source).toContain('当前范围原始报表目录');
    expect(source).toContain('已创建，可打开');
    expect(source).toContain("idleLabel: '打开目录', targetPath: primaryReportFolder");
    expect(source).toContain("idleLabel: '打开报表目录', targetPath: primaryReportFolder");
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
        { label: '关键词报告', fileName: 'keyword.xlsx', filePath: 'C:/reports/keyword.xlsx', fileSizeBytes: 1024 },
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
      lastDiagnostic: { ready: false, screenshotPath: 'C:/evidence/download-center.png' },
      realReportCount: 0,
      importedRowCount: 0,
    });

    expect(monitor?.tone).toBe('blocked');
    expect(monitor?.statusLabel).toBe('需处理');
    expect(monitor?.detail).toContain('采集动作被阻断');
    expect(monitor?.previewDetail).toContain('download-center.png');
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
          { label: '关键词报告', fileName: 'keyword.xlsx', filePath: 'C:/reports/keyword.xlsx', fileSizeBytes: 1024 },
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
      evidencePath: 'C:/evidence/download-center.png',
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
      evidenceFolder: 'C:/AmazonAIOps/storage/downloads/mock-batch',
      auditDownloadDir: 'C:/AmazonAIOps/storage/downloads/mock-batch',
    });
    const task = buildDataCollectionTaskState({
      realReportCount: 0,
      importedRowCount: 0,
      primaryReportFolder: firstViewportFolder,
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
      primaryReportFolder: 'C:/AmazonAIOps/storage/downloads/mock-batch',
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
      primaryReportFolder: 'C:/AmazonAIOps/storage/downloads/mock-batch',
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

  it('gives local path open buttons an explicit busy contract while opening a file or folder', () => {
    const active = collectionOpenPathButtonView({
      activePathKey: '打开报表目录:C:/reports',
      idleLabel: '打开报表目录',
      pathKey: '打开报表目录:C:/reports',
    });
    const locked = collectionOpenPathButtonView({
      activePathKey: '打开报表目录:C:/reports',
      idleLabel: '打开采集清单',
      pathKey: '打开采集清单:C:/manifest.json',
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
      auditDownloadDir: 'C:/reports',
    });

    expect(firstViewportFolder).toBeUndefined();
    const collectReadiness = { status: 'blocked' as const, canEnterDiagnosis: false, nextStep: 'collect' as const };
    const importReadiness = { status: 'blocked' as const, canEnterDiagnosis: false, nextStep: 'import' as const };
    const readyReadiness = { status: 'ready' as const, canEnterDiagnosis: true, nextStep: 'diagnose' as const };
    expect(buildDataImportTaskState({ realReportCount: 0, importedRows: 0, reportFolder: firstViewportFolder, readiness: collectReadiness }).primaryActionLabel).toBe('去数据采集');
    expect(buildDataImportTaskState({ realReportCount: 0, importedRows: 0, reportFolder: firstViewportFolder, readiness: collectReadiness }).secondaryActionLabel).toBe('导入本地报表');
    expect(buildDataImportTaskState({ realReportCount: 8, importedRows: 0, reportFolder: 'C:/reports', readiness: importReadiness }).primaryActionLabel).toBe('导入已下载表格');
    expect(buildDataImportTaskState({ realReportCount: 8, importedRows: 96, reportFolder: 'C:/reports', readiness: readyReadiness }).primaryActionLabel).toBe('查看广告表现');
  });

  it('makes downloaded report files explicitly wait for DB import', () => {
    const status = buildReportImportStatusDisplay({
      status: 'downloaded',
      importedRows: 0,
      filePath: 'C:/reports/campaign.xlsx',
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
    expect(partial.title).toBe('部分指标已入库');
    expect(partial.statusLabel).toBe('待补齐');
    expect(partial.tone).toBe('warning');
    expect(partial.detail).toContain('不能进入正式诊断');
  });
});
