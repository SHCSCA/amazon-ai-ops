// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { type PreviewOperationEventState, type PreviewVersionedOperationEvent, type PreviewStoreDataset } from './dev-preview-contracts';
import { clonePreviewSnapshot, previewPositiveInteger, previewInputRecord, assertPreviewIdentityHints, previewIsoDate, previewOptionalText, previewRequiredText, previewRevision } from './dev-preview-values';
import type { PreviewRuntimeContext } from './dev-preview-state';

export function createPreviewEventsApi(previewRuntimeContext: PreviewRuntimeContext) {
const publicPreviewOperationEvent = (state: PreviewOperationEventState): PreviewVersionedOperationEvent => clonePreviewSnapshot(state.row);
const requirePreviewOperationEventState = (dataset: PreviewStoreDataset, idInput: unknown) => {
    const id = previewPositiveInteger(idInput, '运营事件 ID');
    const state = dataset.operationEvents.find((candidate) => candidate.row.id === id);
    if (!state)
        throw new Error('PREVIEW_OBJECT_NOT_FOUND: 当前店铺不存在该运营事件。');
    return state;
};
const listPreviewOperationEvents = (submitted: StoreContextEnvelope, inputValue: unknown = {}): PreviewVersionedOperationEvent[] => {
    const { store, dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '运营事件列表参数');
    assertPreviewIdentityHints(store, input);
    const dateFrom = input.dateFrom === undefined ? undefined : previewIsoDate(input.dateFrom, 'dateFrom');
    const dateTo = input.dateTo === undefined ? undefined : previewIsoDate(input.dateTo, 'dateTo');
    if (dateFrom && dateTo && dateFrom > dateTo)
        throw new Error('dateFrom 不能晚于 dateTo。');
    const asin = previewRuntimeContext.optionalPreviewAsin(input.asin);
    const campaignName = previewOptionalText(input.campaignName, 'Campaign 名称', 500);
    const adGroupName = previewOptionalText(input.adGroupName, '广告组名称', 500);
    const eventType = previewOptionalText(input.eventType, '事件类型', 100);
    if (input.includeArchived !== undefined && typeof input.includeArchived !== 'boolean') {
        throw new Error('includeArchived 必须是布尔值。');
    }
    const limit = input.limit === undefined ? 200 : previewPositiveInteger(input.limit, 'limit');
    if (limit > 1000)
        throw new Error('limit 不能超过 1000。');
    return dataset.operationEvents
        .filter(({ row }) => input.includeArchived === true || !row.archivedAt)
        .filter(({ row }) => !dateFrom || row.eventDate >= dateFrom)
        .filter(({ row }) => !dateTo || row.eventDate <= dateTo)
        .filter(({ row }) => !asin || row.asin === asin)
        .filter(({ row }) => !campaignName || row.campaignName === campaignName)
        .filter(({ row }) => !adGroupName || row.adGroupName === adGroupName)
        .filter(({ row }) => !eventType || row.eventType === eventType)
        .sort((left, right) => (right.row.eventDate.localeCompare(left.row.eventDate)
        || right.row.id - left.row.id))
        .slice(0, limit)
        .map(publicPreviewOperationEvent);
};
const createPreviewOperationEvent = (submitted: StoreContextEnvelope, inputValue: unknown): PreviewVersionedOperationEvent => {
    const { store, dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '运营事件创建参数');
    assertPreviewIdentityHints(store, input);
    if (input.evidenceArtifactId !== undefined) {
        throw new Error('开发预览不会签发真实证据 Artifact；请在 Windows 桌面端登记证据。');
    }
    const id = ++previewRuntimeContext.previewOperationEventIdSequence;
    const revisionVersion = 1;
    const now = new Date().toISOString();
    const state: PreviewOperationEventState = {
        revisionVersion,
        row: {
            id,
            storeId: store.storeId,
            eventDate: previewIsoDate(input.eventDate, '事件日期'),
            storeName: store.displayName,
            marketplaceCode: 'US',
            asin: previewRuntimeContext.optionalPreviewAsin(input.asin),
            asinValid: true,
            campaignName: previewOptionalText(input.campaignName, 'Campaign 名称', 500),
            adGroupName: previewOptionalText(input.adGroupName, '广告组名称', 500),
            eventType: previewRequiredText(input.eventType, '事件类型', 100),
            title: previewRequiredText(input.title, '事件标题', 500),
            impactExpectation: previewOptionalText(input.impactExpectation, '影响预期', 100),
            notes: previewOptionalText(input.notes, '事件说明', 10000),
            evidenceRefValid: true,
            archiveRevision: 0,
            createdAt: now,
            updatedAt: now,
            revision: previewRevision('operation-event-v1', id, revisionVersion),
        },
    };
    dataset.operationEvents.push(state);
    return publicPreviewOperationEvent(state);
};
const updatePreviewOperationEvent = (submitted: StoreContextEnvelope, inputValue: unknown): PreviewVersionedOperationEvent => {
    const { store, dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '运营事件更新参数');
    const state = requirePreviewOperationEventState(dataset, input.id);
    previewRuntimeContext.assertPreviewRevision(input.expectedRevision, state.row.revision, '运营事件更新');
    const patch = previewInputRecord(input.patch, '运营事件补丁');
    assertPreviewIdentityHints(store, patch);
    const businessKeys = [
        'eventDate', 'asin', 'campaignName', 'adGroupName', 'eventType', 'title',
        'impactExpectation', 'notes', 'evidenceArtifactId',
    ];
    const hasBusinessPatch = businessKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key));
    const hasArchivedCommand = Object.prototype.hasOwnProperty.call(patch, 'archived');
    if (!hasBusinessPatch && !hasArchivedCommand) {
        throw new Error('运营事件补丁不能为空。');
    }
    if (hasArchivedCommand && typeof patch.archived !== 'boolean') {
        throw new Error('archived 必须是布尔值。');
    }
    if (patch.evidenceArtifactId !== undefined) {
        throw new Error('开发预览不会签发真实证据 Artifact；请在 Windows 桌面端登记证据。');
    }
    const archivedCommand = hasArchivedCommand ? patch.archived as boolean : undefined;
    if (state.row.archivedAt) {
        if (archivedCommand !== false) {
            throw new Error('归档运营事件为只读状态；请先恢复事件。');
        }
        if (hasBusinessPatch) {
            throw new Error('恢复与业务字段更新必须拆分为两次受版本锁保护的操作。');
        }
        state.revisionVersion += 1;
        state.row = {
            ...state.row,
            archivedAt: undefined,
            archiveRevision: state.row.archiveRevision + 1,
            updatedAt: new Date().toISOString(),
            revision: previewRevision('operation-event-v1', state.row.id, state.revisionVersion),
        };
        return publicPreviewOperationEvent(state);
    }
    if (archivedCommand === true) {
        throw new Error('请使用运营事件归档动作，不要通过更新补丁归档。');
    }
    if (archivedCommand === false && !hasBusinessPatch) {
        return publicPreviewOperationEvent(state);
    }
    const next = clonePreviewSnapshot(state.row);
    if (patch.eventDate !== undefined)
        next.eventDate = previewIsoDate(patch.eventDate, '事件日期');
    if (patch.asin !== undefined)
        next.asin = previewRuntimeContext.optionalPreviewAsin(patch.asin);
    if (patch.campaignName !== undefined)
        next.campaignName = previewOptionalText(patch.campaignName, 'Campaign 名称', 500);
    if (patch.adGroupName !== undefined)
        next.adGroupName = previewOptionalText(patch.adGroupName, '广告组名称', 500);
    if (patch.eventType !== undefined)
        next.eventType = previewRequiredText(patch.eventType, '事件类型', 100);
    if (patch.title !== undefined)
        next.title = previewRequiredText(patch.title, '事件标题', 500);
    if (patch.impactExpectation !== undefined)
        next.impactExpectation = previewOptionalText(patch.impactExpectation, '影响预期', 100);
    if (patch.notes !== undefined)
        next.notes = previewOptionalText(patch.notes, '事件说明', 10000);
    state.revisionVersion += 1;
    next.storeId = store.storeId;
    next.storeName = store.displayName;
    next.marketplaceCode = 'US';
    next.updatedAt = new Date().toISOString();
    next.revision = previewRevision('operation-event-v1', next.id, state.revisionVersion);
    state.row = next;
    return publicPreviewOperationEvent(state);
};
const deletePreviewOperationEvent = (submitted: StoreContextEnvelope, inputValue: unknown): PreviewVersionedOperationEvent => {
    const { dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '运营事件归档参数');
    const state = requirePreviewOperationEventState(dataset, input.id);
    previewRuntimeContext.assertPreviewRevision(input.expectedRevision, state.row.revision, '运营事件归档');
    if (state.row.archivedAt)
        return publicPreviewOperationEvent(state);
    state.revisionVersion += 1;
    const archivedAt = new Date().toISOString();
    state.row = {
        ...state.row,
        archivedAt,
        archiveRevision: state.row.archiveRevision + 1,
        updatedAt: archivedAt,
        revision: previewRevision('operation-event-v1', state.row.id, state.revisionVersion),
    };
    return publicPreviewOperationEvent(state);
};
return { publicPreviewOperationEvent, requirePreviewOperationEventState, listPreviewOperationEvents, createPreviewOperationEvent, updatePreviewOperationEvent, deletePreviewOperationEvent };
}

export type PreviewEventsApi = ReturnType<typeof createPreviewEventsApi>;
