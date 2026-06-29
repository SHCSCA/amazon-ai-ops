import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { OperatorTaskPanel } from '../components/operator-task-panel';
import { ProgressiveDetails } from '../components/progressive-details';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { VirtualDataTable, type VirtualDataTableColumn } from '../components/virtual-data-table';
import { buildDataReadinessLedger } from '../data-readiness-ledger';
import { compactPath, formatUsd } from '../formatters';
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
  filePath: string;
  fileHash: string;
  fileSizeBytes: number;
  importedRows: number;
  importError: string;
  status: string;
  statusDisplay: ReportImportStatusDisplay;
}

const DATA_IMPORT_TEXT_SORT_KEYS = new Set<DataImportSortKey>(['label', 'file', 'ext', 'hash', 'status']);

function fileExtension(fileName: string, filePath: string): string {
  const target = fileName || filePath;
  const dotIndex = target.lastIndexOf('.');
  return dotIndex >= 0 ? target.slice(dotIndex).toLowerCase() : '-';
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
  if (key === 'file') return (row.fileName || row.filePath || '').toLowerCase();
  if (key === 'ext') return fileExtension(row.fileName, row.filePath);
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
    file: '真实文件',
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
  filePath?: string;
  importError?: string;
}): ReportImportStatusDisplay {
  const importedRows = Number(input.importedRows || 0);
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
      detail: `${importedRows} 行日级广告指标已写入 SQLite，可被广告量化和 AI 证据包读取。`,
      tone: 'ready',
    };
  }
  if (input.filePath && input.status === 'downloaded') {
    return {
      label: '已下载待入库',
      detail: '文件已在本地；点击“导入已下载表格”后才会解析并写入 SQLite。',
      tone: 'warning',
    };
  }
  if (input.filePath) {
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
  importedRows: number;
  runningImport: ImportMode | null;
  notice?: string;
  importError?: string;
}): DataImportFeedback {
  const importNotice = input.notice?.includes('导入') ? input.notice : '';
  if (input.runningImport === 'current') {
    return {
      title: '正在写入 SQLite',
      detail: '正在解析当前范围已下载的 Lingxing 原始表格，完成后会刷新入库行数和广告量化口径。',
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
  if (Number(input.importedRows || 0) > 0) {
    return {
      title: '当前范围已入库',
      detail: importNotice || `SQLite 已有 ${input.importedRows} 行日级广告指标；如果重新下载过表格，可再次导入刷新。`,
      statusLabel: '已入库',
      tone: 'ready',
      className: feedbackClassName('ready'),
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
  realFiles: Array<{ folderPath?: string }>;
  auditDownloadDir?: string;
}): string | undefined {
  if ((Number(input.realReportCount) || 0) <= 0) return undefined;
  return input.realFiles.find((file) => Boolean(file.folderPath))?.folderPath;
}

export function buildDataImportTaskState({
  realReportCount,
  importedRows,
  reportFolder,
}: {
  realReportCount: number;
  importedRows: number;
  reportFolder?: string;
}): DataImportTaskState {
  const reportCount = Math.max(0, Math.min(8, Number(realReportCount) || 0));
  const rowCount = Math.max(0, Number(importedRows) || 0);
  const hasRealReports = reportCount > 0;
  const hasRows = rowCount > 0;
  return {
    title: `真实报表 ${reportCount}/8，已导入 ${rowCount} 行`,
    detail: hasRows
      ? '日级广告指标已写入 SQLite；重导入同批同文件会先清旧行再写入。'
      : hasRealReports
        ? '真实报表已下载但未入库，下一步把广告指标写入 SQLite。'
        : '当前范围缺少真实报表，先回数据采集获取或导入本地表格。',
    primaryActionLabel: hasRows ? '进入广告量化' : hasRealReports ? '导入已下载表格' : '去数据采集',
    secondaryActionLabel: reportFolder ? '打开报表目录' : '导入本地报表',
  };
}

export function DataImportValidationPage() {
  const { data, error, loading, scope, reload } = useBusinessDataPipeline();
  const [runningImport, setRunningImport] = useState<ImportMode | null>(null);
  const [exportingReconciliation, setExportingReconciliation] = useState(false);
  const [reconciliation, setReconciliation] = useState<{
    jsonPath?: string;
    markdownPath?: string;
    canonicalSource?: string;
    canonical?: { rows?: number; spend?: number; orders?: number };
    blockers?: string[];
  } | null>(null);
  const [notice, setNotice] = useState('');
  const [importError, setImportError] = useState('');
  const [pathNotice, setPathNotice] = useState('');
  const [sortState, setSortState] = useState<DataImportSortState | null>(null);
  const [tableRefreshing, setTableRefreshing] = useState(false);
  const refreshTimerRef = useRef<number | null>(null);
  const importLocked = Boolean(runningImport);
  const collection = data?.collection;
  const quant = data?.quant;
  const reportOptions = collection?.reportOptions || [];
  const realFiles = collection?.realReportFiles || [];
  const fileAudit = collection?.fileAudit;
  const realReportCount = fileAudit?.realReportFileCount ?? realFiles.length;
  const importedRows = fileAudit?.importedRowCount ?? quant?.importedRows ?? 0;
  const rejectedEvidenceCount = fileAudit?.rejectedEvidenceFileCount ?? 0;
  const hasRealFiles = realReportCount > 0;
  const hasImportedMetrics = importedRows > 0;
  const reportFolder = dataImportFirstViewportReportFolder({
    realReportCount,
    realFiles,
    auditDownloadDir: fileAudit?.downloadDir,
  });
  const totalSpend = quant?.totalSpend ?? 0;
  const totalSales = quant?.totalSales ?? 0;
  const totalOrders = quant?.totalOrders ?? 0;
  const dataLedger = useMemo(() => buildDataReadinessLedger({
    requiredReportCount: 8,
    reportOptions,
    realReportFileCount: realReportCount,
    importedRowCount: importedRows,
    rejectedEvidenceFileCount: rejectedEvidenceCount,
  }), [importedRows, realReportCount, rejectedEvidenceCount, reportOptions]);
  useEffect(() => () => {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
    }
  }, []);

  const reportRows = useMemo<DataImportReportRow[]>(() => reportOptions.map((option) => {
    const files = realFiles.filter((file) => file.reportType === option.type);
    const firstFile = files[0];
    const importedForType = files.reduce((sum, file) => sum + Number(file.importedRows || 0), 0) || option.importedRows;
    return {
      ...option,
      fileName: firstFile?.fileName || '',
      filePath: firstFile?.filePath || '',
      fileHash: firstFile?.fileHash || '',
      fileSizeBytes: firstFile?.fileSizeBytes || 0,
      importedRows: importedForType,
      importError: firstFile?.importError || '',
      status: firstFile?.importError ? 'import_failed' : importedForType > 0 ? 'imported' : firstFile?.status || option.status,
    };
  }).map((row) => ({
    ...row,
    statusDisplay: buildReportImportStatusDisplay({
      status: row.status,
      importedRows: row.importedRows,
      filePath: row.filePath,
      importError: row.importError,
    }),
  })), [realFiles, reportOptions]);
  const sortedReportRows = useMemo(() => sortDataImportReportRows(reportRows, sortState), [reportRows, sortState]);
  const tableFeedback = buildDataImportTableFeedback({
    importedRows,
    realReportCount,
    sortDirection: sortState?.direction ?? null,
    sortLabel: sortState ? dataImportSortLabel(sortState.key) : '',
    totalCount: reportRows.length,
  });
  const taskState = buildDataImportTaskState({
    realReportCount,
    importedRows,
    reportFolder,
  });
  const importFeedback = buildDataImportFeedback({
    realReportCount,
    importedRows,
    runningImport,
    notice,
    importError,
  });
  const currentImportButton = dataImportActionButtonView({ mode: 'current', runningImport, hasRealFiles });
  const localImportButton = dataImportActionButtonView({ mode: 'local', runningImport, hasRealFiles });
  const exportButton = dataImportExportButtonView({ exportingReconciliation, hasImportedMetrics });
  const reportColumns: Array<VirtualDataTableColumn<DataImportReportRow>> = [
    { key: 'label', header: '报表', width: '170px', sortable: true, sortLabel: '报表', cell: (row) => row.label },
    {
      key: 'file',
      header: '真实文件',
      width: 'minmax(240px, 1.4fr)',
      sortable: true,
      sortLabel: '真实文件',
      cell: (row) => row.filePath ? <code>{compactPath(row.filePath)}</code> : '缺少真实文件',
    },
    { key: 'ext', header: '类型', width: '72px', sortable: true, sortLabel: '类型', cell: (row) => <code>{row.filePath ? fileExtension(row.fileName, row.filePath) : '-'}</code> },
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
        <button className="secondary-button compact-button" disabled={!row.filePath || importLocked} onClick={() => openPath(row.filePath)} type="button">
          打开表格
        </button>
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
    }, 100);
  }

  async function openPath(targetPath?: string) {
    if (!targetPath) return;
    try {
      await (window as any).electronAPI?.openReportPath?.(targetPath);
      setPathNotice(`已请求打开：${compactPath(targetPath)}`);
    } catch (caught) {
      setPathNotice(`打开失败：${toUserFacingError(caught, '打开路径失败。')}`);
    }
  }

  function navigateTo(page: 'ad-quant' | 'data-collection') {
    window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: page }));
  }

  async function exportReconciliation() {
    setExportingReconciliation(true);
    setImportError('');
    try {
      const result = await (window as any).electronAPI?.exportDataReconciliation?.(scope);
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
    setRunningImport(mode);
    setNotice(mode === 'current'
      ? '正在导入当前范围已下载的 Lingxing 原始表格...'
      : '请选择本地已有的 Lingxing xlsx/xls/csv 原始广告表格...');
    setImportError('');
    try {
      if (mode === 'current') {
        if (!api?.importCurrentBusinessReports) throw new Error('导入当前范围接口未暴露。');
        const result = await api.importCurrentBusinessReports(scope);
        const inserted = Number(result?.metricsImport?.inserted || 0);
        const parsedFiles = Number(result?.metricsImport?.parsedFiles || 0);
        const errors = Number(result?.metricsImport?.errors?.length || 0);
        if (inserted <= 0 || errors > 0) {
          setImportError(`导入未形成可量化广告数据：解析 ${parsedFiles} 个表，写入 ${inserted} 行，错误 ${errors} 个。`);
        } else {
          setNotice(`导入完成：解析 ${parsedFiles} 个真实报表，写入 ${inserted} 行广告指标。`);
        }
      } else {
        if (!api?.importLocalBusinessReportFiles) throw new Error('导入本地报表接口未暴露。');
        const result = await api.importLocalBusinessReportFiles(scope);
        if (result?.cancelled) {
          setNotice('已取消本地报表选择。');
          return;
        }
        const inserted = Number(result?.metricsImport?.inserted || 0);
        const parsedFiles = Number(result?.metricsImport?.parsedFiles || 0);
        const errors = Number(result?.metricsImport?.errors?.length || 0);
        if (inserted <= 0 || errors > 0) {
          setImportError(`本地导入未形成可量化广告数据：解析 ${parsedFiles} 个表，写入 ${inserted} 行，错误 ${errors} 个。`);
        } else {
          setNotice(`本地导入完成：解析 ${parsedFiles} 个真实报表，写入 ${inserted} 行广告指标。`);
        }
      }
      window.dispatchEvent(new Event('business-ui:data-updated'));
      reload();
    } catch (caught) {
      setImportError(toUserFacingError(caught, '真实报表导入未完成。'));
      setNotice('真实报表导入未完成。');
    } finally {
      setRunningImport(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="数据与量化"
        title="数据导入与校验"
        description="只处理真实 Lingxing xlsx/xls/csv 表格入库和口径校验。审计文件、截图、HTML 和采集清单不会被当作广告数据。"
        primaryTask="把真实报表写入每日广告数据库"
        nextAction={hasImportedMetrics ? '进入广告量化' : hasRealFiles ? '导入已下载表格' : '先到数据采集获取报表'}
      />

      <div className="business-stack">
        <OperatorTaskPanel
          eyebrow="当前任务"
          title={taskState.title}
          detail={taskState.detail}
          primaryAction={{
            label: taskState.primaryActionLabel,
            busy: Boolean(runningImport),
            busyLabel: dataImportBusyLabel(runningImport),
            disabled: Boolean(runningImport),
            onClick: hasImportedMetrics
              ? () => navigateTo('ad-quant')
              : hasRealFiles
                ? () => runImport('current')
                : () => navigateTo('data-collection'),
          }}
          secondaryActions={[
            {
              label: taskState.secondaryActionLabel,
              busy: Boolean(runningImport),
              busyLabel: dataImportBusyLabel(runningImport),
              disabled: Boolean(runningImport),
              onClick: reportFolder ? () => openPath(reportFolder) : () => runImport('local'),
            },
          ]}
        >
          {loading && <p className="muted-line">正在读取当前范围文件和数据库状态...</p>}
          {error && <p className="blocked-line">读取异常：{error}</p>}
        </OperatorTaskPanel>

        <div className={importFeedback.className}>
          <div>
            <span>入库反馈</span>
            <strong>{importFeedback.title}</strong>
            <p>{importFeedback.detail}</p>
          </div>
          <div className="collection-action-feedback-side">
            <StatusPill tone={importFeedback.tone}>{importFeedback.statusLabel}</StatusPill>
          </div>
        </div>

        {reportFolder && (
          <Panel title="真实报表目录" tone="success">
            <div className="business-split">
              <div>
                <div className="business-scope-line">{compactPath(reportFolder)}</div>
                <p className="muted-line">这里只放当前范围可导入的 Lingxing xlsx/xls/csv 原始广告报表。</p>
              </div>
              <div className="business-pill-row business-pill-row-right">
                <StatusPill tone="ready">真实报表 {realReportCount}/8</StatusPill>
                <button className="secondary-button" onClick={() => openPath(reportFolder)} type="button">打开报表目录</button>
              </div>
            </div>
          </Panel>
        )}

        <ProgressiveDetails title="数据流程四段闭环">
          <Panel title="数据流程四段闭环" tone={dataLedger.status === 'ready' ? 'success' : dataLedger.status === 'partial' ? 'warning' : 'blocked'}>
            <div className="judgment-panel">
              <div>
                <span>{hasRealFiles && hasImportedMetrics ? '数据链已闭合' : '数据链未闭合'}</span>
                <strong>{hasRealFiles && hasImportedMetrics ? '可以进入广告量化' : hasRealFiles ? '先完成指标入库' : '先获取真实广告报表'}</strong>
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
            <p className={hasImportedMetrics ? 'muted-line' : 'warning-line'}>
              {hasImportedMetrics
                ? '下一步：进入广告量化，复核 ACOS、花费、订单和产品阶段。'
                : hasRealFiles
                  ? '下一步：点击“导入已下载表格”，把真实报表写入 SQLite 日级指标。'
                  : '下一步：回到数据采集页下载已创建报表、重新创建下载，或导入本地报表。'}
            </p>
          </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="文件位置与用途">
          <Panel title="广告数据现在在哪" tone={hasImportedMetrics ? 'success' : hasRealFiles ? 'warning' : 'blocked'}>
            <div className="context-summary-grid">
            <div>
              <span>原始表格目录</span>
              <strong>{hasRealFiles && fileAudit?.downloadDir ? compactPath(fileAudit.downloadDir) : '暂无真实报表目录'}</strong>
              <p>{hasRealFiles ? '这里存放当前范围的 Lingxing xlsx/xls/csv 原始广告报表。' : '当前本地还没有当前范围的真实广告表格。'}</p>
            </div>
            <div>
              <span>SQLite 日级指标</span>
              <strong>{importedRows} 行可用</strong>
              <p>{hasImportedMetrics ? '广告量化、AI 证据包和优化建议会读取这些日级广告事实。' : '未导入前数据库没有可用于广告量化的每日指标。'}</p>
            </div>
            <div>
              <span>审计文件不参与计算</span>
              <strong>{rejectedEvidenceCount} 个流程证据</strong>
              <p>采集清单、审计文件、截图和 HTML 只证明采集流程，不参与花费、订单、销售或 ACOS 计算。</p>
            </div>
            <div>
              <span>下一步</span>
              <strong>{hasImportedMetrics ? '下一步去广告量化' : hasRealFiles ? '导入已下载表格' : '回数据采集获取真实报表'}</strong>
              <p>{hasImportedMetrics ? '复核 ACOS、花费、订单、产品阶段和 AI 证据链。' : hasRealFiles ? '把真实报表解析并写入 SQLite 后才能生成建议。' : '先下载已创建报表、重新创建下载，或导入本地真实报表。'}</p>
            </div>
            </div>
            <div className="action-row">
              <button className="secondary-button" disabled={!hasRealFiles || !fileAudit?.downloadDir} onClick={() => openPath(fileAudit?.downloadDir)} type="button">打开原始表格目录</button>
              <button aria-busy={exportButton.ariaBusy} className={exportButton.className} disabled={exportButton.disabled} onClick={exportReconciliation} type="button">
                <span className={exportButton.ariaBusy ? 'button-content' : undefined}>
                  {exportButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                  {exportButton.label}
                </span>
              </button>
              <button className="secondary-button" disabled={!hasImportedMetrics} onClick={() => navigateTo('ad-quant')} type="button">进入广告量化</button>
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
                    <code>{reconciliation.jsonPath || '-'}</code>
                    <button className="secondary-button compact-button" disabled={!reconciliation.jsonPath} onClick={() => openPath(reconciliation.jsonPath)} type="button">打开对账数据文件</button>
                  </div>
                  <div className="path-row">
                    <span>对账说明文件</span>
                    <code>{reconciliation.markdownPath || '-'}</code>
                    <button className="secondary-button compact-button" disabled={!reconciliation.markdownPath} onClick={() => openPath(reconciliation.markdownPath)} type="button">打开对账说明文件</button>
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
                <strong>{hasImportedMetrics ? '当前范围已经有入库指标' : hasRealFiles ? '导入已下载表格' : '先获取真实报表'}</strong>
                <p>
                  {hasImportedMetrics
                    ? `当前 DB 已有 ${importedRows} 行指标；如果重新下载过表格，可再次导入刷新。`
                    : hasRealFiles
                      ? '把当前范围下载目录中的真实报表解析并写入 SQLite，每天的广告数据会沉淀到数据库。'
                      : '当前没有真实报表，不能导入。请先到数据采集页下载或重新创建报表。'}
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

        {hasImportedMetrics && (
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
              <code>{fileAudit?.downloadDir ? compactPath(fileAudit.downloadDir) : '暂无'}</code>
              <button className="secondary-button compact-button" disabled={!fileAudit?.downloadDir} onClick={() => openPath(fileAudit?.downloadDir)} type="button">打开</button>
            </div>
            <div className="path-row">
              <span>采集清单</span>
              <code>{fileAudit?.manifestPath ? compactPath(fileAudit.manifestPath) : '暂无'}</code>
              <button className="secondary-button compact-button" disabled={!fileAudit?.manifestPath} onClick={() => openPath(fileAudit?.manifestPath)} type="button">打开</button>
            </div>
            </div>
            <p className="warning-line">采集清单和审计证据只用于追溯流程；广告量化只读取上方真实报表和 SQLite 指标。</p>
            {pathNotice && <p className={pathNotice.startsWith('打开失败') ? 'blocked-line' : 'muted-line'}>{pathNotice}</p>}
          </Panel>
        </ProgressiveDetails>
      </div>
    </div>
  );
}
