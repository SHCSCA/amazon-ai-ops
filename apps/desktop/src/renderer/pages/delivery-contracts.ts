import type { BusinessEvidenceArtifact, DeliveryReadinessView } from '../types';

export type DeliveryTone = 'ready' | 'pending' | 'blocked' | 'warning';

export interface DeliveryPreviewState {
  detail: string;
  headline: '仅开发预览已走通' | '仅开发预览场景未走通';
  scenarioId: string;
  tone: 'warning';
}

export interface DeliveryItem {
  title: string;
  tone: DeliveryTone;
  summary: string;
  actions: string[];
  evidence?: string[];
}

export interface DataReconciliationExportResult {
  jsonPath?: string;
  markdownPath?: string;
  canonicalSource?: string;
  canonical?: {
    rows?: number;
    spend?: number;
    orders?: number;
    sales?: number;
    clicks?: number;
    impressions?: number;
    currency?: string;
  };
  blockers?: string[];
}

export interface FinalReadinessRefreshResult {
  success?: boolean;
  evidenceManifestPath?: string;
  finalReadinessPath?: string;
  readiness?: DeliveryReadinessView;
}

export interface ReadbackSessionResult {
  sessionDir?: string;
  sourceCandidatePath?: string;
  passEvidencePath?: string;
  checklistPath?: string;
  locatorGuidePath?: string;
  sessionInputPath?: string;
  sessionInputGuidePath?: string;
}

export interface ReadbackSessionCheckResult {
  sessionDir?: string;
  ready?: boolean;
  captureReady?: boolean;
  checks?: Array<{ label?: string; passed?: boolean; details?: string }>;
  issues?: string[];
  unresolvedFields?: string[];
  captureMissingFields?: Array<{ field?: string; label?: string; group?: string }>;
  captureIssues?: string[];
}

export interface ReadbackSessionFillResult {
  sessionDir?: string;
  jsonPath?: string;
  markdownPath?: string;
  status?: string;
  readyForVerifier?: boolean;
  issues?: string[];
}

export interface ReadbackEvidenceVerifyResult {
  status?: string;
  ok?: boolean;
  verified?: boolean;
  ready?: boolean;
  issues?: string[];
  blockers?: string[];
  checks?: Array<{ label?: string; passed?: boolean; details?: string }>;
}

export type DeliveryActionKey =
  | 'create-readback'
  | 'export-bundle'
  | 'export-non-ready'
  | 'export-reconciliation'
  | 'fill-readback-session'
  | 'refresh-final'
  | 'refresh-final-with-readback'
  | 'verify-readback-evidence'
  | 'verify-readback-session';

export interface DeliveryActionButtonInput {
  action: DeliveryActionKey;
  activeAction: DeliveryActionKey | null;
  baseClassName: string;
  busyLabel: string;
  disabled?: boolean;
  idleLabel: string;
}

export interface DeliveryActionButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
  disabledReason?: string;
}

export interface DeliveryOpenPathButtonInput {
  activePathKey: string | null;
  baseClassName?: string;
  busyLabel?: string;
  disabled?: boolean;
  idleLabel: string;
  pathKey: string;
}

export interface DeliveryCopySummaryActionInput {
  copying: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export type DeliveryCollectionArtifact = Pick<BusinessEvidenceArtifact, 'artifactId' | 'displayName' | 'kind' | 'label'>;

export type EvidenceGovernanceFact = {
  label: string;
  value: string;
  tone: DeliveryTone;
};

export type DeliveryOverviewFact = {
  label: string;
  value: string;
};
