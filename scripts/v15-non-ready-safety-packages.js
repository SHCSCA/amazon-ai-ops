// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('fs');
const path = require('path');
const { PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION, rendererPathIdentity, validateAdversarialNodeEnvBundleSummaryContract, validateAdversarialNodeEnvEvidence, validateAdversarialNodeEnvManifestEntryContract, validateAdversarialNodeEnvSelectionContract, } = require('./smoke-package-adversarial-node-env');
const { validatePackageSecurityEvidence } = require('./smoke-package-security-boundaries');
const { validatePackageLaunchSmokeEvidence } = require('./smoke-package-launch');
const { bundleSourceFileMatches } = require('./v15-non-ready-safety-bundle.js');
const { artifactsMatch, gateById, gateByName, readJson, samePath, sha256, validArtifact } = require('./v15-non-ready-safety-contracts.js');

function hasCurrentPackageHashEvidence(finalReadiness) {
    const releasePackageGate = gateById(finalReadiness, 'release-package-hash')
        || gateByName(finalReadiness, 'Release package hash');
    const index = finalReadiness.packageIndex;
    if (!releasePackageGate || releasePackageGate.ok !== true || releasePackageGate.status !== 'passed')
        return false;
    if (index?.present !== true)
        return false;
    if (Number(index.count || 0) <= 0)
        return false;
    if (Number(index.existingCount || 0) !== Number(index.count || 0))
        return false;
    if (Number(index.missingCount || 0) !== 0)
        return false;
    if (!Array.isArray(index.packages))
        return false;
    if (index.packages.length !== Number(index.count || 0))
        return false;
    if (!index.packages.some((item) => item.kind === 'installer'))
        return false;
    if (!index.packages.some((item) => item.kind === 'portable'))
        return false;
    return index.packages.every((item) => {
        if (item?.exists !== true || !item?.sourcePath || !item?.fileName)
            return false;
        return validArtifact({
            path: item.sourcePath,
            sizeBytes: item.sizeBytes,
            sha256: item.sha256,
        });
    });
}

function readValidPackageLaunchSmoke(filePath) {
    if (!filePath || !fs.existsSync(filePath))
        return false;
    try {
        const smoke = readJson(filePath);
        const strictValidation = validatePackageLaunchSmokeEvidence(smoke);
        const unpacked = smoke.artifacts?.unpacked;
        const portable = smoke.artifacts?.portable;
        const checks = Array.isArray(smoke.checks) ? smoke.checks : [];
        const hasCheck = (kind) => checks.some((item) => item?.kind === kind && item.ok === true);
        const valid = strictValidation.passed === true
            && smoke.kind === 'package-launch-smoke'
            && smoke.passed === true
            && Number.isFinite(Date.parse(smoke.generatedAt))
            && validArtifact(unpacked)
            && validArtifact(portable)
            && hasCheck('win-unpacked')
            && hasCheck('portable');
        return valid ? smoke : null;
    }
    catch {
        return null;
    }
}

function packageLaunchSmokeMatchesFinalReadiness(finalReadiness, filePath, smoke) {
    const recorded = finalReadiness.packageLaunchSmoke;
    if (!recorded || !smoke)
        return false;
    const recordedChecks = Array.isArray(recorded.checks) ? recorded.checks : [];
    const hasRecordedCheck = (kind) => recordedChecks.some((item) => item?.kind === kind && item.ok === true);
    return recorded.present === true
        && recorded.passed === true
        && recorded.selectedBy === 'explicit-arg'
        && samePath(recorded.evidencePath, filePath)
        && String(recorded.generatedAt || '') === String(smoke.generatedAt || '')
        && artifactsMatch(recorded.artifacts?.unpacked, smoke.artifacts?.unpacked)
        && artifactsMatch(recorded.artifacts?.portable, smoke.artifacts?.portable)
        && hasRecordedCheck('win-unpacked')
        && hasRecordedCheck('portable');
}

function packageLaunchSmokeMatchesPackageIndex(finalReadiness, smoke) {
    if (!smoke || !Array.isArray(finalReadiness.packageIndex?.packages))
        return false;
    const portablePackages = finalReadiness.packageIndex.packages.filter((item) => item?.kind === 'portable');
    if (portablePackages.length !== 1)
        return false;
    const portablePackage = portablePackages[0];
    return artifactsMatch(smoke.artifacts?.portable, {
        path: portablePackage.sourcePath,
        sizeBytes: portablePackage.sizeBytes,
        sha256: portablePackage.sha256,
    });
}

