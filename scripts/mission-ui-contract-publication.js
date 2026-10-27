// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { currentMissionControlUiEvidenceSourceHashes } = require('./mission-ui-contract-artifacts.js');
const { validateStoreGateCapture, validateWorkspaceCapture } = require('./mission-ui-contract-capture.js');
const { EXPECTED_MISSION_CONTROL_SCALES, EXPECTED_MISSION_CONTROL_WORKSPACES, MISSION_CONTROL_UI_EVIDENCE_KIND, MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION, addViolation, isRecord } = require('./mission-ui-contract-contracts.js');
const { validateMinimumWindowCapture, validateStoreIsolationCapture } = require('./mission-ui-contract-isolation.js');
const { validateSourceProvenance } = require('./mission-ui-contract-provenance.js');

function evaluateMissionControlUiEvidenceManifest(value, options = {}) {
    const violations = [];
    if (!isRecord(value)) {
        addViolation(violations, 'MANIFEST_INVALID', '$', 'Mission Control UI evidence manifest must be an object.');
        return { passed: false, violations };
    }
    if (value.kind !== MISSION_CONTROL_UI_EVIDENCE_KIND) {
        addViolation(violations, 'MANIFEST_KIND_INVALID', 'kind', `kind must be ${MISSION_CONTROL_UI_EVIDENCE_KIND}.`);
    }
    if (value.schemaVersion !== MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION) {
        addViolation(violations, 'SCHEMA_VERSION_INVALID', 'schemaVersion', `schemaVersion must be ${MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION}.`);
    }
    if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) {
        addViolation(violations, 'GENERATED_AT_INVALID', 'generatedAt', 'generatedAt must be an ISO-compatible timestamp.');
    }
    if (value.status !== 'STAGE7_UI_EVIDENCE'
        || value.readinessImpact !== 'NO_FINAL_READINESS_CREDIT'
        || value.finalReadinessCredit !== false) {
        addViolation(violations, 'READINESS_SCOPE_UNSAFE', 'status', 'Stage7 UI evidence must explicitly carry no final production-readiness credit.');
    }
    validateSourceProvenance(value.source, violations, options);
    if (!Array.isArray(value.workspaceCaptures)) {
        addViolation(violations, 'WORKSPACE_CAPTURES_MISSING', 'workspaceCaptures', 'workspaceCaptures must be an array.');
    }
    else {
        value.workspaceCaptures.forEach((capture, index) => {
            validateWorkspaceCapture(capture, `workspaceCaptures[${index}]`, violations, options);
        });
        const expectedCaptureCount = EXPECTED_MISSION_CONTROL_WORKSPACES.length
            * EXPECTED_MISSION_CONTROL_SCALES.length;
        if (value.workspaceCaptures.length !== expectedCaptureCount) {
            addViolation(violations, 'WORKSPACE_CAPTURE_COUNT_MISMATCH', 'workspaceCaptures', `Exactly ${expectedCaptureCount} workspace captures are required.`, { actual: value.workspaceCaptures.length, expected: expectedCaptureCount });
        }
        for (const workspace of EXPECTED_MISSION_CONTROL_WORKSPACES) {
            for (const scalePercent of EXPECTED_MISSION_CONTROL_SCALES) {
                const matches = value.workspaceCaptures.filter((capture) => (capture?.workspace === workspace && capture?.scalePercent === scalePercent));
                if (matches.length !== 1) {
                    addViolation(violations, matches.length === 0 ? 'WORKSPACE_SCALE_CAPTURE_MISSING' : 'WORKSPACE_SCALE_CAPTURE_DUPLICATE', 'workspaceCaptures', `Expected exactly one ${workspace} capture at ${scalePercent}%.`, { actual: matches.length, workspace, scalePercent });
                }
            }
        }
    }
    validateStoreGateCapture(value.storeGateCapture, violations, options);
    validateStoreIsolationCapture(value.storeIsolationCapture, violations, options);
    validateMinimumWindowCapture(value.minimumWindowCapture, violations, options);
    return {
        passed: violations.length === 0,
        expectedWorkspaceCount: EXPECTED_MISSION_CONTROL_WORKSPACES.length,
        expectedWorkspaceCaptureCount: EXPECTED_MISSION_CONTROL_WORKSPACES.length
            * EXPECTED_MISSION_CONTROL_SCALES.length,
        violations,
    };
}

function validateMissionControlUiEvidenceManifest(value, options = {}) {
    const result = evaluateMissionControlUiEvidenceManifest(value, options);
    if (!result.passed) {
        const summary = result.violations
            .map((violation) => `${violation.code} at ${violation.path}: ${violation.message}`)
            .join('\n');
        const error = new Error(`Mission Control UI evidence manifest failed validation:\n${summary}`);
        error.code = 'MISSION_CONTROL_UI_EVIDENCE_INVALID';
        error.violations = result.violations;
        throw error;
    }
    return value;
}

function main(argv = process.argv.slice(2)) {
    const inputPath = argv[0];
    if (!inputPath || argv.length !== 1) {
        throw new Error('Usage: node scripts/mission-control-ui-evidence-contract.js <manifest.json>');
    }
    const absolutePath = path.resolve(inputPath);
    const manifest = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    const result = evaluateMissionControlUiEvidenceManifest(manifest, {
        expectedSourceHashes: currentMissionControlUiEvidenceSourceHashes(),
        verifyScreenshotFiles: true,
    });
    if (!result.passed) {
        for (const violation of result.violations) {
            console.error(`[FAIL] ${violation.code} ${violation.path}: ${violation.message}`);
        }
        process.exitCode = 1;
        return result;
    }
    console.log(`[PASS] Mission Control UI evidence: ${absolutePath}`);
    console.log(`[PASS] ${result.expectedWorkspaceCaptureCount} workspace captures + StoreGate + SHC001->SHC002 isolation + 1200px minimum-window execution`);
    return result;
}

module.exports = { evaluateMissionControlUiEvidenceManifest, validateMissionControlUiEvidenceManifest, main };
