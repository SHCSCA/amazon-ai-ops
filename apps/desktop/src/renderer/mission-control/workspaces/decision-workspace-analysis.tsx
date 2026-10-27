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
import { localizeMatchType } from '@amazon-ai-ops/business-presenters';
import { type AnalysisProposalWithOptionalMatchType, type AnalysisProposalBusinessRow } from './decision-workspace-contracts';
import { proposalHasVerifiedAdsAuthority } from './decision-workspace-authority';

export function analysisProposalMatchTypeLabel(value: unknown): string {
  const label = localizeMatchType(value);
  if (label === '不适用' || label === '其他投放方式') return '待对象核验';
  return label;
}

export function normalizedProposalMatchType(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[_\s]+/g, '-');
}

export function analysisProposalBusinessRow(
  proposal: AnalysisProposalWithOptionalMatchType,
): AnalysisProposalBusinessRow {
  const explicit = normalizedProposalMatchType(proposal.matchType);
  const suffix = proposal.entityName.match(/(?:\s*[·.\/()\-]\s*|\s+)(exact|phrase|broad|auto|close[-_ ]match|loose[-_ ]match|substitutes|complements)\s*\)?$/i);
  const inferred = normalizedProposalMatchType(suffix?.[1]);
  const matchType = explicit || inferred;
  const objectName = suffix
    ? proposal.entityName.slice(0, suffix.index).trim()
    : proposal.entityName.trim();
  const verified = proposalHasVerifiedAdsAuthority(proposal);
  const eligible = proposal.authorization.human.eligible || proposal.authorization.policy.eligible;
  return {
    campaign: proposal.campaignName,
    adGroup: proposal.adGroupName,
    entityLevel: proposal.entityType === 'keyword' ? '关键词' : '投放对象',
    objectName: objectName || '未命名对象',
    matchType: analysisProposalMatchTypeLabel(matchType),
    action: proposal.actionType === 'set_keyword_bid' ? '调整关键词竞价' : '受控动作',
    change: `${proposal.changePct > 0 ? '+' : ''}${proposal.changePct.toFixed(1)}%`,
    currentValue: `$${(proposal.currentBidCents / 100).toFixed(2)}`,
    proposedValue: `$${(proposal.proposedBidCents / 100).toFixed(2)}`,
    basis: proposal.explanation,
    status: !verified ? '对象待核验' : eligible ? '可审批' : '已阻断',
  };
}

export function AnalysisProposalBusinessTable({
  busy,
  onSelect,
  proposals,
  selectedProposalId,
}: {
  busy: boolean;
  onSelect?: (proposal: AnalysisProposalSnapshotRecord) => void;
  proposals: readonly AnalysisProposalSnapshotRecord[];
  selectedProposalId?: string;
}): React.ReactElement {
  const groups = new Map<string, {
    adGroup: string;
    campaign: string;
    proposals: AnalysisProposalSnapshotRecord[];
  }>();
  for (const proposal of proposals) {
    const key = `${proposal.campaignName}\u0000${proposal.adGroupName}`;
    const group = groups.get(key) ?? {
      campaign: proposal.campaignName,
      adGroup: proposal.adGroupName,
      proposals: [],
    };
    group.proposals.push(proposal);
    groups.set(key, group);
  }
  return <div className="decision-domain-analysis-table-wrap">
    <table aria-label="分析建议业务表" className="decision-domain-analysis-table">
      <thead><tr>
        <th>广告活动</th><th>广告组</th><th>对象层级</th><th>具体对象</th><th>匹配方式</th>
        <th>建议动作</th><th>变更</th><th>当前值</th><th>建议值</th><th>主要依据</th><th>状态</th><th>操作</th>
      </tr></thead>
      {[...groups.entries()].map(([key, group]) => <tbody data-ad-group={group.adGroup} data-campaign={group.campaign} key={key}>
        <tr className="decision-domain-analysis-group"><th colSpan={12}>广告活动：{group.campaign} · 广告组：{group.adGroup}</th></tr>
        {group.proposals.map((proposal) => {
          const row = analysisProposalBusinessRow(proposal);
          return <tr aria-selected={proposal.id === selectedProposalId || undefined} key={proposal.id}>
            <td>{row.campaign}</td><td>{row.adGroup}</td><td>{row.entityLevel}</td><td><strong>{row.objectName}</strong></td>
            <td>{row.matchType}</td><td>{row.action}</td><td>{row.change}</td><td>{row.currentValue}</td><td>{row.proposedValue}</td>
            <td className="decision-domain-analysis-basis">{row.basis}</td><td><span data-status={row.status}>{row.status}</span></td>
            <td>{onSelect ? <WorkspaceActionButton className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => onSelect(proposal)} type="button" disabledReason={busy ? '当前决策操作进行中，请稍候。' : '本表仅供查看，请在建议工作台选择需要处理的决策。'}>查看详情</WorkspaceActionButton> : '—'}
              <details><summary>诊断详情</summary><code>{proposal.id}</code><code>{proposal.adEntityRevision ?? '—'}</code></details>
            </td>
          </tr>;
        })}
      </tbody>)}
    </table>
  </div>;
}
