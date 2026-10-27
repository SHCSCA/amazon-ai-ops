// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const fs = require('node:fs');
const { computeCanonicalPackageIdentity, } = require('./export-mission-control-authority-snapshot');
const { assertMatchingAuthorityCurrentnessProofs, captureAuthoritySnapshotCurrentness, } = require('./sqlite-authority-currentness');
const path = require('node:path');
const { assertDirectDirectory, assertUniqueRegularFile, fileArtifact, normalizePackageIdentity, normalizedArtifactDescriptor, requestedPathEqualsRealpath, sameArtifact, sha256File } = require('./s7-continuous-artifacts.js');
const { AUTHORITY_SNAPSHOT_KIND, AUTHORITY_SNAPSHOT_ROOT, AUTHORITY_SNAPSHOT_SCHEMA_VERSION, ROOT, SOURCE_DATABASE_NAME, fail, isPathContained, isSha256, samePath } = require('./s7-continuous-contracts.js');

function defaultRuntimeContext() {
    const releaseRoot = path.join(ROOT, 'apps', 'desktop', 'release');
    const appContentPath = path.join(releaseRoot, 'win-unpacked', 'resources', 'app');
    const canonicalEvidenceRoot = path.join(ROOT, 'output', 'codex-evidence');
    return {
        appContentPath,
        authoritySnapshotRoot: AUTHORITY_SNAPSHOT_ROOT,
        canonicalEvidenceRoot,
        continuousOperationOutputRoot: path.join(canonicalEvidenceRoot, 'continuous-operation'),
        executablePath: path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe'),
        mainBundlePath: path.join(appContentPath, 'dist', 'main', 'index.js'),
        now: () => new Date(),
        randomUUID: () => crypto.randomUUID(),
        releaseRoot,
        writeStdout: (value) => process.stdout.write(value),
    };
}

