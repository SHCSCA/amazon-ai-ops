import { describe, expect, it, vi } from 'vitest';
import {
  buildDataCollectionTaskState,
  buildCollectionMonitorState,
  collectionActionButtonDetail,
  collectionActionButtonLabel,
  collectionActionError,
  collectionActionGuide,
  collectionCompletionNotice,
  dataCollectionFirstViewportReportFolder,
  runCollectionDownloadAction,
  shouldOfferDownloadCenterVerification,
} from './data-collection-page';
import { buildDataImportFeedback, buildDataImportTaskState, buildReportImportStatusDisplay, dataImportFirstViewportReportFolder } from './data-import-validation-page';

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
      nextStep: '下一步：进入广告量化，复核 ACOS、花费和订单口径。',
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
        nextStep: '下一步：进入广告量化。',
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
    });

    expect(firstViewportFolder).toBeUndefined();
    expect(task.title).toBe('真实报表 0/8，已导入 0 行');
    expect(task.primaryActionLabel).toBe('重新获取完整 8 类报表');
    expect(task.secondaryActionLabel).toBe('导入本地报表');
  });

  it('moves data collection to ad quantification after full reports and imported rows exist', () => {
    const task = buildDataCollectionTaskState({
      realReportCount: 8,
      importedRowCount: 96,
      primaryReportFolder: 'C:/AmazonAIOps/storage/downloads/mock-batch',
      runningAction: null,
    });

    expect(task.title).toBe('真实报表 8/8，已导入 96 行');
    expect(task.primaryActionLabel).toBe('进入广告量化');
    expect(task.secondaryActionLabel).toBe('打开报表目录');
  });

  it('shortens 8-report chooser action labels without changing action modes', () => {
    expect(collectionActionButtonLabel('download-existing')).toBe('下载已创建');
    expect(collectionActionButtonLabel('recreate-selected')).toBe('重建已选');
    expect(collectionActionButtonLabel('recreate-full')).toBe('重建全部 8 类');
    expect(collectionActionButtonLabel('import')).toBe('导入本地');
    expect(collectionActionButtonDetail('recreate-full')).toBe('创建、下载并导入完整 8 类');
    expect(collectionActionButtonDetail('import')).toBe('选择本地 xlsx/xls/csv');
  });

  it('aligns data import primary actions to report and row readiness', () => {
    const firstViewportFolder = dataImportFirstViewportReportFolder({
      realReportCount: 0,
      realFiles: [],
      auditDownloadDir: 'C:/reports',
    });

    expect(firstViewportFolder).toBeUndefined();
    expect(buildDataImportTaskState({ realReportCount: 0, importedRows: 0, reportFolder: firstViewportFolder }).primaryActionLabel).toBe('去数据采集');
    expect(buildDataImportTaskState({ realReportCount: 0, importedRows: 0, reportFolder: firstViewportFolder }).secondaryActionLabel).toBe('导入本地报表');
    expect(buildDataImportTaskState({ realReportCount: 8, importedRows: 0, reportFolder: 'C:/reports' }).primaryActionLabel).toBe('导入已下载表格');
    expect(buildDataImportTaskState({ realReportCount: 8, importedRows: 96, reportFolder: 'C:/reports' }).primaryActionLabel).toBe('进入广告量化');
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
    }).title).toBe('正在写入 SQLite');

    const ready = buildDataImportFeedback({
      realReportCount: 8,
      importedRows: 96,
      runningImport: null,
    });
    expect(ready.statusLabel).toBe('已入库');
    expect(ready.detail).toContain('96 行日级广告指标');
  });
});
