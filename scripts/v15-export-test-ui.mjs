// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { EMPTY_SCHEDULER_COUNTS, EXPECTED_OVERLAY_CHECK_IDS, EXPECTED_PACKAGE_UI_ENTRIES, EXPECTED_PACKAGE_UI_SCALES, EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS, INTERACTIVE_LOGIN_CONTRACT, ISOLATED_PROFILE_BOOTSTRAP_CONTRACT, PACKAGE_UI_PROFILE_SEQUENCE, PACKAGE_UI_USER_DATA_DIR, PACKAGE_UI_WIDE_PROFILE, SCHEDULER_CONTEXT, bindPackageUiTestManifest, fs, packageUiEvidence, path, validPackageUiMinimumWindow, validPackageUiWorkspaceCheck } from './v15-export-test-environment.mjs';
import { hashBoundFile, writeJson, writePng, writeText } from './v15-export-test-artifacts.mjs';
function validPackageUiDatabaseMutationAudit() {
    const metrics = {
        digestSha256: 'D'.repeat(64),
        serializedBytes: 18000000,
        totalChanges: 12,
        dataVersion: 1,
        pageCount: 4500,
        pageSize: 4096,
        schemaVersion: 9,
        userVersion: 9,
    };
    const checkpoints = [
        {
            sequence: 1,
            phase: 'post-bootstrap',
            capturedAt: '2026-07-23T01:00:00.600Z',
            contextDigestSha256: 'E'.repeat(64),
            metrics: { ...metrics },
        },
        {
            sequence: 2,
            phase: 'post-navigation',
            capturedAt: '2026-07-23T01:00:00.900Z',
            contextDigestSha256: 'E'.repeat(64),
            metrics: { ...metrics },
        },
        {
            sequence: 3,
            phase: 'pre-close-terminal',
            capturedAt: '2026-07-23T01:00:00.990Z',
            contextDigestSha256: 'E'.repeat(64),
            metrics: { ...metrics },
        },
    ];
    return {
        kind: 'package-ui-database-mutation-audit',
        schemaVersion: 1,
        requiredPhases: ['post-bootstrap', 'post-navigation', 'pre-close-terminal'],
        checkpoints,
        comparisons: {
            contextDigestMatched: true,
            digestMatched: true,
            serializedBytesMatched: true,
            totalChangesMatched: true,
            dataVersionMatched: true,
            pageCountMatched: true,
            pageSizeMatched: true,
            schemaVersionMatched: true,
            userVersionMatched: true,
        },
        passed: true,
    };
}

function schedulerAuditSnapshot(pid, { counts = {}, events = [] } = {}) {
    return {
        kind: 'package-ui-scheduler-audit',
        schemaVersion: 1,
        generatedAt: '2026-07-23T01:00:00.000Z',
        pid,
        evidenceMode: 'package-ui',
        userDataDir: PACKAGE_UI_USER_DATA_DIR,
        policies: { runNow: 'reject' },
        counts: { ...EMPTY_SCHEDULER_COUNTS, ...counts },
        suppressed: {
            automaticReconcile: 0,
            localSchedulerStart: 1,
            startupReconcile: 1,
            storeSchedulerStart: 1,
        },
        guards: {
            localSchedulerStarted: false,
            storeCollectionSchedulerStarted: false,
            runNowIpcDisabled: true,
            startupReconcileSuppressed: true,
            automaticReconcileSuppressed: true,
            readOnlyInvariantPassed: true,
        },
        databaseMutationAudit: validPackageUiDatabaseMutationAudit(),
        events,
    };
}

