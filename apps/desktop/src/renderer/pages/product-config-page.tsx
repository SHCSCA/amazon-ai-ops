import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { OperatorTaskPanel } from '../components/operator-task-panel';
import { FormTable, FormTableRow, PageHeader, Panel, StatusPill } from '../components/ui';
import { formatPercent, formatUsd } from '../formatters';
import { useScopeStore } from '../scope-store';
import type { AppRoute } from '../types';
import { toUserFacingError } from '../user-facing-error';

type ProductStage = 'cold_start' | 'keyword_exploration' | 'stable_conversion' | 'scaling' | 'profit_harvesting' | 'declining_repair';

const STAGE_OPTIONS: Array<{ value: ProductStage; label: string; description: string }> = [
  { value: 'cold_start', label: '冷启动', description: '数据少，允许适度试错，但要严格观察点击和首单。' },
  { value: 'keyword_exploration', label: '测词期', description: '重点找有效搜索词，阈值可比利润期宽松。' },
  { value: 'stable_conversion', label: '稳定转化', description: '已有稳定订单，重点控 ACOS 和预算效率。' },
  { value: 'scaling', label: '放量期', description: '可接受阶段性更高 ACOS，但必须跟踪库存和转化。' },
  { value: 'profit_harvesting', label: '利润收割', description: '严格控制 ACOS，优先降本和保利润。' },
  { value: 'declining_repair', label: '异常修复', description: '转化或 ACOS 异常，优先排查价格、库存、Listing 和流量质量。' },
];

export const DEFAULT_COST = {
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
};

type ProductCostInput = typeof DEFAULT_COST;
type ProductCostKey = keyof ProductCostInput;
type InlineSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type ProductConfigMetricKey = 'grossCost' | 'margin' | 'targetAcos' | 'targetTacos';
type ProductConfigMetricTone = 'ready' | 'warning' | 'blocked' | 'pending';

interface ProductConfigActionButtonInput {
  active: boolean;
  baseClassName: string;
  label: string;
  busyLabel: string;
  disabled?: boolean;
  groupBusy?: boolean;
}

export interface ProductConfigActionButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
}

export interface ProductConfigLoadButtonView {
  ariaPressed: boolean;
  className: string;
  label: string;
}

