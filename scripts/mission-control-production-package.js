// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { validatePackageLaunchSmokeEvidence } = require('./package-launch-validation');
const { PACKAGE_IDENTITY_FIELDS, V15_GATE_IDS, V15_SUPERSEDED_GATE_ID, V15_SUPERSEDING_GATE_IDS, currentFileMatches, isPathContained, isRecord, nonEmpty, normalizeSha256, pushReason, realpathEquals, realpathIsContained, samePath, sha256File, stableEqual, uniqueExactStrings, validTimestamp, validationResult } = require('./mission-control-production-contracts.js');

function validateV15FinalReadiness(evidence, context) {
    const reasons = [];
    pushReason(reasons, isRecord(evidence), 'v1.5 final-readiness evidence must be an object');
    if (!isRecord(evidence))
        return validationResult(reasons);
    pushReason(reasons, validTimestamp(evidence.generatedAt), 'v1.5 final-readiness generatedAt is invalid');
    pushReason(reasons, evidence.manifestDriven === true, 'v1.5 final-readiness is not manifest driven');
    pushReason(reasons, evidence.evidenceSelection?.mode === 'manifest', 'v1.5 final-readiness did not use an explicit evidence manifest');
    const manifestPath = evidence.evidenceSelection?.manifestPath;
    pushReason(reasons, nonEmpty(manifestPath) && path.isAbsolute(manifestPath) && fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile(), 'v1.5 evidence manifest path is missing or no longer exists');
    const gates = Array.isArray(evidence.gates) ? evidence.gates : [];
    pushReason(reasons, uniqueExactStrings(gates.map((gate) => gate?.id), V15_GATE_IDS), 'v1.5 final-readiness must retain exactly its eight formal gates');
    const supersededGate = gates.find((gate) => gate?.id === V15_SUPERSEDED_GATE_ID);
    const otherGates = gates.filter((gate) => gate?.id !== V15_SUPERSEDED_GATE_ID);
    const failures = Array.isArray(evidence.failures) ? evidence.failures : [];
    const readyState = evidence.status === 'APP_READY'
        && evidence.appReady === true
        && evidence.allGatesPass === true
        && evidence.formalAllGatesPass === true
        && gates.length === 8
        && gates.every((gate) => gate?.ok === true && gate?.status === 'passed')
        && Array.isArray(evidence.failures)
        && failures.length === 0
        && Array.isArray(evidence.missing)
        && evidence.missing.length === 0;
    const supersededState = evidence.status === 'APP_NEEDS_WORK'
        && evidence.appReady === false
        && evidence.allGatesPass === false
        && evidence.formalAllGatesPass === false
        && gates.length === 8
        && otherGates.length === 7
        && otherGates.every((gate) => gate?.ok === true && gate?.status === 'passed')
        && supersededGate?.ok === false
        && supersededGate?.status === 'needs_work'
        && failures.length === 1
        && failures[0]?.gateId === V15_SUPERSEDED_GATE_ID
        && failures[0]?.code === 'GATE_FAILED'
        && samePath(failures[0]?.evidencePath, supersededGate?.evidencePath)
        && nonEmpty(failures[0]?.message)
        && Array.isArray(evidence.missing)
        && evidence.missing.length === 1
        && evidence.missing[0] === failures[0]?.message;
    pushReason(reasons, readyState || supersededState, 'v1.5 legacy baseline must be either genuine APP_READY 8/8 or APP_NEEDS_WORK 7/8 with only real-ad-execution-readback superseded');
    const packageIndex = evidence.packageIndex;
    const packages = Array.isArray(packageIndex?.packages) ? packageIndex.packages : [];
    const packageKinds = packages.map((item) => item?.kind);
    pushReason(reasons, packageIndex?.present === true
        && packageIndex?.error === null
        && packageIndex?.count === 2
        && packageIndex?.existingCount === 2
        && packageIndex?.missingCount === 0
        && uniqueExactStrings(packageKinds, ['installer', 'portable']), 'v1.5 package index is incomplete');
    pushReason(reasons, packages.length === 2 && packages.every((item) => item?.exists === true && currentFileMatches(item, 'sourcePath')), 'v1.5 release package hashes are stale');
    pushReason(reasons, realpathEquals(packageIndex?.releaseDir, context.canonicalReleaseRoot), 'v1.5 package index is not anchored to the canonical repository release root');
    pushReason(reasons, packages.every((item) => isPathContained(context.canonicalReleaseRoot, item?.sourcePath) && realpathIsContained(context.canonicalReleaseRoot, item?.sourcePath)), 'v1.5 package index contains an artifact outside the canonical release root');
    const portable = packages.find((item) => item?.kind === 'portable');
    pushReason(reasons, portable
        && samePath(portable.sourcePath, evidence.currentPortablePackage?.sourcePath)
        && portable.sha256 === evidence.currentPortablePackage?.sha256, 'v1.5 current portable package does not match its package index');
    const selectedLaunch = evidence.packageLaunchSmoke;
    pushReason(reasons, selectedLaunch?.present === true && selectedLaunch?.passed === true, 'v1.5 package launch selection did not pass');
    pushReason(reasons, selectedLaunch?.selectedBy === 'explicit-arg', 'v1.5 package launch was not explicitly selected');
    pushReason(reasons, samePath(selectedLaunch?.evidencePath, context.packageLaunchPath), 'v1.5 package launch selection does not match the explicit Stage 7 input');
    const selectedAdversarial = evidence.packageAdversarialNodeEnv;
    pushReason(reasons, selectedAdversarial?.present === true && selectedAdversarial?.passed === true, 'v1.5 adversarial NODE_ENV selection did not pass');
    pushReason(reasons, selectedAdversarial?.selectedBy === 'explicit-arg' || selectedAdversarial?.selectedBy === 'evidence-manifest', 'v1.5 adversarial NODE_ENV evidence used an implicit latest fallback');
    pushReason(reasons, samePath(selectedAdversarial?.evidencePath, context.packageAdversarialPath), 'v1.5 adversarial NODE_ENV selection does not match the explicit Stage 7 input');
    if (nonEmpty(context.packageAdversarialPath) && fs.existsSync(context.packageAdversarialPath)) {
        pushReason(reasons, normalizeSha256(selectedAdversarial?.evidenceSha256) === sha256File(context.packageAdversarialPath), 'v1.5 adversarial NODE_ENV evidence SHA-256 is stale');
    }
    const packageIdentity = {
        executableSha256: normalizeSha256(selectedAdversarial?.package?.executableSha256),
        appContentSha256: normalizeSha256(selectedAdversarial?.package?.appContentSha256),
        mainBundleSha256: normalizeSha256(selectedAdversarial?.package?.mainBundleSha256),
    };
    pushReason(reasons, PACKAGE_IDENTITY_FIELDS.every((field) => packageIdentity[field]), 'v1.5 final-readiness package identity is incomplete');
    return validationResult(reasons, {
        packageIdentity,
        ...(supersededState ? { supersededBy: V15_SUPERSEDING_GATE_IDS } : {}),
        ...(reasons.length === 0 ? {
            reason: supersededState
                ? 'Legacy v1.5 baseline passed at 7/8; real-ad-execution-readback is superseded by the two DB-backed Stage 7 canaries.'
                : 'Legacy v1.5 APP_READY baseline passed all eight formal gates.',
        } : {}),
    });
}

