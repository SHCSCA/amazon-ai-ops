// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { PACKAGE_LAUNCH_SMOKE_MODE, buildEvidenceUserDataEnv, inspectPackagedUserDataOverrideContract, readEvidenceUserDataRuntimeMarker, validateEvidenceUserDataIdentity, validateEvidenceUserDataPath, } = require('./evidence-user-data');
const { currentArtifactMatches, currentJsonMarkerMatches, readStableRegularFile, sha256 } = require('./package-launch-artifacts.js');
const { PACKAGE_LAUNCH_WINDOW_READY_MARKER, PACKAGE_LAUNCH_WINDOW_READY_MAX_BYTES, PORTABLE_APP_PROCESS_NAME, normalizedExecutablePath } = require('./package-launch-contracts.js');

function validatePackageLaunchSmokeEvidence(evidence) {
    const violations = [];
    const reject = (code, pathName) => violations.push({ code, path: pathName });
    const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
    const validTimestamp = (value) => Number.isFinite(Date.parse(value || ''));
    const validArtifact = (artifact) => isRecord(artifact)
        && path.win32.isAbsolute(String(artifact.path || ''))
        && Number.isInteger(artifact.sizeBytes)
        && artifact.sizeBytes > 0
        && /^[A-F0-9]{64}$/.test(String(artifact.sha256 || ''))
        && validTimestamp(artifact.mtime)
        && currentArtifactMatches(artifact);
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
        reject('PACKAGE_LAUNCH_EVIDENCE_INVALID', '$');
        return { passed: false, violations };
    }
    if (evidence.kind !== 'package-launch-smoke') {
        reject('PACKAGE_LAUNCH_KIND_INVALID', 'kind');
    }
    if (evidence.evidenceMode !== PACKAGE_LAUNCH_SMOKE_MODE) {
        reject('PACKAGE_LAUNCH_MODE_INVALID', 'evidenceMode');
    }
    if (!validTimestamp(evidence.generatedAt)) {
        reject('PACKAGE_LAUNCH_GENERATED_AT_INVALID', 'generatedAt');
    }
    if (!path.win32.isAbsolute(String(evidence.releaseDir || ''))) {
        reject('PACKAGE_LAUNCH_RELEASE_DIR_INVALID', 'releaseDir');
    }
    if (evidence.passed !== true) {
        reject('PACKAGE_LAUNCH_NOT_PASSED', 'passed');
    }
    const isolatedUserData = evidence.isolatedUserData;
    if (!isRecord(isolatedUserData)
        || !path.win32.isAbsolute(String(isolatedUserData.unpacked || ''))
        || !path.win32.isAbsolute(String(isolatedUserData.portable || ''))
        || normalizedExecutablePath(isolatedUserData.unpacked)
            === normalizedExecutablePath(isolatedUserData.portable)) {
        reject('PACKAGE_LAUNCH_ISOLATED_USER_DATA_INVALID', 'isolatedUserData');
    }
    if (!isRecord(evidence.userDataOverrideBundleContract)
        || evidence.userDataOverrideBundleContract.passed !== true
        || !Array.isArray(evidence.userDataOverrideBundleContract.violations)
        || evidence.userDataOverrideBundleContract.violations.length !== 0) {
        reject('PACKAGE_LAUNCH_USER_DATA_OVERRIDE_CONTRACT_INVALID', 'userDataOverrideBundleContract');
    }
    for (const kind of ['unpacked', 'portable']) {
        if (!validArtifact(evidence.artifacts?.[kind])) {
            reject('PACKAGE_LAUNCH_ARTIFACT_INVALID', `artifacts.${kind}`);
        }
    }
    const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
    const checkKinds = checks.map((check) => check?.kind).sort();
    if (checks.length !== 2
        || new Set(checkKinds).size !== 2
        || checkKinds[0] !== 'portable'
        || checkKinds[1] !== 'win-unpacked') {
        reject('PACKAGE_LAUNCH_CHECK_SET_INVALID', 'checks');
    }
    for (const [index, check] of checks.entries()) {
        const checkPath = `checks.${check?.kind || index}`;
        if (!isRecord(check) || check.ok !== true || check.launchError !== null) {
            reject('PACKAGE_LAUNCH_CHECK_RESULT_INVALID', checkPath);
        }
        const runtime = check?.runtimeProcess;
        const createdAt = Date.parse(runtime?.creationDate || '');
        const notBeforeMs = Number(runtime?.notBeforeMs);
        if (!isRecord(runtime)
            || !Number.isInteger(runtime.processId)
            || runtime.processId < 1
            || String(runtime.name || '').toLowerCase() !== PORTABLE_APP_PROCESS_NAME.toLowerCase()
            || !path.win32.isAbsolute(String(runtime.executablePath || ''))
            || !Number.isFinite(createdAt)
            || !Number.isFinite(notBeforeMs)
            || createdAt < notBeforeMs - 2000
            || createdAt > Date.now() + 10000
            || !Number.isInteger(runtime.parentProcessId)
            || runtime.parentProcessId < 0
            || runtime.mainWindowHandle <= 0
            || !String(runtime.mainWindowTitle || '').trim()
            || runtime.windowVisible !== true
            || runtime.proof !== 'isolated-runtime-marker') {
            reject('PACKAGE_LAUNCH_RUNTIME_PROCESS_INVALID', `${checkPath}.runtimeProcess`);
        }
        const expectedUserDataDir = check?.kind === 'win-unpacked'
            ? evidence.isolatedUserData?.unpacked
            : evidence.isolatedUserData?.portable;
        if (check?.kind === 'win-unpacked'
            && (check.marker !== '[App] window-created'
                || check.pid !== runtime?.processId
                || normalizedExecutablePath(runtime?.executablePath)
                    !== normalizedExecutablePath(evidence.artifacts?.unpacked?.path))) {
            reject('PACKAGE_LAUNCH_UNPACKED_IDENTITY_INVALID', checkPath);
        }
        if (check?.kind === 'portable'
            && (!Number.isInteger(check.launcherPid)
                || check.launcherPid < 1
                || !Number.isInteger(check.observedProcessCount)
                || check.observedProcessCount < 1
                || runtime?.parentProcessId !== check.launcherPid
                || !readStableRegularFile(runtime?.executablePath)
                || sha256(runtime.executablePath)
                    !== String(evidence.artifacts?.unpacked?.sha256 || '').toUpperCase())) {
            reject('PACKAGE_LAUNCH_PORTABLE_LINEAGE_INVALID', checkPath);
        }
        const userData = check?.userDataEvidence;
        const runtimeMarkerAt = Date.parse(userData?.marker?.generatedAt || '');
        if (!isRecord(userData)
            || userData.passed !== true
            || !Array.isArray(userData.violations)
            || userData.violations.length !== 0
            || userData.markerError !== null
            || normalizedExecutablePath(userData.actualUserDataDir)
                !== normalizedExecutablePath(expectedUserDataDir)
            || normalizedExecutablePath(userData.expectedUserDataDir)
                !== normalizedExecutablePath(expectedUserDataDir)
            || !isRecord(userData.marker)
            || userData.marker.mode !== PACKAGE_LAUNCH_SMOKE_MODE
            || userData.marker.overridden !== true
            || normalizedExecutablePath(userData.marker.userDataDir)
                !== normalizedExecutablePath(expectedUserDataDir)
            || userData.marker.pid !== runtime?.processId
            || !Number.isFinite(runtimeMarkerAt)
            || runtimeMarkerAt < notBeforeMs - 2000
            || runtimeMarkerAt > Date.now() + 10000
            || !path.win32.isAbsolute(String(userData.markerPath || ''))
            || normalizedExecutablePath(userData.markerPath)
                !== normalizedExecutablePath(path.win32.join(String(expectedUserDataDir || ''), 'evidence-user-data-runtime.json'))
            || !currentJsonMarkerMatches(userData.markerPath, userData.marker)) {
            reject('PACKAGE_LAUNCH_USER_DATA_EVIDENCE_INVALID', `${checkPath}.userDataEvidence`);
        }
        const windowReady = check?.windowReadyEvidence;
        const markerValidation = validatePackageLaunchWindowReadyMarker(windowReady?.marker, {
            expectedPid: runtime?.processId,
            expectedRendererPath: packagedRendererPathForExecutable(runtime?.executablePath),
            expectedUserDataDir,
            notBeforeMs,
            runtimeMarkerGeneratedAt: check?.userDataEvidence?.marker?.generatedAt,
        });
        if (!isRecord(windowReady)
            || windowReady.passed !== true
            || windowReady.state !== 'valid'
            || !Array.isArray(windowReady.violations)
            || windowReady.violations.length !== 0
            || markerValidation.passed !== true
            || !isRecord(windowReady.artifact)
            || !path.win32.isAbsolute(String(windowReady.artifact.path || ''))
            || normalizedExecutablePath(windowReady.artifact.path)
                !== normalizedExecutablePath(windowReady.markerPath)
            || normalizedExecutablePath(windowReady.markerPath)
                !== normalizedExecutablePath(path.win32.join(String(expectedUserDataDir || ''), PACKAGE_LAUNCH_WINDOW_READY_MARKER))
            || Number(windowReady.artifact.sizeBytes) <= 0
            || !/^[A-F0-9]{64}$/.test(String(windowReady.artifact.sha256 || ''))
            || !Number.isFinite(Date.parse(windowReady.artifact.mtime || ''))
            || !currentJsonMarkerMatches(windowReady.markerPath, windowReady.marker, windowReady.artifact)
            || normalizedExecutablePath(windowReady.rendererPath)
                !== normalizedExecutablePath(markerValidation.rendererPath)
            || !readStableRegularFile(windowReady.rendererPath)) {
            reject('PACKAGE_LAUNCH_WINDOW_READY_INVALID', `${checkPath}.windowReadyEvidence`);
        }
        const cleanup = check?.processCleanup;
        if (!isRecord(cleanup)
            || cleanup.passed !== true
            || !Number.isInteger(cleanup.attempts)
            || cleanup.attempts < 1
            || cleanup.remainingCount !== 0
            || !Array.isArray(cleanup.remaining)
            || cleanup.remaining.length !== 0
            || !Array.isArray(cleanup.identityViolations)
            || cleanup.identityViolations.length !== 0
            || !Array.isArray(cleanup.killAttempts)
            || !Array.isArray(cleanup.reusedPids)
            || cleanup.reusedPids.length !== 0
            || cleanup.snapshotError !== null
            || !Array.isArray(cleanup.treeErrors)
            || cleanup.treeErrors.length !== 0
            || !Array.isArray(cleanup.unresolved)
            || cleanup.unresolved.length !== 0) {
            reject('PACKAGE_LAUNCH_PROCESS_CLEANUP_INVALID', `${checkPath}.processCleanup`);
        }
        if (!Array.isArray(check?.observationErrors) || check.observationErrors.length !== 0) {
            reject('PACKAGE_LAUNCH_OBSERVATION_ERRORS_PRESENT', `${checkPath}.observationErrors`);
        }
        if (!path.win32.isAbsolute(String(check?.stdoutPath || ''))
            || !path.win32.isAbsolute(String(check?.stderrPath || ''))
            || !readStableRegularFile(check.stdoutPath)
            || !readStableRegularFile(check.stderrPath)) {
            reject('PACKAGE_LAUNCH_LOG_PATH_INVALID', checkPath);
        }
    }
    return {
        passed: violations.length === 0,
        violations,
    };
}

