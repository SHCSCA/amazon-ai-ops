// 按职责复用原有严格校验，公共入口继续保持兼容。

const { businessDateInTimezone } = require('./s7-continuous-calendar.js');
const { BUSINESS_TIMEZONE, EXPECTED_REPORT_TYPES, MAX_TERMINAL_TAIL_MS, TERMINAL_BLOCKED_STATES, importRunKey, lower, nonEmpty, timestampMs, timestampWithin } = require('./s7-continuous-contracts.js');
const { compareNewestRecord, normalizedTimestamp } = require('./s7-continuous-lineage.js');

function evaluateStoreDay(snapshot, store, businessDate, input = {}, importProof = { invalidRunKeys: new Set() }) {
    const jobCandidates = snapshot.jobs
        .filter((job) => lower(job.storeId) === lower(store.storeId) && job.businessDate === businessDate);
    const violations = [];
    if (jobCandidates.length === 0) {
        violations.push({ code: 'SILENT_MISSING_DAY', message: 'No collection job or explicit blocker exists for this business date.', detail: {} });
        return { businessDate, outcome: 'MISSING', accepted: false, jobId: null, reportCount: 0, importRunId: null, violations };
    }
    const malformedJobCandidates = jobCandidates.filter((job) => !normalizedTimestamp(job.updatedAt));
    if (malformedJobCandidates.length > 0) {
        violations.push({
            code: 'LATEST_JOB_IDENTITY_AMBIGUOUS',
            message: 'Every competing store/day collection job must have a valid durable updatedAt before the latest identity can be selected.',
            detail: {
                jobIds: malformedJobCandidates.map((job) => job.jobId),
                updatedAt: null,
            },
        });
        return {
            businessDate,
            outcome: 'INCOMPLETE',
            accepted: false,
            jobId: null,
            reportCount: 0,
            importRunId: null,
            violations,
        };
    }
    const jobs = [...jobCandidates].sort(compareNewestRecord('updatedAt', 'jobId'));
    const latestJob = jobs[0];
    const latestTimestamp = normalizedTimestamp(latestJob.updatedAt);
    const equallyLatestJobs = jobs.filter((job) => normalizedTimestamp(job.updatedAt) === latestTimestamp);
    if (!latestTimestamp || equallyLatestJobs.length !== 1) {
        violations.push({
            code: 'LATEST_JOB_IDENTITY_AMBIGUOUS',
            message: 'The latest store/day collection job must have one unique durable updatedAt.',
            detail: { jobIds: equallyLatestJobs.map((job) => job.jobId), updatedAt: latestTimestamp || null },
        });
        return {
            businessDate,
            outcome: 'INCOMPLETE',
            accepted: false,
            jobId: latestJob?.jobId ?? null,
            reportCount: 0,
            importRunId: null,
            violations,
        };
    }
    const jobTime = validateJobTime(latestJob, store, businessDate, input.generatedAt, violations);
    const jobIdentityValid = validateJobIdentity(latestJob, store, businessDate, violations);
    if (latestJob.state === 'completed') {
        const checkpoints = snapshot.checkpoints.filter((row) => lower(row.storeId) === lower(store.storeId) && row.jobId === latestJob.jobId);
        const checkpointTimesValid = checkpoints.every((row) => {
            const valid = timestampWithin(row.updatedAt, jobTime.createdAtMs, jobTime.updatedAtMs);
            if (!valid) {
                violations.push({
                    code: 'CHECKPOINT_TIME_INVALID',
                    message: 'Downloaded checkpoint updatedAt must fall inside the durable job lifetime.',
                    detail: { reportType: row.reportType, updatedAt: row.updatedAt },
                });
            }
            return valid;
        });
        const downloaded = new Set(checkpoints.filter((row) => row.state === 'downloaded').map((row) => row.reportType));
        const missingReports = EXPECTED_REPORT_TYPES.filter((reportType) => !downloaded.has(reportType));
        const unexpectedReports = [...downloaded].filter((reportType) => !EXPECTED_REPORT_TYPES.includes(reportType));
        const importCandidates = snapshot.imports
            .filter((row) => lower(row.storeId) === lower(store.storeId)
            && row.businessDate === businessDate
            && row.batchId === latestJob.jobId);
        const malformedImportCandidates = importCandidates
            .filter((run) => !normalizedTimestamp(run.completedAt));
        const lineageImports = [...importCandidates].sort(compareNewestRecord('completedAt', 'runId'));
        const latestImport = malformedImportCandidates.length === 0 ? lineageImports[0] : null;
        const latestImportTimestamp = normalizedTimestamp(latestImport?.completedAt);
        const equallyLatestImports = latestImport
            ? lineageImports.filter((run) => normalizedTimestamp(run.completedAt) === latestImportTimestamp)
            : [];
        if (malformedImportCandidates.length > 0) {
            violations.push({
                code: 'LATEST_IMPORT_IDENTITY_AMBIGUOUS',
                message: 'Every competing import in the completed job/batch lineage must have a valid durable completedAt before the latest identity can be selected.',
                detail: {
                    runIds: malformedImportCandidates.map((run) => run.runId),
                    completedAt: null,
                },
            });
        }
        else if (latestImport && (!latestImportTimestamp || equallyLatestImports.length !== 1)) {
            violations.push({
                code: 'LATEST_IMPORT_IDENTITY_AMBIGUOUS',
                message: 'The latest import for the completed job/batch lineage must have one unique durable completedAt.',
                detail: { runIds: equallyLatestImports.map((run) => run.runId), completedAt: latestImportTimestamp || null },
            });
        }
        const acceptedImport = latestImport && latestImportTimestamp && equallyLatestImports.length === 1 && (() => {
            const run = latestImport;
            if (run.status !== 'completed')
                return false;
            const runKey = importRunKey(run.storeId, run.runId);
            const fileRows = snapshot.importFiles.filter((row) => lower(row.storeId) === lower(store.storeId) && row.runId === run.runId);
            const types = new Set(snapshot.importFiles.filter((row) => lower(row.storeId) === lower(store.storeId) && row.runId === run.runId).map((row) => row.reportType));
            const reconciliations = snapshot.reconciliations.filter((row) => lower(row.storeId) === lower(store.storeId) && row.runId === run.runId);
            const matchedReconciliationTypes = new Set(reconciliations
                .filter((row) => row.status === 'matched' && Number(row.withinTolerance) === 1)
                .map((row) => row.reportType));
            const importTime = validateImportTime(run, jobTime, violations);
            const batchIdentityValid = validateBatchIdentity(run, latestJob, businessDate, violations);
            const fileTimesValid = fileRows.every((row) => {
                const valid = timestampWithin(row.capturedAt, importTime.startedAtMs, importTime.completedAtMs)
                    && timestampWithin(row.capturedAt, jobTime.createdAtMs, jobTime.updatedAtMs);
                if (!valid) {
                    violations.push({
                        code: 'FILE_SNAPSHOT_TIME_INVALID',
                        message: 'Imported file snapshot capturedAt must fall inside the import and job lifetime.',
                        detail: { reportType: row.reportType, capturedAt: row.capturedAt },
                    });
                }
                return valid;
            });
            const reconciliationTimesValid = reconciliations.every((row) => {
                const valid = timestampWithin(row.reconciledAt, importTime.startedAtMs, importTime.completedAtMs)
                    && timestampWithin(row.reconciledAt, jobTime.createdAtMs, jobTime.updatedAtMs);
                if (!valid) {
                    violations.push({
                        code: 'RECONCILIATION_TIME_INVALID',
                        message: 'Import reconciliation reconciledAt must fall inside the import and job lifetime.',
                        detail: { reportType: row.reportType, reconciledAt: row.reconciledAt },
                    });
                }
                return valid;
            });
            return jobTime.valid
                && jobIdentityValid
                && batchIdentityValid
                && !importProof.invalidRunKeys.has(runKey)
                && checkpointTimesValid
                && importTime.valid
                && fileTimesValid
                && reconciliationTimesValid
                && fileRows.length === EXPECTED_REPORT_TYPES.length
                && types.size === EXPECTED_REPORT_TYPES.length
                && reconciliations.length === EXPECTED_REPORT_TYPES.length
                && matchedReconciliationTypes.size === EXPECTED_REPORT_TYPES.length
                && EXPECTED_REPORT_TYPES.every((reportType) => types.has(reportType))
                && EXPECTED_REPORT_TYPES.every((reportType) => matchedReconciliationTypes.has(reportType))
                && Number(run.sourceFileCount) === EXPECTED_REPORT_TYPES.length
                && Number(run.reconciliationCount) === EXPECTED_REPORT_TYPES.length
                && Number(run.metricRowCount) > 0;
        })();
        if (missingReports.length > 0 || unexpectedReports.length > 0 || checkpoints.length !== EXPECTED_REPORT_TYPES.length) {
            violations.push({
                code: 'REPORT_SET_INCOMPLETE',
                message: 'Latest completed job does not have exactly eight downloaded report checkpoints.',
                detail: { missingReports, unexpectedReports, checkpointCount: checkpoints.length },
            });
        }
        if (!acceptedImport) {
            const sameDayBatchIds = snapshot.imports
                .filter((row) => lower(row.storeId) === lower(store.storeId) && row.businessDate === businessDate)
                .map((row) => row.batchId);
            violations.push({
                code: lineageImports.length === 0 && sameDayBatchIds.length > 0 ? 'IMPORT_LINEAGE_MISMATCH' : 'IMPORT_NOT_VERIFIED',
                message: lineageImports.length === 0 && sameDayBatchIds.length > 0
                    ? 'Latest completed job cannot be combined with an import from another batch lineage.'
                    : 'Latest completed job/batch has no latest exact eight-report import with matched reconciliation.',
                detail: { expectedBatchId: latestJob.jobId, actualBatchIds: [...new Set(sameDayBatchIds)] },
            });
        }
        return {
            businessDate,
            outcome: violations.length === 0 ? 'SUCCESS_8_OF_8' : 'INVALID_SUCCESS',
            accepted: violations.length === 0,
            jobId: latestJob.jobId,
            reportCount: downloaded.size,
            importRunId: acceptedImport ? latestImport.runId : null,
            violations,
        };
    }
    const blocked = TERMINAL_BLOCKED_STATES.has(latestJob.state)
        && nonEmpty(latestJob.blockerCode)
        && nonEmpty(latestJob.detail)
        ? latestJob
        : null;
    if (blocked) {
        violations.push({
            code: 'DAY_BLOCKED',
            message: 'An actionable blocked day is durable evidence, but it cannot satisfy the production continuous-operation gate.',
            detail: { state: blocked.state, blockerCode: blocked.blockerCode },
        });
    }
    else {
        violations.push({
            code: 'BLOCKER_NOT_ACTIONABLE',
            message: 'Latest non-success job must persist a terminal state, blockerCode and repair detail.',
            detail: { state: latestJob.state },
        });
    }
    return {
        businessDate,
        outcome: blocked ? 'EXPLICIT_BLOCKED' : 'INCOMPLETE',
        accepted: false,
        jobId: latestJob.jobId,
        reportCount: blocked
            ? snapshot.checkpoints.filter((row) => lower(row.storeId) === lower(store.storeId) && row.jobId === blocked.jobId && row.state === 'downloaded').length
            : 0,
        importRunId: null,
        blockerCode: blocked?.blockerCode,
        blockerDetail: blocked?.detail,
        violations,
    };
}

