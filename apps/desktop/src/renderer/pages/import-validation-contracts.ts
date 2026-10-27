import React, { useEffect, useMemo, useRef, useState } from 'react';

export type ImportMode = 'current' | 'local';

export type StatusTone = 'ready' | 'pending' | 'blocked' | 'warning';

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

export interface DataImportTaskState {
  title: string;
  detail: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
}
