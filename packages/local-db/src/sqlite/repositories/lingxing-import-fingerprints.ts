import { createHash, randomBytes } from 'crypto';
import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { LINGXING_COLLECTION_IMPORT_STATES, normalizeLingxingCollectionStoreName, normalizeStoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { type LingxingCollectionAuthorityProof } from './lingxing-import-contracts';
import { compareByStableJson, stableJson } from './lingxing-import-values';

export function fingerprintLingxingCollectionAuthorityProof(proof: LingxingCollectionAuthorityProof): string {
    const canonical = {
        ...proof,
        job: {
            ...proof.job,
            reports: [...proof.job.reports].sort((left, right) => (String(left.reportType).localeCompare(String(right.reportType)))),
        },
        lingxingFiles: [...proof.lingxingFiles].sort(compareByStableJson),
        importRuns: [...proof.importRuns].sort(compareByStableJson),
        importFileSnapshots: [...proof.importFileSnapshots].sort(compareByStableJson),
        importedReportFiles: [...proof.importedReportFiles].sort(compareByStableJson),
        reconciliations: [...proof.reconciliations].sort(compareByStableJson),
        metricEvidence: [...proof.metricEvidence].sort(compareByStableJson),
    };
    return createHash('sha256').update(stableJson(canonical)).digest('hex');
}

export function fingerprintCollectionResumeExecutionContext(value: StoreContextEnvelope): string {
    const normalized = normalizeStoreContextEnvelope(value);
    return createHash('sha256').update(stableJson({
        storeId: normalized.storeId,
        browserProfileId: normalized.browserProfileId,
        marketplace: normalized.marketplace,
        currency: normalized.currency,
        businessTimezone: normalized.businessTimezone,
        businessDate: normalized.businessDate,
        sessionGeneration: normalized.sessionGeneration,
    })).digest('hex');
}
