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
      '今日任务',
      '运营资产',
      '决策中心',
      '执行与实验',
      '经营记忆',
      '系统设置',
    ]);

    const intentKeys = OPERATOR_MODULES.flatMap((module) => (
      module.entries.map((entry) => `${entry.intent.workspace}/${entry.intent.subview}`)
    ));
    expect(intentKeys).toHaveLength(22);
    expect(new Set(intentKeys).size).toBe(22);
    expect(operatorModuleForIntent({ workspace: 'settings', subview: 'scheduler' }).id)
      .toBe('system-settings');
    expect(operatorModuleForIntent({ workspace: 'settings', subview: 'ai-and-local' }).id)
      .toBe('system-settings');
    expect(operatorModuleForIntent({ workspace: 'settings', subview: 'delivery' }).id)
      .toBe('system-settings');
  });

  it('searches the same facade entries instead of returning the old ten workspaces', () => {
    expect(searchOperatorModuleEntries('')).toHaveLength(22);
    expect(searchOperatorModuleEntries('定时')).toEqual([
      expect.objectContaining({
        moduleLabel: '系统设置',
        label: '定时任务',
        intent: { workspace: 'settings', subview: 'scheduler' },
      }),
    ]);
    expect(searchOperatorModuleEntries('执行与实验').map((item) => item.label)).toEqual([
      '可见执行', '执行回读', '实验台账',
    ]);
  });

  it('summarizes capability reminders by operator module with fail-closed priority', () => {
    const productsModule = OPERATOR_MODULES.find((module) => module.id === 'operations-assets')!;
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
    const automationModule = OPERATOR_MODULES.find((module) => module.id === 'system-settings')!;
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
