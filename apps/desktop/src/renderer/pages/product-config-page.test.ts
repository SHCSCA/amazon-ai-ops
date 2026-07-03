import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildProductConfigBulkApplyState,
  buildProductConfigBulkSaveInput,
  buildCostInputFromProduct,
  productConfigActionButtonView,
  productConfigBulkSelectionState,
  productConfigLoadButtonView,
  productConfigRowHealthView,
  productConfigRowTargetAcosView,
  productConfigRowClass,
  buildProductConfigTaskState,
  isProductConfigAutoSaveField,
  normalizeProductConfigAcosPercent,
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
    })).toBe('已填写成本或最低可接受售价；保存前请确认这些数字来自当前产品。');
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

  it('gives direct save actions an explicit busy contract', () => {
    const saving = productConfigActionButtonView({
      active: true,
      baseClassName: 'primary-button',
      busyLabel: '保存中...',
      label: '保存完整产品配置',
    });

    expect(saving.label).toBe('保存中...');
    expect(saving.className).toContain('primary-button');
    expect(saving.className).toContain('button-loading');
    expect(saving.disabled).toBe(true);
    expect(saving.ariaBusy).toBe(true);
    expect(saving.showSpinner).toBe(true);

    const lockedPeer = productConfigActionButtonView({
      active: false,
      baseClassName: 'secondary-button',
      busyLabel: '处理中...',
      groupBusy: true,
      label: '进入广告量化',
    });

    expect(lockedPeer.label).toBe('进入广告量化');
    expect(lockedPeer.disabled).toBe(true);
    expect(lockedPeer.ariaBusy).toBeUndefined();
    expect(lockedPeer.className).not.toContain('button-loading');
    expect(lockedPeer.showSpinner).toBe(false);
  });

  it('confirms which product row is loaded for editing', () => {
    expect(productConfigRowClass({ bulkSelected: false, loaded: true })).toContain('product-config-row-loaded');
    expect(productConfigRowClass({ bulkSelected: true, loaded: true })).toContain('product-config-row-selected');

    const loaded = productConfigLoadButtonView({ loaded: true });
    expect(loaded.label).toBe('已载入');
    expect(loaded.ariaPressed).toBe(true);
    expect(loaded.className).toContain('product-config-load-button-active');

    const idle = productConfigLoadButtonView({ loaded: false });
    expect(idle.label).toBe('载入编辑');
    expect(idle.ariaPressed).toBe(false);
    expect(idle.className).not.toContain('product-config-load-button-active');
  });

  it('builds row-level target ACOS editing feedback for the product table', () => {
    expect(productConfigRowTargetAcosView({
      asin: 'B001',
      draftValue: undefined,
      disabled: false,
      productTargetAcos: 0.35,
      status: 'idle',
    })).toMatchObject({
      ariaLabel: '编辑 B001 目标 ACOS',
      className: 'product-row-acos-field',
      disabled: false,
      feedbackLabel: '',
      inputValue: '35.00',
    });

    expect(productConfigRowTargetAcosView({
      asin: 'B001',
      draftValue: '28.5',
      disabled: false,
      productTargetAcos: 0.35,
      status: 'saving',
    })).toMatchObject({
      className: 'product-row-acos-field product-row-acos-field-saving',
      disabled: true,
      feedbackLabel: '目标 ACOS 保存中...',
      inputValue: '28.5',
    });

    expect(productConfigRowTargetAcosView({
      asin: 'B001',
      draftValue: '28.5',
      disabled: false,
      productTargetAcos: 0.35,
      status: 'saved',
    }).feedbackLabel).toBe('目标 ACOS 已保存');

    expect(productConfigRowTargetAcosView({
      asin: 'B001',
      draftValue: '140',
      disabled: false,
      productTargetAcos: 0.35,
      status: 'error',
    }).feedbackLabel).toBe('目标 ACOS 保存失败');
  });

  it('styles row-level target ACOS editing feedback without shifting the table row', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.product-row-acos-field');
    expect(css).toContain('.product-row-acos-status');
    expect(css).toContain('.product-row-acos-field-saved');
  });

  it('builds row-level target ACOS health feedback for the product table', () => {
    expect(productConfigRowHealthView({ targetAcos: 0.3 })).toMatchObject({
      className: 'product-row-health product-row-health-ready',
      detail: '目标 ACOS 30.00%',
      label: '目标正常',
      tone: 'ready',
    });

    expect(productConfigRowHealthView({ targetAcos: 0.45 })).toMatchObject({
      className: 'product-row-health product-row-health-warning',
      label: '需复核',
      tone: 'warning',
    });

    expect(productConfigRowHealthView({ targetAcos: 0.75 })).toMatchObject({
      className: 'product-row-health product-row-health-blocked',
      label: '高风险',
      tone: 'blocked',
    });

    expect(productConfigRowHealthView({ targetAcos: 0 })).toMatchObject({
      className: 'product-row-health product-row-health-pending',
      detail: '未配置目标 ACOS',
      label: '待配置',
      tone: 'pending',
    });
  });

  it('styles row-level product health status as a fixed table chip', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.product-row-health');
    expect(css).toContain('.product-row-health-detail');
    expect(css).toContain('.product-row-health-blocked');
  });

  it('styles the loaded product row and active load button as visible feedback', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.product-config-row-loaded td');
    expect(css).toContain('.product-config-load-button-active');
    expect(css).toContain('event-card-flash');
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

describe('product config bulk ACOS apply', () => {
  it('summarizes selected products with count, progress, and aria feedback', () => {
    expect(productConfigBulkSelectionState({
      selectedCount: 0,
      totalProducts: 4,
    })).toMatchObject({
      ariaStatus: '当前未选择产品；批量目标 ACOS 不会作用于任何产品。',
      countClassName: 'product-bulk-selection-count',
      countLabel: '已选 0/4 个产品',
      progressPercent: 0,
      progressStyle: { '--product-bulk-selection-progress': '0%' },
      tone: 'pending',
    });

    expect(productConfigBulkSelectionState({
      selectedCount: 3,
      totalProducts: 4,
    })).toMatchObject({
      ariaStatus: '已选择 3 个产品，批量目标 ACOS 只会写入这些本地产品配置。',
      countClassName: 'product-bulk-selection-count product-bulk-selection-count-active',
      countLabel: '已选 3/4 个产品',
      progressPercent: 75,
      progressStyle: { '--product-bulk-selection-progress': '75%' },
      tone: 'ready',
    });
  });

  it('styles bulk product selection count and progress as visible feedback', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.product-bulk-selection-count');
    expect(css).toContain('.product-bulk-selection-progress');
    expect(css).toContain('--product-bulk-selection-progress');
  });

  it('turns operator percent input into product target ACOS decimal values', () => {
    expect(normalizeProductConfigAcosPercent('35')).toBe(0.35);
    expect(normalizeProductConfigAcosPercent(12.5)).toBe(0.125);
    expect(normalizeProductConfigAcosPercent('not-a-number')).toBeNull();
  });

  it('builds a disabled state until products and a valid percent are selected', () => {
    expect(buildProductConfigBulkApplyState({
      totalProducts: 3,
      selectedCount: 0,
      targetAcosPercent: 35,
      applying: false,
    })).toMatchObject({
      canApply: false,
      primaryActionLabel: '先勾选产品',
      statusTone: 'pending',
    });

    expect(buildProductConfigBulkApplyState({
      totalProducts: 3,
      selectedCount: 2,
      targetAcosPercent: 35,
      applying: false,
    })).toMatchObject({
      canApply: true,
      primaryActionLabel: '应用到 2 个产品',
      targetAcos: 0.35,
      statusTone: 'ready',
    });

    expect(buildProductConfigBulkApplyState({
      totalProducts: 3,
      selectedCount: 2,
      targetAcosPercent: 140,
      applying: false,
    })).toMatchObject({
      canApply: false,
      statusTone: 'blocked',
    });
  });

  it('preserves product identity and cost fields while replacing only target ACOS', () => {
    const input = buildProductConfigBulkSaveInput({
      asin: 'B001',
      parent_asin: 'P001',
      msku: 'MSKU-1',
      sku: 'SKU-1',
      title: 'Smart Lock',
      product_stage: 'scaling',
      status: 'active',
      cost: {
        purchaseCost: 12,
        minPrice: 39.99,
        targetAcos: 0.25,
        targetTacos: 0.12,
      },
    }, {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
    }, 0.35);

    expect(input.product).toMatchObject({
      asin: 'B001',
      parentAsin: 'P001',
      msku: 'MSKU-1',
      sku: 'SKU-1',
      title: 'Smart Lock',
      productStage: 'scaling',
      status: 'active',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
    });
    expect(input.cost).toMatchObject({
      purchaseCost: 12,
      minPrice: 39.99,
      targetAcos: 0.35,
      targetTacos: 0.12,
    });
  });
});
