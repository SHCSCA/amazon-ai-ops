import React from 'react';
import { type DataReadinessLedger } from '../data-readiness-ledger';
import { type ProductionCollectionReportBinding } from '../lingxing-collection-lineage';
import type { AppRoute, BusinessReportFile } from '../types';
import { type CollectionActionMode, type LastActionResult, type RunningCollectionActionMode, type DataCollectionTaskState, type CollectionActionGuide } from './collection-contracts';

export function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

export function getFileExtension(fileName: string, explicitExtension?: string): string {
  if (explicitExtension) return explicitExtension.toLowerCase();
  const target = fileName;
  const dotIndex = target.lastIndexOf('.');
  return dotIndex >= 0 ? target.slice(dotIndex).toLowerCase() : '-';
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatUpdatedAt(updatedAt?: string): string {
  if (!updatedAt) return '-';
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return updatedAt;
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

export function shortHash(hash?: string): string {
  return hash ? `${hash.slice(0, 12)}...` : '-';
}

export function reportStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    missing: '缺少文件',
    blocked: '阻断',
    partial: '部分完成',
    pending: '待创建',
    creating: '创建中',
    created: '领星任务已创建',
    generating: '生成中',
    ready: '可下载',
    downloading: '下载中',
    downloaded: '已下载待入库',
    imported: '已入库',
    import_failed: '导入失败',
    failed: '失败',
  };
  return labels[status] || status;
}

export function productionReportFileHasImportReceipt(
  file: Pick<BusinessReportFile, 'batchId' | 'importedRows' | 'status'>,
  binding?: Pick<ProductionCollectionReportBinding, 'expectedBatchId' | 'fileBatchId' | 'state'>,
): boolean {
  if (binding) {
    return binding.state === 'imported'
      && Boolean(binding.expectedBatchId)
      && binding.fileBatchId === binding.expectedBatchId
      && file.batchId === binding.expectedBatchId;
  }
  return Number(file.importedRows || 0) > 0
    || /imported|completed|complete|succeeded/i.test(String(file.status || ''));
}

export function collectionStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    ready: '真实报表可用',
    partial: '部分报表可用',
    blocked: '缺少真实报表',
  };
  return labels[status || 'blocked'] || '缺少真实报表';
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

export function actionTitle(mode: CollectionActionMode): string {
  const labels: Record<CollectionActionMode, string> = {
    'download-existing': '下载已创建报表',
    'recreate-selected': '重新创建并下载已选报表',
    'recreate-full': '重新创建、下载并导入全部 8 类报表',
    import: '真实报表导入',
  };
  return labels[mode];
}

export function actionResultTitle(mode: CollectionActionMode, tone: LastActionResult['tone']): string {
  const base = actionTitle(mode);
  if (mode === 'import') return tone === 'success' ? `${base}完成` : `${base}未完成`;
  if (tone === 'warning') {
    if (mode === 'download-existing') return '已创建报表下载完成，自动导入未完成';
    if (mode === 'recreate-selected') return '已选报表下载完成，自动导入未完成';
    if (mode === 'recreate-full') return '全部报表下载完成，自动导入未完成';
  }
  return tone === 'success' ? `${base}完成` : `${base}未完成`;
}

export function actionModeLabel(mode: RunningCollectionActionMode): string {
  const labels: Record<RunningCollectionActionMode, string> = {
    'download-existing': '下载已创建报表',
    'recreate-selected': '重新创建并下载已选报表',
    'recreate-full': '重新创建、下载并导入全部 8 类',
    import: '导入本地/已下载报表',
    'verify-page': '验证下载中心页面',
  };
  return labels[mode];
}

export function dataCollectionFirstViewportReportFolder(input: {
  realReportCount: number;
  realFiles: Array<{ folderArtifactId?: string }>;
  evidenceFolderArtifactId?: string;
  auditDownloadArtifactId?: string;
}): string | undefined {
  if ((Number(input.realReportCount) || 0) <= 0) return undefined;
  return input.realFiles.find((file) => Boolean(file.folderArtifactId))?.folderArtifactId;
}

export function collectionActionButtonLabel(mode: CollectionActionMode): string {
  const labels: Record<CollectionActionMode, string> = {
    'download-existing': '下载已创建报表',
    'recreate-selected': '重新获取已选报表',
    'recreate-full': '重新获取完整 8 类报表',
    import: '导入本地报表',
  };
  return labels[mode];
}

