import React, { useState } from 'react';
import {
  ChartLineUp,
  ClipboardText,
  Flask,
  FlagBanner,
  MonitorPlay,
  ShieldCheck,
  TreeStructure,
} from '@phosphor-icons/react';
import type {
  MissionControlAutonomyProjection,
  MissionControlCapabilityProjection,
  MissionControlViewId,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  ActionMenu,
  PageFrame,
  ResponsiveInspector,
  SummaryStrip,
  TaskBanner,
  WorkbenchPanel,
} from '../../components/workspace';
import {
  CapabilityStateBadge,
  capabilityForAction,
  capabilityRowsForView,
  summarizeViewCapability,
} from '../components';
import {
  CanonicalWorkspaceSurface,
  type CanonicalWorkspaceSurfaceKind,
} from './canonical-workspace-surfaces';
import './canonical-workspace-surfaces.css';

type CanonicalWorkspaceKey = CanonicalWorkspaceSurfaceKind;

type CanonicalWorkspaceSpec = {
  eyebrow: string;
  title: string;
  description: string;
  taskTitle: string;
  taskDescription: string;
  panelTitle: string;
  panelDescription: string;
  emptyTitle: string;
  emptyDescription: string;
  createLabel: string;
  createCapabilityId: string;
  objectHeader: string;
  phaseHeader: string;
  evidenceHeader: string;
  disabledOperations: readonly { label: string; capabilityId: string }[];
};

