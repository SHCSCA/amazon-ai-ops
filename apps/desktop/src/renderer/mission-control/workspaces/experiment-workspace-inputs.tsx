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
import { PAGE_SIZE, OPERATOR, STATUS_LABELS, OBSERVATION_LABELS, ExperimentDraft, ExperimentEditorState, SelectorOption, MissionSelectorOption, AdObjectSelectorOption, ExperimentMissionOptionSource, ExperimentProductOptionSource, ExperimentAdObjectOptionSource, ExperimentSelectorOptions, PRIMARY_METRIC_OPTIONS, ObservationDraft, ExperimentsWorkspaceProps } from './experiment-workspace-contracts';
import { buildExperimentSelectorOptions, experimentMissionScope, bindExperimentDraftToMission, experimentDraftScopeError, experimentCausalEventsForSelection, message, operatorFacingBlocker, list, prettyJson, capabilityReady, ExperimentStatusTag, preferredExperimentId, experimentEvaluationFeedback, experimentRestoreFeedback, experimentEditAvailability, experimentResumeAvailability, experimentEvaluationErrorMessage } from './experiment-workspace-model';

export function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} 必须是合法 JSON。`);
  }
}

export function plusDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function timestamp(date: string): string {
  return `${date}T07:00:00.000Z`;
}

export function structuredGuardrailDraft(record?: ExperimentRecord | null): Pick<ExperimentDraft, 'guardrailMetrics' | 'guardrailCriteria' | 'guardrailComparator' | 'guardrailThreshold'> {
  const metric = record?.guardrailMetrics[0] ?? '广告订单';
  const criterion = record?.guardrailCriteria[0] ?? '广告订单 < 15%';
  const symbolic = criterion.match(/(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)\s*%?\s*$/);
  const written = criterion.match(/(不低于|不高于|高于|低于)[^\d-]*(-?\d+(?:\.\d+)?)\s*%?\s*$/);
  const comparator = symbolic?.[1]
    ?? (written?.[1] === '不低于' ? '>=' : written?.[1] === '不高于' ? '<=' : written?.[1] === '高于' ? '>' : written?.[1] === '低于' ? '<' : '<');
  const threshold = symbolic?.[2] ?? written?.[2] ?? '15';
  return {
    guardrailMetrics: metric,
    guardrailCriteria: criterion,
    guardrailComparator: comparator as ExperimentDraft['guardrailComparator'],
    guardrailThreshold: threshold,
  };
}

export function buildExperimentDraft(context: StoreContextEnvelope, record?: ExperimentRecord | null): ExperimentDraft {
  return {
    missionId: record?.missionId ?? '',
    name: record?.name ?? '',
    hypothesis: record?.hypothesis ?? '',
    primaryMetric: record?.primaryMetric ?? 'ACOS',
    ...structuredGuardrailDraft(record),
    productId: record?.productId ?? '',
    adEntityId: record?.adEntityId ?? '',
    baselineJson: prettyJson(record?.baseline ?? { bidUsd: 1.2, windowDays: 7 }),
    variantJson: prettyJson(record?.variant ?? { bidUsd: 1.06, onlyVariable: 'keyword_bid' }),
    observationStartsOn: record?.observationStartsAt.slice(0, 10) ?? context.businessDate,
    observationEndsOn: record?.observationEndsAt.slice(0, 10) ?? plusDays(context.businessDate, 7),
    conclusion: record?.conclusion ?? '',
  };
}

export function buildCreateExperimentInput(draft: ExperimentDraft, id: string): CreateExperimentInput {
  const structuredGuardrail = Boolean(draft.guardrailComparator && draft.guardrailThreshold?.trim());
  const guardrailMetrics = structuredGuardrail ? [draft.guardrailMetrics.trim()] : list(draft.guardrailMetrics);
  const guardrailCriteria = structuredGuardrail
    ? [`${draft.guardrailMetrics.trim()} ${draft.guardrailComparator} ${draft.guardrailThreshold!.trim()}%`]
    : list(draft.guardrailCriteria);
  if (!draft.missionId.trim() || !draft.name.trim() || !draft.hypothesis.trim()) {
    throw new Error('请绑定运营任务，并填写实验名称与可证伪假设。');
  }
  if (!draft.primaryMetric.trim() || !guardrailMetrics.length || !guardrailCriteria.length) {
    throw new Error('请填写主指标、守护指标与守护标准。');
  }
  if (!draft.productId.trim()) {
    throw new Error('请选择当前店铺产品；经营实验必须绑定产品。');
  }
  if (!draft.adEntityId.trim()) {
    throw new Error('请选择可稳定回读的广告对象。');
  }
  if (draft.observationStartsOn >= draft.observationEndsOn) {
    throw new Error('观察窗口结束日期必须晚于开始日期。');
  }
  return {
    id,
    missionId: draft.missionId.trim(),
    name: draft.name.trim(),
    hypothesis: draft.hypothesis.trim(),
    primaryMetric: draft.primaryMetric.trim(),
    guardrailMetrics,
    guardrailCriteria,
    productId: draft.productId.trim(),
    adEntityId: draft.adEntityId.trim(),
    baseline: parseJson(draft.baselineJson, '基线'),
    variant: parseJson(draft.variantJson, '实验变量'),
    observationStartsAt: timestamp(draft.observationStartsOn),
    observationEndsAt: timestamp(draft.observationEndsOn),
  };
}

export function buildUpdateExperimentInput(record: ExperimentRecord, draft: ExperimentDraft): UpdateExperimentInput {
  const create = buildCreateExperimentInput(draft, record.id);
  return {
    id: record.id,
    expectedRevision: record.revision,
    actorId: OPERATOR,
    patch: {
      name: create.name,
      hypothesis: create.hypothesis,
      primaryMetric: create.primaryMetric,
      guardrailMetrics: create.guardrailMetrics,
      guardrailCriteria: create.guardrailCriteria,
      productId: create.productId ?? null,
      adEntityId: create.adEntityId ?? null,
      baseline: create.baseline,
      variant: create.variant,
      observationStartsAt: create.observationStartsAt,
      observationEndsAt: create.observationEndsAt,
      conclusion: draft.conclusion.trim() || null,
    },
  };
}

export function buildEvaluateExperimentInput(
  record: Pick<ExperimentRecord, 'id' | 'revision'>,
): { id: string; expectedRevision: number } {
  return { id: record.id, expectedRevision: record.revision };
}
