/**
 * V1.6 Module Bridge Tests
 */

import { describe, it, expect } from 'vitest';
import {
  V16_OPERATOR_MODULES,
  v16OperatorModuleForIntent,
  v16OperatorEntryCapabilityAttention,
  v16OperatorModuleCapabilityAttention,
} from './v16-module-bridge';

describe('V16ModuleBridge', () => {
  it('converts all 6 V16 modules to operator format', () => {
    expect(V16_OPERATOR_MODULES.length).toBe(6);
    expect(V16_OPERATOR_MODULES.map((m) => m.id)).toEqual([
      'today',
      'operations-assets',
      'decision-center',
      'execution-experiments',
      'operating-memory',
      'system-settings',
    ]);
  });

  it('preserves module labels and descriptions', () => {
    const todayModule = V16_OPERATOR_MODULES[0]!;
    expect(todayModule.label).toBe('今日任务');
    expect(todayModule.description).toContain('当前唯一主动作');
  });

  it('converts all 22 intents to entries', () => {
    const totalEntries = V16_OPERATOR_MODULES.reduce(
      (sum, mod) => sum + mod.entries.length,
      0,
    );
    expect(totalEntries).toBe(22);
  });

  it('assigns correct labels to entries', () => {
    const todayModule = V16_OPERATOR_MODULES[0]!;
    expect(todayModule.entries.length).toBe(2);
    expect(todayModule.entries[0]!.label).toBe('今日总览');
    expect(todayModule.entries[1]!.label).toBe('运营事件');
  });

  it('generates unique view identifiers', () => {
    const allViews = V16_OPERATOR_MODULES.flatMap((mod) =>
      mod.entries.map((entry) => entry.view),
    );
    const uniqueViews = new Set(allViews);
    expect(uniqueViews.size).toBe(22);
  });

  it('finds operator module for today:overview intent', () => {
    const module = v16OperatorModuleForIntent({
      workspace: 'today',
      subview: 'overview',
    });
    expect(module.id).toBe('today');
    expect(module.label).toBe('今日任务');
  });

  it('finds operator module for objects:keywords intent', () => {
    const module = v16OperatorModuleForIntent({
      workspace: 'objects',
      subview: 'keywords',
    });
    expect(module.id).toBe('operations-assets');
  });

  it('finds operator module for decisions:approval intent', () => {
    const module = v16OperatorModuleForIntent({
      workspace: 'decisions',
      subview: 'approval',
    });
    expect(module.id).toBe('decision-center');
  });

  it('returns blocked attention when capability is BLOCKED', () => {
    const entry = V16_OPERATOR_MODULES[0]!.entries[0]!;
    const capabilities = [
      {
        capabilityId: 'test.view', workspace: 'today' as const, action: 'view' as const, detail: 'test', view: entry.view,
        state: 'BLOCKED' as const,
        blockerReason: 'test',
      },
    ];
    expect(v16OperatorEntryCapabilityAttention(capabilities, entry)).toBe('blocked');
  });

  it('returns attention when capability is PROTOTYPE_ONLY', () => {
    const entry = V16_OPERATOR_MODULES[0]!.entries[0]!;
    const capabilities = [
      {
        capabilityId: 'test.view', workspace: 'today' as const, action: 'view' as const, detail: 'test', view: entry.view,
        state: 'PROTOTYPE_ONLY' as const,
      },
    ];
    expect(v16OperatorEntryCapabilityAttention(capabilities, entry)).toBe('attention');
  });

  it('returns undefined when no capabilities match', () => {
    const entry = V16_OPERATOR_MODULES[0]!.entries[0]!;
    expect(v16OperatorEntryCapabilityAttention([], entry)).toBeUndefined();
  });

  it('bubbles blocked state to module attention', () => {
    const module = V16_OPERATOR_MODULES[0]!;
    const capabilities = [
      {
        capabilityId: 'test.view', workspace: 'today' as const, action: 'view' as const, detail: 'test', view: module.entries[0]!.view,
        state: 'BLOCKED' as const,
        blockerReason: 'test',
      },
    ];
    expect(v16OperatorModuleCapabilityAttention(capabilities, module)).toBe('blocked');
  });

  it('returns attention when any entry needs attention', () => {
    const module = V16_OPERATOR_MODULES[0]!;
    const capabilities = [
      {
        capabilityId: 'test.view', workspace: 'today' as const, action: 'view' as const, detail: 'test', view: module.entries[0]!.view,
        state: 'PROTOTYPE_ONLY' as const,
      },
    ];
    expect(v16OperatorModuleCapabilityAttention(capabilities, module)).toBe('attention');
  });

  it('prioritizes blocked over attention', () => {
    const module = V16_OPERATOR_MODULES[0]!;
    const capabilities = [
      {
        capabilityId: 'test.view', workspace: 'today' as const, action: 'view' as const, detail: 'test', view: module.entries[0]!.view,
        state: 'BLOCKED' as const,
        blockerReason: 'test',
      },
      {
        capabilityId: 'test.view', workspace: 'today' as const, action: 'view' as const, detail: 'test', view: module.entries[1]!.view,
        state: 'PROTOTYPE_ONLY' as const,
      },
    ];
    expect(v16OperatorModuleCapabilityAttention(capabilities, module)).toBe('blocked');
  });

  it('each module has a valid default intent', () => {
    for (const module of V16_OPERATOR_MODULES) {
      expect(module.defaultIntent).toBeDefined();
      expect(module.defaultIntent.workspace).toBeTruthy();
      expect(module.defaultIntent.subview).toBeTruthy();
    }
  });

  it('operations-assets module contains 7 entries', () => {
    const assetsModule = V16_OPERATOR_MODULES.find((m) => m.id === 'operations-assets');
    expect(assetsModule?.entries.length).toBe(7);
  });

  it('decision-center module contains 5 entries', () => {
    const decisionModule = V16_OPERATOR_MODULES.find((m) => m.id === 'decision-center');
    expect(decisionModule?.entries.length).toBe(5);
  });

  it('system-settings module contains 4 entries', () => {
    const settingsModule = V16_OPERATOR_MODULES.find((m) => m.id === 'system-settings');
    expect(settingsModule?.entries.length).toBe(4);
  });
});