export function productConfigActionButtonView({
  active,
  baseClassName,
  label,
  busyLabel,
  disabled = false,
  groupBusy = false,
}: ProductConfigActionButtonInput): ProductConfigActionButtonView {
  return {
    ariaBusy: active ? true : undefined,
    className: [baseClassName, active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(disabled || active || groupBusy),
    label: active ? busyLabel : label,
    showSpinner: active,
  };
}

export function productConfigRowClass(input: { bulkSelected: boolean; loaded: boolean }): string {
  return [
    input.bulkSelected ? 'product-config-row-selected' : '',
    input.loaded ? 'product-config-row-loaded' : '',
  ].filter(Boolean).join(' ');
}

export function productConfigLoadButtonView(input: { loaded: boolean }): ProductConfigLoadButtonView {
  return {
    ariaPressed: input.loaded,
    className: [
      'secondary-button compact-button product-config-load-button',
      input.loaded ? 'product-config-load-button-active' : '',
    ].filter(Boolean).join(' '),
    label: input.loaded ? '已载入' : '载入编辑',
  };
}

const PRODUCT_COST_FIELD_LABELS: Record<ProductCostKey, string> = {
  purchaseCost: '采购成本',
  firstLegCost: '头程费用',
  fbaFee: 'FBA 费用',
  referralFeeRate: '推荐费率',
  storageFee: '仓储费',
  otherCost: '其他成本',
  minPrice: '最低售价',
  targetNetMargin: '目标净利率',
  targetAcos: '目标 ACOS',
  targetTacos: '目标 TACOS',
};

export function buildCostInputFromProduct(product: any): ProductCostInput {
  const source = product?.cost || {};
  const numberOrDefault = (key: keyof ProductCostInput) => {
    const value = Number(source[key]);
    return Number.isFinite(value) ? value : DEFAULT_COST[key];
  };
  return {
    purchaseCost: numberOrDefault('purchaseCost'),
    firstLegCost: numberOrDefault('firstLegCost'),
    fbaFee: numberOrDefault('fbaFee'),
    referralFeeRate: numberOrDefault('referralFeeRate'),
    storageFee: numberOrDefault('storageFee'),
    otherCost: numberOrDefault('otherCost'),
    minPrice: numberOrDefault('minPrice'),
    targetNetMargin: numberOrDefault('targetNetMargin'),
    targetAcos: numberOrDefault('targetAcos'),
    targetTacos: numberOrDefault('targetTacos'),
  };
}

export function productCostInputHint(cost: ProductCostInput): string {
  const hasRealCostOrPrice = [
    cost.purchaseCost,
    cost.firstLegCost,
    cost.fbaFee,
    cost.storageFee,
    cost.otherCost,
    cost.minPrice,
  ].some((value) => Number(value || 0) > 0);
  if (!hasRealCostOrPrice) {
    return '当前成本和最低售价仍像默认值；保存前请替换为真实采购、物流、FBA、售价和利润目标，避免 AI 阈值被模板数字误导。';
  }
  return '已填写成本或最低售价；保存前请确认这些数字来自当前产品。';
}

export function isProductConfigAutoSaveField(key: string): key is ProductCostKey {
  return Object.prototype.hasOwnProperty.call(PRODUCT_COST_FIELD_LABELS, key);
}

export function productConfigInlineSaveLabel(key: string, status: InlineSaveStatus): string {
  if (!isProductConfigAutoSaveField(key) || status === 'idle') return '';
  const label = PRODUCT_COST_FIELD_LABELS[key];
  if (status === 'saving') return `${label} 保存中...`;
  if (status === 'saved') return `${label} 已保存`;
  return `${label} 保存失败`;
}

const RATE_COST_FIELDS = new Set<ProductCostKey>(['referralFeeRate', 'targetNetMargin', 'targetAcos', 'targetTacos']);

function stepPrecision(step: string): number {
  const decimal = String(step || '').split('.')[1];
  return Math.max(2, decimal?.length || 0);
}

export function productConfigNudgeCostValue(
  key: ProductCostKey,
  value: number,
  direction: 'up' | 'down',
  step = '0.01',
): number {
  const delta = Math.abs(Number(step) || 0.01);
  const current = Number.isFinite(Number(value)) ? Number(value) : 0;
  const next = current + (direction === 'up' ? delta : -delta);
  const clampedLow = Math.max(0, next);
  const clamped = RATE_COST_FIELDS.has(key) ? Math.min(1, clampedLow) : clampedLow;
  return Number(clamped.toFixed(stepPrecision(step)));
}

export function productConfigMetricTone(metric: ProductConfigMetricKey, value: number): ProductConfigMetricTone {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'pending';
  if (metric === 'grossCost') return numeric > 0 ? 'ready' : 'pending';
  if (metric === 'margin') {
    if (numeric < 0) return 'blocked';
    if (numeric < 0.1) return 'warning';
    return 'ready';
  }
  if (metric === 'targetAcos') {
    if (numeric <= 0) return 'pending';
    if (numeric > 0.7) return 'blocked';
    if (numeric > 0.4) return 'warning';
    return 'ready';
  }
  if (numeric <= 0) return 'pending';
  if (numeric > 0.45) return 'blocked';
  if (numeric > 0.3) return 'warning';
  return 'ready';
}

export function buildProductConfigTaskState(input: {
  asin?: string;
  configuredProducts: number;
  importedRows: number;
  saving: boolean;
}) {
  const asin = String(input.asin || '').trim().toUpperCase();
  const hasAsin = Boolean(asin);
  return {
    title: hasAsin ? `维护 ${asin} 的产品目标` : '先填写 ASIN，再维护产品目标',
    detail: hasAsin
      ? `当前范围已有 ${input.importedRows} 行广告指标，${input.configuredProducts} 个产品配置；成本、最低价、目标 ACOS/TACOS 会进入 AI 阈值判断。`
      : '产品目标必须先绑定 ASIN，否则广告量化只能按全局默认阈值解释 ACOS 和花费。',
    primaryActionLabel: input.saving ? '保存中...' : hasAsin ? '保存目标配置' : '先填写 ASIN',
    primaryActionBusy: input.saving,
    primaryActionBusyLabel: '保存中...',
    primaryActionDisabled: input.saving || !hasAsin,
    secondaryActionLabel: '进入广告量化',
  };
}

export function normalizeProductConfigAcosPercent(value: string | number): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) return null;
  return Number((parsed / 100).toFixed(4));
}

export function productConfigProductKey(product: any): string {
  return String(product?.id ?? product?.asin ?? '');
}

