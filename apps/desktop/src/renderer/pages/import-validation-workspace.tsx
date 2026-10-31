import { FamilyObservationPanel } from './family-observation-panel';
import { BusinessDataConfigurationGuard } from '../components/business-data-configuration';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceOperation } from '../components/workspace/use-workspace-operation';
import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import { rendererRuntimeLog } from '../runtime-log';
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
import { type ImportMode, type DataImportSortState, type DataImportTaskState, type DataImportReportRow, type DataImportSortKey } from './import-validation-contracts';
import { dataImportFirstViewportReportFolder, buildDataImportTaskState, buildReportImportStatusDisplay, buildDataImportTableFeedback, buildDataImportFeedback, dataImportFileLabel, reportFileExtension, formatFileSize, shortDataImportHash, readinessStageClass, readinessStageTone, readinessStageLabel, reconciliationSourceLabel, dataImportTableFeedbackClass, dataImportTableRefreshRowClass } from './import-validation-presentation';
import { sortDataImportReportRows, dataImportSortLabel, nextDataImportSort, dataImportTableSortHandler } from './import-validation-sorting';
import { dataImportActionButtonView, dataImportExportButtonView, dataImportOpenArtifactButtonView, dataImportArtifactActionKey, dataImportBusyLabel } from './import-validation-actions';

