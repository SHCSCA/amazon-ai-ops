import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LingxingCollectionJobSnapshot, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { useBusinessDataPipeline } from '../components/business-data';
import { ProgressiveDetails } from '../components/progressive-details';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { TaskBanner } from '../components/workspace';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import { VirtualDataTable, type VirtualDataTableColumn } from '../components/virtual-data-table';
import { buildDataReadinessLedger, type DataReadinessLedger } from '../data-readiness-ledger';
import { formatUsd } from '../formatters';
import {
  buildProductionCollectionLineageReadiness,
  type ProductionCollectionReportBinding,
} from '../lingxing-collection-lineage';
import { useMissionControlStoreContext } from '../mission-control/store-context';
import { toUserFacingError } from '../user-facing-error';

export type ImportMode = 'current' | 'local';
type StatusTone = 'ready' | 'pending' | 'blocked' | 'warning';

export interface ReportImportStatusDisplay {
  label: string;
  detail: string;
  tone: StatusTone;
}

export interface DataImportFeedback {
  title: string;
  detail: string;
  statusLabel: string;
  tone: StatusTone;
  className: string;
}

export type DataImportSortKey = 'label' | 'file' | 'ext' | 'size' | 'hash' | 'rows' | 'status';
export type DataImportSortDirection = 'asc' | 'desc';

export interface DataImportSortState {
  key: DataImportSortKey;
  direction: DataImportSortDirection;
}

export interface DataImportReportRow {
  type: string;
  label: string;
  fileName: string;
  artifactId: string;
  fileExtension: string;
  fileHash: string;
  fileSizeBytes: number;
  importedRows: number;
  importError: string;
  status: string;
  statusDisplay: ReportImportStatusDisplay;
}

const DATA_IMPORT_TEXT_SORT_KEYS = new Set<DataImportSortKey>(['label', 'file', 'ext', 'hash', 'status']);

