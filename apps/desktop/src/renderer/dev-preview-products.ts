// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { type PreviewProductState, type PreviewVersionedProduct, type PreviewStoreDataset } from './dev-preview-contracts';
import { clonePreviewSnapshot, previewPositiveInteger, previewInputRecord, assertPreviewIdentityHints, previewAsin, previewOptionalText, previewProductCost, previewRevision, previewRequiredText } from './dev-preview-values';
import type { PreviewRuntimeContext } from './dev-preview-state';

export function createPreviewProductsApi(previewRuntimeContext: PreviewRuntimeContext) {
const publicPreviewProduct = (state: PreviewProductState): PreviewVersionedProduct => clonePreviewSnapshot(state.row);
const requirePreviewProductState = (dataset: PreviewStoreDataset, idInput: unknown) => {
    const id = previewPositiveInteger(idInput, '产品 ID');
    const state = dataset.products.find((candidate) => candidate.row.id === id);
    if (!state)
        throw new Error('PREVIEW_OBJECT_NOT_FOUND: 当前店铺不存在该产品。');
    return state;
};
const listPreviewProducts = (submitted: StoreContextEnvelope, inputValue: unknown = {}): PreviewVersionedProduct[] => {
    const { store, dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '产品列表参数');
    assertPreviewIdentityHints(store, input);
    if (input.includeArchived !== undefined && typeof input.includeArchived !== 'boolean') {
        throw new Error('includeArchived 必须是布尔值。');
    }
    return dataset.products
        .filter((state) => input.includeArchived === true || state.row.status !== 'archived')
        .map(publicPreviewProduct);
};
const getPreviewProduct = (submitted: StoreContextEnvelope, inputValue: unknown): PreviewVersionedProduct => {
    const { store, dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '产品查询参数');
    assertPreviewIdentityHints(store, input);
    const byId = input.id !== undefined;
    const byAsin = input.asin !== undefined;
    if (byId === byAsin)
        throw new Error('产品查询必须且只能提供 id 或 asin。');
    const state = byId
        ? requirePreviewProductState(dataset, input.id)
        : dataset.products.find((candidate) => candidate.row.asin === previewAsin(input.asin));
    if (!state)
        throw new Error('PREVIEW_OBJECT_NOT_FOUND: 当前店铺不存在该产品。');
    return publicPreviewProduct(state);
};
const createPreviewProduct = (submitted: StoreContextEnvelope, inputValue: unknown): PreviewVersionedProduct => {
    const { store, dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '产品创建参数');
    assertPreviewIdentityHints(store, input);
    const asin = previewAsin(input.asin);
    if (dataset.products.some((candidate) => candidate.row.asin === asin)) {
        throw new Error(`PREVIEW_OBJECT_ALREADY_EXISTS: ${asin} 已存在于当前店铺。`);
    }
    const status = previewOptionalText(input.status, '产品状态', 32) ?? 'active';
    if (status !== 'active' && status !== 'inactive') {
        throw new Error('新产品状态只能是 active 或 inactive。');
    }
    const id = ++previewRuntimeContext.previewProductIdSequence;
    const revisionVersion = 1;
    const now = new Date().toISOString();
    const state: PreviewProductState = {
        revisionVersion,
        row: {
            id,
            storeId: store.storeId,
            marketplace_code: 'US',
            store_name: store.displayName,
            asin,
            asinValid: true,
            parent_asin: previewOptionalText(input.parentAsin ?? input.parent_asin, '父 ASIN', 64) ?? '',
            msku: previewOptionalText(input.msku, 'MSKU', 200) ?? '',
            sku: previewOptionalText(input.sku, 'SKU', 200) ?? '',
            title: previewOptionalText(input.title, '产品标题', 1000) ?? '',
            product_stage: previewOptionalText(input.productStage ?? input.product_stage, '产品阶段', 100)
                ?? 'keyword_exploration',
            status,
            created_at: now,
            updated_at: now,
            cost: previewProductCost(id, input.cost),
            revision: previewRevision('product-v1', id, revisionVersion),
        },
    };
    dataset.products.push(state);
    return publicPreviewProduct(state);
};
const updatePreviewProduct = (submitted: StoreContextEnvelope, inputValue: unknown): PreviewVersionedProduct => {
    const { store, dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '产品更新参数');
    const state = requirePreviewProductState(dataset, input.id);
    previewRuntimeContext.assertPreviewRevision(input.expectedRevision, state.row.revision, '产品更新');
    const patch = input.patch === undefined ? {} : previewInputRecord(input.patch, '产品补丁');
    assertPreviewIdentityHints(store, patch);
    if (patch.asin !== undefined && previewAsin(patch.asin) !== state.row.asin) {
        throw new Error('开发预览不支持修改产品 ASIN；请新建产品。');
    }
    let changed = false;
    const next = clonePreviewSnapshot(state.row);
    const assignText = (key: 'parent_asin' | 'msku' | 'sku' | 'title' | 'product_stage', value: unknown, label: string, maxLength: number) => {
        if (value === undefined)
            return;
        next[key] = previewOptionalText(value, label, maxLength) ?? '';
        changed = true;
    };
    assignText('parent_asin', patch.parentAsin ?? patch.parent_asin, '父 ASIN', 64);
    assignText('msku', patch.msku, 'MSKU', 200);
    assignText('sku', patch.sku, 'SKU', 200);
    assignText('title', patch.title, '产品标题', 1000);
    assignText('product_stage', patch.productStage ?? patch.product_stage, '产品阶段', 100);
    if (patch.status !== undefined) {
        const status = previewRequiredText(patch.status, '产品状态', 32);
        if (status !== 'active' && status !== 'inactive') {
            throw new Error('产品更新状态只能是 active 或 inactive；归档请使用 archiveStoreProduct。');
        }
        next.status = status;
        changed = true;
    }
    if (input.cost !== undefined) {
        next.cost = previewProductCost(next.id, input.cost, next.cost);
        changed = true;
    }
    if (!changed)
        throw new Error('产品更新必须包含可编辑字段或成本补丁。');
    state.revisionVersion += 1;
    next.storeId = store.storeId;
    next.store_name = store.displayName;
    next.marketplace_code = 'US';
    next.updated_at = new Date().toISOString();
    next.revision = previewRevision('product-v1', next.id, state.revisionVersion);
    state.row = next;
    return publicPreviewProduct(state);
};
const archivePreviewProduct = (submitted: StoreContextEnvelope, inputValue: unknown): PreviewVersionedProduct => {
    const { dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '产品归档参数');
    const state = requirePreviewProductState(dataset, input.id);
    previewRuntimeContext.assertPreviewRevision(input.expectedRevision, state.row.revision, '产品归档');
    if (state.row.status === 'archived')
        return publicPreviewProduct(state);
    state.revisionVersion += 1;
    state.row = {
        ...state.row,
        status: 'archived',
        updated_at: new Date().toISOString(),
        revision: previewRevision('product-v1', state.row.id, state.revisionVersion),
    };
    return publicPreviewProduct(state);
};
return { publicPreviewProduct, requirePreviewProductState, listPreviewProducts, getPreviewProduct, createPreviewProduct, updatePreviewProduct, archivePreviewProduct };
}

export type PreviewProductsApi = ReturnType<typeof createPreviewProductsApi>;
