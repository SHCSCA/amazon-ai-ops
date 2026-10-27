// 按职责复用原有严格校验，公共入口继续保持兼容。
const { EXPECTED_REPORT_TYPES, BUSINESS_TIMEZONE, evaluateContinuousOperationSnapshot, loadAuthoritySnapshotManifest, readContinuousOperationSnapshot, recentCompletedUsBusinessDates, } = require('./verify-s7-continuous-operation');
const { businessDateInLosAngeles, normalizedId, safeViolationDetail, stableRef } = require('./stage8-operator-contracts.js');
const { tableSet } = require('./stage8-operator-schema.js');

function reportMatrix(snapshot, evaluation, stores, aliases, dates) {
    const resultByStore = new Map((evaluation?.stores || []).map((row) => [normalizedId(row.storeId), row]));
    const rows = [];
    for (const store of stores) {
        const storeId = normalizedId(store.storeId);
        const storeResult = resultByStore.get(storeId);
        for (const businessDate of dates) {
            const dayResult = storeResult?.days?.find((day) => day.businessDate === businessDate) || null;
            const job = snapshot.jobs.find((row) => (normalizedId(row.storeId) === storeId
                && row.businessDate === businessDate
                && row.jobId === dayResult?.jobId)) || null;
            const checkpoints = job
                ? snapshot.checkpoints.filter((row) => (normalizedId(row.storeId) === storeId && row.jobId === job.jobId))
                : [];
            const importRun = dayResult?.importRunId
                ? snapshot.imports.find((row) => (normalizedId(row.storeId) === storeId
                    && row.runId === dayResult.importRunId))
                : null;
            const reports = EXPECTED_REPORT_TYPES.map((reportType) => {
                const checkpoint = checkpoints.find((row) => row.reportType === reportType);
                const imported = importRun && snapshot.importFiles.some((row) => (normalizedId(row.storeId) === storeId
                    && row.runId === importRun.runId
                    && row.reportType === reportType));
                const reconciled = importRun && snapshot.reconciliations.some((row) => (normalizedId(row.storeId) === storeId
                    && row.runId === importRun.runId
                    && row.reportType === reportType
                    && row.status === 'matched'
                    && Number(row.withinTolerance) === 1));
                let status = 'MISSING';
                if (checkpoint?.state)
                    status = String(checkpoint.state).toUpperCase();
                if (imported)
                    status = 'IMPORTED';
                if (imported && reconciled)
                    status = 'VERIFIED';
                return { reportType, status };
            });
            rows.push({
                accepted: dayResult?.accepted === true,
                businessDate,
                importRef: stableRef('import-run', dayResult?.importRunId),
                jobRef: stableRef('collection-job', dayResult?.jobId),
                outcome: dayResult?.outcome || 'MISSING',
                reports,
                storeAlias: aliases.get(storeId),
            });
        }
    }
    return rows;
}