function validatePackageLaunch(evidence, context = {}) {
    const reasons = [];
    pushReason(reasons, isRecord(evidence), 'package launch evidence must be an object');
    if (!isRecord(evidence))
        return validationResult(reasons);
    const strictValidation = validatePackageLaunchSmokeEvidence(evidence);
    pushReason(reasons, strictValidation.passed === true, `package launch strict contract failed: ${(strictValidation.violations || [])
        .map((violation) => `${violation.code}@${violation.path}`)
        .join(', ')}`);
    pushReason(reasons, evidence.kind === 'package-launch-smoke', 'unexpected package launch evidence kind');
    pushReason(reasons, validTimestamp(evidence.generatedAt), 'package launch generatedAt is invalid');
    pushReason(reasons, evidence.evidenceMode === 'package-launch-smoke', 'package launch evidence mode is invalid');
    pushReason(reasons, evidence.passed === true, 'package launch evidence did not pass');
    pushReason(reasons, evidence.userDataOverrideBundleContract?.passed === true, 'packaged userData override contract did not pass');
    const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
    pushReason(reasons, uniqueExactStrings(checks.map((check) => check?.kind), ['win-unpacked', 'portable']), 'package launch must contain exactly unpacked and portable checks');
    pushReason(reasons, checks.every((check) => check?.ok === true && check?.userDataEvidence?.passed === true), 'package launch or isolated userData check failed');
    const unpacked = evidence.artifacts?.unpacked;
    const portable = evidence.artifacts?.portable;
    pushReason(reasons, currentFileMatches(unpacked), 'win-unpacked package launch artifact is missing or stale');
    pushReason(reasons, realpathEquals(unpacked?.path, context.canonicalExecutablePath), 'package launch did not execute the canonical win-unpacked EXE');
    pushReason(reasons, isPathContained(context.canonicalReleaseRoot, portable?.path) && realpathIsContained(context.canonicalReleaseRoot, portable?.path), 'package launch portable artifact is outside the canonical release root');
    pushReason(reasons, currentFileMatches(portable), 'portable package launch artifact is missing or stale');
    const packageIdentity = {
        executableSha256: normalizeSha256(unpacked?.sha256),
        portableSha256: normalizeSha256(portable?.sha256),
    };
    return validationResult(reasons, { packageIdentity });
}

