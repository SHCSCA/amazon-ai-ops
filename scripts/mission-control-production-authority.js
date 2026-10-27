// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION, assertMatchingAuthorityCurrentnessProofs, captureAuthoritySnapshotCurrentness, } = require('./sqlite-authority-currentness');
const { AUTHORITY_SNAPSHOT_BACKUP_METHOD, AUTHORITY_SNAPSHOT_KIND, AUTHORITY_SNAPSHOT_SCHEMA_VERSION, currentFileMatches, isPathContained, isPositiveInteger, isRecord, isSha256, latestTreeMtimeMs, nonEmpty, normalizeSha256, pushReason, realpathEquals, realpathIsContained, requestedPathEqualsRealpath, requireFromLocalDb, sha256File, sqliteIntegrityCheck, stableEqual, validTimestamp, validationResult } = require('./mission-control-production-contracts.js');

function inspectCanonicalPackage(context) {
    const reasons = [];
    const expectedRelease = path.resolve(context.releaseRoot);
    pushReason(reasons, fs.existsSync(expectedRelease), 'canonical repository release root is missing');
    if (!fs.existsSync(expectedRelease))
        return validationResult(reasons, { packageIdentity: null, builtAtMs: null });
    pushReason(reasons, realpathEquals(expectedRelease, context.releaseRoot), 'canonical repository release root did not pass realpath validation');
    for (const [label, candidate] of [
        ['win-unpacked executable', context.executablePath],
        ['resources/app', context.appContentPath],
        ['main bundle', context.mainBundlePath],
    ]) {
        pushReason(reasons, isPathContained(expectedRelease, candidate), `canonical ${label} escapes the repository release root`);
        pushReason(reasons, fs.existsSync(candidate), `canonical ${label} is missing`);
    }
    if (reasons.length > 0)
        return validationResult(reasons, { packageIdentity: null, builtAtMs: null });
    try {
        const exeStat = fs.statSync(context.executablePath);
        const mainStat = fs.statSync(context.mainBundlePath);
        pushReason(reasons, requestedPathEqualsRealpath(context.executablePath) && exeStat.isFile() && exeStat.nlink === 1, 'canonical win-unpacked executable is not a unique regular file or traverses a reparse point');
        pushReason(reasons, requestedPathEqualsRealpath(context.mainBundlePath) && mainStat.isFile() && mainStat.nlink === 1, 'canonical main bundle is not a unique regular file or traverses a reparse point');
        const { buildAppContentManifest } = require('./package-ui-evidence');
        const beforeExe = sha256File(context.executablePath);
        const beforeMain = sha256File(context.mainBundlePath);
        const appContent = buildAppContentManifest(context.appContentPath);
        const afterExe = sha256File(context.executablePath);
        const afterMain = sha256File(context.mainBundlePath);
        pushReason(reasons, beforeExe === afterExe && beforeMain === afterMain, 'canonical package changed while hashes were recomputed');
        return validationResult(reasons, {
            packageIdentity: {
                executableSha256: afterExe,
                appContentSha256: normalizeSha256(appContent.sha256),
                mainBundleSha256: afterMain,
            },
            builtAtMs: Math.max(exeStat.mtimeMs, mainStat.mtimeMs, latestTreeMtimeMs(context.appContentPath)),
        });
    }
    catch (error) {
        reasons.push(`canonical package could not be recomputed: ${error instanceof Error ? error.message : String(error)}`);
        return validationResult(reasons, { packageIdentity: null, builtAtMs: null });
    }
}

