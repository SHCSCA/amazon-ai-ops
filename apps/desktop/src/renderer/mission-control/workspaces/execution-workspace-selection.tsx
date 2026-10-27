import { isTerminalMissionGrantEventType } from '@amazon-ai-ops/shared-types';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AD_EXECUTION_RECONCILIATION_COPY,
  missionControlContextKey,
  type AdExecutionBatchProjection,
  type AdExecutionEvidenceSlot,
  type AdExecutionProgressEvent,
  type AdExecutionStatus,
  type AnalysisProposalSnapshotRecord,
  type DecisionRecord,
  type MissionAnalysisProjection,
  type MissionGrantEventRecord,
  type MissionGrantRecord,
  type MissionRecord,
  type MissionControlCapabilityProjection,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  readMissionDomainWindowApi,
  readDecisionDomainWindowApi,
  type DecisionDomainRendererApi,
  type MissionDomainRendererApi,
} from './mission-domain-window-api';
import {
  assertAnalysisProjectionBelongsToContext,
  readAnalysisAuthorityWindowApi,
  type AnalysisAuthorityRendererApi,
} from './analysis-authority-window-api';
import { type ExecutionSelectionAuthorityApi, type ExecutionGrantSelection } from './execution-workspace-contracts';

export const REQUIRED_EXECUTION_EVIDENCE = [
  'page_identity',
  'before_screenshot',
  'after_screenshot',
  'reload_screenshot',
  'readback_value',
] as const;

export function readExecutionSelectionAuthorityApi(): ExecutionSelectionAuthorityApi | null {
  const missions = readMissionDomainWindowApi();
  const decisions = readDecisionDomainWindowApi();
  const analysis = readAnalysisAuthorityWindowApi();
  if (!missions || !decisions || !analysis) return null;
  return createExecutionSelectionAuthorityApi(missions, decisions, analysis);
}

export function createExecutionSelectionAuthorityApi(
  missions: Pick<MissionDomainRendererApi, 'listMissions'>,
  decisions: Pick<DecisionDomainRendererApi, 'listDecisions' | 'listHumanGrants' | 'listHumanGrantEvents'>,
  analysis: Pick<AnalysisAuthorityRendererApi, 'getMissionProjection'>,
): ExecutionSelectionAuthorityApi {
  return Object.freeze({
    listMissions: (context: StoreContextEnvelope) => missions.listMissions(context, { includeArchived: true }),
    listDecisions: (context: StoreContextEnvelope, missionId: string) => decisions.listDecisions(context, { missionId }),
    listGrants: (context: StoreContextEnvelope, missionId: string) => decisions.listHumanGrants(context, missionId),
    listGrantEvents: (context: StoreContextEnvelope, missionId: string) => decisions.listHumanGrantEvents(context, missionId),
    getMissionProjection: (context: StoreContextEnvelope, missionId: string) => analysis.getMissionProjection(context, missionId),
  });
}

export function selectableExecutionMissions(
  context: StoreContextEnvelope,
  missions: readonly MissionRecord[],
): MissionRecord[] {
  return executionMissionsForContext(context, missions).filter((mission) => mission.status === 'active');
}

export function executionMissionsForContext(
  context: StoreContextEnvelope,
  missions: readonly MissionRecord[],
): MissionRecord[] {
  missionControlContextKey(context);
  return missions.filter((mission) => (
    String(mission.storeId) === String(context.storeId)
    && mission.marketplace === 'US'
    && mission.currency === 'USD'
  ));
}

