// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('fs');
const path = require('path');
const { packageEvidenceListsMatch, pathIsInside, readJson, samePath, sha256, validArtifact } = require('./v15-non-ready-safety-contracts.js');

function bundleFileRecordMatches(manifest, bundleManifestPath, label, expectedPath) {
    const record = Array.isArray(manifest.files)
        ? manifest.files.find((item) => item?.label === label && item?.bundlePath)
        : null;
    if (!record)
        return false;
    const recordedPath = path.resolve(path.dirname(bundleManifestPath), record.bundlePath);
    if (!samePath(recordedPath, expectedPath) || !pathIsInside(recordedPath, path.dirname(bundleManifestPath)))
        return false;
    return validArtifact({
        path: recordedPath,
        sizeBytes: record.sizeBytes,
        sha256: record.sha256,
    });
}

function bundlePackageIndexMatchesFinalReadiness(finalReadiness, manifest, bundleManifestPath) {
    const summary = manifest.packageIndex;
    const finalIndex = finalReadiness.packageIndex;
    if (summary?.present !== true || !summary.bundleJson || !finalIndex)
        return false;
    if (Number(summary.count || 0) !== Number(finalIndex.count || 0))
        return false;
    if (Number(summary.existingCount || 0) !== Number(finalIndex.existingCount || 0))
        return false;
    if (Number(summary.missingCount || 0) !== Number(finalIndex.missingCount || 0))
        return false;
    const indexPath = path.resolve(path.dirname(bundleManifestPath), summary.bundleJson);
    if (!pathIsInside(indexPath, path.dirname(bundleManifestPath)))
        return false;
    if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile())
        return false;
    if (!bundleFileRecordMatches(manifest, bundleManifestPath, 'release-package-index', indexPath))
        return false;
    let bundleIndex;
    try {
        bundleIndex = readJson(indexPath);
    }
    catch {
        return false;
    }
    if (!samePath(bundleIndex.releaseDir, finalIndex.releaseDir))
        return false;
    if (!packageEvidenceListsMatch(bundleIndex.packages, finalIndex.packages))
        return false;
    const packages = Array.isArray(bundleIndex.packages) ? bundleIndex.packages : [];
    if (packages.length !== Number(summary.count || 0))
        return false;
    return packages.every((item) => item?.exists === true && validArtifact({
        path: item.sourcePath,
        sizeBytes: item.sizeBytes,
        sha256: item.sha256,
    }));
}

function bundleSourceFileMatches(manifest, bundleManifestPath, sourcePath) {
    const record = Array.isArray(manifest.files)
        ? manifest.files.find((item) => samePath(item?.sourcePath, sourcePath) && item?.bundlePath)
        : null;
    if (!record)
        return false;
    const bundledPath = path.resolve(path.dirname(bundleManifestPath), record.bundlePath);
    if (!pathIsInside(bundledPath, path.dirname(bundleManifestPath)))
        return false;
    if (!validArtifact({ path: bundledPath, sizeBytes: record.sizeBytes, sha256: record.sha256 }))
        return false;
    return fs.statSync(sourcePath).size === Number(record.sizeBytes || 0)
        && sha256(sourcePath) === String(record.sha256 || '').toUpperCase();
}

function packageUiReferencedArtifactsAreBundled(packageUi, manifest, bundleManifestPath) {
    const artifacts = [];
    const pushArtifact = (artifact) => {
        if (artifact?.path)
            artifacts.push(artifact);
    };
    for (const run of packageUi?.runs || []) {
        for (const screenshot of run?.screenshots || [])
            pushArtifact(screenshot);
        for (const screenshot of run?.minimumWindow?.screenshots || [])
            pushArtifact(screenshot);
        for (const overlay of run?.overlayChecks || [])
            pushArtifact(overlay?.screenshot);
        for (const workspace of run?.workspaceChecks || []) {
            pushArtifact(workspace?.inspectorEvidence?.screenshot);
        }
        for (const subview of run?.subviewChecks || [])
            pushArtifact(subview?.screenshot);
        pushArtifact(run?.schedulerReadOnlyRuntime?.artifact);
    }
    for (const screenshot of packageUi?.wideProfile?.screenshots || [])
        pushArtifact(screenshot);
    for (const workspace of packageUi?.wideProfile?.workspaceChecks || []) {
        pushArtifact(workspace?.inspectorEvidence?.screenshot);
    }
    pushArtifact(packageUi?.wideProfile?.schedulerReadOnlyRuntime?.artifact);
    if (artifacts.length === 0)
        return false;
    return artifacts.every((artifact) => {
        if (!validArtifact(artifact))
            return false;
        const record = Array.isArray(manifest?.files)
            ? manifest.files.find((item) => samePath(item?.sourcePath, artifact.path) && item?.bundlePath)
            : null;
        return Boolean(record)
            && Number(record.sizeBytes || 0) === Number(artifact.sizeBytes || 0)
            && String(record.sha256 || '').toUpperCase() === String(artifact.sha256 || '').toUpperCase()
            && bundleSourceFileMatches(manifest, bundleManifestPath, artifact.path);
    });
}

module.exports = { bundleFileRecordMatches, bundlePackageIndexMatchesFinalReadiness, bundleSourceFileMatches, packageUiReferencedArtifactsAreBundled };