export function collectionActionButtonDetail(mode: CollectionActionMode): string {
  const labels: Record<CollectionActionMode, string> = {
    'download-existing': '只处理已生成的 ready 报表',
    'recreate-selected': '只重建当前勾选报表',
    'recreate-full': '创建、下载并导入完整 8 类',
    import: '选择本地 xlsx/xls/csv',
  };
  return labels[mode];
}

export function collectionActionButtonBusyDetail(mode: CollectionActionMode, selectedCount?: number): string {
  const labels: Record<CollectionActionMode, string> = {
    'download-existing': Number(selectedCount || 0) === 8
      ? '正在下载完整 8 类并等待生产入库'
      : '正在下载已选报表（不写生产指标）',
    'recreate-selected': '正在重新创建并下载已选报表（不写生产指标）',
    'recreate-full': '正在重新创建、下载并导入全部 8 类',
    import: '正在导入本地/已下载报表',
  };
  return labels[mode];
}

export function collectionActionButtonView({
  mode,
  runningAction,
  selectedCount,
}: {
  mode: CollectionActionMode;
  runningAction: RunningCollectionActionMode | null;
  selectedCount: number;
}): {
  label: string;
  detail: string;
  disabled: boolean;
  ariaBusy: boolean;
  className: string;
} {
  const isPrimary = mode === 'recreate-full';
  const isCurrentAction = runningAction === mode;
  const needsSelection = mode === 'download-existing' || mode === 'recreate-selected';
  const disabled = Boolean(runningAction) || (needsSelection && selectedCount === 0);
  return {
    label: isCurrentAction ? '处理中...' : collectionActionButtonLabel(mode),
    detail: isCurrentAction ? collectionActionButtonBusyDetail(mode, selectedCount) : collectionActionButtonDetail(mode),
    disabled,
    ariaBusy: isCurrentAction,
    className: [
      'collection-action-button',
      isPrimary ? 'primary-action' : 'secondary-action',
      isCurrentAction ? 'button-loading collection-action-button-running' : '',
    ].filter(Boolean).join(' '),
  };
}

export function collectionFeedbackActionButtonView({
  idleLabel,
  runningAction,
  targetAction,
  variant,
}: {
  idleLabel: string;
  runningAction: RunningCollectionActionMode | null;
  targetAction: RunningCollectionActionMode;
  variant: 'primary' | 'secondary';
}): {
  label: string;
  disabled: boolean;
  ariaBusy: boolean;
  showSpinner: boolean;
  className: string;
} {
  const isCurrentAction = runningAction === targetAction;
  const baseClassName = variant === 'primary' ? 'primary-button' : 'secondary-button';
  return {
    label: isCurrentAction ? '处理中...' : idleLabel,
    disabled: Boolean(runningAction),
    ariaBusy: isCurrentAction,
    showSpinner: isCurrentAction,
    className: [
      baseClassName,
      isCurrentAction ? 'button-loading' : '',
    ].filter(Boolean).join(' '),
  };
}

export function collectionArtifactActionKey(label: string, artifactId: string): string {
  return `${label}:${String(artifactId || 'missing')}`;
}

