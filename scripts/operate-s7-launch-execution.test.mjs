// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { TARGET_VERSION, describe, expect, fs, it, path, run } from './s7-launch-operator-test-environment.mjs';
import { setup } from './s7-launch-operator-test-setup.mjs';
import { executeArgs, prepare } from './s7-launch-operator-test-workflow.mjs';
import { sha } from './s7-launch-operator-test-artifacts.mjs';
describe('operate-s7-live-migration-launch', () => {
it('verifies actual PID/path, package triple, sanitizes env, and never claims Ads state', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    const result = await run(executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'launch.json')), s.context);
    expect(result.exitCode, result.receipt?.reason).toBe(0);
    expect(s.getSpawns()).toBe(1);
    expect(s.getExclusiveCalls()).toBeGreaterThanOrEqual(3);
    expect(result.receipt.status).toBe('LAUNCHED_AWAITING_READONLY_ACCEPTANCE');
    expect(result.receipt.formalAcceptance).toBe(false);
    expect(result.receipt.packageLaunched).toBe('CONFIRMED_LAUNCHED');
    expect(result.receipt.adsExecutionInvoked).toBeNull();
    expect(result.receipt.packageAdsExecutionState).toBe('UNKNOWN');
    expect(result.receipt.operatorDirectAdsExecutionInvoked).toBe(false);
    expect(result.receipt.launch.executablePath).toBe(s.identity.exe.realPath);
    expect(result.receipt.launch).toMatchObject({
        createdSuspended: true,
        resumed: true,
        state: 'CLOSED_EVIDENCE_COLLECTED',
    });
    expect(result.receipt.launchExclusiveWindow.sequence.map((item) => item.step)).toEqual([
        'READY',
        'INTENT_PERSISTED',
        'SPAWNED_SUSPENDED',
        'STARTUP_GATE_ACTIVE_AND_BOUND',
        'PID_IMAGE_VERIFIED',
        'SAME_NAME_PROCESS_SET_VERIFIED',
        'DB_RELEASED_AND_PROCESS_RESUMED',
        'CLOSE_OBSERVED',
        'POST_CLOSE_EVIDENCE_COLLECTED',
        'MAIN_ADMISSION_AND_HELPER_CLOSED_BOUND',
    ]);
    expect(result.receipt.launchExclusiveWindow.sameNameRaceBoundary).toEqual({
        operatorAdjacentInventory: true,
        helperAdjacentInventory: true,
        helperMatchingCount: 1,
        absoluteStartPrevention: true,
        packagedMainStartupGateRequiredForFormalAcceptance: false,
        packagedMainStartupGate: 'INTEGRATED_AND_PROVEN',
    });
    expect(result.receipt.remainingAcceptanceDependencies).toEqual({
        packagedMainStartupSameNameGate: 'INTEGRATED_AND_PROVEN',
        formalAcceptanceBlocked: true,
        separateReadonlyAcceptanceRequired: true,
    });
    expect(result.receipt.formalAcceptance).toBe(false);
    expect(result.receipt.startupGate).toMatchObject({
        gateId: expect.stringMatching(/^gate-/),
        invocationId: expect.stringMatching(/^invocation-/),
        admissionVerified: true,
        windowsSecurityPassed: true,
        active: { identity: { hardLinkCount: 1 } },
        bound: { identity: { hardLinkCount: 1 } },
        admission: { identity: { hardLinkCount: 1 } },
        closed: { identity: { hardLinkCount: 1 } },
    });
    expect(result.receipt.recoveryOutputSecurity).toMatchObject({
        passed: true,
        ownerSid: 'S-1-5-21-synthetic',
        inheritanceProtected: true,
        highRiskWritePrincipalCount: 0,
    });
    expect(result.receipt.launchIntent.windowsSecurity).toMatchObject({
        passed: true,
        ownerSid: 'S-1-5-21-synthetic',
        highRiskWritePrincipalCount: 0,
    });
    expect(result.receipt.launch.packageIdentities).toMatchObject({
        preSpawn: {
            exe: {
                sha256: s.identity.exe.sha256,
                sizeBytes: s.identity.exe.sizeBytes,
                identity: s.identity.exe.identity,
            },
        },
        postSpawn: {
            main: {
                sha256: s.identity.main.sha256,
                sizeBytes: s.identity.main.sizeBytes,
                identity: s.identity.main.identity,
            },
        },
        postExit: {
            appContent: {
                sha256: s.identity.appContent.sha256,
                fileCount: s.identity.appContent.fileCount,
                sizeBytes: s.identity.appContent.sizeBytes,
            },
        },
    });
    expect(result.receipt.postCloseEvidence.database).toMatchObject({
        passed: true,
        method: 'bracketed-stable-main-file-and-readonly-schema',
        schemaVersion: TARGET_VERSION,
        snapshot: {
            database: { sha256: sha('v0-db') },
            schemaVersion: TARGET_VERSION,
        },
    });
    const env = s.getTargetEnvironment();
    expect(env.APPDATA).toBe(fs.realpathSync.native(s.roaming));
    expect(env.USERPROFILE).toBe(fs.realpathSync.native(s.root));
    expect(env.SYSTEMROOT).toBe('C:\\Windows');
    expect(env.COMSPEC).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(env.PATH).toBe([
        'C:\\Windows\\System32',
        'C:\\Windows\\System32\\Wbem',
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
    ].join(path.delimiter));
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env).not.toHaveProperty('SAFE_VALUE');
    expect(env).not.toHaveProperty('AMAZON_AI_OPS_EVIDENCE_MODE');
    expect(env).not.toHaveProperty('AMAZON_AI_OPS_USER_DATA_DIR');
    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(env).not.toHaveProperty('ELECTRON_ENABLE_LOGGING');
    expect(env).not.toHaveProperty('amazon_ai_ops_user_data');
    expect(env).not.toHaveProperty('NODE_OPTIONS');
    expect(env).not.toHaveProperty('VITE_DEV_SERVER_URL');
    expect(env).not.toHaveProperty('FINAL_READINESS_PATH');
    expect(env).not.toHaveProperty('PORTABLE_EXECUTABLE_DIR');
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('LINGXING_PASSWORD');
    expect(env).not.toHaveProperty('CUSTOM_TOKEN');
    expect(env).not.toHaveProperty('AWS_SESSION_TOKEN');
    expect(env).not.toHaveProperty('BROWSER_COOKIE');
    expect(env).not.toHaveProperty(s.environmentSentinelKey);
    expect(s.getLaunchObservationOrder()).toEqual([
        'ready',
        'intent-before-suspended-create',
        'pid-image-verified',
        'released-and-resumed',
        'close-monitor',
    ]);
});

