// 按职责复用原有严格校验，公共入口继续保持兼容。

const { validateScreenshot } = require('./mission-ui-contract-artifacts.js');
const { EXPECTED_MISSION_CONTROL_SCALES, EXPECTED_MISSION_CONTROL_STORE_IDS, MISSION_CONTROL_WORKSPACE_CONTRACT, addViolation, isPositiveInteger, isRecord, sameStringArray } = require('./mission-ui-contract-contracts.js');

function validateViewport(capture, capturePath, violations) {
    const viewport = capture.viewport;
    if (!isRecord(viewport)) {
        addViolation(violations, 'VIEWPORT_MISSING', `${capturePath}.viewport`, 'Capture must include viewport metrics.');
        return;
    }
    for (const key of ['width', 'height', 'clientWidth', 'scrollWidth']) {
        if (!isPositiveInteger(viewport[key])) {
            addViolation(violations, 'VIEWPORT_METRIC_INVALID', `${capturePath}.viewport.${key}`, `${key} must be a positive integer.`);
        }
    }
    const expectedDeviceScaleFactor = capture.scalePercent === 125 ? 1.25 : 1;
    if (viewport.deviceScaleFactor !== expectedDeviceScaleFactor) {
        addViolation(violations, 'DEVICE_SCALE_FACTOR_MISMATCH', `${capturePath}.viewport.deviceScaleFactor`, `deviceScaleFactor must be ${expectedDeviceScaleFactor} at ${capture.scalePercent}% evidence scale.`);
    }
    if (viewport.horizontalOverflow !== false) {
        addViolation(violations, 'HORIZONTAL_OVERFLOW_REPORTED', `${capturePath}.viewport.horizontalOverflow`, 'Capture must explicitly report no horizontal overflow.');
    }
    if (isPositiveInteger(viewport.clientWidth)
        && isPositiveInteger(viewport.scrollWidth)
        && viewport.scrollWidth > viewport.clientWidth) {
        addViolation(violations, 'HORIZONTAL_OVERFLOW_DETECTED', `${capturePath}.viewport.scrollWidth`, 'scrollWidth must not exceed clientWidth.', { actual: viewport.scrollWidth, expectedMaximum: viewport.clientWidth });
    }
}

function validateErrors(capture, capturePath, violations) {
    const errors = capture.errors;
    if (!isRecord(errors)) {
        addViolation(violations, 'RUNTIME_ERRORS_MISSING', `${capturePath}.errors`, 'Capture must include console and page error arrays.');
        return;
    }
    for (const channel of ['console', 'page']) {
        if (!Array.isArray(errors[channel])) {
            addViolation(violations, 'RUNTIME_ERROR_CHANNEL_MISSING', `${capturePath}.errors.${channel}`, `${channel} errors must be recorded as an array.`);
        }
        else if (errors[channel].length > 0) {
            addViolation(violations, channel === 'console' ? 'CONSOLE_ERRORS_PRESENT' : 'PAGE_ERRORS_PRESENT', `${capturePath}.errors.${channel}`, `${channel} errors must be empty.`, { count: errors[channel].length });
        }
    }
}

function validateMarketAuthority(authority, authorityPath, violations, expectedStoreId) {
    if (!isRecord(authority)) {
        addViolation(violations, 'STORE_AUTHORITY_MISSING', authorityPath, 'Capture must include Main-authoritative store context.');
        return;
    }
    if (authority.storeId !== expectedStoreId) {
        addViolation(violations, 'STORE_AUTHORITY_MISMATCH', `${authorityPath}.storeId`, `Authoritative storeId must be ${expectedStoreId}.`, { actual: authority.storeId, expected: expectedStoreId });
    }
    if (authority.marketplace !== 'US') {
        addViolation(violations, 'MARKETPLACE_NOT_US', `${authorityPath}.marketplace`, 'Mission Control Stage7 evidence is US-only.', { actual: authority.marketplace, expected: 'US' });
    }
    if (authority.currency !== 'USD') {
        addViolation(violations, 'CURRENCY_NOT_USD', `${authorityPath}.currency`, 'Mission Control Stage7 evidence must use USD.', { actual: authority.currency, expected: 'USD' });
    }
}

function validateAutonomy(capture, capturePath, violations) {
    const autonomy = capture.autonomy;
    if (!isRecord(autonomy)) {
        addViolation(violations, 'AUTONOMY_EVIDENCE_MISSING', `${capturePath}.autonomy`, 'Capture must include autonomy authority.');
        return;
    }
    const validMode = autonomy.currentMode === 'manual_approval' || autonomy.currentMode === 'policy_auto';
    const availabilityConsistent = (autonomy.policyAutoAvailable === true && autonomy.policyAutoState === 'AVAILABLE') || (autonomy.policyAutoAvailable === false
        && autonomy.policyAutoState === 'BLOCKED'
        && typeof autonomy.policyAutoBlockerCode === 'string'
        && autonomy.policyAutoBlockerCode.trim().length > 0);
    const activeModeAuthorized = autonomy.currentMode !== 'policy_auto' || autonomy.policyAutoAvailable === true;
    if (!validMode
        || autonomy.manualApprovalAvailable !== true
        || !availabilityConsistent
        || !activeModeAuthorized) {
        addViolation(violations, 'AUTONOMY_AUTHORITY_INCONSISTENT', `${capturePath}.autonomy`, 'Stage7 evidence must show manual approval and policy-auto availability consistently with the Main authority projection.');
    }
}

