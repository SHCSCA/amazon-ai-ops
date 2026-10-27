// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { TARGET_VERSION, expect, fileArtifact, fs, os, path, postMigrationAuthorityContract, require, roots } from './s7-launch-operator-test-environment.mjs';
import { clone, gateArtifact, gateBinding, passingVerification, sha, write } from './s7-launch-operator-test-artifacts.mjs';
function setup(sourceVersion = 0) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-launch-'));
    roots.push(root);
    const roaming = path.join(root, 'Roaming');
    const userData = path.join(roaming, '@amazon-ai-ops', 'desktop');
    const db = path.join(userData, 'amazon-ai-ops.db');
    write(db, 'v0-db');
    const exe = path.join(root, 'package', 'AmazonAIOpsAgent.exe');
    const main = path.join(root, 'package', 'resources', 'app', 'dist', 'main', 'index.js');
    const app = path.dirname(path.dirname(path.dirname(main)));
    write(exe, 'exe');
    write(main, 'main');
    const identity = {
        exe: fileArtifact(exe, 'fixture executable'),
        appContent: {
            path: app,
            realPath: fs.realpathSync.native(app),
            sha256: sha('app'),
            fileCount: 1,
            sizeBytes: 4,
        },
        main: fileArtifact(main, 'fixture Main'),
    };
    const trustedShellIdentity = {
        realPath: identity.exe.realPath,
        sha256: identity.exe.sha256,
        sizeBytes: identity.exe.sizeBytes,
        identity: {
            deviceId: String(identity.exe.identity.dev),
            fileId: String(identity.exe.identity.ino),
            hardLinkCount: 1,
        },
        hardlinkPaths: [identity.exe.realPath],
        signature: {
            status: 'Valid',
            subject: 'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond',
            thumbprint: sha('synthetic-shell-thumbprint'),
        },
        version: {
            companyName: 'Microsoft Corporation',
            fileVersion: '10.0.0.0',
            originalFilename: 'PowerShell.EXE',
            productName: 'Microsoft Windows',
        },
    };
    const evidence = path.join(root, 'evidence');
    const approvalOutputRoot = path.join(root, 'approval-output');
    const launchOutputRoot = path.join(root, 'launch-output');
    const acceptanceOutputRoot = path.join(root, 'acceptance-output');
    const finalizationOutputRoot = path.join(root, 'finalization-output');
    fs.mkdirSync(approvalOutputRoot);
    fs.mkdirSync(launchOutputRoot);
    fs.mkdirSync(acceptanceOutputRoot);
    fs.mkdirSync(finalizationOutputRoot);
    const manifest = path.join(evidence, 'offline.json');
    const selection = path.join(evidence, 'selection.json');
    const verification = path.join(evidence, 'verification.json');
    const ui = path.join(evidence, 'package-ui.json');
    const dbStat = fs.statSync(db);
    const dbRecord = {
        path: fs.realpathSync.native(db),
        sha256: sha('v0-db'),
        sizeBytes: dbStat.size,
        mtimeMs: dbStat.mtimeMs,
    };
    const selectionValue = {
        kind: 'production-authority-selection-preflight',
        schemaVersion: 'production-authority-selection-preflight/v1',
        generatedAt: '2026-07-29T00:10:00.000Z',
        status: 'SELECTED_MIGRATION_REQUIRED',
        formalEvidence: false,
        authorityDatabaseMutated: false,
        adsExecutionInvoked: false,
        selection: {
            expectedUserDataDir: fs.realpathSync.native(userData),
            expectedDatabasePath: fs.realpathSync.native(db),
            storesRoot: path.join(fs.realpathSync.native(userData), 'stores'),
            storesRootExists: false,
            expectedMainSha256: sha('v0-db'),
            defaultCandidateCount: 2,
            existingCandidateCount: 1,
            selected: {
                role: 'selected',
                absolutePath: fs.realpathSync.native(db),
                realPath: fs.realpathSync.native(db),
                offlineMigrationEligible: true,
                mainFile: { ...dbRecord },
                mainFileSha256: sha('v0-db'),
                logicalBackupSha256: sha('logical-v0'),
                sidecars: {
                    wal: { exists: false },
                    shm: { exists: false },
                    journal: { exists: false },
                },
                sqlite: { state: 'MIGRATION_REQUIRED', appliedVersion: sourceVersion },
            },
            nonAuthority: [],
        },
    };
    write(selection, selectionValue);
    write(manifest, {
        kind: 's7-offline-db-upgrade',
        schemaVersion: 1,
        generatedAt: '2026-07-29T00:20:00.000Z',
        passed: true,
        targetVersion: TARGET_VERSION,
        source: {
            path: fs.realpathSync.native(db),
            sha256: sha('v0-db'),
            version: sourceVersion,
        },
    });
    const verificationValue = passingVerification(manifest);
    write(verification, verificationValue);
    const uiValue = {
        kind: 'package-ui-evidence',
        schemaVersion: 9,
        generatedAt: '2026-07-29T00:00:00.000Z',
        completedAt: '2026-07-29T00:05:00.000Z',
        passed: true,
        requested: {
            executablePath: exe,
            expectedExeSha256: identity.exe.sha256,
            appContentPath: app,
            expectedAppContentSha256: identity.appContent.sha256,
        },
        artifactsBefore: {
            exe: { sha256: identity.exe.sha256 },
            appContent: { sha256: identity.appContent.sha256 },
        },
        artifactsAfter: {
            exe: { sha256: identity.exe.sha256 },
            appContent: { sha256: identity.appContent.sha256 },
        },
        artifactHashesStable: true,
        protectedDatabase: {
            before: dbRecord,
            after: dbRecord,
            passed: true,
            unchanged: true,
        },
        runGroup: { runGroupId: 'synthetic-v8' },
    };
    write(ui, uiValue);
    let schema = sourceVersion;
    let spawns = 0;
    let detachCalls = 0;
    let abortCalls = 0;
    let packageIdentityCalls = 0;
    let exclusiveCalls = 0;
    let targetEnvironment = null;
    let startupGatePlan = null;
    let startupGateArtifacts = null;
    let suspendedCreated = false;
    let resumed = false;
    let closed = false;
    const launchObservationOrder = [];
    const protocol = 's7-live-migration-exclusive-window/v1';
    const helperPid = 7001;
    const packagePid = 8123;
    const openedAt = '2026-07-29T01:00:01.000Z';
    const createdAt = '2026-07-29T01:00:02.000Z';
    const finalSameNameInventoryAt = '2026-07-29T01:00:02.500Z';
    const resumedAt = '2026-07-29T01:00:03.000Z';
    const releasedAt = '2026-07-29T01:00:04.000Z';
    const closedAt = '2026-07-29T01:00:05.000Z';
    const environmentSentinelKey = `S7_SENTINEL_${require('node:crypto')
        .randomUUID()
        .replace(/-/g, '_')}`;
    const context = {
        platform: 'win32',
        env: {
            APPDATA: 'C:\\untrusted',
            USERPROFILE: 'C:\\untrusted-profile',
            AMAZON_AI_OPS_EVIDENCE_MODE: 'package-ui',
            AMAZON_AI_OPS_USER_DATA_DIR: 'D:\\Temp\\untrusted',
            ELECTRON_RUN_AS_NODE: '1',
            ELECTRON_ENABLE_LOGGING: '1',
            amazon_ai_ops_user_data: 'D:\\wrong',
            NODE_OPTIONS: '--require bad.js',
            VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
            FINAL_READINESS_PATH: 'D:\\untrusted-ready.json',
            PORTABLE_EXECUTABLE_DIR: 'D:\\untrusted-portable',
            OPENAI_API_KEY: 'must-not-reach-child',
            LINGXING_PASSWORD: 'must-not-reach-child',
            CUSTOM_TOKEN: 'must-not-reach-child',
            AWS_SESSION_TOKEN: 'must-not-reach-child',
            BROWSER_COOKIE: 'must-not-reach-child',
            [environmentSentinelKey]: 'must-not-reach-child',
            SAFE_VALUE: 'kept',
            SystemRoot: 'C:\\Windows',
            ComSpec: 'C:\\Windows\\System32\\cmd.exe',
            PATH: 'C:\\Windows\\System32',
            PATHEXT: '.COM;.EXE;.BAT;.CMD',
            TEMP: path.join(root, 'temp'),
            TMP: path.join(root, 'temp'),
            LANG: 'en_US.UTF-8',
            COMPUTERNAME: 'SYNTHETIC-S7-HOST',
        },
        now: () => new Date('2026-07-29T01:00:00.000Z'),
        resolveRoamingAppData: () => roaming,
        resolveUserProfile: () => root,
        packageIdentity: () => {
            packageIdentityCalls += 1;
            return clone(identity);
        },
        trustedPowerShellIdentity: () => clone(trustedShellIdentity),
        readSchemaVersion: () => schema,
        inspectPostMigrationAuthority: () => clone(postMigrationAuthorityContract()),
        inspectAuthority: () => clone(selectionValue),
        verifyMigration: () => clone(verificationValue),
        evaluatePackageUiEvidence: () => ({ passed: true, violations: [] }),
        listProcesses: () => ({
            passed: true,
            matching: suspendedCreated && !closed
                ? [{
                        pid: packagePid,
                        parentPid: helperPid,
                        executablePath: identity.exe.realPath,
                    }]
                : [],
            unresolved: [],
        }),
        listSuspendedProcesses: () => context.listProcesses(),
        exclusiveDbPreflight: () => {
            exclusiveCalls += 1;
            return { method: 'windows-fileshare-none', passed: true };
        },
        inspectWindowsPathSecurity: (value, options = {}) => ({
            passed: true,
            path: fs.realpathSync.native(value),
            ownerSid: 'S-1-5-21-synthetic',
            currentUserSid: 'S-1-5-21-synthetic',
            inheritanceProtected: options.requireProtected === true,
            protectedInheritanceRequired: options.requireProtected === true,
            highRiskWritePrincipalCount: 0,
            rules: [],
        }),
        protectWindowsDirectory: (value) => fs.realpathSync.native(value),
        protectWindowsFile: (value) => fs.realpathSync.native(value),
        writeStdout: () => { },
        acquireLaunchExclusiveWindow: async (databasePath, executablePath, env) => {
            launchObservationOrder.push('ready');
            targetEnvironment = env;
            return {
                helperPid,
                synthetic: true,
                proof: {
                    protocol,
                    status: 'READY',
                    helperPid,
                    path: databasePath,
                    sha256: sha('v0-db'),
                    sizeBytes: fs.statSync(db).size,
                    openedAt,
                    databaseHandleExclusive: true,
                },
                executablePath,
            };
        },
        createSuspendedPackage: async (_windowHandle, _timeoutMs, gatePlan) => {
            spawns += 1;
            expect(fs.readdirSync(path.join(userData, '.s7-live-migration-launch-intents'))).toHaveLength(1);
            launchObservationOrder.push('intent-before-suspended-create');
            startupGatePlan = clone(gatePlan);
            write(startupGatePlan.activePath, startupGatePlan.activeDocument);
            const active = gateArtifact(startupGatePlan.activePath);
            write(startupGatePlan.boundPath, {
                kind: 's7-main-startup-gate-bound',
                schemaVersion: 's7-main-startup-gate-bound/v2',
                status: 'BOUND_SUSPENDED',
                gateId: startupGatePlan.gateId,
                invocationId: startupGatePlan.invocationId,
                boundAt: createdAt,
                pid: packagePid,
                threadId: 9001,
                activeGate: gateBinding(active),
                bindings: startupGatePlan.activeDocument.bindings,
            });
            const bound = gateArtifact(startupGatePlan.boundPath);
            startupGateArtifacts = { active, bound };
            suspendedCreated = true;
            launchObservationOrder.push('pid-image-verified');
            return {
                protocol,
                status: 'SPAWNED',
                helperPid,
                pid: packagePid,
                threadId: 9001,
                executablePath: identity.exe.realPath,
                queriedExecutablePath: identity.exe.realPath,
                processImageQueryPassed: true,
                createdSuspended: true,
                databaseHandleExclusive: true,
                createdAt,
                startupGateId: startupGatePlan.gateId,
                startupGateInvocationId: startupGatePlan.invocationId,
                startupGateActivePath: active.realPath,
                startupGateActiveSha256: active.sha256,
                startupGateActiveDeviceId: active.identity.deviceId,
                startupGateActiveFileId: active.identity.fileId,
                startupGateBoundPath: bound.realPath,
                startupGateBoundSha256: bound.sha256,
                startupGateBoundDeviceId: bound.identity.deviceId,
                startupGateBoundFileId: bound.identity.fileId,
                startupGateHandoffReadyPath: startupGatePlan.handoffReadyPath,
                startupGateHandoffReleasedPath: startupGatePlan.handoffReleasedPath,
                startupGateAdmissionPath: startupGatePlan.admissionPath,
                startupGateClosedPath: startupGatePlan.closedPath,
                startupGateFinalizedPath: startupGatePlan.finalizedPath,
                trustedShellPath: trustedShellIdentity.realPath,
                trustedShellSha256: trustedShellIdentity.sha256,
                trustedShellDeviceId: trustedShellIdentity.identity.deviceId,
                trustedShellFileId: trustedShellIdentity.identity.fileId,
                trustedShellHardLinkCount: trustedShellIdentity.identity.hardLinkCount,
                startupGateWindowsSecurityPassed: true,
            };
        },
        releaseAndResumePackage: async () => {
            launchObservationOrder.push('released-and-resumed');
            resumed = true;
            write(startupGatePlan.handoffReadyPath, {
                kind: 's7-main-startup-handoff-ready',
                schemaVersion: 's7-main-startup-handoff-ready/v1',
                status: 'READY_FOR_DB_HANDOFF',
                readyAt: resumedAt,
                pid: packagePid,
                gateId: startupGatePlan.gateId,
                invocationId: startupGatePlan.invocationId,
                singleInstanceLockAcquired: true,
                canonicalUserDataDir: startupGatePlan.activeDocument.canonicalUserDataDir,
                activeGate: gateBinding(startupGateArtifacts.active),
                boundGate: gateBinding(startupGateArtifacts.bound),
                executable: startupGatePlan.activeDocument.bindings.executable,
                main: startupGatePlan.activeDocument.bindings.package.main,
                intent: startupGatePlan.activeDocument.bindings.intent,
                package: startupGatePlan.activeDocument.bindings.package,
                shell: startupGatePlan.activeDocument.bindings.shell,
            });
            const handoffReady = gateArtifact(startupGatePlan.handoffReadyPath);
            write(startupGatePlan.handoffReleasedPath, {
                kind: 's7-main-startup-handoff-released',
                schemaVersion: 's7-main-startup-handoff-released/v1',
                status: 'DB_HANDLE_RELEASED',
                releasedAt,
                helperPid,
                pid: packagePid,
                gateId: startupGatePlan.gateId,
                invocationId: startupGatePlan.invocationId,
                activeGate: gateBinding(startupGateArtifacts.active),
                boundGate: gateBinding(startupGateArtifacts.bound),
                handoffReady: gateBinding(handoffReady),
                database: startupGatePlan.activeDocument.bindings.database,
                shell: startupGatePlan.activeDocument.bindings.shell,
            });
            const handoffReleased = gateArtifact(startupGatePlan.handoffReleasedPath);
            startupGateArtifacts = {
                ...startupGateArtifacts,
                handoffReady,
                handoffReleased,
            };
            return {
                protocol,
                status: 'RESUMED',
                helperPid,
                pid: packagePid,
                finalSameNameInventoryPassed: true,
                finalSameNameProcessCount: 1,
                finalSameNameInventoryAt,
                finalQueriedExecutablePath: identity.exe.realPath,
                finalProcessImageQueryPassed: true,
                releasedAt,
                resumedAt,
                databaseHandleExclusive: false,
                resumeResult: 1,
                startupGateId: startupGatePlan.gateId,
                startupGateInvocationId: startupGatePlan.invocationId,
                startupGateActiveSha256: startupGateArtifacts.active.sha256,
                startupGateBoundSha256: startupGateArtifacts.bound.sha256,
                startupGateHandoffReadyPath: handoffReady.realPath,
                startupGateHandoffReadySha256: handoffReady.sha256,
                startupGateHandoffReadyDeviceId: handoffReady.identity.deviceId,
                startupGateHandoffReadyFileId: handoffReady.identity.fileId,
                startupGateHandoffReleasedPath: handoffReleased.realPath,
                startupGateHandoffReleasedSha256: handoffReleased.sha256,
                startupGateHandoffReleasedDeviceId: handoffReleased.identity.deviceId,
                startupGateHandoffReleasedFileId: handoffReleased.identity.fileId,
                trustedShellSha256: trustedShellIdentity.sha256,
            };
        },
        waitForManagedPackageClose: async () => {
            launchObservationOrder.push('close-monitor');
            write(startupGatePlan.admissionPath, {
                kind: 's7-main-startup-admission',
                schemaVersion: 's7-main-startup-admission/v2',
                status: 'ADMITTED_UNDER_EXCLUSIVE_SQLITE_LOCK',
                admittedAt: '2026-07-29T01:00:04.500Z',
                pid: packagePid,
                gateId: startupGatePlan.gateId,
                invocationId: startupGatePlan.invocationId,
                singleInstanceLockAcquired: true,
                canonicalUserDataDir: startupGatePlan.activeDocument.canonicalUserDataDir,
                activeGate: gateBinding(startupGateArtifacts.active),
                boundGate: gateBinding(startupGateArtifacts.bound),
                handoffReady: gateBinding(startupGateArtifacts.handoffReady),
                handoffReleased: gateBinding(startupGateArtifacts.handoffReleased),
                executable: startupGatePlan.activeDocument.bindings.executable,
                main: startupGatePlan.activeDocument.bindings.package.main,
                database: startupGatePlan.activeDocument.bindings.database,
                intent: startupGatePlan.activeDocument.bindings.intent,
                package: startupGatePlan.activeDocument.bindings.package,
                shell: startupGatePlan.activeDocument.bindings.shell,
                sqliteTakeover: {
                    connectionPath: db,
                    fileMustExist: true,
                    busyTimeoutMs: 0,
                    lockingMode: 'exclusive',
                    beginMode: 'exclusive',
                    transactionActive: true,
                    sameConnectionRequiredForMigration: true,
                    schemaVersionBefore: sourceVersion,
                },
            });
            const admission = gateArtifact(startupGatePlan.admissionPath);
            write(startupGatePlan.closedPath, {
                kind: 's7-main-startup-gate-closed',
                schemaVersion: 's7-main-startup-gate-closed/v2',
                status: 'CLOSED_AFTER_GUARDED_MIGRATION',
                closedAt,
                helperPid,
                pid: packagePid,
                exitCode: 0,
                gateId: startupGatePlan.gateId,
                invocationId: startupGatePlan.invocationId,
                activeGate: gateBinding(startupGateArtifacts.active),
                boundGate: gateBinding(startupGateArtifacts.bound),
                handoffReady: gateBinding(startupGateArtifacts.handoffReady),
                handoffReleased: gateBinding(startupGateArtifacts.handoffReleased),
                admission: gateBinding(admission),
                databaseAfterClose: gateBinding(gateArtifact(db)),
                shell: startupGatePlan.activeDocument.bindings.shell,
            });
            const gateClosed = gateArtifact(startupGatePlan.closedPath);
            schema = TARGET_VERSION;
            closed = true;
            return {
                outcome: 'close',
                code: 0,
                signal: null,
                closedAt,
                proof: {
                    protocol,
                    status: 'CLOSED',
                    helperPid,
                    pid: packagePid,
                    exitCode: 0,
                    signal: null,
                    closedAt,
                    databaseHandleExclusive: false,
                    startupGateId: startupGatePlan.gateId,
                    startupGateInvocationId: startupGatePlan.invocationId,
                    startupGateActivePath: startupGateArtifacts.active.realPath,
                    startupGateActiveSha256: startupGateArtifacts.active.sha256,
                    startupGateActiveDeviceId: startupGateArtifacts.active.identity.deviceId,
                    startupGateActiveFileId: startupGateArtifacts.active.identity.fileId,
                    startupGateBoundPath: startupGateArtifacts.bound.realPath,
                    startupGateBoundSha256: startupGateArtifacts.bound.sha256,
                    startupGateBoundDeviceId: startupGateArtifacts.bound.identity.deviceId,
                    startupGateBoundFileId: startupGateArtifacts.bound.identity.fileId,
                    startupGateHandoffReadyPath: startupGateArtifacts.handoffReady.realPath,
                    startupGateHandoffReadySha256: startupGateArtifacts.handoffReady.sha256,
                    startupGateHandoffReadyDeviceId: startupGateArtifacts.handoffReady.identity.deviceId,
                    startupGateHandoffReadyFileId: startupGateArtifacts.handoffReady.identity.fileId,
                    startupGateHandoffReleasedPath: startupGateArtifacts.handoffReleased.realPath,
                    startupGateHandoffReleasedSha256: startupGateArtifacts.handoffReleased.sha256,
                    startupGateHandoffReleasedDeviceId: startupGateArtifacts.handoffReleased.identity.deviceId,
                    startupGateHandoffReleasedFileId: startupGateArtifacts.handoffReleased.identity.fileId,
                    startupGateAdmissionPath: admission.realPath,
                    startupGateAdmissionSha256: admission.sha256,
                    startupGateAdmissionDeviceId: admission.identity.deviceId,
                    startupGateAdmissionFileId: admission.identity.fileId,
                    startupGateClosedPath: gateClosed.realPath,
                    startupGateClosedSha256: gateClosed.sha256,
                    startupGateClosedDeviceId: gateClosed.identity.deviceId,
                    startupGateClosedFileId: gateClosed.identity.fileId,
                    startupGateAdmissionVerified: true,
                    databaseAfterCloseSha256: gateArtifact(db).sha256,
                    trustedShellSha256: trustedShellIdentity.sha256,
                    startupGateWindowsSecurityPassed: true,
                },
                helperClose: { outcome: 'close', code: 0, signal: null },
            };
        },
        detachManagedLaunch: () => {
            detachCalls += 1;
            return {
                detachedFromOperator: true,
                helperInputState: 'CLOSE_REQUESTED',
                helperInputCloseError: null,
                helperProcessUnrefRequested: true,
                helperStdinUnrefRequested: true,
                helperStdoutUnrefRequested: true,
                processKillInvoked: false,
                helperPid,
            };
        },
        abortUnlaunchedExclusiveWindow: () => {
            abortCalls += 1;
            return {
                helperInputState: 'CLOSE_REQUESTED',
                helperInputCloseError: null,
                helperProcessUnrefRequested: true,
                helperStdinUnrefRequested: true,
                helperStdoutUnrefRequested: true,
                processKillInvoked: false,
                packageProcessCreated: false,
            };
        },
    };
    return {
        root,
        roaming,
        userData,
        db,
        exe,
        manifest,
        selection,
        verification,
        ui,
        approvalOutputRoot,
        launchOutputRoot,
        acceptanceOutputRoot,
        finalizationOutputRoot,
        identity,
        selectionValue,
        verificationValue,
        uiValue,
        context,
        getSpawns: () => spawns,
        getDetachCalls: () => detachCalls,
        getAbortCalls: () => abortCalls,
        getPackageIdentityCalls: () => packageIdentityCalls,
        getExclusiveCalls: () => exclusiveCalls,
        getTargetEnvironment: () => targetEnvironment,
        getStartupGatePlan: () => startupGatePlan,
        getStartupGateArtifacts: () => startupGateArtifacts,
        environmentSentinelKey,
        getLaunchObservationOrder: () => [...launchObservationOrder],
        getManagedState: () => ({ suspendedCreated, resumed, closed }),
        getProtocolFixture: () => ({
            protocol,
            helperPid,
            packagePid,
            openedAt,
            createdAt,
            finalSameNameInventoryAt,
            releasedAt,
            resumedAt,
            closedAt,
        }),
        setSchema: (value) => {
            schema = value;
        },
        setManagedClosed: (value) => {
            closed = value;
        },
    };
}
export { setup };
