import { WorkspaceActionButton } from '../../components/workspace/action-feedback';
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
import { type RecommendationTargetBindingRendererApi } from './decision-workspace-contracts';

export function readRecommendationTargetBindingWindowApi(
  target: unknown = typeof window === 'undefined' ? undefined : window,
): RecommendationTargetBindingRendererApi | null {
  const candidate = target as Partial<RecommendationTargetBindingRendererApi> | null;
  if (!candidate
    || typeof candidate.getOperationScope !== 'function'
    || typeof candidate.bindRecommendationWritableTarget !== 'function'
    || typeof candidate.executionAuthority?.discoverRecommendationTarget !== 'function') return null;
  return candidate as RecommendationTargetBindingRendererApi;
}

export function proposalHasVerifiedAdsAuthority(proposal: AnalysisProposalSnapshotRecord): boolean {
  return Boolean(
    proposal.adEntityAuthorityId
    && proposal.adEntityId
    && Number.isInteger(proposal.adEntityRevision)
    && Number(proposal.adEntityRevision) > 0,
  );
}

export function proposalIsSafeTargetVerificationCandidate(
  proposal: AnalysisProposalSnapshotRecord,
): boolean {
  const current = Number(proposal.currentBidCents);
  const proposed = Number(proposal.proposedBidCents);
  if (proposal.actionType !== 'set_keyword_bid'
    || proposal.entityType !== 'keyword'
    || !Number.isInteger(current)
    || !Number.isInteger(proposed)
    || current <= 0
    || proposed <= 0
    || proposed >= current) return false;
  return ((current - proposed) / current) * 100 <= 10.000001;
}

export function findSafeTargetVerificationProposal(
  proposals: readonly AnalysisProposalSnapshotRecord[],
  authorityProposal: AnalysisProposalSnapshotRecord,
): AnalysisProposalSnapshotRecord | undefined {
  const normalized = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLowerCase();
  return proposals.find((proposal) => (
    proposal.legacyRecommendationId === authorityProposal.legacyRecommendationId
    && normalized(proposal.campaignName) === normalized(authorityProposal.campaignName)
    && normalized(proposal.adGroupName) === normalized(authorityProposal.adGroupName)
    && normalized(proposal.entityName) === normalized(authorityProposal.entityName)
    && proposal.currentBidCents === authorityProposal.currentBidCents
    && proposalIsSafeTargetVerificationCandidate(proposal)
  ));
}

export function buildProposalTargetVerificationPlan(
  context: StoreContextEnvelope,
  missionId: string,
  proposal: AnalysisProposalSnapshotRecord,
  evidencePackages: readonly AnalysisEvidencePackageRecord[],
  operationScope: Record<string, unknown>,
  authoritativeRecommendationAsin: string,
): {
  analysisRequest: RunMissionAnalysisRequest;
  bindingScope: BindRecommendationWritableTargetRequest['scope'];
} {
  assertMissionAuthorityContext(context);
  const evidencePackage = evidencePackages.find((item) => (
    String(item.storeId) === String(context.storeId)
    && item.missionId === missionId
    && item.id === proposal.evidencePackageId
    && item.packageHash === proposal.evidencePackageHash
    && item.dataBatchId === proposal.dataBatchId
  ));
  if (!evidencePackage) {
    throw new Error('当前建议缺少对应的数据证据范围；请刷新当前店铺并重新运行分析后，再核验 Ads 对象。');
  }
  const storeName = String(operationScope.storeName ?? '').trim();
  if (!storeName) {
    throw new Error('当前店铺名称尚未加载；请刷新当前店铺后，再核验 Ads 对象。');
  }
  let recommendationAsin: string;
  try {
    recommendationAsin = canonicalizeAmazonAsin(authoritativeRecommendationAsin);
  } catch {
    throw new Error('当前权威建议缺少 ASIN；为避免绑定到其他产品，Ads 对象核验已阻断。');
  }
  let evidenceAsin = '';
  if (evidencePackage.asin) {
    try {
      evidenceAsin = canonicalizeAmazonAsin(evidencePackage.asin);
    } catch {
      throw new Error('当前证据包 ASIN 无效；请重新采集并运行分析后再核验 Ads 对象。');
    }
  }
  if (evidenceAsin && evidenceAsin !== recommendationAsin) {
    throw new Error('当前权威建议 ASIN 与证据包不一致；请重新运行分析后再核验 Ads 对象。');
  }
  return {
    analysisRequest: { context, missionId },
    bindingScope: {
      dateFrom: evidencePackage.dateFrom,
      dateTo: evidencePackage.dateTo,
      storeName,
      marketplaceCode: evidencePackage.marketplace,
      asin: recommendationAsin,
      batchId: evidencePackage.dataBatchId,
    },
  };
}

export function AnalysisProposalAuthorityStatus({
  busy,
  onVerify,
  proposal,
}: {
  busy: boolean;
  onVerify?: () => void;
  proposal: AnalysisProposalSnapshotRecord;
}) {
  if (proposalHasVerifiedAdsAuthority(proposal)) {
    return <small className="decision-domain-proposal-authority" data-verified>对象版本已校验</small>;
  }
  return <span className="decision-domain-proposal-authority" data-verified="false">
    <small>Ads 对象待核验</small>
    {onVerify && <WorkspaceActionButton
      className="workspace-button workspace-button--secondary"
      disabled={busy}
      onClick={onVerify}
      type="button" disabledReason={'正在核验当前广告对象，请等待结果。'} busy={busy} busyLabel="核验中…"
    >{busy ? '核验中…' : '核验 Ads 对象'}</WorkspaceActionButton>}
  </span>;
}
