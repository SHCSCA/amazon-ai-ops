import { type ReadbackAuthority } from './readback-workspace-model';
import type { RecommendationView } from '../types';

export type AiThresholdSuggestions = NonNullable<NonNullable<RecommendationView['evidence']>['aiThresholdSuggestions']>;

export type ReadbackCaptureSlot = 'approval' | 'before' | 'after' | 'readback';

export type ReadbackContractStatus = 'ready' | 'pending' | 'blocked';

export interface ReadbackContractCheck {
  key: 'time-order' | 'value-change' | 'readback-match' | 'lower-bid-direction' | 'evidence-distinct';
  title: string;
  status: ReadbackContractStatus;
  detail: string;
}

export type ReadbackActionKey =
  | 'export-evidence'
  | 'fill-session'
  | 'prepare-session'
  | 'verify-evidence'
  | 'verify-session';

export type ReadbackCopyCommandKey = 'fill' | 'long-fill' | 'prepare' | 'verify';

export interface ReadbackActionButtonInput {
  action: ReadbackActionKey;
  activeAction: ReadbackActionKey | null;
  baseClassName: string;
  busyLabel: string;
  disabled?: boolean;
  label: string;
}

export interface ReadbackActionButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
}

export interface ReadbackCopyCommandButtonInput {
  activeCommand: ReadbackCopyCommandKey | null;
  command: ReadbackCopyCommandKey;
  disabled?: boolean;
  label: string;
}

export interface ReadbackFormState {
  recommendationId: string;
  recommendationRevision: number;
  storeName: string;
  marketplaceCode: string;
  portfolioName: string;
  asin: string;
  campaignName: string;
  adGroupName: string;
  entityType: string;
  entityName: string;
  actionType: string;
  currentValue: string;
  recommendedValue: string;
  sourceBatchId: string;
  sourceMetricDate: string;
  sourceRow: string;
  sourceFiles: string;
  sourceExplanationSource: string;
  sourceAiModel: string;
  decisionAgreement: string;
  decisionSource: string;
  decisionReasons: string[];
  decisionRiskWarnings: string[];
  aiStrategySource: string;
  aiLifecycleStage: string;
  aiStrategySummary: string;
  aiStrategyFallbackReason: string;
  aiActionFallbackReason: string;
  aiMainProblems: string[];
  aiThresholdSuggestions: AiThresholdSuggestions;
  aiStrategyRiskWarnings: string[];
  quantStatus: string;
  quantLifecycleStage: string;
  quantReasons: string[];
  quantThresholds: Record<string, number>;
  quantReviewRequired: boolean;
  operationEventCount: number;
  productContextCount: number;
  productStage: string;
  productTargetAcos: string;
  productTargetTacos: string;
  productTargetNetMargin: string;
  productMinPrice: string;
  approverName: string;
  approvalNote: string;
  approvalArtifactPath: string;
  approvalConfirmedAt: string;
  executedBy: string;
  executionId: string;
  executionExecutedAt: string;
  beforeValue: string;
  beforeCapturedAt: string;
  beforeScreenshotPath: string;
  afterValue: string;
  afterCapturedAt: string;
  afterScreenshotPath: string;
  readbackActualValue: string;
  readbackReadAt: string;
  readbackEvidencePath: string;
  liveBidSourceNote: string;
  riskRationale: string;
  operatorConfirmed: boolean;
  realWriteApproved: boolean;
  allowedByPolicy: boolean;
  executionSuccess: boolean;
  executionVerified: boolean;
  readbackVerified: boolean;
}

export interface ReadbackPageProps {
  authority?: ReadbackAuthority;
  previewScenarioId?: string;
}
