/**
 * V1.6 Module Bridge
 * 
 * Bridges the V1.6 six-module IA to the existing OperatorModuleSidebar
 * without requiring a full UI rewrite.
 * 
 * Strategy: Convert V16 modules to the OperatorModule format so the
 * existing sidebar can render them while maintaining full compatibility.
 */

import type { NavigationIntent } from '../../navigation';
import type { MissionControlCapabilityProjection } from '@amazon-ai-ops/shared-types';
import type {
  V16ModuleId,
  V16ModuleDefinition,
  V16ModuleWithIntents,
} from './v16-module-router';
import {
  V16_MODULE_INTENT_MAP,
  findModuleForIntent,
} from './v16-module-router';

/**
 * Operator module format expected by OperatorModuleSidebar.
 */
export interface OperatorModuleEntry {
  intent: NavigationIntent;
  label: string;
  description: string;
  view: string; // capability view identifier
}

export interface OperatorModuleDef {
  id: string;
  label: string;
  description: string;
  defaultIntent: NavigationIntent;
  entries: readonly OperatorModuleEntry[];
}

/**
 * Map V16 module IDs to capability view prefixes.
 */
const V16_MODULE_VIEW_PREFIX: Record<V16ModuleId, string> = {
  'today': 'today',
  'operations-assets': 'assets',
  'decision-center': 'decision',
  'execution-experiments': 'execution',
  'operating-memory': 'memory',
  'system-settings': 'settings',
};

/**
 * Generate a capability view identifier for an intent.
 */
function intentToView(intent: NavigationIntent, moduleId: V16ModuleId): string {
  return `${V16_MODULE_VIEW_PREFIX[moduleId]}:${intent.workspace}:${intent.subview}`;
}

/**
 * Map V16 intent to operator entry label.
 */
const INTENT_LABELS: Record<string, string> = {
  'today:overview': '今日总览',
  'today:events': '运营事件',
  'objects:products': '产品与目标',
  'objects:targets': '成本与目标',
  'objects:keywords': '关键词机会',
  'objects:listing': 'Listing 草案',
  'collection:scope': '采集范围',
  'collection:reports': '采集任务',
  'collection:import-check': '导入检查',
  'missions:overview': '运营任务队列',
  'missions:facts': '广告事实',
  'decisions:recommendations': '待判断',
  'decisions:approval': '待审批',
  'decisions:decided': '已处理',
  'execution:live': '可见执行',
  'execution:evidence': '执行回读',
  'experiments:ledger': '经营实验',
  'memory:timeline': '因果时间线',
  'policy:rules': '策略与风控',
  'settings:ai-and-local': 'AI 与本地',
  'settings:scheduler': '定时任务',
  'settings:delivery': '交付验收',
};

/**
 * Map V16 intent to operator entry description.
 */
const INTENT_DESCRIPTIONS: Record<string, string> = {
  'today:overview': '查看当前店铺的下一安全动作与运营事实',
  'today:events': '记录会影响当日判断的运营上下文',
  'objects:products': '维护当前店铺的产品、成本与经营目标',
  'objects:targets': '维护利润边界与广告目标',
  'objects:keywords': '筛选可行动的真实关键词机会',
  'objects:listing': '生成并导出仅本地使用的 Listing 草案',
  'collection:scope': '确认日期、店铺、站点与产品范围',
  'collection:reports': '获取完整八类真实业务报表',
  'collection:import-check': '核对逐类入库与指标口径',
  'missions:overview': '查看目标、约束、检查点与运行状态',
  'missions:facts': '复用真实广告诊断与量化事实',
  'decisions:recommendations': '复核系统建议与证据边界',
  'decisions:approval': '只处理需要人工签发的动作',
  'decisions:decided': '回看已签发或已拒绝的决定',
  'execution:live': '查看当前领星会话、执行步骤与接管入口',
  'execution:evidence': '补齐执行前、执行后与 Reload 回读证据',
  'experiments:ledger': '把经营干预记录成可验证实验',
  'memory:timeline': '检索事实、动作、结果与因果链',
  'policy:rules': '管理模式、限额、熔断与审批边界',
  'settings:ai-and-local': '配置 AI 连接与本地运行选项',
  'settings:scheduler': '检查自动任务状态与最近结果',
  'settings:delivery': '核对当前候选包与正式交付门槛',
};

function intentKey(intent: NavigationIntent): string {
  return `${intent.workspace}:${intent.subview}`;
}

/**
 * Convert a V16 module to OperatorModule format.
 */
function v16ModuleToOperatorModule(v16Module: V16ModuleWithIntents): OperatorModuleDef {
  const entries: OperatorModuleEntry[] = v16Module.intents.map((intent) => {
    const key = intentKey(intent);
    return {
      intent,
      label: INTENT_LABELS[key] || `${intent.workspace}:${intent.subview}`,
      description: INTENT_DESCRIPTIONS[key] || v16Module.description,
      view: intentToView(intent, v16Module.id),
    };
  });

  return {
    id: v16Module.id,
    label: v16Module.label,
    description: v16Module.description,
    defaultIntent: entries[0]?.intent ?? { workspace: 'today', subview: 'overview' },
    entries,
  };
}

/**
 * Get all six V16 modules in OperatorModule format.
 */
export const V16_OPERATOR_MODULES: readonly OperatorModuleDef[] = 
  V16_MODULE_INTENT_MAP.map(v16ModuleToOperatorModule);

/**
 * Find the operator module for a navigation intent.
 */
export function v16OperatorModuleForIntent(intent: NavigationIntent): OperatorModuleDef {
  const v16Module = findModuleForIntent(intent);
  if (!v16Module) {
    // Fallback to first module if not found
    return V16_OPERATOR_MODULES[0]!;
  }
  return V16_OPERATOR_MODULES.find((m) => m.id === v16Module.id) ?? V16_OPERATOR_MODULES[0]!;
}

/**
 * Check if an operator entry should show attention state.
 */
export function v16OperatorEntryCapabilityAttention(
  capabilities: readonly MissionControlCapabilityProjection[],
  entry: OperatorModuleEntry,
): 'blocked' | 'attention' | undefined {
  const states = capabilities
    .filter((cap) => cap.view === entry.view)
    .map((cap) => cap.state);
  
  if (states.includes('BLOCKED')) return 'blocked';
  if (states.includes('PROTOTYPE_ONLY')) return 'attention';
  return undefined;
}

/**
 * Check if a module should show attention state.
 */
export function v16OperatorModuleCapabilityAttention(
  capabilities: readonly MissionControlCapabilityProjection[],
  module: OperatorModuleDef,
): 'blocked' | 'attention' | undefined {
  const affected = module.entries.map((entry) => ({
    entry,
    attention: v16OperatorEntryCapabilityAttention(capabilities, entry),
  }));
  
  const blocked = affected.find((item) => item.attention === 'blocked');
  if (blocked) return 'blocked';
  
  const attention = affected.find((item) => item.attention === 'attention');
  return attention ? 'attention' : undefined;
}
