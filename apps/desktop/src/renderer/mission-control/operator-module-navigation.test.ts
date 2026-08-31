import { describe, expect, it } from 'vitest';
import type { MissionControlCapabilityProjection } from '@amazon-ai-ops/shared-types';
import {
  OPERATOR_MODULES,
  operatorModuleCapabilityAttention,
  operatorModuleCapabilityReminder,
  operatorModuleForIntent,
  searchOperatorModuleEntries,
} from './operator-module-navigation';

describe('operator module navigation facade', () => {
  it('presents six operator modules while preserving every canonical intent exactly once', () => {
    expect(OPERATOR_MODULES.map((module) => module.label)).toEqual([
      '今日与决策',
      '产品与广告',
      '数据采集',
      '策略与自动化',
      '实验与执行',
      '记忆与设置',
    ]);

    const intentKeys = OPERATOR_MODULES.flatMap((module) => (
      module.entries.map((entry) => `${entry.intent.workspace}/${entry.intent.subview}`)
    ));
    expect(intentKeys).toHaveLength(22);
    expect(new Set(intentKeys).size).toBe(22);
    expect(operatorModuleForIntent({ workspace: 'settings', subview: 'scheduler' }).id)
      .toBe('policy-automation');
    expect(operatorModuleForIntent({ workspace: 'settings', subview: 'ai-and-local' }).id)
      .toBe('memory-settings');
    expect(operatorModuleForIntent({ workspace: 'settings', subview: 'delivery' }).id)
      .toBe('memory-settings');
  });

  it('searches the same facade entries instead of returning the old ten workspaces', () => {
    expect(searchOperatorModuleEntries('')).toHaveLength(22);
    expect(searchOperatorModuleEntries('定时')).toEqual([
      expect.objectContaining({
        moduleLabel: '策略与自动化',
        label: '定时任务',
        intent: { workspace: 'settings', subview: 'scheduler' },
      }),
    ]);
    expect(searchOperatorModuleEntries('实验与执行').map((item) => item.label)).toEqual([
      '实验台账', '可见执行', '执行回读',
    ]);
  });

  it('summarizes capability reminders by operator module with fail-closed priority', () => {
    const productsModule = OPERATOR_MODULES.find((module) => module.id === 'products-ads')!;
    const capabilities = [
      {
        capabilityId: 'objects.products.view', workspace: 'objects', view: 'objects/products',
        action: 'view', state: 'LEGACY_ADAPTER', legacyRoute: 'product-management', detail: '已接入',
      },
      {
        capabilityId: 'objects.targets.view', workspace: 'objects', view: 'objects/targets',
        action: 'view', state: 'PROTOTYPE_ONLY', detail: '待核对',
      },
    ] satisfies MissionControlCapabilityProjection[];

    expect(operatorModuleCapabilityAttention(capabilities, productsModule)).toBe('attention');
    expect(operatorModuleCapabilityAttention([
      ...capabilities,
      {
        capabilityId: 'objects.products.update', workspace: 'objects', view: 'objects/products',
        action: 'update', state: 'BLOCKED', blockerCode: 'PRODUCT_REQUIRED', detail: '请先选择产品',
      },
    ], productsModule)).toBe('blocked');
  });

  it('routes a module reminder to the exact affected entry instead of the module default', () => {
    const automationModule = OPERATOR_MODULES.find((module) => module.id === 'policy-automation')!;
    const capabilities = [{
      capabilityId: 'settings.scheduler.run-now', workspace: 'settings', view: 'settings/scheduler',
      action: 'start', state: 'BLOCKED', blockerCode: 'SCHEDULE_NOT_READY', detail: '定时任务尚未就绪',
    }] satisfies MissionControlCapabilityProjection[];

    expect(operatorModuleCapabilityReminder(capabilities, automationModule)).toEqual({
      attention: 'blocked',
      target: expect.objectContaining({
        intent: { workspace: 'settings', subview: 'scheduler' },
        label: '定时任务',
      }),
    });
  });
});
