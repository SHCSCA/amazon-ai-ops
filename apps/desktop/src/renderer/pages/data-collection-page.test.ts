import { describe, expect, it } from 'vitest';
import { collectionActionError, collectionActionGuide, collectionCompletionNotice } from './data-collection-page';

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
