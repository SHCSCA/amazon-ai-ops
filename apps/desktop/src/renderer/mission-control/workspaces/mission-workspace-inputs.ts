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
  type MissionDraft,
} from './mission-workspace-contracts';
import {
  datePart,
  missionGuardrailLabel,
  asTimestamp,
} from './mission-workspace-analysis';
import {
  plusDays,
  listFromDraft,
  OPERATOR_ACTOR_ID,
} from './mission-workspace-model';

export function missionDraft(context: StoreContextEnvelope, mission?: MissionRecord | null): MissionDraft {
  return {
    title: mission?.title ?? '',
    objective: mission?.objective ?? '',
    dataBatchId: mission?.dataBatchId ?? '',
    policyVersionId: mission?.policyVersionId ?? '',
    productId: mission?.productId ?? '',
    priority: mission?.priority ?? 'P2',
    observationStartsOn: mission ? datePart(mission.observationStartsAt) : context.businessDate,
    observationEndsOn: mission ? datePart(mission.observationEndsAt) : plusDays(context.businessDate, 7),
    successCriteria: mission?.successCriteria.join('；') ?? 'ACOS 改善 ≥ 10%；广告订单下降 < 15%',
    guardrails: mission?.guardrails.map(missionGuardrailLabel).join('；') ?? '单次竞价变化 ≤ 15%；结果无法确认时立即停止并人工对账',
  };
}

export function buildCreateMissionInput(
  context: StoreContextEnvelope,
  draft: MissionDraft,
  id: string,
): CreateMissionInput {
  assertMissionAuthorityContext(context);
  const successCriteria = listFromDraft(draft.successCriteria);
  const guardrails = listFromDraft(draft.guardrails);
  if (!draft.title.trim() || !draft.objective.trim()) throw new Error('请填写运营任务标题与可衡量的经营目标。');
  if (!draft.dataBatchId.trim() || !draft.policyVersionId.trim()) throw new Error('运营任务必须绑定已完成数据批次与已启用策略版本。');
  if (!successCriteria.length || !guardrails.length) throw new Error('请至少填写一条成功标准和一条守护栏。');
  if (draft.observationStartsOn >= draft.observationEndsOn) throw new Error('观察窗口结束日期必须晚于开始日期。');
  if (!draft.productId.trim()) throw new Error('请选择当前店铺已有产品。');
  return {
    id,
    dataBatchId: draft.dataBatchId.trim(),
    policyVersionId: draft.policyVersionId.trim(),
    title: draft.title.trim(),
    objective: draft.objective.trim(),
    priority: draft.priority,
    productId: draft.productId.trim(),
    observationStartsAt: asTimestamp(draft.observationStartsOn),
    observationEndsAt: asTimestamp(draft.observationEndsOn),
    successCriteria,
    guardrails,
    actorId: OPERATOR_ACTOR_ID,
  };
}

export function buildUpdateMissionInput(
  context: StoreContextEnvelope,
  mission: MissionRecord,
  draft: MissionDraft,
): UpdateMissionInput {
  const create = buildCreateMissionInput(context, draft, mission.id);
  return {
    id: mission.id,
    expectedRevision: mission.revision,
    actorId: OPERATOR_ACTOR_ID,
    patch: {
      title: create.title,
      objective: create.objective,
      priority: create.priority,
      productId: create.productId ?? null,
      observationStartsAt: create.observationStartsAt,
      observationEndsAt: create.observationEndsAt,
      successCriteria: create.successCriteria,
      guardrails: create.guardrails,
    },
  };
}
