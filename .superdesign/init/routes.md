# Renderer Routes — Amazon AI Ops desktop

Source scope: `apps/desktop/src/renderer`.

## Routing model

This renderer does **not** use React Router and does not bind workspaces to browser URL paths. Navigation is state/config based:

1. `main.tsx` mounts `App`.
2. `navigation.ts` defines the canonical `NavigationIntent` model, eight visible primary workspaces, 17 canonical subviews, and the compatibility mapping to the 16 legacy `AppRoute` identifiers.
3. `App.requestNavigate` normalizes either a legacy route or a workspace/subview intent, updates Zustand state, and shows the global handoff only when the primary workspace changes.
4. `BusinessRoutePage` selects the actual page component. In-page navigation can dispatch `amazon-ai-ops:navigate` with either target shape.
5. The `decisions/decided` canonical subview deliberately reuses legacy route alias `approval`; the workspace/subview pair is the authoritative identity.

## Canonical workspace and page map

| # | Canonical workspace / subview | Legacy AppRoute alias | Rendered page component | Component source | Layout chain |
|---:|---|---|---|---|---|
| 1 | `today / overview` | `dashboard` | `DashboardPage` | `apps/desktop/src/renderer/pages/dashboard-page.tsx` | App shell → page-owned `PageFrame` |
| 2 | `product / products` | `product-management` | `ProductManagementPage` | `apps/desktop/src/renderer/pages/product-management-page.tsx` | App shell → `WorkspaceSubviewShell(product)` → page workbench + `ResponsiveInspector` |
| 3 | `product / targets` | `product-config` | `ProductConfigPage` | `apps/desktop/src/renderer/pages/product-config-page.tsx` | App shell → `WorkspaceSubviewShell(product)` → page |
| 4 | `product / events` | `operation-events` | `OperationEventsPage` | `apps/desktop/src/renderer/pages/operation-events-page.tsx` | App shell → `WorkspaceSubviewShell(product)` → page |
| 5 | `data-preparation / scope` | `operation-scope` | `OperationScopePage` | `apps/desktop/src/renderer/pages/operation-scope-page.tsx` | App shell → `WorkspaceSubviewShell(data-preparation)` → page |
| 6 | `data-preparation / reports` | `data-collection` | `DataCollectionPage` | `apps/desktop/src/renderer/pages/data-collection-page.tsx` | App shell → `WorkspaceSubviewShell(data-preparation)` → page |
| 7 | `data-preparation / import-check` | `data-import-validation` | `DataImportValidationPage` | `apps/desktop/src/renderer/pages/data-import-validation-page.tsx` | App shell → `WorkspaceSubviewShell(data-preparation)` → page |
| 8 | `diagnosis / analysis` | `ad-quant` | `AdQuantPage` | `apps/desktop/src/renderer/pages/ad-quant-page.tsx` | App shell → page workbench + `ResponsiveInspector` |
| 9 | `decisions / recommendations` | `recommendations` | `DecisionsPage` | `apps/desktop/src/renderer/pages/decisions-page.tsx` | App shell → page-owned `PageFrame` + decision tabs + `ResponsiveInspector` |
| 10 | `decisions / approval` | `approval` | `DecisionsPage` | `apps/desktop/src/renderer/pages/decisions-page.tsx` | App shell → page-owned `PageFrame` + decision tabs + `ResponsiveInspector` |
| 11 | `decisions / decided` | `approval` (compatibility alias) | `DecisionsPage` | `apps/desktop/src/renderer/pages/decisions-page.tsx` | App shell → page-owned `PageFrame` + decision tabs + `ResponsiveInspector` |
| 12 | `readback / evidence` | `readback` | `ReadbackPage` | `apps/desktop/src/renderer/pages/readback-page.tsx` | App shell → page-owned `PageFrame` + readback wizard + `ResponsiveInspector` |
| 13 | `growth / keywords` | `keyword-opportunities` | `KeywordOpportunitiesPage` | `apps/desktop/src/renderer/pages/keyword-opportunities-page.tsx` | App shell → `WorkspaceSubviewShell(growth)` → page |
| 14 | `growth / listing` | `listing-optimization` | `ListingOptimizationPage` | `apps/desktop/src/renderer/pages/listing-optimization-page.tsx` | App shell → `WorkspaceSubviewShell(growth)` → page |
| 15 | `system / settings` | `settings` | `SettingsPage` | `apps/desktop/src/renderer/pages/settings-page.tsx` | App shell → `WorkspaceSubviewShell(system)` → page |
| 16 | `system / scheduler` | `scheduler` | `SchedulerPage` | `apps/desktop/src/renderer/pages/scheduler-page.tsx` | App shell → `WorkspaceSubviewShell(system)` → page |
| 17 | `system / delivery` | `delivery` | `DeliveryPage` | `apps/desktop/src/renderer/pages/delivery-page.tsx` | App shell → `WorkspaceSubviewShell(system)` → page |

