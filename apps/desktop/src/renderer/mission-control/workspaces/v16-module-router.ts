/**
 * V1.6 Six-Module IA Router
 *
 * Maps the six V1.6 business modules to existing legacy/canonical workspaces.
 * Phase 4 introduces the six-module information architecture as the primary
 * navigation surface, with the existing eight workspaces preserved as
 * subroutes.
 *
 * The six modules per the V1.6 PRD:
 *  1. 今日任务       (Today)          — current progress, blocker, next action
 *  2. 运营资产       (Operations Assets) — products, advertising objects, 8-report collection
 *  3. 决策中心       (Decision Center) — analysis runs, recommendations, decisions, grants
 *  4. 执行与实验     (Execution & Experiments) — preflight, live execution, experiments
 *  5. 经营记忆       (Operating Memory) — causal timeline, six-stage search, export
 *  6. 系统设置       (System Settings) — stores, ERP/Ads connection, policy, scheduler
 *
 * @module v16-module-router
 */

export type V16ModuleId =
  | 'today'
  | 'operations-assets'
  | 'decision-center'
  | 'execution-experiments'
  | 'operating-memory'
  | 'system-settings';

export interface V16ModuleDefinition {
  readonly id: V16ModuleId;
  readonly label: string;
  readonly description: string;
  /** Ordered list of legacy/canonical workspace ids that fall under this module. */
  readonly workspaceIds: readonly string[];
  /** Single primary action label for first-screen task rail. */
  readonly primaryActionLabel: string;
}

export const V16_SIX_MODULES: readonly V16ModuleDefinition[] = [
  {
    id: 'today',
    label: '今日任务',
    description: '当前唯一主动作、准备度摘要、最近一次验证。',
    workspaceIds: ['today'],
    primaryActionLabel: '查看今日总览',
  },
  {
    id: 'operations-assets',
    label: '运营资产',
    description: '产品、广告对象路径、exact 8/8 报表、Listing 本地草案。',
    workspaceIds: ['objects', 'collection'],
    primaryActionLabel: '校对 8 类报表完成度',
  },
  {
    id: 'decision-center',
    label: '决策中心',
    description: 'Analysis Runs、AI 建议、Decision 历史、MissionGrant 详情。',
    workspaceIds: ['missions', 'decisions'],
    primaryActionLabel: '查看待审批建议',
  },
  {
    id: 'execution-experiments',
    label: '执行与实验',
    description: 'preflight gates、可见执行、三段回读、Experiment 跟踪。',
    workspaceIds: ['execution', 'experiments'],
    primaryActionLabel: '查看执行与实验',
  },
  {
    id: 'operating-memory',
    label: '经营记忆',
    description: '六阶段因果时间线、可信索引、correction 追加、安全导出。',
    workspaceIds: ['memory'],
    primaryActionLabel: '查看因果时间线',
  },
  {
    id: 'system-settings',
    label: '系统设置',
    description: '店铺、ERP/Ads 连接、写入模式、策略版本、scheduler、AI config。',
    workspaceIds: ['policy', 'settings'],
    primaryActionLabel: '进入系统设置',
  },
] as const;

const moduleById: ReadonlyMap<V16ModuleId, V16ModuleDefinition> = new Map(
  V16_SIX_MODULES.map((m) => [m.id, m] as const),
);

const moduleByWorkspace: ReadonlyMap<string, V16ModuleDefinition> = (() => {
  const map = new Map<string, V16ModuleDefinition>();
  for (const mod of V16_SIX_MODULES) {
    for (const ws of mod.workspaceIds) {
      if (!map.has(ws)) map.set(ws, mod);
    }
  }
  return map;
})();

/**
 * Look up the six-module definition for a module id.
 * Returns null when the module id is unknown.
 */
export function getModuleById(id: string): V16ModuleDefinition | null {
  return moduleById.get(id as V16ModuleId) ?? null;
}

/**
 * Find the parent six-module for a workspace id.
 * Useful for breadcrumb / navigation context.
 */
export function findModuleForWorkspace(workspaceId: string): V16ModuleDefinition | null {
  return moduleByWorkspace.get(workspaceId) ?? null;
}

/**
 * Total module count for the six-module contract.
 */
export const V16_MODULE_COUNT = V16_SIX_MODULES.length;

/**
 * Ordered module ids (used for cycle detection and reporting).
 */
