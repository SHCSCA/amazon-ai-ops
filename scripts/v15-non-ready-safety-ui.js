// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('fs');
const path = require('path');
const { EXPECTED_OVERLAY_CHECK_IDS, EXPECTED_PACKAGE_UI_WORKSPACES, PACKAGE_UI_WIDE_PROFILE, evaluatePackageUiEvidenceCompleteness, } = require('./package-ui-evidence');
const { bundleSourceFileMatches, packageUiReferencedArtifactsAreBundled } = require('./v15-non-ready-safety-bundle.js');
const { artifactsMatch, readJson, samePath, validArtifact } = require('./v15-non-ready-safety-contracts.js');
const { processIsolationIsStrictlyValid, runDiagnosticsAreStrictlyValid } = require('./v15-non-ready-safety-diagnostics.js');

function viewportMatchesBoundedContract(run, requestedViewport, expectedDeviceScaleFactor) {
    const actualWidth = Number(run?.viewport?.width);
    const actualHeight = Number(run?.viewport?.height);
    const requestedWidth = Number(requestedViewport?.width);
    const requestedHeight = Number(requestedViewport?.height);
    const actualDeviceScaleFactor = Number(run?.actualDeviceScaleFactor);
    const contract = run?.viewportContract;
    if (!Number.isFinite(actualWidth)
        || !Number.isFinite(actualHeight)
        || !Number.isFinite(requestedWidth)
        || !Number.isFinite(requestedHeight)
        || !Number.isFinite(actualDeviceScaleFactor)
        || actualDeviceScaleFactor !== expectedDeviceScaleFactor
        || contract?.passed !== true
        || (Array.isArray(contract?.violations) && contract.violations.length > 0)) {
        return false;
    }
    if (actualWidth === requestedWidth && actualHeight === requestedHeight)
        return true;
    const contractRequested = contract?.requested;
    const contractActual = contract?.actual;
    const tolerance = contract?.tolerance;
    const widthTolerance = Number(tolerance?.width);
    const heightTolerance = Number(tolerance?.height);
    const scaleTolerance = Number(tolerance?.deviceScaleFactor);
    const boundedTolerance = Number.isFinite(widthTolerance)
        && Number.isFinite(heightTolerance)
        && Number.isFinite(scaleTolerance)
        && widthTolerance >= 0
        && heightTolerance >= 0
        && scaleTolerance >= 0
        && widthTolerance <= 2
        && heightTolerance <= 2
        && scaleTolerance <= 0.02;
    return boundedTolerance
        && Number(contractRequested?.width) === requestedWidth
        && Number(contractRequested?.height) === requestedHeight
        && Number(contractRequested?.deviceScaleFactor) === expectedDeviceScaleFactor
        && Number(contractActual?.width) === actualWidth
        && Number(contractActual?.height) === actualHeight
        && Number(contractActual?.deviceScaleFactor) === actualDeviceScaleFactor
        && Math.abs(actualWidth - requestedWidth) <= widthTolerance
        && Math.abs(actualHeight - requestedHeight) <= heightTolerance
        && Math.abs(actualDeviceScaleFactor - expectedDeviceScaleFactor) <= scaleTolerance;
}