## Entry point — `apps/desktop/src/renderer/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

## Legacy route identity — `apps/desktop/src/renderer/types.ts`

The complete file also contains the renderer business-domain types; the exact route union used by navigation is:

```ts
export type AppRoute =
  | 'dashboard'
  | 'product-management'
  | 'operation-scope'
  | 'data-collection'
  | 'data-import-validation'
  | 'operation-events'
  | 'product-config'
  | 'ad-quant'
  | 'recommendations'
  | 'approval'
  | 'readback'
  | 'keyword-opportunities'
  | 'listing-optimization'
  | 'scheduler'
  | 'settings'
  | 'delivery';
```

## Full navigation configuration — `apps/desktop/src/renderer/navigation.ts`

```ts
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
```

## Actual page-selection branch — `apps/desktop/src/renderer/App.tsx`

The renderer has no separate router file. This is the complete `BusinessRoutePage` branch used by `App`:

```tsx
function BusinessRoutePage({
  navigation,
  nextSafeAction,
  onNavigate,
  previewMode,
  readbackAuthority,
  previewScenarioId,
}: {
  navigation: NavigationIntent;
  nextSafeAction: NextSafeAction;
  onNavigate: (intent: NavigationIntent) => void;
  previewMode: boolean;
  readbackAuthority: ReadbackAuthority;
  previewScenarioId?: string;
}) {
  const route = resolveNavigationTarget(navigation) || 'dashboard';
  if (navigation.workspace === 'decisions') return <DecisionsPage activeSubview={navigation.subview} />;
  if (navigation.workspace === 'readback') {
    return <ReadbackPage authority={readbackAuthority} previewScenarioId={previewScenarioId} />;
  }
  if (navigation.workspace === 'today') return <DashboardPage nextSafeAction={nextSafeAction} />;
  if (navigation.workspace === 'product') {
    const content = navigation.subview === 'products'
      ? <ProductManagementPage />
      : navigation.subview === 'targets'
        ? <ProductConfigPage />
        : <OperationEventsPage />;
    return (
      <WorkspaceSubviewShell
        description="锁定当前产品，维护经营目标，并记录会影响判断的运营事件。"
        onNavigate={(subview) => onNavigate({ workspace: 'product', subview })}
        ownsPageHeading={navigation.subview === 'products'}
        subview={navigation.subview}
        tabs={WORKSPACE_SUBVIEW_TABS.product}
        workspace="product"
        workspaceLabel="产品工作台"
      >
        {content}
      </WorkspaceSubviewShell>
    );
  }
  if (navigation.workspace === 'data-preparation') {
    const content = navigation.subview === 'scope'
      ? <OperationScopePage />
      : navigation.subview === 'reports'
        ? <DataCollectionPage />
        : <DataImportValidationPage />;
    return (
      <WorkspaceSubviewShell
        description="确认工作范围，补齐八类真实报表，并核对逐类入库结果。"
        onNavigate={(subview) => onNavigate({ workspace: 'data-preparation', subview })}
        subview={navigation.subview}
        tabs={WORKSPACE_SUBVIEW_TABS['data-preparation']}
        workspace="data-preparation"
        workspaceLabel="数据准备"
      >
        {content}
      </WorkspaceSubviewShell>
    );
  }
  if (navigation.workspace === 'diagnosis') return <AdQuantPage />;
  if (navigation.workspace === 'growth') {
    const content = navigation.subview === 'keywords'
      ? <KeywordOpportunitiesPage />
      : <ListingOptimizationPage />;
    return (
      <WorkspaceSubviewShell
        description="从真实关键词机会进入仅本地使用的 Listing 草案流程。"
        onNavigate={(subview) => onNavigate({ workspace: 'growth', subview })}
        subview={navigation.subview}
        tabs={WORKSPACE_SUBVIEW_TABS.growth}
        workspace="growth"
        workspaceLabel="关键词与 Listing"
      >
        {content}
      </WorkspaceSubviewShell>
    );
  }
  if (navigation.workspace === 'system') {
    const content = navigation.subview === 'settings'
      ? <SettingsPage />
      : navigation.subview === 'scheduler'
        ? <SchedulerPage />
        : <DeliveryPage />;
    return (
      <WorkspaceSubviewShell
        description="管理 AI 与规则、自动任务，并核对当前候选包的交付状态。"
        onNavigate={(subview) => onNavigate({ workspace: 'system', subview })}
        previewNotice={previewMode ? '仅开发预览，不代表 APP_READY。预览动作不形成正式交付证据。' : undefined}
        subview={navigation.subview}
        tabs={WORKSPACE_SUBVIEW_TABS.system}
        workspace="system"
        workspaceLabel="系统与交付"
      >
        {content}
      </WorkspaceSubviewShell>
    );
  }
  if (route === 'dashboard') return <DashboardPage nextSafeAction={nextSafeAction} />;
  return <DashboardPage nextSafeAction={nextSafeAction} />;
}
```

