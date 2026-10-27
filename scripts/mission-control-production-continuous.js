// 按职责复用原有严格校验，公共入口继续保持兼容。
const path = require('node:path');
const { SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION, assertMatchingAuthorityCurrentnessProofs, captureAuthoritySnapshotCurrentness, } = require('./sqlite-authority-currentness');
const { S7_CONTINUOUS_OPERATION_KIND, S7_CONTINUOUS_OPERATION_SCHEMA_VERSION, isRecord, nonEmpty, normalizeLogicalId, normalizeSha256, pushReason, realpathEquals, samePath, stableEqual, uniqueExactStrings, validTimestamp, validationResult, withVerifiedReadOnlyDatabase } = require('./mission-control-production-contracts.js');

function isUsBusinessDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const date = new Date(`${value}T12:00:00.000Z`);
    if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
        return false;
    return date.getUTCDay() >= 1 && date.getUTCDay() <= 5;
}

function continuousDayProjection(day) {
    const projected = {
        businessDate: day?.businessDate,
        outcome: day?.outcome,
        accepted: day?.accepted,
        jobId: day?.jobId ?? null,
        reportCount: day?.reportCount,
        importRunId: day?.importRunId ?? null,
    };
    if (day?.blockerCode !== undefined)
        projected.blockerCode = day.blockerCode;
    if (day?.blockerDetail !== undefined)
        projected.blockerDetail = day.blockerDetail;
    return projected;
}

function continuousStoresProjection(stores) {
    return (Array.isArray(stores) ? stores : [])
        .map((store) => ({
        storeId: store?.storeId,
        marketplace: store?.marketplace,
        currency: store?.currency,
        businessTimezone: store?.businessTimezone,
        acceptedDayCount: store?.acceptedDayCount,
        days: (Array.isArray(store?.days) ? store.days : [])
            .map(continuousDayProjection)
            .sort((left, right) => String(left.businessDate).localeCompare(String(right.businessDate))),
    }))
        .sort((left, right) => String(left.storeId).localeCompare(String(right.storeId)));
}

