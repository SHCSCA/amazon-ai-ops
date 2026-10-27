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
  type MissionFlightPlanRow,
} from './mission-workspace-contracts';
import {
  PHASE_LABELS,
  OPERATOR_ACTOR_ID,
} from './mission-workspace-model';

export const MISSION_PHASE_SEQUENCE = ['fact', 'analysis', 'decision', 'action', 'readback', 'effect'] as const;

export const CHECKPOINT_STAGE_FOR_PHASE: Record<MissionPhase, MissionCheckpointRecord['stage']> = {
  fact: 'FACT',
  analysis: 'ANALYSIS',
  decision: 'DECISION',
  action: 'ACTION',
  readback: 'READBACK',
  effect: 'EFFECT',
};

export const MISSION_PHASE_PLAN: Record<MissionPhase, string> = {
  fact: '核验当前店铺已完成的 8 类报表、数据批次与产品范围。',
  analysis: '运行分析后封存结果、来源与建议数量。',
  decision: '在决策中心复核建议并批准、拒绝或阻断。',
  action: '只有取得当前许可后才进入可见 Ads 执行。',
  readback: '保存执行前、提交后与刷新后的三段回读证据。',
  effect: '观察窗结束并导入新报表后，由关联经营实验判定指标；结果完成关联后才形成效果闭环与因果记忆。',
};

export function missionFlightPlanCapabilitySummary(): string {
  return '事实、分析、决策、执行与回读会在对应系统事件落账后更新；效果阶段须由关联经营实验完成指标判定后闭环。人工补充记录只作上下文，不改变阶段状态。';
}

export const MISSION_FLIGHT_PLAN_STATE_LABELS: Record<MissionFlightPlanRow['state'], string> = {
  done: '阶段已完成',
  current: '当前阶段',
  blocked: '阶段已阻断',
  waiting: '等待系统事件',
  draft: '任务待启动',
  paused: '任务已暂停',
  archived: '任务已归档',
};

export function missionFlightPlanState(
  index: number,
  currentIndex: number,
  missionStatus: MissionLifecycleStatus,
): MissionFlightPlanRow['state'] {
  if (missionStatus === 'draft') return index === currentIndex ? 'draft' : 'waiting';
  if (missionStatus === 'completed') return index <= currentIndex ? 'done' : 'waiting';
  if (index < currentIndex) return 'done';
  if (index > currentIndex) return 'waiting';
  if (missionStatus === 'blocked') return 'blocked';
  if (missionStatus === 'paused') return 'paused';
  if (missionStatus === 'archived') return 'archived';
  return 'current';
}

export function missionFlightPlanRows(
  currentPhase: MissionPhase,
  missionStatus: MissionLifecycleStatus,
  checkpoints: readonly MissionCheckpointRecord[],
): MissionFlightPlanRow[] {
  const currentIndex = MISSION_PHASE_SEQUENCE.indexOf(currentPhase);
  return MISSION_PHASE_SEQUENCE.map((phase, index) => {
    const stage = CHECKPOINT_STAGE_FOR_PHASE[phase];
    const stageCheckpoints = checkpoints.filter((checkpoint) => checkpoint.stage === stage)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    const latest = stageCheckpoints[stageCheckpoints.length - 1];
    const state = missionFlightPlanState(index, currentIndex, missionStatus);
    return {
      phase,
      label: PHASE_LABELS[phase],
      state,
      description: MISSION_PHASE_PLAN[phase],
      checkpoints: stageCheckpoints,
      evidenceCount: stageCheckpoints.reduce((total, checkpoint) => total + checkpoint.evidenceCount, 0),
      latestCheckpointSourceLabel: latest
        ? ['operator', OPERATOR_ACTOR_ID].includes(latest.actorId) ? '人工补充' : '系统记录'
        : undefined,
      latestCheckpointTitle: latest?.title,
      statusLabel: MISSION_FLIGHT_PLAN_STATE_LABELS[state],
    };
  });
}
