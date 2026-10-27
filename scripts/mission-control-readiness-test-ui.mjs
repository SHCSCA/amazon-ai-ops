// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { EMPTY_SCHEDULER_COUNTS, EXPECTED_OVERLAY_CHECK_IDS, EXPECTED_PACKAGE_SECURITY_CHECK_CODES, EXPECTED_PACKAGE_UI_ENTRIES, EXPECTED_PACKAGE_UI_SCALES, EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS, HASH_A, HASH_B, HASH_C, INTERACTIVE_LOGIN_CONTRACT, ISOLATED_PROFILE_BOOTSTRAP_CONTRACT, PACKAGE_UI_PROFILE_SEQUENCE, PACKAGE_UI_USER_DATA_DIR, PACKAGE_UI_WIDE_PROFILE, SCHEDULER_CONTEXT, bindPackageUiTestManifest, buildAdversarialNodeEnvEvidence, buildPackageUiAttemptArtifactManifest, buildPackageUiRunnerContract, buildProcessIsolationEvidence, packageUiEvidence, path, validPackageUiMinimumWindow, validPackageUiWorkspaceCheck, writeImmutableEnvelope } from './mission-control-readiness-test-environment.mjs';
import { readJson, screenshotBytes, sha256Text, stableJson, writeArtifact } from './mission-control-readiness-test-artifacts.mjs';
function validProcessSnapshot(overrides = {}) {
    return {
        error: null,
        matching: [],
        matchingCount: 0,
        observedCount: 0,
        passed: true,
        unresolved: [],
        unresolvedCount: 0,
        ...overrides,
    };
}

function validProcessIsolation() {
    return buildProcessIsolationEvidence(validProcessSnapshot(), validProcessSnapshot({ attempts: 1 }));
}

function validLogicalArtifact() {
    return {
        method: 'readonly-sqlite-online-backup',
        remainingPages: 0,
        schemaVersion: 'sqlite-authority-currentness-proof/v1',
        sha256: HASH_A,
        sizeBytes: 4096,
        totalPages: 1,
    };
}

function validProfileLineageState() {
    return {
        capturedAt: '2026-07-23T01:00:01.100Z',
        logicalDatabase: validLogicalArtifact(),
        profileContent: {
            fileCount: 10,
            sha256: HASH_B,
            sizeBytes: 8192,
        },
    };
}

function validAttemptArtifacts(screenshotRoot, profileId) {
    const attemptRoot = path.join(screenshotRoot, profileId, 'attempt-artifacts');
    writeArtifact(path.join(attemptRoot, 'immutable-attempt.txt'), Buffer.from(`immutable-package-ui-attempt:${profileId}`, 'utf8'));
    return buildPackageUiAttemptArtifactManifest(attemptRoot);
}