function loadAuthoritySnapshotManifest(manifestPath, injectedContext = {}) {
    const context = { ...defaultRuntimeContext(), ...injectedContext };
    const authoritySnapshotRoot = context.authoritySnapshotRoot;
    const rootPath = path.resolve(authoritySnapshotRoot);
    if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory() || !requestedPathEqualsRealpath(rootPath)) {
        fail(`Canonical authority snapshot root is missing or unsafe: ${rootPath}`);
    }
    const { resolved: resolvedManifestPath } = assertUniqueRegularFile(manifestPath, 'Authority snapshot manifest');
    if (!isPathContained(rootPath, resolvedManifestPath)) {
        fail('Authority snapshot manifest is outside the canonical snapshot root.');
    }
    const manifestArtifactBefore = fileArtifact(resolvedManifestPath);
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, 'utf8'));
    }
    catch (error) {
        fail(`Authority snapshot manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (manifest?.kind !== AUTHORITY_SNAPSHOT_KIND)
        fail('Authority snapshot manifest kind is invalid.');
    if (manifest?.schemaVersion !== AUTHORITY_SNAPSHOT_SCHEMA_VERSION) {
        fail(`Authority snapshot manifest must use ${AUTHORITY_SNAPSHOT_SCHEMA_VERSION}.`);
    }
    if (!Number.isFinite(Date.parse(manifest?.exportedAt))) {
        fail('Authority snapshot exportedAt is invalid.');
    }
    const packageIdentity = normalizePackageIdentity(manifest.packageIdentity);
    const sourcePath = manifest?.source?.absolutePath;
    if (typeof sourcePath !== 'string'
        || sourcePath !== sourcePath.trim()
        || !path.isAbsolute(sourcePath)
        || sourcePath.includes('\0')
        || path.basename(sourcePath).toLowerCase() !== SOURCE_DATABASE_NAME) {
        fail('Authority snapshot source must be the canonical absolute amazon-ai-ops.db path.');
    }
    const { resolved: authorityDbPath } = assertUniqueRegularFile(sourcePath, 'Authority snapshot source database');
    if (!samePath(authorityDbPath, manifest.source.realPath)) {
        fail('Authority snapshot source realPath binding is invalid.');
    }
    const sourceArtifactBefore = normalizedArtifactDescriptor(manifest.source.artifactBefore, 'Authority snapshot source artifactBefore');
    const sourceArtifactAfter = normalizedArtifactDescriptor(manifest.source.artifactAfter, 'Authority snapshot source artifactAfter');
    if (!sameArtifact(sourceArtifactBefore, sourceArtifactAfter)) {
        fail('Authority snapshot source changed during snapshot export.');
    }
    const sourceArtifactCurrent = fileArtifact(authorityDbPath);
    if (!sameArtifact(sourceArtifactCurrent, sourceArtifactAfter)) {
        fail('Authority snapshot source current bytes do not match artifactAfter.');
    }
    const userDataDir = assertDirectDirectory(path.dirname(authorityDbPath), 'Authority snapshot USER_DATA_DIR');
    const storesRoot = assertDirectDirectory(path.join(userDataDir, 'stores'), 'Authority snapshot stores root');
    const snapshotPath = manifest?.snapshot?.absolutePath;
    if (typeof snapshotPath !== 'string' || !path.isAbsolute(snapshotPath)) {
        fail('Authority snapshot absolutePath is missing.');
    }
    const { resolved: databasePath, stat } = assertUniqueRegularFile(snapshotPath, 'Authority database snapshot');
    if (!isPathContained(rootPath, databasePath)) {
        fail('Authority database snapshot is outside the canonical snapshot root.');
    }
    if (typeof manifest.snapshot.realPath !== 'string'
        || fs.realpathSync.native(databasePath).toLowerCase() !== path.resolve(manifest.snapshot.realPath).toLowerCase()) {
        fail('Authority database snapshot realPath binding is invalid.');
    }
    if (!isSha256(manifest.snapshot.sha256)
        || sha256File(databasePath) !== String(manifest.snapshot.sha256).toUpperCase()
        || Number(manifest.snapshot.sizeBytes) !== stat.size) {
        fail('Authority database snapshot bytes do not match the manifest.');
    }
    if (manifest?.backup?.method !== 'sqlite-online-backup'
        || manifest?.backup?.completed !== true
        || !Number.isFinite(Date.parse(manifest.backup.startedAt))
        || !Number.isFinite(Date.parse(manifest.backup.completedAt))
        || !Number.isInteger(manifest.backup.totalPages)
        || manifest.backup.totalPages <= 0
        || manifest.backup.remainingPages !== 0
        || Date.parse(manifest.backup.startedAt) > Date.parse(manifest.backup.completedAt)
        || manifest.exportedAt !== manifest.backup.completedAt) {
        fail('Authority snapshot does not prove a completed SQLite online backup.');
    }
    if (manifest?.source?.openedReadOnly !== true
        || manifest.source.queryOnly !== true
        || JSON.stringify(manifest.source.integrityCheck) !== JSON.stringify(['ok'])
        || !Array.isArray(manifest.source.foreignKeyCheck)
        || manifest.source.foreignKeyCheck.length !== 0) {
        fail('Authority snapshot source was not opened read-only.');
    }
    if (manifest.snapshot.openedReadOnly !== true
        || manifest.snapshot.queryOnly !== true
        || JSON.stringify(manifest.snapshot.integrityCheck) !== JSON.stringify(['ok'])
        || !Array.isArray(manifest.snapshot.foreignKeyCheck)
        || manifest.snapshot.foreignKeyCheck.length !== 0) {
        fail('Authority database snapshot did not pass its read-only integrity contract.');
    }
    const verifyPackageIdentity = injectedContext.verifyPackageIdentity === undefined
        ? samePath(rootPath, AUTHORITY_SNAPSHOT_ROOT)
        : injectedContext.verifyPackageIdentity === true;
    const packageIdentityCurrent = verifyPackageIdentity
        ? normalizePackageIdentity(computeCanonicalPackageIdentity(context))
        : packageIdentity;
    if (JSON.stringify(packageIdentityCurrent) !== JSON.stringify(packageIdentity)) {
        fail('Authority snapshot packageIdentity does not match the current canonical package.');
    }
    const manifestArtifact = fileArtifact(resolvedManifestPath);
    if (!sameArtifact(manifestArtifact, manifestArtifactBefore)) {
        fail('Authority snapshot manifest changed while it was being loaded.');
    }
    const snapshotArtifact = fileArtifact(databasePath);
    return {
        authorityDbPath,
        databasePath,
        manifest,
        manifestArtifact,
        manifestPath: resolvedManifestPath,
        packageIdentity,
        packageIdentityVerified: verifyPackageIdentity,
        snapshotArtifact,
        sourceArtifact: sourceArtifactCurrent,
        snapshotManifestSha256: sha256File(resolvedManifestPath),
        storesRoot,
    };
}

function verifyAuthorityInputsUnchanged(authoritySnapshot, context, verifiedFileArtifacts = []) {
    for (const [label, candidatePath, expected] of [
        ['authority snapshot manifest', authoritySnapshot.manifestPath, authoritySnapshot.manifestArtifact],
        ['authority database snapshot', authoritySnapshot.databasePath, authoritySnapshot.snapshotArtifact],
        ['live authority database main file', authoritySnapshot.authorityDbPath, authoritySnapshot.sourceArtifact],
    ]) {
        assertUniqueRegularFile(candidatePath, label);
        const current = fileArtifact(candidatePath);
        if (!sameArtifact(current, expected)) {
            fail(`${label} bytes changed during continuous-operation verification.`);
        }
    }
    for (const artifact of verifiedFileArtifacts) {
        const { resolved, stat } = assertUniqueRegularFile(artifact.filePath, 'Verified Store Capsule report file');
        if (stat.size !== artifact.sizeBytes || sha256File(resolved) !== artifact.sha256) {
            fail(`Verified Store Capsule report file changed during verification: ${resolved}`);
        }
    }
    if (authoritySnapshot.packageIdentityVerified) {
        const packageIdentityCurrent = normalizePackageIdentity(computeCanonicalPackageIdentity(context));
        if (JSON.stringify(packageIdentityCurrent) !== JSON.stringify(authoritySnapshot.packageIdentity)) {
            fail('Canonical package identity changed during continuous-operation verification.');
        }
    }
}

function captureLiveAuthorityCurrentness(authoritySnapshot, context, captureLabel) {
    const capture = context.captureAuthoritySnapshotCurrentness
        ?? captureAuthoritySnapshotCurrentness;
    if (typeof capture !== 'function') {
        fail('Authority currentness capture implementation is invalid.');
    }
    return capture({
        sourceDatabasePath: authoritySnapshot.authorityDbPath,
        expectedSnapshotArtifact: authoritySnapshot.snapshotArtifact,
        captureLabel,
    }, {
        ...(context.authorityCurrentnessContext ?? {}),
        now: context.now,
    });
}

module.exports = { defaultRuntimeContext, loadAuthoritySnapshotManifest, verifyAuthorityInputsUnchanged, captureLiveAuthorityCurrentness };
