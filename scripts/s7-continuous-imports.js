// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { assertUniqueRegularFile, cleanNormalizedFilePath, normalizedDirectPath, realpathIsContained, requestedPathEqualsRealpath, sha256File } = require('./s7-continuous-artifacts.js');
const { importRunKey, isPathContained, isSha256, lower, sameNonEmptyIdentity } = require('./s7-continuous-contracts.js');
const { normalizedTimestamp } = require('./s7-continuous-lineage.js');

function fileCaptureIdentity(file) {
    const capturedAt = normalizedTimestamp(file.capturedAt);
    if (!capturedAt)
        return '';
    return [
        lower(file.storeId),
        String(file.runId ?? ''),
        String(file.reportType ?? ''),
        capturedAt,
    ].join('|');
}

function duplicateContentConflictReasons(existing, current, runByKey) {
    const reasons = [];
    const existingFile = existing.file;
    const existingRun = runByKey.get(existing.runKey);
    const currentRunKey = importRunKey(current.storeId, current.runId);
    const currentRun = runByKey.get(currentRunKey);
    const differentRun = existing.runKey !== currentRunKey;
    const independentlyEmpty = Number.isSafeInteger(existingFile.importedRows)
        && existingFile.importedRows === 0
        && Number.isSafeInteger(current.importedRows)
        && current.importedRows === 0;
    if (!independentlyEmpty)
        reasons.push('content:non-empty');
    if (sameNonEmptyIdentity(existingFile.runId, current.runId))
        reasons.push('lineage:run');
    if (sameNonEmptyIdentity(existingFile.batchId, current.batchId))
        reasons.push('lineage:batch');
    const existingPath = cleanNormalizedFilePath(existingFile.filePath);
    const currentPath = cleanNormalizedFilePath(current.filePath);
    if (existingPath && currentPath && existingPath === currentPath)
        reasons.push('path');
    if (differentRun
        && sameNonEmptyIdentity(existingRun?.batchRequestId, currentRun?.batchRequestId))
        reasons.push('request');
    const existingCapture = fileCaptureIdentity(existingFile);
    const currentCapture = fileCaptureIdentity(current);
    if (existingCapture && existingCapture === currentCapture)
        reasons.push('capture');
    return [...new Set(reasons)];
}

