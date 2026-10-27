import React from 'react';
import { type LingxingCollectionJobSnapshot, type StoreCollectionScheduleProjection, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';

export type CollectionActionMode = 'download-existing' | 'recreate-selected' | 'recreate-full' | 'import';

export type DownloadCollectionActionMode = Exclude<CollectionActionMode, 'import'>;

export type RunningCollectionActionMode = CollectionActionMode | 'verify-page';

export type CollectionFeedbackActionGroup = 'repair' | 'refresh-ready';

export interface CollectionActionGuide {
  title: string;
  whenToUse: string;
  taskEffect: string;
  result: string;
}

export interface LastActionResult {
  title: string;
  tone: 'default' | 'success' | 'warning' | 'blocked';
  mode: CollectionActionMode;
  batchIds: string[];
  downloadedCount: number;
  actionDownloadedFiles: Array<{
    label: string;
    fileName: string;
    fileExtension: string;
    artifactId: string;
    fileSizeBytes: number;
  }>;
  failedCount: number;
  parsedFiles: number;
  insertedRows: number;
  currentImportedRows: number;
  actionImportState?: NonNullable<LingxingCollectionJobSnapshot['importState']> | 'mixed';
  actionReportTypeCount?: number;
  productionReady?: boolean;
  downloadArtifactId?: string;
  manifestArtifactId?: string;
  nextStep: string;
  failedFiles: Array<{ label: string; reason: string }>;
}

export interface ActionProgressStep {
  label: string;
  description: string;
  status: 'ready' | 'pending' | 'blocked';
}

export interface CollectionMonitorState {
  tone: 'pending' | 'ready' | 'blocked';
  statusLabel: string;
  title: string;
  headline: string;
  detail: string;
  previewTitle: string;
  previewDetail: string;
  canClose: boolean;
}

export interface CollectionProgressPresentation {
  tone: 'pending' | 'ready' | 'blocked';
  statusLabel: string;
  title: string;
  detail: string;
  completedCount: number;
  totalCount: number;
  manualReconciliation: boolean;
}

export type CollectionJobWorkspaceAction = 'cancel' | 'resume' | 'supplement-import' | 'manual-reconciliation' | 'none';

export interface CollectionImportPresentation {
  state: NonNullable<LingxingCollectionJobSnapshot['importState']> | 'legacy';
  label: string;
  detail: string;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
  productionComplete: boolean;
  canSupplement: boolean;
}

export interface CollectionJobWorkspaceRow {
  job: LingxingCollectionJobSnapshot;
  canary: boolean;
  action: CollectionJobWorkspaceAction;
  statusLabel: string;
  statusTone: 'ready' | 'pending' | 'blocked' | 'warning';
  progressLabel: string;
  progressDetail: string;
  blockerText: string;
  manualReconciliation: boolean;
  safeRemainderAvailable: boolean;
  import: CollectionImportPresentation;
}

export interface CollectionJobLineagePresentation {
  label: string;
  detail: string;
  tone: 'ready' | 'warning' | 'blocked';
}

export type CollectionScheduleApi = {
  getStoreCollectionSchedule?: (context: StoreContextEnvelope) => Promise<StoreCollectionScheduleProjection>;
};

export interface DataCollectionTaskState {
  title: string;
  detail: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  isComplete: boolean;
}

export type CollectionDownloadApi = {
  diagnoseLingxingDownloadCenter?: (dateRange: CollectionDateRange) => Promise<any>;
  downloadExistingLingxingReports?: (dateRange: CollectionDateRange, reportTypes: string[]) => Promise<any>;
  collectLingxingReports?: (dateRange: CollectionDateRange) => Promise<any>;
  retryLingxingReport?: (dateRange: CollectionDateRange, reportType: string) => Promise<any>;
};

export type CollectionDateRange = {
  start: string;
  end: string;
  requestId?: string;
  storeContext?: StoreContextEnvelope;
  storeName?: string;
  marketplaceCode?: string;
};

export type AuthoritativeCollectionDateRange = CollectionDateRange & {
  requestId: string;
  storeContext: StoreContextEnvelope;
};
