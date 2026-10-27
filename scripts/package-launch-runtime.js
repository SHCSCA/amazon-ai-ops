// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { PACKAGE_LAUNCH_SMOKE_MODE, buildEvidenceUserDataEnv, inspectPackagedUserDataOverrideContract, readEvidenceUserDataRuntimeMarker, validateEvidenceUserDataIdentity, validateEvidenceUserDataPath, } = require('./evidence-user-data');
const { fileInfo, writeLog } = require('./package-launch-artifacts.js');
const { PORTABLE_APP_PROCESS_NAME, PORTABLE_START_TIMEOUT_MS, PROCESS_TREE_POLL_INTERVAL_MS, UNPACKED_START_TIMEOUT_MS, evidenceDir, fail, isolatedUserDataRoot, normalizedExecutablePath, recordObservationError, releaseDir, root, runId, sleep } = require('./package-launch-contracts.js');
const { cleanupVerifiedProcessTrees, currentMarkerIdentity, observeDescendants, processCreationBelongsToRun, processRecord, selectVerifiedPortableRuntimeProcess, waitForSpawn, windowsDescendants, windowsRuntimeWindowById } = require('./package-launch-processes.js');
const { packagedRendererPathForExecutable, readPackageLaunchWindowReadyEvidence, validatePackageLaunchSmokeEvidence } = require('./package-launch-validation.js');

function prepareIsolatedUserData(kind) {
    const userDataDir = path.join(isolatedUserDataRoot, kind);
    fs.mkdirSync(userDataDir, { recursive: true });
    return validateEvidenceUserDataPath(userDataDir);
}

function collectUserDataEvidence(userDataDir) {
    const runtime = readEvidenceUserDataRuntimeMarker(userDataDir);
    const identity = validateEvidenceUserDataIdentity({
        actualUserDataDir: runtime.marker?.userDataDir,
        evidenceMode: runtime.marker?.mode,
        expectedMode: PACKAGE_LAUNCH_SMOKE_MODE,
        expectedUserDataDir: userDataDir,
    });
    return {
        ...identity,
        marker: runtime.marker,
        markerError: runtime.error || null,
        markerPath: runtime.markerPath,
    };
}

