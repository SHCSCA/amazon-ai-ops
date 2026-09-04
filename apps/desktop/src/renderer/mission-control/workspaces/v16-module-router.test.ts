/**
 * V1.6 Six Module Router Tests
 */

import { describe, it, expect } from 'vitest';
import {
  V16_SIX_MODULES,
  V16_MODULE_COUNT,
  V16_MODULE_ORDER,
  V16_MODULE_INTENT_MAP,
  assertModulesContract,
  assertIntentCoverage,
  findModuleForWorkspace,
  findModuleForIntent,
  getModuleById,
} from './v16-module-router';

describe('V16SixModuleRouter', () => {
  it('exposes exactly six modules', () => {
    expect(V16_MODULE_COUNT).toBe(6);
    expect(V16_MODULE_ORDER.length).toBe(6);
  });

  it('includes all six PRD modules by id', () => {
    const ids = V16_SIX_MODULES.map((m) => m.id);
    expect(ids).toEqual([
      'today',
      'operations-assets',
      'decision-center',
      'execution-experiments',
      'operating-memory',
      'system-settings',
    ]);
  });

  it('uses Chinese labels', () => {
    for (const mod of V16_SIX_MODULES) {
      expect(mod.label).toMatch(/[\u4e00-\u9fa5]/);
    }
  });

  it('does not duplicate any workspace across modules', () => {
    expect(() => assertModulesContract()).not.toThrow();
  });

  it('maps all 10 workspaces to modules', () => {
    expect(findModuleForWorkspace('today')?.id).toBe('today');
    expect(findModuleForWorkspace('objects')?.id).toBe('operations-assets');
    expect(findModuleForWorkspace('collection')?.id).toBe('operations-assets');
    expect(findModuleForWorkspace('missions')?.id).toBe('decision-center');
    expect(findModuleForWorkspace('decisions')?.id).toBe('decision-center');
    expect(findModuleForWorkspace('execution')?.id).toBe('execution-experiments');
    expect(findModuleForWorkspace('experiments')?.id).toBe('execution-experiments');
    expect(findModuleForWorkspace('memory')?.id).toBe('operating-memory');
    expect(findModuleForWorkspace('policy')?.id).toBe('system-settings');
    expect(findModuleForWorkspace('settings')?.id).toBe('system-settings');
  });

  it('findModuleForWorkspace returns null for unknown workspace', () => {
    expect(findModuleForWorkspace('nope')).toBeNull();
  });

  it('getModuleById resolves by id', () => {
    expect(getModuleById('today')?.label).toBe('今日任务');
    expect(getModuleById('nope')).toBeNull();
  });

  it('maps exactly 22 intents across all modules', () => {
    expect(() => assertIntentCoverage()).not.toThrow();
    const totalIntents = V16_MODULE_INTENT_MAP.reduce(
      (sum, mod) => sum + mod.intents.length,
      0,
    );
    expect(totalIntents).toBe(22);
  });

  it('today module contains 2 intents', () => {
    const todayModule = V16_MODULE_INTENT_MAP.find((m) => m.id === 'today');
    expect(todayModule?.intents.length).toBe(2);
    expect(todayModule?.intents).toContainEqual({ workspace: 'today', subview: 'overview' });
    expect(todayModule?.intents).toContainEqual({ workspace: 'today', subview: 'events' });
  });

  it('operations-assets module contains 7 intents', () => {
    const assetsModule = V16_MODULE_INTENT_MAP.find((m) => m.id === 'operations-assets');
    expect(assetsModule?.intents.length).toBe(7);
    expect(assetsModule?.intents).toContainEqual({ workspace: 'objects', subview: 'products' });
    expect(assetsModule?.intents).toContainEqual({ workspace: 'objects', subview: 'targets' });
    expect(assetsModule?.intents).toContainEqual({ workspace: 'objects', subview: 'keywords' });
    expect(assetsModule?.intents).toContainEqual({ workspace: 'objects', subview: 'listing' });
    expect(assetsModule?.intents).toContainEqual({ workspace: 'collection', subview: 'scope' });
    expect(assetsModule?.intents).toContainEqual({ workspace: 'collection', subview: 'reports' });
    expect(assetsModule?.intents).toContainEqual({ workspace: 'collection', subview: 'import-check' });
  });

  it('decision-center module contains 5 intents', () => {
    const decisionModule = V16_MODULE_INTENT_MAP.find((m) => m.id === 'decision-center');
    expect(decisionModule?.intents.length).toBe(5);
    expect(decisionModule?.intents).toContainEqual({ workspace: 'missions', subview: 'overview' });
    expect(decisionModule?.intents).toContainEqual({ workspace: 'missions', subview: 'facts' });
    expect(decisionModule?.intents).toContainEqual({ workspace: 'decisions', subview: 'recommendations' });
    expect(decisionModule?.intents).toContainEqual({ workspace: 'decisions', subview: 'approval' });
    expect(decisionModule?.intents).toContainEqual({ workspace: 'decisions', subview: 'decided' });
  });

  it('execution-experiments module contains 3 intents', () => {
    const execModule = V16_MODULE_INTENT_MAP.find((m) => m.id === 'execution-experiments');
    expect(execModule?.intents.length).toBe(3);
    expect(execModule?.intents).toContainEqual({ workspace: 'execution', subview: 'live' });
    expect(execModule?.intents).toContainEqual({ workspace: 'execution', subview: 'evidence' });
    expect(execModule?.intents).toContainEqual({ workspace: 'experiments', subview: 'ledger' });
  });

  it('operating-memory module contains 1 intent', () => {
    const memoryModule = V16_MODULE_INTENT_MAP.find((m) => m.id === 'operating-memory');
    expect(memoryModule?.intents.length).toBe(1);
    expect(memoryModule?.intents).toContainEqual({ workspace: 'memory', subview: 'timeline' });
  });

  it('system-settings module contains 4 intents', () => {
    const settingsModule = V16_MODULE_INTENT_MAP.find((m) => m.id === 'system-settings');
    expect(settingsModule?.intents.length).toBe(4);
    expect(settingsModule?.intents).toContainEqual({ workspace: 'policy', subview: 'rules' });
    expect(settingsModule?.intents).toContainEqual({ workspace: 'settings', subview: 'ai-and-local' });
    expect(settingsModule?.intents).toContainEqual({ workspace: 'settings', subview: 'scheduler' });
    expect(settingsModule?.intents).toContainEqual({ workspace: 'settings', subview: 'delivery' });
  });

  it('findModuleForIntent resolves all 22 intents', () => {
    expect(findModuleForIntent({ workspace: 'today', subview: 'overview' })?.id).toBe('today');
    expect(findModuleForIntent({ workspace: 'today', subview: 'events' })?.id).toBe('today');

    expect(findModuleForIntent({ workspace: 'objects', subview: 'products' })?.id).toBe('operations-assets');
    expect(findModuleForIntent({ workspace: 'objects', subview: 'targets' })?.id).toBe('operations-assets');
    expect(findModuleForIntent({ workspace: 'objects', subview: 'keywords' })?.id).toBe('operations-assets');
    expect(findModuleForIntent({ workspace: 'objects', subview: 'listing' })?.id).toBe('operations-assets');
    expect(findModuleForIntent({ workspace: 'collection', subview: 'scope' })?.id).toBe('operations-assets');
    expect(findModuleForIntent({ workspace: 'collection', subview: 'reports' })?.id).toBe('operations-assets');
    expect(findModuleForIntent({ workspace: 'collection', subview: 'import-check' })?.id).toBe('operations-assets');

    expect(findModuleForIntent({ workspace: 'missions', subview: 'overview' })?.id).toBe('decision-center');
    expect(findModuleForIntent({ workspace: 'missions', subview: 'facts' })?.id).toBe('decision-center');
    expect(findModuleForIntent({ workspace: 'decisions', subview: 'recommendations' })?.id).toBe('decision-center');
    expect(findModuleForIntent({ workspace: 'decisions', subview: 'approval' })?.id).toBe('decision-center');
    expect(findModuleForIntent({ workspace: 'decisions', subview: 'decided' })?.id).toBe('decision-center');

    expect(findModuleForIntent({ workspace: 'execution', subview: 'live' })?.id).toBe('execution-experiments');
    expect(findModuleForIntent({ workspace: 'execution', subview: 'evidence' })?.id).toBe('execution-experiments');
    expect(findModuleForIntent({ workspace: 'experiments', subview: 'ledger' })?.id).toBe('execution-experiments');

    expect(findModuleForIntent({ workspace: 'memory', subview: 'timeline' })?.id).toBe('operating-memory');

    expect(findModuleForIntent({ workspace: 'policy', subview: 'rules' })?.id).toBe('system-settings');
    expect(findModuleForIntent({ workspace: 'settings', subview: 'ai-and-local' })?.id).toBe('system-settings');
    expect(findModuleForIntent({ workspace: 'settings', subview: 'scheduler' })?.id).toBe('system-settings');
    expect(findModuleForIntent({ workspace: 'settings', subview: 'delivery' })?.id).toBe('system-settings');
  });

  it('findModuleForIntent returns null for unknown intent', () => {
    expect(findModuleForIntent({ workspace: 'nope' as any, subview: 'nope' as any })).toBeNull();
  });
});