export function collectionOpenArtifactButtonView(input: {
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
  const isActive = input.activeArtifactKey === input.artifactKey;
  return {
    label: isActive ? '打开中...' : input.idleLabel,
    disabled: Boolean(input.disabled || input.activeArtifactKey),
    ariaBusy: isActive ? true : undefined,
    className: [input.baseClassName || 'secondary-button', isActive ? 'button-loading' : ''].filter(Boolean).join(' '),
    showSpinner: isActive,
  };
}

export function collectionReportSelectionState(input: {
  selectedCount: number;
  totalCount: number;
  missingCount: number;
  unimportedCount: number;
  loading?: boolean;
}): {
  ariaStatus: string;
  countClassName: string;
  countLabel: string;
  progressPercent: number;
  progressStyle: React.CSSProperties;
} {
  const totalCount = Math.max(0, Number(input.totalCount || 0));
  const selectedCount = Math.min(totalCount, Math.max(0, Number(input.selectedCount || 0)));
  const missingCount = Math.max(0, Number(input.missingCount || 0));
  const unimportedCount = Math.max(0, Number(input.unimportedCount || 0));
  const progressPercent = totalCount > 0 ? Math.round((selectedCount / totalCount) * 100) : 0;
  if (input.loading) {
    return {
      ariaStatus: '正在读取当前范围的 8 类报表状态，返回后会显示真实文件和入库情况。',
      countClassName: 'collection-selection-count',
      countLabel: `读取中 / ${totalCount || 8} 类`,
      progressPercent: 0,
      progressStyle: { '--collection-selection-progress': '0%' } as React.CSSProperties,
    };
  }
  return {
    ariaStatus: selectedCount > 0
      ? `已选择 ${selectedCount} 类报表，下载和重建只会作用于这些勾选项。`
      : `当前未选择报表；可一键选择 ${missingCount} 个缺失报表或 ${unimportedCount} 个待入库报表。`,
    countClassName: selectedCount > 0
      ? 'collection-selection-count collection-selection-count-active'
      : 'collection-selection-count',
    countLabel: `已选 ${selectedCount}/${totalCount} 类`,
    progressPercent,
    progressStyle: { '--collection-selection-progress': `${progressPercent}%` } as React.CSSProperties,
  };
}

export function buildDataCollectionTaskState({
  realReportCount,
  importedRowCount,
  primaryReportFolderArtifactId,
  runningAction,
  readiness,
}: {
  realReportCount: number;
  importedRowCount: number;
  primaryReportFolderArtifactId?: string;
  runningAction: RunningCollectionActionMode | null;
  readiness: Pick<DataReadinessLedger, 'status' | 'canEnterDiagnosis' | 'nextStep'>;
}): DataCollectionTaskState {
  const reportCount = Math.max(0, Math.min(8, Number(realReportCount) || 0));
  const rowCount = Math.max(0, Number(importedRowCount) || 0);
  const isComplete = readiness.canEnterDiagnosis;
  return {
    title: `真实报表 ${reportCount}/8，已导入 ${rowCount} 行`,
    detail: isComplete
      ? '真实报表和日级指标已闭合，可以查看广告表现。'
      : readiness.nextStep === 'import'
        ? '真实报表仍有类型未形成日级指标；逐类入库完成前不能进入正式诊断。'
      : reportCount > 0
        ? '先补齐完整 8 类报表；已有本地表格时可从目录确认或导入。'
        : '当前范围缺少真实报表，先获取完整 8 类或导入本地表格。',
    primaryActionLabel: isComplete
      ? '查看广告表现'
      : readiness.nextStep === 'import'
        ? runningAction === 'import' ? '正在导入已下载表格...' : '导入已下载表格'
      : runningAction === 'verify-page'
        ? '正在验证下载中心页面...'
      : runningAction === 'recreate-full'
        ? '正在重新获取完整 8 类报表...'
        : '重新获取完整 8 类报表',
    secondaryActionLabel: primaryReportFolderArtifactId ? '打开报表目录' : '导入本地报表',
    isComplete,
  };
}

export function collectionActionGuide(mode: CollectionActionMode): CollectionActionGuide {
  const guides: Record<CollectionActionMode, CollectionActionGuide> = {
    'download-existing': {
      title: '下载已创建的已选报表',
      whenToUse: '领星已经生成 ready 行时使用',
      taskEffect: '不会创建新任务',
      result: '本次只下载已选真实文件；只有完整 8 类生产任务闭合后才会自动写入 DB，无新增文件时打开当前真实报表目录确认',
    },
    'recreate-selected': {
      title: '重新创建并下载已选报表',
      whenToUse: '只补当前已选报表时使用',
      taskEffect: '会创建当前勾选报表的新任务',
      result: '生成完成后下载真实报表，部分任务不写生产指标，不会跨批次拼接',
    },
    'recreate-full': {
      title: '重新创建、下载并导入全部 8 类',
      whenToUse: '缺少完整 8 类或需要刷新当前范围全量数据时使用',
      taskEffect: '会创建完整 8 类报表的新任务',
      result: '下载完整广告报表并自动写入 DB 日级广告指标',
    },
    import: {
      title: '导入本地报表',
      whenToUse: '已经手动拿到领星 xlsx/xls/csv 时使用',
      taskEffect: '不访问领星下载中心',
      result: '复制本地文件并写入 DB 日级广告指标',
    },
  };
  return guides[mode];
}