const WORKSPACE_SPECS: Record<CanonicalWorkspaceKey, CanonicalWorkspaceSpec> = {
  today: {
    eyebrow: 'DAILY MISSION CONTROL',
    title: '今日任务',
    description: '只呈现当前店铺今天应先处理的 Mission、Crux 决策和真实执行边界。',
    taskTitle: '先确认今天的下一安全动作',
    taskDescription: '今日控制面只使用当前 StoreContext；没有权威数据时不拼接跨店铺指标。',
    panelTitle: '今日 Mission 推进控制面',
    panelDescription: '沿 Mission → Crux 决策 → 经营实验 → 可见执行推进，不以指标卡替代任务。',
    emptyTitle: '暂无权威今日任务',
    emptyDescription: '等待 Main 返回当前店铺的任务、数据健康和执行边界。',
    createLabel: '记录运营事件',
    createCapabilityId: 'today.events.create',
    objectHeader: '今日任务',
    phaseHeader: '推进阶段',
    evidenceHeader: '执行边界',
    disabledOperations: [
      { label: '记录运营事件', capabilityId: 'today.events.create' },
      { label: '刷新事实', capabilityId: 'today.overview.refresh' },
    ],
  },
  missions: {
    eyebrow: 'MISSION CONTRACT',
    title: '任务中心',
    description: '统一管理目标、约束、检查点和 Crux 停驻原因。',
    taskTitle: '先让 Main 建立店铺级 Mission Authority',
    taskDescription: '当前 Renderer 不会创建临时 Mission，也不会用浏览器临时存储伪造队列。',
    panelTitle: 'Mission 队列',
    panelDescription: '每条 Mission 必须绑定店铺、业务日期、策略版本和授权边界。',
    emptyTitle: '暂无可验证 Mission',
    emptyDescription: '等待 Main 提供店铺隔离的 Mission 查询与写入合同。',
    createLabel: '新建 Mission',
    createCapabilityId: 'missions.mission.create',
    objectHeader: 'Mission / 目标',
    phaseHeader: '检查点',
    evidenceHeader: '授权边界',
    disabledOperations: [
      { label: '编辑 Mission', capabilityId: 'missions.mission.update' },
      { label: '暂停', capabilityId: 'missions.mission.pause' },
      { label: '恢复', capabilityId: 'missions.mission.resume' },
      { label: '归档', capabilityId: 'missions.mission.archive' },
      { label: '删除', capabilityId: 'missions.mission.delete' },
    ],
  },
  decisions: {
    eyebrow: 'CRUX DECISION',
    title: '决策与审批',
    description: '用统一证据边界处理待判断、待审批与已处理决策。',
    taskTitle: '先验证建议 revision 与审批边界',
    taskDescription: '只有 Main 返回的原子建议、证据和 revision 才能进入审批；Renderer 示例不会形成授权。',
    panelTitle: 'Crux 决策队列',
    panelDescription: '决策对象优先，清楚区分待判断、待人工签发和只读已处理记录。',
    emptyTitle: '暂无权威决策对象',
    emptyDescription: '等待建议仓储、revision 与审批签名完成店铺级绑定。',
    createLabel: '生成新建议',
    createCapabilityId: 'decisions.recommendations.generate',
    objectHeader: '决策对象',
    phaseHeader: '审批状态',
    evidenceHeader: '证据边界',
    disabledOperations: [
      { label: '批准', capabilityId: 'decisions.approval.approve' },
      { label: '拒绝', capabilityId: 'decisions.approval.reject' },
      { label: '重新生成', capabilityId: 'decisions.recommendations.generate' },
    ],
  },
  experiments: {
    eyebrow: 'CAUSAL EXPERIMENT',
    title: '经营实验',
    description: '把每次经营干预记录成可验证的假设、变量、窗口与结果。',
    taskTitle: '先接入追加式实验台账',
    taskDescription: '原型的实验 CRUD 不是生产事实；在数据库合同落地前，所有变更均阻断。',
    panelTitle: '实验台账',
    panelDescription: '实验必须保留创建、修改、归档和结果证据，不允许用 UI 状态替代。',
    emptyTitle: '暂无权威实验记录',
    emptyDescription: '等待实验仓储、因果事件和店铺上下文验证完成接入。',
    createLabel: '新建实验',
    createCapabilityId: 'experiments.experiment.create',
    objectHeader: '假设 / 对象',
    phaseHeader: '观察窗口',
    evidenceHeader: '因果证据',
    disabledOperations: [
      { label: '编辑实验', capabilityId: 'experiments.experiment.update' },
      { label: '暂停', capabilityId: 'experiments.experiment.pause' },
      { label: '恢复', capabilityId: 'experiments.experiment.resume' },
      { label: '归档', capabilityId: 'experiments.experiment.archive' },
      { label: '删除', capabilityId: 'experiments.experiment.delete' },
    ],
  },
  execution: {
    eyebrow: 'VISIBLE EXECUTION',
    title: '实时执行',
    description: '在可见领星浏览器中监控真实写入，并为接管和 UNKNOWN 对账保留入口。',
    taskTitle: '可见浏览器执行 Authority 尚未连入',
    taskDescription: '没有 Main 的会话与写入合同时，界面不会演示成功执行、自动重试或伪回读。',
    panelTitle: '执行队列',
    panelDescription: '每个写入必须串行执行，UNKNOWN 立即停止并交由人工对账。',
    emptyTitle: '暂无可授权执行项',
    emptyDescription: '等待真实建议、授权、可见会话和回读链同时满足。',
    createLabel: '开始可见执行',
    createCapabilityId: 'execution.queue.start',
    objectHeader: '写入对象 / 动作',
    phaseHeader: '执行阶段',
    evidenceHeader: '回读证据',
    disabledOperations: [
      { label: '人工接管', capabilityId: 'execution.queue.takeover' },
      { label: '对账 UNKNOWN', capabilityId: 'execution.queue.reconcile-unknown' },
      { label: '跳过', capabilityId: 'execution.queue.skip' },
      { label: '终止队列', capabilityId: 'execution.queue.kill-switch' },
    ],
  },
  memory: {
    eyebrow: 'CAUSAL MEMORY',
    title: '因果记忆',
    description: '按店铺追溯 FACT → ANALYSIS → DECISION → ACTION → READBACK → EFFECT。',
    taskTitle: '先建立可追溯的记忆索引',
    taskDescription: '原型时间线不会带入生产库；索引必须从真实事件和证据重建。',
    panelTitle: '因果时间线',
    panelDescription: '记忆只读展示已落库事实，不在 Renderer 编辑或删除历史。',
    emptyTitle: '暂无可追溯因果链',
    emptyDescription: '等待事件仓储与店铺索引器完成生产接入。',
    createLabel: '重建索引',
    createCapabilityId: 'memory.timeline.rebuild-index',
    objectHeader: '阶段 / 对象',
    phaseHeader: '业务时间',
    evidenceHeader: '证据引用',
    disabledOperations: [
      { label: '重建索引', capabilityId: 'memory.timeline.rebuild-index' },
      { label: '导出时间线', capabilityId: 'memory.timeline.export' },
    ],
  },
  policy: {
    eyebrow: 'POLICY & RISK',
    title: '策略与风控',
    description: '统一管理人工审批、策略内自动、限额、熔断和实时撤回。',
    taskTitle: '策略自动仍保持失败关闭',
    taskDescription: '在策略版本、限额、授权和执行前重校验落地前，只保留人工审批模式。',
    panelTitle: '策略边界',
    panelDescription: '任何自动写入都必须在执行前重新校验店铺、策略版本与授权状态。',
    emptyTitle: '暂无可启用策略版本',
    emptyDescription: '等待策略仓储、审批签名与执行前安全门完成接入。',
    createLabel: '新建策略版本',
    createCapabilityId: 'policy.version.create',
    objectHeader: '策略 / 范围',
    phaseHeader: '版本状态',
    evidenceHeader: '限额 / 熔断',
    disabledOperations: [
      { label: '编辑规则', capabilityId: 'policy.version.update' },
      { label: '启用', capabilityId: 'policy.version.enable' },
      { label: '停用', capabilityId: 'policy.version.disable' },
      { label: '发布版本', capabilityId: 'policy.version.publish' },
      { label: '启动熔断', capabilityId: 'policy.kill-switch.enable' },
    ],
  },
};

