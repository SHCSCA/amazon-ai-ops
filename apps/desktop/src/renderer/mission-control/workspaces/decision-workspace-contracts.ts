import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  canonicalizeAmazonAsin,
  missionControlContextKey,
  type AnalysisEvidencePackageRecord,
  type AnalysisProposalSnapshotRecord,
  type AuthorizeAnalysisProposalBatchRequest,
  type BindRecommendationWritableTargetRequest,
  type BindRecommendationWritableTargetResult,
  type CreateDecisionInput,
  type DecisionHistoryRecord,
  type DecisionRecord,
  type DecisionStatus,
  type MissionControlCapabilityProjection,
  type MissionGrantEventRecord,
  type MissionGrantRecord,
  type MissionAnalysisProjection,
  type RunMissionAnalysisRequest,
  type ReviseDecisionInput,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  assertDecisionBelongsToContext,
  assertMissionAuthorityContext,
  readDecisionDomainWindowApi,
  type DecisionDomainRendererApi,
  type HumanDecisionResolutionInput,
} from './mission-domain-window-api';
import {
  assertAnalysisProjectionBelongsToContext,
  readAnalysisAuthorityWindowApi,
  type AnalysisAuthorityRendererApi,
} from './analysis-authority-window-api';

export type DecisionWorkspaceView = 'decisions/recommendations' | 'decisions/approval' | 'decisions/decided';

export type DecisionsWorkspaceProps = {
  apiOverride?: DecisionDomainRendererApi;
  analysisApiOverride?: AnalysisAuthorityRendererApi;
  blockedReason: string;
  capabilities?: readonly MissionControlCapabilityProjection[];
  onInspectBoundary?: () => void;
  previewMode: boolean;
  storeContext: StoreContextEnvelope | null;
  view: DecisionWorkspaceView;
};

export type DiscoveredRecommendationTarget = {
  recommendationId: number;
  recommendationRevision: number;
  recommendationAsin: string;
  recommendationMatchType: string;
  pageIdentity: {
    adsAccountId: string;
    campaignId: string;
    adGroupId: string;
    keywordId: string;
    bidCents: number;
  };
  writableTarget: BindRecommendationWritableTargetRequest['binding']['writableTarget'];
};

export type RecommendationTargetBindingRendererApi = {
  getOperationScope(context: StoreContextEnvelope): Promise<Record<string, unknown>>;
  executionAuthority: {
    discoverRecommendationTarget(input: {
      context: StoreContextEnvelope;
      recommendationId: number;
    }): Promise<DiscoveredRecommendationTarget>;
  };
  bindRecommendationWritableTarget(
    input: BindRecommendationWritableTargetRequest,
  ): Promise<BindRecommendationWritableTargetResult>;
};

export type AnalysisProposalWithOptionalMatchType = AnalysisProposalSnapshotRecord & { matchType?: string };

export type AnalysisProposalBusinessRow = {
  adGroup: string;
  action: string;
  basis: string;
  campaign: string;
  change: string;
  currentValue: string;
  entityLevel: string;
  matchType: string;
  objectName: string;
  proposedValue: string;
  status: string;
};

export type DecisionDraft = {
  title: string;
  missionId: string;
  dataBatchId: string;
  policyVersionId: string;
  policyRevision: string;
  actionRevision: string;
  rationale: string;
  recommendation: string;
  facts: string;
  alternatives: string;
  expectedEffect: string;
  validUntil: string;
  actionType: string;
  adEntityId: string;
  productId: string;
  currentValue: string;
  recommendedValue: string;
  confidence: string;
  status: Extract<DecisionStatus, 'proposed' | 'needs_approval' | 'blocked'>;
};

export type AnalysisActionBatchOption = {
  id: string;
  proposalCount: number;
  latestCreatedAt: string;
};
