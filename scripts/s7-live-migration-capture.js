// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertDirectExistingPath, entryExists, sameCreatedIdentity, statIdentity } = require('./s7-live-migration-artifacts.js');
const { CAPTURE_FILE_NAMES, fail, samePath } = require('./s7-live-migration-contracts.js');

function createCaptureRoot(context) {
    const parentPath = path.resolve(context.tempRoot ?? os.tmpdir());
    const parent = assertDirectExistingPath(parentPath, 'S7 live acceptance temporary parent', 'directory');
    const captureRoot = fs.mkdtempSync(path.join(parent.realPath, 'amazon-ai-ops-s7-live-acceptance-'));
    const direct = assertDirectExistingPath(captureRoot, 'S7 live acceptance capture root', 'directory');
    if (!samePath(path.dirname(direct.realPath), parent.realPath)) {
        fail('S7 live acceptance capture root escaped its controlled temporary parent.');
    }
    return {
        captureRoot: direct.realPath,
        parentPath: parent.realPath,
        rootIdentity: statIdentity(direct.stat, direct.realPath),
        artifactIdentities: new Map(),
    };
}

function recordCaptureArtifact(captureState, artifactPath) {
    if (!entryExists(artifactPath))
        return;
    if (!samePath(path.dirname(path.resolve(artifactPath)), captureState.captureRoot)
        || !CAPTURE_FILE_NAMES.includes(path.basename(artifactPath))) {
        fail(`Refusing to record an unowned live acceptance artifact: ${artifactPath}`);
    }
    const direct = assertDirectExistingPath(artifactPath, 'Live acceptance capture artifact', 'file');
    if (direct.stat.nlink !== 1) {
        fail('Live acceptance capture artifacts must have exactly one hard link.');
    }
    const identity = statIdentity(direct.stat, direct.realPath);
    const existing = captureState.artifactIdentities.get(path.basename(artifactPath));
    if (existing && !sameCreatedIdentity(existing, identity)) {
        fail(`Live acceptance capture artifact identity changed: ${artifactPath}`);
    }
    captureState.artifactIdentities.set(path.basename(artifactPath), identity);
}

function recordExistingCaptureArtifacts(captureState) {
    const entries = fs.readdirSync(captureState.captureRoot);
    for (const entry of entries) {
        if (!CAPTURE_FILE_NAMES.includes(entry)) {
            fail(`Unexpected live acceptance capture artifact: ${entry}`);
        }
        recordCaptureArtifact(captureState, path.join(captureState.captureRoot, entry));
    }
}

function removeCaptureRoot(captureState) {
    const { captureRoot, parentPath, rootIdentity, artifactIdentities } = captureState;
    if (!entryExists(captureRoot)) {
        fail('S7 live acceptance capture root disappeared before controlled cleanup.');
    }
    const direct = assertDirectExistingPath(captureRoot, 'S7 live acceptance capture root', 'directory');
    if (!samePath(path.dirname(direct.realPath), parentPath)) {
        fail('Refusing to clean a live acceptance capture root outside its controlled parent.');
    }
    if (!sameCreatedIdentity(rootIdentity, statIdentity(direct.stat, direct.realPath))) {
        fail('S7 live acceptance capture root identity changed before cleanup.');
    }
    const entries = fs.readdirSync(direct.realPath);
    for (const entry of entries) {
        if (!CAPTURE_FILE_NAMES.includes(entry)) {
            fail(`Unexpected live acceptance capture artifact: ${entry}`);
        }
        const candidate = path.join(direct.realPath, entry);
        const artifact = assertDirectExistingPath(candidate, 'Live acceptance capture artifact', 'file');
        const recordedIdentity = artifactIdentities.get(entry);
        if (!recordedIdentity
            || !sameCreatedIdentity(recordedIdentity, statIdentity(artifact.stat, artifact.realPath))) {
            fail(`Live acceptance capture artifact identity changed before cleanup: ${entry}`);
        }
        fs.unlinkSync(artifact.realPath);
    }
    const finalRoot = assertDirectExistingPath(captureRoot, 'S7 live acceptance capture root', 'directory');
    if (!sameCreatedIdentity(rootIdentity, statIdentity(finalRoot.stat, finalRoot.realPath))) {
        fail('S7 live acceptance capture root identity changed during cleanup.');
    }
    fs.rmdirSync(direct.realPath);
}

module.exports = { createCaptureRoot, recordCaptureArtifact, recordExistingCaptureArtifacts, removeCaptureRoot };
