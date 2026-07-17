import type { AppRoute } from './types';

export type PrimaryWorkspace =
  | 'today'
  | 'product'
  | 'data-preparation'
  | 'diagnosis'
  | 'decisions'
  | 'readback'
  | 'growth'
  | 'system';

export type WorkspaceSubview =
  | 'overview'
  | 'products'
  | 'targets'
  | 'events'
  | 'scope'
  | 'reports'
  | 'import-check'
  | 'analysis'
  | 'recommendations'
  | 'approval'
  | 'decided'
  | 'evidence'
  | 'keywords'
  | 'listing'
  | 'settings'
  | 'scheduler'
  | 'delivery';

export type NavigationIntent =
  | { workspace: 'today'; subview: 'overview' }
  | { workspace: 'product'; subview: 'products' | 'targets' | 'events' }
  | { workspace: 'data-preparation'; subview: 'scope' | 'reports' | 'import-check' }
  | { workspace: 'diagnosis'; subview: 'analysis' }
  | { workspace: 'decisions'; subview: 'recommendations' | 'approval' | 'decided' }
  | { workspace: 'readback'; subview: 'evidence' }
  | { workspace: 'growth'; subview: 'keywords' | 'listing' }
  | { workspace: 'system'; subview: 'settings' | 'scheduler' | 'delivery' };

export interface VisibleWorkspaceDefinition {
  id: PrimaryWorkspace;
  label: string;
  description: string;
  section: 'daily' | 'system';
  defaultIntent: NavigationIntent;
}

type WorkspaceWithSubviewTabs = 'product' | 'data-preparation' | 'diagnosis' | 'growth' | 'system';

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
  product: [
    { id: 'products', label: '产品', description: '选择并锁定当前运营产品' },
    { id: 'targets', label: '目标与成本', description: '维护利润边界与广告目标' },
    { id: 'events', label: '运营事件', description: '记录影响判断的运营上下文' },
  ],
  'data-preparation': [
    { id: 'scope', label: '工作范围', description: '确认日期、店铺、站点与产品范围' },
    { id: 'reports', label: '报表采集', description: '获取完整八类真实业务报表' },
    { id: 'import-check', label: '导入检查', description: '核对逐类入库与指标口径' },
  ],
  diagnosis: [
    { id: 'analysis', label: '广告诊断', description: '检查真实广告对象的风险与机会' },
  ],
  growth: [
    { id: 'keywords', label: '关键词机会', description: '筛选可行动的真实关键词机会' },
    { id: 'listing', label: 'Listing 草案', description: '生成并导出仅本地使用的 Listing 草案' },
  ],
  system: [
    { id: 'settings', label: 'AI 与规则', description: '配置 AI 连接与本地运营规则' },
    { id: 'scheduler', label: '定时任务', description: '检查自动任务状态与最近结果' },
    { id: 'delivery', label: '交付验收', description: '核对当前候选包与正式交付门槛' },
  ],
} as const satisfies {
  [TWorkspace in WorkspaceWithSubviewTabs]: readonly WorkspaceSubviewTabDefinition<TWorkspace>[];
};

export const LEGACY_ROUTE_INTENTS = {
  dashboard: { workspace: 'today', subview: 'overview' },
  'product-management': { workspace: 'product', subview: 'products' },
  'product-config': { workspace: 'product', subview: 'targets' },
  'operation-events': { workspace: 'product', subview: 'events' },
  'operation-scope': { workspace: 'data-preparation', subview: 'scope' },
  'data-collection': { workspace: 'data-preparation', subview: 'reports' },
  'data-import-validation': { workspace: 'data-preparation', subview: 'import-check' },
  'ad-quant': { workspace: 'diagnosis', subview: 'analysis' },
  recommendations: { workspace: 'decisions', subview: 'recommendations' },
  approval: { workspace: 'decisions', subview: 'approval' },
  readback: { workspace: 'readback', subview: 'evidence' },
  'keyword-opportunities': { workspace: 'growth', subview: 'keywords' },
  'listing-optimization': { workspace: 'growth', subview: 'listing' },
  settings: { workspace: 'system', subview: 'settings' },
  scheduler: { workspace: 'system', subview: 'scheduler' },
  delivery: { workspace: 'system', subview: 'delivery' },
} as const satisfies Record<AppRoute, NavigationIntent>;

export const DEFAULT_WORKSPACE_INTENTS = {
  today: LEGACY_ROUTE_INTENTS.dashboard,
  product: LEGACY_ROUTE_INTENTS['product-management'],
  'data-preparation': LEGACY_ROUTE_INTENTS['operation-scope'],
  diagnosis: LEGACY_ROUTE_INTENTS['ad-quant'],
  decisions: LEGACY_ROUTE_INTENTS.recommendations,
  readback: LEGACY_ROUTE_INTENTS.readback,
  growth: LEGACY_ROUTE_INTENTS['keyword-opportunities'],
  system: LEGACY_ROUTE_INTENTS.settings,
} as const satisfies Record<PrimaryWorkspace, NavigationIntent>;

export const VISIBLE_WORKSPACES: readonly VisibleWorkspaceDefinition[] = [
  { id: 'today', label: '今日任务', description: '查看当前运营重点与下一步', section: 'daily', defaultIntent: DEFAULT_WORKSPACE_INTENTS.today },
  { id: 'product', label: '产品工作台', description: '维护产品、目标与运营事件', section: 'daily', defaultIntent: DEFAULT_WORKSPACE_INTENTS.product },
  { id: 'data-preparation', label: '数据准备', description: '配置范围、采集报表并检查导入', section: 'daily', defaultIntent: DEFAULT_WORKSPACE_INTENTS['data-preparation'] },
  { id: 'diagnosis', label: '广告诊断', description: '基于真实数据检查广告表现', section: 'daily', defaultIntent: DEFAULT_WORKSPACE_INTENTS.diagnosis },
  { id: 'decisions', label: '建议与审批', description: '复核建议并进入人工审批', section: 'daily', defaultIntent: DEFAULT_WORKSPACE_INTENTS.decisions },
  { id: 'readback', label: '结果核对', description: '补齐人工执行与结果证据', section: 'daily', defaultIntent: DEFAULT_WORKSPACE_INTENTS.readback },
  { id: 'growth', label: '关键词与 Listing', description: '查看关键词机会与本地 Listing 草案', section: 'daily', defaultIntent: DEFAULT_WORKSPACE_INTENTS.growth },
  { id: 'system', label: '系统与交付', description: '管理 AI、自动任务与交付验收', section: 'system', defaultIntent: DEFAULT_WORKSPACE_INTENTS.system },
];

const intentRoutes = new Map<string, AppRoute>(
  Object.entries(LEGACY_ROUTE_INTENTS).map(([route, intent]) => [intentKey(intent), route as AppRoute]),
);

// The Decisions workspace preserves the canonical decided subview while its
// legacy route alias keeps sidebar highlighting and older deep links stable.
intentRoutes.set(intentKey({ workspace: 'decisions', subview: 'decided' }), 'approval');

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
  return intentRoutes.has(`${record.workspace}:${record.subview}`);
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

export function workspaceForRoute(route?: AppRoute | null): PrimaryWorkspace | null {
  if (!route) return null;
  return navigationIntentForRoute(route).workspace;
}
