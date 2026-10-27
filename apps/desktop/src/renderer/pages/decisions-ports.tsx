import React from 'react';
import type { PriorityDataTableColumn } from '../components/workspace';
import type {
  OperationScope,
  RecommendationView,
} from '../types';
import type {
  DecisionsFocusHandoff,
  DecisionsWorkspaceSubview,
} from './decisions-workspace-model';
import {
  type DecisionsReviewFormState,
  type DecisionsLoadRequestGuard,
  type DecisionEligibilityContext,
  type DecisionEligibilitySummary,
  type DecisionSubmission,
  type DecisionQueueState,
  type DecisionsPrimaryQueueTask,
} from "./decisions-contracts";
import type { DecisionEvidenceSummary } from '../evidence-display';
import type { DecisionsWorkspaceSubviewDefinition } from './decisions-workspace-model';

export interface DecisionsPageActionContext {
  isOperationCurrent(): boolean;
  interactionLocked: boolean;
  setSubview: React.Dispatch<React.SetStateAction<"recommendations" | "approval" | "decided">>;
  setSelectedId: React.Dispatch<React.SetStateAction<number | null>>;
  setApproverName: React.Dispatch<React.SetStateAction<string>>;
  setApprovalNote: React.Dispatch<React.SetStateAction<string>>;
  setReviewForm: React.Dispatch<React.SetStateAction<DecisionsReviewFormState>>;
  setDecisionFeedback: React.Dispatch<React.SetStateAction<{ label: string; title: string; detail: string; tone: "ready" | "blocked" | "pending"; } | null>>;
  setPageMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedRecommendationIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  requestSubview: (nextSubview: DecisionsWorkspaceSubview, options?: { allowLocked?: boolean; }) => void;
  tabRefs: React.MutableRefObject<Partial<Record<"recommendations" | "approval" | "decided", HTMLButtonElement | null>>>;
  selected: RecommendationView | null;
  mutationLocked: boolean;
  authorityQueryState: { matchesCurrentQuery: boolean; loading: boolean; stale: boolean; mutationLocked: boolean; };
  setBlockedFeedback: (row: RecommendationView, message: string) => void;
  queryKey: string;
  setDiscoveringTarget: React.Dispatch<React.SetStateAction<boolean>>;
  loadRequestGuardRef: React.MutableRefObject<DecisionsLoadRequestGuard>;
  selectedRecommendationIds: Set<string>;
  setHandoffBusy: React.Dispatch<React.SetStateAction<boolean>>;
  loadRows: (options?: { announceWorkflow?: boolean; clearMessage?: boolean; }) => Promise<RecommendationView[] | null>;
  setHandoff: React.Dispatch<React.SetStateAction<DecisionsFocusHandoff | null>>;
  handoffQueryKeyRef: React.MutableRefObject<string | null>;
  eligibilityContext: DecisionEligibilityContext;
  currentBatchId: string | undefined;
  scope: OperationScope;
  recommendationGateIssues: string[];
  setGenerating: React.Dispatch<React.SetStateAction<boolean>>;
  reloadPipeline: () => void;
  targetBindingBlockers: string[];
  setSubmittingTargetBinding: React.Dispatch<React.SetStateAction<boolean>>;
  reviewForm: DecisionsReviewFormState;
  reviewBlockers: string[];
  setSubmittingReview: React.Dispatch<React.SetStateAction<boolean>>;
  focusReturnOverrideRef: React.MutableRefObject<HTMLButtonElement | null>;
  subview: "recommendations" | "approval" | "decided";
  selectedEligibility: DecisionEligibilitySummary | null;
  approverName: string;
  approvalNote: string;
  setSubmittingDecision: React.Dispatch<React.SetStateAction<DecisionSubmission | null>>;
  setQueue: React.Dispatch<React.SetStateAction<DecisionQueueState>>;
}

export interface DecisionsPageViewModel {
  operationBlockedReason: string;
  selected: RecommendationView | null;
  subview: "recommendations" | "approval" | "decided";
  taskTitle: string;
  primaryQueueTask: DecisionsPrimaryQueueTask | null;
  subviewDefinition: DecisionsWorkspaceSubviewDefinition;
  taskTone: "confirmed" | "attention" | "blocked";
  loadedStatus: string;
  primaryTaskAction: { label: string; busy: boolean; busyLabel: string; disabled: boolean; onClick: () => void; } | { actionId: string; label: string; disabled: boolean; disabledReason: string | undefined; onClick: () => void; };
  primaryQueueRow: RecommendationView;
  generationAction: { actionId: string; label: string; busy: boolean; busyLabel: string; disabled: boolean; disabledReason: string | undefined; onClick: () => void; };
  refreshAction: { label: string; busy: boolean; busyLabel: string; disabled: boolean; disabledReason: string; onClick: () => void; };
  interactionLocked: boolean;
  requestSubview: (nextSubview: DecisionsWorkspaceSubview, options?: { allowLocked?: boolean; }) => void;
  handleTabKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, currentSubview: DecisionsWorkspaceSubview) => void;
  tabRefs: React.MutableRefObject<Partial<Record<"recommendations" | "approval" | "decided", HTMLButtonElement | null>>>;
  counts: Record<"recommendations" | "approval" | "decided", number>;
  authorityQueryState: { matchesCurrentQuery: boolean; loading: boolean; stale: boolean; mutationLocked: boolean; };
  queue: DecisionQueueState;
  pipelineError: string | null;
  pageMessage: string | null;
  selectedBatchRows: RecommendationView[];
  batchSelectableRows: RecommendationView[];
  batchHandoffAction: { label: string; busy: boolean; busyLabel: string; disabled: boolean; disabledReason: string | undefined; onClick: () => void; };
  publishedRows: RecommendationView[];
  orderedRows: RecommendationView[];
  transactionLocked: boolean;
  loadRows: (options?: { announceWorkflow?: boolean; clearMessage?: boolean; }) => Promise<RecommendationView[] | null>;
  columns: PriorityDataTableColumn<RecommendationView>[];
  selectedId: number | null;
  openDecisionInspector: (row: RecommendationView) => void;
  selectedEligibility: DecisionEligibilitySummary | null;
  closeInspector: () => void;
  focusReturnOverrideRef: React.MutableRefObject<HTMLButtonElement | null>;
  selectedEvidenceSummary: DecisionEvidenceSummary;
  scope: OperationScope;
  currentBatchId: string | undefined;
  mutationLocked: boolean;
  setReviewForm: React.Dispatch<React.SetStateAction<DecisionsReviewFormState>>;
  reviewForm: DecisionsReviewFormState;
  currentRealReportSourceFiles: string[];
  reviewBlockers: string[];
  decisionFeedback: { label: string; title: string; detail: string; tone: "ready" | "blocked" | "pending"; } | null;
  submittingReview: boolean;
  resolveSelectedReview: () => Promise<void>;
  submittingDecision: DecisionSubmission | null;
  submitDecision: (decision: DecisionSubmission) => Promise<void>;
  discoveringTarget: boolean;
  discoverSelectedWritableTarget: () => Promise<void>;
  targetBindingBlockers: string[];
  submittingTargetBinding: boolean;
  bindSelectedWritableTarget: () => Promise<void>;
  setApproverName: React.Dispatch<React.SetStateAction<string>>;
  approverName: string;
  setApprovalNote: React.Dispatch<React.SetStateAction<string>>;
  approvalNote: string;
}