export function productConfigBulkSelectionState(input: {
  selectedCount: number;
  totalProducts: number;
}) {
  const totalProducts = Math.max(0, Number(input.totalProducts) || 0);
  const selectedCount = totalProducts > 0
    ? Math.min(Math.max(0, Number(input.selectedCount) || 0), totalProducts)
    : 0;
  const progressPercent = totalProducts > 0 ? Math.round((selectedCount / totalProducts) * 100) : 0;
  const hasSelection = selectedCount > 0;

  return {
    ariaStatus: totalProducts > 0
      ? hasSelection
        ? `已选择 ${selectedCount} 个产品，批量目标 ACOS 只会写入这些本地产品配置。`
        : '当前未选择产品；批量目标 ACOS 不会作用于任何产品。'
      : '当前范围暂无产品；批量目标 ACOS 不会作用于任何产品。',
    countClassName: [
      'product-bulk-selection-count',
      hasSelection ? 'product-bulk-selection-count-active' : '',
    ].filter(Boolean).join(' '),
    countLabel: `已选 ${selectedCount}/${totalProducts} 个产品`,
    progressPercent,
    progressStyle: { '--product-bulk-selection-progress': `${progressPercent}%` } as React.CSSProperties,
    tone: hasSelection ? 'ready' : 'pending',
  };
}

export function buildProductConfigBulkApplyState(input: {
  totalProducts: number;
  selectedCount: number;
  targetAcosPercent: string | number;
  applying: boolean;
}) {
  const targetAcos = normalizeProductConfigAcosPercent(input.targetAcosPercent);
  const targetPercent = Number(input.targetAcosPercent);
  const validTarget = targetAcos !== null;
  const targetAcosLabel = validTarget ? `${targetPercent.toFixed(2)}%` : '-';
  const hasProducts = input.totalProducts > 0;
  const hasSelection = input.selectedCount > 0;
  const canApply = hasProducts && hasSelection && validTarget && !input.applying;
  let statusTone: ProductConfigMetricTone = 'pending';
  let statusMessage = hasProducts ? `${input.selectedCount}/${input.totalProducts} 个产品已勾选` : '当前范围暂无产品';
  if (!validTarget) {
    statusTone = 'blocked';
    statusMessage = '目标 ACOS 必须为 0 到 100 之间的百分比';
  } else if (!hasProducts) {
    statusTone = 'pending';
  } else if (!hasSelection) {
    statusTone = 'pending';
  } else if (input.applying) {
    statusTone = 'warning';
    statusMessage = `正在应用 ${targetAcosLabel}`;
  } else {
    statusTone = 'ready';
    statusMessage = `将 ${targetAcosLabel} 应用到 ${input.selectedCount} 个产品`;
  }
  return {
    canApply,
    primaryActionLabel: input.applying ? '批量应用中...' : hasSelection ? `应用到 ${input.selectedCount} 个产品` : '先勾选产品',
    statusTone,
    statusMessage,
    targetAcos,
    targetAcosLabel,
  };
}

export function buildProductConfigBulkSaveInput(product: any, scope: { storeName: string; marketplaceCode: string }, targetAcos: number) {
  return {
    product: {
      asin: String(product?.asin || '').trim(),
      parentAsin: product?.parent_asin || product?.parentAsin || '',
      msku: product?.msku || '',
      sku: product?.sku || '',
      title: product?.title || '',
      productStage: product?.product_stage || product?.productStage || 'keyword_exploration',
      status: product?.status || 'active',
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
    },
    cost: {
      ...buildCostInputFromProduct(product),
      targetAcos,
    },
  };
}

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