function schedulerIdentityEvidence(pid) {
    const expected = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0];
    const requestId = `renderer-bootstrap-${pid}-1`;
    const events = [
        {
            sequence: 1,
            at: '2026-07-23T01:00:00.100Z',
            source: 'mission-control:query',
            outcome: 'succeeded',
            context: SCHEDULER_CONTEXT,
            request: { query: 'workspace-bootstrap', requestId, contextEpoch: 1, context: SCHEDULER_CONTEXT },
            response: {
                query: 'workspace-bootstrap',
                requestId,
                contextEpoch: 1,
                authoritativeContext: SCHEDULER_CONTEXT,
                capabilities: expected.capabilities.map((capability) => ({
                    ...capability,
                    view: 'settings/scheduler',
                    workspace: 'settings',
                })),
            },
            errorCode: null,
        },
        {
            sequence: 2,
            at: '2026-07-23T01:00:00.200Z',
            source: 'store-collection-scheduler:get',
            outcome: 'succeeded',
            context: SCHEDULER_CONTEXT,
            request: { storeContext: SCHEDULER_CONTEXT },
            response: {
                storeId: SCHEDULER_CONTEXT.storeId,
                businessDate: SCHEDULER_CONTEXT.businessDate,
                enabled: true,
                state: 'waiting',
                detail: '等待当前店铺配置的采集时间。',
            },
            errorCode: null,
        },
        {
            sequence: 3,
            at: '2026-07-23T01:00:00.300Z',
            source: 'store-evidence-retention:preview',
            outcome: 'succeeded',
            context: SCHEDULER_CONTEXT,
            request: { storeContext: SCHEDULER_CONTEXT },
            response: {
                schemaVersion: 1,
                mode: 'dry-run',
                deletionSupported: false,
                applyable: false,
                storeId: SCHEDULER_CONTEXT.storeId,
                profileId: SCHEDULER_CONTEXT.browserProfileId,
                marketplace: 'US',
                currency: 'USD',
                candidateCount: 0,
                blockerCount: 0,
            },
            errorCode: null,
        },
    ];
    return {
        dom: {
            alertDialogCount: 0,
            busyControlCount: 0,
            confirmRunDialogCount: 0,
            fixedScopeText: 'US USD',
            fixedScopeTexts: ['US USD'],
            fixedScopeVisibleCount: 1,
            heading: expected.heading,
            headingCount: 1,
            legacyBoundaryCount: 1,
            legacyCapabilityState: 'LEGACY_ADAPTER',
            legacyRoute: 'scheduler',
            legacyStoreId: SCHEDULER_CONTEXT.storeId,
            pageCount: 1,
            previewMarkerCount: 0,
            loadingStateCount: 0,
            retentionPreviewCapabilityId: 'settings.scheduler.retention-preview',
            retentionPreviewControlCount: 1,
            retentionPreviewEnabledCount: 1,
            retentionBlockerCount: '0',
            retentionCandidateCount: '0',
            retentionCurrency: 'USD',
            retentionMarketplace: 'US',
            retentionProfileId: SCHEDULER_CONTEXT.browserProfileId,
            retentionStoreId: SCHEDULER_CONTEXT.storeId,
            retentionSummaryCount: 1,
            rootCount: 1,
            scheduleBusinessDate: SCHEDULER_CONTEXT.businessDate,
            scheduleCurrency: 'USD',
            scheduleEnabled: 'true',
            scheduleMarketplace: 'US',
            scheduleProjectionCount: 1,
            scheduleRefreshEnabledCount: 1,
            scheduleState: 'waiting',
            scheduleStoreId: SCHEDULER_CONTEXT.storeId,
            schedulerErrorCount: 0,
            selectedStoreId: SCHEDULER_CONTEXT.storeId,
            selectedTabCapabilityState: 'LEGACY_ADAPTER',
            selectedTabCount: 1,
            selectedTabId: expected.tabId,
            shellStoreId: SCHEDULER_CONTEXT.storeId,
            subview: expected.subview,
            workspace: expected.workspace,
        },
        ledgerBefore: schedulerAuditSnapshot(pid),
        ledgerAfter: schedulerAuditSnapshot(pid, {
            counts: { workspaceQuery: 1, schedulerGet: 1, retentionPreview: 1 },
            events,
        }),
    };
}