function validateContinuousOperation(evidence, context = {}) {
    const reasons = [];
    let verifiedFileArtifacts = Object.freeze([]);
    pushReason(reasons, isRecord(evidence), 'continuous-operation evidence must be an object');
    if (!isRecord(evidence))
        return validationResult(reasons);
    pushReason(reasons, evidence.kind === S7_CONTINUOUS_OPERATION_KIND, 'unexpected continuous-operation evidence kind');
    pushReason(reasons, evidence.schemaVersion === S7_CONTINUOUS_OPERATION_SCHEMA_VERSION, 'unexpected continuous-operation schema version');
    pushReason(reasons, validTimestamp(evidence.generatedAt), 'continuous-operation generatedAt is invalid');
    pushReason(reasons, evidence.passed === true && evidence.status === 'PASSED', 'continuous-operation evidence did not pass');
    pushReason(reasons, evidence.readinessImpact === 'CONTINUOUS_OPERATION_GATE_ONLY', 'continuous-operation readiness scope is invalid');
    pushReason(reasons, evidence.finalReadinessCredit === false, 'continuous-operation evidence must not rewrite the legacy v1.5 readiness contract');
    pushReason(reasons, evidence.publication?.state === 'atomic-published'
        && evidence.publication?.stagedVerificationCaptureLabel === 'continuous-after-staging-output'
        && nonEmpty(evidence.publication?.outputPath)
        && nonEmpty(context.evidencePath)
        && samePath(evidence.publication?.outputPath, context.evidencePath), 'continuous-operation evidence is not bound to its atomically published final path');
    const currentnessCaptures = Array.isArray(evidence.authorityCurrentness?.captures)
        ? evidence.authorityCurrentness.captures
        : [];
    const requiredCurrentnessLabels = [
        'continuous-before-work',
        'continuous-before-final-output',
        'continuous-after-staging-output',
    ];
    pushReason(reasons, evidence.authorityCurrentness?.passed === true
        && evidence.authorityCurrentness?.method === 'readonly-sqlite-online-backup'
        && stableEqual(currentnessCaptures.map((capture) => capture?.captureLabel), requiredCurrentnessLabels), 'continuous-operation authority currentness must persist all three ordered staging-safe captures');
    const continuousSnapshotArtifact = {
        sha256: normalizeSha256(evidence.database?.sha256),
        sizeBytes: evidence.database?.sizeBytes,
    };
    try {
        const currentnessValidation = assertMatchingAuthorityCurrentnessProofs(currentnessCaptures, continuousSnapshotArtifact, 'Continuous-operation published authority currentness');
        pushReason(reasons, stableEqual(evidence.authorityCurrentness?.expectedSnapshot, currentnessValidation.expectedSnapshot), 'continuous-operation authority currentness expected snapshot does not match its database artifact');
    }
    catch (error) {
        reasons.push(`continuous-operation authority currentness proof is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    const dates = Array.isArray(evidence.window?.businessDates) ? evidence.window.businessDates : [];
    pushReason(reasons, dates.length === 7 && new Set(dates).size === 7, 'continuous-operation window must contain exactly seven distinct US business dates');
    pushReason(reasons, dates.every(isUsBusinessDate), 'continuous-operation window contains a weekend or invalid US business date');
    pushReason(reasons, dates.every((date, index) => index === 0 || dates[index - 1] < date), 'continuous-operation business dates must be strictly increasing');
    pushReason(reasons, evidence.window?.dateFrom === dates[0] && evidence.window?.dateTo === dates.at(-1), 'continuous-operation window bounds do not match its business dates');
    try {
        const { ACCEPTANCE_CONTRACT_VERSION, US_BUSINESS_CALENDAR_VERSION, usFederalBusinessDates, } = require('./verify-s7-continuous-operation');
        pushReason(reasons, evidence.acceptanceContractVersion === ACCEPTANCE_CONTRACT_VERSION, 'continuous-operation acceptance contract version is stale');
        pushReason(reasons, evidence.businessCalendarVersion === US_BUSINESS_CALENDAR_VERSION, 'continuous-operation business calendar version is stale');
        pushReason(reasons, evidence.window?.businessCalendarVersion === US_BUSINESS_CALENDAR_VERSION, 'continuous-operation window calendar version is stale');
        const canonicalDates = usFederalBusinessDates(evidence.window?.dateFrom, evidence.window?.dateTo);
        pushReason(reasons, uniqueExactStrings(dates, canonicalDates) && stableEqual(dates, canonicalDates), 'continuous-operation window is not the canonical seven consecutive Monday-Friday US business dates');
    }
    catch (error) {
        reasons.push(`continuous-operation weekday contract could not be evaluated: ${error instanceof Error ? error.message : String(error)}`);
    }
    pushReason(reasons, evidence.expectedStoreCount === 2
        && evidence.expectedDayCountPerStore === 7
        && evidence.expectedReportCountPerSuccessfulDay === 8, 'continuous-operation expected counts are not 2 stores x 7 days x 8 reports');
    const stores = Array.isArray(evidence.stores) ? evidence.stores : [];
    pushReason(reasons, stores.length === 2 && new Set(stores.map((store) => store?.storeId)).size === 2, 'continuous-operation evidence must contain exactly two distinct stores');
    for (const store of stores) {
        pushReason(reasons, nonEmpty(store?.storeId), 'continuous-operation storeId is missing');
        pushReason(reasons, store?.marketplace === 'US' && store?.currency === 'USD', `continuous-operation store ${store?.storeId || 'unknown'} is not US/USD`);
        pushReason(reasons, nonEmpty(store?.businessTimezone), `continuous-operation store ${store?.storeId || 'unknown'} has no business timezone`);
        const days = Array.isArray(store?.days) ? store.days : [];
        pushReason(reasons, uniqueExactStrings(days.map((day) => day?.businessDate), dates), `continuous-operation store ${store?.storeId || 'unknown'} does not cover the exact seven-day window`);
        pushReason(reasons, store?.acceptedDayCount === 7, `continuous-operation store ${store?.storeId || 'unknown'} did not accept all seven days`);
        for (const day of days) {
            const success = day?.accepted === true
                && day?.outcome === 'SUCCESS_8_OF_8'
                && day?.reportCount === 8
                && nonEmpty(day?.jobId)
                && nonEmpty(day?.importRunId);
            pushReason(reasons, success, `continuous-operation ${store?.storeId || 'unknown'} ${day?.businessDate || 'unknown'} is not a verified SUCCESS_8_OF_8`);
        }
    }
    pushReason(reasons, Array.isArray(evidence.violations) && evidence.violations.length === 0, 'continuous-operation evidence contains violations');
    const inputStores = stores.map((store) => normalizeLogicalId(store?.storeId));
    const storesAreNormalized = inputStores.every(Boolean)
        && stores.every((store, index) => store?.storeId === inputStores[index]);
    pushReason(reasons, storesAreNormalized, 'continuous-operation store ids are not normalized logical ids');
    pushReason(reasons, nonEmpty(evidence.storesRoot)
        && path.isAbsolute(evidence.storesRoot)
        && samePath(evidence.storesRoot, context.canonicalStoresRoot)
        && realpathEquals(evidence.storesRoot, context.canonicalStoresRoot), 'continuous-operation storesRoot is not the canonical snapshot-source USER_DATA_DIR/stores directory');
    const expectedVerifiedFileCount = 2 * 7 * 8;
    pushReason(reasons, samePath(evidence.storeCapsule?.storesRoot, evidence.storesRoot)
        && evidence.storeCapsule?.verifiedFileCount === expectedVerifiedFileCount, 'continuous-operation Store Capsule proof must bind the canonical storesRoot and exactly 112 verified report files');
    if (storesAreNormalized && dates.length === 7 && dates.every(isUsBusinessDate)) {
        const input = {
            stores: inputStores,
            dates,
            dateFrom: dates[0],
            dateTo: dates.at(-1),
            generatedAt: evidence.generatedAt,
            storesRoot: evidence.storesRoot,
        };
        const recomputed = withVerifiedReadOnlyDatabase(evidence.database, 'continuous-operation', reasons, (database) => {
            const { evaluateContinuousOperationSnapshot, readContinuousOperationSnapshot, } = require('./verify-s7-continuous-operation');
            const snapshot = readContinuousOperationSnapshot(database, input);
            return evaluateContinuousOperationSnapshot(snapshot, input);
        }, context);
        if (recomputed) {
            const recomputedArtifacts = Array.isArray(recomputed._verifiedFileArtifacts)
                ? recomputed._verifiedFileArtifacts
                : [];
            verifiedFileArtifacts = Object.freeze(recomputedArtifacts.map((artifact) => Object.freeze({
                filePath: artifact.filePath,
                runKey: artifact.runKey,
                sha256: artifact.sha256,
                sizeBytes: artifact.sizeBytes,
            })));
            pushReason(reasons, recomputed.passed === true, 'continuous-operation read-only database recomputation did not pass');
            pushReason(reasons, verifiedFileArtifacts.length === expectedVerifiedFileCount
                && verifiedFileArtifacts.length === evidence.storeCapsule?.verifiedFileCount, 'continuous-operation recomputation did not retain exactly the 112 verified Store Capsule file artifacts');
            pushReason(reasons, recomputed.expectedStoreCount === evidence.expectedStoreCount
                && recomputed.expectedDayCountPerStore === evidence.expectedDayCountPerStore
                && recomputed.expectedReportCountPerSuccessfulDay === evidence.expectedReportCountPerSuccessfulDay, 'continuous-operation expected counts do not match the read-only database recomputation');
            pushReason(reasons, stableEqual(continuousStoresProjection(evidence.stores), continuousStoresProjection(recomputed.stores)), 'continuous-operation canonical stores/dates/outcomes do not match the read-only database recomputation');
            pushReason(reasons, stableEqual(evidence.violations, recomputed.violations), 'continuous-operation violations do not match the read-only database recomputation');
        }
    }
    else {
        withVerifiedReadOnlyDatabase(evidence.database, 'continuous-operation', reasons, () => null, context);
    }
    return validationResult(reasons, {
        packageIdentity: evidence.packageIdentity,
        verifiedFileArtifacts,
    });
}

module.exports = { isUsBusinessDate, continuousDayProjection, continuousStoresProjection, validateContinuousOperation };
