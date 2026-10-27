import type { MissionControlViewId } from './mission-control';

export const AUTHORITY_GATE_PRIORITIES = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const;
export type AuthorityGatePriority = typeof AUTHORITY_GATE_PRIORITIES[number];

export interface AuthorityGateBlocker {
  priority: AuthorityGatePriority;
  code: string;
  message: string;
  recoveryIntent: MissionControlViewId;
}

export interface AuthorityGateProjection {
  primaryBlocker: AuthorityGateBlocker;
  blockers: readonly AuthorityGateBlocker[];
}

const GATE_COPY: Readonly<Record<AuthorityGatePriority, Omit<AuthorityGateBlocker, 'priority'>>> = {
  P0: { code: 'AUTHORITY_KILL_SWITCH', message: '当前店铺已紧急停止写入，请先核对停止原因和恢复条件。', recoveryIntent: 'policy/rules' },
  P1: { code: 'AUTHORITY_CIRCUIT_OPEN', message: '当前店铺执行熔断尚未恢复，请先复核异常。', recoveryIntent: 'policy/rules' },
  P2: { code: 'AUTHORITY_CONTEXT_CHANGED', message: '当前店铺、账号或连接已变化，请重新确认连接后刷新。', recoveryIntent: 'collection/reports' },
  P3: { code: 'AUTHORITY_REVISION_CHANGED', message: '任务、建议或策略版本已变化，请基于当前数据重新分析。', recoveryIntent: 'missions/overview' },
  P4: { code: 'AUTHORITY_GRANT_UNAVAILABLE', message: '执行授权已过期、终止或用尽，请重新分析并取得新的授权。', recoveryIntent: 'decisions/approval' },
  P5: { code: 'AUTHORITY_POLICY_LIMIT', message: '当前对象、范围、执行窗口或策略限额不满足，请复核当前策略。', recoveryIntent: 'policy/rules' },
  P6: { code: 'AUTHORITY_EVIDENCE_REQUIRED', message: '当前证据、页面身份或执行前值尚未核实，请补齐后重新检查。', recoveryIntent: 'execution/live' },
};

export function authorityGateProjection(priorities: readonly AuthorityGatePriority[]): AuthorityGateProjection | undefined {
  const selected = new Set(priorities);
  const blockers = AUTHORITY_GATE_PRIORITIES.filter(priority => selected.has(priority))
    .map(priority => ({ priority, ...GATE_COPY[priority] }));
  return blockers.length ? { primaryBlocker: blockers[0], blockers } : undefined;
}
