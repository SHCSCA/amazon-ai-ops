import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { LINGXING_COLLECTION_IMPORT_STATES, normalizeLingxingCollectionStoreName, normalizeStoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { type LingxingCollectionSemanticScope, COMPLETE_LINGXING_REPORT_TYPES, type LingxingCollectionAuthorityProof } from './lingxing-import-contracts';
import { requiredText, canonicalIsoDate, parseRequiredJson, sameCompleteLingxingReportTypeSet } from './lingxing-import-values';

export function normalizeCollectionSemanticScope(input: LingxingCollectionSemanticScope): LingxingCollectionSemanticScope {
    if (!input || typeof input !== 'object') {
        throw new Error('采集 semantic scope 无效。');
    }
    const storeId = requiredText(input.storeId, 'semantic scope.storeId') as StoreId;
    const browserProfileId = requiredText(input.browserProfileId, 'semantic scope.browserProfileId');
    const businessDate = canonicalIsoDate(input.businessDate, 'semantic scope.businessDate');
    const dateStart = canonicalIsoDate(input.dateStart, 'semantic scope.dateStart');
    const dateEnd = canonicalIsoDate(input.dateEnd, 'semantic scope.dateEnd');
    if (dateStart > dateEnd) {
        throw new Error('采集 semantic scope date window 无效。');
    }
    if (input.mode !== 'create-and-download') {
        throw new Error('采集 semantic scope 仅接受 create-and-download。');
    }
    if (!Array.isArray(input.reportTypes)
        || input.reportTypes.length !== COMPLETE_LINGXING_REPORT_TYPES.size
        || new Set(input.reportTypes).size !== COMPLETE_LINGXING_REPORT_TYPES.size
        || input.reportTypes.some((reportType) => (!COMPLETE_LINGXING_REPORT_TYPES.has(reportType)))) {
        throw new Error('采集 semantic scope 必须是严格且不重复的 8/8 领星广告报表集合。');
    }
    return {
        storeId,
        browserProfileId,
        businessDate,
        dateStart,
        dateEnd,
        mode: 'create-and-download',
        reportTypes: [...COMPLETE_LINGXING_REPORT_TYPES],
    };
}

export function assertCollectionAuthorityProofSemanticScope(scope: LingxingCollectionSemanticScope, proof: LingxingCollectionAuthorityProof): void {
    const context = normalizeStoreContextEnvelope(proof.job.request.storeContext);
    const rowReportTypes = parseRequiredJson<unknown>(proof.jobRow.reportTypesJson, '采集 job SQL report_types_json');
    if (proof.jobRow.storeId !== scope.storeId
        || context.storeId !== scope.storeId
        || proof.jobRow.browserProfileId !== scope.browserProfileId
        || context.browserProfileId !== scope.browserProfileId
        || proof.jobRow.marketplace !== 'US'
        || context.marketplace !== 'US'
        || proof.jobRow.currency !== 'USD'
        || context.currency !== 'USD'
        || proof.jobRow.businessTimezone !== 'America/Los_Angeles'
        || context.businessTimezone !== 'America/Los_Angeles'
        || proof.jobRow.businessDate !== scope.businessDate
        || context.businessDate !== scope.businessDate
        || proof.jobRow.dateStart !== scope.dateStart
        || proof.job.request.dateStart !== scope.dateStart
        || proof.jobRow.dateEnd !== scope.dateEnd
        || proof.job.request.dateEnd !== scope.dateEnd
        || proof.jobRow.mode !== scope.mode
        || proof.job.request.mode !== scope.mode
        || !sameCompleteLingxingReportTypeSet(rowReportTypes)
        || !sameCompleteLingxingReportTypeSet(proof.job.request.reportTypes)) {
        throw new Error('采集 authority proof 与 exact semantic scope 身份不一致。');
    }
}
