// 按职责复用原有严格校验，公共入口继续保持兼容。
const path = require('node:path');
const { buildAppContentManifest } = require('./package-ui-evidence');
const { AUTHORITY_SNAPSHOT_BACKUP_METHOD, AUTHORITY_SNAPSHOT_KIND, AUTHORITY_SNAPSHOT_SCHEMA_VERSION, GATE_SPECS, OUTPUT_KIND: READINESS_KIND, OUTPUT_SCHEMA_VERSION: READINESS_SCHEMA_VERSION, } = require('./verify-mission-control-production-readiness');
const { GATE_IDS, ROOT, artifactRecord, canonicalPath, isRecord, isSha256, normalizeSha256, normalizedPackageIdentity, normalizedPath, readJson, requireRegularUnlinkedFile, samePath, sha256File, stableEqual, validTimestamp } = require('./s7-delivery-export-contracts.js');

function inspectCanonicalPackage({ releaseRoot = path.join(ROOT, 'apps', 'desktop', 'release'), } = {}) {
    const executablePath = path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe');
    const appContentPath = path.join(releaseRoot, 'win-unpacked', 'resources', 'app');
    const mainBundlePath = path.join(appContentPath, 'dist', 'main', 'index.js');
    requireRegularUnlinkedFile(executablePath, 'Canonical packaged executable');
    requireRegularUnlinkedFile(mainBundlePath, 'Canonical packaged Main bundle');
    const appContent = buildAppContentManifest(appContentPath);
    if (!isSha256(appContent?.sha256) || !Number.isInteger(appContent?.fileCount) || appContent.fileCount <= 0) {
        throw new Error('Canonical packaged app-content manifest is incomplete.');
    }
    return {
        paths: {
            executablePath: canonicalPath(executablePath),
            appContentPath: canonicalPath(appContentPath),
            mainBundlePath: canonicalPath(mainBundlePath),
        },
        identity: {
            executableSha256: sha256File(executablePath),
            appContentSha256: String(appContent.sha256).toUpperCase(),
            mainBundleSha256: sha256File(mainBundlePath),
        },
        appContentFileCount: appContent.fileCount,
        artifacts: {
            executable: artifactRecord(executablePath),
            mainBundle: artifactRecord(mainBundlePath),
        },
    };
}

function gateStateIsConsistent(gate) {
    if (!isRecord(gate) || !GATE_IDS.includes(gate.id))
        return false;
    if (gate.ok === true)
        return gate.status === 'passed';
    return gate.ok === false && ['missing', 'needs_work'].includes(gate.status);
}

