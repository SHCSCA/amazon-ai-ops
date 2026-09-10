import type { MissionControlCapabilityProjection } from '@amazon-ai-ops/shared-types';
import type { NavigationIntent } from '../navigation';
import { V16_MODULE_INTENT_MAP, type V16ModuleId } from './workspaces/v16-module-router';
import { subviewDefinitionForIntent } from './workspaces/registry';

export type OperatorModuleId = V16ModuleId;

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

export const OPERATOR_MODULES: readonly OperatorModuleDefinition[] = V16_MODULE_INTENT_MAP.map(module => ({
  id: module.id,
  label: module.label,
  description: module.description,
  defaultIntent: module.intents[0]!,
  entries: module.intents.map(entry),
}));

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