function validChromiumLineage() {
    const profilePathBindingSha256 = HASH_A;
    const profileBindingSha256 = sha256Text(stableJson([profilePathBindingSha256])).toUpperCase();
    return {
        chromium: { sha256: HASH_A, sizeBytes: 1234 },
        cleanup: validProcessSnapshot({ attempts: 1 }),
        descendantProcessIds: [902],
        expectedProfileRootSha256: HASH_B,
        observedAt: '2026-07-23T01:00:00.600Z',
        passed: true,
        profileBindingSha256,
        profileBindingTokenCount: 1,
        rootProcessIds: [901],
        snapshot: validProcessSnapshot({
            expectedProfileRootSha256: HASH_B,
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

function validCheckpointComposition(screenshotRoot, runGroupId, runnerContractSha256) {
    const checkpointRoot = path.join(screenshotRoot, 'checkpoints');
    const checkpointRecords = PACKAGE_UI_PROFILE_SEQUENCE.map((profileId, index) => {
        const payload = {
            kind: 'package-ui-profile-checkpoint',
            profileId,
            runGroupId,
            runnerContractSha256,
            schemaVersion: 'package-ui-profile-checkpoint/v1',
            sequence: index + 1,
        };
        const file = writeImmutableEnvelope(path.join(checkpointRoot, `${profileId}.json`), payload);
        const envelope = readJson(file.path);
        return {
            file,
            payloadSha256: envelope.payloadSha256,
            profileId,
        };
    });
    return {
        checkpointRecords,
        finalProfileState: validProfileLineageState(),
        packageLineage: { chromium: { sha256: HASH_A } },
        passed: true,
        runGroupId,
        runnerContractSha256,
    };
}

function validOperatorHandoff() {
    return {
        automationReadSecrets: false,
        automationTypedSecrets: false,
        completedAt: '2026-07-23T01:00:00.450Z',
        durationClock: 'performance.now',
        elapsedMs: 300,
        finalPhase: 'authorization',
        kind: 'visible-user-handoff',
        maximumTotalTimeoutMs: 1200000,
        outcome: 'workspace-reached',
        phaseTimeoutMs: 600000,
        phaseTransitions: [
            { elapsedMs: 0, phase: 'preparation', startedAt: '2026-07-23T01:00:00.160Z' },
            { elapsedMs: 140, phase: 'authorization', startedAt: '2026-07-23T01:00:00.300Z' },
        ],
        startedAt: '2026-07-23T01:00:00.150Z',
    };
}

function validDiagnostics(profileId) {
    const connectionBootstrap = {
        completedAt: '2026-07-23T01:00:00.400Z',
        outcome: 'existing-lingxing-connection',
        startedAt: '2026-07-23T01:00:00.300Z',
    };
    const operatorHandoff = validOperatorHandoff();
    const selectedStore = {
        displayName: null,
        idLength: 12,
        idSha256: HASH_A,
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

function validPackageUiSession(profileId, { firstRun = false } = {}) {
    const diagnostics = validDiagnostics(profileId);
    return {
        connectionBootstrap: { ...diagnostics.login.connectionBootstrap },
        loginSessionAttestation: {
            adsSessionReady: true,
            credentialPersistence: firstRun ? 'saved' : 'main_managed',
            credentialSource: firstRun ? 'typed' : 'saved',
            erpSessionReady: true,
            erpSessionReused: !firstRun,
            ok: true,
            sessionIdentityVerified: firstRun,
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
            actualIdSha256: HASH_A,
            currency: 'USD',
            expectedIdSha256: HASH_A,
            marketplace: 'US',
            passed: true,
        },
    };
}

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

function schedulerAuditSnapshot({ counts = {}, events = [] } = {}) {
    return {
        kind: 'package-ui-scheduler-audit',
        schemaVersion: 1,
        generatedAt: '2026-07-23T01:00:00.000Z',
        pid: 321,
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

function validSchedulerIdentityEvidence(scalePercent) {
    const schedulerSubview = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0];
    const requestId = `renderer-bootstrap-${scalePercent}-1`;
    const events = [
        {
            sequence: 1,
            at: '2026-07-23T01:00:00.100Z',
            source: 'mission-control:query',
            outcome: 'succeeded',
            context: SCHEDULER_CONTEXT,
            request: {
                query: 'workspace-bootstrap',
                requestId,
                contextEpoch: 1,
                context: SCHEDULER_CONTEXT,
            },
            response: {
                query: 'workspace-bootstrap',
                requestId,
                contextEpoch: 1,
                authoritativeContext: SCHEDULER_CONTEXT,
                capabilities: schedulerSubview.capabilities.map((capability) => ({
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
                businessDate: SCHEDULER_CONTEXT.businessDate,
                detail: '等待当前店铺配置的采集时间。',
                enabled: true,
                state: 'waiting',
                storeId: SCHEDULER_CONTEXT.storeId,
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
                applyable: false,
                blockerCount: 0,
                candidateCount: 0,
                currency: 'USD',
                deletionSupported: false,
                marketplace: 'US',
                mode: 'dry-run',
                profileId: SCHEDULER_CONTEXT.browserProfileId,
                schemaVersion: 1,
                storeId: SCHEDULER_CONTEXT.storeId,
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
            heading: schedulerSubview.heading,
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
            selectedTabId: schedulerSubview.tabId,
            shellStoreId: SCHEDULER_CONTEXT.storeId,
            subview: schedulerSubview.subview,
            workspace: schedulerSubview.workspace,
        },
        ledgerBefore: schedulerAuditSnapshot(),
        ledgerAfter: schedulerAuditSnapshot({
            counts: { workspaceQuery: 1, schedulerGet: 1, retentionPreview: 1 },
            events,
        }),
    };
}

function validPackageUiReadOnlyRuntime(filePath, profileId, marker = validSchedulerIdentityEvidence(profileId).ledgerAfter) {
    const artifactRecord = writeArtifact(filePath, Buffer.from(JSON.stringify(marker), 'utf8'));
    return packageUiEvidence.validatePackageUiReadOnlyRuntimeEvidence({
        artifact: artifactRecord,
        main: {
            evidenceMode: 'package-ui',
            pid: marker.pid,
            userDataDir: PACKAGE_UI_USER_DATA_DIR,
        },
        marker,
        processExitConfirmed: true,
        profileId,
    });
}

function validPackageUiRun(scale, screenshotRoot) {
    const schedulerSubview = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0];
    const firstRun = scale.scalePercent === EXPECTED_PACKAGE_UI_SCALES[0].scalePercent;
    const profileId = `${scale.scalePercent}-compact`;
    const schedulerIdentityCapabilityEvidence = packageUiEvidence.validateSchedulerSubviewEvidence(validSchedulerIdentityEvidence(scale.scalePercent));
    const schedulerReadOnlyRuntime = validPackageUiReadOnlyRuntime(path.join(screenshotRoot, `${scale.scalePercent}`, 'runtime', 'package-ui-scheduler-audit.json'), profileId, schedulerIdentityCapabilityEvidence.ledgerAfter);
    return {
        actualDeviceScaleFactor: scale.deviceScaleFactor,
        attemptArtifacts: validAttemptArtifacts(screenshotRoot, profileId),
        chromiumProcessLineage: validChromiumLineage(),
        consoleErrors: [],
        diagnostics: validDiagnostics(profileId),
        identity: { passed: true },
        overlayChecks: EXPECTED_OVERLAY_CHECK_IDS.map((id) => {
            const screenshot = writeArtifact(path.join(screenshotRoot, `${scale.scalePercent}`, 'overlays', `${id}.png`), screenshotBytes(`package-ui:${scale.scalePercent}:overlay:${id}`));
            return {
                compositeEvidence: { passed: true },
                id,
                overlayVisibleAfterCapture: true,
                overlayVisibleBeforeCapture: true,
                passed: true,
                screenshot,
            };
        }),
        packageProcessIsolation: validProcessIsolation(),
        pageErrors: [],
        passed: true,
        profileProcessIsolation: validProcessIsolation(),
        scalePercent: scale.scalePercent,
        schedulerReadOnlyRuntime,
        databaseAuditCheckpoints: {
            postBootstrap: schedulerReadOnlyRuntime.marker.databaseMutationAudit.checkpoints[0],
            postNavigation: schedulerReadOnlyRuntime.marker.databaseMutationAudit.checkpoints[1],
        },
        session: validPackageUiSession(profileId, { firstRun }),
        minimumWindow: scale.scalePercent === 100 ? validPackageUiMinimumWindow(screenshotRoot) : null,
        screenshots: EXPECTED_PACKAGE_UI_ENTRIES.map((workspace) => ({
            ...writeArtifact(path.join(screenshotRoot, `${scale.scalePercent}`, 'workspaces', `${workspace.workspace}.png`), screenshotBytes(`package-ui:${scale.scalePercent}:workspace:${workspace.workspace}`)),
            subview: workspace.subview,
            workspace: workspace.workspace,
        })),
        subviewChecks: [{
                ...schedulerSubview,
                compositeEvidence: { passed: true },
                identityCapabilityEvidence: schedulerIdentityCapabilityEvidence,
                passed: schedulerIdentityCapabilityEvidence.passed,
                screenshot: {
                    ...writeArtifact(path.join(screenshotRoot, `${scale.scalePercent}`, 'subviews', 'settings-scheduler.png'), screenshotBytes(`package-ui:${scale.scalePercent}:subview:settings/scheduler`)),
                    subview: schedulerSubview.subview,
                    workspace: schedulerSubview.workspace,
                },
                settleEvidence: { passed: true },
                violations: schedulerIdentityCapabilityEvidence.violations,
            }],
        viewport: { height: 768, width: 1366 },
        workspaceChecks: EXPECTED_PACKAGE_UI_ENTRIES.map((workspace) => ({
            compositeEvidence: { passed: true },
            experienceEvidence: null,
            inspectorEvidence: null,
            ...validPackageUiWorkspaceCheck(workspace),
            passed: true,
            settleEvidence: { passed: true },
            subview: workspace.subview,
            workspace: workspace.workspace,
        })),
    };
}

function validWideRun(screenshotRoot) {
    const profileId = PACKAGE_UI_WIDE_PROFILE.id;
    const schedulerReadOnlyRuntime = validPackageUiReadOnlyRuntime(path.join(screenshotRoot, 'wide', 'runtime', 'package-ui-scheduler-audit.json'), profileId);
    return {
        actualDeviceScaleFactor: 1,
        attemptArtifacts: validAttemptArtifacts(screenshotRoot, profileId),
        chromiumProcessLineage: validChromiumLineage(),
        consoleErrors: [],
        diagnostics: validDiagnostics(profileId),
        identity: { passed: true },
        packageProcessIsolation: validProcessIsolation(),
        pageErrors: [],
        passed: true,
        profileId,
        profileProcessIsolation: validProcessIsolation(),
        screenshots: PACKAGE_UI_WIDE_PROFILE.workspaces.map((workspace) => ({
            ...writeArtifact(path.join(screenshotRoot, 'wide', 'workspaces', `${workspace.workspace}.png`), screenshotBytes(`package-ui:wide:workspace:${workspace.workspace}`)),
            subview: workspace.subview,
            workspace: workspace.workspace,
        })),
        schedulerReadOnlyRuntime,
        databaseAuditCheckpoints: {
            postBootstrap: schedulerReadOnlyRuntime.marker.databaseMutationAudit.checkpoints[0],
            postNavigation: schedulerReadOnlyRuntime.marker.databaseMutationAudit.checkpoints[1],
        },
        session: validPackageUiSession(profileId),
        viewport: { height: 900, width: 1400 },
        workspaceChecks: PACKAGE_UI_WIDE_PROFILE.workspaces.map((workspace) => ({
            compositeEvidence: { passed: true },
            experienceEvidence: null,
            inspectorEvidence: null,
            ...validPackageUiWorkspaceCheck(workspace, PACKAGE_UI_WIDE_PROFILE.viewport),
            passed: true,
            settleEvidence: { passed: true },
            subview: workspace.subview,
            workspace: workspace.workspace,
        })),
    };
}

function validPackageUiManifest(packageIdentity, screenshotRoot) {
    const runGroupId = `package-ui-readiness-${path.basename(screenshotRoot)}`;
    const runnerContract = buildPackageUiRunnerContract();
    const checkpointComposition = validCheckpointComposition(screenshotRoot, runGroupId, runnerContract.sha256);
    return bindPackageUiTestManifest({
        kind: 'package-ui-evidence',
        schemaVersion: 9,
        generatedAt: '2026-07-23T01:00:00.000Z',
        interactiveLoginContract: INTERACTIVE_LOGIN_CONTRACT,
        isolatedProfileBootstrapContract: ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
        passed: true,
        artifactHashesStable: true,
        checkpointComposition,
        artifactsBefore: {
            exe: { sha256: packageIdentity.executableSha256 },
            appContent: { sha256: packageIdentity.appContentSha256 },
        },
        artifactsAfter: {
            exe: { sha256: packageIdentity.executableSha256 },
            appContent: { sha256: packageIdentity.appContentSha256 },
        },
        requested: {
            allowInteractiveLogin: true,
            allowSavedLogin: false,
            expectedExeSha256: packageIdentity.executableSha256,
            expectedAppContentSha256: packageIdentity.appContentSha256,
            interactiveLoginMaximumTotalMs: 1200000,
            interactiveLoginTimeoutMs: 600000,
            loginMode: 'interactive-operator-each-run',
            resumeRunGroupId: null,
            runGroupId,
            subviewChecks: EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
        },
        packageProcessIsolation: validProcessIsolation(),
        profileDatabaseFileIsolation: { passed: true },
        profileDatabaseProvenance: { passed: true },
        profileLineage: {
            final: structuredClone(checkpointComposition.finalProfileState),
            passed: true,
        },
        profileProcessIsolation: validProcessIsolation(),
        protectedDatabase: { passed: true },
        protectedDatabaseLogical: {
            after: validLogicalArtifact(),
            before: validLogicalArtifact(),
            passed: true,
        },
        runGroup: {
            profileSequence: PACKAGE_UI_PROFILE_SEQUENCE,
            runGroupId,
            runnerContractSha256: runnerContract.sha256,
        },
        runs: EXPECTED_PACKAGE_UI_SCALES.map((scale) => validPackageUiRun(scale, screenshotRoot)),
        wideProfile: validWideRun(screenshotRoot),
        violations: [],
    }, screenshotRoot);
}

function validSecurityEvidence(packageIdentity) {
    const checks = EXPECTED_PACKAGE_SECURITY_CHECK_CODES.map((code) => ({ code, passed: true }));
    return {
        kind: 'package-security-boundaries',
        schemaVersion: 1,
        generatedAt: '2026-07-23T01:01:00.000Z',
        passed: true,
        package: { ...packageIdentity },
        summary: { total: checks.length, passed: checks.length, failed: 0 },
        checks,
    };
}

function validAdversarialEvidence(packageIdentity) {
    return buildAdversarialNodeEnvEvidence({
        generatedAt: '2026-07-23T01:02:00.000Z',
        identityAfter: packageIdentity,
        identityBefore: packageIdentity,
        expected: { ...packageIdentity, rendererEntrySha256: HASH_C },
        processCleanup: { afterMatchingCount: 0, attempts: 1, beforeMatchingCount: 0, passed: true },
        runtime: {
            allDevToolsClosed: true,
            evidenceMode: 'package-launch-smoke',
            isPackaged: true,
            isolatedUserData: true,
            localhostDetected: false,
            nodeEnv: 'development',
            rendererEntrySha256: HASH_C,
            rendererExact: true,
            rendererScheme: 'file:',
            windowCount: 1,
        },
    });
}
export { validProcessSnapshot, validProcessIsolation, validLogicalArtifact, validProfileLineageState, validAttemptArtifacts, validChromiumLineage, validCheckpointComposition, validOperatorHandoff, validDiagnostics, validPackageUiSession, validPackageUiDatabaseMutationAudit, schedulerAuditSnapshot, validSchedulerIdentityEvidence, validPackageUiReadOnlyRuntime, validPackageUiRun, validWideRun, validPackageUiManifest, validSecurityEvidence, validAdversarialEvidence };
