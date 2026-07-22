import type { MissionControlViewId, MissionControlWorkspaceId } from '@amazon-ai-ops/shared-types';
import type { NavigationIntent } from '../../navigation';
import type {
  MissionControlWorkspaceRegistration,
  MissionControlWorkspaceSubviewDefinition,
} from './types';

export const MISSION_CONTROL_WORKSPACE_REGISTRY = [
  {
    id: 'today',
    label: '今日任务',
    description: '只呈现当前店铺今天应先处理的事实与安全动作。',
    subviews: [
      { id: 'overview', label: '今日总览', description: '下一安全动作与运营事实', view: 'today/overview', kind: 'legacy', legacyRoute: 'dashboard' },
      { id: 'events', label: '运营事件', description: '记录会影响当日判断的上下文', view: 'today/events', kind: 'legacy', legacyRoute: 'operation-events' },
    ],
  },
  {
    id: 'missions',
    label: '任务中心',
    description: '管理 Mission 的目标、约束、检查点与停驻原因。',
    subviews: [
      { id: 'overview', label: 'Mission 队列', description: '目标、约束与检查点', view: 'missions/overview', kind: 'canonical' },
      { id: 'facts', label: '广告事实', description: '复用真实广告诊断与量化事实', view: 'missions/facts', kind: 'legacy', legacyRoute: 'ad-quant' },
    ],
  },
  {
    id: 'decisions',
    label: '决策与审批',
    description: '用统一证据边界处理待判断、待审批与已处理决策。',
    subviews: [
      { id: 'recommendations', label: '待判断', description: '复核建议与证据边界', view: 'decisions/recommendations', kind: 'legacy', legacyRoute: 'recommendations' },
      { id: 'approval', label: '待审批', description: '只处理需要人工签发的动作', view: 'decisions/approval', kind: 'legacy', legacyRoute: 'approval' },
      { id: 'decided', label: '已处理', description: '只读回看已签发或已拒绝的决定', view: 'decisions/decided', kind: 'legacy', legacyRoute: 'approval' },
    ],
  },
  {
    id: 'experiments',
    label: '经营实验',
    description: '把经营干预记录成可验证的假设、行动与结果。',
    subviews: [
      { id: 'ledger', label: '实验台账', description: '假设、变量、观察窗口与证据', view: 'experiments/ledger', kind: 'canonical' },
    ],
  },
  {
    id: 'execution',
    label: '实时执行',
    description: '在可见领星浏览器中监控每一步写入、接管与回读。',
    subviews: [
      { id: 'live', label: '可见执行', description: '当前会话、执行步骤与接管入口', view: 'execution/live', kind: 'canonical' },
      { id: 'evidence', label: '执行回读', description: '执行前、执行后与 Reload 证据', view: 'execution/evidence', kind: 'legacy', legacyRoute: 'readback' },
    ],
  },
  {
    id: 'memory',
    label: '因果记忆',
    description: '按店铺检索事实、决策、行动、回读与效果链。',
    subviews: [
      { id: 'timeline', label: '因果时间线', description: '追溯事实到效果的完整链路', view: 'memory/timeline', kind: 'canonical' },
    ],
  },
  {
    id: 'objects',
    label: '店铺与广告对象',
    description: '维护店铺数据域、产品、经营目标、关键词与 Listing。',
    subviews: [
      { id: 'products', label: '店铺与产品', description: '原生店铺 CRUD 与产品维护', view: 'objects/products', kind: 'legacy', legacyRoute: 'product-management' },
      { id: 'targets', label: '成本与目标', description: '利润边界与广告目标', view: 'objects/targets', kind: 'legacy', legacyRoute: 'product-config' },
      { id: 'keywords', label: '关键词机会', description: '可行动的真实关键词机会', view: 'objects/keywords', kind: 'legacy', legacyRoute: 'keyword-opportunities' },
      { id: 'listing', label: 'Listing 草案', description: '生成并导出仅本地使用的草案', view: 'objects/listing', kind: 'legacy', legacyRoute: 'listing-optimization' },
    ],
  },
  {
    id: 'collection',
    label: '数据采集',
    description: '在可见浏览器中采集领星报表并按店铺验证入库。',
    subviews: [
      { id: 'scope', label: '采集范围', description: '日期、店铺、站点与产品范围', view: 'collection/scope', kind: 'legacy', legacyRoute: 'operation-scope' },
      { id: 'reports', label: '采集任务', description: '获取完整八类真实业务报表', view: 'collection/reports', kind: 'legacy', legacyRoute: 'data-collection' },
      { id: 'import-check', label: '导入检查', description: '核对逐类入库与指标口径', view: 'collection/import-check', kind: 'legacy', legacyRoute: 'data-import-validation' },
    ],
  },
  {
    id: 'policy',
    label: '策略与风控',
    description: '管理模式、限额、熔断、人工审批和真实执行边界。',
    subviews: [
      { id: 'rules', label: '策略边界', description: '模式、限额、熔断与审批规则', view: 'policy/rules', kind: 'canonical' },
    ],
  },
  {
    id: 'settings',
    label: '系统设置',
    description: '管理 AI 与本地运行选项、定时任务和交付验收。',
    subviews: [
      { id: 'ai-and-local', label: 'AI 与本地', description: '原生店铺设置 CRUD 与 AI 连接', view: 'settings/ai-and-local', kind: 'legacy', legacyRoute: 'settings' },
      { id: 'scheduler', label: '定时任务', description: '自动任务状态与最近结果', view: 'settings/scheduler', kind: 'legacy', legacyRoute: 'scheduler' },
      { id: 'delivery', label: '交付验收', description: '候选包与正式交付门槛', view: 'settings/delivery', kind: 'legacy', legacyRoute: 'delivery' },
    ],
  },
] as const satisfies readonly MissionControlWorkspaceRegistration[];

const workspaceById = new Map<MissionControlWorkspaceId, MissionControlWorkspaceRegistration>(
  MISSION_CONTROL_WORKSPACE_REGISTRY.map((workspace) => [workspace.id, workspace]),
);

export function registrationForWorkspace(
  workspace: MissionControlWorkspaceId,
): MissionControlWorkspaceRegistration {
  const registration = workspaceById.get(workspace);
  if (!registration) throw new Error(`Mission Control workspace ${workspace} is not registered`);
  return registration;
}

export function subviewDefinitionForIntent(
  intent: NavigationIntent,
): MissionControlWorkspaceSubviewDefinition {
  const registration = registrationForWorkspace(intent.workspace);
  const subview = registration.subviews.find((candidate) => candidate.id === intent.subview);
  if (!subview) {
    throw new Error(`Mission Control subview ${intent.workspace}/${intent.subview} is not registered`);
  }
  return subview;
}

export function missionControlViewIdForIntent(intent: NavigationIntent): MissionControlViewId {
  return subviewDefinitionForIntent(intent).view;
}

