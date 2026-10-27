// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { OFFLINE_SIDECAR_SUFFIXES, fail, samePath } = require('./s7-live-migration-contracts.js');

function assertCleanAbsolutePath(candidatePath, label) {
    if (typeof candidatePath !== 'string'
        || candidatePath !== candidatePath.trim()
        || candidatePath.length === 0
        || candidatePath.includes('\0')
        || !path.isAbsolute(candidatePath)) {
        fail(`${label} must be a clean absolute path.`);
    }
    return path.resolve(candidatePath);
}

function entryExists(candidatePath) {
    try {
        fs.lstatSync(candidatePath);
        return true;
    }
    catch (error) {
        if (error?.code === 'ENOENT')
            return false;
        throw error;
    }
}

function assertDirectExistingPath(candidatePath, label, expectedKind) {
    const resolved = assertCleanAbsolutePath(candidatePath, label);
    let lstat;
    try {
        lstat = fs.lstatSync(resolved);
    }
    catch (error) {
        if (error?.code === 'ENOENT')
            fail(`${label} does not exist: ${resolved}`);
        throw error;
    }
    if (lstat.isSymbolicLink()) {
        fail(`${label} may not be a symbolic link, junction, or reparse point: ${resolved}`);
    }
    const realPath = fs.realpathSync.native(resolved);
    if (!samePath(resolved, realPath)) {
        fail(`${label} may not traverse a symbolic link, junction, or reparse point: ${resolved}`);
    }
    const stat = fs.statSync(realPath);
    if (expectedKind === 'file' && !stat.isFile())
        fail(`${label} must be a regular file.`);
    if (expectedKind === 'directory' && !stat.isDirectory())
        fail(`${label} must be a real directory.`);
    return { realPath, stat };
}

function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    const handle = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        let bytesRead;
        do {
            bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
            if (bytesRead > 0)
                hash.update(buffer.subarray(0, bytesRead));
        } while (bytesRead > 0);
    }
    finally {
        fs.closeSync(handle);
    }
    return hash.digest('hex').toUpperCase();
}

function normalizeSha256(value, label) {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!/^[A-F0-9]{64}$/.test(normalized)) {
        fail(`${label} must be exactly 64 hexadecimal characters.`);
    }
    return normalized;
}

function fileArtifact(filePath, label) {
    const resolved = assertCleanAbsolutePath(filePath, label);
    const directBefore = assertDirectExistingPath(resolved, label, 'file');
    if (directBefore.stat.nlink !== 1) {
        fail(`${label} must have exactly one hard link.`);
    }
    const handle = fs.openSync(directBefore.realPath, 'r');
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesReadTotal = 0;
    let handleBefore;
    let handleAfter;
    let directAfter;
    try {
        handleBefore = fs.fstatSync(handle);
        if (!sameStableFileStat(directBefore.stat, handleBefore)) {
            fail(`${label} changed identity before hashing began.`);
        }
        let bytesRead;
        do {
            bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
            if (bytesRead > 0) {
                hash.update(buffer.subarray(0, bytesRead));
                bytesReadTotal += bytesRead;
            }
        } while (bytesRead > 0);
        handleAfter = fs.fstatSync(handle);
        if (!sameStableFileStat(handleBefore, handleAfter)
            || bytesReadTotal !== handleBefore.size) {
            fail(`${label} changed while it was being hashed.`);
        }
        directAfter = assertDirectExistingPath(resolved, label, 'file');
        if (!sameStableFileStat(handleAfter, directAfter.stat)
            || !samePath(directAfter.realPath, directBefore.realPath)) {
            fail(`${label} path was replaced while it was being hashed.`);
        }
    }
    finally {
        fs.closeSync(handle);
    }
    return Object.freeze({
        path: resolved,
        realPath: directAfter.realPath,
        identity: statIdentity(handleAfter, directAfter.realPath),
        sha256: hash.digest('hex').toUpperCase(),
        sizeBytes: bytesReadTotal,
        mtimeMs: handleAfter.mtimeMs,
    });
}

function statIdentity(stat, realPath) {
    return Object.freeze({
        realPath,
        dev: Number(stat.dev),
        ino: Number(stat.ino),
        birthtimeMs: stat.birthtimeMs,
        nlink: Number(stat.nlink),
    });
}

function sameCreatedIdentity(left, right) {
    return samePath(left.realPath, right.realPath)
        && left.dev === right.dev
        && left.ino === right.ino
        && left.birthtimeMs === right.birthtimeMs
        && left.nlink === right.nlink;
}

