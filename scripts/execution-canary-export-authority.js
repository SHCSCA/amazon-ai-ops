// 按职责复用原有严格校验，公共入口继续保持兼容。
const path = require('node:path');
const { assertMatchingAuthorityCurrentnessProofs, captureAuthoritySnapshotCurrentness, } = require('./sqlite-authority-currentness');
const { AUTHORITY_DATABASE_NAME, AUTHORITY_SNAPSHOT_SCHEMA_VERSION, BACKUP_METHOD, CANARY_MAX_AGE_MS, MAX_FUTURE_SKEW_MS, assertArtifactDescriptor, assertCleanAbsolutePath, assertCondition, assertDirectDirectory, assertUniqueRegularFile, isPathContained, normalizePackageIdentity, samePath, stableEqual } = require('./execution-canary-export-contracts.js');

function validateAuthoritySnapshotV2(authoritySnapshot, nowMs) {
    const { manifest } = authoritySnapshot;
    assertCondition(manifest.schemaVersion === AUTHORITY_SNAPSHOT_SCHEMA_VERSION, `Authority snapshot must use ${AUTHORITY_SNAPSHOT_SCHEMA_VERSION}.`);
    const startedAtMs = Date.parse(manifest.backup?.startedAt);
    const completedAtMs = Date.parse(manifest.backup?.completedAt);
    const exportedAtMs = Date.parse(manifest.exportedAt);
    assertCondition(manifest.backup?.method === BACKUP_METHOD
        && manifest.backup.completed === true
        && Number.isInteger(manifest.backup.totalPages)
        && manifest.backup.totalPages > 0
        && manifest.backup.remainingPages === 0
        && Number.isFinite(startedAtMs)
        && Number.isFinite(completedAtMs)
        && startedAtMs <= completedAtMs
        && completedAtMs === exportedAtMs, 'Authority snapshot does not prove one ordered, completed SQLite online backup.');
    assertCondition(exportedAtMs <= nowMs + MAX_FUTURE_SKEW_MS && nowMs - exportedAtMs <= CANARY_MAX_AGE_MS, 'Authority snapshot is future-dated or stale and cannot be replayed for a current canary.');
    assertCondition(manifest.source?.openedReadOnly === true
        && manifest.source.queryOnly === true
        && stableEqual(manifest.source.integrityCheck, ['ok'])
        && stableEqual(manifest.source.foreignKeyCheck, []), 'Authority snapshot source does not carry the read-only integrity contract.');
    const sourceAbsolutePath = assertCleanAbsolutePath(manifest.source?.absolutePath, 'Authority snapshot source.absolutePath');
    const sourceRealPath = assertCleanAbsolutePath(manifest.source?.realPath, 'Authority snapshot source.realPath');
    assertCondition(samePath(sourceAbsolutePath, sourceRealPath), 'Authority snapshot source absolutePath/realPath binding is invalid.');
    assertArtifactDescriptor(manifest.source.artifactBefore, 'Authority snapshot source.artifactBefore');
    assertArtifactDescriptor(manifest.source.artifactAfter, 'Authority snapshot source.artifactAfter');
    assertCondition(manifest.snapshot?.openedReadOnly === true
        && manifest.snapshot.queryOnly === true
        && stableEqual(manifest.snapshot.integrityCheck, ['ok'])
        && stableEqual(manifest.snapshot.foreignKeyCheck, []), 'Authority snapshot database does not carry the read-only integrity contract.');
    assertCondition(!samePath(sourceAbsolutePath, authoritySnapshot.databasePath), 'Authority snapshot may not alias the live source database.');
    normalizePackageIdentity(manifest.packageIdentity, 'Authority snapshot packageIdentity');
}

function deriveCanonicalUserDataBoundary(authoritySnapshot) {
    const sourcePath = assertCleanAbsolutePath(authoritySnapshot.manifest.source.absolutePath, 'Authority snapshot source database');
    assertCondition(path.basename(sourcePath).toLowerCase() === AUTHORITY_DATABASE_NAME, `Authority snapshot source must be the canonical ${AUTHORITY_DATABASE_NAME} USER_DATA_DIR database.`);
    const sourceArtifact = assertUniqueRegularFile(sourcePath, 'Live USER_DATA_DIR authority database');
    const userDataDir = assertDirectDirectory(path.dirname(sourceArtifact.path), 'Authority snapshot source USER_DATA_DIR');
    assertCondition(samePath(sourceArtifact.path, path.join(userDataDir, AUTHORITY_DATABASE_NAME)), 'Authority snapshot source is not the canonical USER_DATA_DIR database location.');
    const storesRoot = assertDirectDirectory(path.join(userDataDir, 'stores'), 'Canonical USER_DATA_DIR stores root');
    assertCondition(isPathContained(userDataDir, storesRoot) && samePath(path.dirname(storesRoot), userDataDir), 'Canonical stores root is not a direct USER_DATA_DIR child.');
    return {
        sourceDatabasePath: sourceArtifact.path,
        storesRoot,
        userDataDir,
    };
}

function captureLiveAuthorityCurrentness(authoritySnapshot, context, captureLabel) {
    const capture = context.captureAuthoritySnapshotCurrentness
        ?? captureAuthoritySnapshotCurrentness;
    assertCondition(typeof capture === 'function', 'Authority currentness capture implementation is invalid.');
    return capture({
        sourceDatabasePath: authoritySnapshot.manifest.source.absolutePath,
        expectedSnapshotArtifact: authoritySnapshot.snapshotArtifact,
        captureLabel,
    }, {
        ...(context.authorityCurrentnessContext ?? {}),
        now: context.now,
    });
}

function inspectCurrentPackage(context) {
    const inspected = context.inspectCanonicalPackage();
    const packageIdentity = normalizePackageIdentity(inspected?.packageIdentity, 'Current canonical package identity');
    assertCondition(Number.isFinite(inspected?.builtAtMs) && inspected.builtAtMs > 0, 'Current canonical package build timestamp is invalid.');
    return { packageIdentity, builtAtMs: inspected.builtAtMs };
}

module.exports = { validateAuthoritySnapshotV2, deriveCanonicalUserDataBoundary, captureLiveAuthorityCurrentness, inspectCurrentPackage };