function validateGlobalImportProofs(snapshot, input, addViolation) {
    const invalidRunKeys = new Set();
    const verifiedFileArtifacts = [];
    const runByKey = new Map(snapshot.imports.map((run) => [importRunKey(run.storeId, run.runId), run]));
    let storesRoot = null;
    try {
        storesRoot = path.resolve(input.storesRoot);
        const rootLstat = fs.lstatSync(storesRoot);
        const rootStat = fs.statSync(storesRoot);
        if (rootLstat.isSymbolicLink()
            || !rootStat.isDirectory()
            || !requestedPathEqualsRealpath(storesRoot)) {
            throw new Error('not one canonical direct directory');
        }
    }
    catch (error) {
        addViolation('STORES_ROOT_INVALID', 'Store Capsule root must be the canonical direct USER_DATA_DIR/stores directory.', { detail: error instanceof Error ? error.message : String(error) });
    }
    const seenFingerprints = new Map();
    for (const run of snapshot.imports) {
        const runKey = importRunKey(run.storeId, run.runId);
        const fingerprint = typeof run.inputFingerprint === 'string'
            ? run.inputFingerprint.toUpperCase()
            : '';
        if (!isSha256(fingerprint)) {
            invalidRunKeys.add(runKey);
            addViolation('IMPORT_FINGERPRINT_INVALID', 'Every import inputFingerprint must be one non-empty SHA-256.', { storeId: lower(run.storeId), businessDate: run.businessDate, runId: run.runId });
            continue;
        }
        const existing = seenFingerprints.get(fingerprint);
        if (existing) {
            invalidRunKeys.add(runKey);
            invalidRunKeys.add(existing.runKey);
            addViolation('DUPLICATE_IMPORT_FINGERPRINT', 'One inputFingerprint may appear only once across the complete two-store seven-day window.', {
                storeId: lower(run.storeId),
                businessDate: run.businessDate,
                runIds: [existing.runId, run.runId],
            });
        }
        else {
            seenFingerprints.set(fingerprint, { runId: run.runId, runKey });
        }
    }
    const seenHashes = new Map();
    const seenPaths = new Map();
    for (const file of snapshot.importFiles) {
        const runKey = importRunKey(file.storeId, file.runId);
        const run = runByKey.get(runKey);
        if (!run || file.batchId !== run.batchId) {
            invalidRunKeys.add(runKey);
            addViolation('IMPORT_FILE_LINEAGE_INVALID', 'Every imported file snapshot must bind to its exact store/run/batch.', { storeId: lower(file.storeId), runId: file.runId, batchId: file.batchId });
        }
        const fileHash = typeof file.fileHash === 'string' ? file.fileHash.toUpperCase() : '';
        if (!isSha256(fileHash)) {
            invalidRunKeys.add(runKey);
            addViolation('IMPORT_FILE_HASH_INVALID', 'Every imported file snapshot must contain one non-empty SHA-256.', { storeId: lower(file.storeId), runId: file.runId, reportType: file.reportType });
        }
        else {
            const existingEntries = seenHashes.get(fileHash) ?? [];
            const conflicts = existingEntries
                .map((existing) => ({
                existing,
                reasons: duplicateContentConflictReasons(existing, file, runByKey),
            }))
                .filter(({ reasons }) => reasons.length > 0);
            if (conflicts.length > 0) {
                const { existing, reasons } = conflicts[0];
                invalidRunKeys.add(runKey);
                for (const conflict of conflicts)
                    invalidRunKeys.add(conflict.existing.runKey);
                addViolation('DUPLICATE_IMPORT_FILE_HASH', 'Repeated report bytes are allowed only for independent empty reports and otherwise conflict with durable provenance.', {
                    storeId: lower(file.storeId),
                    runId: file.runId,
                    otherRunId: existing.file.runId,
                    reportType: file.reportType,
                    conflicts: reasons,
                });
                addViolation('DUPLICATE_IMPORT_FILE', 'The same report bytes were reused with conflicting durable provenance.', {
                    storeId: lower(file.storeId),
                    runIds: [existing.file.runId, file.runId],
                    conflicts: reasons,
                });
            }
            existingEntries.push({ file, runKey });
            seenHashes.set(fileHash, existingEntries);
        }
        let resolvedFilePath = null;
        try {
            if (typeof file.filePath !== 'string'
                || file.filePath !== file.filePath.trim()
                || !path.isAbsolute(file.filePath)
                || file.filePath.includes('\0')) {
                throw new Error('filePath is not a clean absolute path');
            }
            resolvedFilePath = path.resolve(file.filePath);
            const storeRoot = storesRoot && path.join(storesRoot, lower(file.storeId));
            if (!storesRoot
                || !storeRoot
                || !isPathContained(storeRoot, resolvedFilePath)
                || !realpathIsContained(storeRoot, resolvedFilePath)) {
                invalidRunKeys.add(runKey);
                addViolation('FILE_PATH_OUTSIDE_STORE_CAPSULE', 'Imported report file must remain inside USER_DATA_DIR/stores/<storeId>/....', { storeId: lower(file.storeId), runId: file.runId, filePath: file.filePath });
            }
            const { resolved, stat } = assertUniqueRegularFile(resolvedFilePath, 'Imported report file');
            if (String(file.fileName ?? '') !== path.basename(resolved)) {
                throw new Error('fileName does not match the canonical filePath basename');
            }
            const actualHash = sha256File(resolved);
            if (!Number.isInteger(Number(file.fileSizeBytes))
                || Number(file.fileSizeBytes) <= 0
                || stat.size !== Number(file.fileSizeBytes)
                || actualHash !== fileHash) {
                invalidRunKeys.add(runKey);
                addViolation('IMPORT_FILE_BYTES_MISMATCH', 'Imported report file size/SHA-256 must match the current unique regular file.', { storeId: lower(file.storeId), runId: file.runId, filePath: resolved });
            }
            else {
                verifiedFileArtifacts.push({
                    filePath: resolved,
                    runKey,
                    sha256: actualHash,
                    sizeBytes: stat.size,
                });
            }
        }
        catch (error) {
            invalidRunKeys.add(runKey);
            addViolation('IMPORT_FILE_PATH_INVALID', 'Imported report file must be one canonical unique regular file.', {
                storeId: lower(file.storeId),
                runId: file.runId,
                filePath: file.filePath,
                detail: error instanceof Error ? error.message : String(error),
            });
        }
        if (resolvedFilePath) {
            const normalizedPath = normalizedDirectPath(resolvedFilePath);
            const existing = seenPaths.get(normalizedPath);
            if (existing) {
                invalidRunKeys.add(runKey);
                invalidRunKeys.add(existing.runKey);
                addViolation('DUPLICATE_IMPORT_FILE_PATH', 'One canonical report file path may appear only once across all stores, days and report types.', { storeId: lower(file.storeId), runId: file.runId, otherRunId: existing.runId });
            }
            else {
                seenPaths.set(normalizedPath, { runId: file.runId, runKey });
            }
        }
    }
    return { invalidRunKeys, verifiedFileArtifacts };
}