function validatePackageUi(evidence, context = {}) {
    const reasons = [];
    pushReason(reasons, isRecord(evidence), 'package UI evidence must be an object');
    if (!isRecord(evidence))
        return validationResult(reasons);
    pushReason(reasons, evidence.kind === 'package-ui-evidence', 'unexpected package UI evidence kind');
    pushReason(reasons, evidence.schemaVersion === 9, 'package UI evidence must use current production two-phase interactive-login schema v9; schemas v5/v6/v7/v8 are historical only');
    pushReason(reasons, validTimestamp(evidence.generatedAt), 'package UI generatedAt is invalid');
    pushReason(reasons, evidence.passed === true, 'package UI evidence did not pass');
    let completeness;
    try {
        const { evaluatePackageUiEvidenceCompleteness } = context.packageUiContract ?? require('./package-ui-evidence');
        completeness = evaluatePackageUiEvidenceCompleteness(evidence);
    }
    catch (error) {
        reasons.push(`package UI contract could not be evaluated: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (completeness) {
        pushReason(reasons, completeness.passed === true, `package UI completeness failed: ${completeness.violations.map((item) => item.code || item.message).join(', ')}`);
    }
    const runs = Array.isArray(evidence.runs) ? evidence.runs : [];
    pushReason(reasons, uniqueExactStrings(runs.map((run) => run?.scalePercent), [100, 125]), 'package UI must contain exactly one 100% and one 125% run');
    let expectedWorkspaces = [];
    let expectedSubviews = [];
    let expectedOverlays = [];
    let packageUiContract = null;
    try {
        packageUiContract = context.packageUiContract ?? require('./package-ui-evidence');
        expectedWorkspaces = packageUiContract.EXPECTED_PACKAGE_UI_ENTRIES.map((item) => `${item.workspace}/${item.subview}`);
        expectedSubviews = packageUiContract.EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS.map((item) => `${item.workspace}/${item.subview}`);
        expectedOverlays = [...packageUiContract.EXPECTED_OVERLAY_CHECK_IDS];
    }
    catch (error) {
        reasons.push(`package UI workspace contract could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
    }
    pushReason(reasons, expectedWorkspaces.length === 22, 'repository package UI contract is not the complete V1.6 entry matrix');
    pushReason(reasons, stableEqual(expectedSubviews, ['settings/scheduler']), 'repository package UI scheduler subview contract is invalid');
    for (const run of runs) {
        pushReason(reasons, run?.passed === true, `${run?.scalePercent || 'unknown'}% package UI run did not pass`);
        pushReason(reasons, uniqueExactStrings((run?.workspaceChecks || []).map((item) => `${item?.workspace}/${item?.subview}`), expectedWorkspaces), `${run?.scalePercent || 'unknown'}% package UI workspace checks are not the exact 22-entry matrix`);
        pushReason(reasons, uniqueExactStrings((run?.screenshots || []).map((item) => `${item?.workspace}/${item?.subview}`), expectedWorkspaces), `${run?.scalePercent || 'unknown'}% package UI screenshots are not the exact 22-entry matrix`);
        pushReason(reasons, uniqueExactStrings((run?.overlayChecks || []).map((item) => item?.id), expectedOverlays), `${run?.scalePercent || 'unknown'}% package UI overlay evidence is incomplete`);
        pushReason(reasons, (run?.screenshots || []).every((item) => currentFileMatches(item)), `${run?.scalePercent || 'unknown'}% package UI workspace screenshot files are missing or stale`);
        pushReason(reasons, (run?.overlayChecks || []).every((item) => currentFileMatches(item?.screenshot)), `${run?.scalePercent || 'unknown'}% package UI overlay screenshot files are missing or stale`);
        pushReason(reasons, uniqueExactStrings((run?.subviewChecks || []).map((item) => `${item?.workspace}/${item?.subview}`), expectedSubviews), `${run?.scalePercent || 'unknown'}% package UI read-only subview checks are incomplete`);
        pushReason(reasons, (run?.subviewChecks || []).every((item) => (item?.passed === true
            && packageUiContract?.validateSchedulerSubviewEvidence(item?.identityCapabilityEvidence, packageUiContract.EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS.find((expected) => (expected.workspace === item?.workspace && expected.subview === item?.subview))).passed === true
            && currentFileMatches(item?.screenshot))), `${run?.scalePercent || 'unknown'}% package UI read-only subview screenshot files are missing or stale`);
        pushReason(reasons, packageUiContract?.validatePackageUiReadOnlyRuntimeEvidence(run?.schedulerReadOnlyRuntime, { requireSchedulerReads: true }).passed === true
            && currentFileMatches(run?.schedulerReadOnlyRuntime?.artifact), `${run?.scalePercent || 'unknown'}% package UI Main scheduler read-only runtime evidence is missing or stale`);
    }
    pushReason(reasons, (evidence.wideProfile?.screenshots || []).every((item) => currentFileMatches(item))
        && (evidence.wideProfile?.workspaceChecks || []).every((item) => (!item?.inspectorEvidence?.screenshot || currentFileMatches(item.inspectorEvidence.screenshot))), 'package UI wide-profile screenshot files are missing or stale');
    pushReason(reasons, packageUiContract?.validatePackageUiReadOnlyRuntimeEvidence(evidence.wideProfile?.schedulerReadOnlyRuntime, { requireSchedulerReads: false }).passed === true
        && currentFileMatches(evidence.wideProfile?.schedulerReadOnlyRuntime?.artifact), 'package UI wide-profile Main scheduler read-only runtime evidence is missing or stale');
    const before = evidence.artifactsBefore;
    const after = evidence.artifactsAfter;
    const packageIdentity = {
        executableSha256: normalizeSha256(before?.exe?.sha256),
        appContentSha256: normalizeSha256(before?.appContent?.sha256),
    };
    pushReason(reasons, packageIdentity.executableSha256 && packageIdentity.appContentSha256, 'package UI package identity is incomplete');
    pushReason(reasons, packageIdentity.executableSha256 === normalizeSha256(after?.exe?.sha256)
        && packageIdentity.appContentSha256 === normalizeSha256(after?.appContent?.sha256), 'package UI package identity changed during capture');
    pushReason(reasons, packageIdentity.executableSha256 === normalizeSha256(evidence.requested?.expectedExeSha256)
        && packageIdentity.appContentSha256 === normalizeSha256(evidence.requested?.expectedAppContentSha256), 'package UI package identity does not match its explicit expected hashes');
    return validationResult(reasons, { packageIdentity });
}

function validatePackageSecurity(evidence) {
    const reasons = [];
    let validation;
    try {
        const { validatePackageSecurityEvidence } = require('./smoke-package-security-boundaries');
        validation = validatePackageSecurityEvidence(evidence);
    }
    catch (error) {
        reasons.push(`package security contract could not be evaluated: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (validation && !validation.passed)
        reasons.push(...validation.violations);
    const packageIdentity = {
        executableSha256: normalizeSha256(evidence?.package?.executableSha256),
        appContentSha256: normalizeSha256(evidence?.package?.appContentSha256),
        mainBundleSha256: normalizeSha256(evidence?.package?.mainBundleSha256),
    };
    return validationResult(reasons, { packageIdentity });
}

function validatePackageAdversarialNodeEnv(evidence) {
    const reasons = [];
    let validation;
    try {
        const { validateAdversarialNodeEnvEvidence } = require('./smoke-package-adversarial-node-env');
        validation = validateAdversarialNodeEnvEvidence(evidence);
    }
    catch (error) {
        reasons.push(`adversarial NODE_ENV contract could not be evaluated: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (validation && !validation.passed)
        reasons.push(...validation.violations);
    const packageIdentity = {
        executableSha256: normalizeSha256(evidence?.package?.executableSha256),
        appContentSha256: normalizeSha256(evidence?.package?.appContentSha256),
        mainBundleSha256: normalizeSha256(evidence?.package?.mainBundleSha256),
    };
    return validationResult(reasons, { packageIdentity });
}

module.exports = { validateV15FinalReadiness, validatePackageLaunch, validatePackageUi, validatePackageSecurity, validatePackageAdversarialNodeEnv };
