import type { MissionControlWorkspaceId } from '@amazon-ai-ops/shared-types';
import type { AppRoute } from './types';

export type PrimaryWorkspace = MissionControlWorkspaceId;

export type NavigationIntent =
  | { workspace: 'today'; subview: 'overview' | 'events' }
  | { workspace: 'missions'; subview: 'overview' | 'facts' }
  | { workspace: 'decisions'; subview: 'recommendations' | 'approval' | 'decided' }
  | { workspace: 'experiments'; subview: 'ledger' }
  | { workspace: 'execution'; subview: 'live' | 'evidence' }
  | { workspace: 'memory'; subview: 'timeline' }
  | { workspace: 'objects'; subview: 'products' | 'targets' | 'keywords' | 'listing' }
  | { workspace: 'collection'; subview: 'scope' | 'reports' | 'import-check' }
  | { workspace: 'policy'; subview: 'rules' }
  | { workspace: 'settings'; subview: 'ai-and-local' | 'scheduler' | 'delivery' };

export type WorkspaceSubview = NavigationIntent['subview'];

export type WorkspaceSection = 'mission' | 'learning' | 'foundation' | 'governance';

export interface VisibleWorkspaceDefinition {
  id: PrimaryWorkspace;
  label: string;
  description: string;
  section: WorkspaceSection;
  defaultIntent: NavigationIntent;
}

type WorkspaceWithSubviewTabs =
  | 'today'
  | 'missions'
  | 'decisions'
  | 'execution'
  | 'objects'
  | 'collection'
  | 'settings';

export type WorkspaceSubviewFor<TWorkspace extends PrimaryWorkspace> = Extract<
  NavigationIntent,
  { workspace: TWorkspace }
>['subview'];

export interface WorkspaceSubviewTabDefinition<TWorkspace extends PrimaryWorkspace> {
  id: WorkspaceSubviewFor<TWorkspace>;
  label: string;
  description: string;
}

export const WORKSPACE_SUBVIEW_TABS = {
  today: [
    { id: 'overview', label: '今日总览', description: '查看当前店铺的下一安全动作与运营事实' },
    { id: 'events', label: '运营事件', description: '记录会影响当日判断的运营上下文' },
  ],
  missions: [
    { id: 'overview', label: 'Mission 队列', description: '查看目标、约束、检查点与运行状态' },
    { id: 'facts', label: '广告事实', description: '复用真实广告诊断与量化事实' },
  ],
  decisions: [
    { id: 'recommendations', label: '待判断', description: '复核系统建议与证据边界' },
    { id: 'approval', label: '待审批', description: '只处理需要人工签发的动作' },
    { id: 'decided', label: '已处理', description: '回看已签发或已拒绝的决定' },
  ],
  execution: [
    { id: 'live', label: '可见执行', description: '查看当前领星会话、执行步骤与接管入口' },
    { id: 'evidence', label: '执行回读', description: '补齐执行前、执行后与 Reload 回读证据' },
  ],
  objects: [
    { id: 'products', label: '店铺与产品', description: '维护当前店铺的产品与业务身份' },
    { id: 'targets', label: '成本与目标', description: '维护利润边界与广告目标' },
    { id: 'keywords', label: '关键词机会', description: '筛选可行动的真实关键词机会' },
    { id: 'listing', label: 'Listing 草案', description: '生成并导出仅本地使用的 Listing 草案' },
  ],
  collection: [
    { id: 'scope', label: '采集范围', description: '确认日期、店铺、站点与产品范围' },
    { id: 'reports', label: '采集任务', description: '获取完整八类真实业务报表' },
    { id: 'import-check', label: '导入检查', description: '核对逐类入库与指标口径' },
  ],
  settings: [
    { id: 'ai-and-local', label: 'AI 与本地', description: '配置 AI 连接与本地运行选项' },
    { id: 'scheduler', label: '定时任务', description: '检查自动任务状态与最近结果' },
    { id: 'delivery', label: '交付验收', description: '核对当前候选包与正式交付门槛' },
  ],
} as const satisfies {
  [TWorkspace in WorkspaceWithSubviewTabs]: readonly WorkspaceSubviewTabDefinition<TWorkspace>[];
};

/**
 * Compatibility aliases only. Every legacy route resolves into one canonical
 * Mission Control workspace; canonical-only workspaces deliberately have no
 * fake legacy route.
 */
export const LEGACY_ROUTE_INTENTS = {
  dashboard: { workspace: 'today', subview: 'overview' },
  'product-management': { workspace: 'objects', subview: 'products' },
  'product-config': { workspace: 'objects', subview: 'targets' },
  'operation-events': { workspace: 'today', subview: 'events' },
  'operation-scope': { workspace: 'collection', subview: 'scope' },
  'data-collection': { workspace: 'collection', subview: 'reports' },
  'data-import-validation': { workspace: 'collection', subview: 'import-check' },
  'ad-quant': { workspace: 'missions', subview: 'facts' },
  recommendations: { workspace: 'decisions', subview: 'recommendations' },
  approval: { workspace: 'decisions', subview: 'approval' },
  readback: { workspace: 'execution', subview: 'evidence' },
  'keyword-opportunities': { workspace: 'objects', subview: 'keywords' },
  'listing-optimization': { workspace: 'objects', subview: 'listing' },
  settings: { workspace: 'settings', subview: 'ai-and-local' },
  scheduler: { workspace: 'settings', subview: 'scheduler' },
  delivery: { workspace: 'settings', subview: 'delivery' },
} as const satisfies Record<AppRoute, NavigationIntent>;

