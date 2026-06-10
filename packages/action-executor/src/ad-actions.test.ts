import { describe, expect, it } from 'vitest';
import { AdActionExecutor } from './ad-actions';
import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';

function recommendation(overrides: Partial<ActionRecommendation> = {}): ActionRecommendation {
  return {
    taskId: 'task_1',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B000TEST',
    msku: 'MSKU-1',
    entityType: 'target',
    entityId: 'target_1',
    entityName: 'bad keyword',
    actionType: 'add_negative_exact',
    currentValue: '1.20',
    recommendedValue: '0.80',
    reason: 'test',
    evidence: {
      impressions: 100,
      clicks: 20,
      cost: 12,
      orders: 0,
      sales: 0,
      acos: 0,
      cpc: 0.6,
      cvr: 0,
    },
    confidence: 0.8,
    riskLevel: 'APPROVAL',
    status: 'approved',
    ...overrides,
  };
}

function locator(methods: Record<string, unknown> = {}) {
  const node: Record<string, unknown> = {
    first: () => node,
    filter: () => node,
    locator: () => locator({ toString: () => 'mock-bid-input' }),
    scrollIntoViewIfNeeded: async () => undefined,
    click: async () => undefined,
    fill: async () => undefined,
    clear: async () => undefined,
    isVisible: async () => true,
    isChecked: async () => false,
    inputValue: async () => '',
    toString: () => 'mock-locator',
    ...methods,
  };
  return node;
}

describe('AdActionExecutor fail-closed behavior', () => {
  it('does not mark a negative keyword action successful when no success toast is visible', async () => {
    const page = {
      locator: (selector: string) =>
        selector === 'text=成功'
          ? locator({ isVisible: async () => false })
          : locator(),
      waitForSelector: async () => undefined,
      waitForTimeout: async () => undefined,
    };
    const executor = new AdActionExecutor(page as any);

    const result = await executor.execute('add_negative_exact', {
      page: page as any,
      recommendation: recommendation({ actionType: 'add_negative_exact' }),
    });

    expect(result.success).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('未检测到成功提示');
  });

  it('does not mark bid changes successful when readback verification fails', async () => {
    const page = {
      locator: (selector: string) => {
        if (selector === 'input[type="number"]') {
          return locator({ isVisible: async () => false });
        }
        if (selector === 'mock-bid-input') {
          return locator({ inputValue: async () => '0.99' });
        }
        return locator();
      },
      keyboard: {
        press: async () => undefined,
      },
      waitForTimeout: async () => undefined,
    };
    const executor = new AdActionExecutor(page as any);

    const result = await executor.execute('lower_bid', {
      page: page as any,
      recommendation: recommendation({ actionType: 'lower_bid' }),
    });

    expect(result.success).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('回读校验失败');
  });
});