function toNumber(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stageLabel(stage?: string): string {
  return STAGE_OPTIONS.find((item) => item.value === stage)?.label || stage || '未配置';
}

export function ProductConfigPage() {
  const { scope } = useScopeStore();
  const { data } = useBusinessDataPipeline();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dirtyCostFields, setDirtyCostFields] = useState<Partial<Record<ProductCostKey, boolean>>>({});
  const [inlineSave, setInlineSave] = useState<{ field?: ProductCostKey; status: InlineSaveStatus }>({ status: 'idle' });
  const [nudgedCostField, setNudgedCostField] = useState<ProductCostKey | null>(null);
  const [bulkSelectedProductKeys, setBulkSelectedProductKeys] = useState<string[]>([]);
  const [bulkTargetAcosPercent, setBulkTargetAcosPercent] = useState(35);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkFeedback, setBulkFeedback] = useState('');
  const [bulkFeedbackTone, setBulkFeedbackTone] = useState<ProductConfigMetricTone>('pending');
  const nudgeTimerRef = useRef<number | null>(null);
  const [draft, setDraft] = useState({
    asin: scope.asin || '',
    parentAsin: '',
    msku: '',
    sku: '',
    title: '',
    productStage: 'keyword_exploration' as ProductStage,
    status: 'active',
  });
  const [cost, setCost] = useState(DEFAULT_COST);
  const currentScopeProducts = useMemo(
    () => products.filter((item) => item.store_name === scope.storeName && item.marketplace_code === scope.marketplaceCode),
    [products, scope.marketplaceCode, scope.storeName],
  );
  const selectedStage = STAGE_OPTIONS.find((item) => item.value === draft.productStage);
  const grossCost = cost.purchaseCost + cost.firstLegCost + cost.fbaFee + cost.storageFee + cost.otherCost;
  const minPriceMargin = cost.minPrice > 0
    ? (cost.minPrice - grossCost - cost.minPrice * cost.referralFeeRate) / cost.minPrice
    : 0;
  const importedRows = data?.collection.fileAudit?.importedRowCount ?? data?.quant.importedRows ?? 0;
  const costHint = productCostInputHint(cost);
  const taskState = buildProductConfigTaskState({
    asin: draft.asin,
    configuredProducts: currentScopeProducts.length,
    importedRows,
    saving,
  });
  const selectedBulkKeySet = useMemo(() => new Set(bulkSelectedProductKeys), [bulkSelectedProductKeys]);
  const selectedBulkProducts = useMemo(
    () => currentScopeProducts.filter((product) => selectedBulkKeySet.has(productConfigProductKey(product))),
    [currentScopeProducts, selectedBulkKeySet],
  );
  const bulkApplyState = buildProductConfigBulkApplyState({
    totalProducts: currentScopeProducts.length,
    selectedCount: selectedBulkProducts.length,
    targetAcosPercent: bulkTargetAcosPercent,
    applying: bulkApplying,
  });
  const bulkSelectionState = productConfigBulkSelectionState({
    selectedCount: selectedBulkProducts.length,
    totalProducts: currentScopeProducts.length,
  });
  const saveConfigButton = productConfigActionButtonView({
    active: saving,
    baseClassName: 'primary-button',
    busyLabel: '保存中...',
    disabled: !draft.asin.trim(),
    label: '保存完整产品配置',
  });
  const operationEventsButton = productConfigActionButtonView({
    active: false,
    baseClassName: 'secondary-button',
    busyLabel: '处理中...',
    groupBusy: saving,
    label: '补充运营事件',
  });
  const adQuantButton = productConfigActionButtonView({
    active: false,
    baseClassName: 'secondary-button',
    busyLabel: '处理中...',
    groupBusy: saving,
    label: '进入广告量化',
  });
  const bulkApplyButton = productConfigActionButtonView({
    active: bulkApplying,
    baseClassName: 'primary-button',
    busyLabel: '批量应用中...',
    disabled: !bulkApplyState.canApply,
    label: bulkApplyState.primaryActionLabel,
  });
  const allCurrentProductsSelected = currentScopeProducts.length > 0
    && currentScopeProducts.every((product) => selectedBulkKeySet.has(productConfigProductKey(product)));
  const loadedProduct = currentScopeProducts.find((product) => (
    String(product.asin || '').trim().toUpperCase() === draft.asin.trim().toUpperCase()
  ));
  const loadedProductRowKey = loadedProduct ? productConfigProductKey(loadedProduct) : '';

  async function loadProducts() {
    setLoading(true);
    setError('');
    try {
      const rows = await (window as any).electronAPI?.getProducts?.();
      setProducts(Array.isArray(rows) ? rows : []);
    } catch (caught) {
      setError(toUserFacingError(caught, '读取产品配置失败。'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      asin: current.asin || scope.asin || '',
    }));
    loadProducts();
  }, [scope.asin, scope.storeName, scope.marketplaceCode]);

  useEffect(() => () => {
    if (nudgeTimerRef.current) window.clearTimeout(nudgeTimerRef.current);
  }, []);

  useEffect(() => {
    const currentKeys = new Set(currentScopeProducts.map(productConfigProductKey));
    setBulkSelectedProductKeys((current) => {
      const next = current.filter((key) => currentKeys.has(key));
      return next.length === current.length ? current : next;
    });
  }, [currentScopeProducts]);

  function loadProduct(product: any) {
    setDraft({
      asin: product.asin || '',
      parentAsin: product.parent_asin || '',
      msku: product.msku || '',
      sku: product.sku || '',
      title: product.title || '',
      productStage: product.product_stage || 'keyword_exploration',
      status: product.status || 'active',
    });
    setCost(buildCostInputFromProduct(product));
    setDirtyCostFields({});
    setInlineSave({ status: 'idle' });
    setMessage(`已载入 ${product.asin}，成本配置如需复用请重新确认后保存。`);
  }

  async function saveProductConfig(options: { source?: 'manual' | 'inline'; field?: ProductCostKey } = {}) {
    setSaving(true);
    if (options.source === 'inline' && options.field) {
      setInlineSave({ field: options.field, status: 'saving' });
    } else {
      setMessage('');
      setInlineSave({ status: 'idle' });
    }
    setError('');
    try {
      if (!draft.asin.trim()) throw new Error('请填写 ASIN。');
      const result = await (window as any).electronAPI?.saveProductConfig?.({
        product: {
          ...draft,
          asin: draft.asin.trim(),
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
        },
        cost,
      });
      if (!result?.success) throw new Error('保存接口没有返回成功状态。');
      if (options.source === 'inline' && options.field) {
        setDirtyCostFields((current) => ({ ...current, [options.field as ProductCostKey]: false }));
        setInlineSave({ field: options.field, status: 'saved' });
        setMessage(`${PRODUCT_COST_FIELD_LABELS[options.field]} 已保存，AI 阈值会读取新的产品边界。`);
        window.setTimeout(() => setInlineSave((current) => (
          current.field === options.field && current.status === 'saved' ? { status: 'idle' } : current
        )), 900);
      } else {
        setDirtyCostFields({});
        setMessage('产品配置已保存。后续 AI 阶段诊断和动态阈值会优先参考产品阶段、目标 ACOS、毛利和成本边界。');
      }
      window.dispatchEvent(new Event('business-ui:data-updated'));
      await loadProducts();
    } catch (caught) {
      if (options.source === 'inline' && options.field) {
        setInlineSave({ field: options.field, status: 'error' });
      }
      setError(toUserFacingError(caught, '保存产品配置失败。'));
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    await saveProductConfig({ source: 'manual' });
  }

  function toggleBulkProduct(productKey: string, checked: boolean) {
    setBulkSelectedProductKeys((current) => {
      if (checked) return Array.from(new Set([...current, productKey]));
      return current.filter((key) => key !== productKey);
    });
  }

  function toggleAllBulkProducts(checked: boolean) {
    setBulkSelectedProductKeys(checked ? currentScopeProducts.map(productConfigProductKey).filter(Boolean) : []);
  }

  async function applyBulkTargetAcos() {
    if (!bulkApplyState.canApply || bulkApplyState.targetAcos === null) {
      setBulkFeedback(bulkApplyState.statusMessage);
      setBulkFeedbackTone(bulkApplyState.statusTone);
      return;
    }
    const targetAcos = bulkApplyState.targetAcos;
    const targetLabel = bulkApplyState.targetAcosLabel;
    const selectedRows = selectedBulkProducts;
    setBulkApplying(true);
    setBulkFeedback(`正在把目标 ACOS ${targetLabel} 应用到 ${selectedRows.length} 个产品...`);
    setBulkFeedbackTone('warning');
    setError('');
    try {
      for (const product of selectedRows) {
        const result = await (window as any).electronAPI?.saveProductConfig?.(
          buildProductConfigBulkSaveInput(product, scope, targetAcos),
        );
        if (!result?.success) throw new Error(`产品 ${product.asin || '-'} 保存失败。`);
      }
      if (selectedRows.some((product) => String(product.asin || '').toUpperCase() === draft.asin.trim().toUpperCase())) {
        setCost((current) => ({ ...current, targetAcos }));
      }
      setBulkSelectedProductKeys([]);
      setBulkFeedback(`已把目标 ACOS ${targetLabel} 应用到 ${selectedRows.length} 个产品。`);
      setBulkFeedbackTone('ready');
      window.dispatchEvent(new Event('business-ui:data-updated'));
      await loadProducts();
    } catch (caught) {
      setBulkFeedback('批量应用失败，已保留勾选。');
      setBulkFeedbackTone('blocked');
      setError(toUserFacingError(caught, '批量应用目标 ACOS 失败。'));
    } finally {
      setBulkApplying(false);
    }
  }

  function updateCost(key: ProductCostKey, value: string) {
    setCost((current) => ({ ...current, [key]: toNumber(value) }));
    setDirtyCostFields((current) => ({ ...current, [key]: true }));
    if (inlineSave.field === key && inlineSave.status !== 'saving') setInlineSave({ status: 'idle' });
  }

  function nudgeCost(key: ProductCostKey, direction: 'up' | 'down', step: string) {
    setCost((current) => ({ ...current, [key]: productConfigNudgeCostValue(key, current[key], direction, step) }));
    setDirtyCostFields((current) => ({ ...current, [key]: true }));
    if (inlineSave.field === key && inlineSave.status !== 'saving') setInlineSave({ status: 'idle' });
    setNudgedCostField(key);
    if (nudgeTimerRef.current) window.clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = window.setTimeout(() => setNudgedCostField(null), 650);
  }

  async function commitCostField(key: ProductCostKey) {
    if (saving || !dirtyCostFields[key]) return;
    await saveProductConfig({ source: 'inline', field: key });
  }

  function renderCostInput(key: ProductCostKey, step = '0.01') {
    const status = inlineSave.field === key ? inlineSave.status : 'idle';
    const saveLabel = productConfigInlineSaveLabel(key, status);
    const feedbackLabel = saveLabel || (nudgedCostField === key ? `${PRODUCT_COST_FIELD_LABELS[key]} 已调整，失焦或回车保存` : '');
    return (
      <div className={[
        'inline-save-field',
        status !== 'idle' ? `inline-save-field-${status}` : '',
        nudgedCostField === key ? 'inline-save-field-nudged' : '',
      ].filter(Boolean).join(' ')}>
        <input
          aria-label={PRODUCT_COST_FIELD_LABELS[key]}
          title="使用上下方向键微调；失焦或回车保存。"
          type="number"
          inputMode="decimal"
          step={step}
          value={cost[key]}
          onBlur={() => { void commitCostField(key); }}
          onChange={(event) => updateCost(key, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              nudgeCost(key, event.key === 'ArrowUp' ? 'up' : 'down', step);
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              void commitCostField(key);
            }
          }}
        />
        <span className="inline-save-status" aria-live="polite">{feedbackLabel}</span>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="数据与量化"
        title="产品配置"
        description="维护产品阶段、成本、利润目标和广告目标。AI 量化阈值不能只看固定 ACOS，必须结合产品所处阶段和利润空间。"
        primaryTask="补齐产品阶段与利润约束"
        nextAction={draft.asin ? '保存产品配置' : '填写 ASIN'}
      />

      <div className="business-stack">
        <OperatorTaskPanel
          eyebrow="当前任务"
          title={taskState.title}
          detail={taskState.detail}
          primaryAction={{
            label: taskState.primaryActionLabel,
            busy: taskState.primaryActionBusy,
            busyLabel: taskState.primaryActionBusyLabel,
            disabled: taskState.primaryActionDisabled,
            onClick: save,
          }}
          secondaryActions={[
            {
              label: taskState.secondaryActionLabel,
              onClick: () => navigate('ad-quant'),
            },
            {
              label: '补充运营事件',
              onClick: () => navigate('operation-events'),
            },
          ]}
        >
          <div className="dashboard-task-metrics" aria-label="产品配置任务摘要">
            <StatusPill tone={currentScopeProducts.length ? 'ready' : 'pending'}>配置 {currentScopeProducts.length}</StatusPill>
            <span>指标 {importedRows} 行</span>
            <span>目标 ACOS {formatPercent(cost.targetAcos * 100)}</span>
            <span>失焦或回车即时保存</span>
          </div>
        </OperatorTaskPanel>

        <Panel title="当前范围产品配置" tone="warning">
          <div className="business-split">
            <div>
              <div className="business-scope-line">
                {scope.dateFrom} 至 {scope.dateTo} / {scope.storeName} / {scope.marketplaceCode} / USD
              </div>
              <p className="muted-line">
                当前范围已有 {importedRows} 行广告指标。产品阶段和利润目标会进入 AI 阶段判断，帮助决定目标 ACOS、高风险 ACOS、无订单点击和最低花费阈值。
              </p>
            </div>
            <StatusPill tone={currentScopeProducts.length ? 'ready' : 'pending'}>已配置产品 {currentScopeProducts.length}</StatusPill>
          </div>
        </Panel>

        <Panel title="产品基础信息">
          <FormTable>
            <FormTableRow label="ASIN" required hint="当前产品配置的主键；保存后进入 AI 阶段判断和动态阈值。">
              <input value={draft.asin} onChange={(event) => setDraft({ ...draft, asin: event.target.value })} placeholder="例如 B0..." />
            </FormTableRow>
            <FormTableRow label="Parent ASIN" hint="可选；用于后续父子体汇总。">
              <input value={draft.parentAsin} onChange={(event) => setDraft({ ...draft, parentAsin: event.target.value })} />
            </FormTableRow>
            <FormTableRow label="MSKU" hint="可选；便于运营识别本地 SKU。">
              <input value={draft.msku} onChange={(event) => setDraft({ ...draft, msku: event.target.value })} />
            </FormTableRow>
            <FormTableRow label="SKU" hint="可选；与 ERP 或 Amazon 后台 SKU 对齐。">
              <input value={draft.sku} onChange={(event) => setDraft({ ...draft, sku: event.target.value })} />
            </FormTableRow>
            <FormTableRow label="标题" hint="产品标题只用于运营识别，不自动改写 Listing。">
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="产品标题，便于运营识别" />
            </FormTableRow>
            <FormTableRow label="产品阶段" required hint={selectedStage?.description || '不同阶段会影响 AI 对目标 ACOS、放量和降价的解释。'}>
              <select value={draft.productStage} onChange={(event) => setDraft({ ...draft, productStage: event.target.value as ProductStage })}>
                {STAGE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </FormTableRow>
            <FormTableRow label="状态" required hint="状态用于提示规则引擎是否应保守处理扩量、清货或暂停产品。">
              <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                <option value="active">正常运营</option>
                <option value="paused">暂停推广</option>
                <option value="clearance">清货</option>
                <option value="watch">观察</option>
              </select>
            </FormTableRow>
          </FormTable>
          <div className="operation-hint">
            <strong>{stageLabel(draft.productStage)}</strong>
            <p>{selectedStage?.description}</p>
          </div>
        </Panel>

        <Panel title="利润与广告目标">
          <p className={cost.purchaseCost || cost.firstLegCost || cost.fbaFee || cost.minPrice ? 'muted-line' : 'warning-line'}>
            {costHint}
          </p>
          <FormTable>
            <FormTableRow label="采购成本" hint="单位 USD；商品采购成本。">
              {renderCostInput('purchaseCost')}
            </FormTableRow>
            <FormTableRow label="头程费用" hint="单位 USD；头程、清关或入仓前费用。">
              {renderCostInput('firstLegCost')}
            </FormTableRow>
            <FormTableRow label="FBA 费用" hint="单位 USD；亚马逊履约费用。">
              {renderCostInput('fbaFee')}
            </FormTableRow>
            <FormTableRow label="推荐费率" hint="小数格式，例如 0.15 表示 15%。">
              {renderCostInput('referralFeeRate')}
            </FormTableRow>
            <FormTableRow label="仓储费" hint="单位 USD；可按单件或估算值维护。">
              {renderCostInput('storageFee')}
            </FormTableRow>
            <FormTableRow label="其他成本" hint="单位 USD；包装、售后或额外成本。">
              {renderCostInput('otherCost')}
            </FormTableRow>
            <FormTableRow label="最低售价" hint="单位 USD；用于估算最低毛利空间。">
              {renderCostInput('minPrice')}
            </FormTableRow>
            <FormTableRow label="目标净利率" hint="小数格式，例如 0.15 表示 15%。">
              {renderCostInput('targetNetMargin')}
            </FormTableRow>
            <FormTableRow label="目标 ACOS" hint="小数格式；AI 动态阈值会把它作为产品级广告目标。">
              {renderCostInput('targetAcos')}
            </FormTableRow>
            <FormTableRow label="目标 TACOS" hint="小数格式；后续接入总销售后用于整体预算约束。">
              {renderCostInput('targetTacos')}
            </FormTableRow>
          </FormTable>
          <div className="context-summary-grid">
            <div>
              <span>估算固定成本</span>
              <strong>{formatUsd(grossCost)}</strong>
              <StatusPill tone={productConfigMetricTone('grossCost', grossCost)}>{grossCost > 0 ? '已填写' : '待填写'}</StatusPill>
              <p>采购、头程、FBA、仓储和其他成本之和。</p>
            </div>
            <div>
              <span>最低售价毛利空间</span>
              <strong>{formatPercent(minPriceMargin * 100)}</strong>
              <StatusPill tone={productConfigMetricTone('margin', cost.minPrice > 0 ? minPriceMargin : Number.NaN)}>
                {cost.minPrice > 0 ? '实时判定' : '待售价'}
              </StatusPill>
              <p>扣除固定成本和推荐费后的粗略空间，用于判断广告 ACOS 上限。</p>
            </div>
            <div>
              <span>目标 ACOS</span>
              <strong>{formatPercent(cost.targetAcos * 100)}</strong>
              <StatusPill tone={productConfigMetricTone('targetAcos', cost.targetAcos)}>实时目标</StatusPill>
              <p>AI 动态阈值会把它作为产品级目标，而不是只用全局默认值。</p>
            </div>
            <div>
              <span>目标 TACOS</span>
              <strong>{formatPercent(cost.targetTacos * 100)}</strong>
              <StatusPill tone={productConfigMetricTone('targetTacos', cost.targetTacos)}>实时目标</StatusPill>
              <p>后续接入总销售后可用于广告整体预算约束。</p>
            </div>
          </div>
          <div className="action-row">
            <button aria-busy={saveConfigButton.ariaBusy} className={saveConfigButton.className} disabled={saveConfigButton.disabled} onClick={save} type="button">
              {saveConfigButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
              <span>{saveConfigButton.label}</span>
            </button>
            <button aria-busy={operationEventsButton.ariaBusy} className={operationEventsButton.className} disabled={operationEventsButton.disabled} onClick={() => navigate('operation-events')} type="button">
              {operationEventsButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
              <span>{operationEventsButton.label}</span>
            </button>
            <button aria-busy={adQuantButton.ariaBusy} className={adQuantButton.className} disabled={adQuantButton.disabled} onClick={() => navigate('ad-quant')} type="button">
              {adQuantButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
              <span>{adQuantButton.label}</span>
            </button>
          </div>
          {message && <p className="ready-line" role="status" aria-live="polite">{message}</p>}
          {error && <p className="blocked-line">{error}</p>}
        </Panel>

        <Panel title="当前范围产品列表" tone={currentScopeProducts.length ? 'default' : 'warning'}>
          <div className="product-bulk-toolbar" aria-label="批量目标 ACOS 工具栏">
            <div className="product-bulk-copy">
              <strong>统一应用目标 ACOS</strong>
              <p>只改本地产品目标阈值，不批准建议、不执行 Ads。勾选当前店铺/站点产品后批量保存。</p>
            </div>
            <div className={`product-bulk-selection product-bulk-selection-${bulkSelectionState.tone}`}>
              <strong key={bulkSelectionState.countLabel} className={bulkSelectionState.countClassName}>
                {bulkSelectionState.countLabel}
              </strong>
              <span
                aria-hidden="true"
                className="product-bulk-selection-progress"
                style={bulkSelectionState.progressStyle}
              />
              <p className="product-bulk-selection-live" aria-live="polite">{bulkSelectionState.ariaStatus}</p>
            </div>
            <label className="product-bulk-input">
              <span>目标 ACOS (%)</span>
              <input
                aria-label="批量目标 ACOS 百分比"
                type="number"
                min="0.01"
                max="100"
                step="0.5"
                value={bulkTargetAcosPercent}
                onChange={(event) => setBulkTargetAcosPercent(toNumber(event.target.value))}
                disabled={bulkApplying}
              />
            </label>
            <StatusPill tone={bulkApplyState.statusTone}>{bulkApplyState.statusMessage}</StatusPill>
            <button
              className={bulkApplyButton.className}
              type="button"
              disabled={bulkApplyButton.disabled}
              aria-busy={bulkApplyButton.ariaBusy}
              onClick={() => { void applyBulkTargetAcos(); }}
            >
              {bulkApplyButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
              <span>{bulkApplyButton.label}</span>
            </button>
          </div>
          {bulkFeedback && (
            <p className={bulkFeedbackTone === 'blocked' ? 'blocked-line' : 'ready-line'} aria-live="polite">
              {bulkFeedback}
            </p>
          )}
          <div className="table-wrap">
            <table className="business-table">
              <thead>
                <tr>
                  <th className="table-checkbox-cell">
                    <input
                      aria-label="全选当前范围产品"
                      type="checkbox"
                      checked={allCurrentProductsSelected}
                      disabled={!currentScopeProducts.length || bulkApplying}
                      onChange={(event) => toggleAllBulkProducts(event.target.checked)}
                    />
                  </th>
                  <th>ASIN</th>
                  <th>标题</th>
                  <th>MSKU/SKU</th>
                  <th>目标 ACOS</th>
                  <th>阶段</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {currentScopeProducts.map((product) => {
                  const productKey = productConfigProductKey(product);
                  const rowLoaded = Boolean(productKey && productKey === loadedProductRowKey);
                  const loadButton = productConfigLoadButtonView({ loaded: rowLoaded });
                  return (
                    <tr className={productConfigRowClass({ bulkSelected: selectedBulkKeySet.has(productKey), loaded: rowLoaded })} key={product.id}>
                      <td className="table-checkbox-cell">
                        <input
                          aria-label={`选择产品 ${product.asin}`}
                          type="checkbox"
                          checked={selectedBulkKeySet.has(productKey)}
                          disabled={bulkApplying}
                          onChange={(event) => toggleBulkProduct(productKey, event.target.checked)}
                        />
                      </td>
                      <td>{product.asin}</td>
                      <td>{product.title || '-'}</td>
                      <td>{product.msku || '-'} / {product.sku || '-'}</td>
                      <td>{formatPercent(Number(product.cost?.targetAcos || 0) * 100)}</td>
                      <td>{stageLabel(product.product_stage)}</td>
                      <td>{product.status || '-'}</td>
                      <td>{product.updated_at || '-'}</td>
                      <td>
                        <button
                          aria-pressed={loadButton.ariaPressed}
                          className={loadButton.className}
                          onClick={() => loadProduct(product)}
                          type="button"
                        >
                          {loadButton.label}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!currentScopeProducts.length && (
                  <tr>
                    <td colSpan={9}>{loading ? '加载中...' : '当前店铺/站点还没有产品配置。'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