export function DataImportValidationPage() {
  const { data, error, loading, scope, reload, configurationRequired } = useBusinessDataPipeline();
  const storeAuthority = useMissionControlStoreContext();
  const contextKey = JSON.stringify([storeAuthority.authorityKey, storeAuthority.contextEpoch, storeAuthority.phase, scope]);
  const operation = useWorkspaceOperation(contextKey);
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
  const [actionOrigin, setActionOrigin] = useState('');
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
  const importLocked = Boolean(runningImport || operation.busy);
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
    secondaryActionLabel: reportFolderArtifactId ? '打开报表目录' : '导入本地报表',
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

  useLayoutEffect(() => {
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
    setActionOrigin('');
    const context = storeAuthority.authoritativeContext;
    const authorityKey = storeAuthority.authorityKey;
    if (!context || !authorityKey) return;
    void loadProductionCollectionJobs(context, authorityKey);
  }, [contextKey]);

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
  const currentImportButton = dataImportActionButtonView({ mode: 'current', runningImport: actionOrigin === 'detail-current' ? runningImport : null, hasRealFiles });
  const localImportButton = dataImportActionButtonView({ mode: 'local', runningImport: actionOrigin === 'detail-local' ? runningImport : null, hasRealFiles });
  const overviewLocalButton = dataImportActionButtonView({ mode: 'local', runningImport: actionOrigin === 'overview-local' ? runningImport : null, hasRealFiles });
  const unconfiguredLocalImportButton = dataImportActionButtonView({ mode: 'local', runningImport: actionOrigin === 'task-local' ? runningImport : null, hasRealFiles });
  const unconfiguredLocalImportAuthorityReady = Boolean(storeAuthority.phase === 'ready'
    && storeAuthority.authoritativeContext && storeAuthority.authorityKey
    && storeAuthority.authoritativeContext.marketplace === 'US'
    && storeAuthority.authoritativeContext.currency === 'USD');
  const exportButton = dataImportExportButtonView({ exportingReconciliation: exportingReconciliation && actionOrigin === 'overview-export', hasImportedMetrics });
  const readinessExportButton = dataImportExportButtonView({ exportingReconciliation: exportingReconciliation && actionOrigin === 'readiness-export', hasImportedMetrics });
  function renderOpenArtifactButton(input: {
    actionId: string;
    className?: string;
    disabled?: boolean;
    idleLabel: string;
    messageLabel?: string;
    artifactId?: string;
    disabledReason?: string;
  }) {
    const messageLabel = input.messageLabel || input.idleLabel;
    const view = dataImportOpenArtifactButtonView({
      activeArtifactKey: actionOrigin === input.actionId ? openingArtifactKey : null,
      baseClassName: input.className,
      disabled: input.disabled || operation.busy || !input.artifactId,
      idleLabel: input.idleLabel,
      artifactKey: dataImportArtifactActionKey(messageLabel, input.artifactId),
    });
    return (
      <WorkspaceActionButton disabledReason={operation.busy || runningImport || openingArtifactKey
        ? '当前导入或报表文件操作正在处理，请等待完成后重试。'
        : !input.artifactId ? input.disabledReason || '当前尚无此项文件，请先完成报表采集或本地导入。'
          : '正在核对当前店铺报表任务，请等待完成后再打开文件。'}
        aria-busy={view.ariaBusy}
        className={view.className}
        disabled={(view.disabled) || operation.busy}
        onClick={() => openArtifact(input.artifactId, messageLabel, input.actionId)}
        type="button"
      >
        {view.showSpinner && <span aria-hidden="true" className="button-spinner" />}
        <span>{view.label}</span>
      </WorkspaceActionButton>
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
          actionId: `table-${row.type}`,
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
    const isCurrent = operation.capture();
    if (!isCurrent()) return;
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
      if (!isCurrent() || sequence !== collectionJobsLoadSequenceRef.current || authorityKeyRef.current !== capturedAuthorityKey) return;
      setCollectionJobs(Array.isArray(jobs) ? jobs : []);
    } catch (caught) {
      rendererRuntimeLog.error('import.collection_jobs_failed', { error: caught });
      if (!isCurrent() || sequence !== collectionJobsLoadSequenceRef.current || authorityKeyRef.current !== capturedAuthorityKey) return;
      setCollectionJobs([]);
      setCollectionJobsError(toUserFacingError(caught, '生产采集任务读取失败。'));
    } finally {
      if (isCurrent() && sequence === collectionJobsLoadSequenceRef.current && authorityKeyRef.current === capturedAuthorityKey) {
        setCollectionJobsLoading(false);
      }
    }
  }

  async function openArtifact(artifactId?: string, label = '打开工件', origin = 'task-folder') {
    if (openingArtifactKey) return;
    if (!artifactId) {
      setArtifactNotice('打开操作不可用：当前没有已登记的文件或目录。');
      return;
    }
    const ticket = operation.begin();
    if (!ticket) return;
    const artifactKey = dataImportArtifactActionKey(label, artifactId);
    setActionOrigin(origin);
    setOpeningArtifactKey(artifactKey);
    setArtifactNotice(`${label}打开中...`);
    try {
      const storeContext = storeAuthority.authoritativeContext;
      if (!storeContext) throw new Error('当前店铺权威不可用。');
      const api = (window as any).electronAPI;
      if (typeof api?.openReportArtifact !== 'function') throw new Error('报表打开服务未连接，请重新打开当前应用。');
      await api.openReportArtifact(artifactId, { ...storeContext });
      if (!ticket.isCurrent()) return;
      setArtifactNotice(`${label}已请求打开。`);
    } catch (caught) {
      rendererRuntimeLog.error('import.artifact_open_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setArtifactNotice(`打开失败：${toUserFacingError(caught, '打开工件失败。')}`);
    } finally {
      if (ticket.isCurrent()) setOpeningArtifactKey(null);
      ticket.finish();
    }
  }

  function navigateTo(page: 'ad-quant' | 'data-collection') {
    window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: page }));
  }

  async function exportReconciliation(origin: 'overview-export' | 'readiness-export') {
    const ticket = operation.begin();
    if (!ticket) return;
    setExportingReconciliation(true);
    setActionOrigin(origin);
    setImportError('');
    try {
      const api = (window as any).electronAPI;
      if (typeof api?.exportDataReconciliationArtifacts !== 'function') throw new Error('对账导出服务未连接，请重新打开当前应用。');
      const storeContext = storeAuthority.authoritativeContext;
      if (!storeContext) throw new Error('请先选择当前店铺，再导出数据对账。');
      const result = await api.exportDataReconciliationArtifacts({ ...scope, storeContext: { ...storeContext } });
      if (!ticket.isCurrent()) return;
      if (!result) throw new Error('本次未返回已登记的对账材料，请刷新后重试。');
      setReconciliation(result || null);
      setNotice('数据对账已导出');
    } catch (caught) {
      rendererRuntimeLog.error('import.reconciliation_export_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setImportError(toUserFacingError(caught, '数据对账导出失败。'));
    } finally {
      if (ticket.isCurrent()) setExportingReconciliation(false);
      ticket.finish();
    }
  }

  async function runImport(mode: ImportMode, origin: string) {
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
    const ticket = operation.begin();
    if (!ticket) return;
    setRunningImport(mode);
    setActionOrigin(origin);
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
        if (!ticket.isCurrent()) return;
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
        if (!ticket.isCurrent()) return;
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
      if (!ticket.isCurrent() || authorityKeyRef.current !== capturedAuthorityKey) return;
      window.dispatchEvent(new Event('business-ui:data-updated'));
      reload();
      await loadProductionCollectionJobs(capturedContext, capturedAuthorityKey);
    } catch (caught) {
      rendererRuntimeLog.error('import.report_import_failed', { error: caught });
      if (!ticket.isCurrent() || authorityKeyRef.current !== capturedAuthorityKey) return;
      setImportError(toUserFacingError(caught, '真实报表导入未完成。'));
      setNotice('真实报表导入未完成。');
    } finally {
      if (ticket.isCurrent() && authorityKeyRef.current === capturedAuthorityKey) setRunningImport(null);
      ticket.finish();
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="数据"
        title={PAGE_HEADER_TITLES.dataImportValidation}
        description="只处理真实 Lingxing xlsx/xls/csv 表格入库和口径校验。审计文件、截图、HTML 和采集清单不会被当作广告数据。"
      />
{configurationRequired && <div className="action-row"><WorkspaceActionButton
  disabledReason={operation.busy || runningImport || openingArtifactKey
    ? '当前导入或报表文件操作正在处理，请等待完成后重试。'
    : '请先选择并确认当前美国站 / USD 店铺后再导入本地报表。'}
  aria-busy={unconfiguredLocalImportButton.ariaBusy}
  className={unconfiguredLocalImportButton.className}
  disabled={unconfiguredLocalImportButton.disabled || operation.busy || Boolean(runningImport) || Boolean(openingArtifactKey) || !unconfiguredLocalImportAuthorityReady}
  onClick={() => { void runImport('local', 'task-local'); }}
  type="button"
>
  <span className={unconfiguredLocalImportButton.ariaBusy ? 'button-content' : undefined}>
    {unconfiguredLocalImportButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
    {unconfiguredLocalImportButton.label}
  </span>
</WorkspaceActionButton>{notice && <p role="status">{notice}</p>}{importError && <p role="alert">{importError}</p>}{collectionJobsError && <p role="alert">{collectionJobsError}</p>}</div>}
<FamilyObservationPanel
  contextKey={contextKey}
  fileRevision={JSON.stringify(realFiles.map(file => [file.batchId, file.fileName, file.fileHash, file.status, file.importedRows]))}
  scope={storeAuthority.phase === 'ready' && storeAuthority.authoritativeContext
    ? { storeContext: storeAuthority.authoritativeContext, dateFrom: scope.dateFrom, dateTo: scope.dateTo }
    : null}
/>
<BusinessDataConfigurationGuard configurationRequired={configurationRequired}>


      <TaskBanner
        description={taskState.detail}
        meta={`生产血缘 ${realReportCount}/8 类真实报表 · ${importedRows} 行日级指标`}
        primaryAction={{
          label: taskState.primaryActionLabel,
          busy: false,
          busyLabel: collectionJobsLoading ? '核对中...' : dataImportBusyLabel(runningImport),
          disabled: Boolean(operation.busy || runningImport || collectionJobsLoading),
          disabledReason: collectionJobsLoading ? '正在核对当前店铺采集任务，请等待完成。' : '当前导入或报表文件操作正在处理，请等待完成。',
          onClick: isDataReady
            ? () => navigateTo('ad-quant')
            : () => navigateTo('data-collection'),
        }}
        secondaryActions={[
          {
            label: taskState.secondaryActionLabel,
            busy: reportFolderArtifactId ? actionOrigin === 'task-folder' && Boolean(openingArtifactKey) : actionOrigin === 'task-local' && runningImport === 'local',
            busyLabel: reportFolderArtifactId ? '打开目录中…' : '正在导入本地报表…',
            disabled: Boolean(operation.busy || runningImport || openingArtifactKey),
            disabledReason: '当前导入或报表文件操作正在处理，请等待完成后重试。',
            onClick: reportFolderArtifactId
              ? () => { void openArtifact(reportFolderArtifactId, '打开报表目录'); }
              : () => { void runImport('local', 'task-local'); },
          },
          { label: '回到数据采集', onClick: () => navigateTo('data-collection'), disabled: Boolean(operation.busy || runningImport), disabledReason: '当前导入或报表文件操作正在处理，请等待完成后继续。' },
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
                  actionId: 'overview-folder',
                  disabled: Boolean(runningImport || openingArtifactKey),
                  idleLabel: '打开报表目录',
                  artifactId: reportFolderArtifactId,
                })
              : (
                <WorkspaceActionButton disabledReason="当前导入或报表文件操作正在处理，请等待完成后重试。" aria-busy={overviewLocalButton.ariaBusy} className={overviewLocalButton.className} disabled={(overviewLocalButton.disabled) || operation.busy} onClick={() => runImport('local', 'overview-local')} type="button">
                  <span className={overviewLocalButton.ariaBusy ? 'button-content' : undefined}>
                    {overviewLocalButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                    {overviewLocalButton.label}
                  </span>
                </WorkspaceActionButton>
              )}
            <WorkspaceActionButton disabledReason={operation.busy ? '当前导入或报表文件操作正在处理，请等待完成。' : '当前范围没有可对账的已入库指标，请先导入报表。'} aria-busy={exportButton.ariaBusy} className={exportButton.className} disabled={(exportButton.disabled) || operation.busy} onClick={() => void exportReconciliation('overview-export')} type="button">
              <span className={exportButton.ariaBusy ? 'button-content' : undefined}>
                {exportButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                {exportButton.label}
              </span>
            </WorkspaceActionButton>
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
                {renderOpenArtifactButton({ actionId: 'folder-details', idleLabel: '打开报表目录', artifactId: reportFolderArtifactId })}
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
              {renderOpenArtifactButton({ actionId: 'readiness-folder', disabled: !reportFolderArtifactId, idleLabel: '打开原始表格目录', artifactId: reportFolderArtifactId })}
              <WorkspaceActionButton disabledReason={operation.busy ? '当前导入或报表文件操作正在处理，请等待完成。' : '当前范围没有可对账的已入库指标，请先导入报表。'} aria-busy={readinessExportButton.ariaBusy} className={readinessExportButton.className} disabled={(readinessExportButton.disabled) || operation.busy} onClick={() => void exportReconciliation('readiness-export')} type="button">
                <span className={readinessExportButton.ariaBusy ? 'button-content' : undefined}>
                  {readinessExportButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                  {readinessExportButton.label}
                </span>
              </WorkspaceActionButton>
              <WorkspaceActionButton disabledReason={operation.busy ? '当前导入或报表文件操作正在处理，请等待完成。' : '当前范围尚未完成八类报表与逐类入库核验，请先到报表采集处理来源关系。'} className="secondary-button" disabled={(!isDataReady) || operation.busy} onClick={() => navigateTo('ad-quant')} type="button">查看广告表现</WorkspaceActionButton>
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
                    {renderOpenArtifactButton({ actionId: 'reconciliation-json', className: 'secondary-button compact-button', disabled: !reconciliation.jsonArtifactId, disabledReason: '当前尚无对账数据文件，请先导出对账结果。', idleLabel: '打开对账数据文件', artifactId: reconciliation.jsonArtifactId })}
                  </div>
                  <div className="path-row">
                    <span>对账说明文件</span>
                    <code>{reconciliation.markdownDisplayName || '-'}</code>
                    {renderOpenArtifactButton({ actionId: 'reconciliation-markdown', className: 'secondary-button compact-button', disabled: !reconciliation.markdownArtifactId, disabledReason: '当前尚无对账说明文件，请先导出对账结果。', idleLabel: '打开对账说明文件', artifactId: reconciliation.markdownArtifactId })}
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
                <WorkspaceActionButton disabledReason={operation.busy ? '当前导入或报表文件操作正在处理，请等待完成。' : '当前范围没有已下载原始报表，请先采集或选择本地文件。'} aria-busy={currentImportButton.ariaBusy} className={currentImportButton.className} disabled={(currentImportButton.disabled) || operation.busy} onClick={() => runImport('current', 'detail-current')} type="button">
                  <span className={currentImportButton.ariaBusy ? 'button-content' : undefined}>
                    {currentImportButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                    {currentImportButton.label}
                  </span>
                </WorkspaceActionButton>
                <WorkspaceActionButton disabledReason="当前导入或报表文件操作正在处理，请等待完成后重试。" aria-busy={localImportButton.ariaBusy} className={localImportButton.className} disabled={(localImportButton.disabled) || operation.busy} onClick={() => runImport('local', 'detail-local')} type="button">
                  <span className={localImportButton.ariaBusy ? 'button-content' : undefined}>
                    {localImportButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                    {localImportButton.label}
                  </span>
                </WorkspaceActionButton>
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
              {renderOpenArtifactButton({ actionId: 'locations-folder', className: 'secondary-button compact-button', disabled: !reportFolderArtifactId, idleLabel: '打开', messageLabel: '打开真实广告表格目录', artifactId: reportFolderArtifactId })}
            </div>
            <div className="path-row">
              <span>采集清单</span>
              <code>{lineageManifestArtifactId ? '当前生产任务采集清单已登记' : '暂无匹配生产任务清单'}</code>
              {renderOpenArtifactButton({ actionId: 'locations-manifest', className: 'secondary-button compact-button', disabled: !lineageManifestArtifactId, disabledReason: '当前尚无匹配生产任务的采集清单，请先完成报表采集。', idleLabel: '打开', messageLabel: '打开采集清单', artifactId: lineageManifestArtifactId })}
            </div>
            </div>
            <p className="warning-line">采集清单和审计证据只用于追溯流程；广告表现只读取上方真实报表和 SQLite 指标。</p>
            {artifactNotice && <p className={artifactNotice.startsWith('打开失败') ? 'blocked-line' : 'muted-line'}>{artifactNotice}</p>}
          </Panel>
        </ProgressiveDetails>
      </div>
    
</BusinessDataConfigurationGuard>
</div>
  );
}
