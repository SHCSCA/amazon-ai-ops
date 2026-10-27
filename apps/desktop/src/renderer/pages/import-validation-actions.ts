import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type ImportMode } from './import-validation-contracts';

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
