// 保留页面编排与原有交互，纯值规则和展示规则按职责复用。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type ProductConfigActionButtonInput, type ProductConfigActionButtonView, type ProductConfigLoadButtonView, type InlineSaveStatus, type ProductConfigRowTargetAcosView, type ProductConfigRowHealthView, type ProductConfigMetricTone, type ProductCostInput, PRODUCT_COST_FIELD_LABELS, type ProductConfigMetricKey } from './product-config-contracts';
import { isProductConfigAutoSaveField, normalizeProductConfigAcosPercent } from './product-config-values';

export function productConfigActionButtonView({ active, baseClassName, label, busyLabel, disabled = false, groupBusy = false, }: ProductConfigActionButtonInput): ProductConfigActionButtonView {
    return {
        ariaBusy: active ? true : undefined,
        className: [baseClassName, active ? 'button-loading' : ''].filter(Boolean).join(' '),
        disabled: Boolean(disabled || active || groupBusy),
        label: active ? busyLabel : label,
        showSpinner: active,
    };
}

export function productConfigRowClass(input: {
    bulkSelected: boolean;
    loaded: boolean;
}): string {
    return [
        input.bulkSelected ? 'product-config-row-selected' : '',
        input.loaded ? 'product-config-row-loaded' : '',
    ].filter(Boolean).join(' ');
}

export function productConfigLoadButtonView(input: {
    loaded: boolean;
}): ProductConfigLoadButtonView {
    return {
        ariaPressed: input.loaded,
        className: [
            'secondary-button compact-button product-config-load-button',
            input.loaded ? 'product-config-load-button-active' : '',
        ].filter(Boolean).join(' '),
        label: input.loaded ? '已载入' : '载入编辑',
    };
}

export function productConfigRowTargetAcosView(input: {
    asin?: string;
    disabled?: boolean;
    draftValue?: string;
    productTargetAcos: number;
    status: InlineSaveStatus;
}): ProductConfigRowTargetAcosView {
    const currentPercent = Number.isFinite(Number(input.productTargetAcos))
        ? (Number(input.productTargetAcos) * 100).toFixed(2)
        : '0.00';
    const feedbackLabel = input.status === 'saving'
        ? '目标 ACOS 保存中...'
        : input.status === 'saved'
            ? '目标 ACOS 已保存'
            : input.status === 'error'
                ? '目标 ACOS 保存失败'
                : '';
    return {
        ariaLabel: `编辑 ${String(input.asin || '产品').trim() || '产品'} 目标 ACOS`,
        className: [
            'product-row-acos-field',
            input.status !== 'idle' ? `product-row-acos-field-${input.status}` : '',
        ].filter(Boolean).join(' '),
        disabled: Boolean(input.disabled || input.status === 'saving'),
        feedbackLabel,
        inputValue: input.draftValue ?? currentPercent,
    };
}

export function productConfigRowHealthView(input: {
    targetAcos: number;
}): ProductConfigRowHealthView {
    const targetAcos = Number(input.targetAcos);
    const tone = productConfigMetricTone('targetAcos', targetAcos);
    const labelByTone: Record<ProductConfigMetricTone, string> = {
        ready: '目标正常',
        warning: '需复核',
        blocked: '高风险',
        pending: '待配置',
    };
    const detail = tone === 'pending' ? '未配置目标 ACOS' : `目标 ACOS ${(targetAcos * 100).toFixed(2)}%`;
    return {
        ariaLabel: `产品目标健康度：${labelByTone[tone]}，${detail}`,
        className: `product-row-health product-row-health-${tone}`,
        detail,
        label: labelByTone[tone],
        tone,
    };
}

export function productCostInputHint(cost: ProductCostInput): string {
    const hasRealCostOrPrice = [
        cost.purchaseCost,
        cost.firstLegCost,
        cost.fbaFee,
        cost.storageFee,
        cost.otherCost,
        cost.currentPrice,
        cost.minPrice,
    ].some((value) => Number(value || 0) > 0);
    if (!hasRealCostOrPrice) {
        return '当前成本、售价和最低可接受售价仍像默认值；保存前请替换为真实采购、物流、FBA、售价和利润目标，避免 AI 阈值被模板数字误导。';
    }
    return '已填写成本、售价或最低可接受售价；保存前请确认这些数字来自当前产品。';
}

export function productConfigInlineSaveLabel(key: string, status: InlineSaveStatus): string {
    if (!isProductConfigAutoSaveField(key) || status === 'idle')
        return '';
    const label = PRODUCT_COST_FIELD_LABELS[key];
    if (status === 'saving')
        return `${label} 保存中...`;
    if (status === 'saved')
        return `${label} 已保存`;
    return `${label} 保存失败`;
}

export function productConfigMetricTone(metric: ProductConfigMetricKey, value: number): ProductConfigMetricTone {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return 'pending';
    if (metric === 'grossCost')
        return numeric > 0 ? 'ready' : 'pending';
    if (metric === 'margin') {
        if (numeric < 0)
            return 'blocked';
        if (numeric < 0.1)
            return 'warning';
        return 'ready';
    }
    if (metric === 'targetAcos') {
        if (numeric <= 0)
            return 'pending';
        if (numeric > 0.7)
            return 'blocked';
        if (numeric > 0.4)
            return 'warning';
        return 'ready';
    }
    if (numeric <= 0)
        return 'pending';
    if (numeric > 0.45)
        return 'blocked';
    if (numeric > 0.3)
        return 'warning';
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
            : '产品目标必须先绑定 ASIN，否则广告表现只能按全局默认阈值解释 ACOS 和花费。',
        primaryActionLabel: input.saving ? '保存中...' : hasAsin ? '编辑当前产品目标' : '新建产品配置',
        primaryActionBusy: input.saving,
        primaryActionBusyLabel: '保存中...',
        primaryActionDisabled: input.saving,
        secondaryActionLabel: '查看广告表现',
    };
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
    }
    else if (!hasProducts) {
        statusTone = 'pending';
    }
    else if (!hasSelection) {
        statusTone = 'pending';
    }
    else if (input.applying) {
        statusTone = 'warning';
        statusMessage = `正在应用 ${targetAcosLabel}`;
    }
    else {
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
