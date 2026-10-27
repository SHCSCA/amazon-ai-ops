import type { WritableAdEntityType } from '@amazon-ai-ops/shared-types';
import type {
  OperationScope,
  RecommendationView,
} from '../types';
import type { DecisionsWorkspaceSubview } from './decisions-workspace-model';

export type GetRecommendations = (
  filter: Record<string, unknown>,
) => Promise<unknown>;

export type DecisionEligibilityContext = {
  scope: Pick<OperationScope, 'storeName' | 'marketplaceCode'>;
  currentBatchId?: string;
  allowedSourceFiles?: string[];
  stale: boolean;
  locked?: boolean;
};

export type DecisionEligibilitySummary = {
  label: string;
  detail: string;
  tone: 'confirmed' | 'attention' | 'blocked' | 'neutral';
  canApprove: boolean;
  canReject: boolean;
  readOnly: boolean;
  blockers: string[];
};

export type DecisionQueueState = {
  rows: RecommendationView[];
  loading: boolean;
  stale: boolean;
  error: string | null;
  loadedAt: string | null;
  publishedQueryKey: string | null;
};

export type DecisionSubmission = 'approved' | 'rejected';

export type DecisionsLoadRequestGuard = {
  sequence: number;
  queryKey: string;
};

export type DecisionsLoadRequest = {
  sequence: number;
  queryKey: string;
};

export type DecisionsPrimaryQueueTask = {
  rowId: number;
  title: string;
  description: string;
  actionLabel: string;
};

export type DecisionsReviewFormState = {
  reviewedBy: string;
  rationale: string;
  entityType: WritableAdEntityType | '';
  entityId: string;
  sourceFile: string;
  sourceRow: string;
  identitySource: 'ads_ui' | 'ads_api' | '';
  identityProofPath: string;
  verificationNote: string;
};

export type DecisionsWritableTargetFormInput = {
  row: RecommendationView;
  scope: Pick<OperationScope, 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode' | 'asin'>;
  currentBatchId?: string;
  allowedSourceFiles?: string[];
  form: DecisionsReviewFormState;
};

export type DecisionsPageProps = {
  activeSubview: DecisionsWorkspaceSubview;
};
