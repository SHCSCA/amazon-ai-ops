import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Flask,
  NotePencil,
  Pause,
  PencilSimple,
  Play,
  Plus,
  X,
} from '@phosphor-icons/react';
import {
  missionControlContextKey,
  type CausalEventRecord,
  type CreateExperimentInput,
  type ExperimentMetricSnapshotRecord,
  type ExperimentObservationRecord,
  type ExperimentObservationType,
  type ExperimentRecord,
  type ExperimentStatus,
  type MissionControlCapabilityProjection,
  type StoreContextEnvelope,
  type UpdateExperimentInput,
} from '@amazon-ai-ops/shared-types';
import { PageFrame, SummaryStrip, TaskBanner, WorkbenchPanel, WorkspaceState } from '../../components/workspace';
import { selectEntityDeletePolicy } from '../../components/workspace/entity-delete-policy';
import {
  assertCausalEventBelongsToContext,
  assertExperimentBelongsToContext,
  assertMissionAuthorityContext,
  assertMissionBelongsToContext,
  readExperimentDomainWindowApi,
  readMissionDomainWindowApi,
  type AppendExperimentObservationInput,
  type ExperimentDomainRendererApi,
} from './mission-domain-window-api';
import { useOverlayFocusScope } from '../../components/workspace/overlay-focus-scope';


export const PAGE_SIZE = 6;

export const OPERATOR = 'desktop-operator';

export const STATUS_LABELS: Record<ExperimentStatus, string> = {
  draft: '待启动',
  running: '观察中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
};

export const OBSERVATION_LABELS: Record<ExperimentObservationType, string> = {
  baseline: '基线',
  observation: '观察',
  result: '结果',
  correction: '修正',
};

export type ExperimentDraft = {
  missionId: string;
  name: string;
  hypothesis: string;
  primaryMetric: string;
  guardrailMetrics: string;
  guardrailCriteria: string;
  guardrailComparator?: '<' | '<=' | '>' | '>=';
  guardrailThreshold?: string;
  productId: string;
  adEntityId: string;
  baselineJson: string;
  variantJson: string;
  observationStartsOn: string;
  observationEndsOn: string;
  conclusion: string;
};

export type ExperimentEditorState = { record: ExperimentRecord | null; draft: ExperimentDraft };

export type SelectorOption = { value: string; label: string };

export type MissionSelectorOption = SelectorOption & { productId?: string };

export type AdObjectSelectorOption = SelectorOption & { productId?: string };

export type ExperimentMissionOptionSource = { id: string; title: string; status: string; productId?: string };

export type ExperimentProductOptionSource = { id: number | string; asin: string; title?: string; storeId?: string | number };

export type ExperimentAdObjectOptionSource = {
  kind: 'campaign' | 'ad_group' | 'target' | 'search_term';
  entityId?: string;
  resolved?: boolean;
  nonExecutable?: boolean;
  name: string;
  campaignName?: string;
  adGroupName?: string;
  asin?: string;
  storeId?: string | number;
};

export type ExperimentSelectorOptions = {
  missions: MissionSelectorOption[];
  products: SelectorOption[];
  adObjects: AdObjectSelectorOption[];
  loading: boolean;
};

export const PRIMARY_METRIC_OPTIONS: SelectorOption[] = [
  { value: 'ACOS', label: '广告投入产出比（ACOS）' },
  { value: 'CVR', label: '转化率（CVR）' },
  { value: '广告订单', label: '广告订单' },
  { value: '花费', label: '广告花费' },
];

export type ObservationDraft = {
  observationType: ExperimentObservationType;
  title: string;
  observation: string;
  observedAt: string;
  correctsRecordId: string;
};

export type ExperimentsWorkspaceProps = {
  apiOverride?: ExperimentDomainRendererApi;
  blockedReason: string;
  capabilities?: readonly MissionControlCapabilityProjection[];
  onInspectBoundary?: () => void;
  previewMode: boolean;
  storeContext: StoreContextEnvelope | null;
};
