import { describe, expect, it } from 'vitest';
import { productCostInputHint } from './product-config-page';

describe('productCostInputHint', () => {
  it('warns when cost fields still look like the default template', () => {
    expect(productCostInputHint({
      purchaseCost: 0,
      firstLegCost: 0,
      fbaFee: 0,
      referralFeeRate: 0.15,
      storageFee: 0,
      otherCost: 0,
      minPrice: 0,
      targetNetMargin: 0.15,
      targetAcos: 0.35,
      targetTacos: 0.12,
    })).toContain('默认值');
  });

  it('acknowledges when real cost or price fields have been filled', () => {
    expect(productCostInputHint({
      purchaseCost: 12,
      firstLegCost: 1.5,
      fbaFee: 3,
      referralFeeRate: 0.15,
      storageFee: 0,
      otherCost: 0,
      minPrice: 29.99,
      targetNetMargin: 0.15,
      targetAcos: 0.35,
      targetTacos: 0.12,
    })).toBe('已填写成本或最低售价；保存前请确认这些数字来自当前产品。');
  });
});