function packageUiReadOnlyRuntime(filePath, pid) {
    const marker = schedulerIdentityEvidence(pid).ledgerAfter;
    writeText(filePath, JSON.stringify(marker));
    return packageUiEvidence.validatePackageUiReadOnlyRuntimeEvidence({
        artifact: hashBoundFile(filePath),
        main: {
            evidenceMode: 'package-ui',
            pid,
            userDataDir: PACKAGE_UI_USER_DATA_DIR,
        },
        marker,
        processExitConfirmed: true,
    });
}

function validProcessSnapshot(extra = {}) {
    return {
        error: null,
        matching: [],
        matchingCount: 0,
        observedCount: 0,
        passed: true,
        unresolved: [],
        unresolvedCount: 0,
        ...extra,
    };
}

function validProcessIsolation() {
    return {
        before: validProcessSnapshot(),
        after: validProcessSnapshot({ attempts: 1 }),
        passed: true,
    };
}

function validPackageUiDiagnostics(profileId) {
    const connectionBootstrap = {
        completedAt: '2026-07-23T01:00:00.400Z',
        outcome: 'existing-lingxing-connection',
        startedAt: '2026-07-23T01:00:00.300Z',
    };
    const operatorHandoff = {
        automationReadSecrets: false,
        automationTypedSecrets: false,
        completedAt: '2026-07-23T01:00:00.450Z',
        durationClock: 'performance.now',
        elapsedMs: 250,
        finalPhase: 'authorization',
        kind: 'visible-user-handoff',
        maximumTotalTimeoutMs: 1200000,
        outcome: 'workspace-reached',
        phaseTimeoutMs: 600000,
        phaseTransitions: [
            { elapsedMs: 0, phase: 'preparation', startedAt: '2026-07-23T01:00:00.210Z' },
            { elapsedMs: 90, phase: 'authorization', startedAt: '2026-07-23T01:00:00.300Z' },
        ],
        startedAt: '2026-07-23T01:00:00.200Z',
    };
    const selectedStore = {
        displayName: null,
        idLength: 12,
        idSha256: 'A'.repeat(64),
    };
    return {
        cleanupErrors: [],
        completedAt: '2026-07-23T01:00:01.000Z',
        failure: null,
        login: {
            attempts: [],
            completedAt: '2026-07-23T01:00:00.500Z',
            connectionBootstrap,
            operatorHandoff,
            outcome: 'interactive-operator-login',
            savedCredentials: null,
            startedAt: '2026-07-23T01:00:00.100Z',
        },
        lifecycle: {
            droppedCount: 0,
            events: [
                { at: '2026-07-23T01:00:00.005Z', kind: 'window-attached', phase: 'electron-launch', runnerCloseRequested: false, windowId: 1 },
                { at: '2026-07-23T01:00:00.700Z', kind: 'runner-close-requested', phase: 'electron-close', runnerCloseRequested: true },
                { at: '2026-07-23T01:00:00.750Z', kind: 'window-closed', phase: 'electron-close', runnerCloseRequested: true, windowId: 1 },
                { at: '2026-07-23T01:00:00.800Z', kind: 'electron-context-closed', phase: 'electron-close', runnerCloseRequested: true },
                { at: '2026-07-23T01:00:00.850Z', kind: 'electron-app-closed', phase: 'electron-close', runnerCloseRequested: true },
                { at: '2026-07-23T01:00:00.900Z', code: 0, kind: 'electron-process-exit', phase: 'electron-close', runnerCloseRequested: true, signal: null },
            ],
            limit: 100,
            processExit: {
                at: '2026-07-23T01:00:00.900Z',
                code: 0,
                runnerCloseRequested: true,
                signal: null,
            },
            runnerCloseRequestedAt: '2026-07-23T01:00:00.700Z',
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
        startedAt: '2026-07-23T01:00:00.000Z',
        storeGate: {
            completedAt: '2026-07-23T01:00:00.050Z',
            createdEvidenceStore: false,
            currency: 'USD',
            marketplace: 'US',
            outcome: 'selected-existing-store',
            resultingSurface: 'login',
            selectedStore,
            startedAt: '2026-07-23T01:00:00.010Z',
        },
        timeline: [
            { at: '2026-07-23T01:00:00.000Z', phase: 'created' },
            { at: '2026-07-23T01:00:01.000Z', phase: 'completed' },
        ],
    };
}

function validPackageUiSession(profileId) {
    const diagnostics = validPackageUiDiagnostics(profileId);
    return {
        connectionBootstrap: { ...diagnostics.login.connectionBootstrap },
        loginSessionAttestation: {
            adsSessionReady: true,
            credentialPersistence: 'saved',
            credentialSource: 'typed',
            erpSessionReady: true,
            erpSessionReused: false,
            ok: true,
            sessionIdentityVerified: true,
        },
        mode: 'interactive-operator-login',
        operatorHandoff: { ...diagnostics.login.operatorHandoff },
        savedCredentialsLoginUsed: false,
        storeGate: {
            createdEvidenceStore: false,
            currency: 'USD',
            marketplace: 'US',
            outcome: 'selected-existing-store',
            selectedStore: { ...diagnostics.storeGate.selectedStore },
        },
        storeAuthorityReadback: {
            actualIdSha256: 'A'.repeat(64),
            currency: 'USD',
            expectedIdSha256: 'A'.repeat(64),
            marketplace: 'US',
            passed: true,
        },
    };
}

function validPackageUiLogicalArtifact() {
    return {
        method: 'readonly-sqlite-online-backup',
        remainingPages: 0,
        schemaVersion: 'sqlite-authority-currentness-proof/v1',
        sha256: 'A'.repeat(64),
        sizeBytes: 4096,
        totalPages: 1,
    };
}

function validPackageUiProfileLineageState() {
    return {
        capturedAt: '2026-07-23T01:00:01.100Z',
        logicalDatabase: validPackageUiLogicalArtifact(),
        profileContent: {
            fileCount: 10,
            sha256: 'B'.repeat(64),
            sizeBytes: 8192,
        },
    };
}

function validPackageUiAttemptArtifacts(runDir, profileId) {
    const attemptRoot = path.join(runDir, 'package-ui-attempts', profileId);
    writeText(path.join(attemptRoot, 'runtime-proof.txt'), `immutable-${profileId}`);
    return packageUiEvidence.buildPackageUiAttemptArtifactManifest(attemptRoot);
}

function validPackageUiChromiumLineage() {
    const profilePathBindingSha256 = 'A'.repeat(64);
    const profileBindingSha256 = packageUiEvidence.sha256Buffer(Buffer.from(JSON.stringify([profilePathBindingSha256]), 'utf8'));
    return {
        chromium: { sha256: 'C'.repeat(64), sizeBytes: 1234 },
        cleanup: validProcessSnapshot({ attempts: 1 }),
        descendantProcessIds: [902],
        expectedProfileRootSha256: 'B'.repeat(64),
        observedAt: '2026-07-23T01:00:00.600Z',
        passed: true,
        profileBindingSha256,
        profileBindingTokenCount: 1,
        rootProcessIds: [901],
        snapshot: validProcessSnapshot({
            expectedProfileRootSha256: 'B'.repeat(64),
            matching: [
                {
                    executablePath: 'D:\\App\\chrome.exe',
                    name: 'chrome.exe',
                    parentProcessId: 900,
                    processId: 901,
                    profileMatched: true,
                    profilePathBindingSha256,
                },
                {
                    executablePath: 'D:\\App\\chrome.exe',
                    name: 'chrome.exe',
                    parentProcessId: 901,
                    processId: 902,
                    profileMatched: false,
                    profilePathBindingSha256: null,
                },
            ],
            matchingCount: 2,
            observedCount: 2,
            profileBindingSha256,
            profileBindingTokenCount: 1,
            rootProcessIds: [901],
        }),
    };
}

function validPackageUiCheckpointComposition(runDir, runGroupId, runnerContractSha256) {
    const checkpointRecords = PACKAGE_UI_PROFILE_SEQUENCE.map((profileId, index) => {
        const payload = {
            kind: 'package-ui-profile-checkpoint',
            profileId,
            runGroupId,
            runnerContractSha256,
            schemaVersion: 'package-ui-profile-checkpoint/v1',
            sequence: index + 1,
        };
        const file = packageUiEvidence.writeImmutableEnvelope(path.join(runDir, 'package-ui-checkpoints', `${profileId}.json`), payload);
        const envelope = JSON.parse(fs.readFileSync(file.path, 'utf8'));
        return {
            file,
            payloadSha256: envelope.payloadSha256,
            profileId,
        };
    });
    return {
        checkpointRecords,
        finalProfileState: validPackageUiProfileLineageState(),
        packageLineage: { chromium: { sha256: 'C'.repeat(64) } },
        passed: true,
        runGroupId,
        runnerContractSha256,
    };
}

function writeValidPackageUiBundleManifest(manifestPath, runDir, extraScreenshot = null) {
    const runGroupId = `package-ui-${path.basename(runDir)}`;
    const runnerContract = packageUiEvidence.buildPackageUiRunnerContract();
    const checkpointComposition = validPackageUiCheckpointComposition(runDir, runGroupId, runnerContract.sha256);
    const runtimes = [100, 125, 'wide'].map((profile, index) => (packageUiReadOnlyRuntime(path.join(runDir, `${profile}-package-ui-scheduler-audit-v8.json`), 1000 + index)));
    writeJson(manifestPath, bindPackageUiTestManifest({
        kind: 'package-ui-evidence',
        schemaVersion: 9,
        generatedAt: '2026-07-23T01:00:00.000Z',
        interactiveLoginContract: INTERACTIVE_LOGIN_CONTRACT,
        isolatedProfileBootstrapContract: ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
        checkpointComposition,
        passed: true,
        requested: {
            allowInteractiveLogin: true,
            allowSavedLogin: false,
            interactiveLoginMaximumTotalMs: 1200000,
            interactiveLoginTimeoutMs: 600000,
            loginMode: 'interactive-operator-each-run',
            resumeRunGroupId: null,
            runGroupId,
        },
        runGroup: {
            profileSequence: PACKAGE_UI_PROFILE_SEQUENCE,
            runGroupId,
            runnerContractSha256: runnerContract.sha256,
        },
        artifactHashesStable: true,
        protectedDatabase: { passed: true },
        protectedDatabaseLogical: {
            after: validPackageUiLogicalArtifact(),
            before: validPackageUiLogicalArtifact(),
            passed: true,
        },
        profileDatabaseFileIsolation: { passed: true },
        profileDatabaseProvenance: { passed: true },
        profileLineage: {
            final: structuredClone(checkpointComposition.finalProfileState),
            passed: true,
        },
        packageProcessIsolation: validProcessIsolation(),
        profileProcessIsolation: validProcessIsolation(),
        runs: EXPECTED_PACKAGE_UI_SCALES.map((scale, index) => ({
            actualDeviceScaleFactor: scale.deviceScaleFactor,
            attemptArtifacts: validPackageUiAttemptArtifacts(runDir, `${scale.scalePercent}-compact`),
            chromiumProcessLineage: validPackageUiChromiumLineage(),
            consoleErrors: [],
            diagnostics: validPackageUiDiagnostics(`${scale.scalePercent}-compact`),
            identity: { passed: true },
            pageErrors: [],
            packageProcessIsolation: validProcessIsolation(),
            profileProcessIsolation: validProcessIsolation(),
            passed: true,
            databaseAuditCheckpoints: {
                postBootstrap: runtimes[index].marker.databaseMutationAudit.checkpoints[0],
                postNavigation: runtimes[index].marker.databaseMutationAudit.checkpoints[1],
            },
            session: validPackageUiSession(`${scale.scalePercent}-compact`),
            viewport: { width: 1366, height: 768 },
            scalePercent: scale.scalePercent,
            schedulerReadOnlyRuntime: runtimes[index],
            minimumWindow: scale.scalePercent === 100 ? validPackageUiMinimumWindow(runDir) : null,
            screenshots: EXPECTED_PACKAGE_UI_ENTRIES.map((workspace, workspaceIndex) => {
                const screenshotPath = index === 0 && workspaceIndex === 0 && extraScreenshot
                    ? extraScreenshot
                    : writePng(path.join(runDir, `${scale.scalePercent}-${workspace.workspace}-${workspace.subview}.png`));
                return {
                    ...hashBoundFile(screenshotPath),
                    workspace: workspace.workspace,
                    subview: workspace.subview,
                };
            }),
            workspaceChecks: EXPECTED_PACKAGE_UI_ENTRIES.map((workspace) => ({
                ...workspace,
                compositeEvidence: { passed: true },
                ...validPackageUiWorkspaceCheck(workspace),
                passed: true,
                settleEvidence: { passed: true },
            })),
            overlayChecks: EXPECTED_OVERLAY_CHECK_IDS.map((id) => ({
                id,
                passed: true,
                compositeEvidence: { passed: true },
                overlayVisibleBeforeCapture: true,
                overlayVisibleAfterCapture: true,
                screenshot: hashBoundFile(writePng(path.join(runDir, `${scale.scalePercent}-${id}.png`))),
            })),
            subviewChecks: [{
                    ...EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0],
                    compositeEvidence: { passed: true },
                    settleEvidence: { passed: true },
                    identityCapabilityEvidence: packageUiEvidence.validateSchedulerSubviewEvidence(schedulerIdentityEvidence(1000 + index)),
                    passed: true,
                    workspace: 'settings',
                    subview: 'scheduler',
                    screenshot: hashBoundFile(writePng(path.join(runDir, `${scale.scalePercent}-settings-scheduler-v7.png`))),
                }],
        })),
        wideProfile: {
            actualDeviceScaleFactor: 1,
            attemptArtifacts: validPackageUiAttemptArtifacts(runDir, PACKAGE_UI_WIDE_PROFILE.id),
            chromiumProcessLineage: validPackageUiChromiumLineage(),
            consoleErrors: [],
            diagnostics: validPackageUiDiagnostics(PACKAGE_UI_WIDE_PROFILE.id),
            identity: { passed: true },
            pageErrors: [],
            packageProcessIsolation: validProcessIsolation(),
            profileId: PACKAGE_UI_WIDE_PROFILE.id,
            profileProcessIsolation: validProcessIsolation(),
            passed: true,
            schedulerReadOnlyRuntime: runtimes[2],
            databaseAuditCheckpoints: {
                postBootstrap: runtimes[2].marker.databaseMutationAudit.checkpoints[0],
                postNavigation: runtimes[2].marker.databaseMutationAudit.checkpoints[1],
            },
            session: validPackageUiSession(PACKAGE_UI_WIDE_PROFILE.id),
            screenshots: PACKAGE_UI_WIDE_PROFILE.workspaces.map((workspace) => {
                const screenshotPath = writePng(path.join(runDir, `wide-${workspace.workspace}-${workspace.subview}.png`));
                return {
                    ...hashBoundFile(screenshotPath),
                    subview: workspace.subview,
                    workspace: workspace.workspace,
                };
            }),
            viewport: { width: 1400, height: 900 },
            workspaceChecks: PACKAGE_UI_WIDE_PROFILE.workspaces.map((workspace) => ({
                ...workspace,
                compositeEvidence: { passed: true },
                ...validPackageUiWorkspaceCheck(workspace, PACKAGE_UI_WIDE_PROFILE.viewport),
                passed: true,
                settleEvidence: { passed: true },
            })),
        },
    }, runDir));
}
export { validPackageUiDatabaseMutationAudit, schedulerAuditSnapshot, schedulerIdentityEvidence, packageUiReadOnlyRuntime, validProcessSnapshot, validProcessIsolation, validPackageUiDiagnostics, validPackageUiSession, validPackageUiLogicalArtifact, validPackageUiProfileLineageState, validPackageUiAttemptArtifacts, validPackageUiChromiumLineage, validPackageUiCheckpointComposition, writeValidPackageUiBundleManifest };