function contextValue(context: StoreContextEnvelope | null, key: keyof StoreContextEnvelope): string {
  if (!context) return '等待 Main';
  return String(context[key]);
}

function CanonicalDomainIcon({ kind }: { kind: CanonicalWorkspaceKey }) {
  if (kind === 'today') return <ChartLineUp aria-hidden="true" size={18} weight="duotone" />;
  if (kind === 'missions') return <FlagBanner aria-hidden="true" size={18} weight="duotone" />;
  if (kind === 'decisions') return <ClipboardText aria-hidden="true" size={18} weight="duotone" />;
  if (kind === 'experiments') return <Flask aria-hidden="true" size={18} weight="duotone" />;
  if (kind === 'execution') return <MonitorPlay aria-hidden="true" size={18} weight="duotone" />;
  if (kind === 'memory') return <TreeStructure aria-hidden="true" size={18} weight="duotone" />;
  return <ShieldCheck aria-hidden="true" size={18} weight="duotone" />;
}

export type CanonicalWorkspaceProps = {
  kind: CanonicalWorkspaceKey;
  view: MissionControlViewId;
  storeContext: StoreContextEnvelope | null;
  capabilities?: readonly MissionControlCapabilityProjection[];
  autonomy?: MissionControlAutonomyProjection | null;
  previewMode: boolean;
};

