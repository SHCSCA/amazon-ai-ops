// 按职责复用原有严格校验，公共入口继续保持兼容。
const { TARGET_VERSION, requireSqlite, readAppliedVersion, collectRowCounts, } = require('./migrate-current-user-db');
const { assertPacketPackageIdentity, resolveCanonicalPaths, samePackageIdentity, validateExclusiveDbPreflight } = require('./s7-launch-operator-authority.js');
const { createLaunchIntent, createStartupGatePlan, receiptPackageIdentity } = require('./s7-launch-operator-bindings.js');
const { DEFAULT_EXCLUSIVE_WINDOW_COMMAND_TIMEOUT_MS, DEFAULT_EXCLUSIVE_WINDOW_READY_TIMEOUT_MS, DEFAULT_EXIT_TIMEOUT_MS, DEFAULT_SPAWN_TIMEOUT_MS, EXCLUSIVE_WINDOW_PROTOCOL, KIND, SCHEMA_VERSION, boundedError, fail, helperConfirmedClosed, nowIso, publicArtifact, sameArtifact, stableJson } = require('./s7-launch-operator-contracts.js');
const { fileArtifact, isolatedRecoveryOutput, noSidecars, readJsonStable, writeProtectedRecoveryOutput } = require('./s7-launch-operator-filesystem.js');
const { validatePacket, validateStage2Inputs } = require('./s7-launch-operator-packet.js');
const { boundedUntrustedCandidate, collectPostCloseEvidence, holdReceipt } = require('./s7-launch-operator-postclose.js');
const { validateProcessState, validateSpawnProcessState } = require('./s7-launch-operator-processes.js');
const { validateControlledCloseProof, validateLaunchExclusiveReady, validateLaunchExclusiveReleased, validateSuspendedPackageProof } = require('./s7-launch-operator-proofs.js');
const { childEnvironment } = require('./s7-launch-operator-runtime.js');
const { validateAuthorityDatabaseSecurity } = require('./s7-launch-operator-security.js');