function validateJobIdentity(job, store, businessDate, violations) {
    let valid = true;
    if (!nonEmpty(job.requestId)
        || job.browserProfileId !== store.browserProfileId
        || job.marketplace !== 'US'
        || job.currency !== 'USD'
        || job.businessTimezone !== BUSINESS_TIMEZONE
        || job.businessDate !== businessDate) {
        valid = false;
        violations.push({
            code: 'JOB_AUTHORITY_MISMATCH',
            message: 'Completed job identity must match its US/USD Store Capsule authority.',
            detail: { jobId: job.jobId },
        });
    }
    if (!Number.isInteger(Number(job.sessionGeneration)) || Number(job.sessionGeneration) < 0) {
        valid = false;
        violations.push({
            code: 'JOB_SESSION_INVALID',
            message: 'Completed job sessionGeneration must be one non-negative integer.',
            detail: { jobId: job.jobId, sessionGeneration: job.sessionGeneration },
        });
    }
    let reportTypes;
    try {
        reportTypes = JSON.parse(job.reportTypesJson);
    }
    catch {
        reportTypes = null;
    }
    if (!Array.isArray(reportTypes)
        || reportTypes.length !== EXPECTED_REPORT_TYPES.length
        || new Set(reportTypes).size !== EXPECTED_REPORT_TYPES.length
        || EXPECTED_REPORT_TYPES.some((reportType) => !reportTypes.includes(reportType))) {
        valid = false;
        violations.push({
            code: 'JOB_REPORT_CONTRACT_INVALID',
            message: 'Completed job must be authorized for the exact eight report types.',
            detail: { jobId: job.jobId },
        });
    }
    return valid;
}