function packagedRendererPathForExecutable(executablePath) {
    const normalized = normalizedExecutablePath(executablePath);
    if (!normalized)
        return '';
    return path.win32.normalize(path.win32.join(path.win32.dirname(executablePath), 'resources', 'app', 'dist', 'renderer', 'index.html'));
}

function validatePackageLaunchWindowReadyMarker(marker, { expectedPid, expectedRendererPath, expectedUserDataDir, notBeforeMs, runtimeMarkerGeneratedAt, }) {
    const violations = [];
    const generatedAt = Date.parse(marker?.generatedAt || '');
    const runtimeMarkerAt = Date.parse(runtimeMarkerGeneratedAt || '');
    if (marker?.kind !== 'package-launch-window-ready') {
        violations.push({ code: 'WINDOW_READY_KIND_INVALID', actual: marker?.kind ?? null });
    }
    if (marker?.schemaVersion !== 1) {
        violations.push({ code: 'WINDOW_READY_SCHEMA_INVALID', actual: marker?.schemaVersion ?? null });
    }
    if (!Number.isInteger(marker?.pid) || marker.pid < 1 || marker.pid !== Number(expectedPid)) {
        violations.push({
            code: 'WINDOW_READY_PID_MISMATCH',
            actual: marker?.pid ?? null,
            expected: Number(expectedPid) || null,
        });
    }
    if (!Number.isInteger(marker?.browserWindowId) || marker.browserWindowId < 1) {
        violations.push({
            code: 'WINDOW_READY_BROWSER_WINDOW_ID_INVALID',
            actual: marker?.browserWindowId ?? null,
        });
    }
    if (marker?.evidenceMode !== PACKAGE_LAUNCH_SMOKE_MODE) {
        violations.push({
            code: 'WINDOW_READY_EVIDENCE_MODE_MISMATCH',
            actual: marker?.evidenceMode ?? null,
            expected: PACKAGE_LAUNCH_SMOKE_MODE,
        });
    }
    if (normalizedExecutablePath(marker?.userDataDir)
        !== normalizedExecutablePath(expectedUserDataDir)) {
        violations.push({
            code: 'WINDOW_READY_USER_DATA_MISMATCH',
            actual: marker?.userDataDir ?? null,
            expected: expectedUserDataDir,
        });
    }
    if (!Number.isFinite(generatedAt)
        || generatedAt < notBeforeMs - 2000
        || generatedAt > Date.now() + 10000) {
        violations.push({
            code: 'WINDOW_READY_GENERATED_AT_OUTSIDE_RUN',
            actual: marker?.generatedAt ?? null,
        });
    }
    if (!Number.isFinite(runtimeMarkerAt) || !Number.isFinite(generatedAt) || generatedAt < runtimeMarkerAt) {
        violations.push({
            code: 'WINDOW_READY_PRECEDES_RUNTIME_MARKER',
            actual: marker?.generatedAt ?? null,
            runtimeMarkerGeneratedAt: runtimeMarkerGeneratedAt ?? null,
        });
    }
    let rendererPath = '';
    try {
        const rendererUrl = new URL(String(marker?.rendererUrl || ''));
        if (rendererUrl.protocol !== 'file:'
            || rendererUrl.hostname
            || rendererUrl.username
            || rendererUrl.password) {
            violations.push({
                code: 'WINDOW_READY_RENDERER_URL_NOT_PACKAGED_FILE',
                actual: marker?.rendererUrl ?? null,
            });
        }
        else {
            rendererPath = path.win32.normalize(fileURLToPath(rendererUrl));
        }
    }
    catch (error) {
        violations.push({
            code: 'WINDOW_READY_RENDERER_URL_INVALID',
            actual: marker?.rendererUrl ?? null,
            error: String(error?.message || error),
        });
    }
    if (!rendererPath
        || normalizedExecutablePath(rendererPath) !== normalizedExecutablePath(expectedRendererPath)) {
        violations.push({
            code: 'WINDOW_READY_RENDERER_PATH_MISMATCH',
            actual: rendererPath || marker?.rendererUrl || null,
            expected: expectedRendererPath || null,
        });
    }
    return {
        marker: marker || null,
        passed: violations.length === 0,
        rendererPath: rendererPath || null,
        violations,
    };
}