function sameStableFileStat(left, right) {
    return Number(left.dev) === Number(right.dev)
        && Number(left.ino) === Number(right.ino)
        && Number(left.nlink) === Number(right.nlink)
        && left.birthtimeMs === right.birthtimeMs
        && left.size === right.size
        && left.mtimeMs === right.mtimeMs
        && left.ctimeMs === right.ctimeMs;
}

function sameMainArtifact(left, right) {
    return left.realPath === right.realPath
        && left.sha256 === right.sha256
        && left.sizeBytes === right.sizeBytes
        && left.mtimeMs === right.mtimeMs;
}

function sameFileArtifact(left, right) {
    return sameCreatedIdentity(left.identity, right.identity)
        && left.sha256 === right.sha256
        && left.sizeBytes === right.sizeBytes
        && left.mtimeMs === right.mtimeMs;
}

function openOfflineReadOnly(Database, databasePath) {
    assertOfflineSidecarsAbsent(databasePath, 'Offline database');
    const bytes = fs.readFileSync(databasePath);
    if (bytes[18] === 2 && bytes[19] === 2) {
        bytes[18] = 1;
        bytes[19] = 1;
        return new Database(bytes, { readonly: true });
    }
    return new Database(databasePath, { readonly: true, fileMustExist: true });
}

function assertOfflineSidecarsAbsent(databasePath, label) {
    const present = OFFLINE_SIDECAR_SUFFIXES
        .map((suffix) => `${databasePath}${suffix}`)
        .filter(entryExists);
    if (present.length > 0) {
        fail(`${label} has pre-existing or persistent SQLite sidecar files: ${present.map((candidate) => path.basename(candidate)).join(', ')}`);
    }
}

function readJsonArtifact(filePath, label, injectedHooks = {}) {
    const resolved = assertCleanAbsolutePath(filePath, label);
    const directBefore = assertDirectExistingPath(resolved, label, 'file');
    if (directBefore.stat.nlink !== 1) {
        fail(`${label} must have exactly one hard link.`);
    }
    const handle = fs.openSync(directBefore.realPath, 'r');
    let bytes;
    let handleBefore;
    let handleAfter;
    let directAfter;
    try {
        handleBefore = fs.fstatSync(handle);
        if (!sameStableFileStat(directBefore.stat, handleBefore)) {
            fail(`${label} changed identity before its stable read began.`);
        }
        bytes = fs.readFileSync(handle);
        if (typeof injectedHooks.afterRead === 'function') {
            injectedHooks.afterRead({
                bytes,
                filePath: resolved,
                realPath: directBefore.realPath,
            });
        }
        handleAfter = fs.fstatSync(handle);
        if (!sameStableFileStat(handleBefore, handleAfter) || bytes.length !== handleBefore.size) {
            fail(`${label} changed while its bytes were being read.`);
        }
        directAfter = assertDirectExistingPath(resolved, label, 'file');
        if (!sameStableFileStat(handleAfter, directAfter.stat)
            || !samePath(directAfter.realPath, directBefore.realPath)) {
            fail(`${label} path was replaced while its bytes were being read.`);
        }
    }
    finally {
        fs.closeSync(handle);
    }
    const artifact = Object.freeze({
        path: resolved,
        realPath: directAfter.realPath,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
        sizeBytes: bytes.length,
        mtimeMs: handleAfter.mtimeMs,
    });
    let value;
    try {
        value = JSON.parse(bytes.toString('utf8'));
    }
    catch (error) {
        fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail(`${label} must contain one JSON object.`);
    }
    return { artifact, value };
}

function assertOutputAvailable(outputPath) {
    const resolved = assertCleanAbsolutePath(outputPath, '--out');
    if (path.extname(resolved).toLowerCase() !== '.json') {
        fail('--out must name a .json file.');
    }
    assertDirectExistingPath(path.dirname(resolved), 'Acceptance output parent', 'directory');
    if (entryExists(resolved)) {
        fail(`Acceptance output already exists and will not be overwritten: ${resolved}`);
    }
    return resolved;
}

module.exports = { assertCleanAbsolutePath, entryExists, assertDirectExistingPath, sha256File, normalizeSha256, fileArtifact, statIdentity, sameCreatedIdentity, sameStableFileStat, sameMainArtifact, sameFileArtifact, openOfflineReadOnly, assertOfflineSidecarsAbsent, readJsonArtifact, assertOutputAvailable };
