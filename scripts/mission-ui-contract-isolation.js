// 按职责复用原有严格校验，公共入口继续保持兼容。

const { isSha256 } = require('./mission-ui-contract-artifacts.js');
const { validateWorkspaceCapture } = require('./mission-ui-contract-capture.js');
const { addViolation, fingerprintMissionControlEvidenceValue, isPositiveInteger, isRecord, missionControlBusinessFactSentinels, sameStringArray } = require('./mission-ui-contract-contracts.js');

function validateBusinessFactProjection(projection, projectionPath, violations) {
    const invalid = (message) => addViolation(violations, 'STORE_ISOLATION_FACT_PROJECTION_INVALID', projectionPath, message);
    if (!isRecord(projection)) {
        invalid('Store isolation must include a normalized business fact projection.');
        return false;
    }
    if (!sameStringArray(Object.keys(projection).sort(), ['keywordFacts', 'productAsins', 'scope'])) {
        invalid('Business fact projection may contain only scope, productAsins, and keywordFacts.');
        return false;
    }
    if (!isRecord(projection.scope)
        || !sameStringArray(Object.keys(projection.scope).sort(), ['asin', 'batchId'])
        || typeof projection.scope.asin !== 'string'
        || !projection.scope.asin.trim()
        || typeof projection.scope.batchId !== 'string'
        || !projection.scope.batchId.trim()) {
        invalid('Business fact scope must include non-empty asin and batchId sentinels.');
        return false;
    }
    if (!Array.isArray(projection.productAsins)
        || projection.productAsins.length === 0
        || projection.productAsins.some((asin) => typeof asin !== 'string' || !asin.trim())) {
        invalid('Business fact projection must include non-empty product ASIN facts.');
        return false;
    }
    if (!Array.isArray(projection.keywordFacts)
        || projection.keywordFacts.length === 0
        || projection.keywordFacts.some((fact) => (!isRecord(fact)
            || !sameStringArray(Object.keys(fact).sort(), ['asin', 'keyword'])
            || typeof fact.asin !== 'string'
            || !fact.asin.trim()
            || typeof fact.keyword !== 'string'
            || !fact.keyword.trim()))) {
        invalid('Business fact projection must include normalized ASIN and keyword facts.');
        return false;
    }
    return true;
}

