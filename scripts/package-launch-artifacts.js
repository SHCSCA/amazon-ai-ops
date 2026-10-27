// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PACKAGE_LAUNCH_WINDOW_READY_MAX_BYTES, fail, stableJson } = require('./package-launch-contracts.js');

function sha256(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex').toUpperCase();
}

function fileInfo(filePath) {
    if (!fs.existsSync(filePath))
        fail('Package artifact is missing', filePath);
    const stat = fs.statSync(filePath);
    return {
        path: filePath,
        sizeBytes: stat.size,
        sha256: sha256(filePath),
        mtime: stat.mtime.toISOString(),
    };
}

function readStableRegularFile(filePath) {
    try {
        if (!path.win32.isAbsolute(String(filePath || '')))
            return null;
        const linkStat = fs.lstatSync(filePath);
        if (linkStat.isSymbolicLink() || !linkStat.isFile())
            return null;
        const before = fs.statSync(filePath);
        const bytes = fs.readFileSync(filePath);
        const after = fs.statSync(filePath);
        if (before.size !== after.size
            || before.mtimeMs !== after.mtimeMs
            || bytes.length !== after.size) {
            return null;
        }
        return { bytes, stat: after };
    }
    catch {
        return null;
    }
}

function currentArtifactMatches(artifact) {
    const current = readStableRegularFile(artifact?.path);
    if (!current)
        return false;
    return Number(artifact?.sizeBytes) === current.stat.size
        && String(artifact?.sha256 || '').toUpperCase()
            === crypto.createHash('sha256').update(current.bytes).digest('hex').toUpperCase()
        && String(artifact?.mtime || '') === current.stat.mtime.toISOString();
}

function currentJsonMarkerMatches(filePath, expectedMarker, artifact = null) {
    const current = readStableRegularFile(filePath);
    if (!current || current.bytes.length < 2 || current.bytes.length > PACKAGE_LAUNCH_WINDOW_READY_MAX_BYTES) {
        return false;
    }
    if (artifact
        && (Number(artifact.sizeBytes) !== current.stat.size
            || String(artifact.sha256 || '').toUpperCase()
                !== crypto.createHash('sha256').update(current.bytes).digest('hex').toUpperCase()
            || String(artifact.mtime || '') !== current.stat.mtime.toISOString())) {
        return false;
    }
    try {
        return stableJson(JSON.parse(current.bytes.toString('utf8'))) === stableJson(expectedMarker);
    }
    catch {
        return false;
    }
}

function writeLog(filePath, chunks) {
    fs.writeFileSync(filePath, chunks.join(''), 'utf8');
}

module.exports = { sha256, fileInfo, readStableRegularFile, currentArtifactMatches, currentJsonMarkerMatches, writeLog };
