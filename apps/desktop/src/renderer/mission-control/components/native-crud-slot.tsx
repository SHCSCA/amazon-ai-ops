import React from 'react';
import type {
  MissionControlCapabilityAction,
  MissionControlCapabilityProjection,
  MissionControlCapabilityState,
  MissionControlViewId,
} from '@amazon-ai-ops/shared-types';
import { WorkbenchPanel, WorkspaceState } from '../../components/workspace';

type NativeCrudAction = Extract<
  MissionControlCapabilityAction,
  'view' | 'create' | 'update' | 'archive' | 'restore' | 'switch'
>;

type NativeCrudCapabilityIds = {
  create: string;
  update: string;
  archive: string;
  view?: string;
  restore?: string;
  switch?: string;
};

type NativeCrudGate = {
  state: MissionControlCapabilityState | 'LOADING' | 'MIXED';
  detail: string;
  allowed: boolean;
};

export type NativeCrudSlotProps = {
  title: string;
  description: string;
  createLabel: string;
  blockedReason: string;
  children?: React.ReactNode;
  slotId: 'store-crud' | 'settings-crud';
  capabilities?: readonly MissionControlCapabilityProjection[];
  capabilityIds: NativeCrudCapabilityIds;
  capabilityView?: MissionControlViewId;
  previewMode?: boolean;
};

function resolveNativeCrudGate({
  capabilities,
  capabilityIds,
  capabilityView,
  previewMode,
}: Pick<
  NativeCrudSlotProps,
  'capabilities' | 'capabilityIds' | 'capabilityView' | 'previewMode'
>): NativeCrudGate {
  if (capabilities === undefined) {
    return {
      state: 'LOADING',
      detail: '正在从 Main 读取该 CRUD 插槽的精确动作能力投影，当前不会挂载任何处理器。',
      allowed: false,
    };
  }

  const requirements = (Object.entries(capabilityIds) as Array<[NativeCrudAction, string]>);
  const projections: MissionControlCapabilityProjection[] = [];
  const invalidRequirements: string[] = [];

  for (const [action, capabilityId] of requirements) {
    const matches = capabilities.filter((capability) => capability.capabilityId === capabilityId);
    if (
      matches.length !== 1
      || matches[0].action !== action
      || (capabilityView !== undefined && matches[0].view !== capabilityView)
    ) {
      invalidRequirements.push(capabilityId);
      continue;
    }
    projections.push(matches[0]);
  }

  if (invalidRequirements.length > 0) {
    return {
      state: 'BLOCKED',
      detail: `缺少或不匹配的精确动作能力：${invalidRequirements.join('、')}。`,
      allowed: false,
    };
  }

  const states = [...new Set(projections.map((projection) => projection.state))];
  if (states.length === 1 && states[0] === 'PRODUCTION_NATIVE') {
    return {
      state: 'PRODUCTION_NATIVE',
      detail: '全部必需 CRUD 动作均由 Main 原生 Authority 授权。',
      allowed: true,
    };
  }
  if (states.length === 1 && states[0] === 'PROTOTYPE_ONLY') {
    if (previewMode === true) {
      return {
        state: 'PROTOTYPE_ONLY',
        detail: '显式开发预览已启用，全部必需 CRUD 动作仅连接预览内存实现。',
        allowed: true,
      };
    }
    return {
      state: 'BLOCKED',
      detail: 'CRUD 动作仅具备 PROTOTYPE_ONLY 投影，但当前并非显式开发预览。',
      allowed: false,
    };
  }

  const stateDetail = projections
    .map((projection) => `${projection.capabilityId}=${projection.state}`)
    .join('；');
  return {
    state: states.length > 1 ? 'MIXED' : 'BLOCKED',
    detail: states.length > 1
      ? `必需 CRUD 动作处于混合能力状态，已失败关闭：${stateDetail}。`
      : `必需 CRUD 动作未全部达到 PRODUCTION_NATIVE：${stateDetail}。`,
    allowed: false,
  };
}

export function NativeCrudSlot({
  title,
  description,
  createLabel,
  blockedReason,
  children,
  slotId,
  capabilities,
  capabilityIds,
  capabilityView,
  previewMode = false,
}: NativeCrudSlotProps) {
  const gate = resolveNativeCrudGate({
    capabilities,
    capabilityIds,
    capabilityView,
    previewMode,
  });
  const hasChildren = children !== undefined && children !== null;

  if (gate.allowed && hasChildren) {
    return (
      <section
        aria-label={title}
        className="mission-control-native-slot mission-control-native-slot--connected"
        data-capability-state={gate.state}
        data-native-slot-mode={gate.state === 'PROTOTYPE_ONLY' ? 'preview-memory' : 'production-native'}
        data-native-slot={slotId}
      >
        {children}
      </section>
    );
  }

  const missingHandler = gate.allowed && !hasChildren;
  const blockerDetail = missingHandler
    ? '动作能力已经通过，但 Renderer 没有收到对应的 CRUD 处理器；为避免空操作或假成功，插槽已失败关闭。'
    : gate.detail;

  return (
    <div
      className="mission-control-native-slot mission-control-native-slot--blocked"
      data-capability-state={missingHandler ? 'BLOCKED' : gate.state}
      data-native-slot={slotId}
    >
      <WorkbenchPanel
        description={description}
        status={<span>{gate.state === 'LOADING' ? '能力读取中' : 'Authority 已阻断'}</span>}
        title={title}
        toolbar={(
          <div className="mission-control-crud-actions" role="group" aria-label={`${title}操作`}>
            <button className="workspace-button workspace-button--primary" data-capability-id={capabilityIds.create} disabled title={blockedReason} type="button">
              {createLabel}
            </button>
            <button className="workspace-button workspace-button--secondary" data-capability-id={capabilityIds.update} disabled title={blockedReason} type="button">
              编辑
            </button>
            <button className="workspace-button workspace-button--secondary" data-capability-id={capabilityIds.archive} disabled title={blockedReason} type="button">
              归档
            </button>
          </div>
        )}
      >
        <div className="mission-control-native-slot__state">
          <WorkspaceState
            description={blockerDetail}
            details={`${blockedReason} 按钮保留标准 CRUD 位置，但不会在 Renderer 中制造店铺、设置或成功回执。`}
            kind={gate.state === 'LOADING' ? 'loading' : 'blocked'}
            title={gate.state === 'LOADING' ? '正在确认 CRUD 动作能力' : 'CRUD 动作能力未获授权'}
          />
        </div>
      </WorkbenchPanel>
    </div>
  );
}