export const DEFAULT_WORKSPACE_INTENTS = {
  today: LEGACY_ROUTE_INTENTS.dashboard,
  missions: { workspace: 'missions', subview: 'overview' },
  decisions: LEGACY_ROUTE_INTENTS.recommendations,
  experiments: { workspace: 'experiments', subview: 'ledger' },
  execution: { workspace: 'execution', subview: 'live' },
  memory: { workspace: 'memory', subview: 'timeline' },
  objects: LEGACY_ROUTE_INTENTS['product-management'],
  collection: LEGACY_ROUTE_INTENTS['operation-scope'],
  policy: { workspace: 'policy', subview: 'rules' },
  settings: LEGACY_ROUTE_INTENTS.settings,
} as const satisfies Record<PrimaryWorkspace, NavigationIntent>;

export const VISIBLE_WORKSPACES: readonly VisibleWorkspaceDefinition[] = [
  { id: 'today', label: '今日任务', description: '查看当前店铺的运营重点与下一安全动作', section: 'mission', defaultIntent: DEFAULT_WORKSPACE_INTENTS.today },
  { id: 'missions', label: '任务中心', description: '管理 Mission、目标、约束与检查点', section: 'mission', defaultIntent: DEFAULT_WORKSPACE_INTENTS.missions },
  { id: 'decisions', label: '决策与审批', description: '复核关键决定并签发授权', section: 'mission', defaultIntent: DEFAULT_WORKSPACE_INTENTS.decisions },
  { id: 'experiments', label: '经营实验', description: '把经营干预记录成可验证实验', section: 'learning', defaultIntent: DEFAULT_WORKSPACE_INTENTS.experiments },
  { id: 'execution', label: '实时执行', description: '监控可见领星执行并完成回读', section: 'learning', defaultIntent: DEFAULT_WORKSPACE_INTENTS.execution },
  { id: 'memory', label: '因果记忆', description: '检索事实、动作、结果与因果链', section: 'learning', defaultIntent: DEFAULT_WORKSPACE_INTENTS.memory },
  { id: 'objects', label: '店铺与广告对象', description: '维护产品、目标、关键词与 Listing', section: 'foundation', defaultIntent: DEFAULT_WORKSPACE_INTENTS.objects },
  { id: 'collection', label: '数据采集', description: '配置范围、采集报表并检查导入', section: 'foundation', defaultIntent: DEFAULT_WORKSPACE_INTENTS.collection },
  { id: 'policy', label: '策略与风控', description: '管理模式、限额、熔断与审批边界', section: 'governance', defaultIntent: DEFAULT_WORKSPACE_INTENTS.policy },
  { id: 'settings', label: '系统设置', description: '管理 AI、本地任务与交付验收', section: 'governance', defaultIntent: DEFAULT_WORKSPACE_INTENTS.settings },
];

const intentRoutes = new Map<string, AppRoute>(
  Object.entries(LEGACY_ROUTE_INTENTS).map(([route, intent]) => [intentKey(intent), route as AppRoute]),
);

// The canonical decided subview has no old page of its own. The existing
// approval page already contains the read-only decided queue.
intentRoutes.set(intentKey({ workspace: 'decisions', subview: 'decided' }), 'approval');

const validIntentKeys = new Set<string>([
  'today:overview',
  'today:events',
  'missions:overview',
  'missions:facts',
  'decisions:recommendations',
  'decisions:approval',
  'decisions:decided',
  'experiments:ledger',
  'execution:live',
  'execution:evidence',
  'memory:timeline',
  'objects:products',
  'objects:targets',
  'objects:keywords',
  'objects:listing',
  'collection:scope',
  'collection:reports',
  'collection:import-check',
  'policy:rules',
  'settings:ai-and-local',
  'settings:scheduler',
  'settings:delivery',
]);

function intentKey(intent: Pick<NavigationIntent, 'workspace' | 'subview'>): string {
  return `${intent.workspace}:${intent.subview}`;
}

export function navigationIntentForRoute(route: AppRoute): NavigationIntent {
  return LEGACY_ROUTE_INTENTS[route];
}

export function isAppRoute(value: unknown): value is AppRoute {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_ROUTE_INTENTS, value);
}

export function isNavigationIntent(value: unknown): value is NavigationIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) return false;
  if (typeof record.workspace !== 'string' || typeof record.subview !== 'string') return false;
  return validIntentKeys.has(`${record.workspace}:${record.subview}`);
}

export function normalizeNavigationTarget(target: unknown): NavigationIntent | null {
  if (isAppRoute(target)) return navigationIntentForRoute(target);
  if (!isNavigationIntent(target)) return null;
  return { workspace: target.workspace, subview: target.subview } as NavigationIntent;
}

export function resolveNavigationTarget(target: unknown): AppRoute | null {
  const intent = normalizeNavigationTarget(target);
  if (!intent) return null;
  return intentRoutes.get(intentKey(intent)) || null;
}

export function navigationIntentsEqual(left?: NavigationIntent | null, right?: NavigationIntent | null): boolean {
  return Boolean(left && right && left.workspace === right.workspace && left.subview === right.subview);
}

export function navigationNeedsGlobalHandoff(
  current?: NavigationIntent | null,
  target?: NavigationIntent | null,
): boolean {
  return Boolean(current && target && current.workspace !== target.workspace);
}

export function workspaceForRoute(route?: AppRoute | null): PrimaryWorkspace | null {
  if (!route) return null;
  return navigationIntentForRoute(route).workspace;
}
