import React from 'react';
import type { RecommendationView } from '../types';
import { buildApprovalStampFeedback } from './approval-page';
import type { DecisionsWorkspaceSubview } from './decisions-workspace-model';
import {
  dispatchDecisionsSubview,
  nextDecisionsTab,
  stampTargetName,
} from "./decisions-presentation";
import {
  createDecisionsReviewFormState,
} from "./decisions-review-forms";
import {
  type DecisionsPageActionContext,
} from "./decisions-ports";

export function requestSubviewDecisionsPageAction(this: DecisionsPageActionContext,
  nextSubview: DecisionsWorkspaceSubview,
  options: { allowLocked?: boolean } = {}): void {
  const {
    interactionLocked,
    setSubview,
    setSelectedId,
    setApproverName,
    setApprovalNote,
    setReviewForm,
    setDecisionFeedback,
    setPageMessage,
    setSelectedRecommendationIds,
  } = this;

    if (interactionLocked && !options.allowLocked) return;
    setSubview(nextSubview);
    setSelectedId(null);
    setApproverName('');
    setApprovalNote('');
    setReviewForm(createDecisionsReviewFormState());
    setDecisionFeedback(null);
    setPageMessage(null);
    setSelectedRecommendationIds(new Set());
    dispatchDecisionsSubview(nextSubview);
  }

export function handleTabKeyDownDecisionsPageAction(this: DecisionsPageActionContext,
  event: React.KeyboardEvent<HTMLButtonElement>,
  currentSubview: DecisionsWorkspaceSubview): void {
  const {
    interactionLocked,
    requestSubview,
    tabRefs,
  } = this;

    if (interactionLocked) return;
    const nextSubview = nextDecisionsTab(currentSubview, event.key);
    if (!nextSubview) return;
    event.preventDefault();
    requestSubview(nextSubview);
    tabRefs.current[nextSubview]?.focus();
  }

export function closeInspectorDecisionsPageAction(this: DecisionsPageActionContext): void {
  const {
    interactionLocked,
    setSelectedId,
    setDecisionFeedback,
    setPageMessage,
    setApproverName,
    setApprovalNote,
    setReviewForm,
  } = this;

    if (interactionLocked) return;
    setSelectedId(null);
    setDecisionFeedback(null);
    setPageMessage(null);
    setApproverName('');
    setApprovalNote('');
    setReviewForm(createDecisionsReviewFormState());
  }

export function openDecisionInspectorDecisionsPageAction(this: DecisionsPageActionContext,
  row: RecommendationView): void {
  const {
    interactionLocked,
    setSelectedId,
    setApproverName,
    setApprovalNote,
    setReviewForm,
    setDecisionFeedback,
    setPageMessage,
  } = this;

    if (interactionLocked) return;
    setSelectedId(row.id);
    setApproverName('');
    setApprovalNote('');
    setReviewForm(createDecisionsReviewFormState(row));
    setDecisionFeedback(null);
    setPageMessage(null);
  }

export function setBlockedFeedbackDecisionsPageAction(this: DecisionsPageActionContext,
  row: RecommendationView,
  message: string): void {
  const {
    setDecisionFeedback,
    setPageMessage,
  } = this;

    setDecisionFeedback(buildApprovalStampFeedback({
      state: 'blocked',
      recommendationId: row.id,
      targetName: stampTargetName(row),
      message,
    }));
    setPageMessage(message);
  }