async function launchUnpacked(exePath, userDataDir) {
    const stdout = [];
    const stderr = [];
    const stdoutPath = path.join(evidenceDir, `package-launch-unpacked-${runId}.stdout.log`);
    const stderrPath = path.join(evidenceDir, `package-launch-unpacked-${runId}.stderr.log`);
    const launchStartedAt = Date.now();
    const child = spawn(exePath, [], {
        cwd: path.dirname(exePath),
        env: {
            ...buildEvidenceUserDataEnv(process.env, PACKAGE_LAUNCH_SMOKE_MODE, userDataDir),
            ELECTRON_ENABLE_LOGGING: '1',
            ELECTRON_ENABLE_STACK_DUMPING: '1',
        },
        windowsHide: false,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk) => stdout.push(chunk.toString()));
    child.stderr?.on('data', (chunk) => stderr.push(chunk.toString()));
    let directRoot = null;
    let marker = '';
    let runtimeProcess = null;
    let runtimeCandidate = null;
    let windowReadyEvidence = null;
    let processCleanup = null;
    let launchError = null;
    const observationErrors = [];
    try {
        await waitForSpawn(child);
        directRoot = processRecord({
            ProcessId: child.pid,
            ParentProcessId: 0,
            Name: PORTABLE_APP_PROCESS_NAME,
            ExecutablePath: exePath,
        }, 'direct-spawn-pid-and-path', { notBeforeMs: launchStartedAt });
        const deadline = Date.now() + UNPACKED_START_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const text = stdout.join('');
            const userDataEvidence = collectUserDataEvidence(userDataDir);
            if (currentMarkerIdentity(userDataEvidence, launchStartedAt)) {
                const runtimeSnapshot = windowsRuntimeWindowById(userDataEvidence.marker.pid);
                if (runtimeSnapshot.error) {
                    recordObservationError(observationErrors, {
                        code: 'RUNTIME_WINDOW_QUERY_FAILED',
                        error: runtimeSnapshot.error,
                        processId: Number(userDataEvidence.marker.pid),
                    });
                    await sleep(300);
                    continue;
                }
                const candidate = runtimeSnapshot.processes?.[0];
                if (!candidate) {
                    recordObservationError(observationErrors, {
                        code: 'RUNTIME_MARKER_PID_NOT_OBSERVED',
                        processId: Number(userDataEvidence.marker.pid),
                    });
                    await sleep(300);
                    continue;
                }
                const candidateMatchesDirectLaunch = Boolean(candidate?.ExecutablePath
                    && Number(userDataEvidence.marker.pid) === Number(child.pid)
                    && normalizedExecutablePath(candidate.ExecutablePath) === normalizedExecutablePath(exePath)
                    && processCreationBelongsToRun(candidate.CreationDate, launchStartedAt));
                if (candidateMatchesDirectLaunch) {
                    runtimeCandidate = processRecord(candidate, 'isolated-runtime-marker-candidate', {
                        notBeforeMs: launchStartedAt,
                    });
                }
                else {
                    recordObservationError(observationErrors, {
                        code: 'RUNTIME_DIRECT_IDENTITY_MISMATCH',
                        executablePath: candidate.ExecutablePath || null,
                        processId: Number(candidate.ProcessId) || null,
                    });
                }
                const verified = selectVerifiedPortableRuntimeProcess(userDataEvidence, runtimeSnapshot, {
                    expectedExecutablePath: exePath,
                    expectedPid: child.pid,
                    notBeforeMs: launchStartedAt,
                });
                if (verified && text.includes('[App] window-created')) {
                    const candidateWindowReadyEvidence = readPackageLaunchWindowReadyEvidence(userDataDir, {
                        expectedPid: verified.processId,
                        expectedRendererPath: packagedRendererPathForExecutable(verified.executablePath),
                        expectedUserDataDir: userDataDir,
                        notBeforeMs: launchStartedAt,
                        runtimeMarkerGeneratedAt: userDataEvidence.marker.generatedAt,
                    });
                    if (candidateWindowReadyEvidence.passed) {
                        marker = '[App] window-created';
                        runtimeProcess = verified;
                        windowReadyEvidence = candidateWindowReadyEvidence;
                        break;
                    }
                    if (candidateWindowReadyEvidence.state !== 'missing') {
                        recordObservationError(observationErrors, {
                            code: 'WINDOW_READY_MARKER_INVALID',
                            violations: candidateWindowReadyEvidence.violations,
                        });
                    }
                }
            }
            if (child.exitCode !== null)
                break;
            await sleep(300);
        }
    }
    catch (error) {
        launchError = String(error?.message || error);
    }
    finally {
        const finalUserDataEvidence = collectUserDataEvidence(userDataDir);
        if (!windowReadyEvidence) {
            recordObservationError(observationErrors, {
                code: 'WINDOW_READY_MARKER_NOT_VERIFIED',
            });
        }
        if (!directRoot && Number.isInteger(Number(child.pid)) && Number(child.pid) > 0) {
            directRoot = processRecord({
                ProcessId: child.pid,
                ParentProcessId: 0,
                Name: PORTABLE_APP_PROCESS_NAME,
                ExecutablePath: exePath,
            }, 'direct-spawn-pid-and-path', { notBeforeMs: launchStartedAt });
        }
        processCleanup = await cleanupVerifiedProcessTrees({
            observationErrors,
            rootProcesses: [runtimeCandidate || directRoot].filter(Boolean),
            requiredRuntimeIdentity: currentMarkerIdentity(finalUserDataEvidence, launchStartedAt)
                && Boolean(runtimeCandidate),
        });
        child.stdout?.destroy();
        child.stderr?.destroy();
        writeLog(stdoutPath, stdout);
        writeLog(stderrPath, stderr);
    }
    const stdoutText = stdout.join('');
    const stderrText = stderr.join('');
    const userDataEvidence = collectUserDataEvidence(userDataDir);
    return {
        kind: 'win-unpacked',
        ok: Boolean(marker)
            && runtimeProcess?.windowVisible === true
            && windowReadyEvidence?.passed === true
            && userDataEvidence.passed
            && processCleanup.passed
            && observationErrors.length === 0
            && !launchError,
        launchError,
        marker,
        pid: child.pid,
        exitCode: child.exitCode,
        runtimeProcess,
        windowReadyEvidence,
        processCleanup,
        observationErrors,
        stdoutPath,
        stderrPath,
        stdoutTail: stdoutText.slice(-2000),
        stderrTail: stderrText.slice(-2000),
        userDataEvidence,
    };
}

