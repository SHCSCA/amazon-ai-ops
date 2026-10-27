// 按职责复用原有严格校验，公共入口继续保持兼容。

const { importRunKey, lower } = require('./s7-continuous-contracts.js');

function normalizedTimestamp(value) {
    if (typeof value !== 'string' || !value.trim())
        return '';
    const timestamp = new Date(value).valueOf();
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function compareNewestRecord(timestampField, identityField) {
    return (left, right) => {
        const timestampOrder = normalizedTimestamp(right?.[timestampField])
            .localeCompare(normalizedTimestamp(left?.[timestampField]));
        if (timestampOrder !== 0)
            return timestampOrder;
        return String(right?.[identityField] ?? '').localeCompare(String(left?.[identityField] ?? ''));
    };
}

function collectionJobKey(storeId, jobId) {
    return `${lower(storeId)}|${String(jobId ?? '')}`;
}

function selectAuthoritativeLineageSnapshot(snapshot, input) {
    const selectedStoreIds = new Set((input.stores ?? []).map(lower));
    const selectedJobKeys = new Set();
    const selectedRunKeys = new Set();
    for (const storeId of selectedStoreIds) {
        for (const businessDate of input.dates ?? []) {
            const jobCandidates = snapshot.jobs
                .filter((job) => lower(job.storeId) === storeId && job.businessDate === businessDate);
            if (jobCandidates.some((job) => !normalizedTimestamp(job.updatedAt)))
                continue;
            const jobs = [...jobCandidates].sort(compareNewestRecord('updatedAt', 'jobId'));
            const latestJob = jobs[0];
            const latestJobTimestamp = normalizedTimestamp(latestJob?.updatedAt);
            const equallyLatestJobs = latestJob
                ? jobs.filter((job) => normalizedTimestamp(job.updatedAt) === latestJobTimestamp)
                : [];
            if (!latestJob || !latestJobTimestamp || equallyLatestJobs.length !== 1)
                continue;
            selectedJobKeys.add(collectionJobKey(latestJob.storeId, latestJob.jobId));
            if (latestJob.state !== 'completed')
                continue;
            const importCandidates = snapshot.imports
                .filter((run) => (lower(run.storeId) === storeId
                && run.businessDate === businessDate
                && run.batchId === latestJob.jobId));
            if (importCandidates.some((run) => !normalizedTimestamp(run.completedAt)))
                continue;
            const lineageImports = [...importCandidates].sort(compareNewestRecord('completedAt', 'runId'));
            const latestImport = lineageImports[0];
            const latestImportTimestamp = normalizedTimestamp(latestImport?.completedAt);
            const equallyLatestImports = latestImport
                ? lineageImports.filter((run) => normalizedTimestamp(run.completedAt) === latestImportTimestamp)
                : [];
            if (!latestImport || !latestImportTimestamp || equallyLatestImports.length !== 1)
                continue;
            selectedRunKeys.add(importRunKey(latestImport.storeId, latestImport.runId));
        }
    }
    return {
        stores: snapshot.stores.filter((store) => selectedStoreIds.has(lower(store.storeId))),
        jobs: snapshot.jobs.filter((job) => selectedJobKeys.has(collectionJobKey(job.storeId, job.jobId))),
        checkpoints: snapshot.checkpoints.filter((checkpoint) => (selectedJobKeys.has(collectionJobKey(checkpoint.storeId, checkpoint.jobId)))),
        imports: snapshot.imports.filter((run) => selectedRunKeys.has(importRunKey(run.storeId, run.runId))),
        importFiles: snapshot.importFiles.filter((file) => selectedRunKeys.has(importRunKey(file.storeId, file.runId))),
        reconciliations: snapshot.reconciliations.filter((row) => (selectedRunKeys.has(importRunKey(row.storeId, row.runId)))),
    };
}

module.exports = { normalizedTimestamp, compareNewestRecord, collectionJobKey, selectAuthoritativeLineageSnapshot };
