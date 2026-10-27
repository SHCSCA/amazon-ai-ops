// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { validPackageUiReadOnlyRuntime, validPackageUiSubviewCheck } from './v15-non-ready-test-scheduler.mjs';
import { validAttemptArtifacts, validCheckpointComposition, validChromiumLineage, validLogicalSqliteArtifact, validProcessIsolation, validProfileLineageState, validRunDiagnostics } from './v15-non-ready-test-lineage.mjs';
import { databaseCheckpointReceipts, validPackageUiSession } from './v15-non-ready-test-session.mjs';
import { EXPECTED_OVERLAY_CHECK_IDS, EXPECTED_PACKAGE_UI_ENTRIES, EXPECTED_PACKAGE_UI_SCALES, EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS, HASH_A, HASH_B, INTERACTIVE_LOGIN_CONTRACT, ISOLATED_PROFILE_BOOTSTRAP_CONTRACT, PACKAGE_MAIN_BUNDLE_SHA256, PACKAGE_UI_PROFILE_SEQUENCE, PACKAGE_UI_WIDE_PROFILE, bindPackageUiTestManifest, buildPackageUiRunnerContract, evaluatePackageUiEvidenceCompleteness, fs, path, validPackageUiMinimumWindow, validPackageUiWorkspaceCheck, writeImmutableEnvelope } from './v15-non-ready-test-environment.mjs';
import { artifactRecord, sha256File, writePng } from './v15-non-ready-test-artifacts.mjs';
function validPackageUiRun(dir, scale, userDataDir, profileBrowserUserDataDir, chromiumArtifact) {
    const profileId = `${scale.scalePercent}-compact`;
    const schedulerReadOnlyRuntime = validPackageUiReadOnlyRuntime(dir, profileId, userDataDir);
    return {
        actualDeviceScaleFactor: scale.deviceScaleFactor,
        attemptArtifacts: validAttemptArtifacts(dir, profileId),
        chromiumProcessLineage: validChromiumLineage(profileBrowserUserDataDir, chromiumArtifact),
        consoleErrors: [],
        databaseAuditCheckpoints: databaseCheckpointReceipts(schedulerReadOnlyRuntime),
        diagnostics: validRunDiagnostics(profileId),
        identity: { passed: true },
        overlayChecks: EXPECTED_OVERLAY_CHECK_IDS.map((id) => ({
            compositeEvidence: { passed: true },
            id,
            overlayVisibleAfterCapture: true,
            overlayVisibleBeforeCapture: true,
            passed: true,
            screenshot: artifactRecord(writePng(path.join(dir, 'package-ui-artifacts', `${profileId}-${id}.png`))),
        })),
        packageProcessIsolation: validProcessIsolation(),
        pageErrors: [],
        passed: true,
        profileProcessIsolation: validProcessIsolation(profileBrowserUserDataDir),
        scalePercent: scale.scalePercent,
        schedulerReadOnlyRuntime,
        minimumWindow: scale.scalePercent === 100 ? validPackageUiMinimumWindow(dir) : null,
        screenshots: EXPECTED_PACKAGE_UI_ENTRIES.map((workspace) => ({
            ...artifactRecord(writePng(path.join(dir, 'package-ui-artifacts', `${profileId}-${workspace.workspace}-${workspace.subview}.png`))),
            subview: workspace.subview,
            workspace: workspace.workspace,
        })),
        session: validPackageUiSession(profileId, {
            firstRun: scale.scalePercent === EXPECTED_PACKAGE_UI_SCALES[0].scalePercent,
        }),
        subviewChecks: [validPackageUiSubviewCheck(dir, scale, userDataDir)],
        viewport: { width: 1366, height: 768 },
        viewportContract: {
            actual: { width: 1366, height: 768, deviceScaleFactor: scale.deviceScaleFactor },
            delta: { width: 0, height: 0, deviceScaleFactor: 0 },
            passed: true,
            requested: { width: 1366, height: 768, deviceScaleFactor: scale.deviceScaleFactor },
            tolerance: { width: 2, height: 2, deviceScaleFactor: 0.02 },
            violations: [],
        },
        workspaceChecks: EXPECTED_PACKAGE_UI_ENTRIES.map((workspace) => {
            const objectWorkspace = workspace.workspace === 'product' || workspace.workspace === 'diagnosis';
            return {
                compositeEvidence: { passed: true },
                experienceEvidence: objectWorkspace ? { passed: true } : null,
                inspectorEvidence: objectWorkspace ? {
                    passed: true,
                    inspector: { mode: 'drawer', ariaModal: 'true' },
                    screenshot: { sha256: HASH_B },
                } : null,
                ...validPackageUiWorkspaceCheck(workspace),
                passed: true,
                settleEvidence: { passed: true },
                subview: workspace.subview,
                workspace: workspace.workspace,
            };
        }),
    };
}