function validateReadinessReport(report, { expectedMode = null } = {}) {
    const errors = [];
    const push = (condition, message) => {
        if (!condition)
            errors.push(message);
    };
    push(isRecord(report), 'readiness must be an object');
    push(report?.kind === READINESS_KIND, `readiness kind must be ${READINESS_KIND}`);
    push(report?.schemaVersion === READINESS_SCHEMA_VERSION, `readiness schemaVersion must be ${READINESS_SCHEMA_VERSION}`);
    push(validTimestamp(report?.generatedAt), 'readiness generatedAt is invalid');
    push(report?.evidenceSelection?.explicitOnly === true, 'readiness must use explicit-only evidence selection');
    push(report?.evidenceSelection?.latestFallbackUsed === false, 'readiness must not use latest-file fallback');
    const gates = Array.isArray(report?.gates) ? report.gates : [];
    const gateIds = gates.map((gate) => gate?.id);
    push(gates.length === GATE_IDS.length
        && new Set(gateIds).size === GATE_IDS.length
        && GATE_IDS.every((id) => gateIds.includes(id)), 'readiness must contain exactly the eight canonical Mission gates');
    push(gates.every(gateStateIsConsistent), 'readiness gate status/ok pairs are inconsistent');
    const passed = gates.filter((gate) => gate?.ok === true && gate?.status === 'passed').length;
    const failed = gates.length - passed;
    push(report?.summary?.total === GATE_IDS.length
        && report?.summary?.passed === passed
        && report?.summary?.failed === failed, 'readiness summary does not match its eight gates');
    const inputErrors = Array.isArray(report?.inputErrors) ? report.inputErrors : [];
    const inputContractPassed = report?.inputContractPassed === true && inputErrors.length === 0;
    push(report?.inputContractPassed === inputContractPassed, 'readiness inputContractPassed does not match inputErrors');
    const ready = inputContractPassed && passed === GATE_IDS.length;
    push(report?.status === (ready ? 'APP_READY' : 'APP_NEEDS_WORK')
        && report?.appReady === ready
        && report?.allGatesPass === ready, 'readiness READY/NEEDS_WORK claims do not match the canonical eight-gate result');
    if (expectedMode === 'ready')
        push(ready, 'READY safety requires a genuine 8/8 APP_READY report');
    if (expectedMode === 'non-ready')
        push(!ready && passed <= 7, 'NON_READY safety requires a genuine 0-7/8 APP_NEEDS_WORK report');
    const selectedPaths = report?.evidenceSelection?.selectedPaths;
    push(isRecord(selectedPaths), 'readiness selectedPaths is missing');
    const selectedKeys = isRecord(selectedPaths) ? Object.keys(selectedPaths) : [];
    push(selectedKeys.length === GATE_IDS.length
        && GATE_IDS.every((id) => Object.prototype.hasOwnProperty.call(selectedPaths, id)), 'readiness selectedPaths must contain exactly the eight canonical gate ids');
    for (const gate of gates) {
        const selectedPath = selectedPaths?.[gate.id] ?? null;
        push((selectedPath === null && gate.evidencePath === null)
            || (typeof selectedPath === 'string' && samePath(selectedPath, gate.evidencePath)), `${gate.id} gate evidencePath does not match explicit selection`);
        if (gate.ok) {
            push(typeof selectedPath === 'string' && path.isAbsolute(selectedPath), `${gate.id} passed without an explicit absolute evidence path`);
        }
    }
    const selectedExistingPaths = gates
        .map((gate) => selectedPaths?.[gate.id])
        .filter((value) => typeof value === 'string' && value.length > 0)
        .map(normalizedPath);
    push(new Set(selectedExistingPaths).size === selectedExistingPaths.length, 'readiness reuses one evidence file for multiple Mission gates');
    const packageIdentity = normalizedPackageIdentity(report?.packageIdentity);
    push(Boolean(packageIdentity), 'readiness packageIdentity is incomplete');
    const snapshotPath = report?.evidenceSelection?.authoritySnapshotManifest;
    push(typeof snapshotPath === 'string'
        && path.isAbsolute(snapshotPath)
        && samePath(snapshotPath, report?.authoritySnapshot?.evidencePath), 'readiness authority snapshot selection is missing or inconsistent');
    push(typeof report?.evidenceSelection?.authorityDb === 'string'
        && path.isAbsolute(report.evidenceSelection.authorityDb), 'readiness authority database identity is missing');
    if (ready) {
        push(report?.authoritySnapshot?.ok === true, 'READY readiness authority snapshot did not pass');
        push(report?.authoritySnapshot?.currentness?.passed === true, 'READY readiness lacks WAL-aware currentness');
        push(Array.isArray(report?.authoritySnapshot?.currentness?.captures)
            && report.authoritySnapshot.currentness.captures.length >= 3
            && report.authoritySnapshot.currentness.captures.every((capture) => (capture?.matchesSelectedSnapshot === true)), 'READY readiness lacks the complete WAL-aware currentness capture chain');
    }
    const failures = Array.isArray(report?.failures) ? report.failures : [];
    const failureGateIds = failures.map((failure) => failure?.gateId);
    for (const gate of gates.filter((candidate) => !candidate.ok)) {
        push(failureGateIds.includes(gate.id), `${gate.id} failure is absent from readiness.failures`);
    }
    for (const gate of gates.filter((candidate) => candidate.ok)) {
        push(!failureGateIds.includes(gate.id), `${gate.id} passed but is listed as a readiness failure`);
    }
    return {
        errors,
        ok: errors.length === 0,
        passed,
        failed,
        ready,
        packageIdentity,
    };
}

function validateAuthoritySnapshot(snapshotPath, readiness, packageIdentity) {
    requireRegularUnlinkedFile(snapshotPath, 'Authority snapshot manifest');
    const snapshot = readJson(snapshotPath);
    const errors = [];
    const push = (condition, message) => {
        if (!condition)
            errors.push(message);
    };
    push(snapshot?.kind === AUTHORITY_SNAPSHOT_KIND, 'authority snapshot kind is invalid');
    push(snapshot?.schemaVersion === AUTHORITY_SNAPSHOT_SCHEMA_VERSION, 'authority snapshot must use Mission snapshot schema v2');
    push(validTimestamp(snapshot?.exportedAt), 'authority snapshot exportedAt is invalid');
    push(snapshot?.backup?.method === AUTHORITY_SNAPSHOT_BACKUP_METHOD
        && snapshot?.backup?.completed === true
        && snapshot?.backup?.remainingPages === 0, 'authority snapshot was not completed by sqlite-online-backup');
    push(snapshot?.source?.openedReadOnly === true
        && snapshot?.source?.queryOnly === true
        && samePath(snapshot?.source?.absolutePath, readiness?.evidenceSelection?.authorityDb), 'authority snapshot source does not bind the read-only selected authority database');
    push(snapshot?.snapshot?.openedReadOnly === true
        && snapshot?.snapshot?.queryOnly === true
        && typeof snapshot?.snapshot?.absolutePath === 'string'
        && path.isAbsolute(snapshot.snapshot.absolutePath), 'authority snapshot artifact identity is incomplete');
    const snapshotArtifact = snapshot?.snapshot?.absolutePath
        ? artifactRecord(snapshot.snapshot.absolutePath)
        : null;
    push(Boolean(snapshotArtifact)
        && Number(snapshot?.snapshot?.sizeBytes) === snapshotArtifact.sizeBytes
        && normalizeSha256(snapshot?.snapshot?.sha256) === snapshotArtifact.sha256, 'authority snapshot database bytes do not match snapshot v2 provenance');
    push(stableEqual(normalizedPackageIdentity(snapshot?.packageIdentity), packageIdentity), 'authority snapshot package identity does not match Mission readiness');
    return {
        errors,
        ok: errors.length === 0,
        snapshot,
        snapshotArtifact,
    };
}

module.exports = { inspectCanonicalPackage, gateStateIsConsistent, validateReadinessReport, validateAuthoritySnapshot };