function packageUiEvidenceIsStrictlyValid({ filePath, finalReadiness, manifest, bundleManifestPath, smoke, }) {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile())
        return false;
    try {
        const packageUi = readJson(filePath);
        const runs = Array.isArray(packageUi.runs) ? packageUi.runs : [];
        const expectedScales = new Map([[100, 1], [125, 1.25]]);
        const requestedProfileBrowserPath = packageUi.requested?.profileBrowserUserDataDir;
        const expectedProfileBrowserPath = packageUi.requested?.userDataDir
            ? path.join(packageUi.requested.userDataDir, 'stores')
            : null;
        const profileBrowserPathBound = Boolean(requestedProfileBrowserPath)
            && Boolean(expectedProfileBrowserPath)
            && samePath(requestedProfileBrowserPath, expectedProfileBrowserPath);
        const runsComplete = runs.length === expectedScales.size
            && new Set(runs.map((run) => run?.scalePercent)).size === expectedScales.size
            && runs.every((run) => (expectedScales.has(run?.scalePercent)
                && viewportMatchesBoundedContract(run, packageUi.requested?.viewport, expectedScales.get(run.scalePercent))
                && run?.passed === true
                && processIsolationIsStrictlyValid(run?.packageProcessIsolation)
                && processIsolationIsStrictlyValid(run?.profileProcessIsolation, requestedProfileBrowserPath)
                && runDiagnosticsAreStrictlyValid(run?.diagnostics, run, `${run.scalePercent}-compact`)
                && Array.isArray(run?.consoleErrors)
                && run.consoleErrors.length === 0
                && Array.isArray(run?.pageErrors)
                && run.pageErrors.length === 0
                && Array.isArray(run?.screenshots)
                && run.screenshots.length >= EXPECTED_PACKAGE_UI_WORKSPACES.length
                && Array.isArray(run?.workspaceChecks)
                && run.workspaceChecks.length >= EXPECTED_PACKAGE_UI_WORKSPACES.length
                && run.workspaceChecks.every((item) => item?.passed === true)
                && Array.isArray(run?.overlayChecks)
                && run.overlayChecks.length >= EXPECTED_OVERLAY_CHECK_IDS.length
                && run.overlayChecks.every((item) => item?.passed === true)));
        const wideProfile = packageUi.wideProfile;
        const wideWorkspaceKeys = new Set(PACKAGE_UI_WIDE_PROFILE.workspaces.map((item) => `${item.workspace}/${item.subview}`));
        const wideWorkspaceChecks = Array.isArray(wideProfile?.workspaceChecks) ? wideProfile.workspaceChecks : [];
        const wideScreenshots = Array.isArray(wideProfile?.screenshots) ? wideProfile.screenshots : [];
        const wideProfileComplete = packageUi.requested?.wideProfile?.id === PACKAGE_UI_WIDE_PROFILE.id
            && packageUi.requested?.wideProfile?.viewport?.width === PACKAGE_UI_WIDE_PROFILE.viewport.width
            && packageUi.requested?.wideProfile?.viewport?.height === PACKAGE_UI_WIDE_PROFILE.viewport.height
            && Number(packageUi.requested?.wideProfile?.deviceScaleFactor)
                === PACKAGE_UI_WIDE_PROFILE.deviceScaleFactor
            && wideProfile?.profileId === PACKAGE_UI_WIDE_PROFILE.id
            && wideProfile?.passed === true
            && wideProfile?.viewport?.width === PACKAGE_UI_WIDE_PROFILE.viewport.width
            && wideProfile?.viewport?.height === PACKAGE_UI_WIDE_PROFILE.viewport.height
            && Number(wideProfile?.actualDeviceScaleFactor) === PACKAGE_UI_WIDE_PROFILE.deviceScaleFactor
            && wideProfile?.viewportContract?.passed === true
            && wideProfile?.identity?.passed === true
            && processIsolationIsStrictlyValid(wideProfile?.packageProcessIsolation)
            && processIsolationIsStrictlyValid(wideProfile?.profileProcessIsolation, requestedProfileBrowserPath)
            && runDiagnosticsAreStrictlyValid(wideProfile?.diagnostics, wideProfile, PACKAGE_UI_WIDE_PROFILE.id)
            && Array.isArray(wideProfile?.consoleErrors)
            && wideProfile.consoleErrors.length === 0
            && Array.isArray(wideProfile?.pageErrors)
            && wideProfile.pageErrors.length === 0
            && wideWorkspaceChecks.length === wideWorkspaceKeys.size
            && new Set(wideWorkspaceChecks.map((item) => `${item?.workspace}/${item?.subview}`)).size === wideWorkspaceKeys.size
            && wideWorkspaceChecks.every((item) => (wideWorkspaceKeys.has(`${item?.workspace}/${item?.subview}`)
                && item?.passed === true
                && item?.compositeEvidence?.passed === true
                && item?.keyboardEvidence?.passed === true
                && item?.settleEvidence?.passed === true))
            && wideScreenshots.length === wideWorkspaceKeys.size
            && new Set(wideScreenshots.map((item) => `${item?.workspace}/${item?.subview}`)).size === wideWorkspaceKeys.size
            && wideScreenshots.every((item) => (wideWorkspaceKeys.has(`${item?.workspace}/${item?.subview}`)
                && /^[A-F0-9]{64}$/.test(String(item?.sha256 || ''))));
        const currentPackageUiCompleteness = packageUi.schemaVersion === 9
            ? evaluatePackageUiEvidenceCompleteness(packageUi)
            : null;
        const packageUiSchemaContractValid = packageUi.schemaVersion === 9
            && currentPackageUiCompleteness?.passed === true
            && Array.isArray(currentPackageUiCompleteness.violations)
            && currentPackageUiCompleteness.violations.length === 0;
        const generatedAt = Date.parse(packageUi.generatedAt);
        const completedAt = Date.parse(packageUi.completedAt);
        const smokeGeneratedAt = Date.parse(smoke?.generatedAt);
        const exeBefore = packageUi.artifactsBefore?.exe;
        const exeAfter = packageUi.artifactsAfter?.exe;
        const appContentBefore = packageUi.artifactsBefore?.appContent;
        const appContentAfter = packageUi.artifactsAfter?.appContent;
        const requested = packageUi.requested || {};
        const protectedDatabase = packageUi.protectedDatabase;
        const profileDatabaseProvenance = packageUi.profileDatabaseProvenance;
        const dbBefore = protectedDatabase?.before;
        const dbAfter = protectedDatabase?.after;
        const authorityDbPath = finalReadiness.evidenceSelection?.authorityDbPath;
        const packageHashesValid = packageUi.artifactHashesStable === true
            && validArtifact(exeBefore)
            && validArtifact(exeAfter)
            && artifactsMatch(exeBefore, smoke?.artifacts?.unpacked)
            && artifactsMatch(exeAfter, smoke?.artifacts?.unpacked)
            && samePath(requested.executablePath, smoke?.artifacts?.unpacked?.path)
            && String(requested.expectedExeSha256 || '').toUpperCase() === String(smoke?.artifacts?.unpacked?.sha256 || '').toUpperCase()
            && String(requested.expectedAppContentSha256 || '').toUpperCase() === String(appContentBefore?.sha256 || '').toUpperCase()
            && String(appContentBefore?.sha256 || '').toUpperCase() === String(appContentAfter?.sha256 || '').toUpperCase()
            && samePath(requested.appContentPath, appContentBefore?.rootPath)
            && samePath(appContentBefore?.rootPath, appContentAfter?.rootPath);
        const databaseIsolated = protectedDatabase?.passed === true
            && protectedDatabase?.unchanged === true
            && samePath(requested.protectedDatabasePath, authorityDbPath)
            && samePath(dbBefore?.path, authorityDbPath)
            && samePath(dbAfter?.path, authorityDbPath)
            && String(dbBefore?.sha256 || '').toUpperCase() === String(dbAfter?.sha256 || '').toUpperCase()
            && Number(dbBefore?.sizeBytes || 0) === Number(dbAfter?.sizeBytes || 0)
            && Number(dbBefore?.mtimeMs || 0) === Number(dbAfter?.mtimeMs || 0)
            && validArtifact(dbAfter);
        const profileDatabaseProvenanceValid = profileDatabaseProvenance?.passed === true
            && profileDatabaseProvenance?.hashMatches === true
            && profileDatabaseProvenance?.sizeMatches === true
            && profileDatabaseProvenance?.pathsDistinct === true
            && Array.isArray(profileDatabaseProvenance?.violations)
            && profileDatabaseProvenance.violations.length === 0
            && !samePath(profileDatabaseProvenance?.profileDatabase?.path, authorityDbPath)
            && samePath(profileDatabaseProvenance?.protectedDatabase?.path, authorityDbPath)
            && String(profileDatabaseProvenance?.profileDatabase?.sha256 || '').toUpperCase() === String(dbBefore?.sha256 || '').toUpperCase()
            && String(profileDatabaseProvenance?.protectedDatabase?.sha256 || '').toUpperCase() === String(dbBefore?.sha256 || '').toUpperCase()
            && Number(profileDatabaseProvenance?.profileDatabase?.sizeBytes || 0) === Number(dbBefore?.sizeBytes || 0)
            && Number(profileDatabaseProvenance?.protectedDatabase?.sizeBytes || 0) === Number(dbBefore?.sizeBytes || 0);
        const processIsolated = processIsolationIsStrictlyValid(packageUi.packageProcessIsolation);
        const profileProcessIsolated = profileBrowserPathBound
            && processIsolationIsStrictlyValid(packageUi.profileProcessIsolation, requestedProfileBrowserPath);
        const bundled = manifest.uiEvidence?.packageUiManifest?.present === true
            && samePath(manifest.uiEvidence?.packageUiManifest?.sourcePath, filePath)
            && bundleSourceFileMatches(manifest, bundleManifestPath, filePath);
        const referencedArtifactsBundled = packageUi.schemaVersion === 9
            && packageUiReferencedArtifactsAreBundled(packageUi, manifest, bundleManifestPath);
        return packageUi.kind === 'package-ui-evidence'
            && packageUiSchemaContractValid
            && packageUi.passed === true
            && Array.isArray(packageUi.violations)
            && packageUi.violations.length === 0
            && packageUi.freshness?.passed === true
            && Array.isArray(packageUi.freshness?.violations)
            && packageUi.freshness.violations.length === 0
            && packageUi.completeness?.passed === true
            && Array.isArray(packageUi.completeness?.violations)
            && packageUi.completeness.violations.length === 0
            && runsComplete
            && wideProfileComplete
            && Number.isFinite(generatedAt)
            && Number.isFinite(completedAt)
            && Number.isFinite(smokeGeneratedAt)
            && generatedAt >= smokeGeneratedAt
            && completedAt >= generatedAt
            && packageHashesValid
            && databaseIsolated
            && profileDatabaseProvenanceValid
            && processIsolated
            && profileProcessIsolated
            && referencedArtifactsBundled
            && bundled;
    }
    catch {
        return false;
    }
}

module.exports = { viewportMatchesBoundedContract, packageUiEvidenceIsStrictlyValid };