export const V16_MODULE_ORDER: readonly V16ModuleId[] = V16_SIX_MODULES.map((m) => m.id);

/**
 * Assert that the six-module contract is intact: each workspace belongs to at most one module.
 * Throws when a workspace id is repeated across modules.
 */
export function assertModulesContract(): void {
  const seen = new Set<string>();
  for (const mod of V16_SIX_MODULES) {
    for (const ws of mod.workspaceIds) {
      if (seen.has(ws)) {
        throw new Error(`Workspace ${ws} belongs to multiple V1.6 modules — IA contract broken`);
      }
      seen.add(ws);
    }
  }
  if (V16_SIX_MODULES.length !== 6) {
    throw new Error(`V1.6 must expose exactly 6 business modules (got ${V16_SIX_MODULES.length})`);
  }
}

/**
 * Extended module information with intent mappings.
 */
export interface V16ModuleWithIntents extends V16ModuleDefinition {
  readonly intents: readonly NavigationIntent[];
}

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

/**
 * Complete mapping of all 22 intents to the six modules.
 * This ensures every navigation intent has exactly one parent module.
 */
export const V16_MODULE_INTENT_MAP: readonly V16ModuleWithIntents[] = [
  {
    ...V16_SIX_MODULES[0], // 今日任务
    intents: [
      { workspace: 'today', subview: 'overview' },
      { workspace: 'today', subview: 'events' },
    ],
  },
  {
    ...V16_SIX_MODULES[1], // 运营资产
    intents: [
      { workspace: 'objects', subview: 'products' },
      { workspace: 'objects', subview: 'targets' },
      { workspace: 'objects', subview: 'keywords' },
      { workspace: 'objects', subview: 'listing' },
      { workspace: 'collection', subview: 'scope' },
      { workspace: 'collection', subview: 'reports' },
      { workspace: 'collection', subview: 'import-check' },
    ],
  },
  {
    ...V16_SIX_MODULES[2], // 决策中心
    intents: [
      { workspace: 'missions', subview: 'overview' },
      { workspace: 'missions', subview: 'facts' },
      { workspace: 'decisions', subview: 'recommendations' },
      { workspace: 'decisions', subview: 'approval' },
      { workspace: 'decisions', subview: 'decided' },
    ],
  },
  {
    ...V16_SIX_MODULES[3], // 执行与实验
    intents: [
      { workspace: 'execution', subview: 'live' },
      { workspace: 'execution', subview: 'evidence' },
      { workspace: 'experiments', subview: 'ledger' },
    ],
  },
  {
    ...V16_SIX_MODULES[4], // 经营记忆
    intents: [
      { workspace: 'memory', subview: 'timeline' },
    ],
  },
  {
    ...V16_SIX_MODULES[5], // 系统设置
    intents: [
      { workspace: 'policy', subview: 'rules' },
      { workspace: 'settings', subview: 'ai-and-local' },
      { workspace: 'settings', subview: 'scheduler' },
      { workspace: 'settings', subview: 'delivery' },
    ],
  },
] as const;

function intentKey(intent: NavigationIntent): string {
  return `${intent.workspace}:${intent.subview}`;
}

const intentToModule = new Map<string, V16ModuleWithIntents>(
  V16_MODULE_INTENT_MAP.flatMap((module) =>
    module.intents.map((intent) => [intentKey(intent), module] as const),
  ),
);

/**
 * Find the parent six-module for a navigation intent.
 * Returns null when the intent is unknown.
 */
export function findModuleForIntent(intent: NavigationIntent): V16ModuleWithIntents | null {
  return intentToModule.get(intentKey(intent)) ?? null;
}

/**
 * Assert that all 22 intents are mapped to exactly one module.
 * Throws when an intent is missing or duplicated.
 */
export function assertIntentCoverage(): void {
  const expected = 22;
  const actual = V16_MODULE_INTENT_MAP.reduce((sum, mod) => sum + mod.intents.length, 0);
  if (actual !== expected) {
    throw new Error(`V1.6 must map exactly ${expected} intents (got ${actual})`);
  }
  
  const seen = new Set<string>();
  for (const mod of V16_MODULE_INTENT_MAP) {
    for (const intent of mod.intents) {
      const key = intentKey(intent);
      if (seen.has(key)) {
        throw new Error(`Intent ${key} belongs to multiple V1.6 modules — IA contract broken`);
      }
      seen.add(key);
    }
  }
}
