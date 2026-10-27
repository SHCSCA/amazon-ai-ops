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
  assertExecutionProjectionBelongsToContext,
  createPreviewExecutionAuthorityApi,
  readExecutionAuthorityWindowApi,
  type ExecutionAuthorityRendererApi,
} from './execution-authority-window-api';

export interface ExecutionSelectionAuthorityApi {
  listMissions(context: StoreContextEnvelope): Promise<readonly MissionRecord[]>;
  listDecisions(context: StoreContextEnvelope, missionId: string): Promise<readonly DecisionRecord[]>;
  listGrants(context: StoreContextEnvelope, missionId: string): Promise<readonly MissionGrantRecord[]>;
  listGrantEvents(context: StoreContextEnvelope, missionId: string): Promise<readonly MissionGrantEventRecord[]>;
  getMissionProjection(context: StoreContextEnvelope, missionId: string): Promise<MissionAnalysisProjection>;
}

export type ExecutionWorkspaceProps = {
  apiOverride?: ExecutionAuthorityRendererApi;
  blockedReason: string;
  capabilities?: readonly MissionControlCapabilityProjection[];
  onInspectBoundary?: () => void;
  previewEnabled: boolean;
  selectionApiOverride?: ExecutionSelectionAuthorityApi;
  storeContext: StoreContextEnvelope | null;
};

export interface ExecutionGrantSelection {
  grant: MissionGrantRecord;
  entities: readonly AnalysisProposalSnapshotRecord[];
}

export type BrowserSessionState = 'unchecked' | 'resolving' | 'ready' | 'blocked';

export type LoadPhase = 'loading' | 'ready' | 'blocked' | 'error';

export type ExecutionDetailTab = 'action' | 'compare' | 'readback' | 'evidence' | 'experiment';

export type ExecutionBrowserTab = 'home' | 'ads' | 'search';

export type ExecutionMutationTicket = Readonly<{
  authorityKey: string;
  sequence: number;
}>;