function validateBatchIdentity(run, job, businessDate, violations) {
    let valid = true;
    if (run.batchBrowserProfileId !== job.browserProfileId) {
        valid = false;
        violations.push({
            code: 'BATCH_PROFILE_MISMATCH',
            message: 'Import batch browser Profile must match the completed job.',
            detail: { batchId: run.batchId, browserProfileId: run.batchBrowserProfileId },
        });
    }
    if (!Number.isInteger(Number(run.batchSessionGeneration))
        || Number(run.batchSessionGeneration) !== Number(job.sessionGeneration)) {
        valid = false;
        violations.push({
            code: 'BATCH_SESSION_MISMATCH',
            message: 'Import batch sessionGeneration must match the completed job.',
            detail: { batchId: run.batchId, sessionGeneration: run.batchSessionGeneration },
        });
    }
    if (run.batchId !== job.jobId
        || run.batchRequestId !== job.requestId
        || run.batchBusinessDate !== businessDate
        || run.batchStatus !== 'completed') {
        valid = false;
        violations.push({
            code: 'BATCH_AUTHORITY_MISMATCH',
            message: 'Import batch request, job, business date and terminal status must match.',
            detail: { batchId: run.batchId, jobId: job.jobId },
        });
    }
    const batchCreatedAtMs = timestampMs(run.batchCreatedAt);
    const batchCompletedAtMs = timestampMs(run.batchCompletedAt);
    if (!Number.isFinite(batchCreatedAtMs)
        || !Number.isFinite(batchCompletedAtMs)
        || batchCreatedAtMs > batchCompletedAtMs
        || !timestampWithin(run.batchCreatedAt, timestampMs(job.createdAt), timestampMs(job.updatedAt))
        || !timestampWithin(run.batchCompletedAt, timestampMs(job.createdAt), timestampMs(job.updatedAt))) {
        valid = false;
        violations.push({
            code: 'BATCH_TIME_INVALID',
            message: 'Import batch timestamps must be ordered inside the durable job lifetime.',
            detail: { batchId: run.batchId },
        });
    }
    return valid;
}