async function executeApproved(values, context) {
    const outputCanonical = resolveCanonicalPaths(context);
    const outputPackageIdentity = context.packageIdentity();
    const preliminaryOutput = isolatedRecoveryOutput(values.out, values['recovery-root'], outputCanonical, outputPackageIdentity, [values['approval-packet']], context.inspectWindowsPathSecurity);
    const packetRead = readJsonStable(values['approval-packet'], 'Approval packet');
    const savedArtifactPaths = [
        packetRead.value?.bindings?.authoritySelection?.realPath,
        packetRead.value?.bindings?.migrationManifest?.realPath,
        packetRead.value?.bindings?.migrationVerification?.realPath,
        packetRead.value?.bindings?.packageUi?.artifact?.realPath,
    ].filter((value) => typeof value === 'string');
    const isolatedOutput = isolatedRecoveryOutput(preliminaryOutput.output, preliminaryOutput.recoveryRoot, outputCanonical, outputPackageIdentity, [packetRead.artifact.realPath, ...savedArtifactPaths], context.inspectWindowsPathSecurity);
    const output = isolatedOutput.output;
    const recoveryOutputSecurity = isolatedOutput.windowsSecurity;
    let packetIdentity;
    let launchIntent = null;
    let startupGatePlan = null;
    let packageLaunchAttempted = false;
    let packageLaunched = 'NOT_LAUNCHED';
    let current = null;
    let finalDb = null;
    let preSpawnPackage = null;
    let exclusiveWindow = null;
    let launchExclusiveWindow = null;
    let launch = null;
    let postCloseEvidence = null;
    try {
        packetIdentity = validatePacket(packetRead.value, packetRead.artifact, context, values['confirm-live-migration']);
        const saved = packetRead.value.bindings;
        current = validateStage2Inputs({
            db: saved?.db?.realPath,
            authoritySelection: saved?.authoritySelection?.realPath,
            migrationManifest: saved?.migrationManifest?.realPath,
            migrationVerification: saved?.migrationVerification?.realPath,
            packageUiManifest: saved?.packageUi?.mode === 'package-upgrade-smoke' ? undefined : saved?.packageUi?.artifact?.realPath,
            packageUpgradeSmoke: saved?.packageUi?.mode === 'package-upgrade-smoke' ? saved?.packageUi?.artifact?.realPath : undefined,
        }, context);
        if (stableJson(saved) !== stableJson(current)) {
            fail('Approval bindings drifted since packet creation.');
        }
        finalDb = fileArtifact(current.db.realPath, 'Live authority database');
        if (!sameArtifact(current.db, finalDb)) {
            fail('Live authority DB drifted immediately before package launch.');
        }
        noSidecars(finalDb.realPath, 'Live authority database');
        validateAuthorityDatabaseSecurity(context, finalDb.realPath, 'Live authority database final pre-spawn check');
        validateProcessState(context.listProcesses(), 'AmazonAIOpsAgent process final pre-spawn recheck');
        validateExclusiveDbPreflight(context.exclusiveDbPreflight(finalDb.realPath), 'Live authority DB final pre-spawn check');
        preSpawnPackage = context.packageIdentity();
        assertPacketPackageIdentity(packetRead.value, preSpawnPackage);
        const launchAdjacentDb = fileArtifact(finalDb.realPath, 'Live authority database');
        if (!sameArtifact(finalDb, launchAdjacentDb)) {
            fail('Live authority DB drifted during the final package identity check.');
        }
        noSidecars(launchAdjacentDb.realPath, 'Live authority database');
        validateExclusiveDbPreflight(context.exclusiveDbPreflight(launchAdjacentDb.realPath), 'Live authority DB launch-adjacent check');
        const targetEnvironment = childEnvironment(context.env, current.canonical);
        exclusiveWindow = await context.acquireLaunchExclusiveWindow(launchAdjacentDb.realPath, preSpawnPackage.exe.realPath, targetEnvironment, DEFAULT_EXCLUSIVE_WINDOW_READY_TIMEOUT_MS);
        let ready;
        try {
            ready = validateLaunchExclusiveReady(exclusiveWindow, launchAdjacentDb, context);
        }
        catch (error) {
            if (error instanceof Error && !error.proof) {
                error.proof = exclusiveWindow?.proof || null;
            }
            throw error;
        }
        launchExclusiveWindow = {
            protocol: EXCLUSIVE_WINDOW_PROTOCOL,
            state: 'EXCLUSIVE_READY',
            ready,
            suspended: null,
            resumed: null,
            closed: null,
            sequence: [{ step: 'READY', at: ready.openedAt }],
            manualRecovery: null,
            processKillInvoked: false,
            automaticRetryInvoked: false,
            rollbackInvoked: false,
        };
        validateProcessState(context.listProcesses(), 'AmazonAIOpsAgent process check under launch-exclusive DB lock');
        noSidecars(launchAdjacentDb.realPath, 'Live authority database');
        const lockedPackage = context.packageIdentity();
        if (!samePackageIdentity(preSpawnPackage, lockedPackage)) {
            fail('Canonical package identity drifted while the live DB lock was held.');
        }
        preSpawnPackage = lockedPackage;
        launchIntent = createLaunchIntent(packetRead, packetIdentity, current, output, context);
        launchExclusiveWindow.sequence.push({
            step: 'INTENT_PERSISTED',
            at: nowIso(context.now),
            intentSha256: launchIntent.sha256,
        });
        startupGatePlan = createStartupGatePlan(current, launchIntent, context);
        const spawnRequestedAt = nowIso(context.now);
        packageLaunchAttempted = true;
        packageLaunched = 'UNKNOWN_AFTER_HANDOFF';
        launch = {
            pid: null,
            executablePath: null,
            approvedExecutablePath: preSpawnPackage.exe.realPath,
            requestedAt: spawnRequestedAt,
            startedAt: null,
            state: 'CREATE_SUSPENDED_REQUESTED',
            createdSuspended: false,
            resumed: false,
            packageIdentities: {
                preSpawn: receiptPackageIdentity(preSpawnPackage),
                suspended: null,
                postSpawn: null,
                postExit: null,
            },
            result: null,
            stdout: { captured: false, persisted: false },
            stderr: { captured: false, persisted: false },
            processKillInvoked: false,
            automaticRetryInvoked: false,
            rollbackInvoked: false,
        };
        const suspendedProof = await context.createSuspendedPackage(exclusiveWindow, DEFAULT_SPAWN_TIMEOUT_MS, startupGatePlan);
        let suspended;
        try {
            suspended = validateSuspendedPackageProof(suspendedProof, ready, preSpawnPackage.exe.realPath, startupGatePlan, context);
        }
        catch (error) {
            if (error instanceof Error && !error.proof)
                error.proof = suspendedProof;
            throw error;
        }
        launchExclusiveWindow.suspended = suspended;
        launchExclusiveWindow.state = 'SUSPENDED_AWAITING_VALIDATION';
        launchExclusiveWindow.sequence.push({ step: 'SPAWNED_SUSPENDED', at: suspended.createdAt });
        launchExclusiveWindow.sequence.push({
            step: 'STARTUP_GATE_ACTIVE_AND_BOUND',
            at: suspended.createdAt,
            gateId: suspended.startupGate.gateId,
            invocationId: suspended.startupGate.invocationId,
            activeSha256: suspended.startupGate.active.sha256,
            boundSha256: suspended.startupGate.bound.sha256,
        });
        launch.pid = suspended.pid;
        launch.createdSuspended = true;
        launch.state = 'SUSPENDED_AWAITING_VALIDATION';
        launch.executablePath = suspended.queriedExecutablePath;
        launchExclusiveWindow.sequence.push({
            step: 'PID_IMAGE_VERIFIED',
            at: nowIso(context.now),
            pid: suspended.pid,
        });
        const suspendedPackage = context.packageIdentity();
        if (!samePackageIdentity(preSpawnPackage, suspendedPackage)) {
            fail('Canonical package identity drifted while its approved process was suspended.');
        }
        launch.packageIdentities.suspended = receiptPackageIdentity(suspendedPackage);
        const suspendedProcessState = validateSpawnProcessState(context.listSuspendedProcesses(), suspended.pid);
        if (suspendedProcessState.matching.length !== 1) {
            fail('Suspended launch window contained more than the one approved package PID.');
        }
        const finalNodeInventoryAt = nowIso(context.now);
        const resumedProof = await context.releaseAndResumePackage(exclusiveWindow, DEFAULT_EXCLUSIVE_WINDOW_COMMAND_TIMEOUT_MS);
        let resumed;
        try {
            resumed = validateLaunchExclusiveReleased(resumedProof, ready, suspended, context);
        }
        catch (error) {
            if (error instanceof Error && !error.proof)
                error.proof = resumedProof;
            throw error;
        }
        launch.suspendedProcessState = suspendedProcessState;
        launchExclusiveWindow.sequence.push({
            step: 'SAME_NAME_PROCESS_SET_VERIFIED',
            at: finalNodeInventoryAt,
            pid: suspended.pid,
            matchingCount: suspendedProcessState.matching.length,
        });
        launchExclusiveWindow.resumed = resumed;
        launchExclusiveWindow.sameNameRaceBoundary = {
            operatorAdjacentInventory: true,
            helperAdjacentInventory: resumed.finalSameNameInventoryPassed === true,
            helperMatchingCount: resumed.finalSameNameProcessCount,
            absoluteStartPrevention: false,
            packagedMainStartupGateRequiredForFormalAcceptance: true,
        };
        launchExclusiveWindow.state = 'RESUMED_AND_RUNNING';
        launchExclusiveWindow.sequence.push({
            step: 'DB_RELEASED_AND_PROCESS_RESUMED',
            at: resumed.resumedAt,
            releasedAt: resumed.releasedAt,
            pid: resumed.pid,
        });
        launch.resumed = true;
        launch.startedAt = resumed.resumedAt;
        launch.state = 'RUNNING';
        packageLaunched = 'CONFIRMED_LAUNCHED';
        let postSpawnIssue = null;
        try {
            const postSpawnPackage = context.packageIdentity();
            if (!samePackageIdentity(preSpawnPackage, postSpawnPackage)) {
                fail('Canonical package identity drifted across controlled resume.');
            }
            launch.packageIdentities.postSpawn = receiptPackageIdentity(postSpawnPackage);
        }
        catch (error) {
            postSpawnIssue = boundedError(error);
            launch.postSpawnIdentityError = postSpawnIssue;
        }
        const result = await context.waitForManagedPackageClose(exclusiveWindow, DEFAULT_EXIT_TIMEOUT_MS);
        launch.result = result;
        launchExclusiveWindow.helperLifecycle = {
            packageCloseObserved: result?.outcome === 'close',
            helperClose: result?.helperClose ?? null,
            helperConfirmedClosed: helperConfirmedClosed(result),
            cleanup: null,
        };
        if (result?.outcome === 'timeout') {
            launch.state = 'RUNNING_UNRESOLVED';
            launch.detach = context.detachManagedLaunch(exclusiveWindow);
            launchExclusiveWindow.helperLifecycle.cleanup = launch.detach;
            launchExclusiveWindow.state = 'RUNNING_UNRESOLVED';
            fail('Canonical package launch timed out and remains an unresolved external process.');
        }
        if (result?.outcome !== 'close') {
            launch.state = 'PROCESS_STATE_UNRESOLVED';
            launch.detach = context.detachManagedLaunch(exclusiveWindow);
            launchExclusiveWindow.helperLifecycle.cleanup = launch.detach;
            launchExclusiveWindow.state = 'PROCESS_STATE_UNRESOLVED';
            fail(`Canonical package close could not be observed: ${result?.outcome || 'unknown'}.`);
        }
        launch.state = 'CLOSED_AWAITING_EVIDENCE_CLASSIFICATION';
        launchExclusiveWindow.closed = {
            protocol: result.proof?.protocol ?? EXCLUSIVE_WINDOW_PROTOCOL,
            status: result.proof?.status ?? 'CLOSED',
            helperPid: Number(result.proof?.helperPid ?? ready.helperPid),
            pid: Number(result.proof?.pid ?? suspended.pid),
            exitCode: Number(result.code),
            signal: result.signal ?? null,
            closedAt: result.closedAt ?? result.proof?.closedAt ?? null,
            helperClose: result.helperClose ?? null,
        };
        launchExclusiveWindow.state = 'CLOSED_AWAITING_EVIDENCE_CLASSIFICATION';
        launchExclusiveWindow.sequence.push({
            step: 'CLOSE_OBSERVED',
            at: launchExclusiveWindow.closed.closedAt || nowIso(context.now),
            pid: launchExclusiveWindow.closed.pid,
            exitCode: launchExclusiveWindow.closed.exitCode,
        });
        postCloseEvidence = collectPostCloseEvidence(context, preSpawnPackage, finalDb.realPath);
        launch.postCloseEvidence = postCloseEvidence.receipt;
        launchExclusiveWindow.sequence.push({
            step: 'POST_CLOSE_EVIDENCE_COLLECTED',
            at: postCloseEvidence.receipt.collectedAt,
        });
        if (postCloseEvidence.packageIdentity) {
            launch.packageIdentities.postExit = receiptPackageIdentity(postCloseEvidence.packageIdentity);
        }
        let validatedClose;
        try {
            validatedClose = validateControlledCloseProof(result, ready, suspended, resumed, context);
        }
        catch (error) {
            if (error instanceof Error && !error.proof)
                error.proof = result?.proof || null;
            throw error;
        }
        launchExclusiveWindow.closed.closedAt = validatedClose.closedAt;
        launchExclusiveWindow.closed.startupGate = validatedClose.startupGate;
        launchExclusiveWindow.sameNameRaceBoundary.absoluteStartPrevention = true;
        launchExclusiveWindow.sameNameRaceBoundary.packagedMainStartupGateRequiredForFormalAcceptance = false;
        launchExclusiveWindow.sameNameRaceBoundary.packagedMainStartupGate = 'INTEGRATED_AND_PROVEN';
        launchExclusiveWindow.sequence.push({
            step: 'MAIN_ADMISSION_AND_HELPER_CLOSED_BOUND',
            at: validatedClose.closedAt,
            admissionSha256: validatedClose.startupGate.admission.sha256,
            closedSha256: validatedClose.startupGate.closed.sha256,
        });
        if (result.code !== 0 || result.signal) {
            fail(`Canonical package launch closed abnormally after evidence collection: `
                + `code=${String(result.code)}, signal=${String(result.signal)}.`);
        }
        if (result.helperClose?.outcome !== 'close'
            || result.helperClose.code !== 0
            || result.helperClose.signal) {
            fail('Controlled launch helper did not close normally after package close.');
        }
        if (postSpawnIssue) {
            fail(`Post-resume package identity was not trustworthy: ${postSpawnIssue.message}`);
        }
        if (postCloseEvidence.receipt.package.passed !== true) {
            fail('Post-close package identity evidence failed.');
        }
        if (postCloseEvidence.receipt.processes.passed !== true) {
            fail('Post-close same-name process evidence failed.');
        }
        if (postCloseEvidence.receipt.database.passed !== true
            || !postCloseEvidence.databaseSnapshot) {
            fail('Post-close authority DB could not be bound to one stable snapshot.');
        }
        const postVersion = postCloseEvidence.databaseSnapshot.schemaVersion;
        if (postVersion !== TARGET_VERSION) {
            fail(`Canonical package exited but live schema is not v${TARGET_VERSION}.`);
        }
        launch.state = 'CLOSED_EVIDENCE_COLLECTED';
        launchExclusiveWindow.state = 'CLOSED_EVIDENCE_COLLECTED';
        const receipt = {
            kind: KIND,
            schemaVersion: SCHEMA_VERSION,
            generatedAt: nowIso(context.now),
            status: 'LAUNCHED_AWAITING_READONLY_ACCEPTANCE',
            passed: false,
            formalAcceptance: false,
            authorityDatabaseMutated: true,
            packageLaunchAttempted: true,
            packageLaunched: 'CONFIRMED_LAUNCHED',
            operatorDirectAdsExecutionInvoked: false,
            adsExecutionInvoked: null,
            packageAdsExecutionState: 'UNKNOWN',
            approvalPacket: publicArtifact(packetRead.artifact),
            approvalPayloadSha256: packetIdentity.hash,
            launchIntent,
            startupGate: validatedClose.startupGate,
            recoveryOutputSecurity,
            launchExclusiveWindow,
            launch,
            postCloseEvidence: postCloseEvidence.receipt,
            postLaunch: postCloseEvidence.databaseSnapshot,
            remainingAcceptanceDependencies: {
                packagedMainStartupSameNameGate: 'INTEGRATED_AND_PROVEN',
                formalAcceptanceBlocked: true,
                separateReadonlyAcceptanceRequired: true,
            },
            requiredNextStep: 'Run verify:s7-live-migration-acceptance separately before store configuration, scheduler recovery, collection, or Ads execution.',
        };
        writeProtectedRecoveryOutput(output, receipt, context, 'Launch receipt');
        return { exitCode: 0, receipt, outputPath: output };
    }
    catch (error) {
        if (exclusiveWindow) {
            try {
                if (!packageLaunchAttempted) {
                    const abort = context.abortUnlaunchedExclusiveWindow(exclusiveWindow);
                    if (launchExclusiveWindow)
                        launchExclusiveWindow.abort = abort;
                }
                else if (!helperConfirmedClosed(launch?.result) && !launch?.detach) {
                    const detach = context.detachManagedLaunch(exclusiveWindow);
                    if (launch)
                        launch.detach = detach;
                    if (launchExclusiveWindow) {
                        launchExclusiveWindow.helperLifecycle = {
                            packageCloseObserved: launch?.result?.outcome === 'close',
                            helperClose: launch?.result?.helperClose ?? null,
                            helperConfirmedClosed: false,
                            cleanup: detach,
                        };
                        launchExclusiveWindow.manualRecovery = {
                            required: true,
                            reason: (launch?.createdSuspended === true
                                || error?.proof?.status === 'SPAWNED'
                                || error?.proof?.processCreated === true) && launch?.resumed !== true
                                ? 'SUSPENDED_PROCESS_NOT_CONFIRMED_RESUMED'
                                : 'CONTROLLED_LAUNCH_STATE_UNRESOLVED',
                            automaticResumeInvoked: false,
                            processKillInvoked: false,
                            requiredAction: 'Preserve the helper PID, suspended/running package PID, DB, sidecars, intent, and HOLD receipt. Do not retry; perform manual recovery and obtain a new packet and approval.',
                        };
                    }
                }
            }
            catch {
            }
        }
        const untrustedCandidate = boundedUntrustedCandidate(error, exclusiveWindow, launch);
        const packetArtifact = packetRead?.artifact || {
            path: typeof values['approval-packet'] === 'string' ? values['approval-packet'] : null,
            realPath: null,
            sha256: null,
            sizeBytes: null,
            mtimeMs: null,
            identity: null,
        };
        const receipt = holdReceipt(packetArtifact, packetIdentity?.hash || null, error instanceof Error ? error.message : String(error), {
            packageLaunchAttempted,
            packageLaunched,
            launchIntent,
            startupGate: startupGatePlan,
            recoveryOutputSecurity,
            launchExclusiveWindow,
            launch,
            untrustedCandidate,
            postCloseEvidence: postCloseEvidence?.receipt || null,
        }, context);
        writeProtectedRecoveryOutput(output, receipt, context, 'Launch HOLD receipt');
        return { exitCode: 1, receipt, outputPath: output };
    }
}

module.exports = { executeApproved };
