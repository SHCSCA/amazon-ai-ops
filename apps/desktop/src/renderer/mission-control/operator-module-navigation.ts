import type { MissionControlCapabilityProjection } from '@amazon-ai-ops/shared-types';
import type { NavigationIntent } from '../navigation';
import { subviewDefinitionForIntent } from './workspaces/registry';

export type OperatorModuleId =
  | 'today-decisions'
  | 'products-ads'
  | 'collection'
  | 'policy-automation'
  | 'experiments-execution'
  | 'memory-settings';

export interface OperatorModuleEntry {
  intent: NavigationIntent;
  label: string;
  description: string;
  view: MissionControlCapabilityProjection['view'];
}

export interface OperatorModuleDefinition {
  id: OperatorModuleId;
  label: string;
  description: string;
  defaultIntent: NavigationIntent;
  entries: readonly OperatorModuleEntry[];
}

export interface OperatorModuleSearchItem extends OperatorModuleEntry {
  moduleId: OperatorModuleId;
  moduleLabel: string;
  moduleDescription: string;
}

export type OperatorCapabilityAttention = 'blocked' | 'attention' | undefined;

export interface OperatorModuleCapabilityReminder {
  attention: Exclude<OperatorCapabilityAttention, undefined>;
  target: OperatorModuleEntry;
}

function entry(intent: NavigationIntent): OperatorModuleEntry {
  const subview = subviewDefinitionForIntent(intent);
  return {
    intent,
    label: subview.label,
    description: subview.description,
    view: subview.view,
  };
}

export const OPERATOR_MODULES: readonly OperatorModuleDefinition[] = [
  {
    id: 'today-decisions',
    label: '今日与决策',
    description: '从今天要做的事进入任务、分析、建议与审批。',
    defaultIntent: { workspace: 'today', subview: 'overview' },
    entries: [
      entry({ workspace: 'today', subview: 'overview' }),
      entry({ workspace: 'today', subview: 'events' }),
      entry({ workspace: 'missions', subview: 'overview' }),
      entry({ workspace: 'missions', subview: 'facts' }),
      entry({ workspace: 'decisions', subview: 'recommendations' }),
      entry({ workspace: 'decisions', subview: 'approval' }),
      entry({ workspace: 'decisions', subview: 'decided' }),
    ],
  },
  {
    id: 'products-ads',
    label: '产品与广告',
    description: '维护产品目标，并查看广告活动、广告组和关键词事实。',
    defaultIntent: { workspace: 'objects', subview: 'products' },
    entries: [
      entry({ workspace: 'objects', subview: 'products' }),
      entry({ workspace: 'objects', subview: 'targets' }),
      entry({ workspace: 'objects', subview: 'keywords' }),
      entry({ workspace: 'objects', subview: 'listing' }),
    ],
  },
  {
    id: 'collection',
    label: '数据采集',
    description: '选择范围、采集八类报表并核对真实入库结果。',
    defaultIntent: { workspace: 'collection', subview: 'scope' },
    entries: [
      entry({ workspace: 'collection', subview: 'scope' }),
      entry({ workspace: 'collection', subview: 'reports' }),
      entry({ workspace: 'collection', subview: 'import-check' }),
    ],
  },
  {
    id: 'policy-automation',
    label: '策略与自动化',
    description: '配置策略边界、审批条件和定时任务。',
    defaultIntent: { workspace: 'policy', subview: 'rules' },
    entries: [
      entry({ workspace: 'policy', subview: 'rules' }),
      entry({ workspace: 'settings', subview: 'scheduler' }),
    ],
  },
  {
    id: 'experiments-execution',
    label: '实验与执行',
    description: '管理经营实验、可见执行和执行回读。',
    defaultIntent: { workspace: 'experiments', subview: 'ledger' },
    entries: [
      entry({ workspace: 'experiments', subview: 'ledger' }),
      entry({ workspace: 'execution', subview: 'live' }),
      entry({ workspace: 'execution', subview: 'evidence' }),
    ],
  },
  {
    id: 'memory-settings',
    label: '记忆与设置',
    description: '追溯因果链并管理 AI、本地配置和交付检查。',
    defaultIntent: { workspace: 'memory', subview: 'timeline' },
    entries: [
      entry({ workspace: 'memory', subview: 'timeline' }),
      entry({ workspace: 'settings', subview: 'ai-and-local' }),
      entry({ workspace: 'settings', subview: 'delivery' }),
    ],
  },
];

function intentKey(intent: NavigationIntent): string {
  return `${intent.workspace}/${intent.subview}`;
}

const moduleByIntent = new Map(
  OPERATOR_MODULES.flatMap((module) => (
    module.entries.map((moduleEntry) => [intentKey(moduleEntry.intent), module] as const)
  )),
);

export function operatorModuleForIntent(intent: NavigationIntent): OperatorModuleDefinition {
  const module = moduleByIntent.get(intentKey(intent));
  if (!module) throw new Error(`Navigation intent ${intentKey(intent)} has no operator module`);
  return module;
}

export function operatorEntryCapabilityAttention(
  capabilities: readonly MissionControlCapabilityProjection[],
  moduleEntry: OperatorModuleEntry,
): OperatorCapabilityAttention {
  const states = capabilities
    .filter((capability) => capability.view === moduleEntry.view)
    .map((capability) => capability.state);
  if (states.includes('BLOCKED')) return 'blocked';
  if (states.includes('PROTOTYPE_ONLY')) return 'attention';
  return undefined;
}

export function operatorModuleCapabilityAttention(
  capabilities: readonly MissionControlCapabilityProjection[],
  module: OperatorModuleDefinition,
): OperatorCapabilityAttention {
  return operatorModuleCapabilityReminder(capabilities, module)?.attention;
}

export function operatorModuleCapabilityReminder(
  capabilities: readonly MissionControlCapabilityProjection[],
  module: OperatorModuleDefinition,
): OperatorModuleCapabilityReminder | null {
  const affected = module.entries.map((target) => ({
    target,
    attention: operatorEntryCapabilityAttention(capabilities, target),
  }));
  const blocked = affected.find((item) => item.attention === 'blocked');
  if (blocked) return { attention: 'blocked', target: blocked.target };
  const attention = affected.find((item) => item.attention === 'attention');
  return attention ? { attention: 'attention', target: attention.target } : null;
}

export function searchOperatorModuleEntries(query: string): OperatorModuleSearchItem[] {
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  return OPERATOR_MODULES.flatMap((module) => (
    module.entries.map((moduleEntry) => ({
      ...moduleEntry,
      moduleId: module.id,
      moduleLabel: module.label,
      moduleDescription: module.description,
    }))
  )).filter((item) => (
    !normalized
    || `${item.moduleLabel} ${item.label} ${item.description}`
      .toLocaleLowerCase('zh-CN')
      .includes(normalized)
  ));
}