async function launchPortable(exePath, userDataDir) {
    const stdout = [];
    const stderr = [];
    const stdoutPath = path.join(evidenceDir, `package-launch-portable-${runId}.stdout.log`);
    const stderrPath = path.join(evidenceDir, `package-launch-portable-${runId}.stderr.log`);
    const launchStartedAt = Date.now();
    const portableEnv = {
        ...buildEvidenceUserDataEnv(process.env, PACKAGE_LAUNCH_SMOKE_MODE, userDataDir),
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_ENABLE_STACK_DUMPING: '1',
    };
    const child = spawn(exePath, [], {
        cwd: path.dirname(exePath),
        detached: true,
        env: portableEnv,
        windowsHide: true,
        stdio: 'ignore',
    });
    const launcherPid = child.pid;
    let launcherRoot = null;
    const observed = {
        errors: [],
        processes: new Map(),
    };
    let runtimeProcess = null;
    let runtimeCandidate = null;
    let windowReadyEvidence = null;
    let processCleanup = null;
    let launchError = null;
    let nextTreePollAt = 0;
    try {
        child.unref();
        await waitForSpawn(child);
        launcherRoot = processRecord({
            ProcessId: launcherPid,
            ParentProcessId: 0,
            Name: path.basename(exePath),
            ExecutablePath: exePath,
        }, 'direct-portable-launcher-pid-and-path', { notBeforeMs: launchStartedAt });
        const deadline = Date.now() + PORTABLE_START_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (Date.now() >= nextTreePollAt) {
                observeDescendants(observed, windowsDescendants(launcherPid), `descendant-of:${launcherPid}`, launchStartedAt);
                nextTreePollAt = Date.now() + PROCESS_TREE_POLL_INTERVAL_MS;
            }
            const userDataEvidence = collectUserDataEvidence(userDataDir);
            if (currentMarkerIdentity(userDataEvidence, launchStartedAt)) {
                const runtimeSnapshot = windowsRuntimeWindowById(userDataEvidence.marker.pid);
                if (runtimeSnapshot.error) {
                    recordObservationError(observed.errors, {
                        code: 'RUNTIME_WINDOW_QUERY_FAILED',
                        error: runtimeSnapshot.error,
                        processId: Number(userDataEvidence.marker.pid),
                    });
                    await sleep(500);
                    continue;
                }
                const candidate = runtimeSnapshot.processes?.[0];
                if (!candidate) {
                    recordObservationError(observed.errors, {
                        code: 'RUNTIME_MARKER_PID_NOT_OBSERVED',
                        processId: Number(userDataEvidence.marker.pid),
                    });
                    await sleep(500);
                    continue;
                }
                const lineageRecord = observed.processes.get(Number(userDataEvidence.marker.pid));
                const candidateMatchesLineage = Boolean(lineageRecord
                    && candidate?.ExecutablePath
                    && normalizedExecutablePath(candidate.ExecutablePath)
                        === normalizedExecutablePath(lineageRecord.executablePath)
                    && processCreationBelongsToRun(candidate.CreationDate, launchStartedAt)
                    && Math.abs(Date.parse(candidate.CreationDate || '') - Date.parse(lineageRecord.creationDate || '')) <= 2000);
                if (candidateMatchesLineage) {
                    runtimeCandidate = processRecord(candidate, 'isolated-runtime-marker-candidate', {
                        notBeforeMs: launchStartedAt,
                    });
                }
                else if (lineageRecord) {
                    recordObservationError(observed.errors, {
                        code: 'RUNTIME_LINEAGE_IDENTITY_MISMATCH',
                        executablePath: candidate.ExecutablePath || null,
                        expectedExecutablePath: lineageRecord.executablePath || null,
                        processId: Number(candidate.ProcessId) || null,
                    });
                }
                const verified = selectVerifiedPortableRuntimeProcess(userDataEvidence, runtimeSnapshot, {
                    allowedProcessIds: new Set(observed.processes.keys()),
                    expectedCreationDate: lineageRecord?.creationDate,
                    expectedExecutablePath: lineageRecord?.executablePath,
                    notBeforeMs: launchStartedAt,
                });
                if (verified) {
                    const candidateWindowReadyEvidence = readPackageLaunchWindowReadyEvidence(userDataDir, {
                        expectedPid: verified.processId,
                        expectedRendererPath: packagedRendererPathForExecutable(verified.executablePath),
                        expectedUserDataDir: userDataDir,
                        notBeforeMs: launchStartedAt,
                        runtimeMarkerGeneratedAt: userDataEvidence.marker.generatedAt,
                    });
                    if (candidateWindowReadyEvidence.passed) {
                        runtimeProcess = verified;
                        windowReadyEvidence = candidateWindowReadyEvidence;
                        break;
                    }
                    if (candidateWindowReadyEvidence.state !== 'missing') {
                        recordObservationError(observed.errors, {
                            code: 'WINDOW_READY_MARKER_INVALID',
                            violations: candidateWindowReadyEvidence.violations,
                        });
                    }
                }
            }
            await sleep(500);
        }
    }
    catch (error) {
        launchError = String(error?.message || error);
    }
    finally {
        const finalUserDataEvidence = collectUserDataEvidence(userDataDir);
        if (!windowReadyEvidence) {
            recordObservationError(observed.errors, {
                code: 'WINDOW_READY_MARKER_NOT_VERIFIED',
            });
        }
        if (!launcherRoot && Number.isInteger(Number(launcherPid)) && Number(launcherPid) > 0) {
            launcherRoot = processRecord({
                ProcessId: launcherPid,
                ParentProcessId: 0,
                Name: path.basename(exePath),
                ExecutablePath: exePath,
            }, 'direct-portable-launcher-pid-and-path', { notBeforeMs: launchStartedAt });
        }
        processCleanup = await cleanupVerifiedProcessTrees({
            observationErrors: observed.errors,
            observedProcesses: [...observed.processes.values()],
            rootProcesses: [launcherRoot, runtimeCandidate].filter(Boolean),
            requiredRuntimeIdentity: currentMarkerIdentity(finalUserDataEvidence, launchStartedAt)
                && Boolean(runtimeCandidate),
        });
        writeLog(stdoutPath, stdout);
        writeLog(stderrPath, stderr);
    }
    const userDataEvidence = collectUserDataEvidence(userDataDir);
    return {
        kind: 'portable',
        ok: runtimeProcess?.windowVisible === true
            && windowReadyEvidence?.passed === true
            && userDataEvidence.passed
            && processCleanup.passed
            && observed.errors.length === 0
            && !launchError,
        launchError,
        launcherPid,
        launcherExitCode: child.exitCode,
        runtimeProcess,
        windowReadyEvidence,
        observedProcessCount: observed.processes.size,
        observationErrors: observed.errors,
        processCleanup,
        stdoutPath,
        stderrPath,
        stdoutTail: stdout.join('').slice(-2000),
        stderrTail: stderr.join('').slice(-2000),
        userDataEvidence,
    };
}