export function buildExecutableGrantSelections(input: {
  context: StoreContextEnvelope;
  mission: MissionRecord;
  grants: readonly MissionGrantRecord[];
  events: readonly MissionGrantEventRecord[];
  decisions: readonly DecisionRecord[];
  projection: MissionAnalysisProjection;
  now: string;
}): ExecutionGrantSelection[] {
  const { context, mission, grants, events, decisions, projection } = input;
  missionControlContextKey(context);
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new Error('执行选择器需要合法的当前时间。');
  if (String(mission.storeId) !== String(context.storeId)
    || mission.marketplace !== 'US'
    || mission.currency !== 'USD'
    || mission.status !== 'active') return [];

  const decisionById = new Map(decisions
    .filter((decision) => String(decision.storeId) === String(context.storeId)
      && decision.missionId === mission.id
      && decision.status === 'approved'
      && decision.actionType === 'set_keyword_bid')
    .map((decision) => [decision.id, decision]));
  const decisionIdByProposalId = new Map(projection.decisionLinks
    .filter((link) => String(link.storeId) === String(context.storeId))
    .map((link) => [link.proposalId, link.decisionId]));
  const terminalGrantIds = new Set(events
    .filter((event) => String(event.storeId) === String(context.storeId)
      && isTerminalMissionGrantEventType(event.eventType))
    .map((event) => event.grantId));

  return grants.flatMap((grant): ExecutionGrantSelection[] => {
    const grantIsLive = String(grant.storeId) === String(context.storeId)
      && grant.marketplace === 'US'
      && grant.currency === 'USD'
      && grant.missionId === mission.id
      && grant.missionRevision === mission.revision
      && grant.createdSessionGeneration === context.sessionGeneration
      && Date.parse(grant.expiresAt) > now
      && !terminalGrantIds.has(grant.id)
      && grant.allowedActionTypes.includes('set_keyword_bid')
      && grant.maxChangePct > 0
      && grant.maxChangePct <= 10
      && grant.allowedAdEntityIds.length > 0
      && grant.allowedAdEntityIds.length <= 10
      && grant.decisionIds.length > 0
      && grant.decisionIds.length <= 10
      && grant.decisionIds.every((decisionId) => decisionById.has(decisionId))
      && REQUIRED_EXECUTION_EVIDENCE.every((required) => grant.requiredEvidence.includes(required));
    if (!grantIsLive) return [];

    const entities = projection.proposals.filter((proposal) => {
      const decisionId = decisionIdByProposalId.get(proposal.id);
      const decision = decisionId ? decisionById.get(decisionId) : undefined;
      return String(proposal.storeId) === String(context.storeId)
        && proposal.marketplace === 'US'
        && proposal.currency === 'USD'
        && proposal.missionId === mission.id
        && proposal.missionRevision === grant.missionRevision
        && proposal.actionRevision === grant.actionRevision
        && proposal.policyVersionId === grant.policyVersionId
        && proposal.policyRevision === grant.policyRevision
        && proposal.actionType === 'set_keyword_bid'
        && proposal.entityType === 'keyword'
        && Boolean(proposal.adEntityId)
        && grant.allowedAdEntityIds.includes(proposal.adEntityId!)
        && Boolean(decisionId && grant.decisionIds.includes(decisionId))
        && decision?.adEntityId === proposal.adEntityId
        && Date.parse(proposal.validUntil) > now
        && proposal.proposedBidCents < proposal.currentBidCents
        && proposal.changePct < 0
        && Math.abs(proposal.changePct) <= Math.min(10, grant.maxChangePct);
    });
    const eligibleEntityIds = new Set(entities.map((proposal) => proposal.adEntityId));
    const eligibleDecisionIds = new Set(entities.map((proposal) => decisionIdByProposalId.get(proposal.id)));
    if (entities.length > 10
      || entities.length !== grant.allowedAdEntityIds.length
      || eligibleEntityIds.size !== grant.allowedAdEntityIds.length
      || eligibleDecisionIds.size !== grant.decisionIds.length
      || !grant.allowedAdEntityIds.every((entityId) => eligibleEntityIds.has(entityId))
      || !grant.decisionIds.every((decisionId) => eligibleDecisionIds.has(decisionId))) return [];
    return [{ grant, entities }];
  }).sort((left, right) => right.grant.issuedAt.localeCompare(left.grant.issuedAt));
}