function validateHeading(capture, capturePath, violations, expectedHeading) {
    const h1 = capture.h1;
    if (!isRecord(h1) || h1.count !== 1 || typeof h1.text !== 'string' || h1.text.trim().length === 0) {
        addViolation(violations, 'H1_CONTRACT_INVALID', `${capturePath}.h1`, 'Workspace capture must expose exactly one non-empty h1.', { actual: h1, expected: expectedHeading || 'one non-empty h1' });
        return;
    }
    if (typeof expectedHeading === 'string' && h1.text !== expectedHeading) {
        addViolation(violations, 'H1_CONTRACT_INVALID', `${capturePath}.h1.text`, `Workspace h1 must exactly match the registered heading: ${expectedHeading}.`, { actual: h1.text, expected: expectedHeading });
    }
}

function validateWorkspaceCapture(capture, capturePath, violations, options = {}) {
    if (!isRecord(capture)) {
        addViolation(violations, 'WORKSPACE_CAPTURE_INVALID', capturePath, 'Workspace capture must be an object.');
        return;
    }
    const contract = MISSION_CONTROL_WORKSPACE_CONTRACT[capture.workspace];
    if (typeof capture.captureId !== 'string' || capture.captureId.trim().length === 0) {
        addViolation(violations, 'CAPTURE_ID_MISSING', `${capturePath}.captureId`, 'Capture must include a stable non-empty captureId.');
    }
    const expectedCaptureType = options.expectedCaptureType || 'workspace';
    if (capture.captureType !== expectedCaptureType) {
        addViolation(violations, 'CAPTURE_TYPE_INVALID', `${capturePath}.captureType`, `captureType must be ${expectedCaptureType}.`);
    }
    if (!contract) {
        addViolation(violations, 'WORKSPACE_UNKNOWN', `${capturePath}.workspace`, `Unknown Mission Control workspace: ${String(capture.workspace)}.`);
    }
    if (!EXPECTED_MISSION_CONTROL_SCALES.includes(capture.scalePercent)) {
        addViolation(violations, 'SCALE_UNSUPPORTED', `${capturePath}.scalePercent`, 'Workspace evidence scale must be 100 or 125.');
    }
    if (contract) {
        const intent = capture.defaultIntent;
        if (!isRecord(intent)
            || intent.workspace !== contract.defaultIntent.workspace
            || intent.subview !== contract.defaultIntent.subview
            || intent.view !== contract.defaultIntent.view) {
            addViolation(violations, 'DEFAULT_INTENT_MISMATCH', `${capturePath}.defaultIntent`, `Capture must use the registered default intent ${contract.defaultIntent.view}.`);
        }
        const tabs = capture.tabs;
        if (!isRecord(tabs)
            || !sameStringArray(tabs.renderedSubviews, contract.tabs)
            || tabs.activeSubview !== contract.defaultIntent.subview) {
            addViolation(violations, 'WORKSPACE_TABS_MISMATCH', `${capturePath}.tabs`, `Rendered tabs and active tab must match the ${capture.workspace} workspace contract.`);
        }
    }
    validateScreenshot(capture, capturePath, violations, options);
    validateViewport(capture, capturePath, violations);
    validateHeading(capture, capturePath, violations, contract?.heading);
    validateMarketAuthority(capture.authority, `${capturePath}.authority`, violations, options.expectedStoreId || 'SHC001');
    validateAutonomy(capture, capturePath, violations);
    validateErrors(capture, capturePath, violations);
}

function validateStoreGateCapture(capture, violations, options = {}) {
    const capturePath = 'storeGateCapture';
    if (!isRecord(capture)) {
        addViolation(violations, 'STORE_GATE_CAPTURE_MISSING', capturePath, 'StoreGate evidence capture is required.');
        return;
    }
    if (capture.captureType !== 'store-gate' || capture.state !== 'needs-selection') {
        addViolation(violations, 'STORE_GATE_STATE_INVALID', capturePath, 'StoreGate capture must prove the needs-selection state.');
    }
    if (capture.activeStoreId !== null || capture.explicitSelectionRequired !== true || capture.autoSelected !== false) {
        addViolation(violations, 'STORE_GATE_AUTO_SELECTION_UNSAFE', capturePath, 'StoreGate must have no active store and must require explicit selection.');
    }
    if (!sameStringArray(capture.availableStoreIds, EXPECTED_MISSION_CONTROL_STORE_IDS)) {
        addViolation(violations, 'STORE_GATE_STORE_SET_MISMATCH', `${capturePath}.availableStoreIds`, 'StoreGate must show the two isolated preview stores in deterministic order.');
    }
    if (capture.marketplace !== 'US') {
        addViolation(violations, 'MARKETPLACE_NOT_US', `${capturePath}.marketplace`, 'StoreGate must be US-only.');
    }
    if (capture.currency !== 'USD') {
        addViolation(violations, 'CURRENCY_NOT_USD', `${capturePath}.currency`, 'StoreGate must use USD.');
    }
    if (!EXPECTED_MISSION_CONTROL_SCALES.includes(capture.scalePercent)) {
        addViolation(violations, 'SCALE_UNSUPPORTED', `${capturePath}.scalePercent`, 'StoreGate evidence scale must be 100 or 125.');
    }
    validateScreenshot(capture, capturePath, violations, options);
    validateViewport(capture, capturePath, violations);
    validateHeading(capture, capturePath, violations);
    validateErrors(capture, capturePath, violations);
}

module.exports = { validateViewport, validateErrors, validateMarketAuthority, validateAutonomy, validateHeading, validateWorkspaceCapture, validateStoreGateCapture };
