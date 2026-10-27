import React from 'react';
import type { CausalEventRecord, MissionRecord } from '@amazon-ai-ops/shared-types';
import type { NavigationIntent } from '../../navigation';
import type { MissionFlightPlanRow } from './mission-workspace-contracts';
import { CHECKPOINT_STAGE_FOR_PHASE } from './mission-workspace-flight-plan';
import { operatorFacingBlocker, OPERATOR_ACTOR_ID } from './mission-workspace-model';

const RECOVERY: Record<MissionFlightPlanRow['phase'], { label: string; intent: NavigationIntent }> = {
  fact: { label: '核对八类报表与导入', intent: { workspace: 'collection', subview: 'import-check' } },
  analysis: { label: '检查并运行当前任务分析', intent: { workspace: 'missions', subview: 'overview' } },
  decision: { label: '复核当前建议与审批', intent: { workspace: 'decisions', subview: 'recommendations' } },
  action: { label: '核对执行授权与队列', intent: { workspace: 'execution', subview: 'live' } },
  readback: { label: '查看提交事实与执行回读', intent: { workspace: 'execution', subview: 'evidence' } },
  effect: { label: '查看实验观察与机器结论', intent: { workspace: 'experiments', subview: 'ledger' } },
};

export function missionStageFeedback(
  row: MissionFlightPlanRow,
  mission: Pick<MissionRecord, 'id' | 'storeId'>,
  events: readonly CausalEventRecord[],
) {
  const systemCheckpoints = row.checkpoints.filter(checkpoint => !['operator', OPERATOR_ACTOR_ID].includes(checkpoint.actorId));
  const latestResult = systemCheckpoints[systemCheckpoints.length - 1];
  const latestBlocker = events.filter(event => event.storeId === mission.storeId && event.missionId === mission.id
    && event.stage === CHECKPOINT_STAGE_FOR_PHASE[row.phase] && ['blocked', 'failed', 'unknown'].includes(event.status)
    && event.source !== 'operator' && !['operator', OPERATOR_ACTOR_ID].includes(event.actorId))
    .sort((a, b) => a.sequence - b.sequence).at(-1);
  const reason = row.state === 'blocked'
    ? latestBlocker ? operatorFacingBlocker(latestBlocker.signal || latestBlocker.observedEffect || latestBlocker.title, '本阶段')
      : '系统已停止本阶段，尚未收到更具体的阻断说明；请核对阶段证据与诊断。'
    : row.state === 'waiting' ? '等待前序阶段的系统结果；尚未取得本阶段所需条件。'
    : row.state === 'paused' ? '运营任务已暂停，请先核对任务约束并恢复任务。'
    : row.state === 'archived' ? '运营任务已归档，当前只允许查看历史。'
    : row.state === 'draft' ? '运营任务尚未启动，请先核对经营目标与关联数据。'
    : '当前未收到本阶段的阻断信息；下一步仍须通过对应实时门禁。';
  return { status: row.statusLabel,
    result: latestResult ? operatorFacingBlocker(latestResult.title, '阶段结果') : '尚无本阶段系统结果；人工补充记录不作为阶段完成依据。',
    reason, recovery: RECOVERY[row.phase] };
}

export function MissionStageFeedback({ row, mission, events, onNavigate }: {
  row: MissionFlightPlanRow;
  mission: Pick<MissionRecord, 'id' | 'storeId'>;
  events: readonly CausalEventRecord[];
  onNavigate(intent: NavigationIntent): void;
}) {
  const feedback = missionStageFeedback(row, mission, events);
  return <section aria-label={`${row.label}阶段反馈`} data-stage-feedback={row.phase}>
    <dl>
      <dt>当前状态</dt><dd>{feedback.status}</dd>
      <dt>最近结果</dt><dd>{feedback.result}</dd>
      <dt>阻断或等待原因</dt><dd>{feedback.reason}</dd>
    </dl>
    <button className="workspace-button workspace-button--secondary" onClick={() => onNavigate(feedback.recovery.intent)} type="button">{feedback.recovery.label}</button>
  </section>;
}
