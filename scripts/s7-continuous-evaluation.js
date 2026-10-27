// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const { normalizePackageIdentity, sha256File } = require('./s7-continuous-artifacts.js');
const { recentCompletedUsBusinessDates } = require('./s7-continuous-calendar.js');
const { ACCEPTANCE_CONTRACT_VERSION, BUSINESS_TIMEZONE, EXPECTED_REPORT_TYPES, SCHEMA_VERSION, US_BUSINESS_CALENDAR_VERSION, lower } = require('./s7-continuous-contracts.js');
const { evaluateStoreDay } = require('./s7-continuous-days.js');
const { detectCrossStoreLeakage, validateGlobalImportProofs } = require('./s7-continuous-imports.js');
const { selectAuthoritativeLineageSnapshot } = require('./s7-continuous-lineage.js');

function evaluateContinuousOperationSnapshot(snapshot, input) {
    const violations = [];
    const storeResults = [];
    const globalActiveUsUsdStoreCount = Number(snapshot.globalActiveUsUsdStoreCount);
    const storeById = new Map(snapshot.stores.map((store) => [String(store.storeId).toLowerCase(), store]));
    const addViolation = (code, message, detail = {}) => violations.push({ code, message, ...detail });
    if (globalActiveUsUsdStoreCount !== 2) {
        addViolation('ACTIVE_US_USD_STORE_COUNT_NOT_TWO', 'The authority database must contain exactly two active US/USD stores globally.', {
            actualCount: Number.isFinite(globalActiveUsUsdStoreCount)
                ? globalActiveUsUsdStoreCount
                : null,
            expectedCount: 2,
        });
    }
    let canonicalDates = [];
    try {
        canonicalDates = recentCompletedUsBusinessDates(input.generatedAt);
    }
    catch {
    }
    if (canonicalDates.length !== 7
        || JSON.stringify(input.dates) !== JSON.stringify(canonicalDates)) {
        addViolation('WINDOW_NOT_RECENT_COMPLETED', `Window must be the most recent seven completed US federal business dates in ${BUSINESS_TIMEZONE}.`);
    }
    const authoritativeSnapshot = selectAuthoritativeLineageSnapshot(snapshot, input);
    const importProof = validateGlobalImportProofs(authoritativeSnapshot, input, addViolation);
    for (const storeId of input.stores) {
        const store = storeById.get(storeId);
        if (!store) {
            addViolation('STORE_NOT_FOUND', `Store ${storeId} is missing from the authority database.`, { storeId });
            continue;
        }
        if (store.status !== 'active'
            || store.marketplace !== 'US'
            || store.currency !== 'USD'
            || store.businessTimezone !== BUSINESS_TIMEZONE) {
            addViolation('STORE_AUTHORITY_INVALID', `Store ${storeId} must be active US/USD authority in ${BUSINESS_TIMEZONE}.`, { storeId });
        }
        const days = input.dates.map((businessDate) => (evaluateStoreDay(snapshot, store, businessDate, input, importProof)));
        for (const day of days) {
            for (const dayViolation of day.violations)
                addViolation(dayViolation.code, dayViolation.message, { storeId, businessDate: day.businessDate, ...dayViolation.detail });
        }
        storeResults.push({
            storeId,
            marketplace: store.marketplace,
            currency: store.currency,
            businessTimezone: store.businessTimezone,
            days: days.map(({ violations: _violations, ...day }) => day),
            acceptedDayCount: days.filter((day) => day.accepted).length,
        });
    }
    const authoritativeStoreById = new Map(authoritativeSnapshot.stores.map((store) => [
        lower(store.storeId),
        store,
    ]));
    detectCrossStoreLeakage(authoritativeSnapshot, authoritativeStoreById, addViolation);
    const result = {
        passed: violations.length === 0 && storeResults.length === 2 && storeResults.every((store) => store.acceptedDayCount === 7),
        acceptanceContractVersion: ACCEPTANCE_CONTRACT_VERSION,
        businessCalendarVersion: US_BUSINESS_CALENDAR_VERSION,
        expectedStoreCount: 2,
        expectedDayCountPerStore: 7,
        expectedReportCountPerSuccessfulDay: EXPECTED_REPORT_TYPES.length,
        globalActiveUsUsdStoreCount: Number.isFinite(globalActiveUsUsdStoreCount)
            ? globalActiveUsUsdStoreCount
            : null,
        stores: storeResults,
        violations,
    };
    Object.defineProperty(result, '_verifiedFileArtifacts', {
        configurable: false,
        enumerable: false,
        value: importProof.verifiedFileArtifacts,
        writable: false,
    });
    return result;
}

function buildEvidenceManifest(databasePath, input, result, integrityCheck, authoritySnapshot) {
    const stat = fs.statSync(databasePath);
    const packageIdentity = normalizePackageIdentity(authoritySnapshot?.packageIdentity);
    return {
        kind: 's7-continuous-operation-evidence',
        schemaVersion: SCHEMA_VERSION,
        generatedAt: input.generatedAt,
        status: result.passed ? 'PASSED' : 'BLOCKED',
        readinessImpact: 'CONTINUOUS_OPERATION_GATE_ONLY',
        finalReadinessCredit: false,
        packageIdentity,
        storesRoot: authoritySnapshot.storesRoot,
        storeCapsule: {
            storesRoot: authoritySnapshot.storesRoot,
            verifiedFileCount: result._verifiedFileArtifacts?.length ?? 0,
        },
        database: {
            absolutePath: databasePath,
            sha256: sha256File(databasePath),
            sizeBytes: stat.size,
            integrityCheck,
            openedReadOnly: true,
            packageIdentity,
            snapshotManifestSha256: authoritySnapshot.snapshotManifestSha256,
        },
        authoritySnapshotManifest: {
            absolutePath: authoritySnapshot.manifestPath,
            sha256: authoritySnapshot.snapshotManifestSha256,
        },
        authorityCurrentness: input.authorityCurrentness,
        publication: input.publication ?? null,
        window: {
            dateFrom: input.dateFrom,
            dateTo: input.dateTo,
            businessDates: input.dates,
            businessCalendarVersion: US_BUSINESS_CALENDAR_VERSION,
        },
        ...result,
    };
}

module.exports = { evaluateContinuousOperationSnapshot, buildEvidenceManifest };
