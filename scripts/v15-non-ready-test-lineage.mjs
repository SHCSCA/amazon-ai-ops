// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { HASH_A, HASH_B, PACKAGE_UI_PROFILE_SEQUENCE, buildPackageUiAttemptArtifactManifest, fs, path, writeImmutableEnvelope } from './v15-non-ready-test-environment.mjs';
import { sha256Text, writePng } from './v15-non-ready-test-artifacts.mjs';
function validProcessIsolation(profilePath = null) {
    const snapshot = {
        error: null,
        matching: [],
        matchingCount: 0,
        observedCount: 0,
        passed: true,
        unresolved: [],
        unresolvedCount: 0,
        ...(profilePath ? { profilePath } : {}),
    };
    return {
        before: snapshot,
        after: { ...snapshot, attempts: 1 },
        passed: true,
    };
}

function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function validLogicalSqliteArtifact(sha256 = HASH_A, sizeBytes = 4096) {
    return {
        method: 'readonly-sqlite-online-backup',
        remainingPages: 0,
        schemaVersion: 'sqlite-authority-currentness-proof/v1',
        sha256,
        sizeBytes,
        totalPages: 1,
    };
}

function validProfileLineageState(logicalDatabase) {
    return {
        capturedAt: '2026-07-16T08:08:20.100Z',
        logicalDatabase: structuredClone(logicalDatabase),
        profileContent: {
            fileCount: 3,
            sha256: HASH_B,
            sizeBytes: 8192,
        },
    };
}

function validAttemptArtifacts(dir, profileId) {
    const attemptRoot = path.join(dir, 'package-ui-attempts', profileId);
    fs.mkdirSync(attemptRoot, { recursive: true });
    fs.writeFileSync(path.join(attemptRoot, `${profileId}-runtime.json`), `${JSON.stringify({ profileId, status: 'completed' })}\n`, 'utf8');
    writePng(path.join(attemptRoot, `${profileId}-workspace.png`));
    return buildPackageUiAttemptArtifactManifest(attemptRoot);
}

function validChromiumLineage(profileBrowserUserDataDir, chromiumArtifact) {
    const profilePathBindingSha256 = sha256Text(path.resolve(profileBrowserUserDataDir));
    const profileBindingSha256 = sha256Text(canonicalJson([profilePathBindingSha256]));
    const chromiumPath = path.join(path.dirname(path.dirname(profileBrowserUserDataDir)), 'release', 'win-unpacked', 'resources', 'app', 'playwright-browsers', 'chrome-win64', 'chrome.exe');
    return {
        chromium: {
            relativePath: 'playwright-browsers/chrome-win64/chrome.exe',
            sha256: chromiumArtifact.sha256,
            sizeBytes: chromiumArtifact.sizeBytes,
        },
        cleanup: {
            error: null,
            matching: [],
            matchingCount: 0,
            observedCount: 0,
            passed: true,
            unresolved: [],
            unresolvedCount: 0,
            attempts: 1,
        },
        descendantProcessIds: [902],
        expectedProfileRootSha256: HASH_B,
        observedAt: '2026-07-16T08:08:19.500Z',
        passed: true,
        profileBindingSha256,
        profileBindingTokenCount: 1,
        rootProcessIds: [901],
        snapshot: {
            error: null,
            expectedProfileRootSha256: HASH_B,
            matching: [
                {
                    executablePath: chromiumPath,
                    name: 'chrome.exe',
                    parentProcessId: 900,
                    processId: 901,
                    profileMatched: true,
                    profilePathBindingSha256,
                },
                {
                    executablePath: chromiumPath,
                    name: 'chrome.exe',
                    parentProcessId: 901,
                    processId: 902,
                    profileMatched: false,
                    profilePathBindingSha256: null,
                },
            ],
            matchingCount: 2,
            observedCount: 2,
            passed: true,
            profileBindingSha256,
            profileBindingTokenCount: 1,
            rootProcessIds: [901],
            unresolved: [],
            unresolvedCount: 0,
        },
    };
}

function validCheckpointComposition(dir, runGroupId, runnerContractSha256, finalProfileState, packageLineage) {
    const checkpointDir = path.join(dir, 'package-ui-checkpoints');
    const checkpointRecords = PACKAGE_UI_PROFILE_SEQUENCE.map((profileId, index) => {
        const payload = {
            kind: 'package-ui-profile-checkpoint',
            profileId,
            runGroupId,
            runnerContractSha256,
            schemaVersion: 'package-ui-profile-checkpoint/v1',
            sequence: index + 1,
        };
        const file = writeImmutableEnvelope(path.join(checkpointDir, `${profileId}.json`), payload);
        const envelope = JSON.parse(fs.readFileSync(file.path, 'utf8'));
        return {
            file,
            payloadSha256: envelope.payloadSha256,
            profileId,
        };
    });
    return {
        checkpointRecords,
        finalProfileState: structuredClone(finalProfileState),
        packageLineage: structuredClone(packageLineage),
        passed: true,
        runGroupId,
        runnerContractSha256,
    };
}