function detectCrossStoreLeakage(snapshot, storeById, addViolation) {
    const profileOwners = new Map();
    for (const store of storeById.values()) {
        const profileId = String(store.browserProfileId ?? '').trim();
        const existingOwner = profileOwners.get(profileId);
        if (!profileId || (existingOwner && existingOwner !== lower(store.storeId))) {
            addViolation('CROSS_STORE_PROFILE_IDENTITY', 'Each store must own one distinct non-empty browser Profile identity.', {
                storeId: lower(store.storeId),
                browserProfileId: profileId,
                otherStoreId: existingOwner,
            });
        }
        else
            profileOwners.set(profileId, lower(store.storeId));
    }
    for (const job of snapshot.jobs) {
        const store = storeById.get(lower(job.storeId));
        if (!store || job.browserProfileId !== store.browserProfileId || job.marketplace !== 'US' || job.currency !== 'USD') {
            addViolation('CROSS_STORE_JOB_IDENTITY', 'Collection job identity does not match its store authority.', { storeId: lower(job.storeId), jobId: job.jobId });
        }
    }
    const runStores = new Map();
    for (const run of snapshot.imports) {
        const runId = String(run.runId);
        const storeId = lower(run.storeId);
        const existingOwner = runStores.get(runId);
        if (existingOwner && existingOwner !== storeId) {
            addViolation('CROSS_STORE_IMPORT_RUN_IDENTITY', 'One import run identity cannot be owned by different stores.', {
                storeId,
                otherStoreId: existingOwner,
                runId,
            });
        }
        else {
            runStores.set(runId, storeId);
        }
    }
    const runByKey = new Map(snapshot.imports.map((run) => [importRunKey(run.storeId, run.runId), run]));
    const fingerprintOwners = new Map();
    for (const run of snapshot.imports) {
        const fingerprint = String(run.inputFingerprint ?? '').trim();
        const owner = fingerprintOwners.get(fingerprint);
        if (fingerprint && owner && owner !== lower(run.storeId)) {
            addViolation('CROSS_STORE_IMPORT_FINGERPRINT', 'One import fingerprint cannot be shared by different stores.', {
                storeId: lower(run.storeId),
                otherStoreId: owner,
                runId: run.runId,
            });
        }
        else if (fingerprint)
            fingerprintOwners.set(fingerprint, lower(run.storeId));
    }
    const fileHashOwners = new Map();
    for (const file of snapshot.importFiles) {
        if (runStores.get(String(file.runId)) !== lower(file.storeId)) {
            addViolation('CROSS_STORE_IMPORT_FILE', 'Import file snapshot references a run owned by another store.', { storeId: lower(file.storeId), runId: file.runId });
        }
        const fileHash = String(file.fileHash ?? '').trim().toUpperCase();
        const existingEntries = fileHashOwners.get(fileHash) ?? [];
        const conflict = existingEntries
            .filter((existing) => lower(existing.file.storeId) !== lower(file.storeId))
            .map((existing) => ({
            existing,
            reasons: duplicateContentConflictReasons(existing, file, runByKey),
        }))
            .find(({ reasons }) => reasons.length > 0);
        if (fileHash && conflict) {
            addViolation('CROSS_STORE_IMPORT_FILE_HASH', 'Shared report bytes conflict with cross-store durable provenance.', {
                storeId: lower(file.storeId),
                otherStoreId: lower(conflict.existing.file.storeId),
                runId: file.runId,
                conflicts: conflict.reasons,
            });
        }
        if (fileHash) {
            existingEntries.push({
                file,
                runKey: importRunKey(file.storeId, file.runId),
            });
            fileHashOwners.set(fileHash, existingEntries);
        }
    }
}

module.exports = { fileCaptureIdentity, duplicateContentConflictReasons, validateGlobalImportProofs, detectCrossStoreLeakage };
