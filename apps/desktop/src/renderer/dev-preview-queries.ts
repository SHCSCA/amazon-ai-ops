// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { type PreviewAdObjectFact, type PreviewKeywordFact } from './dev-preview-contracts';
import { previewInputRecord, assertPreviewIdentityHints, previewIsoDate, previewOptionalText, clonePreviewSnapshot } from './dev-preview-values';
import type { PreviewRuntimeContext } from './dev-preview-state';

export function createPreviewQueriesApi(previewRuntimeContext: PreviewRuntimeContext) {
const listPreviewAdObjects = (submitted: StoreContextEnvelope, inputValue: unknown = {}): PreviewAdObjectFact[] => {
    const { store, dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '广告对象列表参数');
    assertPreviewIdentityHints(store, input);
    const kind = input.kind === undefined ? 'campaign' : input.kind;
    if (kind !== 'campaign' && kind !== 'ad_group' && kind !== 'target' && kind !== 'search_term') {
        throw new Error('kind 必须是 campaign、ad_group、target 或 search_term。');
    }
    const dateFrom = input.dateFrom === undefined ? undefined : previewIsoDate(input.dateFrom, 'dateFrom');
    const dateTo = input.dateTo === undefined ? undefined : previewIsoDate(input.dateTo, 'dateTo');
    if (dateFrom && dateTo && dateFrom > dateTo)
        throw new Error('dateFrom 不能晚于 dateTo。');
    const asin = previewRuntimeContext.optionalPreviewAsin(input.asin);
    const query = previewOptionalText(input.query, '查询词', 120)?.toLocaleLowerCase();
    const limit = previewRuntimeContext.previewLimit(input.limit, 500, 1000);
    return dataset.adObjects
        .filter((row) => row.kind === kind)
        .filter((row) => !dateFrom || !row.lastDate || row.lastDate >= dateFrom)
        .filter((row) => !dateTo || !row.firstDate || row.firstDate <= dateTo)
        .filter((row) => !asin || row.asin === asin)
        .filter((row) => !query || [row.name, row.campaignName, row.adGroupName]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(query)))
        .slice(0, limit)
        .map((row) => clonePreviewSnapshot(row));
};
const listPreviewKeywordFacts = (submitted: StoreContextEnvelope, inputValue: unknown = {}): PreviewKeywordFact[] => {
    const { store, dataset } = previewRuntimeContext.requirePreviewDatasetAuthority(submitted);
    const input = previewInputRecord(inputValue, '关键词事实列表参数');
    assertPreviewIdentityHints(store, input);
    const asin = previewRuntimeContext.optionalPreviewAsin(input.asin);
    const query = previewOptionalText(input.query, '查询词', 120)?.toLocaleLowerCase();
    const limit = previewRuntimeContext.previewLimit(input.limit, 500, 1000);
    return dataset.keywordFacts
        .filter((row) => !asin || row.asin === asin)
        .filter((row) => !query || row.keyword.toLocaleLowerCase().includes(query))
        .sort((left, right) => ((right.opportunityScore ?? -1) - (left.opportunityScore ?? -1)
        || right.spend - left.spend
        || left.keyword.localeCompare(right.keyword, 'en-US')))
        .slice(0, limit)
        .map((row) => clonePreviewSnapshot(row));
};
return { listPreviewAdObjects, listPreviewKeywordFacts };
}

export type PreviewQueriesApi = ReturnType<typeof createPreviewQueriesApi>;