it('publishes HOLD when the suspended PID path or post-resume package identity differs', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    const originalCreateSuspendedPackage = s.context.createSuspendedPackage;
    s.context.createSuspendedPackage = async (...args) => ({
        ...(await originalCreateSuspendedPackage(...args)),
        queriedExecutablePath: path.join(s.root, 'other', 'AmazonAIOpsAgent.exe'),
    });
    const mismatch = await run(executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'pid-hold.json')), s.context);
    expect(mismatch.exitCode).toBe(1);
    expect(mismatch.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
    expect(mismatch.receipt.packageAdsExecutionState).toBe('UNKNOWN');
    expect(mismatch.receipt.reason).toMatch(/approved package suspended/i);
    expect(mismatch.receipt.launch).toMatchObject({
        createdSuspended: false,
        resumed: false,
        detach: { processKillInvoked: false },
    });
    expect(s.getLaunchObservationOrder()).not.toContain('released-and-resumed');
    expect(mismatch.receipt.launchExclusiveWindow.manualRecovery).toMatchObject({
        required: true,
        reason: 'SUSPENDED_PROCESS_NOT_CONFIRMED_RESUMED',
        automaticResumeInvoked: false,
        processKillInvoked: false,
    });
    const s2 = setup();
    const prepared = await prepare(s2);
    const original = s2.context.packageIdentity;
    s2.context.packageIdentity = () => {
        const value = original();
        if (s2.getManagedState().resumed)
            value.main.sha256 = sha('drifted-main');
        return value;
    };
    const drift = await run(executeArgs(prepared.packetPath, prepared.token, path.join(s2.launchOutputRoot, 'package-hold.json')), s2.context);
    expect(drift.exitCode).toBe(1);
    expect(drift.receipt.packageAdsExecutionState).toBe('UNKNOWN');
    expect(drift.receipt.postCloseEvidence.status).toBe('COLLECTED_AFTER_OBSERVED_CLOSE');
    expect(drift.receipt.reason).toMatch(/post-resume package identity/i);
});

it('keeps the DB lock and suspended process when a foreign same-name EXE appears before resume', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    const normalList = s.context.listProcesses;
    s.context.listProcesses = () => {
        const state = normalList();
        if (s.getManagedState().suspendedCreated && !s.getManagedState().resumed) {
            state.matching.push({
                pid: 9911,
                parentPid: 4,
                executablePath: 'C:\\foreign\\AmazonAIOpsAgent.exe',
            });
        }
        return state;
    };
    const result = await run(executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'foreign-before-resume.json')), s.context);
    expect(result.exitCode).toBe(1);
    expect(s.getManagedState()).toEqual({
        suspendedCreated: true,
        resumed: false,
        closed: false,
    });
    expect(result.receipt.launchExclusiveWindow.sequence.map((item) => item.step)).toEqual([
        'READY',
        'INTENT_PERSISTED',
        'SPAWNED_SUSPENDED',
        'STARTUP_GATE_ACTIVE_AND_BOUND',
        'PID_IMAGE_VERIFIED',
    ]);
    expect(result.receipt.launchExclusiveWindow.manualRecovery).toMatchObject({
        required: true,
        reason: 'SUSPENDED_PROCESS_NOT_CONFIRMED_RESUMED',
    });
    expect(result.receipt.packageAdsExecutionState).toBe('UNKNOWN');
    expect(result.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
});

