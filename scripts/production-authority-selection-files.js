// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { SIDECAR_SUFFIXES, assertCleanAbsolutePath, entryExists, fail, samePath } = require('./production-authority-selection-contracts.js');

function assertDirectExistingPath(candidatePath, label, expectedKind) {
    const resolved = assertCleanAbsolutePath(candidatePath, label);
    let lstat;
    try {
        lstat = fs.lstatSync(resolved);
    }
    catch (error) {
        if (error?.code === 'ENOENT') {
            fail(`${label} does not exist: ${resolved}`);
        }
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
    if (expectedKind === 'file' && !stat.isFile()) {
        fail(`${label} must be a regular file: ${realPath}`);
    }
    if (expectedKind === 'directory' && !stat.isDirectory()) {
        fail(`${label} must be a real directory: ${realPath}`);
    }
    return { realPath, stat };
}

function assertSafeExistingAncestor(candidatePath, label) {
    let cursor = path.resolve(candidatePath);
    while (!entryExists(cursor)) {
        const parent = path.dirname(cursor);
        if (parent === cursor) {
            fail(`${label} has no existing filesystem ancestor: ${candidatePath}`);
        }
        cursor = parent;
    }
    return assertDirectExistingPath(cursor, `${label} ancestor`, 'directory');
}

function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    const handle = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        let bytesRead = 0;
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

function fileArtifact(filePath) {
    const { realPath, stat } = assertDirectExistingPath(filePath, 'SQLite file', 'file');
    return Object.freeze({
        realPath,
        sha256: sha256File(realPath),
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
    });
}

function sameMainArtifact(left, right) {
    return left.sha256 === right.sha256
        && left.sizeBytes === right.sizeBytes
        && left.mtimeMs === right.mtimeMs;
}

function publicArtifact(artifact) {
    return {
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        mtimeMs: artifact.mtimeMs,
    };
}

function inspectSidecars(databasePath, artifactReader = fileArtifact) {
    return Object.fromEntries(SIDECAR_SUFFIXES.map((suffix) => {
        const sidecarPath = `${databasePath}${suffix}`;
        if (!entryExists(sidecarPath)) {
            return [suffix.slice(1), {
                    exists: false,
                    absolutePath: sidecarPath,
                }];
        }
        const artifact = artifactReader(sidecarPath);
        return [suffix.slice(1), {
                exists: true,
                absolutePath: sidecarPath,
                sha256: artifact.sha256,
                sizeBytes: artifact.sizeBytes,
                mtimeMs: artifact.mtimeMs,
            }];
    }));
}

module.exports = { assertDirectExistingPath, assertSafeExistingAncestor, sha256File, fileArtifact, sameMainArtifact, publicArtifact, inspectSidecars };