function validateJobTime(job, store, businessDate, generatedAt, violations) {
    const createdAtMs = timestampMs(job.createdAt);
    const completedAtMs = timestampMs(job.completedAt);
    const updatedAtMs = timestampMs(job.updatedAt);
    const generatedAtMs = generatedAt === undefined ? Number.POSITIVE_INFINITY : timestampMs(generatedAt);
    const ordered = Number.isFinite(createdAtMs)
        && Number.isFinite(completedAtMs)
        && Number.isFinite(updatedAtMs)
        && createdAtMs <= completedAtMs
        && completedAtMs <= updatedAtMs
        && updatedAtMs <= generatedAtMs;
    if (!ordered) {
        violations.push({
            code: 'JOB_TIME_INVALID',
            message: 'Completed job timestamps must satisfy createdAt <= completedAt <= updatedAt <= generatedAt.',
            detail: {
                createdAt: job.createdAt,
                completedAt: job.completedAt,
                updatedAt: job.updatedAt,
            },
        });
    }
    const terminalTailValid = ordered && updatedAtMs - completedAtMs <= MAX_TERMINAL_TAIL_MS;
    if (ordered && !terminalTailValid) {
        violations.push({
            code: 'JOB_TERMINAL_TAIL_EXCEEDED',
            message: 'Completed job updatedAt may trail completedAt by at most six hours.',
            detail: { completedAt: job.completedAt, updatedAt: job.updatedAt },
        });
    }
    const businessDateValid = Number.isFinite(completedAtMs)
        && store.businessTimezone === BUSINESS_TIMEZONE
        && job.businessTimezone === BUSINESS_TIMEZONE
        && businessDateInTimezone(job.completedAt, BUSINESS_TIMEZONE) === businessDate;
    if (!businessDateValid) {
        violations.push({
            code: 'JOB_BUSINESS_DATE_MISMATCH',
            message: `Completed job must terminate on its ${BUSINESS_TIMEZONE} businessDate.`,
            detail: { businessDate, completedAt: job.completedAt, businessTimezone: job.businessTimezone },
        });
    }
    return {
        completedAtMs,
        createdAtMs,
        updatedAtMs,
        valid: ordered && terminalTailValid && businessDateValid,
    };
}

function validateImportTime(run, jobTime, violations) {
    const startedAtMs = timestampMs(run.startedAt);
    const completedAtMs = timestampMs(run.completedAt);
    const createdAtMs = timestampMs(run.createdAt);
    const valid = Number.isFinite(startedAtMs)
        && Number.isFinite(completedAtMs)
        && Number.isFinite(createdAtMs)
        && startedAtMs <= completedAtMs
        && startedAtMs <= createdAtMs
        && timestampWithin(run.startedAt, jobTime.createdAtMs, jobTime.updatedAtMs)
        && timestampWithin(run.completedAt, jobTime.createdAtMs, jobTime.updatedAtMs)
        && timestampWithin(run.createdAt, jobTime.createdAtMs, jobTime.updatedAtMs);
    if (!valid) {
        violations.push({
            code: 'IMPORT_TIME_INVALID',
            message: 'Import createdAt/startedAt/completedAt must be ordered inside the durable job lifetime.',
            detail: {
                createdAt: run.createdAt,
                startedAt: run.startedAt,
                completedAt: run.completedAt,
            },
        });
    }
    return { completedAtMs, createdAtMs, startedAtMs, valid };
}

module.exports = { evaluateStoreDay, validateJobIdentity, validateBatchIdentity, validateJobTime, validateImportTime };