it('keeps ACTIVE/HOLD and refuses CLOSED when the approved child exits abnormally', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    s.context.waitForManagedPackageClose = async () => {
        s.setManagedClosed(true);
        return {
            outcome: 'process-monitor-error',
            errorCode: 'PROTOCOL_SEQUENCE_MISMATCH',
            errorProof: {
                status: 'ERROR',
                phase: 'child-exit-failed-before-closed-receipt',
                processCreated: true,
                processResumed: true,
            },
        };
    };
    const result = await run(executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'abnormal-close.json')), s.context);
    expect(result.exitCode).toBe(1);
    expect(result.receipt.reason).toMatch(/close could not be observed/i);
    expect(result.receipt.postCloseEvidence).toBeNull();
    expect(result.receipt.startupGate).toMatchObject({
        gateId: expect.stringMatching(/^gate-/),
        invocationId: expect.stringMatching(/^invocation-/),
    });
    expect(fs.existsSync(s.getStartupGatePlan().activePath)).toBe(true);
    expect(fs.existsSync(s.getStartupGatePlan().boundPath)).toBe(true);
    expect(fs.existsSync(s.getStartupGatePlan().closedPath)).toBe(false);
    expect(result.receipt.packageLaunched).toBe('CONFIRMED_LAUNCHED');
});

it('keeps ACTIVE/BOUND and enters HOLD when Main admission is missing', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    s.context.waitForManagedPackageClose = async () => {
        s.setManagedClosed(true);
        return {
            outcome: 'process-monitor-error',
            errorCode: 'PROTOCOL_SEQUENCE_MISMATCH',
            errorProof: {
                status: 'ERROR',
                phase: 'validate-main-admission-receipt',
                processCreated: true,
                processResumed: true,
            },
        };
    };
    const result = await run(executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'missing-main-admission.json')), s.context);
    const gate = s.getStartupGatePlan();
    expect(result.exitCode).toBe(1);
    expect(result.receipt.status).toBe('HOLD');
    expect(result.receipt.formalAcceptance).toBe(false);
    expect(result.receipt.reason).toMatch(/close could not be observed/i);
    expect(fs.existsSync(gate.activePath)).toBe(true);
    expect(fs.existsSync(gate.boundPath)).toBe(true);
    expect(fs.existsSync(gate.admissionPath)).toBe(false);
    expect(fs.existsSync(gate.closedPath)).toBe(false);
    expect(result.receipt.startupGate).toMatchObject({
        activePath: gate.activePath,
        boundPath: gate.boundPath,
        admissionPath: gate.admissionPath,
        closedPath: gate.closedPath,
    });
});

it('closes helper input and detaches after package CLOSED when helper-close proof times out', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    const originalWaitForManagedPackageClose = s.context.waitForManagedPackageClose;
    s.context.waitForManagedPackageClose = async () => {
        const result = await originalWaitForManagedPackageClose();
        return {
            ...result,
            helperClose: { outcome: 'timeout' },
        };
    };
    const result = await run(executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'helper-close-timeout.json')), s.context);
    expect(result.exitCode).toBe(1);
    expect(s.getDetachCalls()).toBe(1);
    expect(result.receipt.packageLaunched).toBe('CONFIRMED_LAUNCHED');
    expect(result.receipt.launchExclusiveWindow.helperLifecycle).toMatchObject({
        packageCloseObserved: true,
        helperClose: { outcome: 'timeout' },
        helperConfirmedClosed: false,
        cleanup: {
            detachedFromOperator: true,
            helperInputState: 'CLOSE_REQUESTED',
            processKillInvoked: false,
        },
    });
    expect(result.receipt.launchExclusiveWindow.manualRecovery).toMatchObject({
        required: true,
        processKillInvoked: false,
        automaticResumeInvoked: false,
    });
    expect(result.receipt.reason).toMatch(/helper did not close normally/i);
});

it('detaches safely on timeout without kill, retry, rollback, or stdout persistence', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    s.context.waitForManagedPackageClose = async () => ({ outcome: 'timeout' });
    const result = await run(executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'timeout.json')), s.context);
    expect(result.exitCode).toBe(1);
    expect(s.getDetachCalls()).toBe(1);
    expect(result.receipt.authorityDatabaseMutationState).toBe('UNKNOWN_AFTER_CONSUMED_LAUNCH_ATTEMPT');
    expect(result.receipt.launch).toMatchObject({
        processKillInvoked: false,
        automaticRetryInvoked: false,
        rollbackInvoked: false,
        stdout: { captured: false, persisted: false },
        stderr: { captured: false, persisted: false },
        detach: { detachedFromOperator: true, processKillInvoked: false },
        state: 'RUNNING_UNRESOLVED',
    });
    expect(result.receipt.postCloseEvidence).toBeNull();
    expect(result.receipt.packageAdsExecutionState).toBe('UNKNOWN');
    expect(result.receipt.packageLaunched).toBe('CONFIRMED_LAUNCHED');
});
});