async function main() {
    const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'desktop', 'package.json'), 'utf8'));
    if (process.platform !== 'win32') {
        fail('Package launch smoke currently supports Windows only', process.platform);
    }
    fs.mkdirSync(evidenceDir, { recursive: true });
    const unpackedExe = path.join(releaseDir, 'win-unpacked', 'AmazonAIOpsAgent.exe');
    const portableExe = path.join(releaseDir, `AmazonAIOpsAgent-${desktopPackage.version}-portable.exe`);
    const userDataOverrideBundleContract = inspectPackagedUserDataOverrideContract(path.join(releaseDir, 'win-unpacked', 'resources', 'app', 'dist', 'main', 'index.js'));
    const isolatedUserData = {
        unpacked: prepareIsolatedUserData('win-unpacked'),
        portable: prepareIsolatedUserData('portable'),
    };
    const evidence = {
        kind: 'package-launch-smoke',
        generatedAt: new Date().toISOString(),
        releaseDir,
        evidenceMode: PACKAGE_LAUNCH_SMOKE_MODE,
        isolatedUserData,
        userDataOverrideBundleContract,
        artifacts: {
            unpacked: fileInfo(unpackedExe),
            portable: fileInfo(portableExe),
        },
        checks: [],
        passed: false,
    };
    if (!userDataOverrideBundleContract.passed) {
        fail('Package launch smoke refused to start a package without the userData override contract', JSON.stringify(userDataOverrideBundleContract.violations));
    }
    evidence.checks.push(await launchUnpacked(unpackedExe, isolatedUserData.unpacked));
    evidence.checks.push(await launchPortable(portableExe, isolatedUserData.portable));
    evidence.passed = evidence.checks.every((check) => check.ok);
    evidence.contractValidation = validatePackageLaunchSmokeEvidence(evidence);
    if (!evidence.contractValidation.passed) {
        evidence.passed = false;
    }
    const evidencePath = path.join(evidenceDir, `package-launch-smoke-${runId}.json`);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    if (!evidence.passed) {
        fail('Package launch smoke failed', evidencePath);
    }
    console.log(`[PASS] package launch smoke evidence: ${evidencePath}`);
}

module.exports = { prepareIsolatedUserData, collectUserDataEvidence, launchUnpacked, launchPortable, main };