function validateAuthoritySnapshotManifest(selection, context, canonicalPackage) {
    const reasons = [];
    const manifest = selection?.evidence;
    pushReason(reasons, isRecord(manifest), 'authority snapshot manifest is missing or invalid');
    if (!isRecord(manifest))
        return validationResult(reasons);
    pushReason(reasons, manifest.kind === AUTHORITY_SNAPSHOT_KIND, 'authority snapshot manifest kind is invalid');
    pushReason(reasons, manifest.schemaVersion === AUTHORITY_SNAPSHOT_SCHEMA_VERSION, `authority snapshot manifest must use ${AUTHORITY_SNAPSHOT_SCHEMA_VERSION}; v1 is rejected fail-closed`);
    pushReason(reasons, validTimestamp(manifest.exportedAt), 'authority snapshot exportedAt is invalid');
    pushReason(reasons, manifest.backup?.method === AUTHORITY_SNAPSHOT_BACKUP_METHOD, 'authority snapshot backup method is not SQLite online backup');
    pushReason(reasons, validTimestamp(manifest.backup?.startedAt), 'authority snapshot backup startedAt is invalid');
    pushReason(reasons, validTimestamp(manifest.backup?.completedAt), 'authority snapshot backup completedAt is invalid');
    pushReason(reasons, validTimestamp(manifest.backup?.startedAt)
        && validTimestamp(manifest.backup?.completedAt)
        && Date.parse(manifest.backup.startedAt) <= Date.parse(manifest.backup.completedAt), 'authority snapshot backup timestamps are out of order');
    pushReason(reasons, manifest.exportedAt === manifest.backup?.completedAt, 'authority snapshot exportedAt is not bound to backup completion');
    pushReason(reasons, manifest.backup?.completed === true, 'authority snapshot online backup did not declare completion');
    pushReason(reasons, isPositiveInteger(manifest.backup?.totalPages), 'authority snapshot online backup totalPages is invalid');
    pushReason(reasons, manifest.backup?.remainingPages === 0, 'authority snapshot online backup has remaining pages');
    pushReason(reasons, nonEmpty(context.authorityDbPath), `canonical authority database is unavailable: ${context.authorityDbError || 'not selected'}`);
    pushReason(reasons, nonEmpty(manifest.source?.absolutePath)
        && path.basename(manifest.source.absolutePath).toLowerCase() === 'amazon-ai-ops.db', 'authority snapshot source must be the canonical USER_DATA_DIR/amazon-ai-ops.db filename');
    pushReason(reasons, realpathEquals(manifest.source?.absolutePath, context.authorityDbPath), 'authority snapshot source is not the canonical live AppData database');
    pushReason(reasons, realpathEquals(manifest.source?.realPath, context.authorityDbPath), 'authority snapshot source realpath is not canonical');
    pushReason(reasons, manifest.source?.openedReadOnly === true, 'authority snapshot source was not opened read-only');
    pushReason(reasons, manifest.source?.queryOnly === true, 'authority snapshot source did not prove SQLite query_only mode');
    pushReason(reasons, stableEqual(manifest.source?.integrityCheck, ['ok']), 'authority snapshot source integrity_check proof is invalid');
    pushReason(reasons, stableEqual(manifest.source?.foreignKeyCheck, []), 'authority snapshot source foreign_key_check proof is invalid');
    for (const [label, record] of [
        ['before', manifest.source?.artifactBefore],
        ['after', manifest.source?.artifactAfter],
    ]) {
        pushReason(reasons, isRecord(record)
            && isSha256(record.sha256)
            && Number.isInteger(record.sizeBytes)
            && record.sizeBytes > 0
            && Number.isFinite(record.mtimeMs), `authority snapshot source ${label} artifact proof is invalid`);
    }
    pushReason(reasons, stableEqual(manifest.source?.artifactBefore, manifest.source?.artifactAfter), 'authority snapshot source artifactBefore and artifactAfter do not prove one unchanged live database');
    try {
        const sourcePath = path.resolve(manifest.source?.absolutePath);
        const sourceStatBefore = fs.statSync(sourcePath);
        pushReason(reasons, requestedPathEqualsRealpath(sourcePath)
            && !fs.lstatSync(sourcePath).isSymbolicLink()
            && sourceStatBefore.isFile()
            && sourceStatBefore.nlink === 1, 'authority snapshot source is linked, reparsed, or not a unique regular file');
        const sourceSha256Before = sha256File(sourcePath);
        const sourceStatDuring = fs.statSync(sourcePath);
        const sourceSha256After = sha256File(sourcePath);
        const sourceStatAfter = fs.statSync(sourcePath);
        pushReason(reasons, sourceSha256Before === sourceSha256After
            && sourceStatBefore.size === sourceStatDuring.size
            && sourceStatBefore.size === sourceStatAfter.size
            && sourceStatBefore.mtimeMs === sourceStatDuring.mtimeMs
            && sourceStatBefore.mtimeMs === sourceStatAfter.mtimeMs, 'authority snapshot live source changed while formal bytes/size/mtime were recomputed');
        pushReason(reasons, normalizeSha256(manifest.source?.artifactAfter?.sha256) === sourceSha256After
            && Number(manifest.source?.artifactAfter?.sizeBytes) === sourceStatAfter.size
            && Number(manifest.source?.artifactAfter?.mtimeMs) === sourceStatAfter.mtimeMs, 'authority snapshot live source bytes/size/mtime drifted after snapshot export');
    }
    catch {
        reasons.push('authority snapshot source cannot be resolved as the selected unique live database');
    }
    const snapshotPath = manifest.snapshot?.absolutePath;
    let snapshotRootReal = null;
    let snapshotReal = null;
    try {
        snapshotRootReal = fs.realpathSync.native(context.authoritySnapshotRoot);
        snapshotReal = fs.realpathSync.native(snapshotPath);
    }
    catch {
    }
    pushReason(reasons, requestedPathEqualsRealpath(context.authoritySnapshotRoot), 'canonical authority snapshot root traverses a reparse point');
    pushReason(reasons, isPathContained(context.authoritySnapshotRoot, selection.evidencePath) && realpathIsContained(context.authoritySnapshotRoot, selection.evidencePath), 'authority snapshot manifest is outside the canonical snapshot root');
    pushReason(reasons, nonEmpty(snapshotPath) && path.isAbsolute(snapshotPath), 'authority snapshot path is missing');
    pushReason(reasons, nonEmpty(snapshotPath) && isPathContained(context.authoritySnapshotRoot, snapshotPath), 'authority snapshot is outside the canonical snapshot root');
    pushReason(reasons, snapshotRootReal && snapshotReal && isPathContained(snapshotRootReal, snapshotReal), 'authority snapshot realpath escapes the canonical snapshot root');
    pushReason(reasons, realpathEquals(snapshotPath, manifest.snapshot?.realPath), 'authority snapshot realpath binding is invalid');
    pushReason(reasons, !realpathEquals(snapshotPath, context.authorityDbPath), 'authority snapshot must be an independent database file');
    pushReason(reasons, manifest.snapshot?.openedReadOnly === true, 'authority snapshot validation was not opened read-only');
    pushReason(reasons, manifest.snapshot?.queryOnly === true, 'authority snapshot validation did not prove SQLite query_only mode');
    pushReason(reasons, stableEqual(manifest.snapshot?.integrityCheck, ['ok']), 'authority snapshot claimed integrity_check proof is invalid');
    pushReason(reasons, stableEqual(manifest.snapshot?.foreignKeyCheck, []), 'authority snapshot claimed foreign_key_check proof is invalid');
    pushReason(reasons, currentFileMatches(manifest.snapshot, 'absolutePath'), 'authority snapshot bytes are missing, linked, or stale');
    pushReason(reasons, stableEqual(manifest.packageIdentity, canonicalPackage.packageIdentity), 'authority snapshot is not bound to the current canonical package identity');
    let snapshotDatabase;
    try {
        const Database = context.Database ?? requireFromLocalDb('better-sqlite3');
        snapshotDatabase = new Database(snapshotPath, { readonly: true, fileMustExist: true });
        snapshotDatabase.pragma('query_only = ON');
        const queryOnly = Number(snapshotDatabase.pragma('query_only', { simple: true })) === 1;
        const integrityCheck = sqliteIntegrityCheck(snapshotDatabase);
        const foreignKeyCheck = snapshotDatabase.pragma('foreign_key_check');
        pushReason(reasons, queryOnly, 'authority snapshot did not enter SQLite query_only mode during formal verification');
        pushReason(reasons, stableEqual(integrityCheck, ['ok']) && stableEqual(integrityCheck, manifest.snapshot?.integrityCheck), 'authority snapshot formal integrity_check did not match the v2 manifest');
        pushReason(reasons, stableEqual(foreignKeyCheck, []) && stableEqual(foreignKeyCheck, manifest.snapshot?.foreignKeyCheck), 'authority snapshot formal foreign_key_check did not match the v2 manifest');
    }
    catch (error) {
        reasons.push(`authority snapshot could not be reopened read-only: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        if (snapshotDatabase)
            snapshotDatabase.close();
    }
    pushReason(reasons, currentFileMatches(manifest.snapshot, 'absolutePath'), 'authority snapshot bytes changed during formal verification');
    return validationResult(reasons, { manifest, snapshotPath: nonEmpty(snapshotPath) ? path.resolve(snapshotPath) : null });
}

function expectedAuthoritySnapshotArtifact(snapshotSelection) {
    const snapshot = snapshotSelection?.evidence?.snapshot;
    if (!isRecord(snapshot)
        || !isSha256(snapshot.sha256)
        || !Number.isInteger(snapshot.sizeBytes)
        || snapshot.sizeBytes <= 0) {
        return null;
    }
    return Object.freeze({
        sha256: normalizeSha256(snapshot.sha256),
        sizeBytes: snapshot.sizeBytes,
    });
}

function captureAuthorityCurrentness(sourceDatabasePath, expectedSnapshotArtifact, captureLabel, injectedContext = null) {
    if (!nonEmpty(sourceDatabasePath)) {
        return {
            ok: false,
            proof: null,
            reason: `WAL-aware authority currentness ${captureLabel} cannot run without the selected live authority database.`,
        };
    }
    if (!expectedSnapshotArtifact) {
        return {
            ok: false,
            proof: null,
            reason: `WAL-aware authority currentness ${captureLabel} cannot run without a valid selected snapshot SHA-256 and size.`,
        };
    }
    try {
        const helperContext = isRecord(injectedContext?.authorityCurrentnessHelperContext)
            ? injectedContext.authorityCurrentnessHelperContext
            : undefined;
        const proof = captureAuthoritySnapshotCurrentness({
            sourceDatabasePath,
            expectedSnapshotArtifact,
            captureLabel,
        }, helperContext);
        return {
            ok: true,
            proof,
            reason: 'WAL-aware read-only SQLite online backup matches the selected authority snapshot.',
        };
    }
    catch (error) {
        return {
            ok: false,
            proof: null,
            reason: `WAL-aware authority currentness ${captureLabel} failed closed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

function publicAuthorityCurrentnessProof(proof) {
    if (!isRecord(proof))
        return null;
    return {
        captureLabel: proof.captureLabel ?? null,
        capturedAt: proof.capturedAt ?? null,
        method: proof.method ?? null,
        sourceReadOnly: proof.source?.openedReadOnly === true && proof.source?.queryOnly === true,
        observedSnapshot: {
            sha256: normalizeSha256(proof.observedBackup?.sha256) || null,
            sizeBytes: Number.isInteger(proof.observedBackup?.sizeBytes)
                ? proof.observedBackup.sizeBytes
                : null,
        },
        matchesSelectedSnapshot: proof.matchesSelectedSnapshot === true,
    };
}

function publicAuthorityCurrentnessSummary(state) {
    const proofs = Array.isArray(state?.proofs) ? state.proofs : [];
    const failures = Array.isArray(state?.failures) ? state.failures : [];
    const captureSummaries = proofs.map(publicAuthorityCurrentnessProof).filter(Boolean);
    const byLabel = new Map(captureSummaries.map((proof) => [proof.captureLabel, proof]));
    return {
        schemaVersion: SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
        method: 'readonly-sqlite-online-backup',
        passed: failures.length === 0 && proofs.length > 0,
        expectedSnapshot: state?.expectedSnapshotArtifact
            ? {
                sha256: state.expectedSnapshotArtifact.sha256,
                sizeBytes: state.expectedSnapshotArtifact.sizeBytes,
            }
            : null,
        captures: captureSummaries,
        beforeFinalWriteCapturedAt: byLabel.get('before-final-report-write')?.capturedAt ?? null,
        afterFinalWriteCapturedAt: byLabel.get('after-final-report-write')?.capturedAt ?? null,
        failures: [...failures],
    };
}

function mergeSnapshotCurrentnessValidation(snapshotValidation, captureResult) {
    if (captureResult.ok) {
        return {
            ...snapshotValidation,
            initialCurrentnessProof: captureResult.proof,
        };
    }
    return {
        ...snapshotValidation,
        ok: false,
        reason: snapshotValidation.reason === 'Evidence passed its production contract.'
            ? captureResult.reason
            : `${snapshotValidation.reason}; ${captureResult.reason}`,
        initialCurrentnessProof: null,
    };
}

module.exports = { inspectCanonicalPackage, validateAuthoritySnapshotManifest, expectedAuthoritySnapshotArtifact, captureAuthorityCurrentness, publicAuthorityCurrentnessProof, publicAuthorityCurrentnessSummary, mergeSnapshotCurrentnessValidation };
