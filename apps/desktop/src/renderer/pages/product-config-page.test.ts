import { describe, expect, it } from 'vitest';
import {
  buildCostInputFromProduct,
  buildProductConfigTaskState,
  isProductConfigAutoSaveField,
  productConfigMetricTone,
  productConfigNudgeCostValue,
  productConfigInlineSaveLabel,
  productCostInputHint,
} from './product-config-page';

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

  it('hydrates editable cost fields from loaded product rows', () => {
    expect(buildCostInputFromProduct({
      cost: {
        purchaseCost: 12,
        targetAcos: 0.28,
        minPrice: 39.99,
      },
    })).toEqual(expect.objectContaining({
      purchaseCost: 12,
      targetAcos: 0.28,
      minPrice: 39.99,
      referralFeeRate: 0.15,
    }));
  });
});

describe('product config task and inline save feedback', () => {
  it('builds a first-screen task around product target maintenance', () => {
    const task = buildProductConfigTaskState({
      asin: 'B001',
      configuredProducts: 2,
      importedRows: 2416,
      saving: false,
    });

    expect(task.title).toContain('B001');
    expect(task.detail).toContain('2416');
    expect(task.primaryActionLabel).toBe('保存目标配置');
    expect(task.primaryActionDisabled).toBe(false);
    expect(task.secondaryActionLabel).toBe('进入广告量化');
  });

  it('keeps the task action disabled until ASIN is present', () => {
    const task = buildProductConfigTaskState({
      asin: '',
      configuredProducts: 0,
      importedRows: 0,
      saving: false,
    });

    expect(task.title).toContain('先填写 ASIN');
    expect(task.primaryActionDisabled).toBe(true);
    expect(task.primaryActionLabel).toBe('先填写 ASIN');
  });

  it('identifies cost and target fields that autosave on blur or Enter', () => {
    expect(isProductConfigAutoSaveField('targetAcos')).toBe(true);
    expect(isProductConfigAutoSaveField('targetTacos')).toBe(true);
    expect(isProductConfigAutoSaveField('minPrice')).toBe(true);
    expect(isProductConfigAutoSaveField('notAField')).toBe(false);
  });

  it('formats inline save feedback for target fields', () => {
    expect(productConfigInlineSaveLabel('targetAcos', 'saving')).toBe('目标 ACOS 保存中...');
    expect(productConfigInlineSaveLabel('targetAcos', 'saved')).toBe('目标 ACOS 已保存');
    expect(productConfigInlineSaveLabel('targetAcos', 'error')).toBe('目标 ACOS 保存失败');
    expect(productConfigInlineSaveLabel('targetAcos', 'idle')).toBe('');
  });

  it('nudges cost and target values with keyboard-safe bounds', () => {
    expect(productConfigNudgeCostValue('minPrice', 39.99, 'up', '0.5')).toBe(40.49);
    expect(productConfigNudgeCostValue('purchaseCost', 0, 'down', '0.01')).toBe(0);
    expect(productConfigNudgeCostValue('targetAcos', 0.35, 'up', '0.01')).toBe(0.36);
    expect(productConfigNudgeCostValue('targetAcos', 1, 'up', '0.01')).toBe(1);
  });

  it('maps live product target values to status chip tones', () => {
    expect(productConfigMetricTone('grossCost', 0)).toBe('pending');
    expect(productConfigMetricTone('grossCost', 18)).toBe('ready');
    expect(productConfigMetricTone('margin', -0.02)).toBe('blocked');
    expect(productConfigMetricTone('margin', 0.08)).toBe('warning');
    expect(productConfigMetricTone('margin', 0.18)).toBe('ready');
    expect(productConfigMetricTone('targetAcos', 0.75)).toBe('blocked');
    expect(productConfigMetricTone('targetAcos', 0.45)).toBe('warning');
    expect(productConfigMetricTone('targetAcos', 0.3)).toBe('ready');
  });
});
