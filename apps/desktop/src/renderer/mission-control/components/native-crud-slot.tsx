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
  diagnosticDetail: string;
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
      detail: '请稍候，确认完成后即可继续。',
      diagnosticDetail: '正在从 Main 读取该 CRUD 插槽的精确动作能力投影，当前不会挂载任何处理器。',
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
      detail: '所需操作尚未全部接入，请刷新后重试；仍不可用时查看诊断详情。',
      diagnosticDetail: `缺少或不匹配的精确动作能力：${invalidRequirements.join('、')}。`,
      allowed: false,
    };
  }

  const states = [...new Set(projections.map((projection) => projection.state))];
  if (states.length === 1 && states[0] === 'PRODUCTION_NATIVE') {
    return {
      state: 'PRODUCTION_NATIVE',
      detail: '所需操作已通过安全校验。',
      diagnosticDetail: '全部必需 CRUD 动作均由 Main 原生 Authority 授权。',
      allowed: true,
    };
  }
  if (states.length === 1 && states[0] === 'PROTOTYPE_ONLY') {
    if (previewMode === true) {
      return {
        state: 'PROTOTYPE_ONLY',
        detail: '开发预览中的操作已接入本地示例数据。',
        diagnosticDetail: '显式开发预览已启用，全部必需 CRUD 动作仅连接预览内存实现。',
        allowed: true,
      };
    }
    return {
      state: 'BLOCKED',
      detail: '当前版本不能使用开发预览操作，请返回正式入口。',
      diagnosticDetail: 'CRUD 动作仅具备 PROTOTYPE_ONLY 投影，但当前并非显式开发预览。',
      allowed: false,
    };
  }

  const stateDetail = projections
    .map((projection) => `${projection.capabilityId}=${projection.state}`)
    .join('；');
  return {
    state: states.length > 1 ? 'MIXED' : 'BLOCKED',
    detail: states.length > 1
      ? '所需操作状态不一致，已安全暂停；请刷新后重试。'
      : '所需操作尚未全部开放，已安全暂停；请刷新后重试。',
    diagnosticDetail: states.length > 1
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
    ? '可用操作已经确认，但页面没有收到对应处理入口；为避免空操作或假成功，当前操作已暂停。'
    : gate.detail;
  const diagnosticDetail = missingHandler
    ? '动作能力已经通过，但 Renderer 没有收到对应的 CRUD 处理器；为避免空操作或假成功，插槽已失败关闭。'
    : gate.diagnosticDetail;

  return (
    <div
      className="mission-control-native-slot mission-control-native-slot--blocked"
      data-capability-state={missingHandler ? 'BLOCKED' : gate.state}
      data-native-slot={slotId}
    >
      <WorkbenchPanel
        description={description}
        status={<span>{gate.state === 'LOADING' ? '正在确认' : '操作已暂停'}</span>}
        title={title}
        toolbar={(
          <div className="mission-control-crud-actions" role="group" aria-label={`${title}操作`}>
            <button className="workspace-button workspace-button--primary" data-capability-id={capabilityIds.create} disabled title="等待可用操作确认" type="button">
              {createLabel}
            </button>
            <button className="workspace-button workspace-button--secondary" data-capability-id={capabilityIds.update} disabled title="等待可用操作确认" type="button">
              编辑
            </button>
            <button className="workspace-button workspace-button--secondary" data-capability-id={capabilityIds.archive} disabled title="等待可用操作确认" type="button">
              归档
            </button>
          </div>
        )}
      >
        <div className="mission-control-native-slot__state">
          <WorkspaceState
            description={gate.state === 'LOADING'
              ? blockerDetail
              : `${title}操作暂不可用。${blockerDetail}`}
            details={(
              <details>
                <summary>诊断详情</summary>
                <code>{diagnosticDetail} {blockedReason}</code>
              </details>
            )}
            kind={gate.state === 'LOADING' ? 'loading' : 'blocked'}
            title={gate.state === 'LOADING' ? '正在确认可用操作' : `${title}操作暂不可用`}
          />
        </div>
      </WorkbenchPanel>
    </div>
  );
}
