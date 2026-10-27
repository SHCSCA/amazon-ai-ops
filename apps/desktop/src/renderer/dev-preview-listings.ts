// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { type PreviewListingState, type PreviewListingContent, type PreviewStoreDataset, type PreviewListingVersion } from './dev-preview-contracts';
import { clonePreviewSnapshot, previewPositiveInteger, previewInputRecord, assertPreviewIdentityHints, previewOptionalText, previewAsin, previewTextArray, previewRevision } from './dev-preview-values';
import type { PreviewRuntimeContext } from './dev-preview-state';

export function createPreviewListingsApi(previewRuntimeContext: PreviewRuntimeContext) {
const publicPreviewListing = (state: PreviewListingState): PreviewListingContent => clonePreviewSnapshot(state.row);
const requirePreviewListingState = (dataset: PreviewStoreDataset, idInput: unknown) => {
    const id = previewPositiveInteger(idInput, 'Listing ID');
    const state = dataset.listings.find((candidate) => candidate.row.id === id);
    if (!state)
        throw new Error('PREVIEW_OBJECT_NOT_FOUND: 当前店铺不存在该 Listing。');
    return state;
};
const appendPreviewListingVersion = (dataset: PreviewStoreDataset, row: PreviewListingContent): PreviewListingVersion => {
    const version: PreviewListingVersion = {
        id: ++previewRuntimeContext.previewListingVersionIdSequence,
        listingContentId: row.id,
        storeId: row.storeId,
        asin: row.asin,
        title: row.title,
        bullets: [...row.bullets],
        description: row.description,
        aPlus: row.aPlus,
        imageCopy: row.imageCopy,
        backendTerms: row.backendTerms,
        source: row.source,
        versionLabel: row.versionLabel,
        changeSummary: row.changeSummary,
        createdAt: new Date().toISOString(),
    };
    dataset.listingVersions.push(version);
    return version;
};
const listPreviewListings = (submitted: StoreContextEnvelope, inputValue: unknown = {}): PreviewListingContent[] => {
    const { store, dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, 'Listing 列表参数');
    assertPreviewIdentityHints(store, input);
    const asin = previewRuntimeContext.optionalPreviewAsin(input.asin);
    const query = previewOptionalText(input.query, '查询词', 120)?.toLocaleLowerCase();
    const limit = previewRuntimeContext.previewLimit(input.limit, 250, 1000);
    return dataset.listings
        .filter(({ row }) => !asin || row.asin === asin)
        .filter(({ row }) => !query || `${row.asin} ${row.title}`.toLocaleLowerCase().includes(query))
        .sort((left, right) => (right.row.updatedAt.localeCompare(left.row.updatedAt)
        || right.row.id - left.row.id))
        .slice(0, limit)
        .map(publicPreviewListing);
};
const getPreviewListing = (submitted: StoreContextEnvelope, inputValue: unknown): PreviewListingContent => {
    const { store, dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, 'Listing 查询参数');
    assertPreviewIdentityHints(store, input);
    const byId = input.id !== undefined;
    const byAsin = input.asin !== undefined;
    if (byId === byAsin)
        throw new Error('Listing 查询必须且只能提供 id 或 asin。');
    const state = byId
        ? requirePreviewListingState(dataset, input.id)
        : dataset.listings.find((candidate) => candidate.row.asin === previewAsin(input.asin));
    if (!state)
        throw new Error('PREVIEW_OBJECT_NOT_FOUND: 当前店铺不存在该 Listing。');
    return publicPreviewListing(state);
};
const createPreviewListing = (submitted: StoreContextEnvelope, inputValue: unknown): PreviewListingContent => {
    const { store, dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, 'Listing 创建参数');
    assertPreviewIdentityHints(store, input);
    const asin = previewAsin(input.asin);
    if (dataset.listings.some((candidate) => candidate.row.asin === asin)) {
        throw new Error(`PREVIEW_OBJECT_ALREADY_EXISTS: 当前店铺已存在 ${asin} 的 Listing。`);
    }
    const id = ++previewRuntimeContext.previewListingIdSequence;
    const revisionVersion = 1;
    const now = new Date().toISOString();
    const state: PreviewListingState = {
        revisionVersion,
        row: {
            id,
            storeId: store.storeId,
            storeName: store.displayName,
            marketplace: 'US',
            currency: 'USD',
            asin,
            title: previewOptionalText(input.title, 'Listing 标题', 500) ?? '',
            bullets: previewTextArray(input.bullets, 'Bullet Points', 10, 2000),
            description: previewOptionalText(input.description, '产品描述', 20000) ?? '',
            aPlus: previewOptionalText(input.aPlus ?? input.a_plus, 'A+ 内容', 20000) ?? '',
            imageCopy: previewOptionalText(input.imageCopy ?? input.image_copy, '图片文案', 20000) ?? '',
            backendTerms: previewOptionalText(input.backendTerms ?? input.backend_terms, '后台搜索词', 5000) ?? '',
            source: previewOptionalText(input.source, '内容来源', 80) ?? 'manual',
            versionLabel: previewOptionalText(input.versionLabel ?? input.version_label, '版本标签', 160) ?? '',
            changeSummary: previewOptionalText(input.changeSummary ?? input.change_summary, '变更说明', 1000) ?? '',
            createdAt: now,
            updatedAt: now,
            revision: previewRevision('listing-content-v1', id, revisionVersion),
        },
    };
    dataset.listings.push(state);
    appendPreviewListingVersion(dataset, state.row);
    return publicPreviewListing(state);
};
const updatePreviewListing = (submitted: StoreContextEnvelope, inputValue: unknown): PreviewListingContent => {
    const { store, dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, 'Listing 更新参数');
    const state = requirePreviewListingState(dataset, input.id);
    previewRuntimeContext.assertPreviewRevision(input.expectedRevision, state.row.revision, 'Listing 更新');
    const patch = previewInputRecord(input.patch, 'Listing 补丁');
    assertPreviewIdentityHints(store, patch);
    if (patch.asin !== undefined && previewAsin(patch.asin) !== state.row.asin) {
        throw new Error('开发预览不支持修改 Listing ASIN；请新建内容。');
    }
    const editableKeys = [
        'title', 'bullets', 'description', 'aPlus', 'a_plus', 'imageCopy', 'image_copy',
        'backendTerms', 'backend_terms', 'source', 'versionLabel', 'version_label',
        'changeSummary', 'change_summary',
    ];
    if (!editableKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key))) {
        throw new Error('Listing 更新必须包含至少一个可编辑字段。');
    }
    const next = clonePreviewSnapshot(state.row);
    if (patch.title !== undefined)
        next.title = previewOptionalText(patch.title, 'Listing 标题', 500) ?? '';
    if (patch.bullets !== undefined)
        next.bullets = previewTextArray(patch.bullets, 'Bullet Points', 10, 2000);
    if (patch.description !== undefined)
        next.description = previewOptionalText(patch.description, '产品描述', 20000) ?? '';
    if (patch.aPlus !== undefined || patch.a_plus !== undefined) {
        next.aPlus = previewOptionalText(patch.aPlus ?? patch.a_plus, 'A+ 内容', 20000) ?? '';
    }
    if (patch.imageCopy !== undefined || patch.image_copy !== undefined) {
        next.imageCopy = previewOptionalText(patch.imageCopy ?? patch.image_copy, '图片文案', 20000) ?? '';
    }
    if (patch.backendTerms !== undefined || patch.backend_terms !== undefined) {
        next.backendTerms = previewOptionalText(patch.backendTerms ?? patch.backend_terms, '后台搜索词', 5000) ?? '';
    }
    if (patch.source !== undefined)
        next.source = previewOptionalText(patch.source, '内容来源', 80) ?? 'manual';
    if (patch.versionLabel !== undefined || patch.version_label !== undefined) {
        next.versionLabel = previewOptionalText(patch.versionLabel ?? patch.version_label, '版本标签', 160) ?? '';
    }
    if (patch.changeSummary !== undefined || patch.change_summary !== undefined) {
        next.changeSummary = previewOptionalText(patch.changeSummary ?? patch.change_summary, '变更说明', 1000) ?? '';
    }
    state.revisionVersion += 1;
    next.storeId = store.storeId;
    next.storeName = store.displayName;
    next.marketplace = 'US';
    next.currency = 'USD';
    next.updatedAt = new Date().toISOString();
    next.revision = previewRevision('listing-content-v1', next.id, state.revisionVersion);
    state.row = next;
    appendPreviewListingVersion(dataset, state.row);
    return publicPreviewListing(state);
};
const deletePreviewListing = (submitted: StoreContextEnvelope, inputValue: unknown): {
    id: number;
    deleted: true;
} => {
    const { dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, 'Listing 删除参数');
    const state = requirePreviewListingState(dataset, input.id);
    previewRuntimeContext.assertPreviewRevision(input.expectedRevision, state.row.revision, 'Listing 删除');
    dataset.listings = dataset.listings.filter((candidate) => candidate !== state);
    return { id: state.row.id, deleted: true };
};
const listPreviewListingVersions = (submitted: StoreContextEnvelope, inputValue: unknown = {}): PreviewListingVersion[] => {
    const { store, dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, 'Listing 版本列表参数');
    assertPreviewIdentityHints(store, input);
    const listingContentId = input.listingContentId === undefined
        ? undefined
        : previewPositiveInteger(input.listingContentId, 'Listing ID');
    const asin = listingContentId === undefined ? previewRuntimeContext.optionalPreviewAsin(input.asin) : undefined;
    const limit = previewRuntimeContext.previewLimit(input.limit, 100, 500);
    const offset = input.offset === undefined ? 0 : Number(input.offset);
    if (!Number.isInteger(offset) || offset < 0)
        throw new Error('offset 必须是非负整数。');
    return dataset.listingVersions
        .filter((row) => !listingContentId || row.listingContentId === listingContentId)
        .filter((row) => !asin || row.asin === asin)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id - left.id)
        .slice(offset, offset + limit)
        .map((row) => clonePreviewSnapshot(row));
};
return { publicPreviewListing, requirePreviewListingState, appendPreviewListingVersion, listPreviewListings, getPreviewListing, createPreviewListing, updatePreviewListing, deletePreviewListing, listPreviewListingVersions };
}

export type PreviewListingsApi = ReturnType<typeof createPreviewListingsApi>;
