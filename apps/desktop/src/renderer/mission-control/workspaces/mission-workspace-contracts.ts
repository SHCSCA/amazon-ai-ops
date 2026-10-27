import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  missionControlContextKey,
  type AnalysisEvidencePackageRecord,
  type AnalysisProposalSnapshotRecord,
  type CausalEventRecord,
  type MissionAnalysisProjection,
  type AppendMissionCheckpointInput,
  type CreateMissionInput,
  type MissionCheckpointRecord,
  type MissionControlCapabilityAction,
  type MissionControlCapabilityProjection,
  type MissionLifecycleStatus,
  type MissionLinkRecord,
  type MissionPhase,
  type MissionPriority,
  type MissionRecord,
  type PolicyRecord,
  type PolicyVersionRecord,
  type StoreContextEnvelope,
  type UpdateMissionInput,
} from '@amazon-ai-ops/shared-types';
import {
  assertMissionBelongsToContext,
  assertMissionAuthorityContext,
  readMissionDomainWindowApi,
  readPolicyDomainWindowApi,
  type MissionDomainRendererApi,
  type MissionLineageProjection,
} from './mission-domain-window-api';
import {
  assertAnalysisProjectionBelongsToContext,
  readAnalysisAuthorityWindowApi,
  type AnalysisAuthorityRendererApi,
} from './analysis-authority-window-api';

export type MissionFlightPlanRow = {
  checkpoints: readonly MissionCheckpointRecord[];
  description: string;
  evidenceCount: number;
  label: string;
  latestCheckpointSourceLabel?: '人工补充' | '系统记录';
  latestCheckpointTitle?: string;
  phase: MissionPhase;
  state: 'done' | 'current' | 'blocked' | 'waiting' | 'draft' | 'paused' | 'archived';
  statusLabel: string;
};

export type MissionDraft = {
  title: string;
  objective: string;
  dataBatchId: string;
  policyVersionId: string;
  productId: string;
  priority: MissionPriority;
  observationStartsOn: string;
  observationEndsOn: string;
  successCriteria: string;
  guardrails: string;
};

export type MissionEditorState = {
  mission: MissionRecord | null;
  draft: MissionDraft;
};

export type MissionChoice = { value: string; label: string };

export type MissionProductOptionSource = { id: number; asin: string; title?: string };

export type MissionDependencies = {
  batches: MissionChoice[];
  policyVersions: MissionChoice[];
  products: MissionChoice[];
  loading: boolean;
};

export type CheckpointDraft = {
  stage: AppendMissionCheckpointInput['stage'];
  title: string;
  status: string;
  evidenceCount: string;
};

export type MissionsWorkspaceProps = {
  apiOverride?: MissionDomainRendererApi;
  analysisApiOverride?: AnalysisAuthorityRendererApi;
  blockedReason: string;
  capabilities?: readonly MissionControlCapabilityProjection[];
  onInspectBoundary?: () => void;
  previewMode: boolean;
  storeContext: StoreContextEnvelope | null;
  view?: 'missions/overview' | 'missions/facts';
};

export type BoundMissionAdsObject = {
  key: string;
  entityName: string;
  campaignName: string;
  adGroupName: string;
  importRunId: string;
  evidencePackageId: string;
  status: '待核验';
};

export type MissionAnalysisRunStatus = 'idle' | 'running' | 'completed' | 'retryable';

export type MissionAnalysisRunView = {
  status: MissionAnalysisRunStatus;
  statusLabel: string;
  phase: MissionPhase;
  phaseLabel: string;
  dataBatchId: string;
  dateFrom: string;
  dateTo: string;
  importRunId: string;
  evidencePackageId: string;
  proposalCount: number;
  failureCodes: string[];
  failureText: string;
};

export type MissionAnalysisRunReceipt = {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  statusLabel: string;
  startedAt: string;
  finishedAt?: string;
  detail: string;
  nextStep: string;
};