export function CanonicalWorkspace({
  kind,
  view,
  storeContext,
  capabilities,
  autonomy,
  previewMode,
}: CanonicalWorkspaceProps) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const spec = WORKSPACE_SPECS[kind];
  const capabilitySummary = summarizeViewCapability(capabilities, view);
  const rows = capabilityRowsForView(capabilities, view);
  const viewCapability = capabilityForAction(capabilities, view, 'view');
  const previewEnabled = previewMode && viewCapability?.state === 'PROTOTYPE_ONLY';
  const rejectedPrototypeProjection = !previewMode && viewCapability?.state === 'PROTOTYPE_ONLY';
  const summary = rejectedPrototypeProjection
    ? {
        state: 'BLOCKED' as const,
        label: '已阻断',
        detail: '当前不是显式开发预览，Main 返回的 PROTOTYPE_ONLY 能力已按失败关闭处理。',
        blockerCode: 'MISSION_CONTROL_PREVIEW_MODE_REQUIRED',
        projection: viewCapability,
      }
    : capabilitySummary;
  const blockedReason = summary?.detail ?? '正在从 Main 读取当前店铺的能力投影。';
  const stateKind = capabilities === undefined ? 'loading' : 'blocked';
  const autonomyLabel = autonomy?.currentMode === 'policy_auto'
    ? '策略内自动'
    : '人工审批';

  const inspector = (
    <ResponsiveInspector
      description="仅展示 Main 返回的 StoreContext 和动作级能力投影。"
      onClose={() => setInspectorOpen(false)}
      open={inspectorOpen}
      title={`${spec.title}接入边界`}
    >
      <div className="mission-control-inspector-facts">
        <dl>
          <div><dt>店铺</dt><dd>{contextValue(storeContext, 'storeId')}</dd></div>
          <div><dt>浏览器 Profile</dt><dd>{contextValue(storeContext, 'browserProfileId')}</dd></div>
          <div><dt>业务日期</dt><dd>{contextValue(storeContext, 'businessDate')}</dd></div>
          <div><dt>会话代次</dt><dd>{contextValue(storeContext, 'sessionGeneration')}</dd></div>
        </dl>
        <div className="mission-control-capability-list" aria-label="动作级能力投影">
          {(rows ?? []).map((capability) => (
            <article data-capability-state={capability.state} key={capability.capabilityId}>
              <div><strong>{capability.action}</strong><span>{capability.state}</span></div>
              <p>{capability.detail}</p>
              {capability.blockerCode && <code>{capability.blockerCode}</code>}
            </article>
          ))}
          {rows?.length === 0 && <p>该视图尚无动作投影，已按 BLOCKED 处理。</p>}
          {rows === undefined && <p>正在读取能力投影。</p>}
        </div>
      </div>
    </ResponsiveInspector>
  );

  if (previewEnabled) {
    return (
      <div
        className="mission-control-workspace-root mission-control-workspace-root--preview"
        data-canonical-view={view}
        data-workspace={kind}
      >
        <PageFrame
          className="mission-control-canonical-page mission-control-canonical-page--preview"
          description={spec.description}
          pageId={view.replace('/', '-')}
          title={spec.title}
        >
          <CanonicalWorkspaceSurface
            blockedReason={blockedReason}
            kind={kind}
            onInspectBoundary={() => setInspectorOpen(true)}
            previewEnabled
            storeContext={storeContext}
            view={view}
          />
        </PageFrame>
        {inspector}
      </div>
    );
  }

  return (
    <div className="mission-control-workspace-root" data-canonical-view={view} data-workspace={kind}>
      <PageFrame
        className="mission-control-canonical-page"
        description={spec.description}
        pageId={view.replace('/', '-')}
        title={spec.title}
        task={(
          <TaskBanner
            description={spec.taskDescription}
            eyebrow={spec.eyebrow}
            primaryAction={{
              actionId: spec.createCapabilityId,
              disabled: true,
              disabledReason: blockedReason,
              label: spec.createLabel,
              onClick: () => undefined,
            }}
            secondaryActions={[{
              actionId: `${view}-inspect-boundary`,
              label: '查看接入边界',
              onClick: () => setInspectorOpen(true),
            }]}
            status={<CapabilityStateBadge summary={summary} />}
            title={spec.taskTitle}
            tone={stateKind === 'loading' ? 'attention' : 'blocked'}
          >
            <div className="mission-control-domain-boundary">
              <CanonicalDomainIcon kind={kind} />
              <span>{blockedReason}</span>
            </div>
          </TaskBanner>
        )}
        summary={(
          <SummaryStrip
            ariaLabel={`${spec.title}当前权威上下文`}
            items={[
              { id: 'store', label: '店铺数据域', value: contextValue(storeContext, 'storeId') },
              { id: 'market', label: '站点 / 币种', value: storeContext ? `${storeContext.marketplace} / ${storeContext.currency}` : '等待 Main' },
              { id: 'mode', label: '当前执行模式', value: autonomyLabel, tone: autonomy?.currentMode === 'policy_auto' ? 'attention' : 'neutral' },
              { id: 'authority', label: '动作能力投影', value: rows === undefined ? '读取中' : `${rows.length} 项`, tone: summary?.state === 'BLOCKED' ? 'blocked' : 'attention' },
            ]}
          />
        )}
      >
        <WorkbenchPanel
          description={spec.panelDescription}
          footer={previewEnabled
            ? '当前示例仅用于开发预览和视觉验收；生产数据仍必须来自 Main 的店铺权威合同。'
            : '这里只渲染 Main 返回的店铺权威数据；当前不会用 Renderer 临时状态填充队列。'}
          status={<CapabilityStateBadge summary={summary} />}
          title={spec.panelTitle}
          toolbar={(
            <ActionMenu
              items={spec.disabledOperations.map((operation) => ({
                id: operation.capabilityId,
                label: operation.label,
                description: blockedReason,
                disabled: true,
                onSelect: () => undefined,
              }))}
              label="更多 CRUD"
            />
          )}
        >
          <CanonicalWorkspaceSurface
            blockedReason={blockedReason}
            kind={kind}
            previewEnabled={previewEnabled}
            storeContext={storeContext}
            view={view}
          />
        </WorkbenchPanel>
      </PageFrame>

      {inspector}
    </div>
  );
}