function validateStoreIsolationCapture(capture, violations, options = {}) {
    const capturePath = 'storeIsolationCapture';
    validateWorkspaceCapture(capture, capturePath, violations, {
        ...options,
        expectedCaptureType: 'store-isolation',
        expectedStoreId: 'SHC002',
    });
    if (!isRecord(capture))
        return;
    const transition = capture.transition;
    if (!isRecord(transition)
        || transition.fromStoreId !== 'SHC001'
        || transition.toStoreId !== 'SHC002'
        || transition.explicitUserAction !== true
        || transition.automatic !== false) {
        addViolation(violations, 'STORE_ISOLATION_TRANSITION_INVALID', `${capturePath}.transition`, 'Isolation evidence must record an explicit SHC001 to SHC002 switch.');
    }
    const isolation = capture.isolation;
    if (!isRecord(isolation)) {
        addViolation(violations, 'STORE_ISOLATION_ASSERTIONS_MISSING', `${capturePath}.isolation`, 'Isolation assertions are required.');
        return;
    }
    if (isolation.previousStoreVisible !== false
        || !Array.isArray(isolation.leakedStoreIds)
        || isolation.leakedStoreIds.length !== 0) {
        addViolation(violations, 'STORE_ISOLATION_LEAK_DETECTED', `${capturePath}.isolation`, 'SHC002 capture must not expose SHC001 or any leaked store identity.');
    }
    const normalizedFromBrowserProfileId = typeof isolation.fromBrowserProfileId === 'string'
        ? isolation.fromBrowserProfileId.trim()
        : '';
    const normalizedToBrowserProfileId = typeof isolation.toBrowserProfileId === 'string'
        ? isolation.toBrowserProfileId.trim()
        : '';
    if (!normalizedFromBrowserProfileId
        || !normalizedToBrowserProfileId
        || isolation.fromBrowserProfileId !== normalizedFromBrowserProfileId
        || isolation.toBrowserProfileId !== normalizedToBrowserProfileId
        || normalizedFromBrowserProfileId === normalizedToBrowserProfileId) {
        addViolation(violations, 'STORE_ISOLATION_PROFILE_NOT_DISTINCT', `${capturePath}.isolation`, 'The two stores must use distinct non-empty browser profile identities.');
    }
    const expectedFromIdentityFingerprint = fingerprintMissionControlEvidenceValue({
        browserProfileId: isolation.fromBrowserProfileId,
        storeId: transition?.fromStoreId,
    });
    const expectedToIdentityFingerprint = fingerprintMissionControlEvidenceValue({
        browserProfileId: isolation.toBrowserProfileId,
        storeId: transition?.toStoreId,
    });
    if (!isSha256(isolation.fromIdentityFingerprint)
        || !isSha256(isolation.toIdentityFingerprint)
        || isolation.fromIdentityFingerprint !== expectedFromIdentityFingerprint
        || isolation.toIdentityFingerprint !== expectedToIdentityFingerprint
        || isolation.fromIdentityFingerprint === isolation.toIdentityFingerprint) {
        addViolation(violations, 'STORE_ISOLATION_IDENTITY_FINGERPRINT_INVALID', `${capturePath}.isolation`, 'Identity fingerprints must match the separately recorded store and browser profile identities.');
    }
    const fromProjectionValid = validateBusinessFactProjection(isolation.fromBusinessFactProjection, `${capturePath}.isolation.fromBusinessFactProjection`, violations);
    const toProjectionValid = validateBusinessFactProjection(isolation.toBusinessFactProjection, `${capturePath}.isolation.toBusinessFactProjection`, violations);
    const expectedFromFactsFingerprint = fromProjectionValid
        ? fingerprintMissionControlEvidenceValue(isolation.fromBusinessFactProjection)
        : null;
    const expectedToFactsFingerprint = toProjectionValid
        ? fingerprintMissionControlEvidenceValue(isolation.toBusinessFactProjection)
        : null;
    if (!isSha256(isolation.fromBusinessFactsFingerprint)
        || !isSha256(isolation.toBusinessFactsFingerprint)
        || (expectedFromFactsFingerprint && isolation.fromBusinessFactsFingerprint !== expectedFromFactsFingerprint)
        || (expectedToFactsFingerprint && isolation.toBusinessFactsFingerprint !== expectedToFactsFingerprint)) {
        addViolation(violations, 'STORE_ISOLATION_FACT_FINGERPRINT_MISMATCH', `${capturePath}.isolation`, 'Business fact fingerprints must be recomputable from the normalized projections.');
    }
    if (expectedFromFactsFingerprint
        && expectedToFactsFingerprint
        && expectedFromFactsFingerprint === expectedToFactsFingerprint) {
        addViolation(violations, 'STORE_ISOLATION_FACTS_NOT_DISTINCT', `${capturePath}.isolation`, 'The two stores must have distinct business facts independent of store or browser profile identity.');
    }
    const expectedFromSentinels = missionControlBusinessFactSentinels(isolation.fromBusinessFactProjection);
    const expectedToSentinels = missionControlBusinessFactSentinels(isolation.toBusinessFactProjection);
    const sharedSentinels = expectedFromSentinels.filter((sentinel) => (expectedToSentinels.includes(sentinel)));
    if (expectedFromSentinels.length === 0
        || expectedToSentinels.length === 0
        || !sameStringArray(isolation.fromBusinessFactSentinels, expectedFromSentinels)
        || !sameStringArray(isolation.toBusinessFactSentinels, expectedToSentinels)
        || !Array.isArray(isolation.leakedBusinessFactSentinels)
        || isolation.leakedBusinessFactSentinels.length > 0
        || sharedSentinels.length > 0) {
        addViolation(violations, 'STORE_ISOLATION_BUSINESS_FACT_LEAK_DETECTED', `${capturePath}.isolation`, 'Business fact sentinels must be normalized, store-specific, and absent after switching stores.', {
            leakedSentinels: Array.isArray(isolation.leakedBusinessFactSentinels)
                ? isolation.leakedBusinessFactSentinels
                : [],
            sharedSentinels,
        });
    }
}

function validateMinimumWindowCapture(capture, violations, options = {}) {
    const capturePath = 'minimumWindowCapture';
    validateWorkspaceCapture(capture, capturePath, violations, {
        ...options,
        expectedCaptureType: 'minimum-window',
        expectedStoreId: 'SHC001',
    });
    if (!isRecord(capture))
        return;
    if (capture.workspace !== 'execution' || capture.scalePercent !== 100) {
        addViolation(violations, 'MINIMUM_WINDOW_CAPTURE_TARGET_INVALID', capturePath, 'Minimum-window evidence must capture execution/live at 100%.');
    }
    if (capture.viewport?.width !== 1200) {
        addViolation(violations, 'MINIMUM_WINDOW_WIDTH_INVALID', `${capturePath}.viewport.width`, 'Minimum-window evidence must use the supported 1200px application width.');
    }
    const layout = capture.executionLayout;
    if (!isRecord(layout)) {
        addViolation(violations, 'MINIMUM_WINDOW_LAYOUT_MISSING', `${capturePath}.executionLayout`, 'Minimum-window evidence must include execution table layout measurements.');
        return;
    }
    if (layout.roomColumnCount !== 1
        || layout.tableClipped !== false
        || layout.scrollContainerOverflowX !== 'auto'
        || !isPositiveInteger(layout.frameClientWidth)
        || !isPositiveInteger(layout.tableClientWidth)
        || !isPositiveInteger(layout.tableScrollWidth)) {
        addViolation(violations, 'MINIMUM_WINDOW_EXECUTION_CLIPPED', `${capturePath}.executionLayout`, 'At 1200px the execution room must be one column and its wide table must not be clipped.');
    }
}

module.exports = { validateBusinessFactProjection, validateStoreIsolationCapture, validateMinimumWindowCapture };
