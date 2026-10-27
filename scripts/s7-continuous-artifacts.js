// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PACKAGE_IDENTITY_FIELDS, fail, isPathContained, isSha256 } = require('./s7-continuous-contracts.js');

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function fileArtifact(filePath) {
    const stat = fs.statSync(filePath);
    return {
        mtimeMs: stat.mtimeMs,
        sha256: sha256File(filePath),
        sizeBytes: stat.size,
    };
}

function requestedPathEqualsRealpath(candidatePath) {
    try {
        return path.resolve(candidatePath).toLowerCase()
            === fs.realpathSync.native(candidatePath).toLowerCase();
    }
    catch {
        return false;
    }
}

function assertDirectDirectory(directoryPath, label) {
    const resolved = path.resolve(directoryPath);
    if (!fs.existsSync(resolved))
        fail(`${label} does not exist: ${resolved}`);
    const linkStat = fs.lstatSync(resolved);
    const stat = fs.statSync(resolved);
    if (linkStat.isSymbolicLink() || !stat.isDirectory() || !requestedPathEqualsRealpath(resolved)) {
        fail(`${label} must be a direct real directory without symlink, junction, or reparse traversal.`);
    }
    return resolved;
}

function assertUniqueRegularFile(filePath, label) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved))
        fail(`${label} does not exist: ${resolved}`);
    const linkStat = fs.lstatSync(resolved);
    const stat = fs.statSync(resolved);
    if (linkStat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || !requestedPathEqualsRealpath(resolved)) {
        fail(`${label} must be one unique regular file without symlink, reparse, or hardlink traversal.`);
    }
    return { resolved, stat };
}

function normalizePackageIdentity(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('Authority snapshot packageIdentity is missing.');
    }
    const normalized = {};
    for (const field of PACKAGE_IDENTITY_FIELDS) {
        if (!isSha256(value[field]))
            fail(`Authority snapshot packageIdentity.${field} is invalid.`);
        normalized[field] = String(value[field]).toUpperCase();
    }
    return normalized;
}

function normalizedArtifactDescriptor(value, label) {
    if (!value
        || typeof value !== 'object'
        || Array.isArray(value)
        || !isSha256(value.sha256)
        || !Number.isInteger(Number(value.sizeBytes))
        || Number(value.sizeBytes) <= 0
        || !Number.isFinite(Number(value.mtimeMs))) {
        fail(`${label} is invalid.`);
    }
    return {
        mtimeMs: Number(value.mtimeMs),
        sha256: String(value.sha256).toUpperCase(),
        sizeBytes: Number(value.sizeBytes),
    };
}

function sameArtifact(left, right) {
    return left.sha256 === right.sha256
        && left.sizeBytes === right.sizeBytes
        && left.mtimeMs === right.mtimeMs;
}

function normalizedDirectPath(filePath) {
    return path.resolve(filePath).toLowerCase();
}

function realpathIsContained(rootPath, candidatePath) {
    try {
        return isPathContained(fs.realpathSync.native(rootPath), fs.realpathSync.native(candidatePath));
    }
    catch {
        return false;
    }
}

function cleanNormalizedFilePath(filePath) {
    if (typeof filePath !== 'string'
        || filePath !== filePath.trim()
        || !path.isAbsolute(filePath)
        || filePath.includes('\0'))
        return null;
    return normalizedDirectPath(filePath);
}

function assertSafeExistingAncestor(candidatePath, label) {
    let cursor = path.resolve(candidatePath);
    while (!fs.existsSync(cursor)) {
        const parent = path.dirname(cursor);
        if (parent === cursor)
            fail(`${label} has no existing filesystem ancestor.`);
        cursor = parent;
    }
    assertDirectDirectory(cursor, `${label} ancestor`);
}

function pathsOverlap(left, right) {
    return isPathContained(left, right) || isPathContained(right, left);
}

module.exports = { sha256File, fileArtifact, requestedPathEqualsRealpath, assertDirectDirectory, assertUniqueRegularFile, normalizePackageIdentity, normalizedArtifactDescriptor, sameArtifact, normalizedDirectPath, realpathIsContained, cleanNormalizedFilePath, assertSafeExistingAncestor, pathsOverlap };