function validOperatorHandoff() {
    return {
        automationReadSecrets: false,
        automationTypedSecrets: false,
        completedAt: '2026-07-16T08:08:09.400Z',
        durationClock: 'performance.now',
        elapsedMs: 300,
        finalPhase: 'authorization',
        kind: 'visible-user-handoff',
        maximumTotalTimeoutMs: 1200000,
        outcome: 'workspace-reached',
        phaseTimeoutMs: 600000,
        phaseTransitions: [
            { elapsedMs: 0, phase: 'preparation', startedAt: '2026-07-16T08:08:09.110Z' },
            { elapsedMs: 90, phase: 'authorization', startedAt: '2026-07-16T08:08:09.200Z' },
        ],
        startedAt: '2026-07-16T08:08:09.100Z',
    };
}

function validInteractiveConnectionBootstrap() {
    const operatorHandoff = validOperatorHandoff();
    return {
        completedAt: operatorHandoff.completedAt,
        outcome: 'operator-established-lingxing-connection-and-session',
        startedAt: operatorHandoff.startedAt,
    };
}

function validRunDiagnostics(profileId) {
    const connectionBootstrap = validInteractiveConnectionBootstrap();
    const operatorHandoff = validOperatorHandoff();
    const selectedStore = {
        displayName: null,
        idLength: 12,
        idSha256: HASH_A,
    };
    return {
        cleanupErrors: [],
        completedAt: '2026-07-16T08:08:20.000Z',
        failure: null,
        login: {
            attempts: [],
            completedAt: '2026-07-16T08:08:10.000Z',
            connectionBootstrap,
            operatorHandoff,
            outcome: 'interactive-operator-login',
            savedCredentials: null,
            startedAt: '2026-07-16T08:08:09.000Z',
        },
        lifecycle: {
            droppedCount: 0,
            events: [
                { at: '2026-07-16T08:08:00.100Z', kind: 'window-attached', phase: 'electron-launch', runnerCloseRequested: false, windowId: 1 },
                { at: '2026-07-16T08:08:19.600Z', kind: 'runner-close-requested', phase: 'electron-close', runnerCloseRequested: true },
                { at: '2026-07-16T08:08:19.700Z', kind: 'window-closed', phase: 'electron-close', runnerCloseRequested: true, windowId: 1 },
                { at: '2026-07-16T08:08:19.750Z', kind: 'electron-context-closed', phase: 'electron-close', runnerCloseRequested: true },
                { at: '2026-07-16T08:08:19.800Z', kind: 'electron-app-closed', phase: 'electron-close', runnerCloseRequested: true },
                { at: '2026-07-16T08:08:19.900Z', code: 0, kind: 'electron-process-exit', phase: 'electron-close', runnerCloseRequested: true, signal: null },
            ],
            limit: 100,
            processExit: {
                at: '2026-07-16T08:08:19.900Z',
                code: 0,
                runnerCloseRequested: true,
                signal: null,
            },
            runnerCloseRequestedAt: '2026-07-16T08:08:19.600Z',
            unexpectedCloseObserved: false,
        },
        phase: 'completed',
        profileId,
        renderer: {
            consoleErrors: [],
            droppedCount: { consoleErrors: 0, pageErrors: 0 },
            limits: { consoleErrors: 100, pageErrors: 100 },
            pageErrors: [],
        },
        schemaVersion: 'package-ui-run-diagnostics/v2',
        startedAt: '2026-07-16T08:08:00.000Z',
        storeGate: {
            completedAt: '2026-07-16T08:08:08.900Z',
            createdEvidenceStore: false,
            currency: 'USD',
            marketplace: 'US',
            outcome: 'selected-existing-store',
            resultingSurface: 'login',
            selectedStore,
            startedAt: '2026-07-16T08:08:08.800Z',
        },
        timeline: [
            { at: '2026-07-16T08:08:00.000Z', phase: 'created' },
            { at: '2026-07-16T08:08:20.000Z', phase: 'completed' },
        ],
    };
}
export { validProcessIsolation, canonicalJson, validLogicalSqliteArtifact, validProfileLineageState, validAttemptArtifacts, validChromiumLineage, validCheckpointComposition, validOperatorHandoff, validInteractiveConnectionBootstrap, validRunDiagnostics };