function inspectContinuous(database, stores, aliases, generatedAt) {
    const dates = recentCompletedUsBusinessDates(generatedAt);
    const tables = tableSet(database);
    const required = [
        'stores',
        'lingxing_collection_jobs',
        'lingxing_collection_report_checkpoints',
        'report_import_runs',
        'report_import_file_snapshots',
        'report_import_reconciliations',
        'lingxing_report_batches',
    ];
    if (stores.length !== 2 || required.some((name) => !tables.has(name))) {
        return {
            acceptedStoreDays: 0,
            businessDates: dates,
            expectedStoreDays: 14,
            matrix: [],
            passed: false,
            status: 'BLOCKED_BY_SCHEMA_OR_STORE_SELECTION',
            violations: [{
                    businessDate: null,
                    code: 'CONTINUOUS_INPUT_NOT_READY',
                    detail: safeViolationDetail({ code: 'CONTINUOUS_INPUT_NOT_READY' }),
                    storeAlias: null,
                }],
        };
    }
    const input = {
        dateFrom: dates[0],
        dateTo: dates.at(-1),
        dates,
        generatedAt,
        stores: stores.map((store) => normalizedId(store.storeId)),
    };
    let snapshot;
    let evaluation;
    try {
        snapshot = readContinuousOperationSnapshot(database, input);
        evaluation = evaluateContinuousOperationSnapshot(snapshot, input);
    }
    catch {
        return {
            acceptedStoreDays: 0,
            businessDates: dates,
            expectedStoreDays: 14,
            matrix: [],
            passed: false,
            status: 'READ_ONLY_EVALUATION_FAILED',
            violations: [{
                    businessDate: null,
                    code: 'CONTINUOUS_READ_ONLY_EVALUATION_FAILED',
                    detail: safeViolationDetail({ code: 'CONTINUOUS_READ_ONLY_EVALUATION_FAILED' }),
                    storeAlias: null,
                }],
        };
    }
    const matrix = reportMatrix(snapshot, evaluation, stores, aliases, dates);
    const aliasByRawStore = new Map(stores.map((store) => [
        normalizedId(store.storeId),
        aliases.get(normalizedId(store.storeId)),
    ]));
    const violations = evaluation.violations.map((violation) => ({
        businessDate: violation.businessDate || null,
        code: violation.code,
        detail: safeViolationDetail(violation),
        storeAlias: violation.storeId
            ? aliasByRawStore.get(normalizedId(violation.storeId)) || null
            : null,
    }));
    return {
        acceptedStoreDays: matrix.filter((row) => row.accepted).length,
        businessDates: dates,
        expectedReportsPerStoreDay: EXPECTED_REPORT_TYPES.length,
        expectedStoreDays: 14,
        matrix,
        passed: evaluation.passed === true,
        status: evaluation.passed ? 'PASSED' : 'PARTIAL',
        violations,
    };
}

function inspectToday(database, stores, aliases, generatedAt) {
    const tables = tableSet(database);
    const businessDate = businessDateInLosAngeles(generatedAt);
    if (!tables.has('lingxing_collection_jobs')
        || !tables.has('lingxing_collection_report_checkpoints')) {
        return {
            businessDate,
            tasks: stores.map((store) => ({
                gaps: ['COLLECTION_SCHEMA_MISSING'],
                reports: EXPECTED_REPORT_TYPES.map((reportType) => ({
                    reportType,
                    status: 'MISSING',
                })),
                state: 'NOT_AVAILABLE',
                storeAlias: aliases.get(normalizedId(store.storeId)),
            })),
        };
    }
    const tasks = stores.map((store) => {
        const jobs = database.prepare(`
      SELECT job_id AS jobId, state, blocker_code AS blockerCode,
             detail, updated_at AS updatedAt
      FROM lingxing_collection_jobs
      WHERE store_id = ? AND business_date = ?
      ORDER BY updated_at DESC, job_id DESC
    `).all(store.storeId, businessDate);
        const job = jobs[0] || null;
        const checkpoints = job
            ? database.prepare(`
        SELECT report_type AS reportType, state, error_code AS errorCode
        FROM lingxing_collection_report_checkpoints
        WHERE store_id = ? AND job_id = ?
      `).all(store.storeId, job.jobId)
            : [];
        const reports = EXPECTED_REPORT_TYPES.map((reportType) => {
            const checkpoint = checkpoints.find((row) => row.reportType === reportType);
            return {
                errorCode: checkpoint?.errorCode || null,
                reportType,
                status: checkpoint?.state ? String(checkpoint.state).toUpperCase() : 'MISSING',
            };
        });
        const gaps = [];
        if (!job)
            gaps.push('COLLECTION_JOB_NOT_CREATED');
        else if (job.state !== 'completed')
            gaps.push('COLLECTION_JOB_NOT_COMPLETED');
        if (reports.some((report) => report.status !== 'DOWNLOADED')) {
            gaps.push('REPORT_SET_NOT_8_OF_8');
        }
        return {
            blockerCode: job?.blockerCode || null,
            gaps,
            jobRef: stableRef('collection-job', job?.jobId),
            reports,
            state: job?.state || 'missing',
            storeAlias: aliases.get(normalizedId(store.storeId)),
        };
    });
    return { businessDate, tasks };
}

module.exports = { reportMatrix, inspectContinuous, inspectToday };