function readPackageLaunchWindowReadyEvidence(userDataDir, options) {
    const validatedUserDataDir = validateEvidenceUserDataPath(userDataDir);
    const markerPath = path.join(validatedUserDataDir, PACKAGE_LAUNCH_WINDOW_READY_MARKER);
    if (!fs.existsSync(markerPath)) {
        return {
            artifact: null,
            marker: null,
            markerPath,
            passed: false,
            state: 'missing',
            violations: [{ code: 'WINDOW_READY_MARKER_MISSING' }],
        };
    }
    const violations = [];
    let marker = null;
    let bytes = null;
    let before = null;
    let after = null;
    try {
        const linkStat = fs.lstatSync(markerPath);
        if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
            violations.push({ code: 'WINDOW_READY_MARKER_NOT_REGULAR_FILE' });
        }
        before = fs.statSync(markerPath);
        if (before.size < 2 || before.size > PACKAGE_LAUNCH_WINDOW_READY_MAX_BYTES) {
            violations.push({
                code: 'WINDOW_READY_MARKER_SIZE_INVALID',
                sizeBytes: before.size,
            });
        }
        bytes = fs.readFileSync(markerPath);
        after = fs.statSync(markerPath);
        if (before.size !== after.size
            || before.mtimeMs !== after.mtimeMs
            || bytes.length !== after.size) {
            violations.push({ code: 'WINDOW_READY_MARKER_CHANGED_DURING_READ' });
        }
        if (after.mtimeMs < options.notBeforeMs - 2000 || after.mtimeMs > Date.now() + 10000) {
            violations.push({
                code: 'WINDOW_READY_MARKER_MTIME_OUTSIDE_RUN',
                mtime: after.mtime.toISOString(),
            });
        }
        marker = JSON.parse(bytes.toString('utf8'));
    }
    catch (error) {
        violations.push({
            code: 'WINDOW_READY_MARKER_READ_FAILED',
            error: String(error?.message || error),
        });
    }
    const validation = validatePackageLaunchWindowReadyMarker(marker, options);
    violations.push(...validation.violations);
    if (options.expectedRendererPath && !fs.existsSync(options.expectedRendererPath)) {
        violations.push({
            code: 'WINDOW_READY_EXPECTED_RENDERER_FILE_MISSING',
            expected: options.expectedRendererPath,
        });
    }
    return {
        artifact: bytes && after
            ? {
                mtime: after.mtime.toISOString(),
                path: markerPath,
                sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
                sizeBytes: after.size,
            }
            : null,
        marker,
        markerPath,
        passed: violations.length === 0,
        rendererPath: validation.rendererPath,
        state: violations.length === 0 ? 'valid' : 'invalid',
        violations,
    };
}

module.exports = { validatePackageLaunchSmokeEvidence, packagedRendererPathForExecutable, validatePackageLaunchWindowReadyMarker, readPackageLaunchWindowReadyEvidence };