function reportFileExtension(fileName: string, explicitExtension?: string): string {
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

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortDataImportHash(hash: string): string {
  return hash ? `${hash.slice(0, 16)}...` : '未记录';
}

function dataImportSortValue(row: DataImportReportRow, key: DataImportSortKey): string | number {
  if (key === 'file') return (row.fileName || '').toLowerCase();
  if (key === 'ext') return reportFileExtension(row.fileName, row.fileExtension);
  if (key === 'size') return Number(row.fileSizeBytes || 0);
  if (key === 'hash') return (row.fileHash || '').toLowerCase();
  if (key === 'rows') return Number(row.importedRows || 0);
  if (key === 'status') return `${row.statusDisplay.label || ''} ${row.status || ''}`.toLowerCase();
  return (row.label || '').toLowerCase();
}

export function nextDataImportSort(current: DataImportSortState | null, key: DataImportSortKey): DataImportSortState {
  if (current?.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: DATA_IMPORT_TEXT_SORT_KEYS.has(key) ? 'asc' : 'desc' };
}

export function sortDataImportReportRows(rows: DataImportReportRow[], sort: DataImportSortState | null): DataImportReportRow[] {
  if (!sort) return rows;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = dataImportSortValue(left.row, sort.key);
      const rightValue = dataImportSortValue(right.row, sort.key);
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        const diff = leftValue - rightValue;
        if (diff !== 0) return sort.direction === 'asc' ? diff : -diff;
        return left.index - right.index;
      }
      const diff = String(leftValue).localeCompare(String(rightValue), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
      if (diff !== 0) return sort.direction === 'asc' ? diff : -diff;
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

export function dataImportSortLabel(key: DataImportSortKey): string {
  const labels: Record<DataImportSortKey, string> = {
    label: '报表',
    file: '文件',
    ext: '类型',
    size: '大小',
    hash: 'SHA-256',
    rows: '入库行数',
    status: '状态',
  };
  return labels[key];
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

export function dataImportTableSortHandler(input: {
  locked: boolean;
  onSort: (key: string) => void;
}): ((key: string) => void) | undefined {
  return input.locked ? undefined : input.onSort;
}

export function dataImportBusyLabel(runningImport: ImportMode | null): string | undefined {
  return runningImport ? '处理中...' : undefined;
}

export function dataImportActionButtonView(input: {
  mode: ImportMode;
  runningImport: ImportMode | null;
  hasRealFiles: boolean;
}): { label: string; disabled: boolean; ariaBusy: boolean; className: string } {
  const active = input.runningImport === input.mode;
  const labels: Record<ImportMode, string> = {
    current: '导入已下载表格',
    local: '导入本地报表',
  };
  const disabled = input.mode === 'current'
    ? !input.hasRealFiles || Boolean(input.runningImport)
    : Boolean(input.runningImport);

  return {
    label: active ? '处理中...' : labels[input.mode],
    disabled,
    ariaBusy: active,
    className: `secondary-button${active ? ' button-loading' : ''}`,
  };
}

export function dataImportExportButtonView(input: {
  exportingReconciliation: boolean;
  hasImportedMetrics: boolean;
}): { label: string; disabled: boolean; ariaBusy: boolean; className: string } {
  return {
    label: input.exportingReconciliation ? '处理中...' : '导出数据对账',
    disabled: !input.hasImportedMetrics || input.exportingReconciliation,
    ariaBusy: input.exportingReconciliation,
    className: `secondary-button${input.exportingReconciliation ? ' button-loading' : ''}`,
  };
}

export function dataImportArtifactActionKey(label: string, artifactId?: string): string {
  return `${label}:${String(artifactId || 'missing')}`;
}

export function dataImportOpenArtifactButtonView(input: {
  activeArtifactKey: string | null;
  baseClassName?: string;
  disabled?: boolean;
  idleLabel: string;
  artifactKey: string;
}): {
  label: string;
  disabled: boolean;
  ariaBusy?: true;
  className: string;
  showSpinner: boolean;
} {
  const active = input.activeArtifactKey === input.artifactKey;
  return {
    label: active ? '打开中...' : input.idleLabel,
    disabled: Boolean(input.disabled || input.activeArtifactKey),
    ariaBusy: active ? true : undefined,
    className: [input.baseClassName || 'secondary-button', active ? 'button-loading' : ''].filter(Boolean).join(' '),
    showSpinner: active,
  };
}

function reportStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    missing: '缺少真实文件',
    downloaded: '已下载待入库',
    imported: '已入库',
    import_failed: '导入失败',
    failed: '失败',
    ready: '可下载',
  };
  return labels[status] || status;
}

function feedbackClassName(tone: StatusTone): string {
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
      detail: input.importError || '解析真实报表时失败，请打开表格检查表头、日期和指标列。',
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

function readinessStageClass(status: string): string {
  if (status === 'complete') return 'collection-progress-step collection-progress-ready';
  if (status === 'partial') return 'collection-progress-step collection-progress-pending';
  return 'collection-progress-step collection-progress-blocked';
}

function readinessStageTone(status: string): 'ready' | 'pending' | 'blocked' {
  if (status === 'complete') return 'ready';
  if (status === 'partial') return 'pending';
  return 'blocked';
}

function readinessStageLabel(status: string): string {
  if (status === 'complete') return '完成';
  if (status === 'partial') return '部分完成';
  return '阻断';
}

function reconciliationSourceLabel(source?: string): string {
  if (source === 'canonical_advertised_product') return '推广商品报表口径';
  if (source === 'canonical_ad_group') return '广告组报表口径';
  if (source === 'canonical_user_search_term') return '用户搜索词权威口径';
  if (source === 'canonical_search_term') return '搜索词总盘口径';
  return source || '-';
}

export interface DataImportTaskState {
  title: string;
  detail: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
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

export function DataImportValidationPage() {
  const { data, error, loading, scope, reload } = useBusinessDataPipeline();
  const storeAuthority = useMissionControlStoreContext();
  const [runningImport, setRunningImport] = useState<ImportMode | null>(null);
  const [exportingReconciliation, setExportingReconciliation] = useState(false);
  const [reconciliation, setReconciliation] = useState<{
    jsonArtifactId?: string;
    jsonDisplayName?: string;
    markdownArtifactId?: string;
    markdownDisplayName?: string;
    canonicalSource?: string;
    canonical?: { rows?: number; spend?: number; orders?: number };
    blockers?: string[];
  } | null>(null);
  const [notice, setNotice] = useState('');
  const [importError, setImportError] = useState('');
  const [artifactNotice, setArtifactNotice] = useState('');
  const [openingArtifactKey, setOpeningArtifactKey] = useState<string | null>(null);
  const [sortState, setSortState] = useState<DataImportSortState | null>(null);
  const [tableRefreshing, setTableRefreshing] = useState(false);
  const [collectionJobs, setCollectionJobs] = useState<LingxingCollectionJobSnapshot[]>([]);
  const [collectionJobsLoading, setCollectionJobsLoading] = useState(false);
  const [collectionJobsError, setCollectionJobsError] = useState('');
  const [collectionJobsPreviewOnly, setCollectionJobsPreviewOnly] = useState(false);
  const refreshTimerRef = useRef<number | null>(null);
  const collectionJobsLoadSequenceRef = useRef(0);
  const authorityKeyRef = useRef(storeAuthority.authorityKey);
  authorityKeyRef.current = storeAuthority.authorityKey;
  const importLocked = Boolean(runningImport);
  const collection = data?.collection;
  const quant = data?.quant;
  const reportOptions = collection?.reportOptions || [];
  const realFiles = collection?.realReportFiles || [];
  const fileAudit = collection?.fileAudit;
  const aggregateRealReportCount = fileAudit?.realReportFileCount ?? realFiles.length;
  const aggregateImportedRows = fileAudit?.importedRowCount ?? quant?.importedRows ?? 0;
  const rejectedEvidenceCount = fileAudit?.rejectedEvidenceFileCount ?? 0;
  const lineageReadiness = useMemo(() => buildProductionCollectionLineageReadiness({
    currentContext: storeAuthority.authoritativeContext,
    dateStart: scope.dateFrom,
    dateEnd: scope.dateTo,
    jobs: collectionJobs,
    files: realFiles,
  }), [collectionJobs, realFiles, scope.dateFrom, scope.dateTo, storeAuthority.authoritativeContext]);
  const bindingByReportType = useMemo(() => new Map(
    lineageReadiness.reportBindings.map((binding) => [binding.reportType, binding]),
  ), [lineageReadiness.reportBindings]);
  const realReportCount = lineageReadiness.sourceMatchedReportCount;
  const importedRows = lineageReadiness.importedRows;
  const hasRealFiles = realReportCount > 0;
  const hasImportedMetrics = lineageReadiness.importedReportCount > 0;
  const productionRealFiles = useMemo(() => realFiles.filter((file) => {
    const binding = bindingByReportType.get(file.reportType as ProductionCollectionReportBinding['reportType']);
    return Boolean(binding?.expectedBatchId && file.batchId === binding.expectedBatchId);
  }), [bindingByReportType, realFiles]);
  const reportFolderArtifactId = dataImportFirstViewportReportFolder({
    realReportCount,
    realFiles: productionRealFiles,
    auditDownloadArtifactId: fileAudit?.downloadArtifactId,
  });
  const lineageManifestArtifactId = collection?.latestBatch?.id
    && lineageReadiness.lineageJobIds.includes(collection.latestBatch.id)
    ? collection.latestBatch.manifestArtifactId
    : undefined;
  const totalSpend = quant?.totalSpend ?? 0;
  const totalSales = quant?.totalSales ?? 0;
  const totalOrders = quant?.totalOrders ?? 0;
  const productionReportOptions = useMemo(() => reportOptions.map((option) => {
    const binding = bindingByReportType.get(option.type as ProductionCollectionReportBinding['reportType']);
    return {
      ...option,
      realFileAvailable: Boolean(binding?.fileBatchId && binding.fileBatchId === binding.expectedBatchId),
      importedRows: binding?.state === 'imported' ? binding.importedRows : 0,
      status: binding?.state || 'missing',
    };
  }), [bindingByReportType, reportOptions]);
  const dataLedger = useMemo(() => buildDataReadinessLedger({
    requiredReportCount: 8,
    reportOptions: productionReportOptions,
    realReportFileCount: realReportCount,
    importedRowCount: importedRows,
    rejectedEvidenceFileCount: rejectedEvidenceCount,
  }), [importedRows, productionReportOptions, realReportCount, rejectedEvidenceCount]);
  const isDataReady = dataLedger.canEnterDiagnosis && lineageReadiness.canEnterDiagnosis;
  const computedTaskState = buildDataImportTaskState({
    realReportCount,
    importedReportTypeCount: lineageReadiness.importedReportCount,
    importedRows,
    reportFolderArtifactId,
    readiness: { ...dataLedger, canEnterDiagnosis: isDataReady },
  });
  const baseTaskState: DataImportTaskState = {
    ...computedTaskState,
    secondaryActionLabel: reportFolderArtifactId ? '打开报表目录' : '导入本地文件（仅检查）',
  };
  const taskState: DataImportTaskState = collectionJobsLoading
    ? {
        ...baseTaskState,
        title: '正在核对生产采集血缘',
        detail: '正在按当前店铺、日期窗和批次读取真实采集任务；完成前不会放行正式诊断。',
        primaryActionLabel: '核对中...',
      }
    : isDataReady
      ? baseTaskState
      : {
          ...baseTaskState,
          title: lineageReadiness.title,
          detail: lineageReadiness.detail,
          primaryActionLabel: lineageReadiness.latestJobId ? '回采集任务处理' : '去数据采集',
        };
  useEffect(() => () => {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
    }
  }, []);

  useEffect(() => {
    ++collectionJobsLoadSequenceRef.current;
    setCollectionJobs([]);
    setCollectionJobsError('');
    setCollectionJobsPreviewOnly(false);
    setRunningImport(null);
    setExportingReconciliation(false);
    setReconciliation(null);
    setNotice('');
    setImportError('');
    setArtifactNotice('');
    setOpeningArtifactKey(null);
    const context = storeAuthority.authoritativeContext;
    const authorityKey = storeAuthority.authorityKey;
    if (!context || !authorityKey) return;
    void loadProductionCollectionJobs(context, authorityKey);
  }, [storeAuthority.authoritativeContext, storeAuthority.authorityKey]);

  const reportRows = useMemo<DataImportReportRow[]>(() => productionReportOptions.map((option) => {
    const binding = bindingByReportType.get(option.type as ProductionCollectionReportBinding['reportType']);
    const files = realFiles.filter((file) => (
      file.reportType === option.type
      && Boolean(binding?.expectedBatchId)
      && file.batchId === binding?.expectedBatchId
    ));
    const firstFile = files[0];
    const importedForType = files.reduce((sum, file) => sum + Number(file.importedRows || 0), 0) || option.importedRows;
    return {
      ...option,
      fileName: firstFile?.fileName || '',
      fileExtension: firstFile?.fileExtension || '',
      artifactId: firstFile?.artifactId || '',
      fileHash: firstFile?.fileHash || '',
      fileSizeBytes: firstFile?.fileSizeBytes || 0,
      importedRows: importedForType,
      importError: firstFile?.importError || '',
      status: firstFile?.importError
        ? 'import_failed'
        : binding?.state || (importedForType > 0 ? 'imported' : firstFile?.status || option.status),
    };
  }).map((row) => ({
    ...row,
    statusDisplay: buildReportImportStatusDisplay({
      status: row.status,
      importedRows: row.importedRows,
      artifactId: row.artifactId,
      importError: row.importError,
    }),
  })), [bindingByReportType, productionReportOptions, realFiles]);
  const sortedReportRows = useMemo(() => sortDataImportReportRows(reportRows, sortState), [reportRows, sortState]);
  const tableFeedback = buildDataImportTableFeedback({
    importedRows,
    realReportCount,
    sortDirection: sortState?.direction ?? null,
    sortLabel: sortState ? dataImportSortLabel(sortState.key) : '',
    totalCount: reportRows.length,
  });
  const importFeedback = buildDataImportFeedback({
    realReportCount,
    importedReportTypeCount: lineageReadiness.importedReportCount,
    importedRows,
    runningImport,
    notice,
    importError,
    readiness: { ...dataLedger, canEnterDiagnosis: isDataReady },
  });
  const currentImportButton = dataImportActionButtonView({ mode: 'current', runningImport, hasRealFiles });
  const localImportButton = dataImportActionButtonView({ mode: 'local', runningImport, hasRealFiles });
  const exportButton = dataImportExportButtonView({ exportingReconciliation, hasImportedMetrics });
  function renderOpenArtifactButton(input: {
    className?: string;
    disabled?: boolean;
    idleLabel: string;
    messageLabel?: string;
    artifactId?: string;
  }) {
    const messageLabel = input.messageLabel || input.idleLabel;
    const view = dataImportOpenArtifactButtonView({
      activeArtifactKey: openingArtifactKey,
      baseClassName: input.className,
      disabled: input.disabled,
      idleLabel: input.idleLabel,
      artifactKey: dataImportArtifactActionKey(messageLabel, input.artifactId),
    });
    return (
      <button
        aria-busy={view.ariaBusy}
        className={view.className}
        disabled={view.disabled}
        onClick={() => openArtifact(input.artifactId, messageLabel)}
        type="button"
      >
        {view.showSpinner && <span aria-hidden="true" className="button-spinner" />}
        <span>{view.label}</span>
      </button>
    );
  }
  const reportColumns: Array<VirtualDataTableColumn<DataImportReportRow>> = [
    { key: 'label', header: '报表', width: '170px', sticky: 'left', sortable: true, sortLabel: '报表', cell: (row) => row.label },
    {
      key: 'file',
      header: '文件',
      width: 'minmax(160px, 0.9fr)',
      sortable: true,
      sortLabel: '文件',
      cell: (row) => row.artifactId
        ? <code>{dataImportFileLabel(row)}</code>
        : '缺少真实文件',
    },
    { key: 'ext', header: '类型', width: '72px', sortable: true, sortLabel: '类型', cell: (row) => <code>{row.artifactId ? reportFileExtension(row.fileName, row.fileExtension) : '-'}</code> },
    { key: 'size', header: '大小', width: '88px', sortable: true, sortLabel: '大小', cell: (row) => formatFileSize(row.fileSizeBytes) },
    {
      key: 'hash',
      header: 'SHA-256',
      width: '150px',
      sortable: true,
      sortLabel: 'SHA-256',
      cell: (row) => <code title={row.fileHash || undefined}>{shortDataImportHash(row.fileHash)}</code>,
    },
    { key: 'rows', header: '入库行数', width: '96px', sortable: true, sortLabel: '入库行数', cell: (row) => row.importedRows },
    {
      key: 'status',
      header: '状态',
      width: 'minmax(240px, 1.1fr)',
      sortable: true,
      sortLabel: '状态',
      cell: (row) => (
        <div>
          <StatusPill tone={row.statusDisplay.tone}>{row.statusDisplay.label}</StatusPill>
          <div className="muted-line table-subtext">{row.statusDisplay.detail}</div>
          {row.importError && <div className="blocked-line table-subtext">{row.importError}</div>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      width: '100px',
      cell: (row) => (
        renderOpenArtifactButton({
          className: 'secondary-button compact-button',
          disabled: !row.artifactId || importLocked,
          idleLabel: '打开表格',
          messageLabel: `打开${row.label}`,
          artifactId: row.artifactId,
        })
      ),
    },
  ];

  function handleReportSortChange(key: string) {
    if (!['label', 'file', 'ext', 'size', 'hash', 'rows', 'status'].includes(key)) return;
    setSortState((current) => nextDataImportSort(current, key as DataImportSortKey));
    setTableRefreshing(true);
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      setTableRefreshing(false);
      refreshTimerRef.current = null;
    }, 200);
  }

  async function loadProductionCollectionJobs(
    capturedContext: StoreContextEnvelope,
    capturedAuthorityKey: string,
  ): Promise<void> {
    const sequence = ++collectionJobsLoadSequenceRef.current;
    const api = (window as any).electronAPI;
    setCollectionJobsLoading(true);
    setCollectionJobsError('');
    setCollectionJobsPreviewOnly(api?.lingxingCollectionJobsPreviewOnly === true);
    try {
      if (!api?.listLingxingCollectionJobs) {
        throw new Error('生产采集任务接口未暴露，请检查 preload IPC。');
      }
      const jobs = await api.listLingxingCollectionJobs({
        storeContext: { ...capturedContext },
        limit: 100,
      });
      if (sequence !== collectionJobsLoadSequenceRef.current || authorityKeyRef.current !== capturedAuthorityKey) return;
      setCollectionJobs(Array.isArray(jobs) ? jobs : []);
    } catch (caught) {
      if (sequence !== collectionJobsLoadSequenceRef.current || authorityKeyRef.current !== capturedAuthorityKey) return;
      setCollectionJobs([]);
      setCollectionJobsError(toUserFacingError(caught, '生产采集任务读取失败。'));
    } finally {
      if (sequence === collectionJobsLoadSequenceRef.current && authorityKeyRef.current === capturedAuthorityKey) {
        setCollectionJobsLoading(false);
      }
    }
  }

  async function openArtifact(artifactId?: string, label = '打开工件') {
    if (openingArtifactKey) return;
    if (!artifactId) {
      setArtifactNotice('打开操作不可用：当前没有已登记的文件或目录。');
      return;
    }
    const artifactKey = dataImportArtifactActionKey(label, artifactId);
    setOpeningArtifactKey(artifactKey);
    setArtifactNotice(`${label}打开中...`);
    try {
      const storeContext = storeAuthority.authoritativeContext;
      if (!storeContext) throw new Error('当前店铺权威不可用。');
      await (window as any).electronAPI?.openReportArtifact?.(artifactId, { ...storeContext });
      setArtifactNotice(`${label}已请求打开。`);
    } catch (caught) {
      setArtifactNotice(`打开失败：${toUserFacingError(caught, '打开工件失败。')}`);
    } finally {
      setOpeningArtifactKey(null);
    }
  }

  function navigateTo(page: 'ad-quant' | 'data-collection') {
    window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: page }));
  }

  async function exportReconciliation() {
    setExportingReconciliation(true);
    setImportError('');
    try {
      const result = await (window as any).electronAPI?.exportDataReconciliationArtifacts?.(scope);
      setReconciliation(result || null);
      setNotice('数据对账已导出');
    } catch (caught) {
      setImportError(toUserFacingError(caught, '数据对账导出失败。'));
    } finally {
      setExportingReconciliation(false);
    }
  }

  async function runImport(mode: ImportMode) {
    const api = (window as any).electronAPI;
    const capturedContext = storeAuthority.authoritativeContext;
    const capturedAuthorityKey = storeAuthority.authorityKey;
    if (!capturedContext || !capturedAuthorityKey) {
      setImportError('请先选择美国站店铺，再执行报表导入。');
      return;
    }
    if (capturedContext.marketplace !== 'US' || capturedContext.currency !== 'USD') {
      setImportError('第一版只支持 Amazon US / USD 店铺。');
      return;
    }
    setRunningImport(mode);
    setNotice(mode === 'current'
      ? '正在导入当前范围已下载的 Lingxing 原始表格...'
      : '请选择本地已有的 Lingxing xlsx/xls/csv 原始广告表格...');
    setImportError('');
    try {
      const authorizedScope = {
        ...scope,
        storeName: storeAuthority.activeStore?.displayName || scope.storeName,
        marketplaceCode: 'US',
        storeContext: { ...capturedContext },
      };
      if (mode === 'current') {
        if (!api?.importCurrentBusinessReports) throw new Error('导入当前范围接口未暴露。');
        const result = await api.importCurrentBusinessReports(authorizedScope);
        const inserted = Number(result?.metricsImport?.inserted || 0);
        const parsedFiles = Number(result?.metricsImport?.parsedFiles || 0);
        const errors = Number(result?.metricsImport?.errors?.length || 0);
        if (parsedFiles <= 0 || errors > 0) {
          setImportError(`导入未形成可量化广告数据：解析 ${parsedFiles} 个表，写入 ${inserted} 行，错误 ${errors} 个。`);
        } else {
          setNotice(inserted > 0
            ? `导入完成：解析 ${parsedFiles} 个真实报表，写入 ${inserted} 行广告指标。`
            : `导入回执完成：解析 ${parsedFiles} 个有效空表，写入 0 行；哈希与零行回执已登记，系统将按完整 8 类任务血缘重新核对。`);
        }
      } else {
        if (!api?.importLocalBusinessReportFiles) throw new Error('导入本地报表接口未暴露。');
        const result = await api.importLocalBusinessReportFiles(authorizedScope);
        if (result?.cancelled) {
          setNotice('已取消本地报表选择。');
          return;
        }
        const inserted = Number(result?.metricsImport?.inserted || 0);
        const parsedFiles = Number(result?.metricsImport?.parsedFiles || 0);
        const errors = Number(result?.metricsImport?.errors?.length || 0);
        if (parsedFiles <= 0 || errors > 0) {
          setImportError(`本地导入未形成可量化广告数据：解析 ${parsedFiles} 个表，写入 ${inserted} 行，错误 ${errors} 个。`);
        } else {
          setNotice(inserted > 0
            ? `本地导入完成：解析 ${parsedFiles} 个真实报表，写入 ${inserted} 行广告指标。`
            : `本地导入回执完成：解析 ${parsedFiles} 个有效空表，写入 0 行；哈希与零行回执已登记，系统将按完整 8 类任务血缘重新核对。`);
        }
      }
      if (authorityKeyRef.current !== capturedAuthorityKey) return;
      window.dispatchEvent(new Event('business-ui:data-updated'));
      reload();
      await loadProductionCollectionJobs(capturedContext, capturedAuthorityKey);
    } catch (caught) {
      if (authorityKeyRef.current !== capturedAuthorityKey) return;
      setImportError(toUserFacingError(caught, '真实报表导入未完成。'));
      setNotice('真实报表导入未完成。');
    } finally {
      if (authorityKeyRef.current === capturedAuthorityKey) setRunningImport(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="数据"
        title={PAGE_HEADER_TITLES.dataImportValidation}
        description="只处理真实 Lingxing xlsx/xls/csv 表格入库和口径校验。审计文件、截图、HTML 和采集清单不会被当作广告数据。"
      />

      <TaskBanner
        description={taskState.detail}
        meta={`生产血缘 ${realReportCount}/8 类真实报表 · ${importedRows} 行日级指标`}
        primaryAction={{
          label: taskState.primaryActionLabel,
          busy: Boolean(runningImport || collectionJobsLoading),
          busyLabel: collectionJobsLoading ? '核对中...' : dataImportBusyLabel(runningImport),
          disabled: Boolean(runningImport || collectionJobsLoading),
          onClick: isDataReady
            ? () => navigateTo('ad-quant')
            : () => navigateTo('data-collection'),
        }}
        secondaryActions={[
          {
            label: taskState.secondaryActionLabel,
            disabled: Boolean(runningImport || openingArtifactKey),
            onClick: reportFolderArtifactId
              ? () => { void openArtifact(reportFolderArtifactId, '打开报表目录'); }
              : () => { void runImport('local'); },
          },
          { label: '回到数据采集', onClick: () => navigateTo('data-collection'), disabled: Boolean(runningImport) },
        ]}
        status={collectionJobsLoading ? '核对中' : isDataReady ? '已闭合' : lineageReadiness.latestJobId ? '血缘未闭合' : '缺生产任务'}
        title={taskState.title}
        tone={isDataReady ? 'confirmed' : lineageReadiness.state === 'partial' ? 'attention' : 'blocked'}
      />

      <div className="business-stack data-import-prototype-stack">
        <Panel
          title="生产采集血缘"
          titleAccessory={(
            <StatusPill tone={collectionJobsLoading ? 'pending' : lineageReadiness.state === 'ready' ? 'ready' : lineageReadiness.state === 'partial' ? 'warning' : 'blocked'}>
              {collectionJobsLoading ? '核对中' : lineageReadiness.state === 'ready' ? '已闭合' : lineageReadiness.state === 'missing' ? '缺任务' : '未闭合'}
            </StatusPill>
          )}
          tone={lineageReadiness.state === 'ready' ? 'success' : lineageReadiness.state === 'partial' ? 'warning' : 'blocked'}
        >
          <div className="context-summary-grid">
            <div>
              <span>生产 root 任务</span>
              <strong>{lineageReadiness.rootJobId || '未建立'}</strong>
              <p>{lineageReadiness.lineageId ? `lineage ${lineageReadiness.lineageId}` : '独立任务不会与其他批次拼成 8/8。'}</p>
            </div>
            <div>
              <span>授权链任务</span>
              <strong>{lineageReadiness.lineageJobIds.length} 个</strong>
              <p>{lineageReadiness.latestJobId ? `最近任务 ${lineageReadiness.latestJobId}` : '当前日期窗没有真实生产任务。'}</p>
            </div>
            <div>
              <span>文件批次匹配</span>
              <strong>{lineageReadiness.sourceMatchedReportCount}/8 类</strong>
              <p>每类文件的 batchId 必须等于产生最终 downloaded 检查点的任务。</p>
            </div>
            <div>
              <span>生产入库确认</span>
              <strong>{lineageReadiness.importedReportCount}/8 类 · {lineageReadiness.importedRows} 行</strong>
              <p>只计入 importState=succeeded 且可回读到对应批次的指标行。</p>
            </div>
          </div>
          {collectionJobsPreviewOnly && (
            <p className="warning-line" role="status">DEV 预览不会注入伪造任务、lineage 或入库成功；此状态不提供生产就绪证明。</p>
          )}
          {collectionJobsError && <p className="blocked-line" role="alert">生产任务读取失败：{collectionJobsError}</p>}
          {!collectionJobsLoading && !collectionJobsError && !isDataReady && (
            <div className="evidence-check-panel">
              <h3>{lineageReadiness.title}</h3>
              <p className="warning-line">{lineageReadiness.detail}</p>
            </div>
          )}
          {(aggregateRealReportCount !== realReportCount || aggregateImportedRows !== importedRows) && (
            <p className="warning-line">
              当前日期窗聚合检测到 {aggregateRealReportCount}/8 类文件、{aggregateImportedRows} 行指标；其中只有 {realReportCount}/8 类、{importedRows} 行属于最新生产授权链，其他批次不参与放行。
            </p>
          )}
        </Panel>

        <Panel
          className="data-import-primary-panel"
          title="生产血缘导入状态"
          titleAccessory={(
            <div className="data-import-title-pills" aria-label="导入批次状态">
              <StatusPill tone={realReportCount >= 8 ? 'ready' : hasRealFiles ? 'warning' : 'blocked'}>真实报表 {realReportCount}/8</StatusPill>
              <StatusPill tone={isDataReady ? 'ready' : hasImportedMetrics ? 'warning' : 'blocked'}>入库 {importedRows} 行</StatusPill>
              <StatusPill tone={rejectedEvidenceCount > 0 ? 'warning' : 'ready'}>异常证据 {rejectedEvidenceCount}</StatusPill>
              <StatusPill tone={isDataReady ? 'ready' : hasRealFiles ? 'warning' : 'blocked'}>{isDataReady ? '已闭合' : hasImportedMetrics ? '部分入库' : hasRealFiles ? '待导入' : '缺报表'}</StatusPill>
            </div>
          )}
          tone={isDataReady ? 'success' : hasRealFiles ? 'warning' : 'blocked'}
        >
          <div className="table-wrap">
            <table className="business-table data-import-prototype-table">
              <thead>
                <tr>
                  <th>报表</th>
                  <th>入库行数</th>
                  <th>状态</th>
                  <th>文件</th>
                </tr>
              </thead>
              <tbody>
                {(sortedReportRows.length ? sortedReportRows : reportRows).slice(0, 8).map((row) => (
                  <tr key={row.type}>
                    <td><strong>{row.label}</strong></td>
                    <td>{row.importedRows}</td>
                    <td>
                      <StatusPill tone={row.statusDisplay.tone}>{row.statusDisplay.label}</StatusPill>
                      {row.importError && <p className="blocked-line table-subtext">{row.importError}</p>}
                    </td>
                    <td>{row.artifactId ? <code>{dataImportFileLabel(row)}</code> : '缺少真实文件'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted-line data-import-primary-note">只以 Lingxing xlsx/xls/csv 原始表格入库；生产授权链与 batchId 必须可回读，截图、HTML、审计文件只留在辅助证据区。</p>
          {loading && <p className="muted-line">正在读取当前范围文件和数据库状态...</p>}
          {error && <p className="blocked-line">读取异常：{error}</p>}
          <div className="action-row">
            {reportFolderArtifactId
              ? renderOpenArtifactButton({
                  disabled: Boolean(runningImport || openingArtifactKey),
                  idleLabel: '打开报表目录',
                  artifactId: reportFolderArtifactId,
                })
              : (
                <button aria-busy={localImportButton.ariaBusy} className={localImportButton.className} disabled={localImportButton.disabled} onClick={() => runImport('local')} type="button">
                  <span className={localImportButton.ariaBusy ? 'button-content' : undefined}>
                    {localImportButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                    {localImportButton.label}
                  </span>
                </button>
              )}
            <button aria-busy={exportButton.ariaBusy} className={exportButton.className} disabled={exportButton.disabled} onClick={exportReconciliation} type="button">
              <span className={exportButton.ariaBusy ? 'button-content' : undefined}>
                {exportButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                {exportButton.label}
              </span>
            </button>
          </div>
        </Panel>

        <div className={`data-import-feedback-strip data-import-feedback-strip-${importFeedback.tone}`} role="status" aria-live="polite">
          <span>入库反馈</span>
          <strong>{importFeedback.title}</strong>
          <p>{importFeedback.detail}</p>
          <StatusPill tone={importFeedback.tone}>{importFeedback.statusLabel}</StatusPill>
        </div>

        {reportFolderArtifactId && (
          <details className="folded-ops-panel data-import-report-folder-panel">
            <summary>
              <span>真实报表目录</span>
              <StatusPill tone="ready">真实报表 {realReportCount}/8</StatusPill>
            </summary>
            <div className="folded-ops-body business-split">
              <div>
                <div className="business-scope-line">当前店铺原始报表目录已登记</div>
                <p className="muted-line">这里只放当前范围可导入的 Lingxing xlsx/xls/csv 原始广告报表。</p>
              </div>
              <div className="business-pill-row business-pill-row-right">
                {renderOpenArtifactButton({ idleLabel: '打开报表目录', artifactId: reportFolderArtifactId })}
              </div>
            </div>
          </details>
        )}

        <ProgressiveDetails title="数据流程四段闭环">
          <Panel title="数据流程四段闭环" tone={dataLedger.status === 'ready' ? 'success' : dataLedger.status === 'partial' ? 'warning' : 'blocked'}>
            <div className="judgment-panel">
              <div>
                <span>{isDataReady ? '数据链已闭合' : '数据链未闭合'}</span>
                <strong>{isDataReady ? '可以查看广告表现' : lineageReadiness.latestJobId ? '回采集任务恢复或补导' : '先建立完整八报表任务'}</strong>
                <p>导入页只负责把真实报表变成日级广告事实；审计证据不能替代广告数据。</p>
              </div>
            </div>
            <div className="collection-progress-grid">
              {dataLedger.stages.map((stage, index) => (
                <div className={readinessStageClass(stage.status)} key={stage.key}>
                  <span>第 {index + 1} 步</span>
                  <strong>{stage.title}</strong>
                  <p>{stage.value}</p>
                  <p>{stage.detail}</p>
                  <StatusPill tone={readinessStageTone(stage.status)}>{readinessStageLabel(stage.status)}</StatusPill>
                </div>
              ))}
            </div>
            <p className={isDataReady ? 'muted-line' : 'warning-line'}>
              {isDataReady
                ? '下一步：查看广告表现，复核 ACOS、花费、订单和产品阶段。'
                : hasRealFiles
                  ? '下一步：回到“报表采集”的当前店铺任务历史，按任务状态继续采集或补导；通用文件导入不会替代生产任务血缘。'
                  : '下一步：到“数据准备 → 报表采集”建立当前店铺、当前日期窗的完整八报表生产任务。'}
            </p>
          </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="文件位置与用途">
          <Panel title="广告数据现在在哪" tone={isDataReady ? 'success' : hasRealFiles ? 'warning' : 'blocked'}>
            <div className="context-summary-grid">
            <div>
              <span>原始表格目录</span>
              <strong>{reportFolderArtifactId ? '当前店铺原始报表目录已登记' : '暂无生产血缘报表目录'}</strong>
              <p>{hasRealFiles ? '这里存放当前范围的 Lingxing xlsx/xls/csv 原始广告报表。' : '当前本地还没有当前范围的真实广告表格。'}</p>
            </div>
            <div>
              <span>SQLite 日级指标</span>
              <strong>{importedRows} 行可用</strong>
              <p>{isDataReady ? importedRows > 0 ? '广告表现、AI 证据包和优化建议会读取这些日级广告事实。' : '完整 8 类零行回执已闭合；广告表现会展示可追溯的真实零数据状态。' : hasImportedMetrics ? `已有 ${lineageReadiness.importedReportCount}/8 类入库回执，但完整生产血缘闭合前不会放行正式诊断。` : '未导入前数据库没有可用于广告表现的每日指标或零行回执。'}</p>
            </div>
            <div>
              <span>审计文件不参与计算</span>
              <strong>{rejectedEvidenceCount} 个流程证据</strong>
              <p>采集清单、审计文件、截图和 HTML 只证明采集流程，不参与花费、订单、销售或 ACOS 计算。</p>
            </div>
            <div>
              <span>下一步</span>
              <strong>{isDataReady ? '下一步查看广告表现' : '回采集任务处理'}</strong>
              <p>{isDataReady ? '复核 ACOS、花费、订单、产品阶段和 AI 证据链。' : '继续或补导最新生产授权链；独立本地导入不解锁正式诊断。'}</p>
            </div>
            </div>
            <div className="action-row">
              {renderOpenArtifactButton({ disabled: !reportFolderArtifactId, idleLabel: '打开原始表格目录', artifactId: reportFolderArtifactId })}
              <button aria-busy={exportButton.ariaBusy} className={exportButton.className} disabled={exportButton.disabled} onClick={exportReconciliation} type="button">
                <span className={exportButton.ariaBusy ? 'button-content' : undefined}>
                  {exportButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                  {exportButton.label}
                </span>
              </button>
              <button className="secondary-button" disabled={!isDataReady} onClick={() => navigateTo('ad-quant')} type="button">查看广告表现</button>
            </div>
            {reconciliation && (
              <div className="evidence-check-panel">
                <h3>数据对账已导出</h3>
                <p className="muted-line">
                  权威口径 {reconciliationSourceLabel(reconciliation.canonicalSource)} / {reconciliation.canonical?.rows ?? 0} 行 / {formatUsd(reconciliation.canonical?.spend)} / {reconciliation.canonical?.orders ?? 0} 单
                </p>
                {reconciliation.blockers?.length ? (
                  <p className="warning-line">对账阻断：{reconciliation.blockers.slice(0, 3).join('；')}</p>
                ) : (
                  <p className="muted-line">对账未发现阻断项。</p>
                )}
                <div className="path-list">
                  <div className="path-row">
                    <span>对账数据文件</span>
                    <code>{reconciliation.jsonDisplayName || '-'}</code>
                    {renderOpenArtifactButton({ className: 'secondary-button compact-button', disabled: !reconciliation.jsonArtifactId, idleLabel: '打开对账数据文件', artifactId: reconciliation.jsonArtifactId })}
                  </div>
                  <div className="path-row">
                    <span>对账说明文件</span>
                    <code>{reconciliation.markdownDisplayName || '-'}</code>
                    {renderOpenArtifactButton({ className: 'secondary-button compact-button', disabled: !reconciliation.markdownArtifactId, idleLabel: '打开对账说明文件', artifactId: reconciliation.markdownArtifactId })}
                  </div>
                </div>
              </div>
            )}
          </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="导入动作">
          <Panel title="导入动作" tone={hasRealFiles ? 'warning' : 'blocked'}>
            <div className="judgment-panel">
              <div>
                <span>下一步</span>
                <strong>{hasImportedMetrics ? '当前范围已经有入库回执' : hasRealFiles ? '导入已下载表格' : '先获取真实报表'}</strong>
                <p>
                  {hasImportedMetrics
                    ? `当前生产授权链已有 ${lineageReadiness.importedReportCount}/8 类入库回执、${importedRows} 行指标；只有完整 8 类任务入库状态持久化为 succeeded 才能放行。`
                    : hasRealFiles
                      ? '可重新解析当前文件，但生产任务失败或待确认时仍需回“报表采集”执行任务级补导。'
                      : '当前没有与生产授权链匹配的真实报表；请先回“报表采集”建立或恢复完整八报表任务。'}
                </p>
              </div>
              <div className="table-action-row">
                <button aria-busy={currentImportButton.ariaBusy} className={currentImportButton.className} disabled={currentImportButton.disabled} onClick={() => runImport('current')} type="button">
                  <span className={currentImportButton.ariaBusy ? 'button-content' : undefined}>
                    {currentImportButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                    {currentImportButton.label}
                  </span>
                </button>
                <button aria-busy={localImportButton.ariaBusy} className={localImportButton.className} disabled={localImportButton.disabled} onClick={() => runImport('local')} type="button">
                  <span className={localImportButton.ariaBusy ? 'button-content' : undefined}>
                    {localImportButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                    {localImportButton.label}
                  </span>
                </button>
              </div>
            </div>
            {notice && <p className="muted-line">{notice}</p>}
            {importError && <p className="blocked-line">{importError}</p>}
          </Panel>
        </ProgressiveDetails>

        {isDataReady && (
          <Panel title="量化前口径快照" tone="success">
            <div className="context-summary-grid">
              <div><span>广告花费</span><strong>{formatUsd(totalSpend)}</strong><p>来自当前范围已导入指标。</p></div>
              <div><span>广告销售</span><strong>{formatUsd(totalSales)}</strong><p>用于 ACOS 和阶段判断。</p></div>
              <div><span>广告订单</span><strong>{totalOrders}</strong><p>后续建议会结合订单和花费阈值。</p></div>
              <div><span>可行动行</span><strong>{quant?.actionableRows ?? 0}</strong><p>只有可绑定 keyword/search term/target 的行能进入建议。</p></div>
            </div>
          </Panel>
        )}

        <ProgressiveDetails title="8 类报表入库明细">
          <Panel title="8 类报表入库明细" tone={hasRealFiles ? 'default' : 'blocked'}>
            <div className={dataImportTableFeedbackClass({ refreshing: tableRefreshing, locked: importLocked })}>
              <p aria-live="polite" className="data-import-table-feedback">{tableFeedback}</p>
              {importLocked && (
                <p aria-live="polite" className="data-import-table-lock">
                  正在写入 SQLite，表格已锁定为只读；完成后自动刷新入库行数。
                </p>
              )}
              <VirtualDataTable
                columns={reportColumns}
                emptyMessage="当前范围还没有报表状态。请先完成数据采集。"
                estimateSize={72}
                getRowKey={(row) => row.type}
                loading={loading}
                minWidth="1120px"
                onSortChange={dataImportTableSortHandler({ locked: importLocked, onSort: handleReportSortChange })}
                rowClassName={() => dataImportTableRefreshRowClass(tableRefreshing)}
                rows={sortedReportRows}
                sortDirection={sortState?.direction ?? 'desc'}
                sortKey={sortState?.key}
              />
            </div>
          </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="文件位置">
          <Panel title="文件位置" tone={hasRealFiles ? 'default' : 'blocked'}>
            <div className="path-list">
            <div className="path-row">
              <span>真实广告表格目录</span>
              <code>{reportFolderArtifactId ? '当前店铺报表目录已登记' : '暂无'}</code>
              {renderOpenArtifactButton({ className: 'secondary-button compact-button', disabled: !reportFolderArtifactId, idleLabel: '打开', messageLabel: '打开真实广告表格目录', artifactId: reportFolderArtifactId })}
            </div>
            <div className="path-row">
              <span>采集清单</span>
              <code>{lineageManifestArtifactId ? '当前生产任务采集清单已登记' : '暂无匹配生产任务清单'}</code>
              {renderOpenArtifactButton({ className: 'secondary-button compact-button', disabled: !lineageManifestArtifactId, idleLabel: '打开', messageLabel: '打开采集清单', artifactId: lineageManifestArtifactId })}
            </div>
            </div>
            <p className="warning-line">采集清单和审计证据只用于追溯流程；广告表现只读取上方真实报表和 SQLite 指标。</p>
            {artifactNotice && <p className={artifactNotice.startsWith('打开失败') ? 'blocked-line' : 'muted-line'}>{artifactNotice}</p>}
          </Panel>
        </ProgressiveDetails>
      </div>
    </div>
  );
}