function validWidePackageUiRun(dir, userDataDir, profileBrowserUserDataDir, chromiumArtifact) {
    const profileId = PACKAGE_UI_WIDE_PROFILE.id;
    const schedulerReadOnlyRuntime = validPackageUiReadOnlyRuntime(dir, profileId, userDataDir);
    return {
        actualDeviceScaleFactor: 1,
        attemptArtifacts: validAttemptArtifacts(dir, profileId),
        chromiumProcessLineage: validChromiumLineage(profileBrowserUserDataDir, chromiumArtifact),
        consoleErrors: [],
        databaseAuditCheckpoints: databaseCheckpointReceipts(schedulerReadOnlyRuntime),
        diagnostics: validRunDiagnostics(profileId),
        identity: { passed: true, violations: [] },
        packageProcessIsolation: validProcessIsolation(),
        pageErrors: [],
        passed: true,
        profileId,
        profileProcessIsolation: validProcessIsolation(profileBrowserUserDataDir),
        schedulerReadOnlyRuntime,
        screenshots: PACKAGE_UI_WIDE_PROFILE.workspaces.map((workspace) => ({
            ...artifactRecord(writePng(path.join(dir, 'package-ui-artifacts', `${profileId}-${workspace.workspace}-${workspace.subview}.png`))),
            subview: workspace.subview,
            workspace: workspace.workspace,
        })),
        session: validPackageUiSession(profileId),
        viewport: { width: 1400, height: 900 },
        viewportContract: {
            actual: { width: 1400, height: 900, deviceScaleFactor: 1 },
            delta: { width: 0, height: 0, deviceScaleFactor: 0 },
            passed: true,
            requested: { width: 1400, height: 900, deviceScaleFactor: 1 },
            tolerance: { width: 2, height: 2, deviceScaleFactor: 0.02 },
            violations: [],
        },
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

function validPackageUiEvidence(dir, smoke, authorityDbPath) {
    const protectedDbStat = fs.statSync(authorityDbPath);
    const protectedDatabaseSha256 = sha256File(authorityDbPath);
    const protectedDatabaseArtifact = {
        path: authorityDbPath,
        sha256: protectedDatabaseSha256,
        sizeBytes: protectedDbStat.size,
        mtime: protectedDbStat.mtime.toISOString(),
        mtimeMs: protectedDbStat.mtimeMs,
    };
    const appContentPath = path.join(dir, 'release', 'win-unpacked', 'resources', 'app');
    const profileDatabasePath = path.join(dir, 'profile', 'amazon-ai-ops.db');
    const userDataDir = path.dirname(profileDatabasePath);
    const profileBrowserUserDataDir = path.join(userDataDir, 'stores');
    fs.mkdirSync(path.dirname(profileDatabasePath), { recursive: true });
    fs.mkdirSync(profileBrowserUserDataDir, { recursive: true });
    fs.copyFileSync(authorityDbPath, profileDatabasePath);
    const profileDatabaseArtifact = {
        path: profileDatabasePath,
        sha256: sha256File(profileDatabasePath),
        sizeBytes: fs.statSync(profileDatabasePath).size,
    };
    const appContentSha256 = 'A'.repeat(64);
    const chromiumPath = path.join(appContentPath, 'playwright-browsers', 'chrome-win64', 'chrome.exe');
    fs.mkdirSync(path.dirname(chromiumPath), { recursive: true });
    fs.writeFileSync(chromiumPath, 'bundled Playwright Chromium fixture\n', 'utf8');
    const chromiumArtifact = artifactRecord(chromiumPath);
    const appContentArtifact = {
        kind: 'unpacked-app-content-manifest',
        rootPath: appContentPath,
        fileCount: 2,
        totalSizeBytes: 1 + chromiumArtifact.sizeBytes,
        sha256: appContentSha256,
        files: [
            {
                path: 'dist/main/index.js',
                sizeBytes: 1,
                sha256: PACKAGE_MAIN_BUNDLE_SHA256,
            },
            {
                path: 'playwright-browsers/chrome-win64/chrome.exe',
                sizeBytes: chromiumArtifact.sizeBytes,
                sha256: chromiumArtifact.sha256,
            },
        ],
    };
    const runGroupId = 'v15-non-ready-package-ui-run-group';
    const runnerContract = buildPackageUiRunnerContract();
    const logicalDatabase = validLogicalSqliteArtifact(protectedDatabaseSha256, protectedDbStat.size);
    const finalProfileState = validProfileLineageState(logicalDatabase);
    const packageLineage = {
        appContentSha256,
        chromium: {
            relativePath: 'playwright-browsers/chrome-win64/chrome.exe',
            sha256: chromiumArtifact.sha256,
            sizeBytes: chromiumArtifact.sizeBytes,
        },
        executableSha256: smoke.artifacts.unpacked.sha256,
        profileBindingSha256: HASH_A,
        profileBrowserBindingSha256: HASH_B,
    };
    const runGroupMetadata = writeImmutableEnvelope(path.join(dir, 'package-ui-checkpoints', 'run-group.json'), {
        genesisProfileState: finalProfileState,
        kind: 'package-ui-run-group',
        packageLineage,
        profileSequence: PACKAGE_UI_PROFILE_SEQUENCE,
        protectedDatabaseLogical: logicalDatabase,
        runGroupId,
        runnerContract,
        runnerContractSha256: runnerContract.sha256,
        schemaVersion: 'package-ui-run-group/v1',
    });
    const checkpointComposition = validCheckpointComposition(dir, runGroupId, runnerContract.sha256, finalProfileState, packageLineage);
    const packageUi = {
        kind: 'package-ui-evidence',
        schemaVersion: 9,
        generatedAt: '2026-07-16T08:08:00.000Z',
        completedAt: '2026-07-16T08:09:00.000Z',
        passed: true,
        violations: [],
        interactiveLoginContract: INTERACTIVE_LOGIN_CONTRACT,
        isolatedProfileBootstrapContract: ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
        requested: {
            allowInteractiveLogin: true,
            allowSavedLogin: false,
            appContentPath,
            executablePath: smoke.artifacts.unpacked.path,
            expectedAppContentSha256: appContentSha256,
            expectedExeSha256: smoke.artifacts.unpacked.sha256,
            evidenceMode: 'package-ui',
            interactiveLoginMaximumTotalMs: 1200000,
            interactiveLoginTimeoutMs: 600000,
            loginMode: 'interactive-operator-each-run',
            protectedDatabasePath: authorityDbPath,
            profileBrowserUserDataDir,
            resumeRunGroupId: null,
            runGroupId,
            userDataDir,
            scales: EXPECTED_PACKAGE_UI_SCALES,
            subviewChecks: EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
            viewport: { width: 1366, height: 768 },
            wideProfile: {
                id: PACKAGE_UI_WIDE_PROFILE.id,
                viewport: { width: 1400, height: 900 },
                deviceScaleFactor: 1,
            },
        },
        runs: EXPECTED_PACKAGE_UI_SCALES.map((scale) => validPackageUiRun(dir, scale, userDataDir, profileBrowserUserDataDir, chromiumArtifact)),
        wideProfile: validWidePackageUiRun(dir, userDataDir, profileBrowserUserDataDir, chromiumArtifact),
        runGroup: {
            attemptId: 'v15-non-ready-package-ui-attempt',
            metadata: runGroupMetadata,
            profileSequence: PACKAGE_UI_PROFILE_SEQUENCE,
            resumed: false,
            runGroupId,
            runnerContractSha256: runnerContract.sha256,
        },
        checkpointComposition,
        profileLineage: {
            final: structuredClone(checkpointComposition.finalProfileState),
            passed: true,
        },
        protectedDatabase: {
            before: protectedDatabaseArtifact,
            after: protectedDatabaseArtifact,
            passed: true,
            unchanged: true,
        },
        protectedDatabaseLogical: {
            after: structuredClone(logicalDatabase),
            before: structuredClone(logicalDatabase),
            passed: true,
            unchanged: true,
        },
        profileDatabaseProvenance: {
            hashMatches: true,
            passed: true,
            pathsDistinct: true,
            profileDatabase: profileDatabaseArtifact,
            protectedDatabase: protectedDatabaseArtifact,
            sizeMatches: true,
            violations: [],
        },
        profileDatabaseFileIsolation: { passed: true },
        packageProcessIsolation: validProcessIsolation(),
        profileProcessIsolation: validProcessIsolation(profileBrowserUserDataDir),
        artifactsBefore: {
            exe: smoke.artifacts.unpacked,
            appContent: appContentArtifact,
        },
        artifactsAfter: {
            exe: smoke.artifacts.unpacked,
            appContent: appContentArtifact,
        },
        artifactHashesStable: true,
        freshness: { passed: true, violations: [] },
    };
    bindPackageUiTestManifest(packageUi, dir);
    packageUi.completeness = evaluatePackageUiEvidenceCompleteness(packageUi);
    packageUi.passed = packageUi.completeness.passed;
    packageUi.violations = packageUi.completeness.violations;
    return packageUi;
}

function bundlePackageUiReferencedArtifacts(packageUi, bundleManifest) {
    const artifacts = [];
    const pushArtifact = (artifact) => {
        if (artifact?.path)
            artifacts.push(artifact);
    };
    for (const run of packageUi.runs || []) {
        for (const screenshot of run.screenshots || [])
            pushArtifact(screenshot);
        for (const screenshot of run.minimumWindow?.screenshots || [])
            pushArtifact(screenshot);
        for (const overlay of run.overlayChecks || [])
            pushArtifact(overlay?.screenshot);
        for (const workspace of run.workspaceChecks || []) {
            pushArtifact(workspace?.inspectorEvidence?.screenshot);
        }
        for (const subview of run.subviewChecks || [])
            pushArtifact(subview?.screenshot);
        pushArtifact(run.schedulerReadOnlyRuntime?.artifact);
    }
    for (const screenshot of packageUi.wideProfile?.screenshots || [])
        pushArtifact(screenshot);
    for (const workspace of packageUi.wideProfile?.workspaceChecks || []) {
        pushArtifact(workspace?.inspectorEvidence?.screenshot);
    }
    pushArtifact(packageUi.wideProfile?.schedulerReadOnlyRuntime?.artifact);
    const bundleDir = path.dirname(bundleManifest);
    const targetDir = path.join(bundleDir, 'evidence', 'package-ui-referenced');
    fs.mkdirSync(targetDir, { recursive: true });
    return [...new Map(artifacts.map((artifact) => [path.resolve(artifact.path), artifact])).values()]
        .map((artifact, index) => {
        const targetPath = path.join(targetDir, `${index + 1}-${path.basename(artifact.path)}`);
        fs.copyFileSync(artifact.path, targetPath);
        return {
            label: `package-ui-referenced:${path.basename(artifact.path)}`,
            sourcePath: artifact.path,
            bundlePath: path.relative(bundleDir, targetPath),
            sizeBytes: artifact.sizeBytes,
            sha256: artifact.sha256,
        };
    });
}
export { validPackageUiRun, validWidePackageUiRun, validPackageUiEvidence, bundlePackageUiReferencedArtifacts };
