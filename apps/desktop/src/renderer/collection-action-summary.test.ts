import { describe, expect, it } from 'vitest';
import { buildCollectionActionSummary } from './collection-action-summary';

describe('buildCollectionActionSummary', () => {
  it('explains that existing reports were downloaded but still need import', () => {
    const summary = buildCollectionActionSummary({
      mode: 'download-existing',
      tone: 'warning',
      currentRealReportCount: 8,
      actionRealFileCount: 8,
      parsedFiles: 0,
      insertedRows: 0,
      currentImportedRows: 0,
      failedCount: 0,
      downloadDir: 'C:/downloads/batch_1',
      manifestPath: 'C:/downloads/batch_1/manifest.json',
    });

    expect(summary.statusLabel).toBe('已下载，待导入');
    expect(summary.tone).toBe('warning');
    expect(summary.headline).toBe('本次拿到了 8 个真实报表文件，但还没有写入 DB 指标。');
    expect(summary.facts).toContain('当前范围覆盖 8/8 类');
    expect(summary.facts).toContain('本次新增真实文件 8 个');
    expect(summary.facts).toContain('当前 DB 指标 0 行');
    expect(summary.nextAction).toBe('点击“导入已下载表格”，把 xlsx/xls/csv 写入日级广告指标。');
    expect(summary.primaryPathLabel).toBe('打开本次下载目录');
  });

  it('does not claim the current action downloaded files when only existing local reports are present', () => {
    const summary = buildCollectionActionSummary({
      mode: 'download-existing',
      tone: 'warning',
      currentRealReportCount: 8,
      actionRealFileCount: 0,
      parsedFiles: 0,
      insertedRows: 0,
      currentImportedRows: 0,
      failedCount: 0,
      downloadDir: 'C:/downloads/batch_1',
      manifestPath: 'C:/downloads/batch_1/manifest.json',
    });

    expect(summary.statusLabel).toBe('已下载，待导入');
    expect(summary.headline).toBe('当前范围已有 8/8 类真实报表覆盖，但本次动作没有新增下载，且还没有写入 DB 指标。');
    expect(summary.nextAction).toBe('打开真实报表目录确认 xlsx/xls/csv 后，点击“导入已下载表格”。');
  });

  it('blocks when no real report files were produced', () => {
    const summary = buildCollectionActionSummary({
      mode: 'download-existing',
      tone: 'blocked',
      currentRealReportCount: 0,
      actionRealFileCount: 0,
      parsedFiles: 0,
      insertedRows: 0,
      currentImportedRows: 0,
      failedCount: 2,
      manifestPath: 'C:/downloads/batch_1/manifest.json',
    });

    expect(summary.statusLabel).toBe('未拿到真实报表');
    expect(summary.tone).toBe('blocked');
    expect(summary.headline).toBe('本次动作没有产生可用于量化的 xlsx/xls/csv 报表。');
    expect(summary.blockers).toContain('没有真实报表文件');
    expect(summary.blockers).toContain('有 2 个失败项');
    expect(summary.nextAction).toBe('打开 Manifest 和失败原因，确认领星 ready 行、页面模型、日期、店铺和站点后重试。');
    expect(summary.primaryPathLabel).toBe('打开本次 Manifest');
  });

  it('marks import success as ready for ad quantification', () => {
    const summary = buildCollectionActionSummary({
      mode: 'import',
      tone: 'success',
      currentRealReportCount: 8,
      actionRealFileCount: 8,
      parsedFiles: 8,
      insertedRows: 96,
      currentImportedRows: 96,
      failedCount: 0,
      downloadDir: 'C:/downloads/batch_1',
      manifestPath: 'C:/downloads/batch_1/manifest.json',
    });

    expect(summary.statusLabel).toBe('可进入量化');
    expect(summary.tone).toBe('ready');
    expect(summary.headline).toBe('真实报表已经入库，当前范围有 96 行日级广告指标。');
    expect(summary.nextAction).toBe('进入广告量化，复核花费、订单、ACOS 和产品阶段。');
    expect(summary.facts).toContain('本次解析 8 表');
    expect(summary.facts).toContain('本次写入 96 行');
  });
});
