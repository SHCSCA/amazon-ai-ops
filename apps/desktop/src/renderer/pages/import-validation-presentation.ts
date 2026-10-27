import React, { useEffect, useMemo, useRef, useState } from 'react';
import { localizeReportStatus } from '@amazon-ai-ops/business-presenters';
import { toUserFacingError } from '../user-facing-error';
import { buildDataReadinessLedger, type DataReadinessLedger } from '../data-readiness-ledger';
import { type DataImportReportRow, type DataImportSortDirection, type StatusTone, type ReportImportStatusDisplay, type ImportMode, type DataImportFeedback, type DataImportTaskState } from './import-validation-contracts';

export function reportFileExtension(fileName: string, explicitExtension?: string): string {
  if (explicitExtension) return explicitExtension.toLowerCase();
  const target = fileName;
  const dotIndex = target.lastIndexOf('.');
  return dotIndex >= 0 ? target.slice(dotIndex).toLowerCase() : '-';
}

export function dataImportFileLabel(row: Pick<DataImportReportRow, 'fileName'>): string {
  const explicitName = String(row.fileName || '').trim();
  if (explicitName) return explicitName;
  return '缺少真实文件';
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortDataImportHash(hash: string): string {
  return hash ? `${hash.slice(0, 16)}...` : '未记录';
}

export function buildDataImportTableFeedback({
  importedRows,
  realReportCount,
  sortDirection,
  sortLabel,
  totalCount,
}: {
  importedRows: number;
  realReportCount: number;
  sortDirection: DataImportSortDirection | null;
  sortLabel: string;
  totalCount: number;
}): string {
  const orderText = sortDirection === 'asc' ? '升序' : '降序';
  const sortText = sortDirection && sortLabel ? `按${sortLabel}${orderText}展示` : '按默认报表顺序展示';
  return `${sortText} ${totalCount} 类报表；真实报表 ${realReportCount}/${totalCount}，已入库 ${importedRows} 行。`;
}

export function dataImportTableFeedbackClass(input: { refreshing: boolean; locked: boolean }): string {
  return [
    'data-import-table-shell',
    input.refreshing ? 'data-import-table-refreshing' : '',
    input.locked ? 'data-import-table-locked' : '',
  ].filter(Boolean).join(' ');
}

export function dataImportTableRefreshRowClass(refreshing: boolean): string | undefined {
  return refreshing ? 'data-import-table-row-refresh' : undefined;
}

export function reportStatusLabel(status: string): string {
  const label = localizeReportStatus(status);
  return label === '状态待同步' ? status : label;
}

export function feedbackClassName(tone: StatusTone): string {
  if (tone === 'ready') return 'collection-action-feedback collection-action-feedback-ready';
  if (tone === 'blocked' || tone === 'warning') return 'collection-action-feedback collection-action-feedback-blocked';
  return 'collection-action-feedback';
}

export function buildReportImportStatusDisplay(input: {
  status: string;
  importedRows: number;
  artifactId?: string;
  importError?: string;
}): ReportImportStatusDisplay {
  const importedRows = Number(input.importedRows || 0);
  if (input.status === 'source_mismatch') {
    return {
      label: '任务血缘不一致',
      detail: '当前文件不属于所选生产 lineage 的报表批次，不能参与正式诊断。',
      tone: 'blocked',
    };
  }
  if (input.status === 'download_incomplete') {
    return {
      label: '下载未确认',
      detail: '生产任务没有留下该报表的 downloaded 检查点。',
      tone: 'blocked',
    };
  }
  if (input.status === 'import_pending') {
    return {
      label: '入库待确认',
      detail: '真实文件已绑定生产任务，但任务入库状态尚未持久化为 succeeded。',
      tone: 'warning',
    };
  }
  if (input.importError || input.status === 'import_failed') {
    return {
      label: '导入失败',
      detail: input.importError ? toUserFacingError(new Error(input.importError), '解析真实报表失败，请检查表头、日期和指标列。') : '解析真实报表时失败，请打开表格检查表头、日期和指标列。',
      tone: 'blocked',
    };
  }
  if (importedRows > 0 || input.status === 'imported') {
    return {
      label: '已入库',
      detail: `${importedRows} 行日级广告指标已写入 SQLite，可被广告表现和 AI 证据包读取。`,
      tone: 'ready',
    };
  }
  if (input.artifactId && input.status === 'downloaded') {
    return {
      label: '已下载待入库',
      detail: '文件已在本地；点击“导入已下载表格”后才会解析并写入 SQLite。',
      tone: 'warning',
    };
  }
  if (input.artifactId) {
    return {
      label: reportStatusLabel(input.status),
      detail: '已发现本地文件，但还没有形成可量化的日级广告指标。',
      tone: 'warning',
    };
  }
  return {
    label: reportStatusLabel(input.status || 'missing'),
    detail: '当前范围还没有这类 Lingxing 原始报表文件。',
    tone: 'blocked',
  };
}

export function buildDataImportFeedback(input: {
  realReportCount: number;
  importedReportTypeCount?: number;
  importedRows: number;
  runningImport: ImportMode | null;
  notice?: string;
  importError?: string;
  readiness: Pick<DataReadinessLedger, 'status' | 'canEnterDiagnosis' | 'nextStep'>;
}): DataImportFeedback {
  const importNotice = input.notice?.includes('导入') ? input.notice : '';
  if (input.runningImport === 'current') {
    return {
      title: '正在写入 SQLite',
      detail: '正在解析当前范围已下载的 Lingxing 原始表格，完成后会刷新入库行数和广告表现口径。',
      statusLabel: '导入中',
      tone: 'pending',
      className: feedbackClassName('pending'),
    };
  }
  if (input.runningImport === 'local') {
    return {
      title: '等待选择本地报表',
      detail: '请选择 Lingxing 导出的 xlsx/xls/csv 原始广告表格；选择后系统会复制、校验、解析并入库。',
      statusLabel: '选择中',
      tone: 'pending',
      className: feedbackClassName('pending'),
    };
  }
  if (input.importError) {
    return {
      title: '导入未完成',
      detail: input.importError,
      statusLabel: '需处理',
      tone: 'blocked',
      className: feedbackClassName('blocked'),
    };
  }
  if (input.readiness.canEnterDiagnosis) {
    return {
      title: '当前范围已入库',
      detail: importNotice || (input.importedRows > 0
        ? `SQLite 已有 ${input.importedRows} 行日级广告指标；如果重新下载过表格，可再次导入刷新。`
        : '完整 8 类报表均已形成可验证的零行入库回执；当前范围会按真实零数据状态进入广告表现。'),
      statusLabel: '已入库',
      tone: 'ready',
      className: feedbackClassName('ready'),
    };
  }
  if (Number(input.importedRows || 0) > 0 || Number(input.importedReportTypeCount || 0) > 0) {
    return {
      title: '部分报表已有入库回执',
      detail: importNotice || `${Math.min(8, Number(input.importedReportTypeCount || 0))}/8 类已有可验证入库回执，共 ${input.importedRows} 行日级广告指标；完整生产血缘闭合前不能进入正式诊断。`,
      statusLabel: '待补齐',
      tone: 'warning',
      className: feedbackClassName('warning'),
    };
  }
  if (Number(input.realReportCount || 0) > 0) {
    return {
      title: '已下载待入库',
      detail: importNotice || `已发现 ${input.realReportCount} 类真实报表，但还没有日级广告指标。点击“导入已下载表格”写入 SQLite。`,
      statusLabel: '待入库',
      tone: 'warning',
      className: feedbackClassName('warning'),
    };
  }
  return {
    title: '等待真实报表',
    detail: input.notice || '当前范围没有可导入的 Lingxing 原始广告表格；先去数据采集获取，或导入本地报表。',
    statusLabel: '待报表',
    tone: 'blocked',
    className: feedbackClassName('blocked'),
  };
}

export function readinessStageClass(status: string): string {
  if (status === 'complete') return 'collection-progress-step collection-progress-ready';
  if (status === 'partial') return 'collection-progress-step collection-progress-pending';
  return 'collection-progress-step collection-progress-blocked';
}

export function readinessStageTone(status: string): 'ready' | 'pending' | 'blocked' {
  if (status === 'complete') return 'ready';
  if (status === 'partial') return 'pending';
  return 'blocked';
}

export function readinessStageLabel(status: string): string {
  if (status === 'complete') return '完成';
  if (status === 'partial') return '部分完成';
  return '阻断';
}

export function reconciliationSourceLabel(source?: string): string {
  if (source === 'canonical_advertised_product') return '推广商品报表口径';
  if (source === 'canonical_ad_group') return '广告组报表口径';
  if (source === 'canonical_user_search_term') return '用户搜索词权威口径';
  if (source === 'canonical_search_term') return '搜索词总盘口径';
  return source || '-';
}

export function dataImportFirstViewportReportFolder(input: {
  realReportCount: number;
  realFiles: Array<{ folderArtifactId?: string }>;
  auditDownloadArtifactId?: string;
}): string | undefined {
  if ((Number(input.realReportCount) || 0) <= 0) return undefined;
  return input.realFiles.find((file) => Boolean(file.folderArtifactId))?.folderArtifactId;
}

export function buildDataImportTaskState({
  realReportCount,
  importedReportTypeCount = 0,
  importedRows,
  reportFolderArtifactId,
  readiness,
}: {
  realReportCount: number;
  importedReportTypeCount?: number;
  importedRows: number;
  reportFolderArtifactId?: string;
  readiness: Pick<DataReadinessLedger, 'status' | 'canEnterDiagnosis' | 'nextStep'>;
}): DataImportTaskState {
  const reportCount = Math.max(0, Math.min(8, Number(realReportCount) || 0));
  const rowCount = Math.max(0, Number(importedRows) || 0);
  const hasRealReports = reportCount > 0;
  const isReady = readiness.canEnterDiagnosis;
  return {
    title: `真实报表 ${reportCount}/8，已导入 ${rowCount} 行`,
    detail: isReady
      ? rowCount > 0
        ? '完整 8 类日级广告指标已写入 SQLite；重导入同批同文件会先清旧行再写入。'
        : '完整 8 类报表已写入零行入库回执；当前范围是可追溯的真实零数据状态。'
      : readiness.nextStep === 'import' && (rowCount > 0 || importedReportTypeCount > 0)
        ? `${Math.min(8, importedReportTypeCount)}/8 类已有入库回执，但仍有报表类型未入库；补齐前不能进入正式诊断。`
      : hasRealReports
        ? '真实报表已下载但未入库，下一步把广告指标写入 SQLite。'
        : '当前范围缺少真实报表，先回数据采集获取或导入本地表格。',
    primaryActionLabel: isReady ? '查看广告表现' : readiness.nextStep === 'import' ? '导入已下载表格' : '去数据采集',
    secondaryActionLabel: reportFolderArtifactId ? '打开报表目录' : '导入本地报表',
  };
}