function packageSecurityEvidenceIsStrictlyValid({ filePath, packageUiManifestPath, manifest, bundleManifestPath, smoke, }) {
    if (!filePath || !packageUiManifestPath || !smoke || !fs.existsSync(filePath))
        return false;
    try {
        const evidence = readJson(filePath);
        const packageUi = readJson(packageUiManifestPath);
        const expectedExecutableSha256 = smoke.artifacts?.unpacked?.sha256;
        const expectedAppContentSha256 = packageUi.artifactsAfter?.appContent?.sha256;
        const beforeMainBundles = (packageUi.artifactsBefore?.appContent?.files || [])
            .filter((item) => String(item?.path || '').replace(/\\/g, '/') === 'dist/main/index.js');
        const afterMainBundles = (packageUi.artifactsAfter?.appContent?.files || [])
            .filter((item) => String(item?.path || '').replace(/\\/g, '/') === 'dist/main/index.js');
        const expectedMainBundleSha256 = afterMainBundles.length === 1
            ? String(afterMainBundles[0]?.sha256 || '').toUpperCase()
            : '';
        const mainBundleIdentityBound = beforeMainBundles.length === 1
            && afterMainBundles.length === 1
            && /^[A-F0-9]{64}$/.test(expectedMainBundleSha256)
            && String(beforeMainBundles[0]?.sha256 || '').toUpperCase() === expectedMainBundleSha256;
        const validation = validatePackageSecurityEvidence(evidence, {
            executableSha256: expectedExecutableSha256,
            appContentSha256: expectedAppContentSha256,
            mainBundleSha256: expectedMainBundleSha256,
        });
        const bundled = manifest.securityEvidence?.packageSecurityBoundaries?.present === true
            && samePath(manifest.securityEvidence?.packageSecurityBoundaries?.sourcePath, filePath)
            && bundleSourceFileMatches(manifest, bundleManifestPath, filePath);
        return mainBundleIdentityBound
            && validation.passed
            && evidence.passed === true
            && bundled;
    }
    catch {
        return false;
    }
}

function packageAdversarialNodeEnvEvidenceIsStrictlyValid({ filePath, finalReadiness, packageUiManifestPath, manifest, bundleManifestPath, smoke, }) {
    if (!filePath || !packageUiManifestPath || !smoke || !fs.existsSync(filePath))
        return false;
    try {
        const evidence = readJson(filePath);
        const packageUi = readJson(packageUiManifestPath);
        const appContentAfter = packageUi.artifactsAfter?.appContent;
        const beforeMainBundles = (packageUi.artifactsBefore?.appContent?.files || [])
            .filter((item) => String(item?.path || '').replace(/\\/g, '/') === 'dist/main/index.js');
        const afterMainBundles = (appContentAfter?.files || [])
            .filter((item) => String(item?.path || '').replace(/\\/g, '/') === 'dist/main/index.js');
        if (!appContentAfter?.rootPath || beforeMainBundles.length !== 1 || afterMainBundles.length !== 1)
            return false;
        const expectedMainBundleSha256 = String(afterMainBundles[0]?.sha256 || '').toUpperCase();
        if (String(beforeMainBundles[0]?.sha256 || '').toUpperCase() !== expectedMainBundleSha256)
            return false;
        const validation = validateAdversarialNodeEnvEvidence(evidence, {
            executableSha256: smoke.artifacts?.unpacked?.sha256,
            appContentSha256: appContentAfter.sha256,
            mainBundleSha256: expectedMainBundleSha256,
            rendererEntrySha256: rendererPathIdentity(path.join(appContentAfter.rootPath, 'dist', 'renderer', 'index.html')),
        });
        const selected = finalReadiness.packageAdversarialNodeEnv;
        const summary = manifest.securityEvidence?.packageAdversarialNodeEnvSmoke;
        const selectionContract = validateAdversarialNodeEnvSelectionContract(selected);
        const summaryContract = validateAdversarialNodeEnvBundleSummaryContract(summary);
        return validation.passed
            && selectionContract.passed
            && summaryContract.passed
            && samePath(selected?.evidencePath, filePath)
            && /^[A-F0-9]{64}$/.test(String(selected?.evidenceSha256 || ''))
            && String(selected.evidenceSha256).toUpperCase() === sha256(filePath)
            && samePath(summary?.sourcePath, filePath)
            && bundleSourceFileMatches(manifest, bundleManifestPath, filePath);
    }
    catch {
        return false;
    }
}

module.exports = { hasCurrentPackageHashEvidence, readValidPackageLaunchSmoke, packageLaunchSmokeMatchesFinalReadiness, packageLaunchSmokeMatchesPackageIndex, packageSecurityEvidenceIsStrictlyValid, packageAdversarialNodeEnvEvidenceIsStrictlyValid };
