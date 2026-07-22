import React from 'react';
import type {
  MissionControlCapabilityAction,
  MissionControlCapabilityProjection,
  MissionControlCapabilityState,
  MissionControlViewId,
} from '@amazon-ai-ops/shared-types';

const STATE_PRIORITY: Record<MissionControlCapabilityState, number> = {
  PRODUCTION_NATIVE: 0,
  LEGACY_ADAPTER: 1,
  PROTOTYPE_ONLY: 2,
  BLOCKED: 3,
};

const STATE_LABELS: Record<MissionControlCapabilityState, string> = {
  PRODUCTION_NATIVE: '原生能力',
  LEGACY_ADAPTER: '生产适配',
  PROTOTYPE_ONLY: '仅原型',
  BLOCKED: '已阻断',
};

export type ViewCapabilitySummary = {
  state: MissionControlCapabilityState;
  label: string;
  detail: string;
  blockerCode?: string;
  projection?: MissionControlCapabilityProjection;
};

export function capabilityRowsForView(
  capabilities: readonly MissionControlCapabilityProjection[] | undefined,
  view: MissionControlViewId,
): MissionControlCapabilityProjection[] | undefined {
  if (capabilities === undefined) return undefined;
  return capabilities.filter((capability) => capability.view === view);
}

export function capabilityForAction(
  capabilities: readonly MissionControlCapabilityProjection[] | undefined,
  view: MissionControlViewId,
  action: MissionControlCapabilityAction,
): MissionControlCapabilityProjection | undefined {
  return capabilityRowsForView(capabilities, view)?.find((capability) => capability.action === action);
}

/**
 * A view badge is only a pessimistic display summary. Callers must still use
 * the exact action projection before enabling any control.
 */
export function summarizeViewCapability(
  capabilities: readonly MissionControlCapabilityProjection[] | undefined,
  view: MissionControlViewId,
): ViewCapabilitySummary | null {
  const rows = capabilityRowsForView(capabilities, view);
  if (rows === undefined) return null;
  if (rows.length === 0) {
    return {
      state: 'BLOCKED',
      label: STATE_LABELS.BLOCKED,
      blockerCode: 'MISSION_CONTROL_CAPABILITY_MISSING',
      detail: '当前主进程没有返回该视图的能力投影，界面已按失败关闭处理。',
    };
  }

  const projection = [...rows].sort((left, right) => (
    STATE_PRIORITY[right.state] - STATE_PRIORITY[left.state]
  ))[0];

  return {
    state: projection.state,
    label: STATE_LABELS[projection.state],
    detail: projection.detail,
    blockerCode: projection.blockerCode,
    projection,
  };
}

export function CapabilityStateBadge({
  summary,
}: {
  summary: ViewCapabilitySummary | null;
}) {
  const state = summary?.state ?? 'BLOCKED';
  return (
    <span
      className="mission-control-capability-badge"
      data-capability-state={summary ? state : 'LOADING'}
      role="status"
    >
      {summary?.label ?? '读取中'}
    </span>
  );
}

