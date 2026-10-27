// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');


const root = path.resolve(__dirname, '..');

const evidenceDir = path.join(root, 'output', 'codex-evidence');

const bundleRoot = path.join(root, 'output', 'delivery-bundles');

const finalReadinessPattern = /^final-readiness-(?:\d{4}-\d{2}-\d{2}|\d{10,})\.json$/i;

const packageLaunchSmokePattern = /^package-launch-smoke-\d+\.json$/i;

const DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT = 100;

const DIAGNOSTIC_RENDERER_ENTRY_LIMIT = 100;

const expectedNonReadyGateIds = new Set([
    'report-collection-delivery',
    'lingxing-listing-full-read',
    'ai-live-provider',
    'ad-recommendation-ai-explanation',
    'listing-ai-draft',
    'real-ad-execution-readback',
    'release-package-hash',
    'package-launch-smoke',
]);

function latestEvidence(pattern) {
    if (!fs.existsSync(evidenceDir))
        return null;
    const files = fs.readdirSync(evidenceDir)
        .filter((name) => pattern.test(name))
        .map((name) => {
        const filePath = path.join(evidenceDir, name);
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files[0]?.filePath || null;
}

function latestBundleManifest() {
    if (!fs.existsSync(bundleRoot))
        return null;
    const files = fs.readdirSync(bundleRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(bundleRoot, entry.name, 'delivery-bundle-manifest.json'))
        .filter((filePath) => fs.existsSync(filePath))
        .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files[0]?.filePath || null;
}

function parseArgs(argv) {
    const args = {};
    for (let index = 2; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--'))
            throw new Error(`Unexpected argument: ${token}`);
        const key = token.slice(2);
        const value = argv[index + 1];
        if (!value || value.startsWith('--'))
            throw new Error(`Missing value for --${key}`);
        args[key] = value;
        index += 1;
    }
    return args;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runNode(script, args = []) {
    const result = spawnSync(process.execPath, [path.join(root, script), ...args], {
        cwd: root,
        encoding: 'utf8',
    });
    return {
        ok: result.status === 0,
        output: `${result.stdout || ''}${result.stderr || ''}`,
    };
}

function requireFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`${label} file is missing: ${filePath}`);
    }
}

function gateByName(finalReadiness, name) {
    return (finalReadiness.gates || []).find((gate) => gate.name === name);
}

function gateById(finalReadiness, id) {
    return (finalReadiness.gates || []).find((gate) => gate.id === id);
}

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function normalizedPath(filePath) {
    if (!filePath || typeof filePath !== 'string')
        return '';
    const resolved = path.resolve(filePath);
    let canonical = resolved;
    try {
        canonical = fs.realpathSync.native(resolved);
    }
    catch {
    }
    return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function samePath(left, right) {
    const normalizedLeft = normalizedPath(left);
    return Boolean(normalizedLeft && normalizedLeft === normalizedPath(right));
}

function validArtifact(artifact) {
    if (!artifact?.path || !fs.existsSync(artifact.path))
        return false;
    try {
        const stat = fs.statSync(artifact.path);
        if (!stat.isFile() || Number(artifact.sizeBytes || 0) <= 0)
            return false;
        if (stat.size !== Number(artifact.sizeBytes || 0))
            return false;
        return /^[A-F0-9]{64}$/.test(String(artifact.sha256 || ''))
            && sha256(artifact.path) === String(artifact.sha256 || '').toUpperCase();
    }
    catch {
        return false;
    }
}

function artifactsMatch(left, right) {
    return Boolean(left && right)
        && samePath(left.path, right.path)
        && Number(left.sizeBytes || 0) === Number(right.sizeBytes || 0)
        && String(left.sha256 || '').toUpperCase() === String(right.sha256 || '').toUpperCase();
}

function check(condition, message, failures) {
    if (condition) {
        console.log(`[PASS] ${message}`);
        return;
    }
    failures.push(message);
    console.error(`[FAIL] ${message}`);
}

function readmeStatesNonReady(readme) {
    return /\*\*DELIVERY:\s*(IN_PROGRESS|APP_NEEDS_WORK|REPORT_COLLECTION_READY \/ APP_NEEDS_WORK)\b/.test(readme)
        && !/\*\*DELIVERY:\s*APP_READY\b/.test(readme);
}

function selectedAdReadbackPath(finalReadiness) {
    const manifestPath = finalReadiness.evidenceSelection?.manifestPath;
    if (!manifestPath || !fs.existsSync(path.resolve(manifestPath)))
        return '';
    try {
        const evidenceManifest = readJson(path.resolve(manifestPath));
        return evidenceManifest.evidence?.adReadback?.absolutePath || '';
    }
    catch {
        return '';
    }
}

function hasOnlyLegacySourceTraceabilityFailure(output) {
    const failureLines = String(output || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('[FAIL]'));
    return failureLines.length === 1 && failureLines[0] === '[FAIL] source report traceability is incomplete';
}

function packageIdentity(item) {
    return [
        String(item?.kind || ''),
        normalizedPath(item?.sourcePath),
        String(item?.fileName || ''),
    ].join('\u0000');
}

function packageEvidenceRecord(item) {
    return {
        kind: String(item?.kind || ''),
        sourcePath: normalizedPath(item?.sourcePath),
        fileName: String(item?.fileName || ''),
        exists: item?.exists === true,
        sizeBytes: Number(item?.sizeBytes || 0),
        sha256: String(item?.sha256 || '').toUpperCase(),
        modifiedAt: String(item?.modifiedAt || ''),
    };
}

function packageEvidenceListsMatch(leftPackages, rightPackages) {
    if (!Array.isArray(leftPackages) || !Array.isArray(rightPackages))
        return false;
    if (leftPackages.length !== rightPackages.length)
        return false;
    const left = [...leftPackages].sort((a, b) => packageIdentity(a).localeCompare(packageIdentity(b)));
    const right = [...rightPackages].sort((a, b) => packageIdentity(a).localeCompare(packageIdentity(b)));
    return left.every((item, index) => (JSON.stringify(packageEvidenceRecord(item)) === JSON.stringify(packageEvidenceRecord(right[index]))));
}

function pathIsInside(filePath, parentDir) {
    const relative = path.relative(normalizedPath(parentDir), normalizedPath(filePath));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

module.exports = { latestEvidence, latestBundleManifest, parseArgs, readJson, runNode, requireFile, gateByName, gateById, sha256, normalizedPath, samePath, validArtifact, artifactsMatch, check, readmeStatesNonReady, selectedAdReadbackPath, hasOnlyLegacySourceTraceabilityFailure, pathIsInside, packageIdentity, packageEvidenceRecord, packageEvidenceListsMatch, root, evidenceDir, bundleRoot, finalReadinessPattern, packageLaunchSmokePattern, DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT, DIAGNOSTIC_RENDERER_ENTRY_LIMIT, expectedNonReadyGateIds };
